// 투자자 수급(스펙 2.3·3.2·3.3): 순매수 비율과 연속 순매수 일수.
// 재선정일 d의 전 거래일 p에 대해, 수급은 p보다 앞선 날(종목 봉 위치 pIdx − 1)까지만 쓴다.
// 수급 구간 [from, 수급 끝] 밖은 0으로 보지 않고 계산 불가로 둔다.
import type { Precomputed, StockSeries } from './precompute';
import type { FlowWho } from './types';

/** 원천 주체: 외국인·기관·개인. both는 외국인과 기관 두 배열을 쓴다 */
export type FlowSubject = 'f' | 'i' | 'p';

/** 종목 하나의 수급 미리 계산. 배열 위치 j는 그 종목 봉 from + j */
export interface StockFlow {
  from: number; // 수급 시작 봉 인덱스
  len: number; // 수급 길이 L(수급 끝 = from + L − 1)
  /** 쓰는 주체만: 길이 L + 1 누적합(백만 원) */
  net: Partial<Record<FlowSubject, Float64Array>>;
  /** 수급 구간의 거래대금(원) 누적합, 길이 L + 1. 비율을 쓰지 않으면 길이 0 */
  tv: Float64Array;
  /** 연속 순매수를 켠 주체의 "그날까지 이어진 순매수 일수", 길이 L. 쓰지 않으면 길이 0 */
  streak: Int32Array;
}

/** 순매수 금액 단위(백만 원) → 원 */
export const FLOW_UNIT = 1e6;

/** 주체가 쓰는 원천 배열 */
export const subjectsOf = (who: FlowWho): FlowSubject[] => (who === 'both' ? ['f', 'i'] : [who === 'foreign' ? 'f' : who === 'inst' ? 'i' : 'p']);

/** 길이 n + 1 누적합: out[j] = net[0] + … + net[j − 1] */
export function flowPrefix(net: ArrayLike<number>): Float64Array {
  const out = new Float64Array(net.length + 1);
  for (let j = 0; j < net.length; j++) out[j + 1] = out[j] + net[j];
  return out;
}

/** j번 값 = j번 날까지, 모든 주체가 함께 > 0인 날이 이어진 수. 배열 앞(from)보다 앞날은 세지 않는다 */
export function flowStreak(...nets: ArrayLike<number>[]): Int32Array {
  const n = nets.length ? nets[0].length : 0;
  const out = new Int32Array(n);
  for (let j = 0; j < n; j++) out[j] = nets.every((a) => a[j] > 0) ? (j > 0 ? out[j - 1] : 0) + 1 : 0;
  return out;
}

/** e = pIdx − 1을 수급 배열 위치로 바꾼다. 수급이 없거나, e가 from 앞이거나 수급 끝 뒤면 −1 */
export function flowEnd(st: Pick<StockSeries, 'flow'>, pIdx: number): number {
  const fl = st.flow;
  if (!fl || pIdx < 0) return -1;
  const e = pIdx - 1 - fl.from;
  return e >= 0 && e < fl.len ? e : -1;
}

/**
 * 순매수 비율(%) = Σ net[e−days+1..e] × 1e6 / Σ tv[e−days+1..e] × 100.
 * 창이 수급 구간을 벗어나거나 분모가 0 이하이면 NaN. both이면 [외국인, 기관].
 * 미리 계산에 그 주체의 누적합이 없으면 던진다(조용히 탈락시키지 않게).
 */
export function flowRatio(pre: Precomputed, st: Pick<StockSeries, 'flow'>, who: FlowWho, days: number, pIdx: number): number | [number, number] {
  if (!pre.params.flow?.whos.includes(who)) throw new Error(`수급 누적합을 계산하지 않았어요: ${who}`);
  const subjects = subjectsOf(who);
  const e = flowEnd(st, pIdx);
  const start = e - days + 1;
  let ratios: number[];
  if (e < 0 || start < 0) ratios = subjects.map(() => NaN);
  else {
    const fl = st.flow!;
    const den = fl.tv[e + 1] - fl.tv[start];
    ratios = subjects.map((k) => {
      const net = fl.net[k]!;
      // 소수 9자리로 맞춰 경계(>= 최소)가 부동소수 오차로 빗나가지 않게 한다
      return den > 0 ? Math.round((((net[e + 1] - net[start]) * FLOW_UNIT) / den) * 100 * 1e9) / 1e9 : NaN;
    });
  }
  return who === 'both' ? [ratios[0], ratios[1]] : ratios[0];
}
