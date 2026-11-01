import { describe, expect, it, vi } from 'vitest';
import { createSafeStorage } from '../state/storage';
import { memoryBacking, seed, totalQuotaBacking } from '../state/testStorage';
import { profileKeys } from '../state/profileStore';
import { MAX_STRATEGIES, newStrategy } from './defaults';
import { newStrategyV1, toV2 } from './strategyV1';
import { patternEntryOf } from './patternBlock';
import { assertStrategyCap, loadStrategies, saveStrategies } from './strategyStore';

const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ ...newStrategy(1_700_000_000_000, 'g1', `전략 ${i}`), id: `s${i}` }));

describe('strategyStore', () => {
  it('저장 후 다시 읽으면 같다', () => {
    const st = createSafeStorage(memoryBacking());
    const list = mk(2);
    saveStrategies(st, 'p1', list);
    expect(loadStrategies(st, 'p1')).toEqual(list);
  });

  it('없으면 빈 목록이고 배너를 올리지 않는다', () => {
    const st = createSafeStorage(memoryBacking());
    expect(loadStrategies(st, 'p1')).toEqual([]);
    expect(st.issues).toEqual([]);
  });

  it('깨진 JSON이면 []로 읽고 배너 키를 보고한다', () => {
    const backing = memoryBacking();
    seed(backing, profileKeys.strategies('p1'), '{not json');
    const st = createSafeStorage(backing);
    expect(loadStrategies(st, 'p1')).toEqual([]);
    expect(st.issues.some((i) => i.kind === 'corrupt' && i.key === profileKeys.strategies('p1'))).toBe(true);
  });

  it('모양이 틀린 값이면 []로 읽고 배너 키를 보고한다', () => {
    const backing = memoryBacking();
    seed(backing, profileKeys.strategies('p1'), { strategies: 'x' });
    const st = createSafeStorage(backing);
    expect(loadStrategies(st, 'p1')).toEqual([]);
    expect(st.issues).toHaveLength(1);
  });

  it('깨진 항목만 빼고 알린다', () => {
    const backing = memoryBacking();
    seed(backing, profileKeys.strategySet('p1'), { strategies: [...mk(1), { nope: true }] });
    const st = createSafeStorage(backing);
    expect(loadStrategies(st, 'p1')).toHaveLength(1);
    expect(st.issues).toHaveLength(1);
  });

  it('id가 빈 항목은 빠지고 배너 키를 보고한다', () => {
    const backing = memoryBacking();
    seed(backing, profileKeys.strategySet('p1'), { strategies: [...mk(1), { ...mk(1)[0], id: '' }] });
    const st = createSafeStorage(backing);
    expect(loadStrategies(st, 'p1').map((x) => x.id)).toEqual(['s0']);
    expect(st.issues).toHaveLength(1);
  });

  it('이동평균 기간이 소수면 기본값으로 읽고 배너 키를 보고한다', () => {
    const backing = memoryBacking();
    const bad = { ...newStrategyV1(1_700_000_000_000, 'g1'), id: 's0' };
    bad.entry.filter.aboveMa = { on: true, period: 2.5 };
    seed(backing, profileKeys.strategies('p1'), { strategies: [bad] });
    const st = createSafeStorage(backing);
    const [r] = loadStrategies(st, 'p1');
    expect(patternEntryOf(r)?.filter.aboveMa).toEqual({ on: true, period: 60 });
    expect(st.issues.some((i) => i.kind === 'corrupt' && i.key === profileKeys.strategies('p1'))).toBe(true);
  });

  it('21개를 저장하면 던진다', () => {
    const st = createSafeStorage(memoryBacking());
    expect(() => saveStrategies(st, 'p1', mk(MAX_STRATEGIES + 1))).toThrow('전략은 20개까지 저장할 수 있어요');
    expect(() => saveStrategies(st, 'p1', mk(MAX_STRATEGIES))).not.toThrow();
  });

  it('assertStrategyCap은 21개에서 던지고 20개는 통과', () => {
    expect(() => assertStrategyCap(mk(MAX_STRATEGIES + 1))).toThrow('전략은 20개까지 저장할 수 있어요');
    expect(() => assertStrategyCap(mk(MAX_STRATEGIES))).not.toThrow();
  });
});

describe('새 키 strategySet(§8.2)', () => {
  const make = () => createSafeStorage(memoryBacking());
  it('옛 키만 있으면 v2로 옮겨 새 키에 쓰고 옛 키는 그대로 둔다', () => {
    const st = make();
    const v1 = { ...newStrategyV1(0, null, '옛'), id: 's1' };
    st.set(profileKeys.strategies('p'), { strategies: [v1] });
    const reportCorrupt = vi.spyOn(st, 'reportCorrupt');
    expect(loadStrategies(st, 'p')).toEqual([toV2(v1)]);
    expect(st.get(profileKeys.strategySet('p'), null)).toEqual({ strategies: [toV2(v1)] });
    expect(st.get(profileKeys.strategies('p'), null)).toEqual({ strategies: [v1] });
    expect(reportCorrupt).not.toHaveBeenCalled();
    expect(st.issues).toEqual([]);
  });
  it('새 키 쓰기가 실패하면 옮긴 목록만 돌려주고 옛 키는 그대로 둔다', () => {
    const backing = totalQuotaBacking();
    const oldKey = profileKeys.strategies('p');
    const newKey = profileKeys.strategySet('p');
    const v1 = { ...newStrategyV1(0, null, '옛'), id: 's1' };
    seed(backing, oldKey, { strategies: [v1] });
    const before = backing.dump();
    backing.limit = backing.used();
    const st = createSafeStorage(backing);
    const trySet = vi.spyOn(st, 'trySet');
    const next = [toV2(v1)];

    expect(loadStrategies(st, 'p')).toEqual(next);
    expect(trySet).toHaveBeenCalledWith(newKey, { strategies: next });
    expect(trySet).toHaveReturnedWith(false);
    expect(st.readBacking(newKey, null)).toBeNull();
    expect(st.get(oldKey, null)).toEqual({ strategies: [v1] });
    expect(backing.dump()).toBe(before);
    expect(st.issues).toEqual([{ key: newKey, kind: 'write-failed' }]);
    expect(loadStrategies(st, 'p')).toEqual(next);
    expect(trySet).toHaveBeenCalledTimes(2);
    expect(backing.dump()).toBe(before);
  });
  it('새 키가 있으면 옛 키는 읽지 않는다', () => {
    const st = make();
    st.set(profileKeys.strategies('p'), { strategies: [{ ...newStrategyV1(0, null, '옛'), id: 's1' }] });
    const v2 = toV2({ ...newStrategyV1(0, null, '새'), id: 's2' });
    st.set(profileKeys.strategySet('p'), { strategies: [v2] });
    expect(loadStrategies(st, 'p')).toEqual([v2]);
  });
  it('저장은 새 키에만 한다', () => {
    const st = make();
    const v2 = toV2({ ...newStrategyV1(0, null), id: 's2' });
    saveStrategies(st, 'p', [v2]);
    expect(st.get(profileKeys.strategySet('p'), null)).toEqual({ strategies: [v2] });
    expect(st.get(profileKeys.strategies('p'), null)).toBeNull();
  });
});
