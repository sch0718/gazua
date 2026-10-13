import { describe, expect, it } from 'vitest';
import type { LoadedSeries } from '../../data/candleService';
import type { Candle, Point } from '../../data/metrics';
import type { StockMeta } from '../../providers/types';
import type { WatchItem } from '../../state/schema';
import { kstEpoch } from '../../time/kst';
import { buildRows, sortRows, valueAt, type RowSource } from './rows';

const at = (hhmm: string) => kstEpoch('2026-10-12', `${hhmm}:00`);
const bar = (t: number, c: number): Candle => ({ t, o: c, h: c, l: c, c, v: 1 });

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
  segments: [],
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
    const rows = buildRows([src('A', { series: old }), src('B')], { scrubT: null, venueMode: 'AUTO', chartDate: '2026-10-12' });
    expect(rows[0].staleAt).toBe(at('07:50'));
    expect(rows[0].prevDay).toBe('2026-10-08');
    expect(rows[0].value).toBe(2);
    expect(rows[1].prevDay).toBeUndefined();
    expect(rows[1].staleAt).toBeUndefined();
  });

  it('without a chart date (daily mode) nothing is marked', () => {
    const old = series('A', { tradingDate: '2026-10-08' });
    const rows = buildRows([src('A', { series: old })], { scrubT: null, venueMode: 'AUTO' });
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
    const [r] = buildRows([src('A', { quote: { symbol: 'A', venue: 'KRX', price: 105, ts: null } })], {
      scrubT: null,
      venueMode: 'AUTO',
    });
    expect(r).toMatchObject({ symbol: 'A', name: '종목A', value: 2, price: 105, nxt: true, hidden: false });
    expect(r.staleAt).toBeUndefined();
  });

  it('stale rows ignore live quotes', () => {
    const stale = series('A', { stale: true });
    const [r] = buildRows([src('A', { series: stale, quote: { symbol: 'A', venue: 'KRX', price: 999, ts: null } })], {
      scrubT: null,
      venueMode: 'AUTO',
    });
    // snapshot의 마지막 가격·지표 값 그대로, 새 시세로 다시 계산하지 않는다.
    expect(r.price).toBe(102);
    expect(r.value).toBe(2);
    expect(r.staleAt).toBe(stale.computedAt);
  });

  it('while scrubbing, value and price are those at the scrub time', () => {
    const [r] = buildRows([src('A', { quote: { symbol: 'A', venue: 'KRX', price: 105, ts: null } })], {
      scrubT: at('09:00'),
      venueMode: 'AUTO',
    });
    expect(r.value).toBe(1);
    expect(r.price).toBe(101);
  });

  it('KRX 대체 badge in NXT mode when the series has fallback intervals', () => {
    const fallback = series('A', { intervals: [{ start: at('09:00'), end: at('15:20'), venue: 'KRX', kind: 'continuous', fallback: true }] });
    const nxt = buildRows([src('A', { series: fallback, meta: meta('A', { nxtSupported: false }) })], { scrubT: null, venueMode: 'NXT' });
    expect(nxt[0].badges).toContain('KRX 대체');
    expect(nxt[0].nxt).toBe(false);
    const auto = buildRows([src('A', { series: fallback })], { scrubT: null, venueMode: 'AUTO' });
    expect(auto[0].badges).not.toContain('KRX 대체');
  });

  it('ETF/ETN and 거래정지 badges', () => {
    const rows = buildRows(
      [src('A', { meta: meta('A', { securityType: 'ETF' }) }), src('B', { meta: meta('B', { krxSuspended: true }) })],
      { scrubT: null, venueMode: 'AUTO' },
    );
    expect(rows[0].badges).toEqual(['ETF']);
    expect(rows[1].badges).toEqual(['거래정지']);
  });

  it('NXT mode badges NXT 거래정지 (detail-sheet wording); a suspended NXT is not shown as an available NXT', () => {
    const suspended = meta('A', { nxtSupported: true, nxtSuspended: true });
    const [nxtMode] = buildRows([src('A', { meta: suspended })], { scrubT: null, venueMode: 'NXT' });
    expect(nxtMode.badges).toEqual(['NXT 거래정지']);
    expect(nxtMode.nxt).toBe(false);
    const [krxMode] = buildRows([src('A', { meta: suspended })], { scrubT: null, venueMode: 'KRX' });
    expect(krxMode.badges).toEqual([]);
    expect(krxMode.nxt).toBe(false);
    const [both] = buildRows([src('A', { meta: { ...suspended, krxSuspended: true } })], { scrubT: null, venueMode: 'NXT' });
    expect(both.badges).toEqual(['거래정지']);
    const [ok] = buildRows([src('A', { meta: meta('A', { nxtSuspended: false }) })], { scrubT: null, venueMode: 'NXT' });
    expect(ok.badges).toEqual([]);
    expect(ok.nxt).toBe(true);
  });

  it('error rows carry the error; rows still loading are marked loading', () => {
    const rows = buildRows(
      [src('A', { series: null, points: null, error: '불러오지 못했어요' }), src('B', { series: null, points: null, meta: undefined })],
      { scrubT: null, venueMode: 'AUTO' },
    );
    expect(rows[0]).toMatchObject({ value: null, price: null, error: '불러오지 못했어요' });
    expect(rows[1]).toMatchObject({ name: 'B', value: null, loading: true });
  });

  it('keeps slot and hidden from the watch item', () => {
    const [r] = buildRows([src('A', { item: item('A', { colorSlot: 5, hidden: true }) })], { scrubT: null, venueMode: 'AUTO' });
    expect(r.slot).toBe(5);
    expect(r.hidden).toBe(true);
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
