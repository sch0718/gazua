// 주문을 모두 더한 수량과 보유 수량 대조. 스펙 3.4.
import type { AccountHolding } from '../providers/types';
import type { Trade } from './types';

/** ok 같음 · more 보유가 더 많음(입고·시간외 매수) · less 보유가 더 적음(출고·시간외 매도) · unknown 보유를 받지 못함 */
export type ReconcileStatus = 'ok' | 'more' | 'less' | 'unknown';

export interface Reconciliation {
  bySymbol: Map<string, { status: ReconcileStatus; computed: number; held: number | null }>;
  /** 주문 기록 없이 보유한 종목(계산에 넣지 않는다) */
  unrecorded: AccountHolding[];
  /** 맞지 않는 종목 수(주문 기록 없는 보유 포함) */
  mismatches: number;
}

export function reconcile(trades: Trade[], holdings: AccountHolding[] | null): Reconciliation {
  const computed = new Map<string, number>();
  for (const t of trades) computed.set(t.symbol, (computed.get(t.symbol) ?? 0) + (t.side === 'BUY' ? t.qty : -t.qty));
  const held = holdings ? new Map(holdings.map((h) => [h.symbol, h.quantity])) : null;
  const bySymbol: Reconciliation['bySymbol'] = new Map();
  let mismatches = 0;
  for (const [symbol, c] of computed) {
    if (!held) {
      bySymbol.set(symbol, { status: 'unknown', computed: c, held: null });
      continue;
    }
    const h = held.get(symbol) ?? 0;
    // 소수 수량(소수점 주문) 오차는 무시한다
    const status: ReconcileStatus = Math.abs(h - c) < 1e-6 ? 'ok' : h > c ? 'more' : 'less';
    if (status !== 'ok') mismatches++;
    bySymbol.set(symbol, { status, computed: c, held: h });
  }
  const unrecorded = holdings ? holdings.filter((h) => !computed.has(h.symbol) && h.quantity > 0) : [];
  return { bySymbol, unrecorded, mismatches: mismatches + unrecorded.length };
}
