import type { Candle } from '../../../src/lib/data/metrics';
import { openPosition, type Position } from '../../../src/lib/sim/position';
import type { Strategy } from '../../../src/lib/sim/types';
import { kstEpoch } from '../../../src/lib/time/kst';
import type { DayBar } from '../naverMarket';
import { buyBudget } from '../proposals';
import type { AutoLedger, AutoPosition } from './ledger';
import { tickUp } from './tick';

export function toCandles(bars: DayBar[]): Candle[] {
  return bars.map((b) => ({ t: kstEpoch(b.date, '00:00:00'), o: b.open, h: b.high ?? Math.max(b.open, b.close), l: b.low ?? Math.min(b.open, b.close), c: b.close, v: b.volume ?? 0 }));
}

export function restore(pos: AutoPosition, strategy: Strategy): Position {
  const position = openPosition(pos.buyPrice, pos.boughtQty, { ...strategy.scaleIn, on: false }, strategy.rules.sell);
  for (const sale of pos.sells) position.sell(sale.qty, sale.stage);
  position.markClose(pos.peak);
  return position;
}

export function decideSell(pos: AutoPosition, strategy: Strategy, price: number, heldDays: number, sellSignal: boolean): { qty: number; reason: string; stage?: number } | null {
  if (pos.qty <= 0) return null;
  const position = restore(pos, strategy);
  position.markClose(price);
  const stop = position.stopPrice();
  if (stop !== null && price <= stop) return { qty: pos.qty, reason: '손절' };
  const trail = position.trailPrice();
  if (trail !== null && price <= trail) return { qty: pos.qty, reason: '추적 손절' };
  const takes = position.takeLevels().filter((t) => price >= t.price);
  if (takes.length) {
    const stage = Math.max(...takes.map((t) => t.stage));
    const qty = stage === strategy.rules.sell.takeProfit.stages.length ? pos.qty : Math.min(pos.qty, takes.reduce((sum, t) => sum + t.qty, 0));
    if (qty > 0) return { qty, reason: `${stage}단계 익절`, stage };
  }
  const exit = strategy.rules.sell.timeExit;
  if (exit.on && heldDays >= exit.days) return { qty: pos.qty, reason: '기간 청산' };
  return sellSignal ? { qty: pos.qty, reason: '매도 조건' } : null;
}

export function decideBuy(i: {
  strategy: Strategy; symbolCount: number; symbol: string; price: number; minute: number; match: boolean; reason?: string; ledger: AutoLedger; held: boolean; buySlipPct: number;
}): { qty: number; price: number; reason: string } | { skip: string } | null {
  if (!i.match || i.minute >= 915) return null;
  if (i.ledger.today.bought.includes(i.symbol) || i.ledger.today.sold.includes(i.symbol)) return { skip: '오늘 이미 매수·매도를 시도했어요' };
  if (i.held || i.ledger.positions.some((p) => p.symbol === i.symbol)) return { skip: '이미 보유 중이에요' };
  const price = tickUp(i.price * (1 + i.buySlipPct / 100));
  const qty = Math.floor(buyBudget(i.strategy, i.symbolCount) / price);
  if (!Number.isSafeInteger(price) || price <= 0 || !Number.isSafeInteger(qty) || qty <= 0 || !Number.isSafeInteger(price * qty)) return { skip: '1회 금액으로 1주도 살 수 없어요' };
  return { qty, price, reason: `매수 조건${i.reason ? `: ${i.reason}` : ''}` };
}
