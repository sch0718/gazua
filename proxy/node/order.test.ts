import { appendFile, chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import { createOrderHandler, readOrderConfig, type OrderConfig } from './order.js';
import { UPSTREAM } from '../src/allowlist.js';

vi.mock('node:fs/promises', async (original) => ({ ...await original<typeof import('node:fs/promises')>() }));

const dirs: string[] = [];
const NOW = Date.parse('2026-11-12T10:00:00+09:00');
const body = { symbol: '005930', side: 'BUY', quantity: 1, price: 99 };
const headers = { authorization: 'Bearer fake-toss-token', 'x-tossinvest-account': 'fake-account', 'x-proxy-token': 'fake-proxy-token' };
const request = (value: unknown = body, extra: Record<string, string> = headers) => new Request('https://proxy.example/order/toss', {
  method: 'POST', headers: extra, body: typeof value === 'string' ? value : JSON.stringify(value),
});
const code = async (res: Response) => (await res.json()).error?.code;

async function fixture(overrides: Partial<OrderConfig> = {}, time = NOW) {
  const dir = await mkdtemp(join(tmpdir(), 'gazua-order-'));
  dirs.push(dir);
  const cfg = { enabled: true, maxAmount: 100, maxPerMinute: 3, maxPerDay: 20, stopFile: join(dir, 'stop'), auditLog: join(dir, 'orders.jsonl'), ...overrides };
  const clock = { now: time };
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ result: { orderId: 'order-id' } })));
  const deps = { fetchImpl, now: () => clock.now, upstreamTimeoutMs: 100, randomId: () => 'fake-client-id' };
  const created = createOrderHandler(cfg, deps);
  await created.ready;
  return { ...created, cfg, clock, fetchImpl, deps, dir };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('주문 설정', () => {
  it('기본은 꺼지고 경로와 반복 상한 기본값을 채운다', () => {
    expect(readOrderConfig({}, '/fake-home')).toMatchObject({ enabled: false, maxPerMinute: 3, maxPerDay: 20,
      stopFile: '/fake-home/gazua-order.stop', auditLog: '/fake-home/Library/Logs/gazua-orders.jsonl' });
    expect(readOrderConfig({ ORDER_ENABLED: 'true', ORDER_MAX_AMOUNT: '100', ORDER_STOP_FILE: '~/stop' }, '/fake-home'))
      .toMatchObject({ enabled: true, maxAmount: 100, stopFile: '/fake-home/stop' });
  });

  it.each(['0', '-1', '1.5', '1e3', '1,000', '01', '9007199254740992', ''])('잘못된 한도 %s는 꺼진다', (value) => {
    const cfg = readOrderConfig({ ORDER_ENABLED: 'true', ORDER_MAX_AMOUNT: value });
    expect(cfg.enabled).toBe(false);
    expect(cfg.disabledReason).toBeTruthy();
  });

  it.each([{ ORDER_DAILY_MAX_AMONT: '1000' }, { order_daily_max_amount: '1000' }, { ORDER_STOP_FLIE: '~/stop' }, { ORDER_STOP_FILE: 'gazua.stop' }, { ORDER_AUDIT_LOG: 'logs/orders.jsonl' }])('키 오타나 상대 경로 %j는 전체를 끈다', (extra) => {
    const cfg = readOrderConfig({ ORDER_ENABLED: 'true', ORDER_MAX_AMOUNT: '100', ...extra }, '/fake-home');
    expect(cfg.enabled).toBe(false);
    expect(cfg.disabledReason).toBeTruthy();
  });

  it.each(['ORDER_DAILY_MAX_AMOUNT', 'ORDER_MAX_PER_MINUTE', 'ORDER_MAX_PER_DAY'])('선택 값 %s도 잘못되면 전체를 끈다', (name) => {
    expect(readOrderConfig({ ORDER_ENABLED: 'true', ORDER_MAX_AMOUNT: '100', [name]: 'wrong' }).enabled).toBe(false);
  });
});

describe('주문 처리기', () => {
  it('최초 로그를 600으로 만들고 비밀값 없는 상태를 돌려준다', async () => {
    const f = await fixture();
    expect((await stat(f.cfg.auditLog)).mode & 0o777).toBe(0o600);
    expect(await (await f.handler(new Request('https://proxy.example/order/status'))).json()).toEqual({
      enabled: true, stopped: false, maxAmount: 100, dailyMaxAmount: null, maxPerMinute: 3, maxPerDay: 20, usedToday: { count: 0, amount: 0 },
    });
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it('복원을 기다리는 주문은 즉시 꺼짐으로 거절한다', async () => {
    const f = await fixture();
    let release!: () => void;
    const original = fs.readFile;
    vi.spyOn(fs, 'readFile').mockImplementationOnce((async (...args: Parameters<typeof fs.readFile>) => {
      await new Promise<void>((resolve) => { release = resolve; });
      return original(...args);
    }) as typeof fs.readFile);
    const pending = createOrderHandler(f.cfg, f.deps);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(await code(await pending.handler(request()))).toBe('order-disabled');
    expect((await (await pending.handler(new Request('https://proxy.example/order/status'))).json()).enabled).toBe(false);
    expect(f.fetchImpl).not.toHaveBeenCalled();
    release();
    await pending.ready;
  });

  it('꺼진 설정은 상류에 보내지 않는다', async () => {
    const f = await fixture({ enabled: false });
    expect(await code(await f.handler(request()))).toBe('order-disabled');
    expect(f.fetchImpl).not.toHaveBeenCalled();
    // 꺼져 있으면 감사 로그 파일도 만들지 않는다.
    await expect(stat(f.cfg.auditLog)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['BUY', 'SELL'])('%s 금액이 한도와 같으면 거절하고 한도 미만만 보낸다', async (side) => {
    const f = await fixture();
    const rejected = await f.handler(request({ ...body, side, price: 100 }));
    expect(rejected.status).toBe(403);
    expect(await rejected.json()).toMatchObject({ error: { code: 'order-over-limit', data: { amount: 100, maxAmount: 100 } } });
    expect(f.fetchImpl).not.toHaveBeenCalled();
    expect((await f.handler(request({ ...body, side }))).status).toBe(200);
  });

  it.each([
    { ...body, quantity: '1' }, { ...body, quantity: 1.5 }, { ...body, quantity: -1 }, { ...body, quantity: 0 },
    { ...body, price: '1e3' }, { ...body, price: 1e100 }, { ...body, quantity: Number.MAX_SAFE_INTEGER, price: 2 },
    { ...body, side: 'buy' }, { ...body, symbol: 'AAPL' }, { ...body, orderType: 'MARKET' }, { ...body, clientOrderId: 'injected' },
    [], null, '{',
  ])('잘못된 본문 %j는 상류에 보내지 않는다', async (value) => {
    const f = await fixture();
    expect(await code(await f.handler(request(value)))).toBe('order-invalid');
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it('자격 헤더가 빠지면 거절한다', async () => {
    const f = await fixture();
    for (const extra of [{}, { authorization: headers.authorization }, { 'x-tossinvest-account': headers['x-tossinvest-account'] }]) {
      expect(await code(await f.handler(request(body, extra)))).toBe('order-invalid');
    }
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it('정수로 파싱되는 지수 표기를 받고 고정된 지정가 본문과 헤더만 만든다', async () => {
    const f = await fixture({ maxAmount: 2000 });
    const res = await f.handler(request('{"symbol":"005930","side":"BUY","quantity":1.0,"price":1e3}'));
    expect(await res.json()).toEqual({ ok: true, orderId: 'order-id', clientOrderId: 'fake-client-id', amount: 1000 });
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = f.fetchImpl.mock.calls[0];
    expect(url).toBe(`${UPSTREAM.toss}/api/v1/orders`);
    expect(init?.redirect).toBe('manual');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(Object.fromEntries(new Headers(init?.headers))).toEqual({ authorization: headers.authorization, 'x-tossinvest-account': headers['x-tossinvest-account'], 'content-type': 'application/json' });
    expect(JSON.parse(String(init?.body))).toEqual({ clientOrderId: 'fake-client-id', symbol: '005930', side: 'BUY', orderType: 'LIMIT', timeInForce: 'DAY', quantity: '1', price: '1000' });
  });

  it('하루 금액 한도는 합계와 같은 금액까지 허용한다', async () => {
    const f = await fixture({ dailyMaxAmount: 198 });
    expect((await f.handler(request())).status).toBe(200);
    expect((await f.handler(request())).status).toBe(200);
    expect(await code(await f.handler(request()))).toBe('order-daily-limit');
    expect(f.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([{ maxPerMinute: 1 }, { maxPerDay: 1 }])('반복 상한 %j에 도달하면 거절한다', async (limits) => {
    const f = await fixture(limits);
    expect((await f.handler(request())).status).toBe(200);
    expect(await code(await f.handler(request()))).toBe('order-rate-limited');
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('처리 중인 두 번째 주문은 줄을 세우지 않는다', async () => {
    const f = await fixture();
    let release!: (value: Response) => void;
    f.fetchImpl.mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }));
    const first = f.handler(request());
    await vi.waitFor(() => expect(f.fetchImpl).toHaveBeenCalledTimes(1));
    const second = await f.handler(request());
    expect(second.status).toBe(409);
    expect(await code(second)).toBe('order-busy');
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    release(new Response(JSON.stringify({ result: { orderId: 'one' } })));
    await first;
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('중지 파일은 재시작 없이 적용하고 지우면 다시 보낸다', async () => {
    const f = await fixture();
    await writeFile(f.cfg.stopFile, '');
    expect(await code(await f.handler(request()))).toBe('order-stopped');
    expect(f.fetchImpl).not.toHaveBeenCalled();
    await rm(f.cfg.stopFile);
    expect((await f.handler(request())).status).toBe(200);
  });

  it.each([[307, 'upstream-unreachable'], [308, 'upstream-unreachable'], [422, 'order-upstream'], [500, 'upstream-unreachable'], [503, 'upstream-unreachable'], [201, 'upstream-unreachable']] as const)('상류 %s는 %s로, 한 번만 보내고 보낸 카운터를 유지한다', async (status, expected) => {
    const f = await fixture();
    f.fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'price-out-of-range', message: '호가가 맞지 않아요' } }), { status, headers: { location: 'https://other.example' } }));
    const res = await f.handler(request());
    // 4xx만 토스 거절이고 나머지는 주문이 들어갔을 수 있는 결과 불명(502)이다.
    expect(res.status).toBe(expected === 'order-upstream' ? status : 502);
    expect(await code(res)).toBe(expected);
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    expect((await (await f.handler(new Request('https://proxy.example/order/status'))).json()).usedToday).toEqual({ count: 1, amount: 99 });
  });

  it.each([false, true])('네트워크 오류와 시간 초과는 결과 불명 ID를 반환한다: %s', async (timeout) => {
    const f = await fixture();
    f.fetchImpl.mockImplementationOnce(async (_url, init) => {
      if (!timeout) throw new TypeError('가짜 연결 끊김');
      return new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)));
    });
    const res = await f.handler(request());
    expect(res.status).toBe(timeout ? 504 : 502);
    expect(await res.json()).toMatchObject({ error: { code: timeout ? 'upstream-timeout' : 'upstream-unreachable', data: { clientOrderId: 'fake-client-id' } } });
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('응답 헤더 뒤 본문 수신 실패도 전송 오류로 돌려준다: 시간 초과 %s', async (timeout) => {
    const f = await fixture();
    f.fetchImpl.mockImplementationOnce(async (_url, init) => new Response(new ReadableStream({
      start(controller) {
        if (timeout) init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason));
        else controller.error(new TypeError('가짜 본문 연결 끊김'));
      },
    }), { status: 200 }));
    const res = await f.handler(request());
    expect(res.status).toBe(timeout ? 504 : 502);
    expect(await res.json()).toEqual({ error: {
      code: timeout ? 'upstream-timeout' : 'upstream-unreachable', data: { clientOrderId: 'fake-client-id' },
    } });
    const lines = (await readFile(f.cfg.auditLog, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    expect(lines.at(-1)).toMatchObject({ event: 'result', clientOrderId: 'fake-client-id', status: timeout ? 504 : 502 });
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('로그에는 주문 숫자와 결과만 남기고 기존 권한도 600으로 고친다', async () => {
    const f = await fixture();
    await chmod(f.cfg.auditLog, 0o644);
    const restarted = createOrderHandler(f.cfg, f.deps);
    await restarted.ready;
    await restarted.handler(request());
    const raw = await readFile(f.cfg.auditLog, 'utf8');
    const lines = raw.trim().split('\n').map((line) => JSON.parse(line));
    expect(lines.map((line) => line.event)).toEqual(['send', 'result']);
    expect(lines[0]).toMatchObject({ ts: '2026-11-12T10:00:00.000+09:00', day: '2026-11-12', clientOrderId: 'fake-client-id', ...body, amount: 99 });
    for (const secret of Object.values(headers)) expect(raw).not.toContain(secret);
    expect(raw).not.toMatch(/authorization|accountSeq|x-proxy-token/);
    expect((await stat(f.cfg.auditLog)).mode & 0o777).toBe(0o600);
  });

  it('send 로그를 못 쓰면 503이고 상류 호출은 없다', async () => {
    const f = await fixture();
    vi.spyOn(fs, 'appendFile').mockRejectedValueOnce(new Error('가짜 쓰기 실패'));
    const res = await f.handler(request());
    expect(res.status).toBe(503);
    expect(await code(res)).toBe('order-audit-failed');
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it('상류 호출 전에 send 줄을 끝까지 쓴다', async () => {
    const f = await fixture();
    f.fetchImpl.mockImplementationOnce(async () => {
      const lines = (await readFile(f.cfg.auditLog, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
      expect(lines).toMatchObject([{ event: 'send', clientOrderId: 'fake-client-id', amount: 99 }]);
      return new Response('{"result":{"orderId":"one"}}');
    });
    expect((await f.handler(request())).status).toBe(200);
  });

  it.each(['{"result":{}}', '{'])('깨진 성공 본문 %s는 성공으로 돌려주지 않고 결과를 찾을 ID를 남긴다', async (payload) => {
    const f = await fixture();
    f.fetchImpl.mockResolvedValueOnce(new Response(payload));
    const res = await f.handler(request());
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: { data: { clientOrderId: 'fake-client-id' } } });
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('결과 로그 쓰기가 실패해도 주문 응답을 돌려준다', async () => {
    const f = await fixture();
    const original = fs.appendFile;
    vi.spyOn(fs, 'appendFile').mockImplementationOnce(original).mockRejectedValueOnce(new Error('가짜 결과 쓰기 실패'));
    expect((await f.handler(request())).status).toBe(200);
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each(['broken', '[]', 'null', '{"event":"send","quantity":1,"price":99,"amount":98,"ts":"2026-11-12T01:00:00Z"}',
    '{"event":"send","quantity":1,"price":99,"amount":99,"ts":"bad"}',
    '{"event":"send","quantity":1,"price":99,"amount":99,"ts":"2026-11-12T01:00:00Z","day":"2026-11-11"}',
    '{"event":"send","quantity":1,"price":99,"amount":99,"ts":"2026-11-13T01:00:00Z"}'])('깨진 로그 %s가 있으면 꺼지고 줄 번호를 남긴다', async (line) => {
    const f = await fixture();
    await appendFile(f.cfg.auditLog, '{}\n' + line + '\n');
    const restarted = createOrderHandler(f.cfg, f.deps);
    await restarted.ready;
    expect(await code(await restarted.handler(request()))).toBe('order-disabled');
    expect(f.cfg.disabledReason).toContain('2');
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it('로그를 만들 수 없으면 꺼진다', async () => {
    const f = await fixture();
    const cfg = { ...f.cfg, auditLog: join(f.cfg.auditLog, 'impossible') };
    const broken = createOrderHandler(cfg, f.deps);
    await broken.ready;
    expect(await code(await broken.handler(request()))).toBe('order-disabled');
    expect(cfg.disabledReason).toBeTruthy();
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it('재시작하면 오늘 금액과 최근 60초 제한을 복원하고 창 밖이면 해제한다', async () => {
    const f = await fixture({ maxPerMinute: 1 });
    await f.handler(request());
    const restored = createOrderHandler(f.cfg, f.deps);
    await restored.ready;
    expect((await (await restored.handler(new Request('https://proxy.example/order/status'))).json()).usedToday).toEqual({ count: 1, amount: 99 });
    expect(await code(await restored.handler(request()))).toBe('order-rate-limited');
    f.clock.now += 60_000;
    expect((await restored.handler(request())).status).toBe(200);
    expect(f.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])('KST 자정에는 오늘 합계만 비우고 최근 분당 제한은 유지한다: 재시작 %s', async (restart) => {
    const f = await fixture({ maxPerMinute: 1 }, Date.parse('2026-11-12T23:59:59+09:00'));
    await f.handler(request());
    f.clock.now += 2000;
    const next = restart ? createOrderHandler(f.cfg, f.deps) : f;
    await next.ready;
    expect((await (await next.handler(new Request('https://proxy.example/order/status'))).json()).usedToday).toEqual({ count: 0, amount: 0 });
    expect(await code(await next.handler(request()))).toBe('order-rate-limited');
    f.clock.now += 60_000;
    expect((await next.handler(request())).status).toBe(200);
  });

  it('오늘 금액을 더하면 안전한 정수 범위를 넘는 경우 일일 한도로 거절한다', async () => {
    const f = await fixture({ maxAmount: Number.MAX_SAFE_INTEGER });
    await appendFile(f.cfg.auditLog, JSON.stringify({ event: 'send', quantity: 1, price: Number.MAX_SAFE_INTEGER, amount: Number.MAX_SAFE_INTEGER, ts: '2026-11-12T00:00:00+09:00' }) + '\n');
    const restored = createOrderHandler(f.cfg, f.deps);
    await restored.ready;
    expect(await code(await restored.handler(request()))).toBe('order-daily-limit');
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it('복원 합계가 안전한 정수 범위를 넘으면 꺼진다', async () => {
    const f = await fixture();
    const line = JSON.stringify({ event: 'send', quantity: 1, price: Number.MAX_SAFE_INTEGER, amount: Number.MAX_SAFE_INTEGER, ts: '2026-11-12T00:00:00+09:00' });
    await appendFile(f.cfg.auditLog, `${line}\n${line}\n`);
    const restored = createOrderHandler(f.cfg, f.deps);
    await restored.ready;
    expect(await code(await restored.handler(request()))).toBe('order-disabled');
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it('마지막 줄에 개행이 없어도 다음 감사 기록과 붙지 않는다', async () => {
    const f = await fixture();
    await writeFile(f.cfg.auditLog, JSON.stringify({ event: 'result', status: 200 }));
    const restored = createOrderHandler(f.cfg, f.deps);
    await restored.ready;
    expect((await restored.handler(request())).status).toBe(200);
    const again = createOrderHandler(f.cfg, f.deps);
    await again.ready;
    expect((await (await again.handler(new Request('https://proxy.example/order/status'))).json()).enabled).toBe(true);
  });

  it('다른 주문 경로와 잘못된 메서드는 거절한다', async () => {
    const f = await fixture();
    expect((await f.handler(new Request('https://proxy.example/order/other'))).status).toBe(404);
    expect((await f.handler(new Request('https://proxy.example/order/toss'))).status).toBe(405);
    expect((await f.handler(new Request('https://proxy.example/order/status', { method: 'POST' }))).status).toBe(405);
  });
});
