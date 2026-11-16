import type { Strategy } from '../../../src/lib/sim/types';
import { kstDate, kstMinuteOfDay } from '../../../src/lib/time/kst';
import type { DayBar } from '../naverMarket';
import { evaluateAt } from '../signals';
import type { AutoConfig } from './config';
import { decideBuy, decideSell, toCandles } from './judge';
import { writeLedger, type AutoLedger, type AutoTrade } from './ledger';
import type { AutoOrder } from './run';
import { tickDown } from './tick';

export interface PresetResult { id: string; name: string; buys: AutoOrder[]; sells: AutoOrder[]; error?: string }

/** 프리셋은 연습 원장만 갱신하며 주문·알림을 보내지 않는다. */
export async function judgeDry(strategy: Strategy, ledger: AutoLedger, bars: Map<string, DayBar[]>, o: {
  symbols: string[]; cfg: AutoConfig; path: string; now: () => number; canJudge: () => boolean; nameOf: (symbol: string) => Promise<string>;
}): Promise<PresetResult> {
  const today = kstDate(o.now());
  const out: PresetResult = { id: strategy.id, name: strategy.name, buys: [], sells: [] };
  const save = () => writeLedger(o.path, ledger);
  const record = async (side: 'BUY' | 'SELL', symbol: string, qty: number, price: number, reason: string) => {
    const trade: AutoTrade = { side, symbol, name: await o.nameOf(symbol), qty, price, reason };
    (ledger.today.trades ??= []).push(trade);
    (side === 'BUY' ? out.buys : out.sells).push({ symbol, quantity: qty, price, reason, result: 'dry' });
    save();
  };
  ledger.strategyId = strategy.id;
  ledger.today.judgedDate = ledger.today.date;
  save();
  for (const p of [...ledger.positions]) {
    const days = bars.get(p.symbol);
    if (!days) continue;
    const current = days.at(-1)!.close;
    p.peak = Math.max(p.peak, current);
    if (p.pendingSell || p.sellBlocked === today) continue;
    const candles = toCandles(days);
    const signal = strategy.rules.sell.signal.on && evaluateAt(candles, strategy.rules.sell.signal.groups, candles.length - 1).match;
    const decision = decideSell(p, strategy, current, days.filter((b) => b.date >= p.boughtAt).length, signal);
    if (!decision || !o.canJudge()) continue;
    const qty = Math.min(decision.qty, p.qty), price = tickDown(current * (1 - o.cfg.sellSlipPct / 100));
    if (qty <= 0 || price <= 0 || !Number.isSafeInteger(price * qty)) continue;
    ledger.today.sold = [...new Set([...ledger.today.sold, p.symbol])];
    p.sells.push({ qty, ...(decision.stage === undefined ? {} : { stage: decision.stage }) });
    p.qty -= qty;
    if (!p.qty) ledger.positions = ledger.positions.filter((pos) => pos !== p);
    await record('SELL', p.symbol, qty, price, decision.reason);
  }
  for (const symbol of o.symbols) {
    const days = bars.get(symbol);
    if (!days || !o.canJudge()) continue;
    const current = days.at(-1)!.close, candles = toCandles(days);
    const signal = evaluateAt(candles, strategy.rules.buy, candles.length - 1);
    const decision = decideBuy({ strategy, symbolCount: o.symbols.length, symbol, price: current, minute: kstMinuteOfDay(o.now()), match: signal.match, reason: signal.reason, ledger, held: false, buySlipPct: o.cfg.buySlipPct });
    if (!decision || 'skip' in decision || !o.canJudge() || kstMinuteOfDay(o.now()) >= 915) continue;
    ledger.today.bought.push(symbol);
    ledger.positions.push({ symbol, boughtAt: today, buyPrice: decision.price, boughtQty: decision.qty, qty: decision.qty, peak: decision.price, sells: [] });
    await record('BUY', symbol, decision.qty, decision.price, decision.reason);
  }
  save();
  return out;
}
