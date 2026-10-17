import { defaultPeriod, MAX_INITIAL, NAME_MAX, newStrategy } from '../sim/defaults';
import type { MacroSeriesCond, SelectionCriteria } from './types';

export { MAX_INITIAL, NAME_MAX };
export const MAX_CRITERIA = 20;
export const TAKE_MAX = 30;
export const BENCH_MAX = 3;

/** 데이터 시작 + 1년 ~ 데이터 끝. 윤일이면 2월 28일로 맞추고, 1년이 안 되는 데이터면 시작부터 쓴다. 데이터가 없으면 최근 3년. */
export function defaultCriteriaPeriod(now: number, dataRange: { from: string; to: string } | null): { from: string; to: string } {
  if (!dataRange) return defaultPeriod(now);
  let from = `${String(Number(dataRange.from.slice(0, 4)) + 1).padStart(4, '0')}${dataRange.from.slice(4)}`;
  if (from.slice(5) === '02-29') from = `${from.slice(0, 5)}02-28`;
  if (from >= dataRange.to) from = dataRange.from;
  return { from, to: dataRange.to };
}

/** 환율·유가 한 계열의 기본 조건(스펙 3.3). 호출마다 새 객체 */
export const defaultMacroSeries = (): MacroSeriesCond => ({
  beta: { on: false, min: 0.3, max: 5 },
  trend: { on: false, lookback: 20, thresholdPct: 3, minAbsBeta: 0.3, whenFlat: 'pass' },
});

export function newCriteria(
  now: number,
  dataRange: { from: string; to: string } | null,
  name = '새 기준',
): SelectionCriteria {
  return {
    id: crypto.randomUUID(),
    name,
    updatedAt: now,
    pool: { markets: ['KOSPI', 'KOSDAQ'], types: ['STOCK'], excludeManaged: true, sectors: [], themes: [], baskets: [] },
    conditions: {
      marketCap: { on: false, minEok: 1000 },
      tradingValue: { on: true, days: 20, minEok: 10 },
      leader: { on: false, level: 1, maxRank: 3 },
      returnRange: { on: false, days: 60, minPct: -30, maxPct: 0 },
      vsMa: { on: false, period: 60, side: 'above' },
      fromHigh: { on: false, minPct: 20, maxPct: 50 },
      volatility: { on: false, days: 20, maxPct: 3 },
      rebound: {
        on: true,
        withinDays: 10,
        pattern: { from: 'custom', entry: newStrategy(now, null).entry },
      },
      macro: { betaDays: 120, usdkrw: defaultMacroSeries(), wti: defaultMacroSeries() },
      flow: {
        amount: { on: false, who: 'foreign', days: 20, minPct: 1, maxPct: 100 },
        streak: { on: false, who: 'inst', minDays: 5 },
      },
      fin: {
        per: { on: false, min: 0, max: 15 },
        pbr: { on: false, min: 0, max: 1.5 },
        roe: { on: false, min: 10 },
        opMargin: { on: false, min: 5 },
        revGrowth: { on: false, min: 10 },
        opGrowth: { on: false, min: 20 },
        debtRatio: { on: false, max: 100 },
        profitable: { on: false },
      },
    },
    rank: { by: 'marketCap', take: 10, series: 'usdkrw', flow: { who: 'foreign', days: 20 }, fin: { metric: 'per' } },
    rebalance: 'monthly',
    period: defaultCriteriaPeriod(now, dataRange),
    benchmarks: { indices: ['KOSPI'], symbols: ['069500'] },
    costs: { feePct: 0.015 },
    capital: 10_000_000,
    trading: { strategyId: null },
  };
}
