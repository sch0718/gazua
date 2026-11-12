import { join } from 'node:path';
import { createOrderHandler, readOrderConfig } from '../../../proxy/node/order';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { run } from '../main';
import { MESSAGES } from '../errors';
import { cleanupDirs, fakeFetch, makeIo, type FakeCall, type FakeReply } from '../testing';

afterEach(cleanupDirs);
const ENV = { GAZUA_PROXY_URL: 'https://proxy.example', GAZUA_PROXY_TOKEN: 'fake-proxy-token', GAZUA_PROXY_ORIGIN: 'https://app.example', TOSS_CLIENT_ID: 'fake-client-id', TOSS_CLIENT_SECRET: 'fake-client-secret' };
const TOKEN = 'fake-access-token';
const SEQ = 'fake-brokerage-account';
const ARGS = ['order', 'buy', '005930', '2', '99'];
const LIMITS = { enabled: true, stopped: false, maxAmount: 200, dailyMaxAmount: null, maxPerMinute: 3, maxPerDay: 20, usedToday: { count: 0, amount: 0 } };
function fixture(over: (c: FakeCall) => FakeReply | undefined = () => undefined) {
  return fakeFetch((c) => {
    const r = over(c);
    if (r) return r;
    if (c.url.pathname === '/order/status') return { body: LIMITS };
    if (c.url.pathname === '/oauth2/token') return { body: { access_token: TOKEN, expires_in: 86400 } };
    if (c.url.pathname === '/api/v1/accounts') return { body: { result: [{ accountType: 'PENSION_SAVINGS', accountSeq: 'fake-pension-account' }, { accountType: 'BROKERAGE', accountSeq: SEQ }] } };
    if (c.url.pathname === '/order/toss') return { body: { ok: true, orderId: 'fake-order-id', clientOrderId: 'fake-client-order-id', amount: 198 } };
  });
}
const posts = (f: ReturnType<typeof fixture>) => f.calls.filter((c) => c.url.pathname === '/order/toss');

describe('gazua order', () => {
  it('기본은 상태 GET만 하고 요약한다. 토스 키가 없어도 주문을 보내지 않는다', async () => {
    const f = fixture();
    const t = makeIo({ fetch: f, env: { GAZUA_PROXY_URL: ENV.GAZUA_PROXY_URL, GAZUA_PROXY_TOKEN: ENV.GAZUA_PROXY_TOKEN, GAZUA_PROXY_ORIGIN: ENV.GAZUA_PROXY_ORIGIN } });
    expect(await run(ARGS, t.io)).toBe(0);
    expect(t.result().data).toEqual({ sent: false, order: { side: 'BUY', symbol: '005930', quantity: 2, price: 99, amount: 198 }, limits: LIMITS, hint: '보내려면 --yes를 붙여요' });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].redirect).toBe('manual');
  });

  it.each([false, true])('잘못된 하루 한도로 꺼진 실제 처리기의 상태를 읽는다: --yes %s', async (yes) => {
    const t = makeIo({ env: ENV });
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('꺼진 주문은 상류에 닿으면 안 돼요'));
    const cfg = readOrderConfig({ ORDER_ENABLED: 'true', ORDER_MAX_AMOUNT: '200', ORDER_DAILY_MAX_AMOUNT: 'wrong',
      ORDER_STOP_FILE: join(t.dir, 'stop'), ORDER_AUDIT_LOG: join(t.dir, 'audit.jsonl') });
    const proxy = createOrderHandler(cfg, { fetchImpl, now: t.io.now, upstreamTimeoutMs: 100 });
    await proxy.ready;
    const base = fixture();
    const f = fakeFetch(async (c) => {
      const init = { method: c.method, headers: c.headers, ...(c.body !== undefined && { body: JSON.stringify(c.body) }) };
      const res = c.url.pathname.startsWith('/order/') ? await proxy.handler(new Request(c.url, init)) : await base(c.url, init);
      return { status: res.status, body: await res.json() };
    });
    t.io.fetch = f;
    expect(await run([...ARGS, ...(yes ? ['--yes'] : [])], t.io)).toBe(yes ? 1 : 0);
    if (yes) expect(t.result().error).toEqual({ code: 'order-disabled', message: MESSAGES['order-disabled'] });
    else expect(t.result().data).toMatchObject({ sent: false, limits: { enabled: false, dailyMaxAmount: 0 } });
    expect(posts(f)).toHaveLength(yes ? 1 : 0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('켜진 상태의 하루 한도 0은 깨진 상태로 거절한다', async () => {
    const f = fixture((c) => c.url.pathname === '/order/status' ? { body: { ...LIMITS, dailyMaxAmount: 0 } } : undefined);
    const t = makeIo({ fetch: f, env: ENV });
    await run([...ARGS, '--yes'], t.io);
    expect(t.result().error.code).toBe('upstream');
    expect(posts(f)).toHaveLength(0);
  });

  it('주문이 꺼져 있으면 한도 대신 꺼짐을 알린다', async () => {
    const f = fixture((c) => c.url.pathname === '/order/status' ? { body: { ...LIMITS, enabled: false, maxAmount: 0 } } : undefined);
    const t = makeIo({ fetch: f, env: ENV });
    await run(ARGS, t.io);
    expect(t.result().data.hint).toContain('주문이 꺼져 있어');
    expect(t.result().data.hint).not.toContain('한도 이상');
    expect(posts(f)).toHaveLength(0);
  });

  it('요약 금액이 한도 이상이면 프록시 거절을 알린다', async () => {
    const f = fixture();
    const t = makeIo({ fetch: f, env: ENV });
    await run(['order', 'sell', '005930', '2', '100'], t.io);
    expect(t.result().data.hint).toContain('한도 이상이라 프록시가 거절해요');
    expect(posts(f)).toHaveLength(0);
  });

  it('--yes는 종합매매 계좌 헤더로 프록시에 정확히 한 번 보낸다', async () => {
    const f = fixture();
    const t = makeIo({ fetch: f, env: ENV });
    expect(await run([...ARGS, '--yes'], t.io)).toBe(0);
    expect(t.result().data).toEqual({ sent: true, orderId: 'fake-order-id', clientOrderId: 'fake-client-order-id', amount: 198 });
    expect(posts(f)).toHaveLength(1);
    const post = posts(f)[0];
    expect(post.body).toEqual({ side: 'BUY', symbol: '005930', quantity: 2, price: 99 });
    expect(post.url.origin).toBe(ENV.GAZUA_PROXY_URL);
    expect(post.headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(post.headers.get('x-tossinvest-account')).toBe(SEQ);
    for (const c of f.calls.filter((c) => c.url.origin === ENV.GAZUA_PROXY_URL)) {
      expect(c.redirect).toBe('manual');
      expect(c.headers.get('x-proxy-token')).toBe(ENV.GAZUA_PROXY_TOKEN);
      expect(c.headers.get('origin')).toBe(ENV.GAZUA_PROXY_ORIGIN);
    }
    expect(f.calls.some((c) => c.method === 'POST' && c.url.pathname === '/api/v1/orders')).toBe(false);
  });

  it.each([[], ['hold', '005930', '1', '99'], ['buy', 'AAPL', '1', '99'], ['buy', '005930', '1e3', '99'], ['buy', '005930', '01', '99'], ['buy', '005930', '1.0', '99'], ['buy', '005930', '0', '99'], ['buy', '005930', '9007199254740992', '99'], ['buy', '005930', '9007199254740991', '2'], ['buy', '005930', '1', '99', 'extra']].map((args) => ({ args })))('잘못된 인자 $args는 fetch 전에 거절한다', async ({ args }) => {
    const f = fixture();
    const t = makeIo({ fetch: f, env: ENV });
    expect(await run(['order', ...args, '--yes'], t.io)).toBe(2);
    expect(t.result().error.code).toBe('invalid-args');
    expect(f.calls).toHaveLength(0);
  });

  it.each(['GAZUA_PROXY_URL', 'GAZUA_PROXY_TOKEN', 'GAZUA_PROXY_ORIGIN'])('필수 설정 %s가 없으면 fetch하지 않는다', async (name) => {
    const f = fixture();
    const t = makeIo({ fetch: f, env: { ...ENV, [name]: '' } });
    await run([...ARGS, '--yes'], t.io);
    expect(t.result().error.code).toBe('order-not-configured');
    expect(f.calls).toHaveLength(0);
  });

  it('원격 HTTP 주소는 fetch 전에 거절한다', async () => {
    const f = fixture();
    const t = makeIo({ fetch: f, env: { ...ENV, GAZUA_PROXY_URL: 'http://remote.example' } });
    expect(await run([...ARGS, '--yes'], t.io)).toBe(2);
    expect(f.calls).toHaveLength(0);
  });

  it.each([[], [{ accountType: 'PENSION_SAVINGS', accountSeq: 'fake-pension-account' }]].map((accounts) => ({ accounts })))('종합매매 계좌가 없으면 주문 POST가 없다: $accounts', async ({ accounts }) => {
    const f = fixture((c) => c.url.pathname === '/api/v1/accounts' ? { body: { result: accounts } } : undefined);
    const t = makeIo({ fetch: f, env: ENV });
    await run([...ARGS, '--yes'], t.io);
    expect(t.result().error.code).toBe('upstream');
    expect(posts(f)).toHaveLength(0);
  });

  it.each(['order-disabled', 'order-stopped', 'order-daily-limit', 'order-rate-limited', 'order-busy', 'order-invalid', 'order-unavailable', 'order-audit-failed'] as const)('%s는 정해진 문구로 낸다', async (code) => {
    const f = fixture((c) => c.url.pathname === '/order/toss' ? { status: 403, body: { error: { code } } } : undefined);
    const t = makeIo({ fetch: f, env: ENV });
    await run([...ARGS, '--yes'], t.io);
    expect(t.result().error).toEqual({ code, message: MESSAGES[code] });
    expect(posts(f)).toHaveLength(1);
  });

  it('한도 거절에는 금액과 데이터를, 토스 오류에는 메시지를 붙인다', async () => {
    for (const [code, data, message] of [['order-over-limit', { amount: 198, maxAmount: 100 }, undefined], ['order-upstream', undefined, '호가가 맞지 않아요']] as const) {
      const f = fixture((c) => c.url.pathname === '/order/toss' ? { status: 422, body: { error: { code, data, message } } } : undefined);
      const t = makeIo({ fetch: f, env: ENV });
      await run([...ARGS, '--yes'], t.io);
      expect(t.result().error.code).toBe(code);
      expect(t.result().error.message).toContain(code === 'order-over-limit' ? '1회 최대 금액(100원) 이상이라 보낼 수 없어요(이번 198원)' : message!);
      if (data) expect(t.result().data).toEqual(data);
    }
  });

  it.each(['proxy-token-invalid', 'origin-not-allowed'])('프록시 거절 %s는 설정을 안내한다', async (code) => {
    const f = fixture((c) => c.url.pathname === '/order/status' ? { status: 401, body: { error: { code } } } : undefined);
    const t = makeIo({ fetch: f, env: ENV });
    await run([...ARGS, '--yes'], t.io);
    expect(t.result().error.code).toBe('proxy-rejected');
    expect(posts(f)).toHaveLength(0);
  });

  it.each([502, 504, 307, 308])('POST 응답 %s는 결과 불명이고 재전송하지 않는다', async (status) => {
    const f = fixture((c) => c.url.pathname === '/order/toss' ? { status, body: { error: { code: 'upstream-timeout', data: { clientOrderId: 'fake-client-order-id' } } }, headers: { location: 'https://other.example' } } : undefined);
    const t = makeIo({ fetch: f, env: ENV });
    await run([...ARGS, '--yes'], t.io);
    expect(t.result().error.code).toBe('order-unknown');
    expect(t.result().error.message).toContain('토스 앱에서 확인하기 전에는 다시 보내지 마세요');
    expect(t.result().data.clientOrderId).toBe('fake-client-order-id');
    expect(posts(f)).toHaveLength(1);
  });

  it.each([new TypeError('가짜 연결 끊김'), { status: 400, body: { error: { code: 'not-known' } } }, { body: { result: 'wrong' } }])('연결 끊김과 모르는 응답은 감사 로그 안내와 함께 결과 불명이다', async (reply) => {
    const f = fixture((c) => c.url.pathname === '/order/toss' ? reply : undefined);
    const t = makeIo({ fetch: f, env: ENV });
    await run([...ARGS, '--yes'], t.io);
    expect(t.result().error.code).toBe('order-unknown');
    expect(t.result().error.message).toContain('감사 로그');
    expect(posts(f)).toHaveLength(1);
  });

  it('JSON을 해석할 수 없는 POST 응답도 결과 불명이다', async () => {
    const f = fixture();
    const fetchImpl = vi.fn<typeof fetch>(async (...args) => {
      const res = await f(...args);
      return String(args[0]).endsWith('/order/toss') ? new Response('{') : res;
    });
    const t = makeIo({ fetch: fetchImpl, env: ENV });
    await run([...ARGS, '--yes'], t.io);
    expect(t.result().error.code).toBe('order-unknown');
    expect(posts(f)).toHaveLength(1);
  });

  it('상태 GET의 리디렉션과 모르는 오류는 upstream이고 POST가 없다', async () => {
    for (const reply of [{ status: 307, headers: { location: 'https://other.example' } }, { status: 500, body: { error: { code: 'not-known' } } }]) {
      const f = fixture((c) => c.url.pathname === '/order/status' ? reply : undefined);
      const t = makeIo({ fetch: f, env: ENV });
      await run([...ARGS, '--yes'], t.io);
      expect(t.result().error.code).toBe('upstream');
      expect(f.calls).toHaveLength(1);
    }
  });

  it('오류에 되돌아온 토큰·계좌·프록시 토큰을 출력에서 가린다', async () => {
    const f = fixture((c) => c.url.pathname === '/order/toss' ? { status: 422, body: { error: { code: 'order-upstream', message: `${TOKEN} ${SEQ} ${ENV.GAZUA_PROXY_TOKEN}` } } } : undefined);
    const t = makeIo({ fetch: f, env: ENV });
    await run([...ARGS, '--yes', '--verbose'], t.io);
    for (const secret of [TOKEN, SEQ, ENV.GAZUA_PROXY_TOKEN]) expect(t.out.join('') + t.err.join('')).not.toContain(secret);
    expect(t.result().error.message).toContain('[숨김]');
  });
});
