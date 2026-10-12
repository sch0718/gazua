import { describe, expect, it } from 'vitest';
import { nearMiss, summarize } from './summary';
import type { CoreResult } from './simulate';
import { tradingDates } from './testBars';

const M = 10_000;
function core(values: number[], rts: [number, number, boolean?][] = [], skippedN = 0): CoreResult {
  const days = tradingDates('2026-01-05', values.length);
  return {
    equity: values.map((v, i) => ({ date: days[i], value: v, cash: v / 2 })),
    trades: [],
    skipped: Array.from({ length: skippedN }, () => ({ date: days[0], symbol: 'A', reason: '현금 부족' as const })),
    roundTrips: rts.map(([cost, pnl, open], i) => ({ symbol: 'A', open: days[0], close: open ? null : days[1], cost, pnl, holdDays: 2 + i })),
    perSymbolFirstDate: {},
    patternStats: { maxDropPct: 8.2, declineDays: 3 },
  };
}

describe('summarize', () => {
  const vals = [1000, 1100, 990, 1210].map((v) => v * M);
  const days = tradingDates('2026-01-05', 4);

  it('수익률·MDD·승률', () => {
    const c = core(vals, [[100, 10], [100, -5], [100, 20]]);
    const s = summarize(c, { hold: [1000 * M, 1, 1, 1050 * M], index: null, benchmark: null }, days, 1000 * M);
    expect(s.totalReturnPct).toBeCloseTo(21, 6);
    expect(s.mddPct).toBeCloseTo(-10, 6);
    expect(s.winRatePct).toBeCloseTo(66.67, 2);
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(1);
    expect(s.avgWinPct).toBeCloseTo(15, 6);
    expect(s.avgLossPct).toBeCloseTo(-5, 6);
    expect(s.vsHoldPp).toBeCloseTo(16, 6);
    expect(s.vsIndexPp).toBeNull();
    expect(s.vsBenchmarkPp).toBeNull();
    expect(s.avgCashPct).toBeCloseTo(50, 6);
  });

  it('보유 중과 손익 0, 거래 없음', () => {
    const c = core(vals, [[100, 0], [100, 50, true]], 2);
    const s = summarize(c, { hold: vals, index: vals, benchmark: vals }, days, 1000 * M);
    expect(s.roundTrips).toBe(2);
    expect(s.openPositions).toBe(1);
    expect(s.wins).toBe(0);
    expect(s.losses).toBe(1);
    expect(s.avgHoldDays).toBe(2);
    expect(s.skippedSignals).toBe(2);
    expect(s.vsIndexPp).toBeCloseTo(0, 6);
    const e = summarize(core(vals), { hold: vals, index: null, benchmark: null }, days, 1000 * M);
    expect(e.winRatePct).toBeNull();
    expect(e.avgHoldDays).toBeNull();
    expect(e.avgWinPct).toBeNull();
  });

  it('cagr 약 10%', () => {
    const d = ['2023-10-11', '2026-10-11'];
    const c = core([100, 133.1]);
    const s = summarize(c, { hold: [100, 100], index: null, benchmark: null }, d, 100);
    expect(s.cagrPct).toBeCloseTo(10.0, 1);
  });

  it('달력 일수 0이면 cagr = 총수익률', () => {
    const c = core([100, 110]);
    const s = summarize(c, { hold: [100, 100], index: null, benchmark: null }, ['2026-01-05', '2026-01-05'], 100);
    expect(s.cagrPct).toBeCloseTo(10, 6);
  });
});

describe('nearMiss', () => {
  it('거래 0건, 건너뜀 0건이면 patternStats', () => {
    expect(nearMiss(core([1, 1]))).toEqual({ maxDropPct: 8.2, declineDays: 3 });
  });
  it('신호를 모두 건너뛰었으면 null', () => {
    expect(nearMiss(core([1, 1], [], 3))).toBeNull();
  });
  it('거래가 있으면 null', () => {
    const c = core([1, 1]);
    c.trades.push({ date: 'x', symbol: 'A', kind: 'buy', price: 1, qty: 1, fee: 0, tax: 0, reason: '' });
    expect(nearMiss(c)).toBeNull();
  });
});
