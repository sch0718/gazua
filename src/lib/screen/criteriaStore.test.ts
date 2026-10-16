import { describe, expect, it } from 'vitest';
import { createSafeStorage } from '../state/storage';
import { memoryBacking, seed } from '../state/testStorage';
import { profileKeys } from '../state/profileStore';
import { MAX_CRITERIA, newCriteria } from './defaults';
import { CRITERIA_CAP_MESSAGE, assertCriteriaCap, loadCriteria, saveCriteria } from './criteriaStore';

const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ ...newCriteria(1_700_000_000_000, null, `기준 ${i}`), id: `c${i}` }));

describe('criteriaStore', () => {
  it('키는 p:<id>:criteria', () => {
    expect(profileKeys.criteria('p1')).toBe('p:p1:criteria');
  });

  it('저장 후 다시 읽으면 같다', () => {
    const st = createSafeStorage(memoryBacking());
    const list = mk(2);
    saveCriteria(st, 'p1', list);
    expect(loadCriteria(st, 'p1')).toEqual(list);
  });

  it('없으면 빈 목록이고 배너를 올리지 않는다', () => {
    const st = createSafeStorage(memoryBacking());
    expect(loadCriteria(st, 'p1')).toEqual([]);
    expect(st.issues).toEqual([]);
  });

  it('깨진 JSON이면 []로 읽고 배너 키를 보고한다', () => {
    const backing = memoryBacking();
    seed(backing, profileKeys.criteria('p1'), '{not json');
    const st = createSafeStorage(backing);
    expect(loadCriteria(st, 'p1')).toEqual([]);
    expect(st.issues.some((i) => i.kind === 'corrupt' && i.key === profileKeys.criteria('p1'))).toBe(true);
  });

  it('모양이 틀린 값이면 []로 읽고 배너 키를 보고한다', () => {
    const backing = memoryBacking();
    seed(backing, profileKeys.criteria('p1'), { criteria: 'x' });
    const st = createSafeStorage(backing);
    expect(loadCriteria(st, 'p1')).toEqual([]);
    expect(st.issues).toHaveLength(1);
  });

  it('깨진 항목은 기본값으로 고치고 알리되 저장된 값은 덮어쓰지 않는다', () => {
    const backing = memoryBacking();
    const bad = { ...mk(1)[0], rank: { by: 'marketCap', take: 31 } };
    seed(backing, profileKeys.criteria('p1'), { criteria: [bad, { ...bad, id: '' }] });
    const st = createSafeStorage(backing);
    const out = loadCriteria(st, 'p1');
    expect(out).toHaveLength(1);
    expect(out[0].rank.take).toBe(10);
    expect(st.issues).toHaveLength(1);
    expect(JSON.parse(backing.getItem(`gazua:v1:${profileKeys.criteria('p1')}`)!).criteria[0].rank.take).toBe(31);
  });

  it('20개까지 저장되고 21개는 던진다(저장소는 그대로)', () => {
    const st = createSafeStorage(memoryBacking());
    saveCriteria(st, 'p1', mk(MAX_CRITERIA));
    expect(() => saveCriteria(st, 'p1', mk(MAX_CRITERIA + 1))).toThrow(CRITERIA_CAP_MESSAGE);
    expect(loadCriteria(st, 'p1')).toHaveLength(MAX_CRITERIA);
    expect(CRITERIA_CAP_MESSAGE).toBe('선정 기준은 20개까지 저장할 수 있어요');
    expect(() => assertCriteriaCap(mk(20))).not.toThrow();
  });
});
