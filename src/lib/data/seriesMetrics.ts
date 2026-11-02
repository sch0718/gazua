// 불러온 시리즈 → 차트·리더보드에 쓰는 지표 점. 스펙 6.
import { fetchPlanFor } from '../market/periods';
import { rsi } from '../sim/indicators';
import type { MetricId, Period } from '../state/schema';
import { kstDate } from '../time/kst';
import type { LoadedSeries } from './candleService';
import {
  annualizedVolPct,
  changePct,
  drawdownPct,
  excessPct,
  marketCapTrillion,
  rvolDaily,
  rvolIntraday,
  type Point,
} from './metrics';

const RVOL_LOOKBACK = 20;
const VOL_WINDOW = 20;
const RSI_PERIOD = 14;

/**
 * 변동성·RSI 입력: 기간 첫 봉보다 앞선 일봉 종가(워밍업) + 기간 봉 종가. 기간 봉은 candles에서 가져와
 * 리더보드 값에 시세 반영(withQuote)이 들어간다. offset은 기간 첫 봉의 위치.
 */
function closesWithWarmup(series: LoadedSeries): { closes: number[]; offset: number } {
  const first = series.candles[0]?.t ?? Number.POSITIVE_INFINITY;
  const warmup = series.daily.filter((c) => c.t < first).map((c) => c.c);
  return { closes: [...warmup, ...series.candles.map((c) => c.c)], offset: warmup.length };
}

/**
 * RSI(14). 0 이하·유한하지 않은 종가가 처음 나온 봉부터는 null. rsi()는 그런 변화를 0으로 넘겨 값을 내지만,
 * Wilder 평활은 그 영향이 뒤로 계속 남아 믿을 수 없다.
 */
function rsiFromValidCloses(closes: number[]): (number | null)[] {
  const bad = closes.findIndex((c) => !Number.isFinite(c) || c <= 0);
  const values = rsi(closes, RSI_PERIOD);
  return bad < 0 ? values : values.map((v, i) => (i >= bad ? null : v));
}

/** 워밍업을 붙여 계산한 값에서 기간 봉 몫만 점으로 낸다. 유한하지 않은 값은 null. */
function periodPoints(series: LoadedSeries, values: (number | null)[], offset: number): Point[] {
  return series.candles.map((c, i) => {
    const v = values[offset + i] ?? null;
    return { t: c.t, v: v !== null && Number.isFinite(v) ? v : null };
  });
}

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
      const indexBase = indexBaseFor(series, index);
      if (indexBase === null) return allNull(series);
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
    case 'volatility':
    case 'rsi': {
      // 1개월 이상에서만 고를 수 있다(metricAvailability). 1일 분봉에는 일봉 워밍업을 붙일 수 없어 계산하지 않는다.
      if (opts.period.unit === 'D') return allNull(series);
      const { closes, offset } = closesWithWarmup(series);
      const values = metric === 'volatility' ? annualizedVolPct(closes, VOL_WINDOW) : rsiFromValidCloses(closes);
      return periodPoints(series, values, offset);
    }
    default:
      return allNull(series);
  }
}

/**
 * 초과수익의 지수 기준값: 종목 기준가를 낸 날(`series.baseDate`, NXT 모드에서도 KRX 일봉 기준)의 지수 종가.
 * 그날 지수 일봉이 없으면 null(기준이 섞이지 않게 계산하지 않는다).
 */
export function indexBaseFor(series: LoadedSeries, index: LoadedSeries): number | null {
  const date = series.baseDate;
  if (date === null) return null;
  return index.daily.find((c) => kstDate(c.t) === date)?.c ?? null;
}

/** 기준 종가의 날짜(기간 시작 직전 일봉). 헤드라인 `기준 9/23 종가`에 쓴다. */
export function baseDateFor(series: LoadedSeries, period: Period): string | null {
  const { from } = fetchPlanFor(period, series.tradingDate);
  const before = series.daily.map((c) => kstDate(c.t)).filter((d) => d < from);
  return before.at(-1) ?? null;
}
