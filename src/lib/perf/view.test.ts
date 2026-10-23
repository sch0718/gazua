import { describe, expect, it } from 'vitest';
import type { Timeline, Track, Trade } from './types';
import { periodRanges, viewOf } from './view';
import { xirr } from './xirr';

const trade = (date: string, side: 'BUY' | 'SELL' = 'BUY'): Trade => ({
  orderId: `${date}-${side}`,
  symbol: 'A',
  side,
  date,
  orderedAt: `${date}T09:00:00+09:00`,
  qty: 1,
  price: 1,
  amount: 1,
  commission: 0,
  tax: 0,
});

function track(symbol: string, over: Partial<Track>): Track {
  return {
    symbol,
    name: symbol,
    bench: { id: 'KOSPI', name: 'KOSPI' },
    actual: [],
    virtual: [],
    events: [],
    splitAdjusted: false,
    excessQty: 0,
    uncompared: 0,
    ...over,
  };
}

// 2025-12-30 매수 1000 → 2026-01-02 300 회수 → 2026-06-30 평가
const DAYS = ['2025-12-30', '2025-12-31', '2026-01-02', '2026-06-30'];
const A = track('A', {
  actual: [1000, 1100, 800, 900],
  virtual: [1000, 1050, 750, 780],
  events: [
    { i: 0, trade: trade('2025-12-30'), actual: -1000, virtual: -1000, excessQty: 0 },
    { i: 2, trade: trade('2026-01-02', 'SELL'), actual: 300, virtual: 290, excessQty: 0 },
  ],
});
const B = track('B', {
  actual: [0, 500, 520, 600],
  virtual: [0, 500, 505, 510],
  events: [{ i: 1, trade: { ...trade('2025-12-31'), symbol: 'B' }, actual: -500, virtual: -500, excessQty: 0 }],
});
const TL: Timeline = { days: DAYS, tracks: [A, B], missing: [] };

describe('periodRanges', () => {
  it('lists the whole period, then each year newest first', () => {
    expect(periodRanges(DAYS)).toEqual([
      { id: 'all', label: '전체', a: 0, b: 3 },
      { id: '2026', label: '2026', a: 2, b: 3 },
      { id: '2025', label: '2025', a: 0, b: 1 },
    ]);
    expect(periodRanges([])).toEqual([]);
  });
});

describe('viewOf', () => {
  it('whole period: profits, IRR from the summed flows, contributions add up to the excess', () => {
    const v = viewOf(TL, 0, 3);
    expect(v.from).toBe('2025-12-30');
    expect(v.to).toBe('2026-06-30');
    expect(v.actual).toMatchObject({ invested: 1500, endValue: 1500, profit: 300 });
    expect(v.virtual).toMatchObject({ invested: 1500, endValue: 1290, profit: 80 });
    expect(v.excessProfit).toBe(220);
    expect(v.rows.reduce((s, r) => s + r.diff, 0)).toBe(220);
    const expected = xirr([
      { date: '2025-12-30', amount: -1000 },
      { date: '2025-12-31', amount: -500 },
      { date: '2026-01-02', amount: 300 },
      { date: '2026-06-30', amount: 1500 },
    ])!;
    expect(v.actual.irr).toBeCloseTo(expected, 9);
    expect(v.excessIrrPp).toBeCloseTo((v.actual.irr! - v.virtual.irr!) * 100, 9);
    // 1년이 안 되면 기간 수익률도 준다
    expect(v.actual.periodReturn).toBeCloseTo((1 + expected) ** (182 / 365) - 1, 9);
  });

  it('rows are sorted by the difference, largest first, with their trades', () => {
    const v = viewOf(TL, 0, 3);
    expect(v.rows.map((r) => [r.symbol, r.actualProfit, r.virtualProfit, r.diff])).toEqual([
      ['A', 200, 70, 130],
      ['B', 100, 10, 90],
    ]);
    expect(v.rows[0].trades.map((t) => t.side)).toEqual(['BUY', 'SELL']);
  });

  it('curve: value plus money taken out in the range, and money put in', () => {
    expect(viewOf(TL, 0, 3).curve).toEqual([
      { date: '2025-12-30', actual: 1000, virtual: 1000, invested: 1000 },
      { date: '2025-12-31', actual: 1600, virtual: 1550, invested: 1500 },
      { date: '2026-01-02', actual: 1620, virtual: 1545, invested: 1500 },
      { date: '2026-06-30', actual: 1800, virtual: 1580, invested: 1500 },
    ]);
  });

  it('a year starts from the value at the end of the previous year, and counts money taken out again from zero', () => {
    const v = viewOf(TL, 2, 3);
    // 실제 시작 1600, 가상 시작 1550
    expect(v.actual).toMatchObject({ invested: 1600, endValue: 1500, profit: 200 });
    expect(v.virtual).toMatchObject({ invested: 1550, endValue: 1290, profit: 30 });
    expect(v.curve[0]).toEqual({ date: '2026-01-02', actual: 1620, virtual: 1545, invested: 1600 });
    expect(v.actual.irr).toBeCloseTo(
      xirr([
        { date: '2026-01-02', amount: -1600 },
        { date: '2026-01-02', amount: 300 },
        { date: '2026-06-30', amount: 1500 },
      ])!,
      9,
    );
    expect(v.rows.map((r) => [r.symbol, r.actualProfit, r.diff, r.trades.length])).toEqual([
      ['B', 100, 90, 0],
      ['A', 100, 80, 1],
    ]);
  });

  it('skips the virtual flow of trades it could not compare and leaves out symbols with nothing in the range', () => {
    const C = track('C', {
      actual: [0, 0, 0, 0],
      virtual: [0, 0, 0, 0],
      events: [],
    });
    const D = track('D', {
      bench: null,
      actual: [100, 100, 100, 100],
      virtual: [0, 0, 0, 0],
      uncompared: 1,
      events: [{ i: 0, trade: { ...trade('2025-12-30'), symbol: 'D' }, actual: -100, virtual: null, excessQty: 0 }],
    });
    const v = viewOf({ days: DAYS, tracks: [C, D], missing: [] }, 0, 3);
    expect(v.rows.map((r) => r.symbol)).toEqual(['D']);
    expect(v.virtual.invested).toBe(0);
    expect(v.virtual.irr).toBeNull();
    expect(v.excessIrrPp).toBeNull();
    expect(v.rows[0]).toMatchObject({ benchName: null, uncompared: 1 });
  });

  it('a range of a year or more has no period return', () => {
    const tl: Timeline = {
      days: ['2025-01-02', '2026-01-02'],
      tracks: [
        track('A', {
          actual: [100, 110],
          virtual: [100, 105],
          events: [{ i: 0, trade: trade('2025-01-02'), actual: -100, virtual: -100, excessQty: 0 }],
        }),
      ],
      missing: [],
    };
    const v = viewOf(tl, 0, 1);
    expect(v.days).toBe(365);
    expect(v.actual.periodReturn).toBeNull();
    expect(v.actual.irr).toBeCloseTo(0.1, 9);
  });
});
