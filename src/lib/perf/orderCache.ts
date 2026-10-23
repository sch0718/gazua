// 주문 내역 캐시(IndexedDB `gazua-account`)와 이어 받기. 스펙 4.2.
// 계좌 내역이라 키 잠금을 켜면 앱이 메모리 캐시를 쓰고, 키 삭제·프로필 삭제 때 지운다.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { AccountOrder, AccountSource } from '../providers/types';
import { addDays, kstDate } from '../time/kst';

export interface OrderCacheEntry {
  orders: AccountOrder[];
  /** 마지막으로 받은 시각(epoch ms) */
  syncedAt: number;
  /** 마지막으로 받은 날(KST). 다음에는 이 날의 7일 전부터 받는다 */
  syncedThrough: string;
}

export interface OrderCache {
  get(key: string): Promise<OrderCacheEntry | undefined>;
  put(key: string, entry: OrderCacheEntry): Promise<void>;
  /** 이 프로필의 항목을 모두 지운다 */
  removeProfile(profileId: string): Promise<void>;
}

/** 늦게 종료된 주문(주문일은 앞인데 나중에 CLOSED가 된 것)을 잡으려고 겹쳐 받는 날 수 */
export const RESYNC_OVERLAP_DAYS = 7;

export const orderCacheKey = (profileId: string, providerId: string, accountId: string): string =>
  `${profileId}|${providerId}|${accountId}`;

export function createMemoryOrderCache(): OrderCache {
  const m = new Map<string, OrderCacheEntry>();
  return {
    get: async (k) => m.get(k),
    put: async (k, v) => void m.set(k, v),
    async removeProfile(id) {
      for (const k of [...m.keys()]) if (k.startsWith(`${id}|`)) m.delete(k);
    },
  };
}

interface Schema extends DBSchema {
  orders: { key: string; value: OrderCacheEntry & { key: string } };
}

const STORE = 'orders';

/** IndexedDB를 열 수 없으면(사생활 보호 모드 등) 메모리로 계속한다. */
export function createOrderCache(dbName = 'gazua-account'): OrderCache {
  const memory = createMemoryOrderCache();
  let dbPromise: Promise<IDBPDatabase<Schema> | null> | undefined;
  const db = (): Promise<IDBPDatabase<Schema> | null> => {
    dbPromise ??= (async () =>
      openDB<Schema>(dbName, 1, {
        upgrade(d) {
          d.createObjectStore(STORE, { keyPath: 'key' });
        },
        blocking() {
          const closing = dbPromise;
          dbPromise = undefined;
          void closing?.then((d) => d?.close());
        },
        terminated() {
          dbPromise = undefined;
        },
      }))().catch(() => null);
    return dbPromise;
  };
  return {
    async get(key) {
      const d = await db();
      if (!d) return memory.get(key);
      const rec = await d.get(STORE, key);
      if (!rec) return undefined;
      const { key: _key, ...entry } = rec;
      return entry;
    },
    async put(key, entry) {
      const d = await db();
      if (!d) return memory.put(key, entry);
      await d.put(STORE, { ...entry, key });
    },
    async removeProfile(id) {
      await memory.removeProfile(id);
      const d = await db();
      if (!d) return;
      const prefix = `${id}|`;
      // `|` 다음 글자(})까지의 범위가 이 프로필의 키 전체다
      await d.delete(STORE, IDBKeyRange.bound(prefix, `${id}}`, false, true));
    },
  };
}

/**
 * 캐시가 있으면 마지막으로 받은 날 7일 전부터 받아 orderId로 덮어써 합친다. full이면 처음부터 받는다.
 * 캐시를 읽거나 쓰지 못해도 받은 주문으로 계속한다. persist가 false를 돌려주면(받는 사이 취소됨) 저장하지 않는다.
 */
export async function syncOrders(args: {
  source: AccountSource;
  cache: OrderCache;
  key: string;
  now: number;
  full?: boolean;
  onPage?: (rows: number) => void;
  /** 저장 직전에 확인한다. 받는 동안 화면을 떠났으면 false */
  persist?: () => boolean;
}): Promise<{ orders: AccountOrder[]; syncedAt: number }> {
  const { source, cache, key, now } = args;
  let entry: OrderCacheEntry | undefined;
  if (!args.full) entry = await cache.get(key).catch(() => undefined);
  const from = entry ? addDays(entry.syncedThrough, -RESYNC_OVERLAP_DAYS) : undefined;
  const fresh = await source.closedOrders({ ...(from ? { from } : {}), onPage: args.onPage });
  const byId = new Map<string, AccountOrder>();
  for (const o of entry?.orders ?? []) byId.set(o.orderId, o);
  for (const o of fresh) byId.set(o.orderId, o);
  const orders = [...byId.values()].sort((a, b) => a.orderedAt.localeCompare(b.orderedAt) || a.orderId.localeCompare(b.orderId));
  if (args.persist?.() ?? true) await cache.put(key, { orders, syncedAt: now, syncedThrough: kstDate(now) }).catch(() => {});
  return { orders, syncedAt: now };
}
