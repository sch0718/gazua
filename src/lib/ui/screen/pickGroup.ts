// 오늘 기준 선별을 관심 그룹으로(스펙 7.4-1): 위에서부터 빈자리만큼 넣는다. 그룹은 MAX_ITEMS를 넘지 못한다.
import type { App } from '../../state/app.svelte';
import { addItem, createGroup, MAX_ITEMS } from '../../state/watchlist';

export interface PickGroupResult {
  groupId: string;
  groupName: string;
  /** 새로 넣은 종목 수 */
  added: number;
  /** 빈자리가 모자라 못 넣은 수 */
  cut: number;
  /** 이미 그룹에 있어 건너뛴 수 */
  already: number;
  /** 이번에 넣을 수 있던 최대 수(새 그룹이면 MAX_ITEMS, 기존이면 빈자리) */
  room: number;
}

export const freeSlots = (app: App, groupId: string): number =>
  Math.max(0, MAX_ITEMS - (app.watchlists.groups.find((g) => g.id === groupId)?.items.length ?? MAX_ITEMS));

/** 컷 안내. 새 그룹은 `상위 N개만 넣었어요`, 기존 그룹은 빈자리 수로 */
export const cutText = (room: number) => `상위 ${room}개만 넣었어요`;

function fill(app: App, groupId: string, symbols: string[], now: number): PickGroupResult {
  const group = app.watchlists.groups.find((g) => g.id === groupId);
  if (!group) throw new Error(`no group ${groupId}`);
  let g = group;
  const room = Math.max(0, MAX_ITEMS - g.items.length);
  let added = 0;
  let cut = 0;
  let already = 0;
  for (const symbol of symbols) {
    if (g.items.some((i) => i.symbol === symbol)) already++;
    else if (g.items.length >= MAX_ITEMS) cut++;
    else {
      g = addItem(g, symbol, now);
      added++;
    }
  }
  app.setWatchlists({ ...app.watchlists, groups: app.watchlists.groups.map((x) => (x.id === groupId ? g : x)) });
  return { groupId, groupName: g.name, added, cut, already, room };
}

/** 새 그룹을 만들어 위에서부터 MAX_ITEMS개를 넣는다. 이름이 비면 기준 이름을 쓴다 */
export function picksToNewGroup(app: App, name: string, symbols: string[], now = Date.now()): PickGroupResult {
  const w = createGroup(app.watchlists, name.trim() || '선정 기준');
  const id = w.groups[w.groups.length - 1].id;
  app.setWatchlists(w);
  return fill(app, id, symbols, now);
}

/** 기존 그룹의 빈자리만큼 넣는다 */
export function picksToGroup(app: App, groupId: string, symbols: string[], now = Date.now()): PickGroupResult {
  return fill(app, groupId, symbols, now);
}
