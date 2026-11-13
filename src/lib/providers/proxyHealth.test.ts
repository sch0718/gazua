import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxyManagesTossToken } from './proxyHealth';

afterEach(() => { vi.useRealTimers(); });

describe('프록시 토스 토큰 맡음 확인', () => {
  it.each([
    [{ ok: true, tossToken: true }, true],
    [{ ok: true, tossToken: false }, false],
    [{ ok: true }, false],
  ])('정상 응답 %j를 %s로 판정한다', async (body, expected) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body));
    expect(await proxyManagesTossToken('https://proxy.example///', fetchImpl)).toBe(expected);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://proxy.example/health');
    expect(init).toMatchObject({ method: 'GET', redirect: 'manual', signal: expect.any(AbortSignal) });
    expect([...new Headers(init?.headers)]).toEqual([]);
  });

  it.each([
    { ok: false, tossToken: true }, { tossToken: true }, { ok: 'true', tossToken: true },
    { ok: true, tossToken: 'true' }, { ok: true, tossToken: 1 }, { ok: true, tossToken: null },
    null, [], 'test-invalid-response',
  ])('잘못된 상태 응답 %j는 연결 오류다', async (body) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body));
    await expect(proxyManagesTossToken('https://proxy.example', fetchImpl)).rejects.toMatchObject({ code: 'proxy-unreachable' });
  });

  it.each([400, 401, 403, 500])('HTTP %s는 연결 오류다', async (status) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true, tossToken: false }, { status }));
    await expect(proxyManagesTossToken('https://proxy.example', fetchImpl)).rejects.toMatchObject({ code: 'proxy-unreachable' });
  });

  it('비JSON과 네트워크 실패를 기억하지 않고 다음 호출에 다시 확인한다', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('<html>test-private-value</html>'))
      .mockRejectedValueOnce(new Error('test-private-value'))
      .mockResolvedValueOnce(Response.json({ ok: true, tossToken: true }));
    for (let i = 0; i < 2; i++) {
      await expect(proxyManagesTossToken('https://proxy.example', fetchImpl)).rejects.toMatchObject({ code: 'proxy-unreachable', message: 'proxy-unreachable' });
    }
    expect(await proxyManagesTossToken('https://proxy.example', fetchImpl)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it.each([301, 302, 307, 308, 'opaque'])('리다이렉트 %s는 따라가지 않고 오류다', async (status) => {
    const response = status === 'opaque' ? new Response(null) : new Response(null, {
      status: status as number, headers: { location: 'https://other.example/health' },
    });
    if (status === 'opaque') Object.defineProperty(response, 'type', { value: 'opaqueredirect' });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
    await expect(proxyManagesTossToken('https://proxy.example', fetchImpl)).rejects.toMatchObject({ code: 'proxy-redirect' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, 25])('제한 시간 %s가 지나면 timeout이며 타이머를 치운다', async (timeoutMs) => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new Error('test-private-value')));
    }));
    const assertion = expect(proxyManagesTossToken('https://proxy.example', fetchImpl, timeoutMs)).rejects.toMatchObject({ code: 'timeout', message: 'timeout' });
    await Promise.all([assertion, vi.advanceTimersByTimeAsync(timeoutMs ?? 8000)]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('본문을 읽는 중 제한 시간이 지나도 timeout이다', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const response = Response.json({ ok: true });
      response.json = () => new Promise((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(new DOMException('test-abort', 'AbortError')));
      });
      return response;
    });
    const assertion = expect(proxyManagesTossToken('https://proxy.example', fetchImpl, 25)).rejects.toMatchObject({ code: 'timeout' });
    await Promise.all([assertion, vi.advanceTimersByTimeAsync(25)]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
