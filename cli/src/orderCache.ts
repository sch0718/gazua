// 토스 주문 이력 파일 캐시. 앱의 src/lib/perf/orderCache.ts처럼 { orders, syncedAt, syncedThrough }를 두고,
// 다음에는 syncedThrough의 7일 전부터만 받아 orderId로 합친다(같은 orderId는 새 것이 이긴다).
// 파일 이름에 키 해시(토스 client ID)와 accountSeq 해시 앞 8자를 넣어 계좌·키가 바뀌면 다른 파일이 된다. 원문 accountSeq는 어디에도 쓰지 않는다.
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import type { AccountOrder, AccountSource } from '../../src/lib/providers/types';
import { addDays, kstDate } from '../../src/lib/time/kst';
import { permissionWarnings, readJsonFile, writeJsonFile } from './config';

export const RESYNC_OVERLAP_DAYS = 7;

interface OrderCacheFile {
  v: 1;
  orders: AccountOrder[];
  syncedAt: number;
  /** 마지막으로 받은 날(KST) */
  syncedThrough: string;
}

export function orderCachePath(dir: string, keyHash: string, accountSeq: string): string {
  return join(dir, `orders-${keyHash}-${createHash('sha256').update(accountSeq).digest('hex').slice(0, 8)}.json`);
}

export async function syncOrders(o: { dir: string; keyHash: string; account: AccountSource; now: number; onSeq?: (seq: string) => void; warn?: (message: string) => void }): Promise<AccountOrder[]> {
  const seq = await o.account.accountId();
  o.onSeq?.(seq);
  const path = orderCachePath(o.dir, o.keyHash, seq);
  for (const w of permissionWarnings(o.dir, [basename(path)])) o.warn?.(w); // 읽기 전에 권한 확인
  const raw = readJsonFile<OrderCacheFile>(path);
  const cached = raw !== null && raw.v === 1 && Array.isArray(raw.orders) && /^\d{4}-\d{2}-\d{2}$/.test(raw.syncedThrough) ? raw : null;
  const fresh = await o.account.closedOrders(cached ? { from: addDays(cached.syncedThrough, -RESYNC_OVERLAP_DAYS) } : undefined);
  const byId = new Map<string, AccountOrder>();
  for (const x of cached?.orders ?? []) byId.set(x.orderId, x);
  for (const x of fresh) byId.set(x.orderId, x);
  const orders = [...byId.values()].sort((a, b) => a.orderedAt.localeCompare(b.orderedAt) || a.orderId.localeCompare(b.orderId));
  writeJsonFile(path, { v: 1, orders, syncedAt: o.now, syncedThrough: kstDate(o.now) } satisfies OrderCacheFile);
  return orders;
}
