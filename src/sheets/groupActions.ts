// 시트에서 쓰는 관심종목 바꾸기: 저장하고 결과를 스낵바로 알린다(스펙 7.3, 9-3·5).
// 되돌리기는 늘 '그 시점의' 그룹 목록에 적용한다.
import type { Group, Watchlists } from '../lib/state/schema';
import {
  GroupFullError,
  MAX_ITEMS,
  addItem,
  deleteGroup,
  removeItem,
  restoreGroup,
  restoreItem,
  type RemovedItem,
} from '../lib/state/watchlist';
import { showSnackbar, type SnackbarAction } from '../lib/ui/components/snackbarStore.svelte';

/** App이 이 모양을 만족한다. */
export interface WatchlistStore {
  readonly watchlists: Watchlists;
  /** 되돌리기는 지운 때와 같은 프로필에서만 한다. */
  readonly meta: { readonly activeProfileId: string };
  setWatchlists(w: Watchlists): void;
}

export const FULL_MESSAGE = `한 차트에 ${MAX_ITEMS}개까지 비교할 수 있어요`;
const UNDO = '되돌리기';

/** 되돌리기 뒤 포커스할 요소를 찾는다(없으면 null). */
export type FocusAfterUndo = () => HTMLElement | null | undefined;

/** 되돌리기 동작: 프로필이 바뀌었으면 그 프로필을 건드리지 않고 알린다. */
function undoAction(s: WatchlistStore, run: () => void, focus?: FocusAfterUndo): SnackbarAction {
  const profile = s.meta.activeProfileId;
  return {
    label: UNDO,
    // 다른 프로필이면 되돌리지 않았으니 포커스도 옮기지 않는다.
    focus: focus && (() => (s.meta.activeProfileId === profile ? focus() : null)),
    run: () => {
      if (s.meta.activeProfileId !== profile) {
        showSnackbar('다른 프로필에서는 되돌릴 수 없어요');
        return;
      }
      run();
    },
  };
}

const findGroup = (s: WatchlistStore, id: string) => s.watchlists.groups.find((g) => g.id === id);

function saveGroups(s: WatchlistStore, changed: Group[]) {
  const w = s.watchlists;
  s.setWatchlists({ ...w, groups: w.groups.map((g) => changed.find((c) => c.id === g.id) ?? g) });
}

/** 가득 찬 그룹이면 스낵바로 알리고 바꾸지 않는다. */
export function addToGroup(s: WatchlistStore, groupId: string, symbol: string, now: number): 'added' | 'present' | 'full' | 'missing' {
  const g = findGroup(s, groupId);
  if (!g) return 'missing';
  if (g.items.some((i) => i.symbol === symbol)) return 'present';
  try {
    saveGroups(s, [addItem(g, symbol, now)]);
    return 'added';
  } catch (e) {
    if (!(e instanceof GroupFullError)) throw e;
    showSnackbar(FULL_MESSAGE);
    return 'full';
  }
}

function restore(s: WatchlistStore, groupId: string, removed: RemovedItem) {
  const g = findGroup(s, groupId);
  if (!g) {
    showSnackbar('그룹이 없어 되돌릴 수 없어요');
    return;
  }
  if (g.items.some((i) => i.symbol === removed.item.symbol)) {
    showSnackbar('이미 그룹에 있어요');
    return;
  }
  let next: Group;
  try {
    next = restoreItem(g, removed);
  } catch (e) {
    if (!(e instanceof GroupFullError)) throw e;
    showSnackbar('그룹이 가득 차서 되돌릴 수 없어요');
    return;
  }
  saveGroups(s, [next]);
  const slot = next.items.find((i) => i.symbol === removed.item.symbol)?.colorSlot;
  showSnackbar(slot === removed.item.colorSlot ? '되돌렸어요' : '되돌렸어요 · 색이 겹쳐 새 색을 줬어요');
}

/** 종목을 빼고 `{name}을(를) 삭제했어요 · 되돌리기`를 띄운다. focus: 되돌린 뒤 포커스할 요소. */
export function removeWithUndo(s: WatchlistStore, groupId: string, symbol: string, name: string, focus?: FocusAfterUndo): boolean {
  const g = findGroup(s, groupId);
  if (!g || !g.items.some((i) => i.symbol === symbol)) return false;
  const { group, removed } = removeItem(g, symbol);
  saveGroups(s, [group]);
  showSnackbar(`${name}을(를) 삭제했어요`, undoAction(s, () => restore(s, groupId, removed), focus));
  return true;
}

/** 다른 그룹으로 옮긴다(옮긴 그룹에서 새 색 슬롯). 대상이 가득 차면 둘 다 그대로 둔다. */
export function moveToGroup(
  s: WatchlistStore,
  fromId: string,
  toId: string,
  symbol: string,
  now: number,
): 'moved' | 'full' | 'missing' {
  const from = findGroup(s, fromId);
  const to = findGroup(s, toId);
  if (!from || !to || fromId === toId || !from.items.some((i) => i.symbol === symbol)) return 'missing';
  let target: Group;
  try {
    target = addItem(to, symbol, now);
  } catch (e) {
    if (!(e instanceof GroupFullError)) throw e;
    showSnackbar(FULL_MESSAGE);
    return 'full';
  }
  saveGroups(s, [removeItem(from, symbol).group, target]);
  showSnackbar(`'${to.name}' 그룹으로 옮겼어요`);
  return 'moved';
}

/** 그룹을 지우고 `그룹을 삭제했어요 · 되돌리기`를 띄운다. 마지막 남은 그룹은 지우지 않는다. focus: 되돌린 뒤 포커스할 요소. */
export function deleteGroupWithUndo(s: WatchlistStore, groupId: string, focus?: FocusAfterUndo): boolean {
  if (s.watchlists.groups.length <= 1 || !findGroup(s, groupId)) return false;
  const { watchlists, removed } = deleteGroup(s.watchlists, groupId);
  s.setWatchlists(watchlists);
  showSnackbar(
    '그룹을 삭제했어요',
    undoAction(s, () => {
      s.setWatchlists(restoreGroup(s.watchlists, removed));
      showSnackbar('되돌렸어요');
    }, focus),
  );
  return true;
}
