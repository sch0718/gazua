import { describe, expect, it, vi } from 'vitest';
import type { Candle } from '../../src/lib/data/metrics';
import type { Venue } from '../../src/lib/market/tradable';
import type { Trade } from '../../src/lib/perf/types';
import type { AccountOrder, AccountSource, CandleQuery, MarketDataProvider } from '../../src/lib/providers/types';
import { ApiError } from '../../src/lib/providers/errors';
import { normalizeOrders } from '../../src/lib/perf/ledger';
import { createRuleEvaluator } from '../../src/lib/sim/rules';
import { barsFromCloses, tradingDates } from '../../src/lib/sim/testBars';
import { fullStrategyV2 } from '../../src/lib/sim/testStrategyV2';
import type { Cond, CondGroup, Strategy } from '../../src/lib/sim/types';
import { addDays, kstDate, kstEpoch, kstWeekday } from '../../src/lib/time/kst';
import { CLOSE_MINUTE, evaluateAt, firstBuyOf, judgeHolding, matchesHolding, NOTES, pickVenue, runSignals, tradesInFillOrder, usableCandles, warmFrom, windowEnd } from './signals';

const MA_ABOVE: Cond = { kind: 'maPrice', period: 3, side: 'above' };
const MA_BELOW: Cond = { kind: 'maPrice', period: 3, side: 'below' };
const group = (...conds: Cond[]): CondGroup => ({ conds });

/** 매수: 3일선 위, 조건 매도: 3일선 아래. 나머지 매도 규칙은 fullStrategyV2 그대로(손절 7% 평단·익절 10/20%·트레일 10%·20일 청산) */
function strat(over: (s: Strategy) => void = () => {}): Strategy {
  const s = fullStrategyV2();
  s.rules.buy = [group(MA_ABOVE)];
  s.rules.sell.signal = { on: true, groups: [group(MA_BELOW)] };
  over(s);
  return s;
}

const weekdayCalendar = (from: string, to: string, closed: string[] = []) => {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push({ date: d, isOpen: kstWeekday(d) !== 0 && kstWeekday(d) !== 6 && !closed.includes(d) });
  return out;
};

function stub(o: { venues?: Venue[]; candles: Record<string, Candle[] | Error>; closed?: string[]; account?: Partial<AccountSource> }): MarketDataProvider {
  return {
    id: 'toss',
    capabilities: { venues: o.venues ?? ['UNIFIED'], quoteBatchSize: 200, hasIndexCandles: true, indexMinutePastDays: true },
    async getCandles(q: CandleQuery) {
      const c = o.candles[q.symbol];
      if (c instanceof Error) throw c;
      return (c ?? []).filter((x) => kstDate(x.t) >= q.from && kstDate(x.t) <= q.to);
    },
    async getTradingDays(from: string, to: string) {
      return weekdayCalendar(from, to, o.closed);
    },
    ...(o.account ? { account: o.account as AccountSource } : {}),
  } as unknown as MarketDataProvider;
}

// 2026-10-26(월) ~ 2026-11-02(월) 일봉. 11-02는 오늘 봉
const DAYS = tradingDates('2026-10-26', 6); // 10-26 27 28 29 30, 11-02
const CLOSES_UP = [10, 10, 10, 10, 10, 12]; // 마지막 봉이 3일선 위
const CLOSES_DOWN = [10, 10, 10, 10, 10, 8]; // 마지막 봉이 3일선 아래

describe('windowEnd: venue별 마감 시각', () => {
  const at = (date: string, hhmm: string) => kstEpoch(date, `${hhmm}:00`);
  it('마감 시각 상수', () => {
    expect(CLOSE_MINUTE).toEqual({ KRX: 15 * 60 + 30, NXT: 20 * 60, UNIFIED: 20 * 60 });
  });

  it.each<[Venue, string, boolean, boolean, string, boolean]>([
    // venue, 시각, --today, 오늘이 거래일, 기대 to, 기대 includesToday
    ['KRX', '15:29', true, true, '2026-11-01', false],
    ['KRX', '15:30', true, true, '2026-11-02', true],
    ['KRX', '15:30', false, true, '2026-11-01', false],
    ['UNIFIED', '15:30', true, true, '2026-11-01', false],
    ['UNIFIED', '19:59', true, true, '2026-11-01', false],
    ['UNIFIED', '20:00', true, true, '2026-11-02', true],
    ['UNIFIED', '20:00', false, true, '2026-11-01', false],
    ['UNIFIED', '20:00', true, false, '2026-11-01', false], // 휴장일이면 --today여도 오늘 포함 안 함
    ['NXT', '19:59', true, true, '2026-11-01', false],
  ])('%s %s today=%s open=%s → %s %s', (venue, hhmm, today, openToday, to, includesToday) => {
    expect(windowEnd({ now: at('2026-11-02', hhmm), today, venue, openToday })).toEqual({ to, includesToday });
  });
});

describe('pickVenue·warmFrom·usableCandles', () => {
  it('venue는 비었거나 KRX가 있으면 KRX, 아니면 첫 venue(loadSimData와 같다)', () => {
    const p = (venues: Venue[]) => ({ capabilities: { venues } }) as MarketDataProvider;
    expect(pickVenue(p([]))).toBe('KRX');
    expect(pickVenue(p(['KRX', 'NXT', 'UNIFIED']))).toBe('KRX');
    expect(pickVenue(p(['UNIFIED']))).toBe('UNIFIED');
  });

  it('워밍업은 max(400, ceil(lookback×1.6))일 전', () => {
    expect(warmFrom('2026-10-30', strat())).toBe(addDays('2026-10-30', -400));
    const rsi = strat((s) => (s.rules.buy = [group({ kind: 'rsi', period: 14, level: 30, op: 'crossUp' })])); // lookback 251 → 402일
    expect(warmFrom('2026-10-30', rsi)).toBe(addDays('2026-10-30', -402));
  });

  it('유효하지 않은 봉과 to 뒤의 봉을 빼고 시간순으로 돌려준다', () => {
    const bars = barsFromCloses([10, 11, 12, 13], '2026-10-26');
    const bad: Candle = { ...bars[1], c: 0 };
    const out = usableCandles([bars[3], bars[0], bad, bars[2]], '2026-10-28');
    expect(out.map((c) => kstDate(c.t))).toEqual(['2026-10-26', '2026-10-28']);
  });
});

describe('evaluateAt: 엔진과 같은 판정', () => {
  const closes = Array.from({ length: 320 }, (_, i) => Math.round(1000 + 120 * Math.sin(i / 7) + i * 0.5));
  const candles = barsFromCloses(closes, '2025-01-02');
  const groups = [group({ kind: 'rsi', period: 14, level: 50, op: 'above' }), group({ kind: 'maCross', short: 5, long: 20, dir: 'golden' }), group(MA_ABOVE, { kind: 'change', days: 5, pct: 1, op: 'above' })];

  it('firstDayIdx는 기준 봉이다: 같은 평가기를 앞 봉부터 signal→update로 돌린 결과와 모든 봉에서 같다', () => {
    for (let idx = 280; idx < 320; idx++) {
      const ev = createRuleEvaluator(candles, groups, idx);
      let last = null as ReturnType<typeof ev.signal>;
      for (let i = 0; i <= idx; i++) {
        last = ev.signal(i);
        ev.update(i);
      }
      const got = evaluateAt(candles, groups, idx);
      expect(got.match).toBe(last !== null);
      if (last) expect(got).toEqual({ match: true, reason: last.reason, group: last.group });
      else expect(got).toEqual({ match: false });
    }
  });

  it('맞은 묶음 번호와 사유를 낸다', () => {
    const c = barsFromCloses([10, 10, 10, 12], '2026-10-26');
    expect(evaluateAt(c, [group(MA_BELOW), group(MA_ABOVE)], 3)).toEqual({ match: true, reason: '종가 3일선 위', group: 2 });
    expect(evaluateAt(c, [group(MA_BELOW)], 3)).toEqual({ match: false });
  });
});

describe('보유 종목 매칭과 첫 매수', () => {
  it('ETN은 Q 없는 코드도 같은 종목', () => {
    expect(matchesHolding('005930', '005930')).toBe(true);
    expect(matchesHolding('Q500023', '500023')).toBe(true);
    expect(matchesHolding('500023', 'Q500023')).toBe(false);
    expect(matchesHolding('005930', '000660')).toBe(false);
  });

  const t = (side: 'BUY' | 'SELL', date: string, qty: number, price = 100): Trade => ({ orderId: `${side}${date}${qty}`, symbol: '005930', side, date, orderedAt: `${date}T09:00:00+09:00`, qty, price, amount: qty * price, commission: 0, tax: 0 });

  it('수량이 0에서 양수가 된 마지막 날과 그날 첫 매수 체결가', () => {
    expect(firstBuyOf([t('BUY', '2026-08-03', 10, 100), t('SELL', '2026-08-10', 10), t('BUY', '2026-09-02', 5, 110), t('BUY', '2026-09-03', 5, 120)], 10)).toEqual({ date: '2026-09-02', price: 110 });
    expect(firstBuyOf([t('BUY', '2026-09-02', 10, 110), t('BUY', '2026-09-03', 5, 120)], 15)).toEqual({ date: '2026-09-02', price: 110 });
    expect(firstBuyOf([t('BUY', '2026-09-02', 10, 110), t('SELL', '2026-09-05', 3)], 7)).toEqual({ date: '2026-09-02', price: 110 });
  });

  it('같은 날 전량 매도 후 재매수: 체결 시각순으로 읽어 재매수 시점이 첫 매수가 된다', () => {
    const o = (orderId: string, side: 'BUY' | 'SELL', filledAt: string, quantity: number, price: number): AccountOrder => ({ orderId, symbol: '005930', side, status: 'FILLED', currency: 'KRW', orderedAt: filledAt, filledAt, quantity, price, amount: quantity * price, commission: 0, tax: 0 });
    const orders = [
      o('o1', 'BUY', '2026-10-01T09:30:00+09:00', 10, 68000),
      o('o2', 'SELL', '2026-10-30T09:00:00+09:00', 10, 71000),
      o('o3', 'BUY', '2026-10-30T10:00:00+09:00', 10, 70000),
    ];
    expect(tradesInFillOrder(orders).map((t) => t.orderId)).toEqual(['o1', 'o2', 'o3']);
    expect(firstBuyOf(tradesInFillOrder(orders), 10)).toEqual({ date: '2026-10-30', price: 70000 });
    // normalizeOrders만 쓰면 같은 날 매수가 먼저라 첫 매수일이 10-01로 남는다(회귀 확인)
    expect(firstBuyOf(normalizeOrders(orders).trades, 10)).toEqual({ date: '2026-10-01', price: 68000 });
  });

  it('부분 체결이 섞여 순서를 복원할 수 없으면(누적 수량이 음수가 되면) null', () => {
    const o = (orderId: string, side: 'BUY' | 'SELL', filledAt: string, quantity: number): AccountOrder => ({ orderId, symbol: '005930', side, status: 'FILLED', currency: 'KRW', orderedAt: filledAt, filledAt, quantity, price: 100, amount: quantity * 100, commission: 0, tax: 0 });
    // 매수 주문 o1은 09시·11시에 5주씩 체결돼 한 행(10주, filledAt 11시)으로 합쳐진다. 그 사이 10시에 14주를 팔았다 — 실제로는 9 + 5 − 14 + 5 = 5주를 계속 들고 있다
    const orders = [o('o0', 'BUY', '2026-10-01T09:30:00+09:00', 9), o('o1', 'BUY', '2026-10-30T11:00:00+09:00', 10), o('o2', 'SELL', '2026-10-30T10:00:00+09:00', 14)];
    expect(tradesInFillOrder(orders).map((t) => t.orderId)).toEqual(['o0', 'o2', 'o1']);
    expect(firstBuyOf(tradesInFillOrder(orders), 5)).toBeNull(); // 9 − 14 < 0
  });

  it('이력이 모자라면(끝 수량이 보유 수량과 다르면) null', () => {
    expect(firstBuyOf([t('BUY', '2026-09-03', 5)], 10)).toBeNull();
    expect(firstBuyOf([], 10)).toBeNull();
    expect(firstBuyOf([t('BUY', '2026-09-02', 10), t('SELL', '2026-09-05', 10)], 10)).toBeNull();
  });
});

describe('judgeHolding: 스펙 §7.2의 계산', () => {
  const base = { strategy: strat(), symbol: '005930', quantity: 10, avgPrice: 68500 as number | undefined, close: 71200, asOf: '2026-10-30', first: { date: '2026-09-02', price: 68000 } as { date: string; price: number } | null, peakClose: 78300 as number | null, heldDays: 42 as number | null, signalSell: { match: false } };

  it('예시 수치: 손절 63,705 · 익절 75,350/82,200 · 트레일 70,470 · 20일 청산 도달', () => {
    expect(judgeHolding(base)).toEqual({
      symbol: '005930',
      quantity: 10,
      avgPrice: 68500,
      close: 71200,
      firstBuyDate: '2026-09-02',
      stop: { price: 63705, hit: false },
      takes: [{ stage: 1, price: 75350, hit: false }, { stage: 2, price: 82200, hit: false }],
      stagesDoneUnknown: true,
      trail: { price: 70470, hit: false },
      timeExit: { heldDays: 42, days: 20, hit: true },
      breakeven: { price: 68500, hit: 'unknown' },
      signalSell: { match: false },
    });
  });

  it('종가 ≤ 손절·트레일이면 도달, ≥ 익절이면 도달(같으면 도달)', () => {
    expect(judgeHolding({ ...base, close: 63705 }).stop).toEqual({ price: 63705, hit: true });
    expect(judgeHolding({ ...base, close: 63706 }).stop?.hit).toBe(false);
    expect(judgeHolding({ ...base, close: 70470 }).trail?.hit).toBe(true);
    const r = judgeHolding({ ...base, close: 76000 });
    expect(r.takes.map((x) => x.hit)).toEqual([true, false]);
    expect(judgeHolding({ ...base, close: 75350 }).takes[0].hit).toBe(true);
  });

  it('트레일 기준은 첫 매수일부터의 종가 최고값과 첫 매수가 중 큰 값', () => {
    expect(judgeHolding({ ...base, peakClose: 60000 }).trail?.price).toBe(61200); // 68000 × 0.9
    expect(judgeHolding({ ...base, peakClose: null }).trail).toEqual({ price: null, hit: 'unknown' }); // 최고값을 모르면 unknown
  });

  it('평단을 모르면 평단 기준 가격은 모두 unknown', () => {
    const r = judgeHolding({ ...base, avgPrice: undefined });
    expect(r.avgPrice).toBeNull();
    expect(r.stop).toEqual({ price: null, hit: 'unknown' });
    expect(r.takes).toEqual([{ stage: 1, price: null, hit: 'unknown' }, { stage: 2, price: null, hit: 'unknown' }]);
    expect(r.breakeven).toEqual({ price: null, hit: 'unknown' });
    expect(r.trail?.price).toBe(70470); // 트레일은 평단이 필요 없다
  });

  it('첫 매수일을 모르면 트레일·기간 청산은 unknown, firstBuy 기준 손절도 unknown', () => {
    const r = judgeHolding({ ...base, first: null, peakClose: null, heldDays: null });
    expect(r.firstBuyDate).toBeNull();
    expect(r.trail).toEqual({ price: null, hit: 'unknown' });
    expect(r.timeExit).toEqual({ heldDays: null, days: 20, hit: 'unknown' });
    const fb = judgeHolding({ ...base, first: null, strategy: strat((s) => (s.rules.sell.stopLoss.basis = 'firstBuy')) });
    expect(fb.stop).toEqual({ price: null, hit: 'unknown' });
    const fb2 = judgeHolding({ ...base, strategy: strat((s) => (s.rules.sell.stopLoss.basis = 'firstBuy')) });
    expect(fb2.stop).toEqual({ price: 63240, hit: false }); // 68000 × 0.93
  });

  it('꺼진 규칙은 null·빈 목록, 본전 손절은 익절이 꺼지면 없다', () => {
    const off = strat((s) => {
      s.rules.sell.stopLoss.on = false;
      s.rules.sell.takeProfit.on = false;
      s.rules.sell.trailing.on = false;
      s.rules.sell.timeExit.on = false;
      s.rules.sell.signal.on = false;
    });
    const r = judgeHolding({ ...base, strategy: off, signalSell: null });
    expect(r).toMatchObject({ stop: null, takes: [], stagesDoneUnknown: false, trail: null, timeExit: null, signalSell: null });
    expect('breakeven' in r).toBe(false);
    const keep = strat((s) => (s.rules.sell.takeProfit.afterFirstTake = 'keep'));
    expect('breakeven' in judgeHolding({ ...base, strategy: keep })).toBe(false);
  });
});

describe('runSignals', () => {
  const NOW = kstEpoch('2026-11-02', '12:00:00'); // 월요일 낮: KRX도 통합도 마감 전

  it('기준 봉은 어제까지의 마지막 완성 일봉, 종목별 매수·매도 판정과 notes', async () => {
    const provider = stub({ venues: ['KRX', 'NXT', 'UNIFIED'], candles: { '005930': barsFromCloses(CLOSES_UP, '2026-10-26'), '000660': barsFromCloses(CLOSES_DOWN, '2026-10-26') } });
    const out = await runSignals({ provider, strategy: strat(), symbols: ['005930', '000660'], now: NOW, today: false });
    expect(out).toEqual({
      strategy: '골든크로스 추세',
      asOf: '2026-10-30',
      includesToday: false,
      venue: 'KRX',
      signals: [
        { symbol: '005930', buy: { match: false }, sell: { match: false } },
        { symbol: '000660', buy: { match: false }, sell: { match: false } },
      ],
      failed: [],
      notes: [...NOTES.base, NOTES.tossOnly],
    });
  });

  it('--today는 마감 뒤에만 오늘 봉을 쓴다(통합은 20:00)', async () => {
    const provider = stub({ candles: { '005930': barsFromCloses(CLOSES_UP, '2026-10-26'), '000660': barsFromCloses(CLOSES_DOWN, '2026-10-26') } });
    const run = (hhmm: string, today = true) => runSignals({ provider, strategy: strat(), symbols: ['005930', '000660'], now: kstEpoch('2026-11-02', `${hhmm}:00`), today });
    const before = await run('15:31');
    expect([before.asOf, before.includesToday, before.venue]).toEqual(['2026-10-30', false, 'UNIFIED']);
    const after = await run('20:01');
    expect([after.asOf, after.includesToday]).toEqual(['2026-11-02', true]);
    expect(after.signals).toEqual([
      { symbol: '005930', buy: { match: true, reason: '종가 3일선 위', group: 1 }, sell: { match: false } },
      { symbol: '000660', buy: { match: false }, sell: { match: true, reason: '종가 3일선 아래', group: 1 } },
    ]);
    const noFlag = await run('20:01', false);
    expect([noFlag.asOf, noFlag.includesToday]).toEqual(['2026-10-30', false]);
  });

  it('KRX는 15:30에 마감: 15:30부터 오늘 봉', async () => {
    const provider = stub({ venues: ['KRX'], candles: { '005930': barsFromCloses(CLOSES_UP, '2026-10-26') } });
    const run = (hhmm: string) => runSignals({ provider, strategy: strat(), symbols: ['005930'], now: kstEpoch('2026-11-02', `${hhmm}:00`), today: true });
    expect((await run('15:29')).includesToday).toBe(false);
    expect((await run('15:30')).includesToday).toBe(true);
  });

  it('오늘이 휴장일이면 --today여도 마지막 거래일이 기준', async () => {
    const provider = stub({ candles: { '005930': barsFromCloses(CLOSES_UP, '2026-10-26') }, closed: ['2026-11-02'] });
    const out = await runSignals({ provider, strategy: strat(), symbols: ['005930'], now: kstEpoch('2026-11-02', '21:00:00'), today: true });
    expect([out.asOf, out.includesToday]).toEqual(['2026-10-30', false]);
  });

  it('조건 매도가 꺼져 있으면 sell은 null', async () => {
    const provider = stub({ candles: { '005930': barsFromCloses(CLOSES_UP, '2026-10-26') } });
    const out = await runSignals({ provider, strategy: strat((s) => (s.rules.sell.signal.on = false)), symbols: ['005930'], now: kstEpoch('2026-11-02', '21:00:00'), today: true });
    expect(out.signals[0].sell).toBeNull();
  });

  it('받지 못한 종목은 failed로, 기준 봉이 다른 종목은 자기 asOf를 단다. 모두 실패하면 첫 오류를 던진다', async () => {
    const provider = stub({ candles: { '005930': barsFromCloses(CLOSES_UP, '2026-10-26'), '000660': new ApiError('timeout'), '035420': [], '051910': barsFromCloses([10, 10, 10, 12], '2026-10-26') } });
    const out = await runSignals({ provider, strategy: strat(), symbols: ['005930', '000660', '035420', '051910'], now: kstEpoch('2026-11-02', '21:00:00'), today: true });
    expect(out.failed).toEqual([{ symbol: '000660', reason: '받지 못했어요' }, { symbol: '035420', reason: '데이터가 없어요' }]);
    expect(out.signals.map((s) => [s.symbol, s.asOf])).toEqual([['005930', undefined], ['051910', '2026-10-29']]);
    const allBad = stub({ candles: { '005930': new ApiError('proxy-unreachable'), '000660': new ApiError('proxy-unreachable') } });
    await expect(runSignals({ provider: allBad, strategy: strat(), symbols: ['005930', '000660'], now: NOW, today: false })).rejects.toMatchObject({ code: 'proxy-unreachable' });
  });

  it('종목이 없으면 빈 결과와 notes', async () => {
    const out = await runSignals({ provider: stub({ candles: {} }), strategy: strat(), symbols: [], now: NOW, today: false });
    expect(out).toMatchObject({ asOf: null, signals: [], notes: expect.arrayContaining([NOTES.noSymbols]) });
  });

  describe('내 보유 기준 매도 판정(토스)', () => {
    // 2026-09-01부터 거래일 분량의 봉. 마지막(10-30) 종가 71,200, 그 전 최고 종가 78,300
    const dates = tradingDates('2026-09-01', 44); // ... 2026-10-30
    const closes = dates.map((_, i) => 70000 + (i % 5) * 100);
    closes[10] = 78300;
    closes[closes.length - 1] = 71200;
    const candles = barsFromCloses(closes, '2026-09-01');
    const order = (over: Partial<AccountOrder> = {}): AccountOrder => ({ orderId: 'o1', symbol: '005930', side: 'BUY', status: 'FILLED', currency: 'KRW', orderedAt: '2026-09-02T09:30:00+09:00', filledAt: '2026-09-02T09:30:05+09:00', quantity: 10, price: 68000, amount: 680000, commission: 0, tax: 0, ...over });
    const account = (holdings: { symbol: string; name: string; quantity: number; avgPrice?: number }[]): Partial<AccountSource> => ({ holdings: async () => holdings });

    it('보유 종목마다 평단·첫 매수일·보유일수·손절/익절/트레일/기간 청산을 계산한다', async () => {
      const provider = stub({ candles: { '005930': candles }, account: account([{ symbol: '005930', name: '삼성전자', quantity: 10, avgPrice: 68500 }]) });
      const out = await runSignals({ provider, strategy: strat(), symbols: ['005930'], now: NOW, today: false, loadOrders: async () => [order()] });
      const heldDays = 21; // 기간 청산 판정에 필요한 N+1 거래일까지만 센다
      expect(out.holdings).toEqual([
        {
          symbol: '005930',
          quantity: 10,
          avgPrice: 68500,
          close: 71200,
          firstBuyDate: '2026-09-02',
          stop: { price: 63705, hit: false },
          takes: [{ stage: 1, price: 75350, hit: false }, { stage: 2, price: 82200, hit: false }],
          stagesDoneUnknown: true,
          trail: { price: 70470, hit: false },
          timeExit: { heldDays, days: 20, hit: true },
          breakeven: { price: 68500, hit: 'unknown' },
          signalSell: { match: false },
        },
      ]);
      expect(out.notes).toEqual([...NOTES.base, NOTES.breakeven]);
    });

    it.each([80, 120])('오늘 100에 샀지만 기준 봉이 어제 종가 %i이면 보유 기준 판정은 모두 unknown', async (close) => {
      const provider = stub({ candles: { '005930': barsFromCloses([100, 100, close], '2026-10-29') }, account: account([{ symbol: '005930', name: '삼성전자', quantity: 10, avgPrice: 100 }]) });
      const calendar = vi.spyOn(provider, 'getTradingDays');
      const recent = order({ orderedAt: '2026-11-03T09:30:00+09:00', filledAt: '2026-11-03T09:30:05+09:00', price: 100, amount: 1000 });
      const out = await runSignals({ provider, strategy: strat(), symbols: ['005930'], now: kstEpoch('2026-11-03', '12:00:00'), today: false, loadOrders: async () => [recent] });
      expect(out.asOf).toBe('2026-11-02');
      expect(out.holdings?.[0]).toMatchObject({
        close,
        firstBuyDate: '2026-11-03',
        stop: { hit: 'unknown' },
        takes: [{ stage: 1, hit: 'unknown' }, { stage: 2, hit: 'unknown' }],
        trail: { price: null, hit: 'unknown' },
        timeExit: { heldDays: null, days: 20, hit: 'unknown' },
      });
      expect(out.notes).toContain('005930: 첫 매수일(2026-11-03)이 기준 봉 날짜(2026-11-02)보다 뒤라 보유 기준 판정을 unknown으로 두었어요');
      expect(calendar).not.toHaveBeenCalled();
    });

    it.each([80, 120])('첫 매수일이 기준 봉 날짜와 같으면 종가 %i로 정상 판정한다', async (close) => {
      const provider = stub({ candles: { '005930': barsFromCloses([100, 100, close], '2026-10-29') }, account: account([{ symbol: '005930', name: '삼성전자', quantity: 10, avgPrice: 100 }]) });
      const recent = order({ orderedAt: '2026-11-02T09:30:00+09:00', filledAt: '2026-11-02T09:30:05+09:00', price: 100, amount: 1000 });
      const out = await runSignals({ provider, strategy: strat(), symbols: ['005930'], now: kstEpoch('2026-11-03', '12:00:00'), today: false, loadOrders: async () => [recent] });
      expect(out.holdings?.[0]).toMatchObject({
        firstBuyDate: '2026-11-02',
        stop: { price: 93, hit: close <= 93 },
        takes: [{ stage: 1, price: 110, hit: close >= 110 }, { stage: 2, price: 120, hit: close >= 120 }],
        trail: { price: Math.max(100, close) * 0.9, hit: close === 80 },
        timeExit: { heldDays: 1, days: 20, hit: false },
      });
      expect(out.notes).toEqual([...NOTES.base, NOTES.breakeven]);
    });

    it('기간 청산이 꺼져 있으면 보유 거래일 달력을 조회하지 않는다', async () => {
      const provider = stub({ candles: { '005930': candles }, account: account([{ symbol: '005930', name: '삼성전자', quantity: 10, avgPrice: 68500 }]) });
      const calendar = vi.spyOn(provider, 'getTradingDays').mockRejectedValue(new ApiError('upstream'));
      const out = await runSignals({ provider, strategy: strat((s) => (s.rules.sell.timeExit.on = false)), symbols: ['005930'], now: NOW, today: false, loadOrders: async () => [order()] });
      expect(calendar).not.toHaveBeenCalled();
      expect(out.holdings?.[0]).toMatchObject({ timeExit: null, stop: { price: 63705, hit: false } });
    });

    it('N이 500보다 커도 각 달력 요청은 한도 안에 나누고 N+1 거래일에서 멈춘다', async () => {
      const provider = stub({ candles: { '005930': candles }, account: account([{ symbol: '005930', name: '삼성전자', quantity: 10, avgPrice: 68500 }]) });
      const calendar = vi.spyOn(provider, 'getTradingDays').mockImplementation(async (from, to) => {
        const days = weekdayCalendar(from, to);
        if (days.filter((d) => d.isOpen).length > 500) throw new ApiError('upstream');
        return days;
      });
      const old = order({ orderedAt: '2024-01-02T09:30:00+09:00', filledAt: '2024-01-02T09:30:05+09:00' });
      const out = await runSignals({ provider, strategy: strat((s) => (s.rules.sell.timeExit.days = 600)), symbols: ['005930'], now: NOW, today: false, loadOrders: async () => [old] });
      expect(out.holdings?.[0].timeExit).toEqual({ heldDays: 601, days: 600, hit: true });
      expect(calendar.mock.calls.length).toBeGreaterThan(1);
      expect(calendar.mock.calls.every(([from, to]) => weekdayCalendar(from, to).length <= 365)).toBe(true);
      expect(calendar.mock.calls.at(-1)![1] < '2026-10-30').toBe(true);
    });

    it.each([4, 5, 20])('휴장일은 빼고 거래정지로 봉이 없는 거래일도 세어 %i일 청산을 판정한다', async (days) => {
      const provider = stub({ candles: { '005930': candles.filter((c) => kstDate(c.t) !== '2026-10-29') }, closed: ['2026-10-28'], account: account([{ symbol: '005930', name: '삼성전자', quantity: 10, avgPrice: 68500 }]) });
      const recent = order({ orderedAt: '2026-10-26T09:30:00+09:00', filledAt: '2026-10-26T09:30:05+09:00' });
      const out = await runSignals({ provider, strategy: strat((s) => (s.rules.sell.timeExit.days = days)), symbols: ['005930'], now: NOW, today: false, loadOrders: async () => [recent] });
      expect(out.holdings?.[0].timeExit).toEqual({ heldDays: 4, days, hit: days <= 4 });
    });

    it.each(['error', 'incomplete'] as const)('달력 %s 시 해당 종목의 기간 청산만 unknown이고 다음 종목은 판정한다', async (failure) => {
      const provider = stub({ candles: { '005930': candles, '000660': candles }, account: account([
        { symbol: '005930', name: '삼성전자', quantity: 10, avgPrice: 68500 },
        { symbol: '000660', name: 'SK하이닉스', quantity: 10, avgPrice: 68500 },
      ]) });
      vi.spyOn(provider, 'getTradingDays').mockImplementation(async (from, to) => {
        if (from === '2026-09-02') {
          if (failure === 'error') throw new ApiError('upstream');
          return weekdayCalendar(from, to).slice(1);
        }
        return weekdayCalendar(from, to);
      });
      const out = await runSignals({ provider, strategy: strat(), symbols: ['005930', '000660'], now: NOW, today: false, loadOrders: async () => [order(), order({ orderId: 'o2', symbol: '000660', orderedAt: '2026-10-29T09:30:00+09:00', filledAt: '2026-10-29T09:30:05+09:00' })] });
      expect(out.signals).toHaveLength(2);
      expect(out.failed).toEqual([]);
      expect(out.holdings?.[0]).toMatchObject({ timeExit: { heldDays: null, days: 20, hit: 'unknown' }, stop: { price: 63705, hit: false }, trail: { price: 70470, hit: false } });
      expect(out.holdings?.[1].timeExit).toEqual({ heldDays: 2, days: 20, hit: false });
    });

    it('주문 이력이 모자라면 첫 매수일에 의존하는 항목은 unknown', async () => {
      const provider = stub({ candles: { '005930': candles }, account: account([{ symbol: '005930', name: '삼성전자', quantity: 10, avgPrice: 68500 }]) });
      const out = await runSignals({ provider, strategy: strat(), symbols: ['005930'], now: NOW, today: false, loadOrders: async () => [order({ quantity: 4 })] });
      expect(out.holdings?.[0]).toMatchObject({ firstBuyDate: null, trail: { price: null, hit: 'unknown' }, timeExit: { heldDays: null, days: 20, hit: 'unknown' }, stop: { price: 63705, hit: false } });
    });

    describe('첫 매수일이 받아 둔 조회 범위보다 앞일 때(트레일 최고가)', () => {
      const longDates = tradingDates('2024-01-02', 800).filter((d) => d <= '2026-10-30');
      const longCloses = longDates.map((_, i) => 70000 + (i % 5) * 100);
      longCloses[40] = 90000; // 첫 매수 직후의 최고 종가
      longCloses[longCloses.length - 1] = 71200;
      const old = order({ orderedAt: '2024-01-02T09:30:00+09:00', filledAt: '2024-01-02T09:30:05+09:00', price: 68000 });
      const held = account([{ symbol: '005930', name: '삼성전자', quantity: 10, avgPrice: 68500 }]);
      const recording = (c: Candle[]) => {
        const froms: string[] = [];
        const p = stub({ candles: { '005930': c }, account: held });
        const orig = p.getCandles.bind(p);
        p.getCandles = async (q: CandleQuery) => {
          froms.push(q.from);
          return orig(q);
        };
        return { p, froms };
      };

      it('부족한 봉을 첫 매수일부터 더 받아 그 구간의 최고 종가로 트레일을 계산한다', async () => {
        const { p, froms } = recording(barsFromCloses(longCloses, '2024-01-02'));
        const out = await runSignals({ provider: p, strategy: strat(), symbols: ['005930'], now: NOW, today: false, loadOrders: async () => [old] });
        expect(froms).toHaveLength(2);
        expect(froms[1]).toBe('2024-01-02');
        expect(out.holdings?.[0]).toMatchObject({ firstBuyDate: '2024-01-02', trail: { price: 81000, hit: true } }); // 90000 × 0.9, 종가 71,200 ≤ 81,000
      });

      it('첫 매수일 근처부터 봉을 확보하지 못하면 트레일은 unknown', async () => {
        const short = barsFromCloses(longCloses.slice(-100), longDates[longDates.length - 100]);
        const { p } = recording(short);
        const out = await runSignals({ provider: p, strategy: strat(), symbols: ['005930'], now: NOW, today: false, loadOrders: async () => [old] });
        expect(out.holdings?.[0].trail).toEqual({ price: null, hit: 'unknown' });
        expect(out.holdings?.[0].stop?.price).toBe(63705); // 다른 항목은 그대로
      });

      it('더 받는 요청이 실패해도 트레일만 unknown', async () => {
        const { p } = recording(barsFromCloses(longCloses, '2024-01-02'));
        const orig = p.getCandles.bind(p);
        let n = 0;
        p.getCandles = async (q: CandleQuery) => {
          if (++n === 2) throw new ApiError('timeout');
          return orig(q);
        };
        const out = await runSignals({ provider: p, strategy: strat(), symbols: ['005930'], now: NOW, today: false, loadOrders: async () => [old] });
        expect(out.holdings?.[0].trail).toEqual({ price: null, hit: 'unknown' });
      });
    });

    it('같은 날 전량 매도 후 재매수한 종목은 재매수일이 첫 매수일이다', async () => {
      const provider = stub({ candles: { '005930': candles }, account: account([{ symbol: '005930', name: '삼성전자', quantity: 10, avgPrice: 70000 }]) });
      const orders = [
        order({ orderId: 'a1' }),
        order({ orderId: 'a2', side: 'SELL', orderedAt: '2026-10-29T09:00:00+09:00', filledAt: '2026-10-29T09:00:05+09:00', price: 71000, amount: 710000 }),
        order({ orderId: 'a3', orderedAt: '2026-10-29T10:00:00+09:00', filledAt: '2026-10-29T10:00:05+09:00', price: 70000, amount: 700000 }),
      ];
      const out = await runSignals({ provider, strategy: strat((s) => (s.rules.sell.stopLoss.basis = 'firstBuy')), symbols: ['005930'], now: NOW, today: false, loadOrders: async () => orders });
      expect(out.holdings?.[0]).toMatchObject({ firstBuyDate: '2026-10-29', stop: { price: 65100, hit: false } }); // 재매수가 70,000 × 0.93
    });

    it('ETN은 전략의 Q코드와 토스의 6자리 코드를 같은 종목으로 본다', async () => {
      const provider = stub({ candles: { Q500023: candles }, account: account([{ symbol: '500023', name: 'ETN', quantity: 10, avgPrice: 68500 }]) });
      const out = await runSignals({ provider, strategy: strat(), symbols: ['Q500023'], now: NOW, today: false, loadOrders: async () => [order({ symbol: '500023' })] });
      expect(out.holdings).toHaveLength(1);
      expect(out.holdings?.[0]).toMatchObject({ symbol: 'Q500023', firstBuyDate: '2026-09-02' });
    });

    it('전략 종목 중 들고 있는 것이 없으면 holdings는 빈 목록(주문 이력을 받지 않는다)', async () => {
      let loaded = false;
      const provider = stub({ candles: { '005930': candles }, account: account([]) });
      const out = await runSignals({ provider, strategy: strat(), symbols: ['005930'], now: NOW, today: false, loadOrders: async () => ((loaded = true), []) });
      expect(out.holdings).toEqual([]);
      expect(loaded).toBe(false);
    });

    it('조건 매도가 켜져 있으면 signalSell에 조건 매도 평가 결과를 넣는다', async () => {
      const down = barsFromCloses([...closes.slice(0, -1), 60000], '2026-09-01');
      const provider = stub({ candles: { '005930': down }, account: account([{ symbol: '005930', name: '삼성전자', quantity: 10, avgPrice: 68500 }]) });
      const out = await runSignals({ provider, strategy: strat(), symbols: ['005930'], now: NOW, today: false, loadOrders: async () => [order()] });
      expect(out.holdings?.[0].signalSell).toEqual({ match: true, reason: '종가 3일선 아래', group: 1 });
      expect(out.holdings?.[0].stop?.hit).toBe(true);
    });

    it('분할 매수 후 평단 기준 손절은 평단으로 계산했다고 notes에 적는다', async () => {
      const provider = stub({ candles: { '005930': candles }, account: account([{ symbol: '005930', name: '삼성전자', quantity: 10, avgPrice: 68500 }]) });
      const s = strat((x) => {
        x.rules.sell.stopLoss.basis = 'avgAfterScaleIn';
        x.rules.sell.takeProfit.afterFirstTake = 'keep';
      });
      const out = await runSignals({ provider, strategy: s, symbols: ['005930'], now: NOW, today: false, loadOrders: async () => [order()] });
      expect(out.notes).toEqual([...NOTES.base, NOTES.avgAfterScaleIn]);
    });
  });

  it('보유 기준 판정은 토스만: account가 없으면 holdings를 빼고 notes에 적는다', async () => {
    const provider = stub({ venues: ['KRX'], candles: { '005930': barsFromCloses(CLOSES_UP, '2026-10-26') } });
    const out = await runSignals({ provider, strategy: strat(), symbols: ['005930'], now: NOW, today: false });
    expect('holdings' in out).toBe(false);
    expect(out.notes).toContain(NOTES.tossOnly);
  });
});
