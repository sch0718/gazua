// IndexedDB 봉 캐시. 종목 1분봉과 지수 봉만 저장한다. 종목 일봉(수정주가)은 저장하지 않는다(스펙 4.3).
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Candle } from './metrics';

export interface CandleCache {
  get(key: string): Promise<Candle[] | undefined>;
  /** ttlMs가 null이면 영구 보관 */
  put(key: string, v: Candle[], ttlMs: number | null): Promise<void>;
  /** 가장 오래 안 쓴 '종목 단위'로 그 종목의 키를 모두 삭제한다. */
  evict(maxBytes: number): Promise<void>;
  clear(): Promise<void>;
  estimateBytes(): Promise<number>;
}

interface CandleRecord {
  key: string;
  value: Candle[];
  expiresAt: number | null;
  /** `provider|symbol` — 종목 단위 삭제의 묶음 */
  symbolKey: string;
  lastAccess: number;
  bytes: number;
}

interface CacheSchema extends DBSchema {
  candles: { key: string; value: CandleRecord };
}

const STORE = 'candles';

/** 키 `provider|symbol|...`에서 `provider|symbol`. 지수는 `provider|INDEX:KOSPI`. */
function symbolKeyOf(key: string): string {
  return key.split('|').slice(0, 2).join('|');
}

export function createCandleCache(dbName = 'gazua-cache', now: () => number = Date.now): CandleCache {
  let dbPromise: Promise<IDBPDatabase<CacheSchema>> | undefined;
  const reset = () => {
    dbPromise = undefined;
  };
  // async로 감싸 동기 throw(사생활 보호 모드 등)도 거부로 바꾸고, 실패하면 다음 호출이 다시 연다.
  const open = async () =>
    openDB<CacheSchema>(dbName, 1, {
      upgrade(d) {
        d.createObjectStore(STORE, { keyPath: 'key' });
      },
      // 다른 탭이 새 버전을 열려고 하면 닫고 비켜 준다. 다음 호출이 다시 연다.
      blocking() {
        const closing = dbPromise;
        reset();
        void closing?.then((d) => d.close());
      },
      terminated: reset,
    });
  const db = (): Promise<IDBPDatabase<CacheSchema>> => {
    if (!dbPromise) {
      const p = open();
      dbPromise = p;
      p.catch(() => {
        if (dbPromise === p) reset();
      });
    }
    return dbPromise;
  };

  const isExpired = (rec: CandleRecord, t: number) => rec.expiresAt !== null && rec.expiresAt <= t;

  /** 만료된 레코드를 모두 지우고 남은 레코드를 돌려준다. */
  async function purgeExpired(): Promise<CandleRecord[]> {
    const tx = (await db()).transaction(STORE, 'readwrite');
    const t = now();
    const live: CandleRecord[] = [];
    for (const rec of await tx.store.getAll()) {
      if (isExpired(rec, t)) await tx.store.delete(rec.key);
      else live.push(rec);
    }
    await tx.done;
    return live;
  }

  return {
    async get(key) {
      const tx = (await db()).transaction(STORE, 'readwrite');
      const rec = await tx.store.get(key);
      let result: Candle[] | undefined;
      if (rec) {
        const t = now();
        if (isExpired(rec, t)) {
          await tx.store.delete(key);
        } else {
          await tx.store.put({ ...rec, lastAccess: t });
          result = rec.value;
        }
      }
      await tx.done;
      return result;
    },

    async put(key, v, ttlMs) {
      const t = now();
      const rec: CandleRecord = {
        key,
        value: v,
        expiresAt: ttlMs === null ? null : t + ttlMs,
        symbolKey: symbolKeyOf(key),
        lastAccess: t,
        bytes: JSON.stringify(v).length,
      };
      await (await db()).put(STORE, rec);
    },

    async evict(maxBytes) {
      const live = await purgeExpired();
      const groups = new Map<string, { keys: string[]; bytes: number; lastAccess: number }>();
      let total = 0;
      for (const rec of live) {
        const g = groups.get(rec.symbolKey) ?? { keys: [], bytes: 0, lastAccess: -Infinity };
        g.keys.push(rec.key);
        g.bytes += rec.bytes;
        g.lastAccess = Math.max(g.lastAccess, rec.lastAccess);
        groups.set(rec.symbolKey, g);
        total += rec.bytes;
      }
      if (total <= maxBytes) return;
      const tx = (await db()).transaction(STORE, 'readwrite');
      const oldestFirst = [...groups.values()].sort((a, b) => a.lastAccess - b.lastAccess);
      for (const g of oldestFirst) {
        if (total <= maxBytes) break;
        for (const k of g.keys) await tx.store.delete(k);
        total -= g.bytes;
      }
      await tx.done;
    },

    async clear() {
      await (await db()).clear(STORE);
    },

    async estimateBytes() {
      const live = await purgeExpired();
      return live.reduce((sum, r) => sum + r.bytes, 0);
    },
  };
}
