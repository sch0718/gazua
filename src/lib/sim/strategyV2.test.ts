import { describe, expect, it } from 'vitest';
import { exceedsDepth, findForbidden } from '../sync/forbidden';
import { defaultCond, MAX_CONDS, MAX_GROUPS, sanitizeStrategiesV2 } from './strategyV2';
import { fullStrategyV2 } from './testStrategyV2';

const NOW = Date.UTC(2026, 10, 1);
const one = (s: unknown) => sanitizeStrategiesV2({ strategies: [s] }, NOW);

describe('sanitizeStrategiesV2', () => {
  it('한도까지 채운 전략은 그대로 통과한다(고침 없음)', () => {
    const s = fullStrategyV2();
    expect(one(s)).toEqual({ strategies: [s], repaired: false });
  });

  it('범위를 넘는 값은 기본값으로 바꾸고 repaired', () => {
    const s = fullStrategyV2() as any;
    s.rules.sell.trailing.pct = 80;
    s.rules.buy[1].conds[0].short = 1;
    s.sizing.mode = 'all';
    const r = one(s);
    expect(r.repaired).toBe(true);
    expect(r.strategies[0].rules.sell.trailing.pct).toBe(10);
    expect((r.strategies[0].rules.buy[1].conds[0] as { short: number }).short).toBe(20);
    expect(r.strategies[0].sizing.mode).toBe('fixed');
  });

  it('모르는 kind와 매도 묶음의 pattern은 버리고 repaired, 빈 묶음은 남긴다', () => {
    const s = fullStrategyV2() as any;
    s.rules.buy[1].conds = [{ kind: 'sell' }];
    s.rules.sell.signal.groups[0].conds = [{ kind: 'pattern', entry: {} }];
    const r = one(s);
    expect(r.repaired).toBe(true);
    expect(r.strategies[0].rules.buy[1].conds).toEqual([]);
    expect(r.strategies[0].rules.sell.signal.groups[0].conds).toEqual([]);
    expect(r.strategies[0].rules.buy).toHaveLength(4);
  });

  it('묶음·조건 한도를 넘으면 잘라내고 repaired', () => {
    const s = fullStrategyV2() as any;
    s.rules.buy.push({ conds: [] });
    s.rules.buy[0].conds.push({ kind: 'newHigh', days: 20 });
    const r = one(s);
    expect(r.repaired).toBe(true);
    expect(r.strategies[0].rules.buy).toHaveLength(MAX_GROUPS);
    expect(r.strategies[0].rules.buy[0].conds).toHaveLength(MAX_CONDS);
  });

  it('패턴 블록 개수는 고치지 않는다(실행 조건은 경고가 본다)', () => {
    const s = fullStrategyV2();
    s.rules.buy[1].conds[0] = structuredClone(s.rules.buy[0].conds[0]);
    expect(one(s)).toEqual({ strategies: [s], repaired: false });
  });

  it('v1 규칙을 그대로 쓴다: 마지막 익절 sellPct는 100으로 맞추고 repaired', () => {
    const s = fullStrategyV2();
    s.rules.sell.takeProfit.stages[1].sellPct = 60;
    const r = one(s);
    expect(r.repaired).toBe(true);
    expect(r.strategies[0].rules.sell.takeProfit.stages[1].sellPct).toBe(100);
  });

  it('id가 없으면 버리고, 같은 id는 하나만 남긴다', () => {
    const s = fullStrategyV2();
    expect(sanitizeStrategiesV2({ strategies: [{ ...s, id: '' }, s, s] }, NOW)).toMatchObject({ repaired: true, strategies: [s] });
  });

  it('v가 2가 아니면 repaired(v 값은 2로)', () => {
    const r = one({ ...fullStrategyV2(), v: 1 });
    expect(r.repaired).toBe(true);
    expect(r.strategies[0].v).toBe(2);
  });

  it('defaultCond가 정리 기본값과 같다', () => {
    const s = fullStrategyV2() as any;
    s.rules.buy[1].conds = [{ kind: 'rsi', period: 0, level: 0, op: 'x' }];
    expect(one(s).strategies[0].rules.buy[1].conds[0]).toEqual(defaultCond('rsi'));
  });

  it('새 키는 금지 키에 걸리지 않고 깊이 한도 안이다', () => {
    const doc = { strategies: [fullStrategyV2()] };
    expect(findForbidden(doc)).toBeNull();
    expect(exceedsDepth(doc)).toBe(false);
  });
});
