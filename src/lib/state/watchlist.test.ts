import { describe, expect, it } from 'vitest';
import {
  GroupFullError,
  MAX_ITEMS,
  addItem,
  createGroup,
  deleteGroup,
  moveItem,
  removeItem,
  renameGroup,
  restoreGroup,
  restoreItem,
  toggleHidden,
} from './watchlist';
import type { Group, WatchItem, Watchlists } from './schema';

type Slot = WatchItem['colorSlot'];
const item = (symbol: string, colorSlot: Slot): WatchItem => ({ symbol, colorSlot, hidden: false, addedAt: 0 });
const emptyGroup: Group = { id: 'g0', name: '빈 그룹', items: [] };
const full8: Group = {
  id: 'g8',
  name: '가득',
  items: (['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'] as const).map((s, i) => item(s, (i + 1) as Slot)),
};
const g3: Group = { id: 'g3', name: '셋', items: [item('A', 1), item('B', 2), item('C', 3)] };
const w2: Watchlists = {
  groups: [
    { id: 'g1', name: '반도체', items: [] },
    { id: 'g2', name: '배당', items: [] },
  ],
};
const symbols = (g: Group) => g.items.map((i) => i.symbol);

describe('items', () => {
  it('assigns lowest free color slot and keeps it after removal of others', () => {
    let g = ['A', 'B', 'C'].reduce((g, s) => addItem(g, s, 0), emptyGroup);
    g = removeItem(g, 'B').group;
    g = addItem(g, 'D', 0);
    expect(g.items.map((i) => [i.symbol, i.colorSlot])).toEqual([['A', 1], ['C', 3], ['D', 2]]);
  });

  it('records addedAt and starts visible', () => {
    expect(addItem(emptyGroup, 'A', 123).items[0]).toEqual({ symbol: 'A', colorSlot: 1, hidden: false, addedAt: 123 });
  });

  it('9th item throws GroupFullError', () => {
    expect(MAX_ITEMS).toBe(8);
    expect(() => addItem(full8, 'X', 0)).toThrow(GroupFullError);
  });

  it('adding a duplicate returns the group as is', () => {
    expect(addItem(g3, 'B', 5)).toEqual(g3);
    expect(addItem(full8, 'S1', 5)).toEqual(full8);
  });

  it('removeItem reports the removed item and its index; unknown symbol throws', () => {
    const { group, removed } = removeItem(g3, 'B');
    expect(symbols(group)).toEqual(['A', 'C']);
    expect(removed).toEqual({ item: item('B', 2), index: 1 });
    expect(() => removeItem(g3, 'Z')).toThrow(Error);
  });

  it('restore with no intervening change returns the original group', () => {
    const { group, removed } = removeItem(g3, 'B');
    expect(restoreItem(group, removed)).toEqual(g3);
  });

  it('restore keeps items added after the removal', () => {
    const { group, removed } = removeItem(g3, 'B');
    const g = addItem(group, 'X', 0);
    expect(restoreItem(g, removed).items.map((i) => i.symbol)).toEqual(['A', 'B', 'C', 'X']);
  });

  it('restore into a slot reused meanwhile assigns the lowest free slot', () => {
    const { group, removed } = removeItem(g3, 'B');
    const g = addItem(group, 'X', 0); // X took slot 2
    expect(restoreItem(g, removed).items.find((i) => i.symbol === 'B')!.colorSlot).toBe(4);
  });

  it('restore into a full group throws GroupFullError (8-item limit and unique slots hold)', () => {
    const { group, removed } = removeItem(full8, 'S1');
    const g = addItem(group, 'X', 0);
    expect(() => restoreItem(g, removed)).toThrow(GroupFullError);
  });

  it('restore of a symbol that is already present leaves the group unchanged', () => {
    const { removed } = removeItem(g3, 'B');
    expect(restoreItem(g3, removed)).toEqual(g3);
  });

  it('restore clamps the index to the current length', () => {
    const { removed } = removeItem(g3, 'C'); // index 2
    const shorter = removeItem(removeItem(g3, 'C').group, 'A').group; // [B]
    expect(symbols(restoreItem(shorter, removed))).toEqual(['B', 'C']);
  });

  it('toggleHidden flips hidden for one symbol and ignores unknown symbols', () => {
    const g = toggleHidden(g3, 'B');
    expect(g.items.map((i) => i.hidden)).toEqual([false, true, false]);
    expect(toggleHidden(g, 'B').items[1].hidden).toBe(false);
    expect(toggleHidden(g3, 'Z')).toEqual(g3);
  });

  it('moveItem reorders without changing color slots', () => {
    const g = moveItem(g3, 0, 2);
    expect(g.items.map((i) => [i.symbol, i.colorSlot])).toEqual([['B', 2], ['C', 3], ['A', 1]]);
    expect(symbols(moveItem(g3, 2, 0))).toEqual(['C', 'A', 'B']);
    expect(moveItem(g3, 1, 1)).toEqual(g3);
  });

  it('moveItem rejects out-of-range indexes', () => {
    expect(() => moveItem(g3, 0, 3)).toThrow(RangeError);
    expect(() => moveItem(g3, -1, 0)).toThrow(RangeError);
  });

  it('never mutates its input', () => {
    const snapshot = structuredClone(g3);
    addItem(g3, 'X', 0);
    const { group, removed } = removeItem(g3, 'B');
    restoreItem(group, removed);
    toggleHidden(g3, 'A');
    moveItem(g3, 0, 2);
    expect(g3).toEqual(snapshot);
    const wSnapshot = structuredClone(w2);
    const { watchlists, removed: rg } = deleteGroup(w2, 'g1');
    restoreGroup(watchlists, rg);
    createGroup(w2, 'N');
    renameGroup(w2, 'g1', 'M');
    expect(w2).toEqual(wSnapshot);
  });
});

describe('groups', () => {
  it('createGroup appends an empty group with a generated id and trimmed name', () => {
    const w = createGroup(w2, '  새 그룹 ');
    expect(w.groups.map((g) => g.name)).toEqual(['반도체', '배당', '새 그룹']);
    const created = w.groups[2];
    expect(created.items).toEqual([]);
    expect(created.id).toBeTruthy();
    expect(new Set(w.groups.map((g) => g.id)).size).toBe(3);
  });

  it('createGroup rejects an empty name', () => {
    expect(() => createGroup(w2, '   ')).toThrow(Error);
  });

  it('renameGroup renames only the target; unknown id throws', () => {
    const w = renameGroup(w2, 'g2', '  고배당 ');
    expect(w.groups.map((g) => g.name)).toEqual(['반도체', '고배당']);
    expect(() => renameGroup(w2, 'zz', 'x')).toThrow(Error);
  });

  it('deleteGroup reports the removed group and its index; unknown id throws', () => {
    const { watchlists, removed } = deleteGroup(w2, 'g1');
    expect(watchlists.groups.map((g) => g.id)).toEqual(['g2']);
    expect(removed).toEqual({ group: w2.groups[0], index: 0 });
    expect(() => deleteGroup(w2, 'zz')).toThrow(Error);
  });

  it('restoreGroup restores the original position when nothing changed', () => {
    const { watchlists, removed } = deleteGroup(w2, 'g1');
    expect(restoreGroup(watchlists, removed)).toEqual(w2);
  });

  it('restoreGroup keeps groups created after the deletion', () => {
    const { watchlists, removed } = deleteGroup(w2, 'g1');
    const w = createGroup(watchlists, '새 그룹');
    expect(restoreGroup(w, removed).groups.map((g) => g.name)).toEqual(['반도체', '배당', '새 그룹']);
  });

  it('restoreGroup does not duplicate a group that is already present', () => {
    const { removed } = deleteGroup(w2, 'g1');
    expect(restoreGroup(w2, removed)).toEqual(w2);
  });
});
