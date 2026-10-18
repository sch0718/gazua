import type { UniverseItem } from '../lib/data/universe';
import type { ImportStock } from '../lib/providers/types';
import type { Watchlists } from '../lib/state/schema';
import { MAX_ITEMS, addItem, createGroup } from '../lib/state/watchlist';

export interface GroupPlan {
  /** 그룹에 넣을 앱 종목 코드(앞에서부터 최대 MAX_ITEMS개) */
  symbols: string[];
  /** 앱 종목 목록에서 찾은 종목 수(중복 제외) */
  found: number;
  /** 앱 종목 목록에 없어 뺀 종목 수(해외·상장폐지·지원하지 않는 상품) */
  unknown: number;
}

/**
 * 공급자 종목 → 앱 종목 코드. 토스는 ETN을 Q 없는 6자리로 주므로, 그대로 없으면 Q를 붙여 찾는다.
 * 순서(평가금액·시가총액 큰 순)를 지키고 앞에서부터 max개를 고른다.
 */
export function planGroup(stocks: ImportStock[], universe: UniverseItem[], max = MAX_ITEMS): GroupPlan {
  const known = new Set(universe.map((u) => u.s));
  const seen = new Set<string>();
  let unknown = 0;
  for (const s of stocks) {
    const symbol = known.has(s.symbol) ? s.symbol : known.has(`Q${s.symbol}`) ? `Q${s.symbol}` : null;
    if (symbol === null) unknown++;
    else seen.add(symbol);
  }
  const found = [...seen];
  return { symbols: found.slice(0, max), found: found.length, unknown };
}

/** 이름과 종목으로 새 그룹을 만든 관심목록과 그 그룹 id. 기존 그룹은 건드리지 않는다. */
export function withNewGroup(w: Watchlists, name: string, symbols: string[], now: number): { watchlists: Watchlists; groupId: string } {
  const created = createGroup(w, name);
  const index = created.groups.length - 1;
  let group = created.groups[index];
  for (const s of symbols) group = addItem(group, s, now);
  const groups = [...created.groups];
  groups[index] = group;
  return { watchlists: { ...created, groups }, groupId: group.id };
}
