import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { fullStrategyV2 } from '../../../src/lib/sim/testStrategyV2';
import { kstEpoch } from '../../../src/lib/time/kst';
import { parseArgv } from '../args';
import type { Ctx } from '../context';
import { createRedactor } from '../output';
import { cleanupDirs, fakeFetch, makeIo } from '../testing';
import { ledgerPath, readLedger, writeLedger, type AutoPosition } from './ledger';
import { runAuto } from './run';

afterEach(cleanupDirs);
const today = '2026-11-13';
function fixture(o: { live?: boolean; price?: number; held?: number; error?: string; time?: string; closed?: boolean; total?: number | null; used?: number } = {}) {
  const strategy = fullStrategyV2();
  strategy.rules.buy = [{ conds: [{ kind: 'maPrice', period: 2, side: 'above' }] }];
  strategy.rules.sell.signal.on = false;
  strategy.rules.sell.timeExit.on = false;
  strategy.rules.sell.trailing.on = false;
  strategy.capital.initial = 100_000;
  strategy.sizing = { mode: 'cashPct', pct: 100 };
  let held = o.held ?? 0;
  let error = o.error;
  let onProfile: (() => void) | undefined;
  let atSend: (() => void) | undefined;
  const f = fakeFetch((c) => {
    if (c.url.pathname.includes('/index/KOSPI')) return { body: { datas: [{ marketStatus: o.closed ? 'CLOSE' : 'OPEN' }] } };
    if (c.url.pathname.includes('/chart/domestic/item/')) return { body: [
      { localDate: '20261111', openPrice: 800, closePrice: 800 },
      { localDate: '20261112', openPrice: 850, closePrice: 850 },
      { localDate: '20261113', openPrice: 900, closePrice: o.price ?? 1000 },
    ] };
    if (c.url.pathname.endsWith('/basic')) return { body: { stockName: '시험 종목' } };
    if (c.url.pathname === '/holdings') return { body: held ? [{ symbol: '005930', quantity: held, avgPrice: 990, name: '시험 종목' }] : [] };
    if (c.url.pathname === '/order/status') return { body: { enabled: true, stopped: false, maxAmount: null, dailyMaxAmount: null, totalMaxAmount: o.total === undefined ? 1_000_000 : o.total, invested: 0, maxPerMinute: 3, maxPerDay: 20, usedToday: { count: o.used ?? 0, amount: 0 } } };
    if (c.url.pathname === '/order/toss') {
      atSend?.();
      return error ? { status: error === 'order-rate-limited' ? 429 : 400, body: { error: { code: error } } }
        : { body: { ok: true, orderId: '시험주문', clientOrderId: '시험요청', amount: 1000 } };
    }
    if (c.url.hostname === 'ntfy.example') return { body: {} };
  });
  const t = makeIo({ fetch: f, now: kstEpoch(today, o.time ?? '11:00:00'), env: {
    AUTO_STRATEGY: strategy.id, AUTO_MODE: o.live ? 'live' : 'dry', GAZUA_ALERT_NTFY_TOPIC: '시험용가짜토픽',
    GAZUA_ALERT_NTFY_SERVER: 'https://ntfy.example', GAZUA_PROXY_URL: 'https://proxy.example',
    GAZUA_PROXY_TOKEN: 'fake-proxy-token', GAZUA_PROXY_ORIGIN: 'https://app.example',
  } });
  const ctx: Ctx = { ...t.io, args: parseArgv(['auto']), dir: t.dir, redact: createRedactor(), say: () => {}, log: () => {}, warn: () => {} };
  const path = ledgerPath(t.dir, o.live ? 'live' : 'dry');
  const deps = {
    loadProfile: async () => (onProfile?.(), { id: 'p', name: '시험', revision: 1, watchlists: { groups: [{ id: 'g0', name: '시험', items: [{ symbol: '005930', colorSlot: 1 as const, hidden: false, addedAt: 1 }] }] }, strategies: [strategy] }),
    tossAccount: async () => ({ credentials: { authorization: 'fake-authorization', 'x-tossinvest-account': 'fake-account' }, account: {
      holdings: async () => (await f('https://toss.example/holdings')).json(),
      accountId: async () => '', closedOrders: async () => [],
    } }),
  };
  const ledger = () => readLedger(path, today);
  const seed = (p: Partial<AutoPosition> = {}) => writeLedger(path, { version: 1, strategyId: strategy.id,
    today: { date: today, bought: [], sold: [] }, notified: [], positions: [{ symbol: '005930', boughtAt: '2026-11-12', buyPrice: 1000, boughtQty: 100, qty: 100, peak: 1000, sells: [], ...p }] });
  return { ...t, ctx, f, path, strategy, ledger, seed, run: () => runAuto(ctx, deps),
    afterProfile: (fn: () => void) => { onProfile = fn; },
    held: (n: number) => { held = n; }, error: (s?: string) => { error = s; }, beforeSend: (fn: () => void) => { atSend = fn; } };
}
const posts = (t: ReturnType<typeof fixture>) => t.f.calls.filter((c) => c.url.pathname === '/order/toss');
const alerts = (t: ReturnType<typeof fixture>) => t.f.calls.filter((c) => c.url.hostname === 'ntfy.example');

it('연습은 원장과 사실 알림만 남기며 같은 날 다시 사지 않는다', async () => {
  const t = fixture();
  expect(await t.run()).toMatchObject({ mode: 'dry', strategy: t.strategy.name, skipped: null,
    buys: [{ symbol: '005930', quantity: 99, price: 1010, result: 'dry' }], sells: [], skippedSymbols: [],
    notes: expect.arrayContaining([expect.stringContaining('거래대금'), expect.stringContaining('처음 자금')]) });
  expect(t.f.calls.some((c) => c.url.hostname === 'proxy.example' || c.url.hostname === 'toss.example')).toBe(false);
  expect(alerts(t)[0].body).toMatchObject({ title: expect.stringContaining('[연습]'), message: expect.stringMatching(/투자 조언 아님$/) });
  await t.run();
  expect(alerts(t)).toHaveLength(1);
});
it.each(['15:15:00', '15:20:00'])('%s 이후 매수는 없다', async (time) => {
  const t = fixture({ time });
  expect((await t.run()).buys).toHaveLength(0);
});
it('장 상태가 닫혔으면 원장·시세·주문에 접근하지 않는다', async () => {
  const t = fixture({ closed: true });
  expect((await t.run()).skipped).toBe('closed');
  expect(t.f.calls).toHaveLength(1);
});
it('실전 매수 전에 불명 원장을 저장하고 접수 뒤 확정한다', async () => {
  const t = fixture({ live: true });
  t.beforeSend(() => expect(JSON.parse(readFileSync(t.path, 'utf8')).positions[0].unconfirmed).toBe(true));
  expect((await t.run()).buys[0].result).toBe('sent');
  expect(t.ledger().positions[0]).toMatchObject({ orderId: '시험주문', qty: 99 });
  expect(t.ledger().positions[0].unconfirmed).toBeUndefined();
});
it.each(['order-rate-limited', 'order-busy', 'order-upstream', 'order-unknown'])('실전 매수 오류 %s의 재시도 규칙을 지킨다', async (error) => {
  const t = fixture({ live: true, error });
  await t.run();
  const retry = ['order-rate-limited', 'order-busy'].includes(error);
  expect(t.ledger().today.bought.includes('005930')).toBe(!retry);
  expect(t.ledger().positions.length).toBe(error === 'order-unknown' ? 1 : 0);
  if (error === 'order-unknown') expect(t.ledger().positions[0].unconfirmed).toBe(true);
  t.error();
  await t.run();
  expect(posts(t)).toHaveLength(retry ? 2 : 1);
});
it('하루 주문 건수 한도를 다 쓰면 주문하지 않고 하루 한 번 알린다', async () => {
  const t = fixture({ live: true, used: 20 });
  await t.run(); await t.run();
  expect(posts(t)).toHaveLength(0);
  expect(alerts(t)).toHaveLength(1);
});
it('총 가용 금액 설정이 없으면 매수하지 않고 하루 한 번 알린다', async () => {
  const t = fixture({ live: true, total: null });
  await t.run(); await t.run();
  expect(posts(t)).toHaveLength(0);
  expect(alerts(t)).toHaveLength(1);
});
it('전날 부분 매수는 실제 보유를 기준으로 단계 익절 수량을 정한다', async () => {
  const t = fixture({ live: true, held: 60, price: 1150 });
  t.seed();
  t.beforeSend(() => expect(JSON.parse(readFileSync(t.path, 'utf8')).positions[0].pendingSell.qty).toBe(30));
  await t.run();
  expect(posts(t)[0].body).toMatchObject({ side: 'SELL', quantity: 30 });
  expect(t.ledger().positions[0]).toMatchObject({ qty: 60, boughtQty: 60, pendingSell: { qty: 30 } });
  await t.run();
  expect(posts(t)).toHaveLength(1);
  t.held(50); await t.run();
  expect(t.ledger().positions[0]).toMatchObject({ qty: 50, sells: [{ qty: 10, stage: 1 }], pendingSell: { qty: 30 } });
  t.held(30); await t.run();
  expect(t.ledger().positions[0]).toMatchObject({ qty: 30, sells: [{ qty: 10, stage: 1 }, { qty: 20, stage: 1 }] });
  expect(t.ledger().positions[0].pendingSell).toBeUndefined();
  expect(posts(t)).toHaveLength(1);
});
it.each([today, '2026-11-12'])('토스 보유 0이면 팔지 않고 %s 매수 원장의 보존 규칙을 따른다', async (boughtAt) => {
  const t = fixture({ live: true, price: 800 });
  t.seed({ boughtAt });
  await t.run();
  expect(posts(t)).toHaveLength(0);
  expect(t.ledger().positions).toHaveLength(boughtAt === today ? 1 : 0);
});
it('매도 거절은 그날 막고 오류 알림을 반복하지 않는다', async () => {
  const t = fixture({ live: true, price: 900, held: 100, error: 'order-upstream' });
  t.seed(); await t.run(); await t.run();
  expect(posts(t)).toHaveLength(1);
  expect(t.ledger().positions[0]).toMatchObject({ sellBlocked: today });
  expect(t.ledger().positions[0].pendingSell).toBeUndefined();
  expect(alerts(t)).toHaveLength(1);
});
it('토스 보유가 원장보다 많으면(직접 산 주식) 자동 매도하지 않고 하루 한 번 알린다', async () => {
  const t = fixture({ live: true, price: 900, held: 110 });
  t.seed(); await t.run(); await t.run();
  expect(posts(t)).toHaveLength(0);
  expect(t.ledger().positions[0]).toMatchObject({ qty: 100 });
  expect(t.ledger().positions[0].pendingSell).toBeUndefined();
  expect(alerts(t)).toHaveLength(1);
});
it('전날 포지션을 전량 매도한 날 같은 종목을 재매수하지 않는다', async () => {
  const t = fixture({ price: 1300 });
  t.seed();
  const r = await t.run();
  expect(r.sells).toHaveLength(1);
  expect(r.buys).toHaveLength(0);
  expect(t.ledger().positions).toHaveLength(0);
});
it('포지션이 있는데 다른 전략을 고르면 멈추고 같은 오류는 하루 한 번 알린다', async () => {
  const t = fixture(); t.seed(); t.strategy.id = '다른전략'; t.ctx.env.AUTO_STRATEGY = t.strategy.id;
  await expect(t.run()).rejects.toMatchObject({ code: 'invalid-args' });
  await expect(t.run()).rejects.toMatchObject({ code: 'invalid-args' });
  expect(alerts(t)).toHaveLength(1);
  expect(posts(t)).toHaveLength(0);
});
it('손상 원장을 빈 원장으로 덮어쓰지 않는다', async () => {
  const t = fixture(); writeFileSync(t.path, '{');
  await expect(t.run()).rejects.toMatchObject({ code: 'invalid-args' });
  expect(readFileSync(t.path, 'utf8')).toBe('{');
  expect(alerts(t)).toHaveLength(1);
});
it('설정 오류도 읽을 수 있는 원장에 하루 한 번만 기록한다', async () => {
  const t = fixture();
  t.ctx.env.AUTO_MODE = '오타';
  await expect(t.run()).rejects.toMatchObject({ code: 'invalid-args' });
  await expect(t.run()).rejects.toMatchObject({ code: 'invalid-args' });
  expect(alerts(t)).toHaveLength(1);
});
it.each(['order-rate-limited', 'order-busy', 'order-unknown'])('실전 매도 오류 %s의 재시도 규칙을 지킨다', async (error) => {
  const t = fixture({ live: true, held: 100, price: 800, error });
  t.seed(); await t.run();
  const retry = error !== 'order-unknown';
  expect(!!t.ledger().positions[0].pendingSell).toBe(!retry);
  expect(t.ledger().today.sold.includes('005930')).toBe(!retry);
  t.error(); await t.run();
  expect(posts(t)).toHaveLength(retry ? 2 : 1);
});
it('매도 미체결 경고는 한 번이고 전날 만료한 부분 체결은 단계 기록을 남긴다', async () => {
  const t = fixture({ live: true, held: 50, price: 1150 });
  t.seed({ qty: 50, sells: [{ qty: 50, stage: 1 }], pendingSell: {
    date: '2026-11-12', sentAt: kstEpoch('2026-11-12', '14:00:00'), qty: 50, qtyBefore: 100, price: 1100, reason: '1단계 익절', stage: 1,
  } });
  await t.run();
  expect(t.ledger().positions[0].pendingSell).toBeUndefined();
  expect(t.ledger().positions[0].sells).toEqual([{ qty: 50, stage: 1 }]);
  expect(posts(t)).toHaveLength(0);
  const p = t.ledger();
  p.positions[0].pendingSell = { date: today, sentAt: kstEpoch(today, '10:00:00'), qty: 10, qtyBefore: 50, price: 1100, reason: '익절' };
  writeLedger(t.path, p);
  await t.run(); await t.run();
  expect(alerts(t)).toHaveLength(1);
  expect(t.ledger().positions[0].pendingSell?.warned).toBe(true);
});
it('매도 체결을 기다리는 동안에도 추적 손절의 최고 현재가를 기억한다', async () => {
  const t = fixture({ live: true, held: 100, price: 1400 });
  t.seed({ pendingSell: { date: today, sentAt: kstEpoch(today, '10:59:00'), qty: 50, qtyBefore: 100, price: 1300, reason: '익절', stage: 1 } });
  await t.run();
  expect(t.ledger().positions[0].peak).toBe(1400);
  expect(posts(t)).toHaveLength(0);
});

it('주문 전 원장 쓰기가 실패하면 주문을 막고 오류 알림은 시도한다', async () => {
  const t = fixture({ live: true });
  t.afterProfile(() => mkdirSync(t.path));
  await expect(t.run()).rejects.toBeDefined();
  expect(posts(t)).toHaveLength(0);
  expect(alerts(t)).toHaveLength(1);
});
it('다음 매도가 혼잡으로 거절돼도 같은 날 앞서 보낸 매도 기록은 유지한다', async () => {
  const t = fixture({ live: true, held: 50, price: 1300, error: 'order-busy' });
  t.seed({ qty: 50, sells: [{ qty: 50, stage: 1 }] });
  const ledger = t.ledger();
  ledger.today.sold.push('005930');
  writeLedger(t.path, ledger);
  await t.run();
  expect(t.ledger().today.sold).toContain('005930');
  expect(t.ledger().positions[0].pendingSell).toBeUndefined();
  expect(t.ledger().positions[0].sellBlocked).toBeUndefined();
  t.error();
  await t.run();
  expect(posts(t)).toHaveLength(2);
});
