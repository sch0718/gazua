import { describe, expect, it } from 'vitest';
import { kstEpoch } from '../time/kst';
import type { LoadedSeries } from './candleService';
import type { Candle } from './metrics';
import { baseDateFor, metricPoints } from './seriesMetrics';

const DAY = '2026-10-12';
const at = (hhmm: string) => kstEpoch(DAY, `${hhmm}:00`);
const day = (d: string) => kstEpoch(d, '00:00:00');
const bar = (t: number, c: number, v = 100): Candle => ({ t, o: c, h: c, l: c, c, v });

function series(over: Partial<LoadedSeries> = {}): LoadedSeries {
  return {
    symbol: '005930',
    tradingDate: DAY,
    base: 100,
    avgDailyVolume: 1000,
    candles: [bar(at('09:00'), 110, 100), bar(at('09:01'), 105, 300), bar(at('09:02'), 120, 100)],
    daily: [],
    segments: [],
    intervals: [],
    computedAt: at('09:03'),
    ...over,
  };
}

const D1 = { unit: 'D', n: 1 } as const;
const W1 = { unit: 'W', n: 1 } as const;
const values = (ps: { v: number | null }[]) => ps.map((p) => (p.v === null ? null : Math.round(p.v * 1000) / 1000));

describe('metricPoints', () => {
  it('change: percent vs base for each 1m close', () => {
    const ps = metricPoints(series(), 'change', { period: D1 });
    expect(ps.map((p) => p.t)).toEqual([at('09:00'), at('09:01'), at('09:02')]);
    expect(values(ps)).toEqual([10, 5, 20]);
  });

  it('change: missing base gives all null', () => {
    expect(values(metricPoints(series({ base: null }), 'change', { period: D1 }))).toEqual([null, null, null]);
  });

  it('drawdown: from the running max close', () => {
    expect(values(metricPoints(series(), 'drawdown', { period: D1 }))).toEqual([0, -4.545, 0]);
  });

  it('excess: stock change minus index change against the index base', () => {
    const index = series({
      symbol: 'INDEX:KOSPI',
      base: 1000,
      candles: [bar(at('09:00'), 1010), bar(at('09:02'), 1050)],
    });
    expect(values(metricPoints(series(), 'excess', { period: D1, index }))).toEqual([9, 4, 15]);
  });

  it('excess: no index gives all null', () => {
    expect(values(metricPoints(series(), 'excess', { period: D1, index: null }))).toEqual([null, null, null]);
    expect(values(metricPoints(series(), 'excess', { period: D1 }))).toEqual([null, null, null]);
  });

  it('rvol on 1 day: cumulative volume over the (already converted) average daily volume', () => {
    expect(values(metricPoints(series(), 'rvol', { period: D1 }))).toEqual([0.1, 0.4, 0.5]);
  });

  it('rvol on daily periods: rvolDaily over the whole daily history, then only the period bars', () => {
    const daily: Candle[] = [];
    for (let i = 0; i < 22; i++) daily.push(bar(day(`2026-09-${String(i + 1).padStart(2, '0')}`), 100, i < 20 ? 100 : 300));
    const candles = daily.slice(20);
    const ps = metricPoints(series({ daily, candles }), 'rvol', { period: W1 });
    expect(ps.map((p) => p.t)).toEqual(candles.map((c) => c.t));
    // 21번째 봉: 300 / 평균(100×20) = 3, 22번째: 300 / ((100×19 + 300)/20 = 110) = 2.727
    expect(values(ps)).toEqual([3, 2.727]);
  });

  it('mcap: close × shares in 조, or all null without shares', () => {
    const s = series({ sharesOutstanding: 1e10 });
    expect(values(metricPoints(s, 'mcap', { period: D1 }))).toEqual([1.1, 1.05, 1.2]);
    expect(values(metricPoints(series(), 'mcap', { period: D1 }))).toEqual([null, null, null]);
  });

  it('v1.1 metrics give all null', () => {
    expect(values(metricPoints(series(), 'volatility', { period: D1 }))).toEqual([null, null, null]);
    expect(values(metricPoints(series(), 'rsi', { period: D1 }))).toEqual([null, null, null]);
  });

  it('daily periods use the period candles closes', () => {
    const candles = [bar(day('2026-10-08'), 90), bar(day('2026-10-12'), 110)];
    expect(values(metricPoints(series({ candles }), 'change', { period: W1 }))).toEqual([-10, 10]);
  });

  it('empty candles give an empty series', () => {
    expect(metricPoints(series({ candles: [] }), 'change', { period: D1 })).toEqual([]);
  });
});

describe('baseDateFor', () => {
  it('is the last daily bar before the period start', () => {
    const daily = [bar(day('2026-09-30'), 1), bar(day('2026-10-02'), 1), bar(day('2026-10-05'), 1), bar(day('2026-10-06'), 1)];
    // W1 on 10/12 starts 10/6 → base = 10/5
    expect(baseDateFor(series({ daily }), W1)).toBe('2026-10-05');
    // D1 on 10/12 starts 10/12 → base = 10/6
    expect(baseDateFor(series({ daily }), D1)).toBe('2026-10-06');
  });

  it('is null without an earlier bar', () => {
    expect(baseDateFor(series({ daily: [] }), W1)).toBeNull();
  });
});
