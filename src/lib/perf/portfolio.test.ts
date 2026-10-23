import { describe, expect, it } from 'vitest';
import type { Candle } from '../data/metrics';
import { kstEpoch } from '../time/kst';
import { buildTimeline, splitFactor, splitFactors } from './portfolio';
import { reconcile } from './reconcile';
import { viewOf } from './view';
import type { BenchSeries, StockSeries, Trade } from './types';

const bar = (date: string, c: number, h = c, l = c): Candle => ({ t: kstEpoch(date, '00:00:00'), o: c, h, l, c, v: 1 });
const series = (closes: Record<string, number>): Candle[] => Object.entries(closes).map(([d, c]) => bar(d, c));

let n = 0;
const trade = (over: Partial<Trade>): Trade => {
  const t: Trade = {
    orderId: `o${++n}`,
    symbol: 'A',
    side: 'BUY',
    date: '2026-03-02',
    orderedAt: '2026-03-02T09:00:00+09:00',
    qty: 10,
    price: 100,
    amount: 1000,
    commission: 1,
    tax: 0,
    ...over,
  };
  return t;
};

const STOCK: StockSeries = { name: '에이', candles: series({ '2026-03-02': 100, '2026-03-03': 110, '2026-03-04': 120 }) };
const INDEX: BenchSeries = {
  id: 'KOSPI',
  name: 'KOSPI',
  kind: 'index',
  market: 'KOSPI',
  candles: series({ '2026-03-02': 1000, '2026-03-03': 1050, '2026-03-04': 1100 }),
};
const ETF: BenchSeries = {
  id: '069500',
  name: 'KODEX 200',
  kind: 'etf',
  market: 'KOSPI',
  candles: series({ '2026-03-02': 10000, '2026-03-03': 10500, '2026-03-04': 11000 }),
};

const stocks = (m: Record<string, StockSeries>) => new Map(Object.entries(m));

describe('buildTimeline', () => {
  it('one buy against an index: the same money buys fractional units at the day close, no costs', () => {
    const tl = buildTimeline([trade({})], stocks({ A: STOCK }), () => INDEX);
    expect(tl.days).toEqual(['2026-03-02', '2026-03-03', '2026-03-04']);
    const [t] = tl.tracks;
    expect(t.actual).toEqual([1000, 1100, 1200]);
    expect(t.virtual.map((v) => +v.toFixed(4))).toEqual([1001, 1051.05, 1101.1]);
    expect(t.events.map((e) => [e.i, e.actual, e.virtual])).toEqual([[0, -1001, -1001]]);
    expect(t.bench).toEqual({ id: 'KOSPI', name: 'KOSPI' });
  });

  it('an ETF benchmark pays the real order’s commission rate', () => {
    const tl = buildTimeline([trade({})], stocks({ A: STOCK }), () => ETF);
    // 수수료율 1/1000: 1001 ÷ (10000 × 1.001) = 0.1단위
    expect(tl.tracks[0].virtual.map((v) => +v.toFixed(4))).toEqual([1000, 1050, 1100]);
  });

  it('uses 0.015% for an ETF when the order has no commission', () => {
    const tl = buildTimeline([trade({ commission: 0 })], stocks({ A: STOCK }), () => ETF);
    expect(tl.tracks[0].virtual[0]).toBeCloseTo(1000 / 1.00015, 3);
  });

  it('a partial sell sells the same fraction of the shadow position', () => {
    const tl = buildTimeline(
      [trade({}), trade({ side: 'SELL', date: '2026-03-04', qty: 4, price: 120, amount: 480, commission: 1, tax: 9 })],
      stocks({ A: STOCK }),
      () => INDEX,
    );
    const t = tl.tracks[0];
    expect(t.actual).toEqual([1000, 1100, 720]);
    const sell = t.events[1];
    expect(sell.actual).toBe(470);
    expect(sell.virtual).toBeCloseTo(0.4 * 1.001 * 1100, 6);
    expect(t.virtual[2]).toBeCloseTo(0.6 * 1.001 * 1100, 6);
  });

  it('an ETF sell pays commission at the same rate and ETF sell tax (0)', () => {
    const tl = buildTimeline(
      [trade({}), trade({ side: 'SELL', date: '2026-03-04', qty: 10, price: 120, amount: 1200, commission: 2, tax: 24 })],
      stocks({ A: STOCK }),
      () => ETF,
    );
    const sell = tl.tracks[0].events[1];
    // 매도 주문의 수수료율 2/1200을 쓴다
    expect(sell.virtual).toBeCloseTo(0.1 * 11000 * (1 - 2 / 1200), 6);
    expect(tl.tracks[0].virtual[2]).toBe(0);
  });

  it('an oversell only counts the recorded shares on both sides', () => {
    const tl = buildTimeline(
      [trade({}), trade({ side: 'SELL', date: '2026-03-03', qty: 15, price: 110, amount: 1650, commission: 3, tax: 0 })],
      stocks({ A: STOCK }),
      () => INDEX,
    );
    const t = tl.tracks[0];
    expect(t.events[1].excessQty).toBe(5);
    expect(t.events[1].actual).toBeCloseTo((1650 - 3) * (10 / 15), 6);
    expect(t.events[1].virtual).toBeCloseTo(1.001 * 1050, 6);
    expect(t.actual[1]).toBe(0);
    expect(t.virtual[1]).toBe(0);
    expect(t.excessQty).toBe(5);
  });

  it('a sell with no recorded shares is left out entirely', () => {
    const tl = buildTimeline([trade({ side: 'SELL', qty: 3, amount: 300 })], stocks({ A: STOCK }), () => INDEX);
    const t = tl.tracks[0];
    expect(t.events.map((e) => [e.actual, e.virtual, e.excessQty])).toEqual([[0, 0, 3]]);
  });

  it('a buy and a sell on the same day close out the position', () => {
    const tl = buildTimeline(
      [trade({}), trade({ side: 'SELL', qty: 10, amount: 1010, commission: 1, tax: 2 })],
      stocks({ A: STOCK }),
      () => INDEX,
    );
    const t = tl.tracks[0];
    expect(t.excessQty).toBe(0);
    expect(t.actual).toEqual([0, 0, 0]);
    expect(t.events[1].actual).toBe(1007);
  });

  it('carries the last close over days without a bar (halt or a benchmark-only day)', () => {
    const stock: StockSeries = { name: '에이', candles: series({ '2026-03-02': 100, '2026-03-04': 120 }) };
    const tl = buildTimeline([trade({})], stocks({ A: stock }), () => INDEX);
    expect(tl.days).toEqual(['2026-03-02', '2026-03-03', '2026-03-04']);
    expect(tl.tracks[0].actual).toEqual([1000, 1000, 1200]);
  });

  it('a benchmark that starts later buys at its first close', () => {
    const late: BenchSeries = { ...INDEX, candles: series({ '2026-03-03': 1050, '2026-03-04': 1100 }) };
    const tl = buildTimeline([trade({})], stocks({ A: STOCK }), () => late);
    expect(tl.tracks[0].virtual.map((v) => +v.toFixed(4))).toEqual([1001, 1001, 1001 * (1100 / 1050)].map((v) => +v.toFixed(4)));
    expect(tl.tracks[0].uncompared).toBe(0);
  });

  it('counts trades it cannot compare when there is no benchmark series', () => {
    const empty: BenchSeries = { ...INDEX, candles: [] };
    const tl = buildTimeline([trade({}), trade({ side: 'SELL', date: '2026-03-04', qty: 2, amount: 240 })], stocks({ A: STOCK }), () => empty);
    const t = tl.tracks[0];
    expect(t.events.map((e) => e.virtual)).toEqual([null, null]);
    expect(t.uncompared).toBe(2);
    expect(t.virtual).toEqual([0, 0, 0]);
    expect(buildTimeline([trade({})], stocks({ A: STOCK }), () => null).tracks[0].bench).toBeNull();
  });

  it('adjusts for a later split when the fill price is outside the adjusted bar', () => {
    // 나중에 2:1 분할: 수정 일봉은 100 근처인데 실제로는 200에 샀다
    const stock: StockSeries = { name: '에이', candles: [bar('2026-03-02', 100, 105, 95), bar('2026-03-03', 110)] };
    const tl = buildTimeline([trade({ price: 200, amount: 2000, commission: 0 })], stocks({ A: stock }), () => INDEX);
    const t = tl.tracks[0];
    expect(t.splitAdjusted).toBe(true);
    // 3일째는 지수에만 봉이 있어 직전 종가를 쓴다
    expect(t.actual).toEqual([2000, 2200, 2200]);
  });

  // PR 리뷰: 분할 전에 산 수량과 분할 뒤에 판 수량은 단위가 다르다. 보유는 수정주가 기준 단위로만 센다.
  describe('a sell after a split', () => {
    // 3/2에 200원에 10주(수정 일봉은 100 근처) → 2:1 분할 → 이듬해 110원에 판다
    const split: StockSeries = {
      name: '에이',
      candles: [bar('2025-03-03', 100, 105, 95), bar('2026-03-03', 110, 112, 108)],
    };
    const buy = trade({ date: '2025-03-03', orderedAt: '2025-03-03T09:00:00+09:00', price: 200, amount: 2000, commission: 0 });
    const sell = (qty: number) =>
      trade({ side: 'SELL', date: '2026-03-03', orderedAt: '2026-03-03T09:00:00+09:00', qty, price: 110, amount: 110 * qty, commission: 0 });
    const idx: BenchSeries = { ...INDEX, candles: series({ '2025-03-03': 1000, '2026-03-03': 1100 }) };

    it('selling all 20 post-split shares is a full sell, not an oversell', () => {
      const tl = buildTimeline([buy, sell(20)], stocks({ A: split }), () => idx);
      const t = tl.tracks[0];
      expect(t.excessQty).toBe(0);
      expect(t.events[1].actual).toBe(2200);
      expect(t.actual).toEqual([2000, 0]);
      expect(t.virtual).toEqual([2000, 0]);
      const v = viewOf(tl, 0, 1);
      expect(v.actual.profit).toBe(200);
      expect(v.actual.irr).toBeCloseTo(0.1, 6);
    });

    it('selling 10 of the 20 post-split shares keeps half of both positions', () => {
      const tl = buildTimeline([buy, sell(10)], stocks({ A: split }), () => idx);
      const t = tl.tracks[0];
      expect(t.excessQty).toBe(0);
      expect(t.events[1].actual).toBe(1100);
      expect(t.actual[1]).toBe(1100);
      expect(t.virtual[1]).toBeCloseTo(1100, 6);
    });

    it('an oversell after a split is counted in post-split shares', () => {
      const tl = buildTimeline([buy, sell(25)], stocks({ A: split }), () => idx);
      const t = tl.tracks[0];
      expect(t.excessQty).toBe(5);
      expect(t.events[1].actual).toBe(2200);
    });
  });

  // PR 리뷰: 같은 날 체결은 같은 분할 배율이어야 한다(배율은 그날의 권리 변동이지 체결마다 다르지 않다)
  it('a buy and a sell on the same day before a 50:1 split share one factor', () => {
    const stock: StockSeries = { name: '에이', candles: [bar('2018-04-02', 100, 104, 96), bar('2018-04-03', 101)] };
    const buy = trade({ date: '2018-04-02', orderedAt: '2018-04-02T09:00:00+09:00', qty: 10, price: 5000, amount: 50_000, commission: 0 });
    const sell = trade({ side: 'SELL', date: '2018-04-02', orderedAt: '2018-04-02T14:00:00+09:00', qty: 10, price: 5200, amount: 52_000, commission: 0 });
    const idx: BenchSeries = { ...INDEX, candles: series({ '2018-04-02': 1000, '2018-04-03': 1010 }) };
    const tl = buildTimeline([buy, sell], stocks({ A: stock }), () => idx);
    const t = tl.tracks[0];
    expect(t.excessQty).toBe(0);
    expect(t.events[1].actual).toBe(52_000);
    expect(viewOf(tl, 0, 1).actual.profit).toBe(2_000);
    const factors = splitFactors([buy, sell], stocks({ A: stock }));
    expect([factors.get(buy.orderId), factors.get(sell.orderId)]).toEqual([50, 50]);
    expect(reconcile([buy, sell], [], factors).bySymbol.get(buy.symbol)).toEqual({ status: 'ok', computed: 0, held: 0 });
  });

  // PR 리뷰: 한 번의 분할 전 거래들은 날짜가 달라도 같은 배율이어야 한다(4:1 분할 전 매수·매도가 4와 5로 갈리면 안 된다)
  it('trades on different days before one 4:1 split share one factor', () => {
    const stock: StockSeries = {
      name: '에이',
      candles: [bar('2026-03-02', 100, 102, 98), bar('2026-03-03', 125, 130, 100), bar('2026-03-04', 126)],
    };
    const buy = trade({ date: '2026-03-02', orderedAt: '2026-03-02T09:00:00+09:00', qty: 10, price: 400, amount: 4_000, commission: 0 });
    const sell = trade({ side: 'SELL', date: '2026-03-03', orderedAt: '2026-03-03T09:00:00+09:00', qty: 10, price: 500, amount: 5_000, commission: 0 });
    const idx: BenchSeries = { ...INDEX, candles: series({ '2026-03-02': 1000, '2026-03-03': 1010, '2026-03-04': 1020 }) };
    const tl = buildTimeline([buy, sell], stocks({ A: stock }), () => idx);
    const t = tl.tracks[0];
    expect(t.excessQty).toBe(0);
    expect(t.events[1].actual).toBe(5_000);
    expect(viewOf(tl, 0, 2).actual.profit).toBe(1_000);
    const factors = splitFactors([buy, sell], stocks({ A: stock }));
    expect([factors.get(buy.orderId), factors.get(sell.orderId)]).toEqual([4, 4]);
  });

  it('a split between two trades still gives each side its own factor', () => {
    // 3/2에 2:1 분할 전 200원 매수, 분할 뒤 3/3에 110원 매도
    const stock: StockSeries = { name: '에이', candles: [bar('2026-03-02', 100, 105, 95), bar('2026-03-03', 110, 112, 108)] };
    const buy = trade({ date: '2026-03-02', orderedAt: '2026-03-02T09:00:00+09:00', qty: 10, price: 200, amount: 2_000, commission: 0 });
    const sell = trade({ side: 'SELL', date: '2026-03-03', orderedAt: '2026-03-03T09:00:00+09:00', qty: 20, price: 110, amount: 2_200, commission: 0 });
    const factors = splitFactors([buy, sell], stocks({ A: stock }));
    expect([factors.get(buy.orderId), factors.get(sell.orderId)]).toEqual([2, 1]);
  });

  describe('splitFactor', () => {
    it('is 1 inside the bar (with a 3% margin) and the simplest ratio that fits outside it', () => {
      expect(splitFactor(108, bar('2026-03-02', 100, 105, 95))).toBe(1);
      // 200원 체결, 수정 봉 95~105 → 2:1 분할(반올림 오차 없이 2)
      expect(splitFactor(201, bar('2026-03-02', 100, 105, 95))).toBe(2);
      // 50:1 분할
      expect(splitFactor(2_650_000, bar('2018-04-02', 53_000, 54_000, 52_300))).toBe(50);
      // 무상증자 0.5주 배정(1.5배)
      expect(splitFactor(15_000, bar('2026-03-02', 10_000, 10_200, 9_900))).toBe(1.5);
      // 10:1 병합
      expect(splitFactor(1_000, bar('2026-03-02', 10_000, 10_300, 9_800))).toBe(0.1);
      expect(splitFactor(200, undefined)).toBe(1);
      // 범위 안의 가장 둥근 비율: 5200원 체결(추정 52)도 50:1 분할로 본다
      expect(splitFactor(5200, bar('2018-04-02', 100, 104, 96))).toBe(50);
      // 3:1 분할과 1:3 병합
      expect(splitFactor(30_300, bar('2026-03-02', 10_000, 10_200, 9_900))).toBe(3);
      expect(splitFactor(3_000, bar('2026-03-02', 9_000, 9_200, 8_900))).toBeCloseTo(1 / 3, 12);
    });
  });

  it('does not adjust a fill inside the bar range (with a 3% margin)', () => {
    const stock: StockSeries = { name: '에이', candles: [bar('2026-03-02', 100, 105, 95), bar('2026-03-03', 110)] };
    const tl = buildTimeline([trade({ price: 108, amount: 1080 })], stocks({ A: stock }), () => INDEX);
    expect(tl.tracks[0].splitAdjusted).toBe(false);
    expect(tl.tracks[0].actual).toEqual([1000, 1100, 1100]);
  });

  it('keeps symbols without prices out and lists them as missing; days start at the first trade', () => {
    const tl = buildTimeline(
      [trade({ symbol: 'B', date: '2026-03-03', orderedAt: '2026-03-03T09:00:00+09:00' }), trade({ symbol: 'Z' })],
      stocks({ B: { name: '비', candles: STOCK.candles } }),
      () => INDEX,
      { names: new Map([['Z', '제트']]) },
    );
    expect(tl.missing).toEqual([{ symbol: 'Z', name: '제트' }]);
    expect(tl.tracks.map((t) => t.symbol)).toEqual(['B']);
    expect(tl.days).toEqual(['2026-03-03', '2026-03-04']);
  });

  it('is empty without trades', () => {
    expect(buildTimeline([], stocks({}), () => INDEX)).toEqual({ days: [], tracks: [], missing: [] });
  });
});
