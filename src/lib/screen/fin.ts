// 재무·가치(스펙 2.3·3.1): 공시 시점 규칙과 최근 4분기 합(TTM) 지표.
// 재선정일 d의 전 거래일 p에는 finKnownFrom < p인 분기만 쓴다. 쓸 수 있는 마지막 분기 L에서
// [L−3, L]이 TTM, [L−7, L−4]가 1년 전 TTM이다. 모자라거나 분모가 0 이하이면 그 지표는 NaN(계산 불가)이다.
import type { FinSeries } from '../marketData/format';
import type { Precomputed, StockSeries } from './precompute';
import type { FinMetric, SelectionCriteria } from './types';

/** 재무 금액 단위(억 원) → 원 */
export const FIN_UNIT = 1e8;
/** 분기말에서 쓸 수 있게 되기까지의 날수: 연간 결산 분기 100일, 그 밖 60일(결정 D1) */
export const FIN_LAG_ANNUAL = 100;
export const FIN_LAG_QUARTER = 60;
const DAY_MS = 86_400_000;

/** 종목 하나의 재무 미리 계산. 배열 위치 k는 분기 q[k] */
export interface StockFin {
  q: string[]; // 분기말 YYYYMM
  known: string[]; // finKnownFrom(q[k], a[k] = 1), YYYYMMDD. q 순서대로 오름차순이다
  /** 매출·영업이익·순이익 누적합(억 원), 길이 n + 1: x[k] = 값[0] + … + 값[k − 1] */
  rev: Float64Array;
  op: Float64Array;
  ni: Float64Array;
  eq: number[]; // 분기말 자본총계(억 원)
  debt: number[]; // 분기말 부채총계(억 원)
}

/** p에서 쓸 수 있는 재무 지표(스펙 3.1). NaN은 계산 불가 */
export interface FinValues {
  quarter: string; // 쓴 마지막 분기 L의 YYYYMM
  per: number;
  pbr: number;
  roe: number; // %
  opMargin: number; // %
  revGrowth: number; // %
  opGrowth: number; // %
  debtRatio: number; // %
  ttmNi: number; // TTM 순이익(억 원). 흑자 조건은 > 0
}

/** 분기말(그 달 말일) + 100일(연간 결산 분기) 또는 60일. YYYYMMDD */
export function finKnownFrom(q: string, annual: boolean): string {
  const monthEnd = Date.UTC(Number(q.slice(0, 4)), Number(q.slice(4, 6)), 0);
  return new Date(monthEnd + (annual ? FIN_LAG_ANNUAL : FIN_LAG_QUARTER) * DAY_MS).toISOString().slice(0, 10).replaceAll('-', '');
}

/** known < p(둘 다 YYYYMMDD)인 마지막 인덱스. p 당일에 알려지는 분기는 아직 쓰지 않는다. 없으면 −1 */
export function lastKnownQuarter(known: string[], p: string): number {
  let lo = 0;
  let hi = known.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (known[mid] < p) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

function prefix(a: number[]): Float64Array {
  const out = new Float64Array(a.length + 1);
  for (let k = 0; k < a.length; k++) out[k + 1] = out[k] + a[k];
  return out;
}

/** 파일의 재무를 미리 계산한다(스펙 3.4) */
export function stockFin(fs: FinSeries): StockFin {
  return {
    q: fs.q,
    known: fs.q.map((q, k) => finKnownFrom(q, fs.a[k] === 1)),
    rev: prefix(fs.rev),
    op: prefix(fs.op),
    ni: prefix(fs.ni),
    eq: fs.eq,
    debt: fs.debt,
  };
}

/** 재무 정렬 지표. 기존 프로필에 없으면 PER(스펙 3.2) */
export const rankFinOf = (c: SelectionCriteria): FinMetric => c.rank.fin?.metric ?? 'per';

/** 낮을수록 앞인 정렬 지표 */
export const finAscending = (m: FinMetric): boolean => m === 'per' || m === 'pbr';

// 0 이하·NaN이면 NaN: 나누는 값이 0 이하이면 계산 불가로 만든다
const positive = (x: number): number => (x > 0 ? x : NaN);

// 경계를 포함하는 비교(v >= 20)가 부동소수 오차로 빗나가지 않게 소수 9자리로 맞춘다. NaN·±Infinity는 그대로
const r9 = (x: number): number => (Number.isFinite(x) ? Math.round(x * 1e9) / 1e9 : x);

/**
 * p(YYYY-MM-DD)의 재무 지표. pIdx는 그 종목의 p 봉 인덱스(없으면 −1)로, 시가총액에 그 봉의 종가를 쓴다.
 * 재무가 없거나 p에 알려진 분기가 없으면 null.
 */
export function finMetricsAt(pre: Precomputed, st: Pick<StockSeries, 'fin' | 'close' | 'shares'>, pIdx: number, p: string): FinValues | null {
  if (!pre.params.fin) throw new Error('재무를 미리 계산하지 않았어요');
  const f = st.fin;
  if (!f) return null;
  const L = lastKnownQuarter(f.known, p.replaceAll('-', ''));
  if (L < 0) return null;
  // [from, to] 분기 합. from이 0보다 앞이면 NaN
  const sum = (a: Float64Array, from: number, to: number): number => (from < 0 ? NaN : a[to + 1] - a[from]);
  const ttm = (a: Float64Array) => sum(a, L - 3, L);
  const yearAgo = (a: Float64Array) => sum(a, L - 7, L - 4);
  const ni = ttm(f.ni);
  const rev = ttm(f.rev);
  const op = ttm(f.op);
  const eq = f.eq[L];
  // 시가총액(원): p 종가 × 상장주식수. 봉·종가가 없거나 주식 수가 0 이하이면 계산 불가(결정 D9)
  const close = pIdx >= 0 ? st.close[pIdx] : NaN;
  const cap = positive(close) * positive(st.shares);
  return {
    quarter: f.q[L],
    per: r9(cap / (positive(ni) * FIN_UNIT)),
    pbr: r9(cap / (positive(eq) * FIN_UNIT)),
    roe: r9(L >= 4 ? (ni / positive((eq + f.eq[L - 4]) / 2)) * 100 : NaN),
    opMargin: r9((op / positive(rev)) * 100),
    revGrowth: r9((rev / positive(yearAgo(f.rev)) - 1) * 100),
    opGrowth: r9((op / positive(yearAgo(f.op)) - 1) * 100),
    debtRatio: r9((f.debt[L] / positive(eq)) * 100),
    ttmNi: ni,
  };
}
