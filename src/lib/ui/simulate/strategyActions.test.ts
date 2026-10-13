import { describe, expect, it } from 'vitest';
import { newStrategy } from '../../sim/defaults';
import { rulesChanged } from './strategyActions.svelte';

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
