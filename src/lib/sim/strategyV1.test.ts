import { describe, expect, it } from 'vitest';
import { sanitizeStrategiesV2 } from './strategyV2';
import { newStrategyV1, sanitizeStrategiesV1, toV2 } from './strategyV1';

const NOW = Date.UTC(2026, 10, 1);

describe('toV2(§8.1)', () => {
  it('필드 표대로 옮긴다', () => {
    const v1 = { ...newStrategyV1(NOW, 'g0', '눌림목'), id: 's1' };
    v1.capital.perBuyPct = 12;
    v1.exit.afterFirstTake = 'breakeven';
    const v2 = toV2(v1);
    expect(v2).toEqual({
      v: 2,
      id: 's1',
      name: '눌림목',
      updatedAt: NOW,
      universe: v1.universe,
      period: v1.period,
      capital: { initial: v1.capital.initial },
      sizing: { mode: 'fixed', pct: 12 },
      rules: {
        buy: [{ conds: [{ kind: 'pattern', entry: v1.entry }] }],
        sell: {
          takeProfit: { on: true, stages: v1.exit.takeProfit, afterFirstTake: 'breakeven' },
          stopLoss: { on: true, pct: v1.exit.stopLoss.pct, basis: v1.exit.stopLoss.basis },
          trailing: { on: false, pct: 10 },
          timeExit: { on: false, days: 20 },
          signal: { on: false, groups: [] },
        },
      },
      scaleIn: v1.scaleIn,
      benchmarks: v1.benchmarks,
      costs: v1.costs,
    });
  });
  it('결정적이고 원본과 객체를 나누지 않는다', () => {
    const v1 = newStrategyV1(NOW, null);
    const a = toV2(v1);
    expect(toV2(v1)).toEqual(a);
    a.rules.buy[0].conds.length = 0;
    expect(toV2(v1).rules.buy[0].conds).toHaveLength(1);
  });
  it('옮긴 결과는 v2 검증을 고침 없이 통과한다(해시 앞당김의 전제, §8.3)', () => {
    const v1 = { ...newStrategyV1(NOW, 'g0'), id: 's1' };
    expect(sanitizeStrategiesV2({ strategies: [toV2(v1)] }, NOW)).toEqual({ strategies: [toV2(v1)], repaired: false });
  });
  it('sanitizeStrategiesV1은 지금 v1 검증과 같다', () => {
    const v1 = { ...newStrategyV1(NOW, 'g0'), id: 's1' };
    expect(sanitizeStrategiesV1({ strategies: [v1] }, NOW)).toEqual({ strategies: [v1], repaired: false });
  });
});
