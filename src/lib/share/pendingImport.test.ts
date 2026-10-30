import { afterEach, describe, expect, it } from 'vitest';
import { memoryBacking } from '../state/testStorage';
import { clearImport, IMPORT_KEY, IMPORT_TTL_MS, markImported, peekImport, stashImport, wasImported } from './pendingImport';
import { groupSnapshot } from './snapshot';
import { NOW, simResultFixture, validationFixture } from './testFixtures';

const g = groupSnapshot({ id: 'g', name: '반도체', items: [{ symbol: '005930', colorSlot: 1, hidden: false, addedAt: 1 }] });
const throwing = (): Storage =>
  ({
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
    removeItem: () => {
      throw new Error('blocked');
    },
  }) as unknown as Storage;

afterEach(() => clearImport(null));

describe('가져오기 대기 값', () => {
  it('넣고 읽어도 지우지 않고, clearImport가 지운다', () => {
    const store = memoryBacking();
    expect(stashImport(g, NOW, store)).toBe(true);
    const a = peekImport(NOW + 1000, store);
    expect(a).toMatchObject({ from: 'group', snapshot: g, at: NOW });
    expect(peekImport(NOW + 2000, store)?.id).toBe(a!.id);
    clearImport(store);
    expect(peekImport(NOW, store)).toBeNull();
  });

  it('30분이 지나면 지우고 null', () => {
    const store = memoryBacking();
    stashImport(g, NOW, store);
    expect(peekImport(NOW + IMPORT_TTL_MS + 1, store)).toBeNull();
    expect(store.getItem(IMPORT_KEY)).toBeNull();
  });

  it('망가진 JSON·종류가 맞지 않음·검사 실패는 지우고 null', () => {
    const store = memoryBacking();
    for (const bad of [
      '{',
      JSON.stringify({ id: 'x', from: 'group', snapshot: { ...g, kind: 'strategy' }, at: NOW }),
      JSON.stringify({ id: 'x', from: 'magic', snapshot: g, at: NOW }),
      JSON.stringify({ id: 'x', from: 'group', snapshot: { ...g, symbols: ['../x'] }, at: NOW }),
      JSON.stringify({ id: 'x', from: 'group', snapshot: { ...g, token: 1 }, at: NOW }),
    ]) {
      store.setItem(IMPORT_KEY, bad);
      expect(peekImport(NOW, store)).toBeNull();
      expect(store.getItem(IMPORT_KEY)).toBeNull();
    }
  });

  it('simResult는 strategy, validation은 criteria로 바꿔 규칙만 둔다', () => {
    const store = memoryBacking();
    const sim = simResultFixture();
    stashImport(sim, NOW, store);
    const a = peekImport(NOW, store)!;
    expect(a.from).toBe('simResult');
    expect(a.snapshot).toEqual({ kind: 'strategy', v: 1, title: sim.title, strategy: sim.strategy, capitalHidden: false });
    expect(store.getItem(IMPORT_KEY)!).not.toContain('"result"');
    const val = validationFixture({ capitalHidden: true });
    stashImport(val, NOW, store);
    expect(peekImport(NOW, store)!.snapshot).toEqual({ kind: 'criteria', v: 1, title: val.title, criteria: val.criteria, baskets: val.baskets, capitalHidden: true });
  });

  it.each([
    ['미래 시각', { at: NOW + 1 }],
    ['숫자가 아닌 시각', { at: String(NOW) }],
    ['빈 id', { id: '' }],
    ['64자를 넘는 id', { id: 'x'.repeat(65) }],
    ['규칙으로 바꾸지 않은 결과', { from: 'simResult', snapshot: simResultFixture() }],
  ])('fail-closed: %s이면 지우고 null', (_, invalid) => {
    const store = memoryBacking();
    store.setItem(IMPORT_KEY, JSON.stringify({ id: 'x', from: 'group', snapshot: g, at: NOW, ...invalid }));
    expect(peekImport(NOW, store)).toBeNull();
    expect(store.getItem(IMPORT_KEY)).toBeNull();
  });

  it('저장소가 던지면 메모리로 같은 탭 안에서 이어 간다', () => {
    const store = throwing();
    expect(stashImport(g, NOW, store)).toBe(false);
    expect(peekImport(NOW, store)?.snapshot).toEqual(g);
    clearImport(store);
    expect(peekImport(NOW, store)).toBeNull();
  });

  it('가져온 id는 최근 20개까지 기억한다(탭 복제 대비)', () => {
    const store = memoryBacking();
    for (let i = 0; i < 25; i++) markImported(`id-${i}`, store);
    expect(wasImported('id-24', store)).toBe(true);
    expect(wasImported('id-5', store)).toBe(true);
    expect(wasImported('id-4', store)).toBe(false);
    expect(wasImported('id-x', throwing())).toBe(false);
  });
});
