// 리더보드 행 만들기와 정렬(스펙 7.2-6, 4.3). 화면과 무관한 순수 함수.
import type { SeriesSlot } from '../../chart/lineData';
import type { LoadedSeries } from '../../data/candleService';
import type { Point } from '../../data/metrics';
import type { VenueMode } from '../../market/tradable';
import type { Quote, StockMeta } from '../../providers/types';
import type { WatchItem } from '../../state/schema';

export interface LeaderRow {
  symbol: string;
  name: string;
  slot: SeriesSlot;
  /** 둘째 줄 배지(ETF·ETN·KRX 대체·거래정지) */
  badges: string[];
  value: number | null;
  price: number | null;
  hidden: boolean;
  error?: string;
  /** 마지막 성공 결과를 보여 주는 중이면 그 결과의 계산 시각 */
  staleAt?: number;
  /** 이름 옆 NXT 배지 */
  nxt?: boolean;
  /** 아직 결과도 오류도 없다 */
  loading?: boolean;
}

export interface RowSource {
  item: WatchItem;
  meta?: StockMeta;
  series?: (LoadedSeries & { stale: boolean }) | null;
  error?: string | null;
  /** 지금 지표의 점(시리즈가 없으면 null) */
  points?: Point[] | null;
  quote?: Quote;
}

/** t 이하에서 마지막 값(null 건너뜀). t가 null이면 마지막 값. */
export function valueAt(points: Point[], t: number | null): number | null {
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    if (t !== null && p.t > t) continue;
    if (p.v !== null) return p.v;
  }
  return null;
}

function priceOf(s: RowSource, scrubT: number | null): number | null {
  const series = s.series;
  if (!series) return null;
  const closes = series.candles.map((c) => ({ t: c.t, v: c.c }));
  if (scrubT !== null) return valueAt(closes, scrubT);
  // 마지막 성공 결과(stale)에는 새 시세를 섞지 않는다.
  if (!series.stale && s.quote) return s.quote.price;
  return valueAt(closes, null);
}

function badgesOf(s: RowSource, venueMode: VenueMode): string[] {
  const out: string[] = [];
  const type = s.meta?.securityType;
  if (type === 'ETF' || type === 'ETN') out.push(type);
  if (venueMode === 'NXT' && s.series?.intervals.some((iv) => iv.fallback)) out.push('KRX 대체');
  if (s.meta?.krxSuspended) out.push('거래정지');
  return out;
}

export function buildRows(sources: RowSource[], opts: { scrubT: number | null; venueMode: VenueMode }): LeaderRow[] {
  return sources.map((s): LeaderRow => {
    const row: LeaderRow = {
      symbol: s.item.symbol,
      name: s.meta?.name ?? s.item.symbol,
      slot: s.item.colorSlot,
      badges: badgesOf(s, opts.venueMode),
      value: s.points ? valueAt(s.points, opts.scrubT) : null,
      price: priceOf(s, opts.scrubT),
      hidden: s.item.hidden,
    };
    if (s.meta) row.nxt = s.meta.nxtSupported;
    if (s.error) row.error = s.error;
    else if (!s.series) row.loading = true;
    if (s.series?.stale) row.staleAt = s.series.computedAt;
    return row;
  });
}

/** 값 내림차순(값 없음은 맨 뒤, 같으면 입력 순서). frozen이 있으면 그 순서를 지키고 나머지를 뒤에 붙인다. */
export function sortRows<T extends { symbol: string; value: number | null }>(rows: T[], frozen: string[] | null): T[] {
  const byValue = rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const av = a.r.value;
      const bv = b.r.value;
      if (av === null || bv === null) return av === bv ? a.i - b.i : av === null ? 1 : -1;
      return bv - av || a.i - b.i;
    })
    .map((x) => x.r);
  if (!frozen) return byValue;
  const pinned = frozen.map((sym) => rows.find((r) => r.symbol === sym)).filter((r): r is T => r !== undefined);
  return [...pinned, ...byValue.filter((r) => !frozen.includes(r.symbol))];
}
