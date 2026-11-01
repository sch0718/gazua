import { chmodSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountOrder, AccountSource } from '../../src/lib/providers/types';
import { addDays, kstDate, kstEpoch } from '../../src/lib/time/kst';
import { orderCachePath, RESYNC_OVERLAP_DAYS, syncOrders } from './orderCache';
import { cleanupDirs, tempDir } from './testing';

afterEach(cleanupDirs);

const SEQ = 'acct-secret-7777777';
const order = (id: string, orderedAt: string, over: Partial<AccountOrder> = {}): AccountOrder => ({ orderId: id, symbol: '005930', side: 'BUY', status: 'FILLED', currency: 'KRW', orderedAt, filledAt: orderedAt, quantity: 1, price: 100, amount: 100, commission: 0, tax: 0, ...over });

function account(seq: string, pages: AccountOrder[][]) {
  const closedOrders = vi.fn(async (_opts?: { from?: string; to?: string }) => pages.shift() ?? []);
  const a = { accountId: async () => seq, closedOrders, holdings: async () => [] } as unknown as AccountSource;
  return { a, closedOrders };
}

describe('syncOrders', () => {
  const day1 = kstEpoch('2026-11-02', '12:00:00');

  it('처음에는 전체를 받고 orders-<keyHash>-<계좌 해시 8자>.json(600)에 저장한다. accountSeq는 이름에도 내용에도 없다', async () => {
    const dir = tempDir();
    const { a, closedOrders } = account(SEQ, [[order('o1', '2026-10-01T09:00:00+09:00')]]);
    const seen: string[] = [];
    const orders = await syncOrders({ dir, keyHash: 'kh1234', account: a, now: day1, onSeq: (s) => seen.push(s) });
    expect(orders.map((o) => o.orderId)).toEqual(['o1']);
    expect(closedOrders).toHaveBeenCalledTimes(1);
    expect(closedOrders.mock.calls[0][0]).toBeUndefined();
    expect(seen).toEqual([SEQ]);
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^orders-kh1234-[0-9a-f]{8}\.json$/);
    expect(files[0]).not.toContain(SEQ);
    const text = readFileSync(join(dir, files[0]), 'utf8');
    expect(text).not.toContain(SEQ);
    expect(JSON.parse(text)).toMatchObject({ v: 1, syncedAt: day1, syncedThrough: kstDate(day1) });
    if (process.platform !== 'win32') expect(statSync(join(dir, files[0])).mode & 0o777).toBe(0o600);
    expect(orderCachePath(dir, 'kh1234', SEQ)).toBe(join(dir, files[0]));
  });

  it('다음에는 syncedThrough의 7일 전부터만 받아 orderId로 합친다(새 것이 이긴다), 주문 시각순', async () => {
    const dir = tempDir();
    const first = account(SEQ, [[order('o1', '2026-10-01T09:00:00+09:00', { status: 'PARTIAL' }), order('o2', '2026-10-30T09:00:00+09:00')]]);
    await syncOrders({ dir, keyHash: 'kh', account: first.a, now: day1 });
    const day2 = kstEpoch('2026-11-05', '12:00:00');
    const second = account(SEQ, [[order('o2', '2026-10-30T09:00:00+09:00', { status: 'FILLED', price: 222 }), order('o3', '2026-11-04T09:00:00+09:00')]]);
    const orders = await syncOrders({ dir, keyHash: 'kh', account: second.a, now: day2 });
    expect(RESYNC_OVERLAP_DAYS).toBe(7);
    expect(second.closedOrders).toHaveBeenCalledWith({ from: addDays('2026-11-02', -7) });
    expect(orders.map((o) => [o.orderId, o.price])).toEqual([['o1', 100], ['o2', 222], ['o3', 100]]);
    expect(JSON.parse(readFileSync(orderCachePath(dir, 'kh', SEQ), 'utf8')).syncedThrough).toBe('2026-11-05');
  });

  it.skipIf(process.platform === 'win32')('캐시 파일이 644이거나 디렉터리가 755면 warn으로 알린다', async () => {
    const dir = tempDir();
    await syncOrders({ dir, keyHash: 'kh', account: account(SEQ, [[order('o1', '2026-10-01T09:00:00+09:00')]]).a, now: day1 });
    const warn: string[] = [];
    await syncOrders({ dir, keyHash: 'kh', account: account(SEQ, [[]]).a, now: day1, warn: (m) => warn.push(m) });
    expect(warn).toEqual([]);
    const file = orderCachePath(dir, 'kh', SEQ);
    chmodSync(file, 0o644);
    chmodSync(dir, 0o755);
    await syncOrders({ dir, keyHash: 'kh', account: account(SEQ, [[]]).a, now: day1, warn: (m) => warn.push(m) });
    expect(warn.some((m) => m.includes('chmod 600'))).toBe(true);
    expect(warn.some((m) => m.includes('chmod 700'))).toBe(true);
  });

  it('계좌가 바뀌면 다른 파일이다(처음부터 받는다)', async () => {
    const dir = tempDir();
    await syncOrders({ dir, keyHash: 'kh', account: account(SEQ, [[order('o1', '2026-10-01T09:00:00+09:00')]]).a, now: day1 });
    const other = account('another-acct-1', [[order('x1', '2026-10-02T09:00:00+09:00')]]);
    const orders = await syncOrders({ dir, keyHash: 'kh', account: other.a, now: day1 });
    expect(other.closedOrders.mock.calls[0][0]).toBeUndefined();
    expect(orders.map((o) => o.orderId)).toEqual(['x1']);
    expect(readdirSync(dir)).toHaveLength(2);
  });

  it('키(keyHash)가 바뀌어도 다른 파일', async () => {
    expect(orderCachePath('/d', 'a', SEQ)).not.toBe(orderCachePath('/d', 'b', SEQ));
  });
});
