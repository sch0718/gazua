// 포지션 묶기: 한 종목에서 매수부터 보유 수량이 0이 될 때까지의 거래.
import type { Trade } from '../../sim/types';

export interface Position {
  trades: Trade[];
  /** 전량 매도로 끝났는지(false면 보유 중) */
  closed: boolean;
}

const sameTrade = (a: Trade, b: Trade) =>
  a === b || (a.date === b.date && a.symbol === b.symbol && a.kind === b.kind && a.price === b.price && a.qty === b.qty && a.stage === b.stage);

/** 누른 거래가 속한 포지션. 못 찾으면 null. */
export function positionOf(all: Trade[], trade: Trade): Position | null {
  const mine = all.filter((t) => t.symbol === trade.symbol);
  const target = mine.includes(trade) ? trade : mine.find((t) => sameTrade(t, trade));
  if (!target) return null;
  let cur: Trade[] = [];
  let qty = 0;
  for (const t of mine) {
    cur.push(t);
    qty += t.kind === 'buy' || t.kind === 'add' ? t.qty : -t.qty;
    if (qty <= 0) {
      if (cur.includes(target)) return { trades: cur, closed: true };
      cur = [];
      qty = 0;
    }
  }
  return cur.includes(target) ? { trades: cur, closed: false } : null;
}
