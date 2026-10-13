// 리더보드 행 만들기와 정렬(스펙 7.2-6, 4.3). 화면과 무관한 순수 함수.
import type { SeriesSlot } from '../../chart/lineData';
import type { LoadedSeries } from '../../data/candleService';
import type { Point } from '../../data/metrics';
import type { VenueMode } from '../../market/tradable';
import type { Quote, StockMeta } from '../../providers/types';
import type { WatchItem } from '../../state/schema';
import { kstDate } from '../../time/kst';

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

/** 행 옵션. buildRows와 rowSeries가 같은 값을 받아 가격과 값이 같은 규칙을 따른다. */
export interface RowOpts {
  scrubT: number | null;
  /** 1일 차트가 보여 주는 거래일. 다른 거래일의 시리즈는 이전 값으로 표시한다(일봉에서는 주지 않는다). */
  chartDate?: string | null;
  /** 현재 시각(시세가 오늘 것인지 판정) */
  now: number;
}

function priceOf(s: RowSource, opts: RowOpts): number | null {
  const series = s.series;
  if (!series) return null;
  const closes = series.candles.map((c) => ({ t: c.t, v: c.c }));
  if (opts.scrubT !== null) return valueAt(closes, opts.scrubT);
  // 시세는 값 계산에 쓰였을 때만 보인다(가격과 %가 늘 같은 근거). 아니면 마지막 캔들 종가.
  if (s.quote && rowSeries(series, s.quote, opts) !== series) return s.quote.price;
  return valueAt(closes, null);
}

/**
 * 행 값·가격의 근거 시리즈: 스크럽 중이거나 차트와 다른 거래일의 결과면 원래 시리즈, 아니면 withQuote.
 * 비교 화면은 이 결과로 행 지표 값을 계산하고, buildRows는 같은 판정으로 가격에 시세를 쓸지 정한다.
 */
export function rowSeries<S extends LoadedSeries & { stale?: boolean }>(series: S, quote: Quote | undefined, opts: RowOpts): S {
  if (opts.scrubT !== null) return series;
  if (opts.chartDate && series.tradingDate !== opts.chartDate) return series;
  return withQuote(series, quote, opts.now);
}

/**
 * 행 값용: 행 가격과 같은 5초 시세를 시리즈 끝에 반영한 사본(스펙 4.4·7.2-6). 차트·데이터 표는 원래 캔들을 쓴다.
 * 1일(분봉)은 시세 시각에 합성 종가 봉(v:0)을 붙이고, 일봉은 오늘 봉의 종가만 바꾼다(거래량 유지).
 * 이전 결과(stale), 시리즈 마지막 구간과 다른 거래소의 시세, 마지막 봉보다 새롭지 않은 시세,
 * 오늘(1일은 시리즈 거래일)이 아닌 시세는 반영하지 않고 같은 객체를 돌려준다. 스크럽·이전 거래일 판정은 rowSeries가 한다.
 */
export function withQuote<S extends LoadedSeries & { stale?: boolean }>(series: S, quote: Quote | undefined, now: number): S {
  const last = series.candles.at(-1);
  if (series.stale || !quote || quote.ts === null || !last) return series;
  if (series.segments.at(-1)?.venue !== quote.venue) return series;
  if (quote.ts <= last.t) return series;
  const quoteDay = kstDate(quote.ts);
  if (quoteDay !== kstDate(now)) return series;
  const price = quote.price;
  // 일봉(자정 시각)은 series.daily에 같은 봉이 있다. 분봉은 세션 안 시각이라 겹치지 않는다.
  if (series.daily.some((d) => d.t === last.t)) {
    if (kstDate(last.t) !== quoteDay) return series;
    return { ...series, candles: [...series.candles.slice(0, -1), { ...last, c: price }] };
  }
  if (series.tradingDate !== quoteDay) return series;
  return { ...series, candles: [...series.candles, { t: quote.ts, o: price, h: price, l: price, c: price, v: 0 }] };
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
  opts: RowOpts & { venueMode: VenueMode },
): LeaderRow[] {
  return sources.map((s): LeaderRow => {
    const row: LeaderRow = {
      symbol: s.item.symbol,
      name: s.meta?.name ?? s.item.symbol,
      slot: s.item.colorSlot,
      badges: badgesOf(s, opts.venueMode),
      value: s.points ? valueAt(s.points, opts.scrubT) : null,
      price: priceOf(s, opts),
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
