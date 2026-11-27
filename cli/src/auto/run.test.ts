import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { fullStrategyV2 } from '../../../src/lib/sim/testStrategyV2';
import { TEMPLATES } from '../../../src/lib/sim/templates';
import { addDays, kstDate, kstEpoch } from '../../../src/lib/time/kst';
import { parseArgv } from '../args';
import type { Ctx } from '../context';
import { CliError } from '../errors';
import { createRedactor } from '../output';
import { cleanupDirs, fakeFetch, makeIo } from '../testing';
import * as signals from '../signals';
import { ledgerPath, readLedger, writeLedger, type AutoPosition } from './ledger';
import { runAuto } from './run';

afterEach(() => { vi.restoreAllMocks(); cleanupDirs(); });
const today = '2026-11-13';
function fixture(o: { live?: boolean; price?: number; held?: number; error?: string; time?: string; closed?: boolean; unknown?: boolean; failSymbol?: string; statusError?: boolean; total?: number | null; used?: number } = {}) {
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
    if (c.url.pathname.includes('/index/KOSPI') && o.statusError) return { status: 500 };
    if (o.failSymbol && c.url.pathname.includes(`/item/${o.failSymbol}/`)) return { status: 500 };
    if (c.url.pathname.includes('/index/KOSPI')) return { body: o.unknown ? { datas: [] } : { datas: [{ marketStatus: o.closed ? 'CLOSE' : 'OPEN' }] } };
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
      return error ? { status: error === 'toss-token-failed' ? 502 : error === 'order-rate-limited' ? 429 : 400, body: { error: { code: error } } }
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
it('당일 포지션을 15:09에는 유지하고 판정 직전 15:10이 되면 전량 청산한다', async () => {
  const t = fixture({ time: '15:09:00' });
  t.ctx.env.AUTO_DAY_CLOSE_AT = '15:10';
  t.seed({ boughtAt: today });

  const beforeClose = await t.run();
  expect(beforeClose.sells).toEqual([]);
  expect(beforeClose.notes).toContain('당일 청산 모드: 15:10부터 모두 팔아요');
  expect(t.ledger().positions[0].qty).toBe(100);

  t.afterProfile(() => { t.ctx.now = () => kstEpoch(today, '15:10:00'); });
  const atClose = await t.run();
  expect(atClose.sells).toMatchObject([{ symbol: '005930', quantity: 100, reason: '장 마감 전 청산', result: 'dry' }]);
  expect(atClose.notes).toContain('당일 청산 모드: 15:10부터 모두 팔아요');
  expect(t.ledger().positions).toEqual([]);
  expect(posts(t)).toEqual([]);
});

it.each(['15:10:00', '15:11:00'])('당일 청산을 켜면 %s에는 매수 조건을 충족해도 사지 않는다', async (time) => {
  const t = fixture({ time });
  t.ctx.env.AUTO_DAY_CLOSE_AT = '15:10';
  expect((await t.run()).buys).toEqual([]);
  expect(t.ledger().positions).toEqual([]);
});

it.each(['09:30:00', '15:11:00'])('%s에도 전날 포지션은 전날 청산 사유로 전량 판다', async (time) => {
  const t = fixture({ time });
  t.ctx.env.AUTO_DAY_CLOSE_AT = '15:10';
  t.seed();
  expect((await t.run()).sells).toMatchObject([{ symbol: '005930', quantity: 100, reason: '전날 남은 포지션 청산', result: 'dry' }]);
  expect(t.ledger().positions).toEqual([]);
});

it('당일 청산을 켜도 프리셋 원장은 마감 시각에 청산하지 않는다', async () => {
  const t = fixture({ time: '15:10:00' });
  t.ctx.env.AUTO_DAY_CLOSE_AT = '15:10';
  t.ctx.env.AUTO_DRY_PRESETS = 'all';
  t.seed({ boughtAt: today });
  const path = ledgerPath(t.dir, 'dry', 'rebound');
  const ledger = t.ledger();
  ledger.strategyId = 'preset-rebound';
  writeLedger(path, ledger);

  const result = await t.run();
  expect(result.sells).toMatchObject([{ reason: '장 마감 전 청산' }]);
  expect(result.presets.find((p) => p.id === 'preset-rebound')).toMatchObject({ sells: [] });
  expect(readLedger(path, today).positions[0].qty).toBe(100);
});

it('마감 청산은 토스에서 관측한 40주를 팔고 보유가 그대로면 다시 보내지 않는다', async () => {
  const t = fixture({ live: true, held: 40, time: '15:10:00' });
  t.ctx.env.AUTO_DAY_CLOSE_AT = '15:10';
  t.seed({ boughtAt: today });

  expect((await t.run()).sells).toMatchObject([{ symbol: '005930', quantity: 40, reason: '장 마감 전 청산', result: 'sent' }]);
  expect(posts(t)[0].body).toMatchObject({ side: 'SELL', quantity: 40 });

  t.ctx.now = () => kstEpoch(today, '15:11:00');
  expect((await t.run()).sells).toEqual([]);
  expect(posts(t)).toHaveLength(1);
  expect(t.ledger().positions[0].pendingSell).toMatchObject({ qty: 40, qtyBefore: 40 });
});

it('마감 청산 매도 뒤 당일 매수가 더 체결돼도 매도가 체결되면 남은 주식을 다시 판다', async () => {
  const t = fixture({ live: true, held: 40, time: '15:10:00' });
  t.ctx.env.AUTO_DAY_CLOSE_AT = '15:10';
  t.seed({ boughtAt: today });
  await t.run();
  t.held(70); t.ctx.now = () => kstEpoch(today, '15:11:00');
  await t.run();
  expect(posts(t)).toHaveLength(1);
  t.held(30); t.ctx.now = () => kstEpoch(today, '15:12:00');
  await t.run();
  expect(posts(t)).toHaveLength(2);
  expect(posts(t)[1].body).toMatchObject({ side: 'SELL', quantity: 30 });
});

it('장 상태가 닫혔으면 원장·시세·주문에 접근하지 않는다', async () => {
  const t = fixture({ closed: true });
  expect((await t.run()).skipped).toBe('closed');
  expect(t.f.calls).toHaveLength(1);
});
it('장 상태를 읽지 못하면 주문 없이 건너뛰고 하루 한 번 알린다', async () => {
  const t = fixture({ live: true, unknown: true });
  expect((await t.run()).skipped).toBe('unknown');
  await t.run();
  expect(posts(t)).toHaveLength(0);
  expect(alerts(t)).toHaveLength(1);
  expect(alerts(t)[0].body).toMatchObject({ title: '장 상태 확인 불가' });
});
it('실전 매수 전에 불명 원장을 저장하고 접수 뒤 확정한다', async () => {
  const t = fixture({ live: true });
  t.beforeSend(() => expect(JSON.parse(readFileSync(t.path, 'utf8')).positions[0].unconfirmed).toBe(true));
  expect((await t.run()).buys[0].result).toBe('sent');
  expect(t.ledger().positions[0]).toMatchObject({ orderId: '시험주문', qty: 99 });
  expect(t.ledger().positions[0].unconfirmed).toBeUndefined();
});
it.each(['order-rate-limited', 'order-busy', 'toss-token-failed', 'order-upstream', 'order-unknown'])('실전 매수 오류 %s의 재시도 규칙을 지킨다', async (error) => {
  const t = fixture({ live: true, error });
  await t.run();
  const retry = ['order-rate-limited', 'order-busy', 'toss-token-failed'].includes(error);
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
it.each(['order-rate-limited', 'order-busy', 'toss-token-failed', 'order-unknown'])('실전 매도 오류 %s의 재시도 규칙을 지킨다', async (error) => {
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
it('매도를 보낸 지 분 단위로 10분이 지나면 초가 모자라도 안 팔렸다고 알린다', async () => {
  const t = fixture({ live: true, held: 100, price: 1150, time: '15:20:02' });
  t.seed({ pendingSell: { date: today, sentAt: kstEpoch(today, '15:10:05'), qty: 10, qtyBefore: 100, price: 1100, reason: '장 마감 전 청산' } });
  await t.run();
  expect(alerts(t)).toHaveLength(1);
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

it('오류를 알린 뒤 처음 정상으로 끝난 실행에서 한 번만 정상 알림을 보낸다', async () => {
  const t = fixture({ time: '09:30:00' });
  t.afterProfile(() => { throw new CliError('network'); });
  await expect(t.run()).rejects.toMatchObject({ code: 'network' });
  await expect(t.run()).rejects.toMatchObject({ code: 'network' });
  expect(alerts(t).map((c) => (c.body as { title: string }).title)).toEqual(['[연습] 자동 실행 오류']);
  t.afterProfile(() => {});
  await t.run();
  await t.run();
  const titles = alerts(t).map((c) => (c.body as { title: string }).title);
  expect(titles.filter((x) => x === '[연습] 자동 실행 정상')).toHaveLength(1);
  expect(titles.at(-1)).not.toBe('[연습] 자동 실행 오류');
  expect(t.ledger().notified).not.toContain(`${today}:recover`);
});


it('프리셋 원장(템플릿마다 하나)은 독립적이고 주 전략 원장·알림은 꺼짐과 같다', async () => {
  const off = fixture(), on = fixture();
  on.ctx.env.AUTO_DRY_PRESETS = 'all';
  await off.run();
  const result = await on.run();
  expect(result.presets).toHaveLength(TEMPLATES.length);
  expect(on.ledger()).toEqual(off.ledger());
  expect(alerts(on)).toHaveLength(alerts(off).length);
  for (const t of TEMPLATES) {
    const path = ledgerPath(on.dir, 'dry', t.id);
    expect(readLedger(path, today)).toMatchObject({ strategyId: `preset-${t.id}`, today: { judgedDate: today } });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  }
  expect(on.f.calls.filter((c) => c.url.pathname.includes('/item/') && c.url.pathname.endsWith('/day'))).toHaveLength(1);
});
it('프리셋 거래는 원장에만 기록하고 알리지 않는다', async () => {
  const t = fixture();
  t.ctx.env.AUTO_DRY_PRESETS = 'all';
  const path = ledgerPath(t.dir, 'dry', 'rebound');
  t.seed();
  const ledger = t.ledger();
  ledger.strategyId = 'preset-rebound';
  ledger.positions[0].buyPrice = 500;
  writeLedger(path, ledger);
  const result = await t.run();
  expect(result.presets.find((p) => p.id === 'preset-rebound')?.sells).toHaveLength(1);
  expect(readLedger(path, today).today.trades).toMatchObject([{ side: 'SELL', symbol: '005930', name: '시험 종목' }]);
  expect(alerts(t)).toHaveLength(0);
});
it('손상된 프리셋만 건너뛰고 실전에서는 프리셋 원장을 만들지 않는다', async () => {
  const t = fixture();
  t.ctx.env.AUTO_DRY_PRESETS = 'all';
  const path = ledgerPath(t.dir, 'dry', 'rebound');
  writeFileSync(path, '{');
  const result = await t.run();
  expect(result.buys).toHaveLength(1);
  expect(result.presets[0]).toMatchObject({ error: 'invalid-args' });
  expect(result.presets.slice(1).every((p) => !p.error)).toBe(true);
  expect(readFileSync(path, 'utf8')).toBe('{');
  const live = fixture({ live: true });
  live.ctx.env.AUTO_DRY_PRESETS = 'all';
  expect((await live.run()).presets).toEqual([]);
  expect(live.ledger().today.judgedDate).toBeUndefined();
  expect(live.ledger().today.trades).toBeUndefined();
  for (const t of TEMPLATES) expect(existsSync(ledgerPath(live.dir, 'dry', t.id))).toBe(false);
});
it.each([false, true])('프리셋 전용 조회 실패는 격리하고 기존 회복 알림을 유지한다: %s', async (recover) => {
  const t = fixture({ failSymbol: '000660' });
  t.ctx.env.AUTO_DRY_PRESETS = 'all';
  t.seed();
  const main = t.ledger();
  if (recover) main.notified.push(`${today}:recover`, `${today}:network`);
  writeLedger(t.path, main);
  const paths = ['rebound', 'ma200'].map((id) => ledgerPath(t.dir, 'dry', id));
  const originals = paths.map((path, i) => {
    const ledger = structuredClone(main);
    ledger.strategyId = `preset-${['rebound', 'ma200'][i]}`;
    ledger.positions[0].symbol = '000660';
    writeLedger(path, ledger);
    return readFileSync(path, 'utf8');
  });
  const result = await t.run();
  expect(result.presets.slice(0, 2).every((p) => p.error === 'internal')).toBe(true);
  expect(result.presets.slice(2).every((p) => !p.error)).toBe(true);
  expect(paths.map((path) => readFileSync(path, 'utf8'))).toEqual(originals);
  expect(t.f.calls.filter((c) => c.url.pathname.includes('/item/000660/'))).toHaveLength(1);
  expect(alerts(t)).toHaveLength(recover ? 1 : 0);
  if (recover) expect(alerts(t)[0].body).toMatchObject({ title: '[연습] 자동 실행 정상' });
  expect(t.ledger().notified).toEqual(recover ? [`${today}:network`] : []);
});
it('주 전략에도 필요한 일봉 조회 실패는 전체 오류이며 판정 표식을 새로 만들지 않는다', async () => {
  const t = fixture({ failSymbol: '005930' });
  t.ctx.env.AUTO_DRY_PRESETS = 'all';
  await expect(t.run()).rejects.toThrow();
  expect(t.ledger().today.judgedDate).toBeUndefined();
  expect(alerts(t)).toHaveLength(1);
});
it('거래 없는 판정도 표시하되 준비 오류는 표시하지 않고 기존 당일 표식은 보존한다', async () => {
  const t = fixture({ time: '15:15:00' });
  await t.run();
  expect(t.ledger().today).toMatchObject({ judgedDate: today, bought: [], sold: [] });
  t.afterProfile(() => { throw new CliError('network'); });
  await expect(t.run()).rejects.toThrow();
  expect(t.ledger().today.judgedDate).toBe(today);
  for (const broken of [fixture({ statusError: true }), fixture()]) {
    broken.afterProfile(() => { throw new CliError('network'); });
    await expect(broken.run()).rejects.toThrow();
    expect(broken.ledger().today.judgedDate).toBeUndefined();
  }
  const config = fixture();
  config.ctx.env.AUTO_MODE = '오타';
  await expect(config.run()).rejects.toThrow();
  expect(config.ledger().today.judgedDate).toBeUndefined();
});

it('공유 조회의 긴 이력은 전략·종목별로 잘라 판정하고 프리셋 매수는 알리지 않는다', async () => {
  const t = fixture();
  t.ctx.env.AUTO_DRY_PRESETS = 'all';
  t.seed();
  const old = t.ledger();
  old.strategyId = 'preset-rebound';
  old.positions[0].symbol = '000660';
  old.positions[0].boughtAt = '2020-01-01';
  writeLedger(ledgerPath(t.dir, 'dry', 'rebound'), old);
  const days = [{ localDate: '20200101', openPrice: 700, closePrice: 700 },
    ...Array.from({ length: 220 }, (_, i) => ({ localDate: addDays(today, i - 219).replaceAll('-', ''), openPrice: 800 + i, closePrice: 800 + i }))];
  const originalFetch = t.ctx.fetch;
  const quotes = fakeFetch((c) => ({ body: days.filter((b) => b.localDate >= c.url.searchParams.get('startDateTime')!.slice(0, 8)) }));
  t.ctx.fetch = (input, init) => String(input).includes('/chart/domestic/item/') ? quotes(input, init) : originalFetch(input, init);
  const evaluate = vi.spyOn(signals, 'evaluateAt');
  const result = await t.run();
  const mainInput = evaluate.mock.calls.find(([, groups]) => groups === t.strategy.rules.buy)![0];
  expect(kstDate(mainInput[0].t)).toBe(addDays(today, -219));
  expect(mainInput).toHaveLength(220);
  // 주 전략 매수 다음은 반등 프리셋의 관심 종목 판정이다. 다른 종목의 오래된 보유를 섞지 않는다.
  expect(evaluate.mock.calls[1][0]).toHaveLength(220);
  expect(quotes.calls).toHaveLength(2);
  expect(quotes.calls.every((c) => c.url.searchParams.get('startDateTime') === '202001010000')).toBe(true);
  expect(result.presets.find((p) => p.id === 'preset-ma200')?.buys).toHaveLength(1);
  expect(readLedger(ledgerPath(t.dir, 'dry', 'ma200'), today).today.trades).toMatchObject([{ side: 'BUY', symbol: '005930', name: '시험 종목' }]);
  expect(alerts(t)).toHaveLength(0);
});
