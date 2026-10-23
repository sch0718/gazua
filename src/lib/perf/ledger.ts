// 주문 → 국내 체결 목록. 스펙 2.3·3.2.
import type { AccountOrder } from '../providers/types';
import { kstDate } from '../time/kst';
import type { Trade } from './types';

/** ISO 시각의 KST 날짜. 읽지 못하면 null. */
function kstDayOf(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : kstDate(ms);
}

/**
 * KRW 주문만 남기고(나머지는 foreign으로 센다) 체결일(filledAt, 없으면 orderedAt의 KST 날짜)을 붙인다.
 * 날짜순, 같은 날은 매수 먼저, 그다음 주문 시각·주문 id 순. 같은 orderId는 처음 것만 쓴다.
 */
export function normalizeOrders(orders: AccountOrder[]): { trades: Trade[]; foreign: number; dropped: number } {
  const seen = new Set<string>();
  const trades: Trade[] = [];
  let foreign = 0;
  let dropped = 0;
  for (const r of orders) {
    if (seen.has(r.orderId)) continue;
    seen.add(r.orderId);
    if (r.currency !== 'KRW') {
      foreign++;
      continue;
    }
    const date = kstDayOf(r.filledAt) ?? kstDayOf(r.orderedAt);
    if (!date) {
      dropped++;
      continue;
    }
    trades.push({
      orderId: r.orderId,
      symbol: r.symbol,
      side: r.side,
      date,
      orderedAt: r.orderedAt,
      qty: r.quantity,
      price: r.price,
      amount: r.amount,
      commission: r.commission,
      tax: r.tax,
    });
  }
  const at = (t: Trade) => Date.parse(t.orderedAt) || 0;
  trades.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.side === b.side ? 0 : a.side === 'BUY' ? -1 : 1) ||
      at(a) - at(b) ||
      a.orderId.localeCompare(b.orderId),
  );
  return { trades, foreign, dropped };
}
