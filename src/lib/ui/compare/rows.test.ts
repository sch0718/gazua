import { describe, expect, it } from 'vitest';
import type { LoadedSeries } from '../../data/candleService';
import type { Candle, Point } from '../../data/metrics';
import { metricPoints } from '../../data/seriesMetrics';
import type { VenueMode } from '../../market/tradable';
import type { Quote, StockMeta } from '../../providers/types';
import type { WatchItem } from '../../state/schema';
import { kstEpoch } from '../../time/kst';
import { buildRows, isSuspended, orderRows, rowSeries, sortRows, valueAt, withQuote, type RowSource } from './rows';

const at = (hhmm: string) => kstEpoch('2026-10-12', `${hhmm}:00`);
const bar = (t: number, c: number): Candle => ({ t, o: c, h: c, l: c, c, v: 1 });
const NOW_R = at('09:02');

const item = (symbol: string, over: Partial<WatchItem> = {}): WatchItem => ({
  symbol,
  colorSlot: 1,
  hidden: false,
  addedAt: 0,
  ...over,
});
const meta = (symbol: string, over: Partial<StockMeta> = {}): StockMeta => ({
  symbol,
  name: `종목${symbol}`,
  market: 'KOSPI',
  securityType: 'STOCK',
  nxtSupported: true,
  krxSuspended: false,
  nxtSuspended: null,
  liquidationTrading: false,
  ...over,
});
const series = (symbol: string, over: Partial<LoadedSeries & { stale: boolean }> = {}): LoadedSeries & { stale: boolean } => ({
  symbol,
  tradingDate: '2026-10-12',
  base: 100,
  baseDate: '2026-10-08',
  avgDailyVolume: null,
  avgVolumeVenue: 'KRX',
  candles: [bar(at('09:00'), 101), bar(at('09:01'), 102)],
  daily: [],
  segments: [{ start: at('09:00'), end: at('09:02'), venue: 'KRX' }],
  intervals: [],
  computedAt: at('17:20'),
  stale: false,
  ...over,
});
const points: Point[] = [
  { t: at('09:00'), v: 1 },
  { t: at('09:01'), v: 2 },
];

const src = (symbol: string, over: Partial<RowSource> = {}): RowSource => ({
  item: item(symbol),
  meta: meta(symbol),
  series: series(symbol),
  error: null,
  points,
  ...over,
});

describe('buildRows — previous trading day on the intraday chart', () => {
  it('a series from another trading day than the chart is marked stale with that day; same-day rows are not', () => {
    const old = series('A', { tradingDate: '2026-10-08', stale: true, computedAt: at('07:50') });
    const rows = buildRows([src('A', { series: old }), src('B')], { now: NOW_R, scrubT: null, venueMode: 'AUTO', chartDate: '2026-10-12' });
    expect(rows[0].staleAt).toBe(at('07:50'));
    expect(rows[0].prevDay).toBe('2026-10-08');
    expect(rows[0].value).toBe(2);
    expect(rows[1].prevDay).toBeUndefined();
    expect(rows[1].staleAt).toBeUndefined();
  });

  it('without a chart date (daily mode) nothing is marked', () => {
    const old = series('A', { tradingDate: '2026-10-08' });
    const rows = buildRows([src('A', { series: old })], { now: NOW_R, scrubT: null, venueMode: 'AUTO' });
    expect(rows[0].prevDay).toBeUndefined();
  });
});

describe('valueAt', () => {
  const ps: Point[] = [
    { t: 1, v: 1 },
    { t: 2, v: null },
    { t: 3, v: 3 },
  ];
  it('last non-null value at or before t', () => {
    expect(valueAt(ps, 2)).toBe(1);
    expect(valueAt(ps, 3)).toBe(3);
    expect(valueAt(ps, 0)).toBeNull();
    expect(valueAt(ps, null)).toBe(3);
    expect(valueAt([], null)).toBeNull();
  });
});

describe('buildRows', () => {
  it('value is the last metric value; price is the live quote for fresh rows', () => {
    const [r] = buildRows([src('A', { quote: { symbol: 'A', venue: 'KRX', price: 105, ts: at('09:01') + 30_000 } })], {
      now: NOW_R, scrubT: null,
      venueMode: 'AUTO',
    });
    expect(r).toMatchObject({ symbol: 'A', name: '종목A', value: 2, price: 105, nxt: true, hidden: false });
    expect(r.staleAt).toBeUndefined();
  });

  it('stale rows ignore live quotes', () => {
    const stale = series('A', { stale: true });
    const [r] = buildRows([src('A', { series: stale, quote: { symbol: 'A', venue: 'KRX', price: 999, ts: at('09:01') + 30_000 } })], {
      now: NOW_R, scrubT: null,
      venueMode: 'AUTO',
    });
    // snapshot의 마지막 가격·지표 값 그대로, 새 시세로 다시 계산하지 않는다.
    expect(r.price).toBe(102);
    expect(r.value).toBe(2);
    expect(r.staleAt).toBe(stale.computedAt);
  });

  it('while scrubbing, value and price are those at the scrub time', () => {
    const [r] = buildRows([src('A', { quote: { symbol: 'A', venue: 'KRX', price: 105, ts: at('09:01') + 30_000 } })], {
      now: NOW_R, scrubT: at('09:00'),
      venueMode: 'AUTO',
    });
    expect(r.value).toBe(1);
    expect(r.price).toBe(101);
  });

  it('KRX 대체 badge in NXT mode when the series has fallback intervals', () => {
    const fallback = series('A', { intervals: [{ start: at('09:00'), end: at('15:20'), venue: 'KRX', kind: 'continuous', fallback: true }] });
    const nxt = buildRows([src('A', { series: fallback, meta: meta('A', { nxtSupported: false }) })], { now: NOW_R, scrubT: null, venueMode: 'NXT' });
    expect(nxt[0].badges).toContain('KRX 대체');
    expect(nxt[0].nxt).toBe(false);
    const auto = buildRows([src('A', { series: fallback })], { now: NOW_R, scrubT: null, venueMode: 'AUTO' });
    expect(auto[0].badges).not.toContain('KRX 대체');
  });

  it('ETF/ETN and 거래정지 badges', () => {
    const rows = buildRows(
      [src('A', { meta: meta('A', { securityType: 'ETF' }) }), src('B', { meta: meta('B', { krxSuspended: true }) })],
      { now: NOW_R, scrubT: null, venueMode: 'AUTO' },
    );
    expect(rows[0].badges).toEqual(['ETF']);
    expect(rows[1].badges).toEqual(['거래정지']);
  });

  it('NXT mode badges NXT 거래정지 (detail-sheet wording); a suspended NXT is not shown as an available NXT', () => {
    const suspended = meta('A', { nxtSupported: true, nxtSuspended: true });
    const [nxtMode] = buildRows([src('A', { meta: suspended })], { now: NOW_R, scrubT: null, venueMode: 'NXT' });
    expect(nxtMode.badges).toEqual(['NXT 거래정지']);
    expect(nxtMode.nxt).toBe(false);
    const [krxMode] = buildRows([src('A', { meta: suspended })], { now: NOW_R, scrubT: null, venueMode: 'KRX' });
    expect(krxMode.badges).toEqual([]);
    expect(krxMode.nxt).toBe(false);
    const [both] = buildRows([src('A', { meta: { ...suspended, krxSuspended: true } })], { now: NOW_R, scrubT: null, venueMode: 'NXT' });
    expect(both.badges).toEqual(['거래정지']);
    const [ok] = buildRows([src('A', { meta: meta('A', { nxtSuspended: false }) })], { now: NOW_R, scrubT: null, venueMode: 'NXT' });
    expect(ok.badges).toEqual([]);
    expect(ok.nxt).toBe(true);
  });

  it('suspension badge follows isSuspended for every venue mode', () => {
    const table: [Partial<StockMeta>, VenueMode, string[]][] = [
      [{}, 'AUTO', []],
      [{ krxSuspended: true }, 'KRX', ['거래정지']],
      [{ krxSuspended: true }, 'NXT', ['거래정지']],
      [{ krxSuspended: true, nxtSuspended: true }, 'NXT', ['거래정지']],
      [{ nxtSuspended: true }, 'NXT', ['NXT 거래정지']],
      [{ nxtSuspended: true }, 'KRX', []],
      [{ nxtSuspended: true }, 'AUTO', []],
      [{ nxtSuspended: false }, 'NXT', []],
      [{ nxtSuspended: null }, 'NXT', []],
    ];
    for (const [over, venueMode, badges] of table) {
      const m = meta('A', over);
      const [r] = buildRows([src('A', { meta: m })], { now: NOW_R, scrubT: null, venueMode });
      expect(r.badges, `${JSON.stringify(over)} ${venueMode}`).toEqual(badges);
      expect(r.badges.some((b) => b.includes('거래정지'))).toBe(isSuspended(m, venueMode));
    }
  });

  it('error rows carry the error; rows still loading are marked loading', () => {
    const rows = buildRows(
      [src('A', { series: null, points: null, error: '불러오지 못했어요' }), src('B', { series: null, points: null, meta: undefined })],
      { now: NOW_R, scrubT: null, venueMode: 'AUTO' },
    );
    expect(rows[0]).toMatchObject({ value: null, price: null, error: '불러오지 못했어요' });
    expect(rows[1]).toMatchObject({ name: 'B', value: null, loading: true });
  });

  it('keeps slot and hidden from the watch item', () => {
    const [r] = buildRows([src('A', { item: item('A', { colorSlot: 5, hidden: true }) })], { now: NOW_R, scrubT: null, venueMode: 'AUTO' });
    expect(r.slot).toBe(5);
    expect(r.hidden).toBe(true);
  });
});

describe('orderRows', () => {
  const r = (symbol: string, value: number | null) => ({ symbol, value });
  it('value sorts by value (and honors frozen); mine keeps the input order', () => {
    const rows = [r('A', 1), r('B', 3), r('C', null)];
    expect(orderRows(rows, 'value', null).map((x) => x.symbol)).toEqual(['B', 'A', 'C']);
    expect(orderRows(rows, 'value', ['C', 'A', 'B']).map((x) => x.symbol)).toEqual(['C', 'A', 'B']);
    expect(orderRows(rows, 'mine', ['C', 'B', 'A']).map((x) => x.symbol)).toEqual(['A', 'B', 'C']);
  });
});

describe('sortRows', () => {
  const r = (symbol: string, value: number | null) => ({ symbol, value });
  it('value desc, nulls last, ties keep input order', () => {
    expect(sortRows([r('A', null), r('B', 1), r('C', 1), r('D', 5)], null).map((x) => x.symbol)).toEqual(['D', 'B', 'C', 'A']);
  });
  it('frozen order first; unknown rows appended in value order', () => {
    expect(sortRows([r('A', 1), r('B', 2), r('C', 3)], ['B', 'A']).map((x) => x.symbol)).toEqual(['B', 'A', 'C']);
  });
});

describe('withQuote — the row value uses the same 5-second quote as the row price', () => {
  const D1 = { unit: 'D', n: 1 } as const;
  const NOW = at('09:02');
  const day = (date: string, c: number, v = 10): Candle => ({ t: kstEpoch(date, '00:00:00'), o: c, h: c, l: c, c, v });
  const d1 = (over: Partial<LoadedSeries & { stale: boolean }> = {}) =>
    series('A', {
      base: 100,
      avgDailyVolume: 4,
      avgVolumeVenue: 'NXT',
      candles: [bar(at('09:00'), 105), bar(at('09:01'), 110)],
      segments: [{ start: at('09:00'), end: at('09:02'), venue: 'KRX' }],
      ...over,
    });
  const quote = (over: Partial<Quote> = {}): Quote => ({ symbol: 'A', venue: 'KRX', price: 112, ts: at('09:01') + 30_000, ...over });

  it('row value follows the quote the row shows', () => {
    const s = d1();
    const q = quote();
    const quoted = withQuote(s, q, NOW);
    const rowPoints = metricPoints(quoted, 'change', { period: D1 });
    const [r] = buildRows([src('A', { series: s, quote: q, points: rowPoints })], { now: NOW_R, scrubT: null, venueMode: 'AUTO' });
    expect(r.value).toBeCloseTo(12, 10);
    expect(r.price).toBe(112);
    // 1일: 시세 시각에 합성 종가 봉(거래량 0)을 붙인다. 원래 시리즈와 나머지 필드는 그대로.
    expect(quoted.candles).toHaveLength(3);
    expect(quoted.candles.at(-1)).toEqual({ t: q.ts, o: 112, h: 112, l: 112, c: 112, v: 0 });
    expect({ ...quoted, candles: s.candles }).toEqual(s);
    expect(s.candles).toHaveLength(2);
  });

  it('a stale series, a quote from another venue, or a quote without a time keeps the candles', () => {
    const fresh = d1();
    expect(withQuote(d1({ stale: true }), quote(), NOW).candles).toHaveLength(2);
    expect(withQuote(fresh, quote({ venue: 'NXT' }), NOW)).toBe(fresh);
    expect(withQuote(fresh, quote({ ts: null }), NOW)).toBe(fresh);
    expect(withQuote(fresh, undefined, NOW)).toBe(fresh);
    // 시리즈 거래소는 마지막 구간(AUTO 이어 붙이기면 NXT 시간외)
    const nxtTail = d1({ segments: [{ start: at('09:00'), end: at('09:02'), venue: 'NXT' }] });
    expect(withQuote(nxtTail, quote({ venue: 'NXT' }), NOW).candles).toHaveLength(3);
    expect(withQuote(nxtTail, quote({ venue: 'KRX' }), NOW)).toBe(nxtTail);
  });

  it('a quote no newer than the last bar is ignored', () => {
    const s = d1();
    expect(withQuote(s, quote({ ts: at('09:01') }), NOW)).toBe(s);
    expect(withQuote(s, quote({ ts: at('09:00') }), NOW)).toBe(s);
  });

  it('a previous trading day’s series takes no quote from today', () => {
    const prev = d1({
      tradingDate: '2026-10-08',
      candles: [bar(kstEpoch('2026-10-08', '15:30:00'), 110)],
      segments: [{ start: kstEpoch('2026-10-08', '15:30:00'), end: kstEpoch('2026-10-08', '15:31:00'), venue: 'KRX' }],
    });
    expect(withQuote(prev, quote(), NOW)).toBe(prev);
  });

  it('1-day RVOL is unchanged: the synthetic bar adds no volume', () => {
    const s = d1();
    const before = metricPoints(s, 'rvol', { period: D1 });
    const after = metricPoints(withQuote(s, quote(), NOW), 'rvol', { period: D1 });
    expect(after).toHaveLength(3);
    expect(after.at(-1)!.v).toBe(before.at(-1)!.v);
    expect(valueAt(after, null)).toBe(valueAt(before, null));
  });

  it('daily periods replace only today’s close and keep its volume', () => {
    const today = day('2026-10-12', 110, 20);
    const prior = day('2026-10-09', 105);
    const s = series('A', { base: 100, candles: [prior, today], daily: [day('2026-10-08', 100), prior, today], segments: [{ start: prior.t, end: today.t + 86_400_000, venue: 'KRX' }] });
    const quoted = withQuote(s, quote({ ts: at('10:00') }), at('10:00'));
    expect(quoted.candles).toHaveLength(2);
    expect(quoted.candles.at(-1)).toEqual({ ...today, c: 112 });
    expect(today.c).toBe(110);
    expect(valueAt(metricPoints(quoted, 'change', { period: { unit: 'M', n: 1 } }), null)).toBeCloseTo(12, 10);
    // 오늘 일봉이 아직 없으면 그대로
    const noToday = series('A', { candles: [prior], daily: [prior], segments: [{ start: prior.t, end: prior.t + 86_400_000, venue: 'KRX' }] });
    expect(withQuote(noToday, quote({ ts: at('10:00') }), at('10:00'))).toBe(noToday);
  });

  it('drawdown uses the quote as today’s close, not today’s earlier close as a peak', () => {
    const today = day('2026-10-12', 120);
    const prior = day('2026-10-09', 100);
    const s = series('A', { candles: [prior, today], daily: [prior, today], segments: [{ start: prior.t, end: today.t + 86_400_000, venue: 'KRX' }] });
    const quoted = withQuote(s, quote({ price: 90, ts: at('10:00') }), at('10:00'));
    expect(valueAt(metricPoints(quoted, 'drawdown', { period: { unit: 'M', n: 1 } }), null)).toBeCloseTo(-10, 10);
  });

  it('excess after the index’s last bar keeps the candle value (the synthetic point has no index pair)', () => {
    const s = d1();
    const index = series('INDEX:KOSPI', {
      base: 1000,
      baseDate: '2026-10-08',
      candles: [bar(at('09:00'), 1000), bar(at('09:01'), 1010)],
      daily: [day('2026-10-08', 1000)],
    });
    const opts = { index, indexUntil: at('09:01'), period: D1 };
    const before = valueAt(metricPoints(s, 'excess', opts), null);
    const after = valueAt(metricPoints(withQuote(s, quote(), NOW), 'excess', opts), null);
    expect(before).toBeCloseTo(9, 10);
    expect(after).toBe(before);
  });
});

describe('buildRows — the price shows the quote only when the value uses it', () => {
  const day = (date: string, c: number): Candle => ({ t: kstEpoch(date, '00:00:00'), o: c, h: c, l: c, c, v: 10 });
  const prior = day('2026-10-09', 105);
  const today = day('2026-10-12', 110);
  // 일봉 기간: 시리즈 구간은 v.series(AUTO·통합 모드에서는 KRX)
  const daily = series('A', { candles: [prior, today], daily: [prior, today], segments: [{ start: prior.t, end: today.t + 86_400_000, venue: 'KRX' }] });
  const candlePoints = metricPoints(daily, 'change', { period: { unit: 'W', n: 1 } });
  const at1545 = at('15:45');

  it('AUTO daily at 15:45 with an NXT after-market quote: price is the KRX candle close, the same basis as the value', () => {
    const q: Quote = { symbol: 'A', venue: 'NXT', price: 999, ts: at1545 };
    const [r] = buildRows([src('A', { series: daily, quote: q, points: candlePoints })], { now: at1545, scrubT: null, venueMode: 'AUTO' });
    expect(r.price).toBe(110);
    expect(r.value).toBeCloseTo(10, 10);
  });

  it('UNIFIED daily: a UNIFIED quote does not match the KRX candles, so the price is the candle close', () => {
    const q: Quote = { symbol: 'A', venue: 'UNIFIED', price: 999, ts: at('10:00') };
    const [r] = buildRows([src('A', { series: daily, quote: q, points: candlePoints })], { now: at('10:00'), scrubT: null, venueMode: 'UNIFIED' });
    expect(r.price).toBe(110);
  });

  it('1 day, same venue: the quote is used for both the price and the value', () => {
    const s = series('A', { candles: [bar(at('09:00'), 105), bar(at('09:01'), 110)] });
    const q: Quote = { symbol: 'A', venue: 'KRX', price: 112, ts: at('09:01') + 30_000 };
    const opts = { now: NOW_R, scrubT: null, venueMode: 'AUTO' as const, chartDate: '2026-10-12' };
    const points = metricPoints(rowSeries(s, q, opts), 'change', { period: { unit: 'D', n: 1 } });
    const [r] = buildRows([src('A', { series: s, quote: q, points })], opts);
    expect(r.price).toBe(112);
    expect(r.value).toBeCloseTo(12, 10);
  });

  it('a precomputed quoted series is used as given instead of running rowSeries again', () => {
    const s = series('A', { candles: [bar(at('09:00'), 105), bar(at('09:01'), 110)] });
    const q: Quote = { symbol: 'A', venue: 'KRX', price: 112, ts: at('09:01') + 30_000 };
    const opts = { now: NOW_R, scrubT: null, venueMode: 'AUTO' as const, chartDate: '2026-10-12' };
    const quoted = rowSeries(s, q, opts);
    expect(quoted).not.toBe(s);
    expect(buildRows([src('A', { series: s, quote: q, quoted })], opts)[0].price).toBe(112);
    // 호출자가 원래 시리즈를 넘기면 시세가 값에 쓰이지 않은 것으로 보고 캔들 종가를 보인다.
    expect(buildRows([src('A', { series: s, quote: q, quoted: s })], opts)[0].price).toBe(110);
  });

  it('a quote and last bar from yesterday are not applied today: price is the candle close', () => {
    const close = kstEpoch('2026-10-09', '15:30:00');
    const s = series('A', {
      tradingDate: '2026-10-09',
      candles: [bar(close - 60_000, 105), bar(close, 110)],
      segments: [{ start: close - 60_000, end: close + 60_000, venue: 'KRX' }],
    });
    const q: Quote = { symbol: 'A', venue: 'KRX', price: 112, ts: close + 30_000 };
    const now = kstEpoch('2026-10-10', '09:00:00');
    expect(withQuote(s, q, now)).toBe(s);
    const [r] = buildRows([src('A', { series: s, quote: q })], { now, scrubT: null, venueMode: 'AUTO' });
    expect(r.price).toBe(110);
  });

  it('rowSeries: no quote while scrubbing or for a row from another trading day than the chart', () => {
    const s = series('A');
    const q: Quote = { symbol: 'A', venue: 'KRX', price: 112, ts: at('09:01') + 30_000 };
    expect(rowSeries(s, q, { now: NOW_R, scrubT: null, chartDate: '2026-10-12' }).candles).toHaveLength(3);
    expect(rowSeries(s, q, { now: NOW_R, scrubT: at('09:00'), chartDate: '2026-10-12' })).toBe(s);
    expect(rowSeries(s, q, { now: NOW_R, scrubT: null, chartDate: '2026-10-13' })).toBe(s);
  });
});
