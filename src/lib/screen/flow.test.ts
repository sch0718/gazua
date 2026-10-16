import { describe, expect, it } from 'vitest';
import { flowEnd, flowPrefix, flowRatio, flowStreak } from './flow';
import { precompute } from './precompute';
import { selectAt } from './select';
import { DATES, lcg, mkFileV3, mkStock, offCriteria, withFlow, type FlowStock } from './testData';
import type { FlowWho, SelectionCriteria } from './types';

// 30거래일, 재선정일 d = DATES[25], 전 거래일 p = 24번 봉 → 수급은 23번 봉(e)까지 쓴다
const N = 30;
const D = DATES[25];
const P = 24;
const E = 23;
const TV = 1e9; // 원. 수급 단위(백만 원)로 1000
const seq = (n: number, f: (j: number) => number): number[] => Array.from({ length: n }, (_, j) => f(j));

function amountCrit(who: FlowWho, days: number, minPct = -100, maxPct = 100): SelectionCriteria {
  const c = offCriteria();
  c.conditions.flow.amount = { on: true, who, days, minPct, maxPct };
  return c;
}
function streakCrit(who: FlowWho, minDays: number): SelectionCriteria {
  const c = offCriteria();
  c.conditions.flow.streak = { on: true, who, minDays };
  return c;
}
const pre = (stocks: FlowStock[], c: SelectionCriteria, n = N) => precompute(mkFileV3(stocks, n), c, null);
const ratioOf = (st: FlowStock, who: FlowWho, days: number, n = N, p = P) => {
  const c = amountCrit(who, days);
  const x = pre([st], c, n);
  return flowRatio(x, x.stocks[0], who, days, p);
};
// 직접 계산: Σ net × 1e6 / Σ tv × 100
const direct = (net: number[], tv: number[], lo: number, hi: number): number => {
  let a = 0;
  let b = 0;
  for (let j = lo; j <= hi; j++) {
    a += net[j];
    b += tv[j];
  }
  return ((a * 1e6) / b) * 100;
};

describe('flowPrefix·flowStreak', () => {
  it('누적합은 길이 n + 1이고 out[j] = net[0..j−1]의 합', () => {
    expect([...flowPrefix([3, -1, 4])]).toEqual([0, 3, 2, 6]);
  });
  it('연속 일수: 0 또는 음수에서 끊기고, 여러 주체는 함께 > 0인 날만 센다', () => {
    expect([...flowStreak([1, 2, 0, 5, 6, -1, 7, 8, 9])]).toEqual([1, 2, 0, 1, 2, 0, 1, 2, 3]);
    expect([...flowStreak([1, 1, 1, 1, 1], [1, -1, 1, 1, 0])]).toEqual([1, 0, 1, 2, 0]);
  });
});

describe('flowRatio: 순매수 비율(스펙 3.2)', () => {
  const f = seq(N, (j) => j * 10 - 120); // 앞은 음수, 뒤는 양수

  it('비율 = Σ순매수 × 1e6 ÷ Σ거래대금 × 100 (e = p − 1까지). 음수도 그대로', () => {
    const st = withFlow(mkStock('A', Array(N).fill(100)), 0, { f });
    expect(ratioOf(st, 'foreign', 5)).toBeCloseTo(direct(f, Array(N).fill(TV), E - 4, E), 12);
    expect(ratioOf(st, 'foreign', 5)).toBeCloseTo(((f[19] + f[20] + f[21] + f[22] + f[23]) * 1e6) / (5 * TV) * 100, 12);
    const neg = withFlow(mkStock('B', Array(N).fill(100)), 0, { f: f.map((x) => -x) });
    expect(ratioOf(neg, 'foreign', 5)).toBeLessThan(0);
    expect(ratioOf(neg, 'foreign', 5)).toBeCloseTo(-(ratioOf(st, 'foreign', 5) as number), 12);
  });

  it('주체별 배열을 쓰고, both는 [외국인, 기관]', () => {
    const i = seq(N, (j) => 50 - j);
    const p = seq(N, (j) => (j % 3) - 1);
    const st = withFlow(mkStock('A', Array(N).fill(100)), 0, { f, i, p });
    const tv = Array(N).fill(TV);
    expect(ratioOf(st, 'inst', 10)).toBeCloseTo(direct(i, tv, E - 9, E), 12);
    expect(ratioOf(st, 'indiv', 10)).toBeCloseTo(direct(p, tv, E - 9, E), 12);
    const both = ratioOf(st, 'both', 10) as [number, number];
    expect(both[0]).toBeCloseTo(direct(f, tv, E - 9, E), 12);
    expect(both[1]).toBeCloseTo(direct(i, tv, E - 9, E), 12);
  });

  it('분모(거래대금 합)가 0이면 NaN', () => {
    const tv = seq(N, (j) => (j >= E - 4 ? 0 : TV));
    const st = withFlow(mkStock('A', Array(N).fill(100), { tv }), 0, { f, i: f });
    expect(ratioOf(st, 'foreign', 5)).toBeNaN();
    expect(ratioOf(st, 'both', 5)).toEqual([NaN, NaN]);
    expect(ratioOf(st, 'foreign', 6)).not.toBeNaN(); // 하루라도 거래대금이 있으면 계산한다
  });

  it('창의 첫 날이 from이면 계산되고, from 하루 전이면 NaN', () => {
    const at19 = withFlow(mkStock('A', Array(N).fill(100)), 19, { f: f.slice(19) });
    expect(ratioOf(at19, 'foreign', 5)).toBeCloseTo(direct(f, Array(N).fill(TV), 19, 23), 12);
    const at20 = withFlow(mkStock('A', Array(N).fill(100)), 20, { f: f.slice(20) });
    expect(ratioOf(at20, 'foreign', 5)).toBeNaN();
    expect(ratioOf(at20, 'foreign', 4)).not.toBeNaN();
  });

  it('수급 끝이 e보다 앞서면(최근 수급을 받지 못한 종목) NaN. 끝 뒤를 0으로 보지 않는다', () => {
    const endAtE = withFlow(mkStock('A', Array(N).fill(100)), 0, { f: f.slice(0, E + 1) });
    expect(ratioOf(endAtE, 'foreign', 5)).toBeCloseTo(direct(f, Array(N).fill(TV), 19, 23), 12);
    const short = withFlow(mkStock('A', Array(N).fill(100)), 0, { f: f.slice(0, E) });
    expect(ratioOf(short, 'foreign', 5)).toBeNaN();
  });

  it('flowEnd: e = pIdx − 1의 수급 위치. from 앞·수급 끝 뒤·수급 없음은 −1', () => {
    const c = amountCrit('foreign', 5);
    const x = pre(
      [
        withFlow(mkStock('A', Array(N).fill(100)), 10, { f: Array(10).fill(1) }), // 10..19번 봉
        mkStock('B', Array(N).fill(100)),
      ],
      c,
    );
    const [a, b] = x.stocks;
    expect(flowEnd(a, 11)).toBe(0);
    expect(flowEnd(a, 20)).toBe(9);
    expect(flowEnd(a, 10)).toBe(-1);
    expect(flowEnd(a, 21)).toBe(-1);
    expect(flowEnd(b, 20)).toBe(-1);
    expect(b.flow).toBeNull();
    expect(flowRatio(x, b, 'foreign', 5, 20)).toBeNaN();
  });

  it('미리 계산에 그 주체의 누적합이 없으면 던진다', () => {
    const c = amountCrit('foreign', 5);
    const x = pre([withFlow(mkStock('A', Array(N).fill(100)), 0, { f })], c);
    expect(() => flowRatio(x, x.stocks[0], 'inst', 5, P)).toThrow();
  });

  it('임의 데이터 200일: 누적합 비율이 날마다 직접 합계와 1e-9 안에서 같다(수급 끝이 마지막 봉 앞)', () => {
    const r = lcg(11);
    const n = 200;
    const from = 7;
    const len = 180; // 7..186번 봉. 187번 봉부터 수급 끝 뒤
    const tv = seq(n, () => Math.round(r() * 5e10));
    const net = { f: seq(len, () => Math.round((r() - 0.5) * 4000)), i: seq(len, () => Math.round((r() - 0.5) * 4000)), p: seq(len, () => Math.round((r() - 0.5) * 4000)) };
    const st = withFlow(mkStock('A', Array(n).fill(100), { tv }), from, net);
    const tvFlow = tv.slice(from, from + len);
    let checked = 0;
    for (const [who, days] of [
      ['foreign', 5],
      ['inst', 20],
      ['indiv', 37],
      ['both', 12],
    ] as [FlowWho, number][]) {
      const c = amountCrit(who, days);
      const x = pre([st], c, n);
      for (let p = 0; p < n; p++) {
        const got = flowRatio(x, x.stocks[0], who, days, p);
        const e = p - 1 - from;
        const ok = e - days + 1 >= 0 && e < len;
        const want = (k: 'f' | 'i' | 'p') => (ok ? direct(net[k], tvFlow, e - days + 1, e) : NaN);
        const exp = who === 'both' ? [want('f'), want('i')] : [want(who === 'foreign' ? 'f' : who === 'inst' ? 'i' : 'p')];
        const g = Array.isArray(got) ? got : [got];
        g.forEach((v, k) => {
          if (Number.isNaN(exp[k])) expect(v, `${who} ${p}`).toBeNaN();
          else {
            expect(Math.abs(v - exp[k]), `${who} ${p}`).toBeLessThan(1e-9 * Math.max(1, Math.abs(exp[k])));
            checked++;
          }
        });
      }
    }
    expect(checked).toBeGreaterThan(500);
  });
});

describe('연속 순매수(스펙 3.3)', () => {
  const streakOf = (st: FlowStock, who: FlowWho) => {
    const c = streakCrit(who, 1);
    const x = pre([st], c);
    const e = flowEnd(x.stocks[0], P);
    return e < 0 ? -1 : x.stocks[0].flow!.streak[e];
  };
  // e(23번 봉)에서 거꾸로: 21번 봉이 끊는다
  const breakAt21 = (v: number) => seq(N, (j) => (j === 21 ? v : j === P ? -999 : 5));

  it('e부터 거꾸로 세어 net > 0이 이어진 수. 중간의 0과 음수에서 끊긴다(p 당일 값은 보지 않는다)', () => {
    expect(streakOf(withFlow(mkStock('A', Array(N).fill(100)), 0, { i: breakAt21(0) }), 'inst')).toBe(2);
    expect(streakOf(withFlow(mkStock('A', Array(N).fill(100)), 0, { i: breakAt21(-3) }), 'inst')).toBe(2);
    expect(streakOf(withFlow(mkStock('A', Array(N).fill(100)), 0, { i: breakAt21(3) }), 'inst')).toBe(E + 1);
  });

  it('both는 외국인과 기관이 같은 날 함께 > 0인 날만 센다', () => {
    const f = seq(N, (j) => (j === 20 ? -1 : 2));
    const i = seq(N, (j) => (j === 22 ? 0 : 2));
    const st = withFlow(mkStock('A', Array(N).fill(100)), 0, { f, i });
    expect(streakOf(st, 'foreign')).toBe(3); // 21·22·23
    expect(streakOf(st, 'inst')).toBe(1); // 23
    expect(streakOf(st, 'both')).toBe(1);
  });

  it('from에 닿도록 끊기지 않으면 센 만큼만 인정한다(모르는 앞날은 세지 않는다)', () => {
    const st = withFlow(mkStock('A', Array(N).fill(100)), 20, { i: Array(10).fill(7) }); // 20..29번 봉
    expect(streakOf(st, 'inst')).toBe(4); // 20·21·22·23
    const run = (minDays: number) => selectAt(D, pre([st], streakCrit('inst', minDays)), streakCrit('inst', minDays));
    expect(run(4).picked).toMatchObject([{ symbol: 'A', values: { flowStreak: 4 } }]);
    expect(run(5).passed).toBe(0);
  });
});
