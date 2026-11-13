import { describe, expect, it, vi } from 'vitest';
import { UPSTREAM } from '../src/allowlist';
import { createTossTokenKeeper, readTossKeys } from './tossToken';

const keys = { clientId: 'test-client-id', clientSecret: 'test-client-secret' };
const issued = (token = 'test-access-token', expiresIn = 3600) =>
  Response.json({ access_token: token, expires_in: expiresIn });

function setup(fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(issued())) {
  let time = 100_000;
  const log = vi.fn();
  const keeper = createTossTokenKeeper(keys, { fetchImpl, now: () => time, timeoutMs: 1200, log });
  return { keeper, fetchImpl, log, advance: (ms: number) => { time += ms; } };
}

describe('토스 키 읽기', () => {
  it.each([undefined, '', '  ', '\t\n'])('키가 비었거나 공백이면 맡지 않는다: %s', (value) => {
    expect(readTossKeys({ TOSS_CLIENT_ID: value, TOSS_CLIENT_SECRET: keys.clientSecret })).toBeUndefined();
    expect(readTossKeys({ TOSS_CLIENT_ID: keys.clientId, TOSS_CLIENT_SECRET: value })).toBeUndefined();
  });
  it('두 키의 앞뒤 공백을 제거한다', () => {
    expect(readTossKeys({ TOSS_CLIENT_ID: ` ${keys.clientId} `, TOSS_CLIENT_SECRET: `\t${keys.clientSecret}\n` })).toEqual(keys);
  });
});

describe('토스 토큰 관리자', () => {
  it('동시 요청은 한 번만 발급하고 이후 캐시를 쓴다', async () => {
    let resolve!: (response: Response) => void;
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise((done) => { resolve = done; }));
    const { keeper } = setup(fetchImpl);
    const first = keeper.get();
    const second = keeper.get();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    resolve(issued());
    expect(await Promise.all([first, second])).toEqual(['test-access-token', 'test-access-token']);
    expect(await keeper.get()).toBe('test-access-token');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${UPSTREAM.toss}/oauth2/token`);
    expect(init).toMatchObject({ method: 'POST', redirect: 'manual', signal: expect.any(AbortSignal) });
    expect(new URLSearchParams(init?.body as URLSearchParams)).toEqual(new URLSearchParams({
      grant_type: 'client_credentials', client_id: keys.clientId, client_secret: keys.clientSecret,
    }));
    expect(new Headers(init?.headers).get('content-type')).toBe('application/x-www-form-urlencoded');
  });

  it('만료 60초 전부터 새로 발급한다', async () => {
    const state = setup();
    await state.keeper.get();
    state.advance(3_539_999);
    await state.keeper.get();
    expect(state.fetchImpl).toHaveBeenCalledTimes(1);
    state.advance(1);
    state.fetchImpl.mockResolvedValue(issued('test-new-token'));
    expect(await state.keeper.get()).toBe('test-new-token');
    expect(state.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('발급 뒤 60초 안에는 버리지 않고 경계부터 새 발급을 허용한다', async () => {
    const state = setup();
    const token = await state.keeper.get();
    state.advance(59_999);
    expect(state.keeper.invalidate(token)).toBe(false);
    expect(await state.keeper.get()).toBe(token);
    expect(state.fetchImpl).toHaveBeenCalledTimes(1);
    state.advance(1);
    expect(state.keeper.invalidate('test-other-token')).toBe(false);
    expect(state.keeper.invalidate(token)).toBe(true);
    expect(state.keeper.invalidate(token)).toBe(false);
    state.fetchImpl.mockResolvedValue(issued('test-new-token'));
    expect(await state.keeper.get()).toBe('test-new-token');
    state.advance(60_000);
    expect(state.keeper.invalidate(token)).toBe(false);
    expect(await state.keeper.get()).toBe('test-new-token');
    expect(state.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('HTTP 실패를 캐시하지 않고 상태만 기록한다', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(`${keys.clientId} ${keys.clientSecret} test-access-token`, { status: 401 }))
      .mockResolvedValueOnce(issued());
    const { keeper, log } = setup(fetchImpl);
    await expect(keeper.get()).rejects.toThrow('토스 토큰을 받지 못했어요');
    expect(await keeper.get()).toBe('test-access-token');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(log.mock.calls).toEqual([['toss-token: issue failed 401']]);
  });

  it.each([
    {}, { access_token: '', expires_in: 3600 }, { access_token: '  ', expires_in: 3600 },
    { access_token: 1, expires_in: 3600 }, { access_token: 'test-access-token', expires_in: '3600' },
    { access_token: 'test-access-token', expires_in: 0 }, { access_token: 'test-access-token', expires_in: -1 },
  ])('잘못된 발급 응답은 거절하고 다음 요청에서 재시도한다: %j', async (body) => {
    const state = setup(vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(body)).mockResolvedValueOnce(issued()));
    await expect(state.keeper.get()).rejects.toThrow('토스 토큰을 받지 못했어요');
    expect(await state.keeper.get()).toBe('test-access-token');
    expect(state.log.mock.calls).toEqual([['toss-token: issue failed 200']]);
  });

  it('네트워크 오류나 잘못된 JSON에도 값이 오류와 로그에 남지 않는다', async () => {
    const privateText = `${keys.clientId} ${keys.clientSecret} test-access-token`;
    const state = setup(vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new Error(privateText))
      .mockResolvedValueOnce(new Response(privateText))
      .mockResolvedValueOnce(issued()));
    for (let i = 0; i < 2; i++) {
      await expect(state.keeper.get()).rejects.toThrow(/^토스 토큰을 받지 못했어요$/);
    }
    expect(await state.keeper.get()).toBe('test-access-token');
    expect(state.log.mock.calls).toEqual([
      ['toss-token: issue failed 0'], ['toss-token: issue failed 200'],
    ]);
    for (const value of [keys.clientId, keys.clientSecret, 'test-access-token']) {
      expect(JSON.stringify(state.log.mock.calls)).not.toContain(value);
    }
  });
});
