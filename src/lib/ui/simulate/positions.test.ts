import { describe, expect, it } from 'vitest';
import { newStrategy } from '../../sim/defaults';
import { simulate, simulateCore } from '../../sim/simulate';
import { bar, tradingDates } from '../../sim/testBars';
import type { SimInput, Trade } from '../../sim/types';
import { positionOf, positionReturnPct } from './positions';

const t = (over: Partial<Trade>): Trade => ({ date: '2026-03-02', symbol: 'X', kind: 'buy', price: 1000, qty: 100, fee: 0, tax: 0, reason: 'B 돌파', ...over });

describe('positionReturnPct', () => {
  it('비용 포함: 100주 1,000원 매수·1,010원 매도, 수수료 1%·세금 0.2% → −1,212원 = −1.2%', () => {
    const trades = [
      t({ kind: 'buy', price: 1000, qty: 100, fee: 1000 }),
      t({ kind: 'take', price: 1010, qty: 100, fee: 1010, tax: 202, date: '2026-03-03', stage: 1 }),
    ];
    const p = positionOf(trades, trades[0])!;
    expect(positionReturnPct(p)).toBeCloseTo((-1212 / 101_000) * 100, 10);
  });

  it('비용이 없으면 판 금액 ÷ 산 금액 − 1, 보유 중이면 null', () => {
    const trades = [t({ price: 100, qty: 10 }), t({ kind: 'take', price: 110, qty: 10, date: '2026-03-03' })];
    expect(positionReturnPct(positionOf(trades, trades[0])!)).toBeCloseTo(10, 10);
    expect(positionReturnPct(positionOf([trades[0]], trades[0])!)).toBeNull();
  });

  it('요약의 승패·round trip 손익과 같은 정의: 수수료 1%·익절 1%는 0승 1패이고 시트도 음수', () => {
    const s = newStrategy(0, null);
    s.capital = { initial: 10_000_000, perBuyPct: 10 };
    s.costs.feePct = 1;
    s.entry.triggers.breakout.on = false;
    s.exit.takeProfit = [{ pct: 1, sellPct: 100 }];
    s.exit.stopLoss = { pct: 5, basis: 'avgAlways' };
    const days = tradingDates('2026-01-05', 11);
    const closes = [90, 100, 92, 95, 88, 80, 82, 84, 86];
    const candles = [...closes.map((c, i) => bar(days[i], c, c, c, c)), bar(days[9], 87, 90, 87, 89), bar(days[10], 89, 89, 89, 89)];
    const input: SimInput = {
      strategy: s,
      days,
      stocks: [{ symbol: 'X', name: 'X', market: 'KOSPI', isEtf: false, candles }],
      index: null,
      benchmarkStock: null,
    };
    const r = simulate(input);
    expect(r.summary).toMatchObject({ wins: 0, losses: 1 });
    expect(r.summary.totalReturnPct).toBeLessThan(0);
    const core = simulateCore(input);
    const rt = core.roundTrips[0];
    expect(rt.pnl).toBeLessThan(0);
    const pct = positionReturnPct(positionOf(core.trades, core.trades[0])!)!;
    expect(pct).toBeLessThan(0);
    expect(pct).toBeCloseTo((rt.pnl / rt.cost) * 100, 10);
  });
});
