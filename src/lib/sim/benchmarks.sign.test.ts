// 하락 기준선에서 보유·지수·비교 종목 수익률과 세 차이(전략 − 기준선)를 정수 산수 손계산으로 고정한다(점검표 2절).
import { describe, expect, it } from 'vitest';
import { newStrategy } from './defaults';
import { simulate } from './simulate';
import { bar, tradingDates } from './testBars';
import type { SimInput } from './types';

const DAYS = tradingDates('2026-01-05', 6);
const flatBars = (closes: number[]) => DAYS.map((d, i) => bar(d, closes[i], closes[i], closes[i], closes[i]));

const INITIAL = 10_000_000;
const FEE = 100_015; // 1 + 0.015%를 10만 배한 정수

/** 엔진 함수를 쓰지 않는 손계산: budget 안에서 price에 살 수 있는 최대 수량과 남은 현금 */
function buy(budget: number, price: number): { qty: number; cash: number } {
  const qty = Math.floor((budget * 100_000) / (price * FEE));
  return { qty, cash: (budget * 100_000 - qty * price * FEE) / 100_000 };
}
const pct = (end: number) => (end / INITIAL - 1) * 100;

function input(): SimInput {
  const s = newStrategy(0, null);
  s.capital = { initial: INITIAL };
  s.sizing = { mode: 'fixed', pct: 10 };
  s.costs = { feePct: 0.015 };
  // A가 0일 → 1일 +1%일 때만 맞는다. 1일 종가 신호 → 2일 시가 매수. B는 오르지 않아 신호가 없다
  s.rules.buy = [{ conds: [{ kind: 'change', days: 1, pct: 0.5, op: 'above' }] }];
  s.rules.sell.takeProfit.on = false;
  s.rules.sell.stopLoss.on = false;
  s.rules.sell.trailing.on = false;
  s.rules.sell.timeExit.on = false;
  s.rules.sell.signal = { on: false, groups: [] };
  s.scaleIn.on = false;
  return {
    strategy: s,
    days: DAYS,
    stocks: [
      { symbol: 'A', name: 'A', market: 'KOSPI', isEtf: false, candles: flatBars([10_000, 10_100, 10_100, 10_100, 10_100, 8_000]) },
      { symbol: 'B', name: 'B', market: 'KOSPI', isEtf: false, candles: flatBars([5_000, 5_000, 5_000, 5_000, 5_000, 4_500]) },
    ],
    index: { id: 'KOSPI', candles: flatBars([2_000, 2_000, 2_000, 2_000, 2_000, 1_800]) },
    benchmarkStock: { symbol: 'C', name: 'C', market: 'KOSPI', isEtf: false, candles: flatBars([20_000, 20_000, 20_000, 20_000, 20_000, 22_000]) },
  };
}

describe('기준선 부호 검산(하락 기준선 둘, 상승 기준선 하나)', () => {
  const r = simulate(input());

  // 전략: 2일 시가 10,100원에 1회 금액 1,000,000원어치 → 98주, 끝날 8,000원
  const st = buy(1_000_000, 10_100);
  const strategyEnd = INITIAL - 1_000_000 + st.cash + st.qty * 8_000;
  // 보유: 몫 5,000,000원씩 첫날 시가에 산다
  const a = buy(5_000_000, 10_000);
  const b = buy(5_000_000, 5_000);
  const holdEnd = a.cash + a.qty * 8_000 + b.cash + b.qty * 4_500;
  // 지수: 첫날 시가 2,000 → 끝날 종가 1,800
  const indexEnd = (INITIAL * 1_800) / 2_000;
  // 비교 종목: 첫날 시가 20,000원에 전액 → 끝날 22,000원
  const c = buy(INITIAL, 20_000);
  const benchEnd = c.cash + c.qty * 22_000;

  it('손계산 수량과 값(산수 고정)', () => {
    expect([st.qty, a.qty, b.qty, c.qty]).toEqual([98, 499, 999, 499]);
    expect(strategyEnd).toBeCloseTo(9_794_051.53, 6);
    expect(holdEnd).toBeCloseTo(8_501_002.25, 6);
    expect(benchEnd).toBeCloseTo(10_996_503, 6);
  });

  it('전략은 한 번 사서 끝까지 든다', () => {
    expect(r.trades.map((t) => [t.kind, t.symbol, t.date, t.price, t.qty])).toEqual([['buy', 'A', DAYS[2], 10_100, 98]]);
  });

  it('부호: 보유 < 0, 지수 < 0, 비교 종목 > 0', () => {
    expect(r.benchmarks.holdReturnPct).toBeLessThan(0);
    expect(r.benchmarks.indexReturnPct!).toBeLessThan(0);
    expect(r.benchmarks.benchmarkReturnPct!).toBeGreaterThan(0);
  });

  it('수익률과 세 차이(전략 − 기준선)가 손계산과 같다', () => {
    expect(r.summary.totalReturnPct).toBeCloseTo(pct(strategyEnd), 6);
    expect(r.benchmarks.holdReturnPct).toBeCloseTo(pct(holdEnd), 6);
    expect(r.benchmarks.indexReturnPct!).toBeCloseTo(-10, 6);
    expect(r.benchmarks.benchmarkReturnPct!).toBeCloseTo(pct(benchEnd), 6);
    expect(r.summary.vsHoldPp).toBeCloseTo(pct(strategyEnd) - pct(holdEnd), 6);
    expect(r.summary.vsIndexPp!).toBeCloseTo(pct(strategyEnd) - -10, 6);
    expect(r.summary.vsBenchmarkPp!).toBeCloseTo(pct(strategyEnd) - pct(benchEnd), 6);
    // 값으로도: 전략 −2.06%, 보유 −14.99%, 비교 종목 +9.97%
    expect(r.summary.vsHoldPp).toBeCloseTo(12.9304928, 6);
    expect(r.summary.vsIndexPp!).toBeCloseTo(7.9405153, 6);
    expect(r.summary.vsBenchmarkPp!).toBeCloseTo(-12.0245147, 6);
  });

  it('마지막 날 곡선 값이 손계산과 같다(곡선 연결)', () => {
    const last = r.equity[r.equity.length - 1];
    expect(last.strategy).toBeCloseTo(strategyEnd, 4);
    expect(last.hold).toBeCloseTo(holdEnd, 4);
    expect(last.index!).toBeCloseTo(indexEnd, 4);
    expect(last.benchmark!).toBeCloseTo(benchEnd, 4);
  });
});
