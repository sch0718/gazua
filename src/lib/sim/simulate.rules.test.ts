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

const kinds = (r: ReturnType<typeof simulate>) => r.trades.map((t) => `${t.kind}@${+t.price.toFixed(2)}`);

describe('손절·익절 끄기와 트레일링(§4.3·§4.4)', () => {
  // 인덱스 9 시가 86 매수 → 10 종가 100(기준가 100, 트레일 90)
  const up: Ohlc = [86, 100, 86, 100];
  const noTake = (edit: (s: Strategy) => void = () => {}) =>
    v2((s) => {
      s.rules.sell.takeProfit.on = false;
      s.rules.sell.trailing = { on: true, pct: 10 };
      edit(s);
    });

  it('보유 중 최고 종가에서 N% 내려오면 그 가격에 판다', () => {
    const r = simulate(input(noTake(), [[[86, 86, 86, 86], up, [99, 99, 89, 89], ...flat([89, 89])]]));
    expect(kinds(r)).toEqual(['buy@86', 'trail@90']);
    expect(r.trades[1].reason).toBe('트레일링 −10%');
  });
  it('시가가 트레일 아래로 갭이면 시가에 팔고 사유에 (갭)', () => {
    const r = simulate(input(noTake(), [[[86, 86, 86, 86], up, [85, 85, 85, 85], ...flat([85, 85])]]));
    expect(kinds(r)).toEqual(['buy@86', 'trail@85']);
    expect(r.trades[1].reason).toBe('트레일링 −10%(갭)');
  });
  it('손절가 = 트레일 가격이면 손절', () => {
    const s = noTake((x) => (x.rules.sell.stopLoss = { on: true, pct: 10, basis: 'firstBuy' }));
    const r = simulate(input(s, [[[86, 86, 86, 86], [80, 80, 70, 75], ...flat([75, 75])]]));
    expect(r.trades.map((t) => t.kind)).toEqual(['buy', 'stop']);
  });
  it('손절을 끄면 크게 떨어져도 팔지 않는다', () => {
    const s = v2((x) => {
      x.rules.sell.takeProfit.on = false;
      x.rules.sell.stopLoss.on = false;
    });
    const r = simulate(input(s, [[[86, 86, 40, 43], ...flat([43, 43, 43])]]));
    expect(r.trades.map((t) => t.kind)).toEqual(['buy']);
  });
  it('익절을 끄면 크게 올라도 팔지 않는다', () => {
    const s = v2((x) => (x.rules.sell.takeProfit.on = false));
    const r = simulate(input(s, [[[86, 200, 86, 190], ...flat([190, 190, 190])]]));
    expect(r.trades.map((t) => t.kind)).toEqual(['buy']);
  });
  it('손절을 꺼도 1단계 익절 뒤 본전 손절은 산다', () => {
    const s = v2((x) => {
      x.rules.sell.stopLoss.on = false;
      x.rules.sell.takeProfit = { on: true, stages: [{ pct: 5, sellPct: 50 }, { pct: 50, sellPct: 100 }], afterFirstTake: 'breakeven' };
    });
    const r = simulate(input(s, [[[86, 91, 86, 90], [90, 90, 80, 82], ...flat([82, 82])]]));
    expect(r.trades.map((t) => t.kind)).toEqual(['buy', 'take', 'stop']);
  });
});
