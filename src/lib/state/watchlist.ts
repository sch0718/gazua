import type { Group, WatchItem, Watchlists } from './schema';

export const MAX_ITEMS = 10;

export class GroupFullError extends Error {
  constructor() {
    super(`한 그룹에는 최대 ${MAX_ITEMS}종목까지 담을 수 있어요`);
    this.name = 'GroupFullError';
  }
}

type Slot = WatchItem['colorSlot'];
const SLOTS: readonly Slot[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function lowestFreeSlot(items: readonly WatchItem[]): Slot {
  const used = new Set(items.map((i) => i.colorSlot));
  const free = SLOTS.find((s) => !used.has(s));
  if (free === undefined) throw new GroupFullError();
  return free;
}

export interface RemovedItem {
  item: WatchItem;
  index: number;
}

/** Appends the symbol with the lowest free color slot. A symbol already in the group is a no-op. */
export function addItem(g: Group, symbol: string, now: number): Group {
  if (g.items.some((i) => i.symbol === symbol)) return g;
  if (g.items.length >= MAX_ITEMS) throw new GroupFullError();
  const item: WatchItem = { symbol, colorSlot: lowestFreeSlot(g.items), hidden: false, addedAt: now };
  return { ...g, items: [...g.items, item] };
}

/** Throws if the symbol is not in the group. */
export function removeItem(g: Group, symbol: string): { group: Group; removed: RemovedItem } {
  const index = g.items.findIndex((i) => i.symbol === symbol);
  if (index < 0) throw new Error(`group has no item ${symbol}`);
  return {
    group: { ...g, items: g.items.filter((_, i) => i !== index) },
    removed: { item: g.items[index], index },
  };
}

/**
 * Undo of removeItem against the *current* group: keeps the old slot if still free (else the lowest
 * free one), re-inserts at the old index clamped to the current length.
 */
export function restoreItem(g: Group, removed: RemovedItem): Group {
  const { item, index } = removed;
  if (g.items.some((i) => i.symbol === item.symbol)) return g;
  if (g.items.length >= MAX_ITEMS) throw new GroupFullError();
  const slotTaken = g.items.some((i) => i.colorSlot === item.colorSlot);
  const restored: WatchItem = slotTaken ? { ...item, colorSlot: lowestFreeSlot(g.items) } : item;
  const items = [...g.items];
  items.splice(Math.min(index, items.length), 0, restored);
  return { ...g, items };
}

/** Unknown symbols are ignored. */
export function toggleHidden(g: Group, symbol: string): Group {
  if (!g.items.some((i) => i.symbol === symbol)) return g;
  return { ...g, items: g.items.map((i) => (i.symbol === symbol ? { ...i, hidden: !i.hidden } : i)) };
}

/** Moves the item at `from` so that it ends up at index `to`. Color slots do not change. */
export function moveItem(g: Group, from: number, to: number): Group {
  const last = g.items.length - 1;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from > last || to > last) {
    throw new RangeError(`moveItem out of range: ${from} -> ${to}`);
  }
  if (from === to) return g;
  const items = [...g.items];
  const [moved] = items.splice(from, 1);
  items.splice(to, 0, moved);
  return { ...g, items };
}

/** Moves the group at `from` so that it ends up at index `to`. */
export function moveGroup(w: Watchlists, from: number, to: number): Watchlists {
  const last = w.groups.length - 1;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from > last || to > last) {
    throw new RangeError(`moveGroup out of range: ${from} -> ${to}`);
  }
  if (from === to) return w;
  const groups = [...w.groups];
  const [moved] = groups.splice(from, 1);
  groups.splice(to, 0, moved);
  return { ...w, groups };
}

function cleanName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '') throw new Error('group name must not be empty');
  return trimmed;
}

export function createGroup(w: Watchlists, name: string): Watchlists {
  const group: Group = { id: crypto.randomUUID(), name: cleanName(name), items: [] };
  return { ...w, groups: [...w.groups, group] };
}

export function renameGroup(w: Watchlists, id: string, name: string): Watchlists {
  if (!w.groups.some((g) => g.id === id)) throw new Error(`no group ${id}`);
  const clean = cleanName(name);
  return { ...w, groups: w.groups.map((g) => (g.id === id ? { ...g, name: clean } : g)) };
}

export function deleteGroup(
  w: Watchlists,
  id: string,
): { watchlists: Watchlists; removed: { group: Group; index: number } } {
  const index = w.groups.findIndex((g) => g.id === id);
  if (index < 0) throw new Error(`no group ${id}`);
  return {
    watchlists: { ...w, groups: w.groups.filter((_, i) => i !== index) },
    removed: { group: w.groups[index], index },
  };
}

/** Undo of deleteGroup against the current list; groups created meanwhile are kept. */
export function restoreGroup(w: Watchlists, removed: { group: Group; index: number }): Watchlists {
  if (w.groups.some((g) => g.id === removed.group.id)) return w;
  const groups = [...w.groups];
  groups.splice(Math.min(removed.index, groups.length), 0, removed.group);
  return { ...w, groups };
}
