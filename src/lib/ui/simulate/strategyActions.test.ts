import { describe, expect, it } from 'vitest';
import { newStrategy } from '../../sim/defaults';
import { STRATEGY_CAP_MESSAGE } from '../../sim/strategyStore';
import { nextStrategyName, rulesChanged } from './strategyActions.svelte';

const base = () => newStrategy(1_700_000_000_000, 'g1', '가');

describe('rulesChanged', () => {
  it('같은 규칙이면 false', () => {
    expect(rulesChanged(base(), structuredClone(base()))).toBe(false);
  });

  it('id · name · updatedAt은 무시한다', () => {
    const a = base();
    const b = { ...structuredClone(a), id: 'other', name: '나', updatedAt: a.updatedAt + 1 };
    expect(rulesChanged(a, b)).toBe(false);
  });

  it('깊은 값이 바뀌면 true', () => {
    const a = base();
    const b = structuredClone(a);
    b.entry.decline.dropPct.value += 1;
    expect(rulesChanged(a, b)).toBe(true);
  });

  it('배열 길이·종목이 바뀌면 true', () => {
    const a = base();
    const b = structuredClone(a);
    b.exit.takeProfit = [...b.exit.takeProfit, { pct: 50, sellPct: 100 }];
    expect(rulesChanged(a, b)).toBe(true);
    const c = structuredClone(a);
    c.universe = { kind: 'symbols', symbols: ['005930'] };
    expect(rulesChanged(a, c)).toBe(true);
  });

  it('기간 · 비교 종목이 바뀌면 true', () => {
    const a = base();
    const b = structuredClone(a);
    b.benchmarks.symbol = null;
    expect(rulesChanged(a, b)).toBe(true);
    const c = structuredClone(a);
    c.period.from = '2020-01-02';
    expect(rulesChanged(a, c)).toBe(true);
  });
});

describe('nextStrategyName', () => {
  const named = (...names: string[]) => names.map((n) => newStrategy(1, 'g1', n));

  it('없으면 그대로, 있으면 번호를 붙인다', () => {
    expect(nextStrategyName([])).toBe('새 전략');
    expect(nextStrategyName(named('새 전략'))).toBe('새 전략 2');
    expect(nextStrategyName(named('새 전략', '새 전략 2'))).toBe('새 전략 3');
  });

  it('빈 번호 중 가장 작은 것을 쓴다', () => {
    expect(nextStrategyName(named('새 전략', '새 전략 3'))).toBe('새 전략 2');
    expect(nextStrategyName(named('새 전략 2'))).toBe('새 전략');
  });

  it('기준 이름을 바꿀 수 있다', () => {
    expect(nextStrategyName(named('눌림목'), '눌림목')).toBe('눌림목 2');
  });
});

describe('STRATEGY_CAP_MESSAGE', () => {
  it('한도 문구는 한 곳에서 온다', () => {
    expect(STRATEGY_CAP_MESSAGE).toBe('전략은 20개까지 저장할 수 있어요');
  });
});
