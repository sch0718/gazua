// 환율·유가 계열(스펙 2.3·3.1·3.2): 공개 시점 규칙, 관측일 기준 짝짓기, 롤링 β, 흐름.
// 짝짓기는 관측일로, 쓸 수 있는가는 공개 시점(knownFrom)으로 정한다. 두 규칙을 섞지 않는다.
import type { MacroSeries } from '../marketData/format';
import { addDays, kstWeekday } from '../time/kst';
import type { MacroSeriesKey } from './types';

const iso = (ymd: string): string => `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;

/**
 * 관측일 obs(YYYYMMDD, 미국 날짜)의 값을 한국에서 쓸 수 있는 첫날(YYYY-MM-DD).
 * - usdkrw: 관측일이 속한 주(월~일)의 월요일 + 9일
 * - wti: 관측 다음 날 이후 첫 수요일 + 2일
 * 공개 일정이 바뀌면 이 함수만 고친다.
 */
export function macroKnownFrom(series: MacroSeriesKey, obs: string): string {
  const t = iso(obs);
  if (series === 'usdkrw') {
    const monday = addDays(t, -((kstWeekday(t) + 6) % 7));
    return addDays(monday, 9);
  }
  const next = addDays(t, 1);
  const wed = addDays(next, (3 - kstWeekday(next) + 7) % 7);
  return addDays(wed, 2);
}

/** 관측일 오름차순 계열. d는 관측일(YYYY-MM-DD), known은 d마다 knownFrom(비내림차순) */
export interface AlignedSeries {
  d: string[];
  v: number[];
  known: string[];
}

export function alignSeries(key: MacroSeriesKey, s: MacroSeries | undefined): AlignedSeries {
  if (!s) return { d: [], v: [], known: [] };
  return { d: s.d.map(iso), v: s.v.slice(), known: s.d.map((o) => macroKnownFrom(key, o)) };
}

/** 봉마다 짝지을 관측값 인덱스: 관측일이 봉 날짜보다 앞선 마지막 관측값. 없으면 -1. 두 배열 모두 오름차순 */
export function pairIndices(barDates: string[], obs: string[]): Int32Array {
  const out = new Int32Array(barDates.length);
  let k = -1;
  for (let i = 0; i < barDates.length; i++) {
    while (k + 1 < obs.length && obs[k + 1] < barDates[i]) k++;
    out[i] = k;
  }
  return out;
}

/** 분산이 0으로 볼 만큼 작은지: 누적합 뺄셈 오차를 넘지 않는 크기 */
const VAR_EPS = 1e-12;

/**
 * 롤링 β. i번 값은 i번 봉에서 끝나는 창(쌍 i−betaDays+1..i)의 OLS 기울기 cov(r, x) / var(x).
 * 쌍 i는 r = c_i / c_{i−1} − 1, x = a_i / a_{i−1} − 1. a는 봉마다 짝지은 계열 값(없으면 NaN).
 * 두 계열 값이 모두 0보다 크고 변화율이 유한한 쌍만 쓴다. 창이 다 차기 전(i < betaDays),
 * 쓸 수 있는 쌍이 betaDays × 0.8개보다 적거나, x ≠ 0인 쌍이 2개보다 적거나, 분산이 0이면 NaN.
 */
export function rollingBeta(close: number[], a: ArrayLike<number>, betaDays: number): Float64Array {
  const n = close.length;
  const out = new Float64Array(n).fill(NaN);
  const xs = new Float64Array(n).fill(NaN);
  const rs = new Float64Array(n).fill(NaN);
  for (let i = 1; i < n; i++) {
    if (!(a[i] > 0 && a[i - 1] > 0)) continue;
    const x = a[i] / a[i - 1] - 1;
    const r = close[i] / close[i - 1] - 1;
    if (!Number.isFinite(x) || !Number.isFinite(r)) continue;
    xs[i] = x;
    rs[i] = r;
  }
  const min = betaDays * 0.8;
  let cnt = 0;
  let moving = 0; // 창 안에서 x ≠ 0인 쌍 수
  let sx = 0;
  let sr = 0;
  let sxr = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(xs[i])) {
      cnt++;
      if (xs[i] !== 0) moving++;
      sx += xs[i];
      sr += rs[i];
      sxr += xs[i] * rs[i];
      sxx += xs[i] * xs[i];
    }
    const o = i - betaDays;
    if (o >= 1 && !Number.isNaN(xs[o])) {
      cnt--;
      if (xs[o] !== 0) moving--;
      sx -= xs[o];
      sr -= rs[o];
      sxr -= xs[o] * rs[o];
      sxx -= xs[o] * xs[o];
    }
    // 창이 비면 쌓인 오차를 버린다. x가 모두 0이면 x가 든 합은 정확히 0이다
    if (cnt === 0) sx = sr = sxr = sxx = 0;
    if (moving === 0) sx = sxr = sxx = 0;
    if (i < betaDays || cnt < min || moving < 2) continue;
    const vx = sxx - (sx * sx) / cnt;
    if (!(sxx > 0) || !(vx > sxx * VAR_EPS)) continue;
    out[i] = (sxr - (sx * sr) / cnt) / vx;
  }
  return out;
}

/** known(비내림차순)에서 p 이하인 마지막 인덱스, 없으면 -1 */
export function lastKnown(known: string[], p: string): number {
  let lo = 0;
  let hi = known.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (known[mid] <= p) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/**
 * i*(p): 0..hi 봉 가운데 p에서 쌍이 확정된 마지막 봉. 없으면 -1.
 * 봉 i의 a(t_i)는 "t_i보다 앞선 마지막 관측값"이라, 그다음 관측값(idx[i] + 1)이 공개돼야
 * 그 사이에 다른 관측값이 없다는 것까지 안다. 그래서 다음 관측값의 knownFrom ≤ p여야 쓴다.
 * 계열이 봉보다 일찍 끝나면 마지막 관측값과 짝지은 봉은 끝내 쓰지 않는다.
 * idx와 knownFrom이 비내림차순이라 조건은 앞에서부터 이어진 구간이다.
 */
export function lastUsablePair(idx: Int32Array, known: string[], p: string, hi: number): number {
  let lo = 0;
  let h = hi + 1;
  while (lo < h) {
    const mid = (lo + h) >> 1;
    const next = idx[mid] + 1;
    if (next < known.length && known[next] <= p) lo = mid + 1;
    else h = mid;
  }
  return lo - 1;
}

/**
 * p에서 공개된 관측값끼리의 흐름: o_k / o_{k−lookback} − 1(k = knownFrom ≤ p인 마지막 관측값).
 * 앞선 관측값이 모자라거나 두 끝 중 하나가 0 이하이면 NaN.
 */
export function trendAt(s: AlignedSeries, p: string, lookback: number): number {
  const k = lastKnown(s.known, p);
  if (k - lookback < 0) return NaN;
  const a = s.v[k];
  const b = s.v[k - lookback];
  if (!(a > 0 && b > 0)) return NaN;
  return a / b - 1;
}
