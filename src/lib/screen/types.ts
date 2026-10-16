import type { Strategy } from '../sim/types';

export type Market = 'KOSPI' | 'KOSDAQ';
export type SecurityType = 'STOCK' | 'ETF';
export type RankBy = 'marketCap' | 'tradingValue' | 'return' | 'lowVolatility' | 'macroBeta' | 'flow';
/** 수급 주체. both는 외국인과 기관이 각각 만족해야 한다 */
export type FlowWho = 'foreign' | 'inst' | 'indiv' | 'both';
export type MacroSeriesKey = 'usdkrw' | 'wti';
export type Rebalance = 'monthly' | 'quarterly' | 'semiannual';

/** 환율·유가 한 계열의 조건(스펙 3.3) */
export interface MacroSeriesCond {
  beta: { on: boolean; min: number; max: number };
  trend: { on: boolean; lookback: number; thresholdPct: number; minAbsBeta: number; whenFlat: 'pass' | 'none' };
}

/** 선정 기준(스펙 5장). 켠 조건을 모두 만족해야 통과한다. */
export interface SelectionCriteria {
  id: string;
  name: string; // 30자 이내
  updatedAt: number;
  pool: {
    markets: Market[]; // 빈 배열 불가
    types: SecurityType[]; // 빈 배열 불가
    excludeManaged: boolean;
    sectors: string[]; // 빈 배열 = 사용 안 함
    themes: string[]; // KIS 테마 코드. 빈 배열 = 사용 안 함
    baskets: string[]; // 내 묶음 id. 빈 배열 = 사용 안 함
  };
  conditions: {
    marketCap: { on: boolean; minEok: number };
    tradingValue: { on: boolean; days: number; minEok: number };
    leader: { on: boolean; level: 1 | 2; maxRank: number };
    returnRange: { on: boolean; days: number; minPct: number; maxPct: number };
    vsMa: { on: boolean; period: number; side: 'above' | 'below' };
    fromHigh: { on: boolean; minPct: number; maxPct: number };
    volatility: { on: boolean; days: number; maxPct: number };
    rebound: {
      on: boolean;
      withinDays: number;
      pattern: { from: 'strategy'; strategyId: string } | { from: 'custom'; entry: Strategy['entry'] };
    };
    macro: { betaDays: number; usdkrw: MacroSeriesCond; wti: MacroSeriesCond };
    flow: {
      amount: { on: boolean; who: FlowWho; days: number; minPct: number; maxPct: number };
      streak: { on: boolean; who: FlowWho; minDays: number };
    };
  };
  rank: { by: RankBy; take: number; series?: MacroSeriesKey; flow?: { who: FlowWho; days: number } }; // take 1~30. series는 by가 macroBeta일 때 쓴다
  rebalance: Rebalance;
  period: { from: string; to: string };
  benchmarks: { indices: Market[]; symbols: string[] }; // symbols 최대 3
  costs: { feePct: number };
  capital: number;
  trading: { strategyId: string | null }; // null이면 ②를 돌리지 않는다
}
