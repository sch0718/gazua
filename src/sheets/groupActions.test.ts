import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Group, WatchItem, Watchlists } from '../lib/state/schema';
import { addItem } from '../lib/state/watchlist';
import { currentSnackbar, dismissSnackbar, runSnackbarAction } from '../lib/ui/components/snackbarStore.svelte';
import { FULL_MESSAGE, addToGroup, deleteGroupWithUndo, moveToGroup, removeWithUndo, type WatchlistStore } from './groupActions';

type Slot = WatchItem['colorSlot'];
const item = (symbol: string, colorSlot: Slot): WatchItem => ({ symbol, colorSlot, hidden: false, addedAt: 0 });
const group = (id: string, symbols: string[]): Group => ({
  id,
  name: id === 'g1' ? '반도체' : '배당',
  items: symbols.map((s, i) => item(s, (i + 1) as Slot)),
});

function store(initial: Watchlists): WatchlistStore & { switchTo(id: string, w: Watchlists): void } {
  let w = initial;
  let profile = 'p1';
  return {
    get watchlists() {
      return w;
    },
    get meta() {
      return { activeProfileId: profile };
    },
    setWatchlists(next) {
      w = next;
    },
    switchTo(id, next) {
      profile = id;
      w = next;
    },
  };
}
const symbolsOf = (s: WatchlistStore, id = 'g1') => s.watchlists.groups.find((g) => g.id === id)!.items.map((i) => i.symbol);
const slotsOf = (s: WatchlistStore, id = 'g1') => s.watchlists.groups.find((g) => g.id === id)!.items.map((i) => i.colorSlot);
const TEN = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

afterEach(() => dismissSnackbar());

describe('addToGroup', () => {
  it('adds, reports a symbol already present, and refuses a full group with a snackbar', () => {
    const s = store({ groups: [group('g1', ['A'])] });
    expect(addToGroup(s, 'g1', 'B', 5)).toBe('added');
    expect(symbolsOf(s)).toEqual(['A', 'B']);
    expect(addToGroup(s, 'g1', 'B', 5)).toBe('present');
    const full = store({ groups: [group('g1', TEN)] });
    expect(addToGroup(full, 'g1', 'Z', 5)).toBe('full');
    expect(symbolsOf(full)).toEqual(TEN);
    expect(currentSnackbar()?.message).toBe(FULL_MESSAGE);
    expect(addToGroup(s, 'nope', 'Z', 5)).toBe('missing');
  });
});

describe('removeWithUndo', () => {
  it('removes and undo restores the original position and color slot', () => {
    const s = store({ groups: [group('g1', ['A', 'B', 'C'])] });
    removeWithUndo(s, 'g1', 'B', 'SK하이닉스');
    expect(symbolsOf(s)).toEqual(['A', 'C']);
    expect(currentSnackbar()?.message).toBe('SK하이닉스을(를) 삭제했어요');
    expect(currentSnackbar()?.action?.label).toBe('되돌리기');
    runSnackbarAction();
    expect(symbolsOf(s)).toEqual(['A', 'B', 'C']);
    expect(slotsOf(s)).toEqual([1, 2, 3]);
    expect(currentSnackbar()?.message).toBe('되돌렸어요');
  });

  it('undo into a group that filled up meanwhile is refused and leaves 10 unique slots', () => {
    const s = store({ groups: [group('g1', TEN)] });
    removeWithUndo(s, 'g1', 'C', 'C');
    const g = s.watchlists.groups[0];
    s.setWatchlists({ groups: [addItem(g, 'Z', 9)] });
    runSnackbarAction();
    expect(symbolsOf(s)).toEqual(['A', 'B', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'Z']);
    expect(new Set(slotsOf(s)).size).toBe(10);
    expect(currentSnackbar()?.message).toBe('그룹이 가득 차서 되돌릴 수 없어요');
  });

  it('undo whose slot was taken meanwhile gets a new slot and says so', () => {
    const s = store({ groups: [group('g1', ['A', 'B', 'C'])] });
    removeWithUndo(s, 'g1', 'B', 'B');
    s.setWatchlists({ groups: [addItem(s.watchlists.groups[0], 'Z', 9)] });
    expect(slotsOf(s)).toEqual([1, 3, 2]);
    runSnackbarAction();
    expect(symbolsOf(s)).toEqual(['A', 'B', 'C', 'Z']);
    expect(slotsOf(s)).toEqual([1, 4, 3, 2]);
    expect(currentSnackbar()?.message).toBe('되돌렸어요 · 색이 겹쳐 새 색을 줬어요');
  });

  it('item undo after switching profiles is refused', () => {
    const s = store({ groups: [group('g1', ['A', 'B'])] });
    removeWithUndo(s, 'g1', 'A', 'A');
    const other: Watchlists = { groups: [group('g1', [])] };
    s.switchTo('p2', other);
    runSnackbarAction();
    expect(s.watchlists).toBe(other);
    expect(currentSnackbar()?.message).toBe('다른 프로필에서는 되돌릴 수 없어요');
  });

  it('undo after the group itself was deleted says it cannot restore', () => {
    const s = store({ groups: [group('g1', ['A']), group('g2', [])] });
    removeWithUndo(s, 'g1', 'A', 'A');
    s.setWatchlists({ groups: [s.watchlists.groups[1]] });
    runSnackbarAction();
    expect(currentSnackbar()?.message).toBe('그룹이 없어 되돌릴 수 없어요');
  });
});

describe('moveToGroup', () => {
  it('moves a symbol to another group with a free slot there', () => {
    const s = store({ groups: [group('g1', ['A', 'B']), group('g2', ['X'])] });
    expect(moveToGroup(s, 'g1', 'g2', 'A', 7)).toBe('moved');
    expect(symbolsOf(s, 'g1')).toEqual(['B']);
    expect(symbolsOf(s, 'g2')).toEqual(['X', 'A']);
    expect(slotsOf(s, 'g2')).toEqual([1, 2]);
    expect(currentSnackbar()?.message).toBe("'배당' 그룹으로 옮겼어요");
  });

  it('refuses when the target is full and keeps both groups', () => {
    const s = store({ groups: [group('g1', ['Z']), group('g2', TEN)] });
    expect(moveToGroup(s, 'g1', 'g2', 'Z', 7)).toBe('full');
    expect(symbolsOf(s, 'g1')).toEqual(['Z']);
    expect(symbolsOf(s, 'g2')).toEqual(TEN);
    expect(currentSnackbar()?.message).toBe(FULL_MESSAGE);
  });

  it('a symbol already in the target just leaves the source group', () => {
    const s = store({ groups: [group('g1', ['A', 'B']), group('g2', ['A'])] });
    expect(moveToGroup(s, 'g1', 'g2', 'A', 7)).toBe('moved');
    expect(symbolsOf(s, 'g1')).toEqual(['B']);
    expect(symbolsOf(s, 'g2')).toEqual(['A']);
  });
});

describe('deleteGroupWithUndo', () => {
  it('deletes the group and undo puts it back in place', () => {
    const s = store({ groups: [group('g1', ['A']), group('g2', [])] });
    deleteGroupWithUndo(s, 'g1');
    expect(s.watchlists.groups.map((g) => g.id)).toEqual(['g2']);
    expect(currentSnackbar()?.message).toBe('그룹을 삭제했어요');
    runSnackbarAction();
    expect(s.watchlists.groups.map((g) => g.id)).toEqual(['g1', 'g2']);
    expect(symbolsOf(s)).toEqual(['A']);
  });

  it('undo after switching profiles is refused and leaves the other profile alone', () => {
    const s = store({ groups: [group('g1', ['A']), group('g2', [])] });
    deleteGroupWithUndo(s, 'g1');
    const other: Watchlists = { groups: [{ id: 'x1', name: '다른', items: [] }] };
    s.switchTo('p2', other);
    runSnackbarAction();
    expect(s.watchlists).toBe(other);
    expect(currentSnackbar()?.message).toBe('다른 프로필에서는 되돌릴 수 없어요');
  });

  it('never deletes the last group', () => {
    const s = store({ groups: [group('g1', ['A'])] });
    expect(deleteGroupWithUndo(s, 'g1')).toBe(false);
    expect(s.watchlists.groups).toHaveLength(1);
  });
});

describe('undo focus profile gate', () => {
  it('removeWithUndo: focus() is null and nothing is restored after the profile changed', () => {
    const s = store({ groups: [group('g1', ['A', 'B'])] });
    const el = {} as HTMLElement;
    const find = vi.fn(() => el);
    removeWithUndo(s, 'g1', 'A', 'A', find);
    const action = currentSnackbar()!.action!;
    expect(action.focus!()).toBe(el); // 같은 프로필이면 찾는다
    expect(find).toHaveBeenCalledTimes(1);
    const other: Watchlists = { groups: [group('g1', ['Z'])] };
    s.switchTo('p2', other);
    expect(action.focus!()).toBeNull();
    expect(find).toHaveBeenCalledTimes(1); // 찾지도 않는다
    action.run();
    expect(s.watchlists).toBe(other);
  });

  it('deleteGroupWithUndo: focus() is null and nothing is restored after the profile changed', () => {
    const s = store({ groups: [group('g1', ['A']), group('g2', [])] });
    const el = {} as HTMLElement;
    const find = vi.fn(() => el);
    deleteGroupWithUndo(s, 'g1', find);
    const action = currentSnackbar()!.action!;
    expect(action.focus!()).toBe(el);
    const other: Watchlists = { groups: [{ id: 'x1', name: '다른', items: [] }] };
    s.switchTo('p2', other);
    expect(action.focus!()).toBeNull();
    expect(find).toHaveBeenCalledTimes(1);
    action.run();
    expect(s.watchlists).toBe(other);
    expect(s.watchlists.groups.map((g) => g.id)).toEqual(['x1']);
  });

  it('without a focus finder the action has no focus()', () => {
    const s = store({ groups: [group('g1', ['A'])] });
    removeWithUndo(s, 'g1', 'A', 'A');
    expect(currentSnackbar()!.action!.focus).toBeUndefined();
  });
});
