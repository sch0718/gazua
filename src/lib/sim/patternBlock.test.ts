import { describe, expect, it } from 'vitest';
import { defaultPatternEntry, newStrategy } from './defaults';
import { patternCount, patternEntryOf } from './patternBlock';
import { newStrategyV1, toV2 } from './strategyV1';

describe('v2 기본값과 패턴 블록', () => {
  it('newStrategy는 지금 기본값을 옮긴 v2와 같다(id만 다름)', () => {
    const a = newStrategy(0, 'g0', '새 전략');
    const b = toV2(newStrategyV1(0, 'g0', '새 전략'));
    expect({ ...a, id: 'x' }).toEqual({ ...b, id: 'x' });
  });
  it('patternEntryOf: 매수 묶음의 첫 패턴 블록', () => {
    const s = newStrategy(0, null);
    expect(patternEntryOf(s)).toEqual(defaultPatternEntry());
    expect(patternCount(s)).toBe(1);
    s.rules.buy = [{ conds: [{ kind: 'newHigh', days: 20 }] }];
    expect(patternEntryOf(s)).toBeNull();
    expect(patternCount(s)).toBe(0);
  });
});
