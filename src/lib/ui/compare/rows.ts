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
  /** 둘째 줄 배지(ETF·ETN·KRX 대체·거래정지·NXT 거래정지) */
  badges: string[];
  value: number | null;
  price: number | null;
  hidden: boolean;
  error?: string;
  /** 마지막 성공 결과를 보여 주는 중이면 그 결과의 계산 시각 */
  staleAt?: number;
  /** 1일 차트의 거래일과 다른(이전) 거래일의 결과면 그 거래일. 이 종목은 차트에 그리지 않는다. */
  prevDay?: string;
  /** 이름 옆 NXT 배지(NXT 지원이고 NXT가 정지되지 않았을 때) */
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

/** 거래정지 표시 규칙: KRX 정지, 또는 NXT 모드에서 NXT 정지. badgesOf의 거래정지·NXT 거래정지 배지와 같은 규칙이며, 일봉 차트 정지 띠가 쓴다. */
export function isSuspended(meta: StockMeta | undefined, venueMode: VenueMode): boolean {
  return !!meta?.krxSuspended || (venueMode === 'NXT' && meta?.nxtSuspended === true);
}

function badgesOf(s: RowSource, venueMode: VenueMode): string[] {
  const out: string[] = [];
  const type = s.meta?.securityType;
  if (type === 'ETF' || type === 'ETN') out.push(type);
  if (venueMode === 'NXT' && s.series?.intervals.some((iv) => iv.fallback)) out.push('KRX 대체');
  // NXT 모드에서 NXT만 정지면 종목 상세와 같은 말로 `NXT 거래정지`. KRX가 정지면(둘 다 포함) `거래정지`.
  if (s.meta?.krxSuspended) out.push('거래정지');
  else if (venueMode === 'NXT' && s.meta?.nxtSuspended === true) out.push('NXT 거래정지');
  return out;
}

export function buildRows(
  sources: RowSource[],
  opts: {
    scrubT: number | null;
    venueMode: VenueMode;
    /** 1일 차트가 보여 주는 거래일. 다른 거래일의 시리즈는 이전 값으로 표시한다(일봉에서는 주지 않는다). */
    chartDate?: string | null;
  },
): LeaderRow[] {
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
    // NXT가 정지된 종목은 NXT 배지를 보이지 않는다(거래할 수 있는 것처럼 보이지 않게).
    if (s.meta) row.nxt = s.meta.nxtSupported && s.meta.nxtSuspended !== true;
    if (s.error) row.error = s.error;
    else if (!s.series) row.loading = true;
    if (s.series?.stale) row.staleAt = s.series.computedAt;
    if (s.series && opts.chartDate && s.series.tradingDate !== opts.chartDate) {
      row.staleAt = s.series.computedAt;
      row.prevDay = s.series.tradingDate;
    }
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
