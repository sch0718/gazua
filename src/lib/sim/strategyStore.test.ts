import { describe, expect, it } from 'vitest';
import { createSafeStorage } from '../state/storage';
import { memoryBacking, seed } from '../state/testStorage';
import { profileKeys } from '../state/profileStore';
import { MAX_STRATEGIES, newStrategy } from './defaults';
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
    seed(backing, profileKeys.strategies('p1'), { strategies: [...mk(1), { nope: true }] });
    const st = createSafeStorage(backing);
    expect(loadStrategies(st, 'p1')).toHaveLength(1);
    expect(st.issues).toHaveLength(1);
  });

  it('id가 빈 항목은 빠지고 배너 키를 보고한다', () => {
    const backing = memoryBacking();
    seed(backing, profileKeys.strategies('p1'), { strategies: [...mk(1), { ...mk(1)[0], id: '' }] });
    const st = createSafeStorage(backing);
    expect(loadStrategies(st, 'p1').map((x) => x.id)).toEqual(['s0']);
    expect(st.issues).toHaveLength(1);
  });

  it('이동평균 기간이 소수면 기본값으로 읽고 배너 키를 보고한다', () => {
    const backing = memoryBacking();
    const bad = mk(1)[0] as any;
    bad.entry.filter.aboveMa = { on: true, period: 2.5 };
    seed(backing, profileKeys.strategies('p1'), { strategies: [bad] });
    const st = createSafeStorage(backing);
    const [r] = loadStrategies(st, 'p1');
    expect(r.entry.filter.aboveMa).toEqual({ on: true, period: 60 });
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
