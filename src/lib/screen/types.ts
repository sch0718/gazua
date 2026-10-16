import type { Strategy } from '../sim/types';

export type Market = 'KOSPI' | 'KOSDAQ';
export type SecurityType = 'STOCK' | 'ETF';
export type RankBy = 'marketCap' | 'tradingValue' | 'return' | 'lowVolatility';
export type Rebalance = 'monthly' | 'quarterly' | 'semiannual';

/** 선정 기준(스펙 5장). 켠 조건을 모두 만족해야 통과한다. */
export interface SelectionCriteria {
  id: string;
  name: string; // 30자 이내
  updatedAt: number;
  pool: {
    markets: Market[]; // 빈 배열 불가
    types: SecurityType[]; // 빈 배열 불가
    excludeManaged: boolean;
    sectors: string[]; // 빈 배열 = 전체
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
  };
  rank: { by: RankBy; take: number }; // take 1~30
  rebalance: Rebalance;
  period: { from: string; to: string };
  benchmarks: { indices: Market[]; symbols: string[] }; // symbols 최대 3
  costs: { feePct: number };
  capital: number;
  trading: { strategyId: string | null }; // null이면 ②를 돌리지 않는다
}
