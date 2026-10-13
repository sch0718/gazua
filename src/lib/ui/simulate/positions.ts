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

/** 끝난 포지션의 수익률(%): 판 금액 ÷ 산 금액 − 1(매도 줄 pnlPct처럼 비용 제외). 보유 중이면 null. */
export function positionReturnPct(p: Position): number | null {
  if (!p.closed) return null;
  let bought = 0;
  let sold = 0;
  for (const t of p.trades) {
    if (t.kind === 'buy' || t.kind === 'add') bought += t.qty * t.price;
    else sold += t.qty * t.price;
  }
  return bought > 0 ? (sold / bought - 1) * 100 : null;
}
