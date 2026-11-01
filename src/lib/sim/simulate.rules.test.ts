// 전략 빌더 엔진(배분·트레일링·기간 청산·조건 매도) 동작. 대표 입력은 testInputs의 봉 도우미를 쓴다.
import { describe, expect, it } from 'vitest';
import { simulate } from './simulate';
import { baseStrategy, BASE, candlesFrom, D, flat, stockOf, type Ohlc } from './testInputs';
import type { SimInput, Strategy } from './types';

/** BASE 뒤에 봉을 붙인 종목들로 입력을 만든다. 인덱스 8 종가 신호 → 인덱스 9 시가 매수 */
function input(strategy: Strategy, rests: Ohlc[][], n = 16): SimInput {
  return { strategy, days: D.slice(0, n), stocks: rests.map((r, k) => stockOf(k, candlesFrom(BASE, r))), index: null, benchmarkStock: null };
}
const v2 = (edit: (s: Strategy) => void) => {
  const s = baseStrategy();
  edit(s);
  return s;
};
const buys = (r: ReturnType<typeof simulate>) => r.trades.filter((t) => t.kind === 'buy' || t.kind === 'add');

describe('자금 배분(§6)', () => {
  const flatRest = flat([86, 86, 86, 86, 86, 86, 86]);
  it('fixed: 처음 자금 × pct', () => {
    const r = simulate(input(v2((s) => (s.sizing = { mode: 'fixed', pct: 10 })), [flatRest]));
    expect(buys(r)[0].qty).toBe(Math.floor(1_000_000 / (86 * 1.00015)));
  });
  it('equal: 처음 자금 ÷ 받은 종목 수', () => {
    const r = simulate(input(v2((s) => (s.sizing = { mode: 'equal', pct: 10 })), [flatRest, flatRest]));
    expect(buys(r)[0].qty).toBe(Math.floor(5_000_000 / (86 * 1.00015)));
  });
  it('cashPct: 같은 시가에 앞 종목이 산 뒤 남은 현금으로', () => {
    const r = simulate(input(v2((s) => (s.sizing = { mode: 'cashPct', pct: 50 })), [flatRest, flatRest]));
    const [a, b] = buys(r);
    expect(a.symbol).toBe('S0');
    expect(b.symbol).toBe('S1');
    expect(b.qty).toBeLessThan(a.qty);
  });
  it('equityPct: 전 거래일 종가 총자산 기준(첫 매수일 전날 총자산 = 처음 자금)', () => {
    const r = simulate(input(v2((s) => (s.sizing = { mode: 'equityPct', pct: 10 })), [flatRest]));
    expect(buys(r)[0].qty).toBe(Math.floor(1_000_000 / (86 * 1.00015)));
  });
  it('추가 매수는 포지션을 열 때 정한 금액을 쓴다(cashPct)', () => {
    const s = v2((x) => {
      x.sizing = { mode: 'cashPct', pct: 50 };
      x.scaleIn = { on: true, stepPct: 3, maxAdds: 1 };
      x.rules.sell.stopLoss.on = true;
    });
    const r = simulate(input(s, [[[86, 86, 82, 83], ...flat([83, 83, 83, 83])]]));
    const [first, add] = buys(r);
    expect(add.kind).toBe('add');
    expect(add.qty * add.price).toBeLessThanOrEqual(first.qty * first.price * 1.06);
    expect(add.qty * add.price).toBeGreaterThan(first.qty * first.price * 0.9);
  });
});
