// 테스트 전용: 묶음·조건을 한도까지 채운 v2 전략(전략 빌더 스펙 §3). 정리(sanitizeStrategiesV2)를 거쳐도 그대로여야 한다.
import { sanitizeEntry } from './validate';
import type { Cond, StrategyV2 } from './strategyV2';

const BUY_FIRST: Cond[] = [
  { kind: 'pattern', entry: sanitizeEntry(undefined, 0).entry },
  { kind: 'maPrice', period: 120, side: 'above' },
  { kind: 'rsi', period: 14, level: 30, op: 'crossUp' },
  { kind: 'volume', days: 20, ratio: 1.5 },
  { kind: 'change', days: 5, pct: -10, op: 'below' },
];
const OTHERS: Cond[] = [
  { kind: 'maCross', short: 20, long: 60, dir: 'golden' },
  { kind: 'fromHigh', days: 60, pct: 20 },
  { kind: 'newHigh', days: 60 },
  { kind: 'rsi', period: 14, level: 70, op: 'below' },
  { kind: 'maPrice', period: 20, side: 'below' },
];
const group = (conds: Cond[]) => ({ conds: structuredClone(conds) });

export function fullStrategyV2(): StrategyV2 {
  return {
    v: 2,
    id: 's2',
    name: '골든크로스 추세',
    updatedAt: 1,
    universe: { kind: 'group', groupId: 'g0' },
    period: { from: '2023-10-31', to: '2026-10-31' },
    capital: { initial: 10_000_000 },
    sizing: { mode: 'equityPct', pct: 10 },
    rules: {
      buy: [group(BUY_FIRST), group(OTHERS), group(OTHERS), group(OTHERS)],
      sell: {
        takeProfit: { on: true, stages: [{ pct: 10, sellPct: 50 }, { pct: 20, sellPct: 100 }], afterFirstTake: 'breakeven' },
        stopLoss: { on: true, pct: 7, basis: 'avgAlways' },
        trailing: { on: true, pct: 10 },
        timeExit: { on: true, days: 20 },
        signal: { on: true, groups: [group(OTHERS), group(OTHERS), group(OTHERS), group(OTHERS)] },
      },
    },
    scaleIn: { on: true, stepPct: 3, maxAdds: 2 },
    benchmarks: { index: 'KOSPI', symbol: '069500' },
    costs: { feePct: 0.015 },
  };
}
