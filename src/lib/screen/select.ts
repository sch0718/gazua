import type { Basket } from './baskets';
import { finAscending, finMetricsAt, rankFinOf, type FinValues } from './fin';
import { flowEnd, flowRatio } from './flow';
import { lastUsablePair, trendAt } from './macro';
import { flowParams, RANK_RETURN_DAYS, RANK_VOL_DAYS, rankFlowOf, stableJson, usesMacro, type Precomputed, type StockSeries } from './precompute';
import type { FinMetric, FlowWho, MacroSeriesKey, SelectionCriteria } from './types';
import { usesFin, usesFlow } from './validate';

export interface Selection {
  date: string;
  passed: number; // 조건 통과 수
  picked: { symbol: string; values: Record<string, number | boolean | null> }[];
}

export class PrecomputeMismatchError extends Error {
  constructor(what: string) {
    super(`미리 계산한 지표와 기준이 달라요: ${what}`);
    this.name = 'PrecomputeMismatchError';
  }
}

// 이 기준이 쓰는 값이 미리 계산과 다르거나 계산되지 않았으면 거부한다(조용히 모두 탈락시키지 않게)
function assertMatches(pre: Precomputed, c: SelectionCriteria): void {
  const k = c.conditions;
  const p = pre.params;
  if ((k.tradingValue.on || c.rank.by === 'tradingValue') && k.tradingValue.days !== p.tvDays) throw new PrecomputeMismatchError('거래대금 일수');
  if (k.vsMa.on && k.vsMa.period !== p.maPeriod) throw new PrecomputeMismatchError('이동평균 기간');
  if ((k.volatility.on || c.rank.by === 'lowVolatility') && (k.volatility.on ? k.volatility.days : RANK_VOL_DAYS) !== p.volDays)
    throw new PrecomputeMismatchError('변동성 일수');
  if (k.rebound.on) {
    if (p.reboundEntryKey == null) throw new PrecomputeMismatchError('반등 패턴');
    // 저장된 전략을 가리키면 여기서는 해석할 수 없으므로 계산 여부만 본다
    if (k.rebound.pattern.from === 'custom' && stableJson(k.rebound.pattern.entry) !== p.reboundEntryKey)
      throw new PrecomputeMismatchError('반등 패턴');
  }
  if (usesMacro(c) && k.macro.betaDays !== p.betaDays) throw new PrecomputeMismatchError('민감도 계산 기간');
  if (usesFlow(c)) {
    const want = flowParams(c)!;
    if (!p.flow || want.whos.some((w) => !p.flow!.whos.includes(w)) || (want.streakWho != null && want.streakWho !== p.flow.streakWho))
      throw new PrecomputeMismatchError('투자자 매매동향');
  }
  if (usesFin(c) && !p.fin) throw new PrecomputeMismatchError('재무');
}

const MACRO_KEYS: readonly MacroSeriesKey[] = ['usdkrw', 'wti'];

/** p에서 쓸 수 있는 마지막 쌍 i*(p)의 β. pIdx는 그 종목의 p 봉 인덱스. 없으면 NaN */
export function betaAt(pre: Precomputed, st: StockSeries, key: MacroSeriesKey, p: string, pIdx: number): number {
  const i = lastUsablePair(st.macroIdx[key], pre.macro[key].known, p, pIdx);
  return i < 0 ? NaN : st.beta[key][i];
}

const orNull = (x: number): number | null => (Number.isNaN(x) ? null : x);

/** 수급 비율을 숫자 하나로: both이면 두 비율 중 작은 값(정렬). 하나라도 계산 불가면 NaN(Math.min이 NaN을 남긴다) */
const minRatio = (r: number | [number, number]): number => (Array.isArray(r) ? Math.min(r[0], r[1]) : r);

/** p 봉에서 e(= p − 1)까지 이어진 연속 순매수 일수. 계산 불가면 −1 */
function streakAt(st: StockSeries, pIdx: number): number {
  const e = flowEnd(st, pIdx);
  return e < 0 ? -1 : st.flow!.streak[e];
}

/** 이 기준이 쓰는 수급 값(조건·정렬)을 그 종목에서 모두 계산할 수 있는가 */
function flowComputable(pre: Precomputed, c: SelectionCriteria, st: StockSeries, pIdx: number): boolean {
  const fl = c.conditions.flow;
  const ok = (who: FlowWho, days: number) => !Number.isNaN(minRatio(flowRatio(pre, st, who, days, pIdx)));
  if (fl.amount.on && !ok(fl.amount.who, fl.amount.days)) return false;
  if (fl.streak.on && flowEnd(st, pIdx) < 0) return false;
  if (c.rank.by === 'flow' && !ok(rankFlowOf(c).who, rankFlowOf(c).days)) return false;
  return true;
}

/** 이 기준이 쓰는 재무 지표(조건·정렬)를 그 값에서 모두 계산할 수 있는가. 흑자는 TTM 순이익이 있으면 계산 가능 */
function finComputable(c: SelectionCriteria, v: FinValues | null): boolean {
  if (!v) return false;
  const f = c.conditions.fin;
  const metrics: FinMetric[] = (['per', 'pbr', 'roe', 'opMargin', 'revGrowth', 'opGrowth'] as const).filter((m) => f[m].on);
  if (c.rank.by === 'fin') metrics.push(rankFinOf(c));
  if (metrics.some((m) => Number.isNaN(v[m]))) return false;
  if (f.debtRatio.on && Number.isNaN(v.debtRatio)) return false;
  return !(f.profitable.on && Number.isNaN(v.ttmNi));
}

const EOK = 1e8;
const SELECTABLE = ['STOCK', 'ETF'];

// a에서 x 이상인 첫 인덱스
function lowerBound(a: string[], x: string): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

type PoolOverride = Pick<SelectionCriteria['pool'], 'markets' | 'types'>;
type BasketRef = Pick<Basket, 'id' | 'symbols'>;

/** d의 전 거래일 p와 종목별 p 봉 인덱스. 그 종목의 d 전 마지막 봉이 축의 전 거래일이 아니면 -1 */
function barsAt(d: string, pre: Precomputed): { prevDay: string; pIdx: number[] } | null {
  const ai = lowerBound(pre.axis, d);
  if (ai === 0) return null;
  const prevDay = pre.axis[ai - 1];
  const pIdx = pre.stocks.map((st) => {
    const i = lowerBound(st.d, d) - 1;
    return i >= 0 && st.d[i] === prevDay ? i : -1;
  });
  return { prevDay, pIdx };
}

/** 후보 범위(스펙 4.1): 시장·종류·관리종목 AND (업종 ∪ 테마 종목 ∪ 묶음 종목). 데이터에 없는 테마·지워진 묶음은 빈 것 */
function poolFilter(pre: Precomputed, c: SelectionCriteria, poolOverride: PoolOverride | undefined, baskets: BasketRef[]) {
  const pool = { ...c.pool, ...poolOverride };
  // 업종 코드를 (레벨, 이름) 묶음 키로 바꾼다. 목록에 없는 코드는 코드 그대로. 저장된 코드 하나가 그 묶음 전체를 고른다
  const group = (code: string): string => pre.sectorKey.get(code) ?? `#${code}`;
  const wanted = new Set(pool.sectors.filter((x) => x !== '').map(group));
  const restricted = pool.sectors.length > 0 || pool.themes.length > 0 || pool.baskets.length > 0;
  const listed = new Set<string>();
  for (const t of pool.themes) for (const x of pre.themes.get(t) ?? []) listed.add(x);
  for (const id of pool.baskets) for (const x of baskets.find((b) => b.id === id)?.symbols ?? []) listed.add(x);
  const inSector = (st: StockSeries): boolean =>
    (st.sec[0] !== '' && wanted.has(group(st.sec[0]))) || (st.sec[1] !== '' && wanted.has(group(st.sec[1])));
  return {
    group,
    has: (st: StockSeries): boolean =>
      SELECTABLE.includes(st.t) &&
      pool.markets.includes(st.m) &&
      pool.types.includes(st.t as 'STOCK' | 'ETF') &&
      !(pool.excludeManaged && (st.managed || st.halted)) &&
      (!restricted || inSector(st) || listed.has(st.s)),
  };
}

/** 재선정일 d에 후보 범위의 종목(p에 봉이 있는)이 있는데 모두 그 계열 β가 없는가. 후보가 없으면 false */
export function betaMissingAt(d: string, pre: Precomputed, c: SelectionCriteria, key: MacroSeriesKey, baskets: BasketRef[] = []): boolean {
  const at = barsAt(d, pre);
  if (!at || pre.params.betaDays == null) return false;
  const { has } = poolFilter(pre, c, undefined, baskets);
  let any = false;
  for (let j = 0; j < pre.stocks.length; j++) {
    const st = pre.stocks[j];
    if (at.pIdx[j] < 0 || !has(st)) continue;
    if (!Number.isNaN(betaAt(pre, st, key, at.prevDay, at.pIdx[j]))) return false;
    any = true;
  }
  return any;
}

/** 재선정일 d에 후보 범위의 종목(p에 봉이 있는)이 있는데 모두 수급 값을 계산할 수 없는가. 수급을 쓰지 않거나 후보가 없으면 false */
export function flowMissingAt(d: string, pre: Precomputed, c: SelectionCriteria, baskets: BasketRef[] = []): boolean {
  if (!usesFlow(c) || pre.params.flow == null) return false;
  const at = barsAt(d, pre);
  if (!at) return false;
  const { has } = poolFilter(pre, c, undefined, baskets);
  let any = false;
  for (let j = 0; j < pre.stocks.length; j++) {
    const st = pre.stocks[j];
    if (at.pIdx[j] < 0 || !has(st)) continue;
    if (flowComputable(pre, c, st, at.pIdx[j])) return false;
    any = true;
  }
  return any;
}

/** 재선정일 d에 후보 범위의 종목(p에 봉이 있는)이 있는데 모두 재무 값을 계산할 수 없는가. 재무를 쓰지 않거나 후보가 없으면 false */
export function finMissingAt(d: string, pre: Precomputed, c: SelectionCriteria, baskets: BasketRef[] = []): boolean {
  if (!usesFin(c) || pre.params.fin == null) return false;
  const at = barsAt(d, pre);
  if (!at) return false;
  const { has } = poolFilter(pre, c, undefined, baskets);
  let any = false;
  for (let j = 0; j < pre.stocks.length; j++) {
    const st = pre.stocks[j];
    if (at.pIdx[j] < 0 || !has(st)) continue;
    if (finComputable(c, finMetricsAt(pre, st, at.pIdx[j], at.prevDay))) return false;
    any = true;
  }
  return any;
}

/**
 * 재선정일 d의 선별(스펙 6.1). 모든 값은 축의 전 거래일 p의 봉까지만 쓴다.
 * 순서: 후보 범위 → 조건 → 정렬 → 상위 take
 */
export function selectAt(
  d: string,
  pre: Precomputed,
  c: SelectionCriteria,
  poolOverride?: PoolOverride,
  baskets: BasketRef[] = [],
): Selection {
  assertMatches(pre, c);
  const at = barsAt(d, pre);
  if (!at) return { date: d, passed: 0, picked: [] };
  const { prevDay, pIdx } = at;
  const mcap = (j: number): number => pre.stocks[j].close[pIdx[j]] * pre.stocks[j].shares;

  const k = c.conditions;
  const { group, has: inPool } = poolFilter(pre, c, poolOverride, baskets);
  const leaderRank = k.leader.on ? rankLeaders(pre.stocks, pIdx, mcap, k.leader.level, group) : null;
  // 계열 흐름은 종목과 무관하다. p에서 공개된 관측값끼리 한 번 계산한다(스펙 3.2)
  const trend: Record<MacroSeriesKey, number> = { usdkrw: NaN, wti: NaN };
  for (const key of MACRO_KEYS) {
    const t = k.macro[key].trend;
    if (t.on) trend[key] = trendAt(pre.macro[key], prevDay, t.lookback);
  }
  const returnDays = k.returnRange.on ? k.returnRange.days : RANK_RETURN_DAYS;
  const ret = (st: StockSeries, p: number): number | null => (p - returnDays >= 0 ? (st.close[p] / st.close[p - returnDays] - 1) * 100 : null);
  const finUsed = usesFin(c);

  const passed: { symbol: string; key: number | null; values: Selection['picked'][number]['values'] }[] = [];
  pre.stocks.forEach((st, j) => {
    const p = pIdx[j];
    if (p < 0) return;
    if (!inPool(st)) return;

    // 조건(AND)
    const values: Selection['picked'][number]['values'] = {};
    const cp = st.close[p];
    if (k.marketCap.on) {
      const v = mcap(j);
      if (!(v >= k.marketCap.minEok * EOK)) return;
      values.marketCap = v;
    }
    if (k.tradingValue.on) {
      const v = st.tvAvg[p];
      if (v == null || !(v >= k.tradingValue.minEok * EOK)) return;
      values.tradingValue = v;
    }
    if (k.leader.on) {
      const v = leaderRank![j];
      if (v == null || v > k.leader.maxRank) return;
      values.leaderRank = v;
    }
    if (k.returnRange.on) {
      const v = ret(st, p);
      if (v == null || v < k.returnRange.minPct || v > k.returnRange.maxPct) return;
      values.return = v;
    }
    if (k.vsMa.on) {
      const v = st.ma[p];
      if (v == null || (k.vsMa.side === 'above' ? !(cp > v) : !(cp < v))) return;
      values.ma = v;
    }
    if (k.fromHigh.on) {
      const hi = st.high[p];
      if (hi == null) return;
      const v = (1 - cp / hi) * 100;
      if (v < k.fromHigh.minPct || v > k.fromHigh.maxPct) return;
      values.fromHigh = v;
    }
    if (k.volatility.on) {
      const v = st.vol[p];
      if (v == null || v > k.volatility.maxPct) return;
      values.volatility = v;
    }
    if (k.rebound.on) {
      if (!(st.lastSignal[p] >= 0 && st.lastSignal[p] >= p - k.rebound.withinDays + 1)) return;
      values.rebound = true;
    }
    for (const key of MACRO_KEYS) {
      const m = k.macro[key];
      if (!m.beta.on && !m.trend.on) continue;
      const b = betaAt(pre, st, key, prevDay, p);
      if (m.beta.on && !(b >= m.beta.min && b <= m.beta.max)) return;
      if (m.trend.on) {
        const t = trend[key];
        if (Number.isNaN(t)) return;
        const thr = m.trend.thresholdPct / 100;
        if (t >= thr) {
          if (!(b >= m.trend.minAbsBeta)) return;
        } else if (t <= -thr) {
          if (!(b <= -m.trend.minAbsBeta)) return;
        } else if (m.trend.whenFlat === 'none') return;
        values[`${key}Trend`] = t * 100;
      }
      values[`${key}Beta`] = orNull(b);
    }
    // 수급은 e = p − 1까지만 쓴다(스펙 2.3). 계산 불가면 탈락
    const fa = k.flow.amount;
    if (fa.on) {
      const r = flowRatio(pre, st, fa.who, fa.days, p);
      const inRange = (x: number) => x >= fa.minPct && x <= fa.maxPct;
      if (Array.isArray(r)) {
        if (!(inRange(r[0]) && inRange(r[1]))) return;
        values.flowRatioForeign = r[0];
        values.flowRatioInst = r[1];
      } else {
        if (!inRange(r)) return;
        values.flowRatio = r;
      }
    }
    if (k.flow.streak.on) {
      const n = streakAt(st, p);
      if (!(n >= k.flow.streak.minDays)) return;
      values.flowStreak = n;
    }
    // 재무는 finKnownFrom < p인 분기만 쓴다(스펙 2.3). 계산 불가면 그 조건에서 탈락(3.2)
    let fin: FinValues | null = null;
    if (finUsed) {
      fin = finMetricsAt(pre, st, p, prevDay);
      if (!fin) return; // 알려진 분기가 없으면 어떤 재무 조건·정렬도 계산할 수 없다
      const f = k.fin;
      const range = (on: boolean, v: number, min: number, max: number, key: string): boolean => {
        if (!on) return true;
        if (!(v >= min && v <= max)) return false;
        values[key] = v;
        return true;
      };
      if (!range(f.per.on, fin.per, f.per.min, f.per.max, 'finPer')) return;
      if (!range(f.pbr.on, fin.pbr, f.pbr.min, f.pbr.max, 'finPbr')) return;
      if (!range(f.roe.on, fin.roe, f.roe.min, Infinity, 'finRoe')) return;
      if (!range(f.opMargin.on, fin.opMargin, f.opMargin.min, Infinity, 'finOpMargin')) return;
      if (!range(f.revGrowth.on, fin.revGrowth, f.revGrowth.min, Infinity, 'finRevGrowth')) return;
      if (!range(f.opGrowth.on, fin.opGrowth, f.opGrowth.min, Infinity, 'finOpGrowth')) return;
      if (!range(f.debtRatio.on, fin.debtRatio, -Infinity, f.debtRatio.max, 'finDebtRatio')) return;
      if (f.profitable.on && !(fin.ttmNi > 0)) return;
      values.finQuarter = Number(fin.quarter);
    }

    // 정렬 값
    let key: number | null;
    switch (c.rank.by) {
      case 'marketCap':
        key = values.marketCap = mcap(j);
        break;
      case 'tradingValue':
        key = values.tradingValue = st.tvAvg[p];
        break;
      case 'return':
        key = values.return = ret(st, p);
        break;
      case 'lowVolatility':
        key = st.vol[p];
        values.volatility = key;
        if (key != null) key = -key; // 낮을수록 앞
        break;
      case 'macroBeta': {
        const series = c.rank.series ?? 'usdkrw';
        const b = betaAt(pre, st, series, prevDay, p);
        if (Number.isNaN(b)) return; // 계산 불가인 종목은 정렬과 통과 수에서 뺀다(수급·재무 순과 같다)
        key = values[`${series}Beta`] = b;
        break;
      }
      case 'flow': {
        const rf = rankFlowOf(c);
        const r = flowRatio(pre, st, rf.who, rf.days, p);
        const v = minRatio(r);
        if (Number.isNaN(v)) return; // 계산 불가인 종목은 정렬에서 뺀다(스펙 3.3)
        key = values.rankFlow = v;
        // both는 작은 쪽으로 정렬하지만(F4) 화면은 두 비율을 따로 보인다
        if (Array.isArray(r)) [values.rankFlowForeign, values.rankFlowInst] = r;
        break;
      }
      case 'fin': {
        const metric = rankFinOf(c);
        const v = fin![metric];
        if (Number.isNaN(v)) return; // 계산 불가인 종목은 정렬과 통과 수에서 뺀다(스펙 3.2, D6)
        values.rankFin = v;
        key = finAscending(metric) ? -v : v; // PER·PBR은 낮을수록 앞
        break;
      }
    }
    passed.push({ symbol: st.s, key, values });
  });

  // 내림차순, 값이 없으면 뒤, 동률은 종목코드 오름차순
  passed.sort((a, b) => {
    if (a.key == null || b.key == null) return a.key == null && b.key == null ? byCode(a.symbol, b.symbol) : a.key == null ? 1 : -1;
    return b.key - a.key || byCode(a.symbol, b.symbol);
  });
  return {
    date: d,
    passed: passed.length,
    picked: passed.slice(0, c.rank.take).map(({ symbol, values }) => ({ symbol, values })),
  };
}

// 같은 업종(레벨 1·2) 안 시가총액 순위. p에 봉이 있고 그 레벨 코드가 있는 전체 종목 기준.
// 업종은 (레벨, 이름) 묶음이라 KOSPI·KOSDAQ을 합쳐 매긴다(R10)
function rankLeaders(
  stocks: StockSeries[],
  pIdx: number[],
  mcap: (j: number) => number,
  level: 1 | 2,
  group: (code: string) => string,
): (number | null)[] {
  const groups = new Map<string, number[]>();
  stocks.forEach((st, j) => {
    const code = st.sec[level - 1];
    if (pIdx[j] < 0 || !code) return;
    const key = group(code);
    const g = groups.get(key);
    if (g) g.push(j);
    else groups.set(key, [j]);
  });
  const rank: (number | null)[] = stocks.map(() => null);
  for (const g of groups.values()) {
    g.sort((a, b) => mcap(b) - mcap(a) || byCode(stocks[a].s, stocks[b].s));
    g.forEach((j, r) => (rank[j] = r + 1));
  }
  return rank;
}
