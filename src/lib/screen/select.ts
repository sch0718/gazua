import type { Basket } from './baskets';
import { lastUsablePair, trendAt } from './macro';
import { RANK_RETURN_DAYS, RANK_VOL_DAYS, stableJson, usesMacro, type Precomputed, type StockSeries } from './precompute';
import type { MacroSeriesKey, SelectionCriteria } from './types';

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
}

const MACRO_KEYS: readonly MacroSeriesKey[] = ['usdkrw', 'wti'];

/** p에서 쓸 수 있는 마지막 쌍 i*(p)의 β. pIdx는 그 종목의 p 봉 인덱스. 없으면 NaN */
export function betaAt(pre: Precomputed, st: StockSeries, key: MacroSeriesKey, p: string, pIdx: number): number {
  const i = lastUsablePair(st.macroIdx[key], pre.macro[key].known, p, pIdx);
  return i < 0 ? NaN : st.beta[key][i];
}

const orNull = (x: number): number | null => (Number.isNaN(x) ? null : x);

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

/**
 * 재선정일 d의 선별(스펙 6.1). 모든 값은 축의 전 거래일 p의 봉까지만 쓴다.
 * 순서: 후보 범위 → 조건 → 정렬 → 상위 take
 */
export function selectAt(
  d: string,
  pre: Precomputed,
  c: SelectionCriteria,
  poolOverride?: Pick<SelectionCriteria['pool'], 'markets' | 'types'>,
  baskets: Pick<Basket, 'id' | 'symbols'>[] = [],
): Selection {
  assertMatches(pre, c);
  const ai = lowerBound(pre.axis, d);
  if (ai === 0) return { date: d, passed: 0, picked: [] };
  const prevDay = pre.axis[ai - 1];

  // 종목별 p: 그 종목의 d 전 마지막 봉. 그 봉이 축의 전 거래일이 아니면 p에 봉이 없다(-1)
  const pIdx = pre.stocks.map((st) => {
    const i = lowerBound(st.d, d) - 1;
    return i >= 0 && st.d[i] === prevDay ? i : -1;
  });
  const mcap = (j: number): number => pre.stocks[j].close[pIdx[j]] * pre.stocks[j].shares;

  const k = c.conditions;
  // 업종 코드를 (레벨, 이름) 묶음 키로 바꾼다. 목록에 없는 코드는 코드 그대로
  const group = (code: string): string => pre.sectorKey.get(code) ?? `#${code}`;
  const leaderRank = k.leader.on ? rankLeaders(pre.stocks, pIdx, mcap, k.leader.level, group) : null;
  const pool = { ...c.pool, ...poolOverride };
  // 저장된 코드 하나가 그 묶음 전체를 고른다
  const wanted = new Set(pool.sectors.filter((x) => x !== '').map(group));
  // 합집합 후보 범위(스펙 4.1): 업종 ∪ 테마 종목 ∪ 묶음 종목. 데이터에 없는 테마·지워진 묶음은 빈 것
  const restricted = pool.sectors.length > 0 || pool.themes.length > 0 || pool.baskets.length > 0;
  const listed = new Set<string>();
  for (const t of pool.themes) for (const x of pre.themes.get(t) ?? []) listed.add(x);
  for (const id of pool.baskets) for (const x of baskets.find((b) => b.id === id)?.symbols ?? []) listed.add(x);
  const inSector = (st: StockSeries): boolean =>
    (st.sec[0] !== '' && wanted.has(group(st.sec[0]))) || (st.sec[1] !== '' && wanted.has(group(st.sec[1])));
  // 계열 흐름은 종목과 무관하다. p에서 공개된 관측값끼리 한 번 계산한다(스펙 3.2)
  const trend: Record<MacroSeriesKey, number> = { usdkrw: NaN, wti: NaN };
  for (const key of MACRO_KEYS) {
    const t = k.macro[key].trend;
    if (t.on) trend[key] = trendAt(pre.macro[key], prevDay, t.lookback);
  }
  const returnDays = k.returnRange.on ? k.returnRange.days : RANK_RETURN_DAYS;
  const ret = (st: StockSeries, p: number): number | null => (p - returnDays >= 0 ? (st.close[p] / st.close[p - returnDays] - 1) * 100 : null);

  const passed: { symbol: string; key: number | null; values: Selection['picked'][number]['values'] }[] = [];
  pre.stocks.forEach((st, j) => {
    const p = pIdx[j];
    if (p < 0) return;
    // 후보 범위
    if (!SELECTABLE.includes(st.t) || !pool.markets.includes(st.m) || !pool.types.includes(st.t as 'STOCK' | 'ETF')) return;
    if (pool.excludeManaged && (st.managed || st.halted)) return;
    if (restricted && !(inSector(st) || listed.has(st.s))) return;

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
        key = values[`${series}Beta`] = orNull(betaAt(pre, st, series, prevDay, p));
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
