// 1일 차트의 「최근 구간」 값: 구간 시작 시각의 종가를 0으로 다시 맞춘 등락률·초과수익과 그 구간의 거래량 속도.
// 비교 화면의 기준 칩(전일 대비·60·30·15·5분)과 리더보드 보조 숫자가 쓴다.
import type { MetricId, Period } from '../state/schema';
import type { LoadedSeries } from './candleService';
import { changePct, excessPct, type Candle, type Point } from './metrics';
import { indexBaseFor } from './seriesMetrics';

export const RECENT_WINDOWS = [0, 60, 30, 15, 5] as const;
/** 0은 전일 대비(구간 없음), 그 밖은 분 */
export type RecentWindow = (typeof RECENT_WINDOWS)[number];

/** 전일 대비로 볼 때 리더보드 보조 숫자의 구간(분) */
export const SUB_WINDOW_MIN = 15;
/** 구간으로 볼 때 순위 변화(▲▼)를 견줄 시점(분 전) */
export const RANK_LOOKBACK_MIN = 5;

const MINUTE_MS = 60_000;

/** 구간 기준을 쓸 수 있는 조합: 1일 기간의 등락률·초과수익. */
export function windowApplies(period: Period, metric: MetricId): metric is 'change' | 'excess' {
  return period.unit === 'D' && (metric === 'change' || metric === 'excess');
}

export const windowStart = (end: number, minutes: number) => end - minutes * MINUTE_MS;

/** t 이하에서 종가가 있는 마지막 봉의 위치. 없으면 -1. */
function lastAtOrBefore(candles: Candle[], t: number): number {
  for (let i = candles.length - 1; i >= 0; i--) {
    const c = candles[i];
    if (c.t <= t && Number.isFinite(c.c) && c.c > 0) return i;
  }
  return -1;
}
const closeAtOrBefore = (candles: Candle[], t: number): number | null => {
  const i = lastAtOrBefore(candles, t);
  return i < 0 ? null : candles[i].c;
};

/**
 * 구간 시작(start) 이하 마지막 봉의 종가를 0으로 맞춘 점. 그 기준 봉(0)부터 값이 있고, 앞선 봉은 null.
 * start까지 봉이 없으면(장 시작 직후) 전일 종가(series.base)를 기준으로 쓴다.
 * 초과수익은 같은 구간의 지수 변화를 뺀다. 지수도 start 이하 마지막 봉, 없으면 기준일 지수 종가.
 */
export function windowPoints(
  series: LoadedSeries,
  metric: 'change' | 'excess',
  start: number,
  opts: { index?: LoadedSeries | null; indexUntil?: number | null } = {},
): Point[] {
  const allNull = () => series.candles.map((c) => ({ t: c.t, v: null }));
  const baseAt = lastAtOrBefore(series.candles, start);
  const base = baseAt >= 0 ? series.candles[baseAt].c : (series.base ?? Number.NaN);
  const stock = changePct(
    series.candles.map((c, i) => ({ t: c.t, v: i < baseAt ? null : c.c })),
    base,
  );
  if (metric === 'change') return stock;
  const index = opts.index;
  if (!index) return allNull();
  const indexBase = closeAtOrBefore(index.candles, start) ?? indexBaseFor(series, index);
  if (indexBase === null) return allNull();
  const points = excessPct(stock, changePct(index.candles.map((c) => ({ t: c.t, v: c.c })), indexBase));
  const until = opts.indexUntil;
  return until == null ? points : points.map((p) => (p.t > until ? { t: p.t, v: null } : p));
}

/**
 * 거래량 속도: (start, end] 구간의 분당 거래량 ÷ 오늘 첫 봉부터 end까지의 분당 거래량.
 * 1보다 크면 오늘 평소보다 빠르게 거래되고 있다는 뜻. 오늘 지난 시간이 구간의 두 배가 안 되거나 거래량이 없으면 null.
 */
export function volumePace(candles: Candle[], start: number, end: number): number | null {
  const first = candles[0]?.t;
  if (first === undefined || end <= start) return null;
  const windowMin = (end - start) / MINUTE_MS;
  const elapsedMin = (end - first) / MINUTE_MS + 1;
  if (elapsedMin < windowMin * 2) return null;
  let inWindow = 0;
  let total = 0;
  for (const c of candles) {
    if (c.t > end) break;
    total += c.v;
    if (c.t > start) inWindow += c.v;
  }
  if (total <= 0) return null;
  return inWindow / windowMin / (total / elapsedMin);
}
