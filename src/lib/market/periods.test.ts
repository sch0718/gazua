import { describe, expect, it } from 'vitest';
import { addDays } from '../time/kst';
import { PERIOD_COUNTS, fetchPlanFor, stepPeriod } from './periods';

const LAST = '2026-10-08';

describe('fetchPlanFor', () => {
  it('D1 is the 1-minute chart of the last trading day', () => {
    expect(fetchPlanFor({ unit: 'D', n: 1 }, LAST)).toEqual({
      interval: '1m',
      from: LAST,
      to: LAST,
      lookbackFrom: addDays(LAST, -40),
      markers: false,
    });
  });

  it('W2 starts the day after 14 days ago, daily bars, with markers', () => {
    const plan = fetchPlanFor({ unit: 'W', n: 2 }, LAST);
    expect(plan.from).toBe('2026-09-25');
    expect(plan.to).toBe(LAST);
    expect(plan.interval).toBe('1d');
    expect(plan.markers).toBe(true);
  });

  it('markers are on for W1-W4 only', () => {
    for (const n of PERIOD_COUNTS.W) {
      expect(fetchPlanFor({ unit: 'W', n }, LAST).markers).toBe(true);
    }
    for (const n of PERIOD_COUNTS.M) {
      expect(fetchPlanFor({ unit: 'M', n }, LAST).markers).toBe(false);
    }
    expect(fetchPlanFor({ unit: 'Y', n: 1 }, LAST).markers).toBe(false);
    expect(fetchPlanFor({ unit: 'D', n: 1 }, LAST).markers).toBe(false);
  });

  it('M6 starts the day after 6 calendar months ago', () => {
    const plan = fetchPlanFor({ unit: 'M', n: 6 }, LAST);
    expect(plan.from).toBe('2026-04-09');
    expect(plan.interval).toBe('1d');
    expect(plan.markers).toBe(false);
  });

  it('Y1 starts the day after 12 months ago', () => {
    const plan = fetchPlanFor({ unit: 'Y', n: 1 }, LAST);
    expect(plan.from).toBe('2025-10-09');
    expect(plan.to).toBe(LAST);
    expect(plan.interval).toBe('1d');
    expect(plan.markers).toBe(false);
  });

  it('clamps month subtraction to the last day of the target month', () => {
    expect(fetchPlanFor({ unit: 'M', n: 1 }, '2026-03-31').from).toBe('2026-03-01');
    expect(fetchPlanFor({ unit: 'M', n: 1 }, '2024-03-31').from).toBe('2024-03-01');
    expect(fetchPlanFor({ unit: 'M', n: 4 }, '2026-10-31').from).toBe('2026-07-01');
    expect(fetchPlanFor({ unit: 'M', n: 1 }, '2026-03-30').from).toBe('2026-03-01');
    expect(fetchPlanFor({ unit: 'Y', n: 1 }, '2024-02-29').from).toBe('2023-03-01');
  });

  it('crosses year boundaries when subtracting months', () => {
    expect(fetchPlanFor({ unit: 'M', n: 3 }, '2026-01-15').from).toBe('2025-10-16');
  });

  it('lookbackFrom is 40 days before from for every period', () => {
    for (const unit of Object.keys(PERIOD_COUNTS) as (keyof typeof PERIOD_COUNTS)[]) {
      for (const n of PERIOD_COUNTS[unit]) {
        const plan = fetchPlanFor({ unit, n }, LAST);
        expect(plan.lookbackFrom).toBe(addDays(plan.from, -40));
        expect(plan.to).toBe(LAST);
      }
    }
  });

  it('D1 lookbackFrom is last minus 40 days', () => {
    expect(fetchPlanFor({ unit: 'D', n: 1 }, LAST).lookbackFrom).toBe('2026-08-29');
  });

  it('only D uses 1-minute bars', () => {
    expect(fetchPlanFor({ unit: 'D', n: 1 }, LAST).interval).toBe('1m');
    expect(fetchPlanFor({ unit: 'W', n: 1 }, LAST).interval).toBe('1d');
    expect(fetchPlanFor({ unit: 'M', n: 1 }, LAST).interval).toBe('1d');
    expect(fetchPlanFor({ unit: 'Y', n: 1 }, LAST).interval).toBe('1d');
  });
});

describe('stepPeriod', () => {
  const order = [
    'D1', 'W1', 'W2', 'W3', 'W4', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'Y1',
  ];
  const parse = (s: string) => ({ unit: s[0] as 'D' | 'W' | 'M' | 'Y', n: Number(s[1]) });

  it('moves through D1,W1..W4,M1..M6,Y1', () => {
    for (let i = 0; i < order.length - 1; i++) {
      expect(stepPeriod(parse(order[i]), 1)).toEqual(parse(order[i + 1]));
      expect(stepPeriod(parse(order[i + 1]), -1)).toEqual(parse(order[i]));
    }
    expect(stepPeriod({ unit: 'W', n: 4 }, 1)).toEqual({ unit: 'M', n: 1 });
  });

  it('clamps at both ends', () => {
    expect(stepPeriod({ unit: 'D', n: 1 }, -1)).toEqual({ unit: 'D', n: 1 });
    expect(stepPeriod({ unit: 'Y', n: 1 }, 1)).toEqual({ unit: 'Y', n: 1 });
  });

  it('throws RangeError for a period outside the order', () => {
    expect(() => stepPeriod({ unit: 'W', n: 7 }, 1)).toThrow(RangeError);
  });
});
