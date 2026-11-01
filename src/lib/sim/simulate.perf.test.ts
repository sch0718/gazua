// 설계 §6.3: 10년·8종목에서 timeline을 켜도 계산 시간이 끈 때의 2배 이하. 절대 시간은 로그로만 남긴다.
import { expect, it } from 'vitest';
import { simulate, type SimOptions } from './simulate';
import { tradingDates } from './testBars';
import { baseStrategy, randomWalk, stockOf } from './testInputs';
import type { SimInput } from './types';

it('10년(2,450거래일)·8종목: timeline 켬 시간이 끔의 2배 이하', () => {
  const WARM = 60;
  const all = tradingDates('2015-01-05', WARM + 2450);
  const days = all.slice(WARM);
  const strategy = baseStrategy((x) => {
    x.scaleIn = { on: true, stepPct: 3, maxAdds: 2 };
    x.exit.takeProfit = [{ pct: 5, sellPct: 50 }, { pct: 10, sellPct: 100 }];
    x.exit.afterFirstTake = 'breakeven';
    x.entry.decline.dropPct.value = 5;
    x.capital.perBuyPct = 12;
  });
  const input: SimInput = { strategy, days, stocks: Array.from({ length: 8 }, (_, k) => stockOf(k, randomWalk(all, 101 * (k + 1)))), index: null, benchmarkStock: null };

  const time = (opts?: SimOptions) => {
    const t0 = performance.now();
    simulate(input, opts);
    return performance.now() - t0;
  };
  // 워밍업(JIT)
  expect(simulate(input).trades.length).toBeGreaterThan(100);
  simulate(input, { timeline: true });

  const off: number[] = [];
  const on: number[] = [];
  for (let k = 0; k < 7; k++) {
    off.push(time());
    on.push(time({ timeline: true }));
  }
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  console.info(`simulate 10년·8종목: timeline 끔 ${median(off).toFixed(1)}ms, 켬 ${median(on).toFixed(1)}ms`);
  expect(median(on)).toBeLessThanOrEqual(median(off) * 2);
}, 60_000);
