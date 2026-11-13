import { afterEach, describe, expect, it } from 'vitest';
import { run } from '../main';
import { cleanupDirs, fakeFetch, makeIo, type FakeCall, type FakeReply } from '../testing';

afterEach(cleanupDirs);

const TOSS_ENV = { TOSS_CLIENT_ID: 'toss-client-id-1', TOSS_CLIENT_SECRET: 'toss-client-secret-1' };
const SEQ = 1234567;

function toss(over: (c: FakeCall) => FakeReply | undefined = () => undefined) {
  return fakeFetch((c) => {
    const o = over(c);
    if (o) return o;
    if (c.url.pathname === '/oauth2/token') return { body: { access_token: 'tok-1', expires_in: 86_400 } };
    if (c.url.pathname === '/api/v1/prices') {
      const symbols = (c.url.searchParams.get('symbols') ?? '').split(',').filter((s) => s !== '000000');
      return { body: { result: symbols.map((symbol) => ({ symbol, lastPrice: '71200', timestamp: '2026-11-02T09:00:00+09:00' })) } };
    }
    if (c.url.pathname === '/api/v1/accounts') return { body: { result: [{ accountNo: '1', accountSeq: SEQ, accountType: 'BROKERAGE' }] } };
    if (c.url.pathname === '/api/v1/holdings') {
      return { body: { result: { items: [{ symbol: '005930', name: '삼성전자', marketCountry: 'KR', currency: 'KRW', quantity: '10', averagePurchasePrice: '68500' }, { symbol: 'AAPL', name: '애플', marketCountry: 'US', currency: 'USD', quantity: '1' }] } } };
    }
    return undefined;
  });
}

describe('gazua quote', () => {
  it('현재가를 JSON으로 낸다(토스는 UNIFIED)', async () => {
    const f = toss();
    const t = makeIo({ fetch: f, env: TOSS_ENV });
    expect(await run(['quote', '005930', '000660'], t.io)).toBe(0);
    expect(t.result()).toEqual({
      ok: true,
      data: { provider: 'toss', quotes: [{ symbol: '005930', price: 71200, ts: Date.parse('2026-11-02T09:00:00+09:00'), venue: 'UNIFIED' }, { symbol: '000660', price: 71200, ts: Date.parse('2026-11-02T09:00:00+09:00'), venue: 'UNIFIED' }] },
    });
    expect(f.calls.some((c) => c.url.pathname === '/api/v1/orders')).toBe(false);
    expect(t.out.join('')).not.toContain('toss-client-secret-1');
  });

  it('받지 못한 종목은 missing으로 알린다', async () => {
    const t = makeIo({ fetch: toss(), env: TOSS_ENV });
    await run(['quote', '005930', '000000'], t.io);
    expect(t.result().data.missing).toEqual(['000000']);
  });

  it('모든 종목이 빠져도 missing으로 알린다', async () => {
    const t = makeIo({ fetch: toss(), env: TOSS_ENV });
    expect(await run(['quote', '000000'], t.io)).toBe(0);
    expect(t.result().data).toEqual({ provider: 'toss', quotes: [], missing: ['000000'] });
  });

  it('시세 응답의 가격이 깨지면 missing으로 감추지 않고 upstream을 낸다', async () => {
    const f = toss((c) => c.url.pathname === '/api/v1/prices' ? { body: { result: [{ symbol: '005930', lastPrice: 'broken' }] } } : undefined);
    const t = makeIo({ fetch: f, env: TOSS_ENV });
    expect(await run(['quote', '005930'], t.io)).toBe(1);
    expect(t.result().error.code).toBe('upstream');
    expect(f.calls.filter((c) => c.url.pathname === '/api/v1/prices')).toHaveLength(1);
  });

  it('누락을 재조회하는 중 연결이 끊기면 network를 유지한다', async () => {
    let prices = 0;
    const f = toss((c) => {
      if (c.url.pathname !== '/api/v1/prices') return;
      if (++prices > 1) return new TypeError('fetch failed');
    });
    const t = makeIo({ fetch: f, env: TOSS_ENV });
    expect(await run(['quote', '005930', '000000'], t.io)).toBe(1);
    expect(t.result().error.code).toBe('network');
  });

  it('중복 종목은 한 번만 요청하고 ETN의 Q 표기는 missing이 아니다', async () => {
    const f = toss();
    const t = makeIo({ fetch: f, env: TOSS_ENV });
    expect(await run(['quote', 'Q500001', 'Q500001'], t.io)).toBe(0);
    expect(t.result().data.quotes).toHaveLength(1);
    expect(t.result().data).not.toHaveProperty('missing');
    expect(f.calls.find((c) => c.url.pathname === '/api/v1/prices')?.url.searchParams.get('symbols')).toBe('500001');
  });

  it('KIS 키만 있으면 KRX 현재가를 직접 조회하고 다음 실행은 파일 토큰을 쓴다', async () => {
    const env = { KIS_APP_KEY: 'kis-app-key-1', KIS_APP_SECRET: 'kis-app-secret-1' };
    const f = fakeFetch((c) => {
      if (c.url.pathname === '/oauth2/tokenP') return { body: { access_token: 'kis-access-token-1', access_token_token_expired: '2026-11-03 12:00:00' } };
      if (c.url.pathname === '/uapi/domestic-stock/v1/quotations/inquire-price') return { body: { rt_cd: '0', output: { stck_prpr: '71200' } } };
    });
    const t = makeIo({ fetch: f, env });
    expect(await run(['quote', '005930'], t.io)).toBe(0);
    expect(t.result().data).toEqual({ provider: 'kis', quotes: [{ symbol: '005930', price: 71200, ts: t.clock.now, venue: 'KRX' }] });
    const u = makeIo({ fetch: f, env, dir: t.dir });
    expect(await run(['quote', '005930'], u.io)).toBe(0);
    expect(f.calls.filter((c) => c.url.pathname === '/oauth2/tokenP')).toHaveLength(1);
    expect(f.calls.every((c) => c.url.origin === 'https://openapi.koreainvestment.com:9443')).toBe(true);
  });

  it('종목이 없거나 코드 모양이 틀리면 invalid-args(종료 2)', async () => {
    for (const argv of [['quote'], ['quote', '5930'], ['quote', 'abc!@#']]) {
      const t = makeIo({ fetch: toss(), env: TOSS_ENV });
      expect(await run(argv, t.io)).toBe(2);
      expect(t.result().error.code).toBe('invalid-args');
    }
  });

  it('종목 인자 오류 메시지가 입력을 되풀이해도 환경변수 키는 [숨김]으로 나온다', async () => {
    const t = makeIo({ fetch: toss(), env: TOSS_ENV });
    expect(await run(['quote', 'toss-client-id-1'], t.io)).toBe(2);
    expect(t.out.join('')).not.toContain('toss-client-id-1');
    expect(t.result().error.message).toContain('[숨김]');
    const u = makeIo({ fetch: toss(), env: TOSS_ENV });
    await run(['quote', 'toss-client-secret-1', '--verbose'], u.io);
    expect(u.out.join('') + u.err.join('')).not.toContain('toss-client-secret-1');
  });

  it('키가 없으면 no-credentials, --provider kis인데 KIS 키가 없어도 no-credentials', async () => {
    const a = makeIo({ fetch: toss() });
    expect(await run(['quote', '005930'], a.io)).toBe(1);
    expect(a.result().error.code).toBe('no-credentials');
    const b = makeIo({ fetch: toss(), env: TOSS_ENV });
    await run(['quote', '005930', '--provider', 'kis'], b.io);
    expect(b.result().error.code).toBe('no-credentials');
  });

  it('토스가 IP를 막으면 ip-not-allowed, 연결이 안 되면 network', async () => {
    const a = makeIo({ fetch: toss((c) => (c.url.pathname === '/oauth2/token' ? { status: 403, body: { error: 'access_denied' } } : undefined)), env: TOSS_ENV });
    await run(['quote', '005930'], a.io);
    expect(a.result().error.code).toBe('ip-not-allowed');
    const b = makeIo({ fetch: fakeFetch(() => new TypeError('fetch failed')), env: TOSS_ENV });
    await run(['quote', '005930'], b.io);
    expect(b.result().error.code).toBe('network');
  });
});

describe('gazua holdings', () => {
  it('토스 국내 보유(수량·평단)를 낸다. 계좌 번호는 출력에 없다', { timeout: 15_000 }, async () => {
    const f = toss();
    const t = makeIo({ fetch: f, env: TOSS_ENV });
    expect(await run(['holdings'], t.io)).toBe(0);
    expect(t.result()).toEqual({ ok: true, data: { provider: 'toss', holdings: [{ symbol: '005930', name: '삼성전자', quantity: 10, avgPrice: 68500 }] } });
    expect(t.out.join('')).not.toContain(String(SEQ));
    expect(f.calls.find((c) => c.url.pathname === '/api/v1/holdings')?.headers.get('x-tossinvest-account')).toBe(String(SEQ));
  });

  it('KIS로는 provider-unsupported, 토스 키가 없으면 no-credentials', async () => {
    const a = makeIo({ fetch: toss(), env: { KIS_APP_KEY: 'k', KIS_APP_SECRET: 's' } });
    await run(['holdings', '--provider', 'kis'], a.io);
    expect(a.result().error.code).toBe('provider-unsupported');
    const b = makeIo({ fetch: toss(), env: { KIS_APP_KEY: 'k', KIS_APP_SECRET: 's' } });
    await run(['holdings'], b.io);
    expect(b.result().error.code).toBe('no-credentials');
  });
});


describe('키 없는 프록시 조회 진입점', () => {
  const env = { GAZUA_PROXY_URL: 'https://proxy.example', GAZUA_PROXY_TOKEN: 'test-proxy-token', GAZUA_PROXY_ORIGIN: 'https://app.example' };
  it.each([['quote', '005930'], ['holdings']])('%j는 관리 프록시로 인증 없이 조회한다', async (...argv) => {
    const base = toss();
    const f = fakeFetch(async (call) => {
      if (call.url.pathname === '/health') return { body: { ok: true, tossToken: true } };
      const url = new URL(call.url); url.pathname = url.pathname.replace(/^\/toss/, '');
      const response = await base(url, { method: call.method, headers: call.headers });
      return { status: response.status, body: await response.json() };
    });
    const t = makeIo({ fetch: f, env });
    expect(await run(argv, t.io)).toBe(0);
    expect(t.result().data.provider).toBe('toss');
    const calls = f.calls.filter((call) => call.url.pathname !== '/health');
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.url.origin).toBe(env.GAZUA_PROXY_URL);
      expect(call.url.pathname).toMatch(/^\/toss\/api\//);
      expect(call.headers.get('origin')).toBe(env.GAZUA_PROXY_ORIGIN);
      expect(call.headers.get('x-proxy-token')).toBe(env.GAZUA_PROXY_TOKEN);
      expect(call.headers.has('authorization')).toBe(false);
    }
    expect(f.calls.some((call) => call.url.pathname.includes('/oauth2/'))).toBe(false);
  });
  it.each([['quote', '005930'], ['holdings']])('%j는 비관리 프록시에 키가 없으면 안내한다', async (...argv) => {
    const f = fakeFetch(() => ({ body: { ok: true, tossToken: false } }));
    const t = makeIo({ fetch: f, env });
    expect(await run(argv, t.io)).toBe(1);
    expect(t.result().error.code).toBe('invalid-credentials');
    expect(f.calls).toHaveLength(1);
  });
});
