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

  // 기준일(10/12 1일 차트면 직전 거래일 10/8)의 일봉. 지수는 종목과 같은 기준일의 종가로 다시 맞춘다.
  const D8 = day('2026-10-08');
  const stock1d = () => series({ daily: [bar(D8, 100)] });
  const index1d = (candles: Candle[], base = 1000) =>
    series({ symbol: 'INDEX:KOSPI', base, daily: [bar(D8, 1000)], candles });

  it('excess: stock change minus index change against the index close on the stock’s base date', () => {
    const index = index1d([bar(at('09:00'), 1010), bar(at('09:02'), 1050)]);
    expect(values(metricPoints(stock1d(), 'excess', { period: D1, index }))).toEqual([9, 4, 15]);
  });

  it('excess: indexUntil drops stock points after the index’s last bar (a stale index is not carried forward)', () => {
    const index = index1d([bar(at('09:00'), 1010), bar(at('09:01'), 1020)]);
    expect(values(metricPoints(stock1d(), 'excess', { period: D1, index, indexUntil: at('09:01') }))).toEqual([9, 3, null]);
    expect(values(metricPoints(stock1d(), 'excess', { period: D1, index, indexUntil: null }))).toEqual([9, 3, 18]);
  });

  it('excess: the index is rebased to the stock’s base date even when its own base is from another period start', () => {
    // 리뷰 시나리오: 10/5 = 100, 10/6부터 110(종목·지수 모두). 1주, 종목은 10/13(기준 10/6 종가 110),
    // 지수는 갱신에 실패해 10/12 결과(기준 10/5 종가 100)를 그대로 쓴다. 겹치는 날마다 0%p여야 한다.
    const W1 = { unit: 'W', n: 1 } as const;
    const days = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-12', '2026-10-13'];
    const closes = (upTo: string) => days.filter((d) => d <= upTo).map((d) => bar(day(d), d === '2026-10-05' ? 100 : 110));
    const stock = series({ tradingDate: '2026-10-13', base: 110, daily: closes('2026-10-13'), candles: closes('2026-10-13').filter((c) => c.t >= day('2026-10-07')) });
    const index = series({
      symbol: 'INDEX:KOSPI',
      tradingDate: '2026-10-12',
      base: 100,
      daily: closes('2026-10-12'),
      candles: closes('2026-10-12').filter((c) => c.t >= day('2026-10-06')),
    });
    const ps = metricPoints(stock, 'excess', { period: W1, index, indexUntil: day('2026-10-12') });
    expect(ps.map((p) => p.t)).toEqual(['2026-10-07', '2026-10-08', '2026-10-12', '2026-10-13'].map(day));
    expect(values(ps)).toEqual([0, 0, 0, null]);
  });

  it('excess: no index bar on the stock’s base date gives all null (no mixed bases)', () => {
    const index = series({ symbol: 'INDEX:KOSPI', base: 1000, daily: [bar(day('2026-10-07'), 1000)], candles: [bar(at('09:00'), 1010)] });
    expect(values(metricPoints(stock1d(), 'excess', { period: D1, index }))).toEqual([null, null, null]);
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
