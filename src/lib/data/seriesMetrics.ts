// 불러온 시리즈 → 차트·리더보드에 쓰는 지표 점. 스펙 6.
import { fetchPlanFor } from '../market/periods';
import type { MetricId, Period } from '../state/schema';
import { kstDate } from '../time/kst';
import type { LoadedSeries } from './candleService';
import {
  changePct,
  drawdownPct,
  excessPct,
  marketCapTrillion,
  rvolDaily,
  rvolIntraday,
  type Point,
} from './metrics';

const RVOL_LOOKBACK = 20;

const closesOf = (s: LoadedSeries): Point[] => s.candles.map((c) => ({ t: c.t, v: c.c }));
const allNull = (s: LoadedSeries): Point[] => s.candles.map((c) => ({ t: c.t, v: null }));

/**
 * 시리즈 하나의 지표 점(봉마다 하나). 1일은 1분봉, 그 밖은 기간 안 일봉의 종가를 쓴다.
 * `base`·`avgDailyVolume`은 candleService가 이미 환산한 값이라 그대로 쓴다.
 * 지표에 필요한 값(기준 종가·지수·발행주식수)이 없으면 모든 값이 null.
 */
export function metricPoints(
  series: LoadedSeries,
  metric: MetricId,
  opts: {
    index?: LoadedSeries | null;
    /**
     * 초과수익: 이 시각(지수의 마지막 봉) 뒤의 종목 점은 null. 갱신에 실패해 이전 지수를 쓸 때
     * 새 종목 봉을 이전 지수 값과 짝짓지 않게 한다.
     */
    indexUntil?: number | null;
    period: Period;
  },
): Point[] {
  const closes = closesOf(series);
  const change = (s: LoadedSeries, points: Point[]) => changePct(points, s.base ?? Number.NaN);
  switch (metric) {
    case 'change':
      return change(series, closes);
    case 'drawdown':
      return drawdownPct(closes);
    case 'excess': {
      const index = opts.index;
      if (!index) return allNull(series);
      // 지수 등락률은 종목과 같은 기준일의 지수 종가로 다시 맞춘다. 지수 결과가 다른 기간 시작(이전 날 받은 stale 지수 등)이라
      // 지수 자체의 base가 달라도 기준이 섞이지 않는다. 그 날의 지수 종가가 없으면 계산하지 않는다.
      const baseDate = baseDateFor(series, opts.period);
      const indexBase = baseDate === null ? undefined : index.daily.find((c) => kstDate(c.t) === baseDate)?.c;
      if (indexBase === undefined) return allNull(series);
      const points = excessPct(change(series, closes), changePct(closesOf(index), indexBase));
      const until = opts.indexUntil;
      return until == null ? points : points.map((p) => (p.t > until ? { t: p.t, v: null } : p));
    }
    case 'rvol': {
      if (opts.period.unit === 'D') return rvolIntraday(series.candles, series.avgDailyVolume);
      const inPeriod = new Set(series.candles.map((c) => c.t));
      return rvolDaily(series.daily, RVOL_LOOKBACK).filter((p) => inPeriod.has(p.t));
    }
    case 'mcap':
      return series.sharesOutstanding === undefined ? allNull(series) : marketCapTrillion(closes, series.sharesOutstanding);
    default:
      return allNull(series);
  }
}

/** 기준 종가의 날짜(기간 시작 직전 일봉). 헤드라인 `기준 9/23 종가`에 쓴다. */
export function baseDateFor(series: LoadedSeries, period: Period): string | null {
  const { from } = fetchPlanFor(period, series.tradingDate);
  const before = series.daily.map((c) => kstDate(c.t)).filter((d) => d < from);
  return before.at(-1) ?? null;
}
