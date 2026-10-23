import { describe, expect, it } from 'vitest';
import { daysBetween, periodReturn, xirr } from './xirr';

describe('xirr', () => {
  it('one year, 1.1x is 10%', () => {
    expect(xirr([{ date: '2025-01-01', amount: -100 }, { date: '2026-01-01', amount: 110 }])).toBeCloseTo(0.1, 9);
  });

  it('half a year at 1.05x annualizes to about 10.4%', () => {
    const r = xirr([{ date: '2026-01-01', amount: -100 }, { date: '2026-07-02', amount: 105 }])!;
    expect(r).toBeCloseTo(1.05 ** (365 / 182) - 1, 9);
  });

  it('matches the spreadsheet XIRR example', () => {
    // 스프레드시트 XIRR 문서의 예: 0.373362535
    const r = xirr([
      { date: '2008-01-01', amount: -10000 },
      { date: '2008-03-01', amount: 2750 },
      { date: '2008-10-30', amount: 4250 },
      { date: '2009-02-15', amount: 3250 },
      { date: '2009-04-01', amount: 2750 },
    ]);
    expect(r).toBeCloseTo(0.373362535, 6);
  });

  it('handles losses close to -100%', () => {
    const r = xirr([{ date: '2025-01-01', amount: -100 }, { date: '2026-01-01', amount: 1 }])!;
    expect(r).toBeCloseTo(-0.99, 6);
  });

  it('handles a big gain over a few days (bisection fallback)', () => {
    const r = xirr([{ date: '2026-01-01', amount: -100 }, { date: '2026-01-11', amount: 120 }])!;
    expect(r).toBeCloseTo(1.2 ** (365 / 10) - 1, 3);
  });

  it('sums flows on the same date and works with several buys', () => {
    const r = xirr([
      { date: '2025-01-01', amount: -50 },
      { date: '2025-01-01', amount: -50 },
      { date: '2026-01-01', amount: 110 },
    ]);
    expect(r).toBeCloseTo(0.1, 9);
  });

  it('is null without a sign change, with a single date, or with no flows', () => {
    expect(xirr([{ date: '2025-01-01', amount: -100 }, { date: '2026-01-01', amount: -1 }])).toBeNull();
    expect(xirr([{ date: '2025-01-01', amount: -100 }, { date: '2025-01-01', amount: 120 }])).toBeNull();
    expect(xirr([])).toBeNull();
  });

  it('is zero when you get back exactly what you put in', () => {
    expect(xirr([{ date: '2025-01-01', amount: -100 }, { date: '2025-06-01', amount: 100 }])).toBeCloseTo(0, 9);
  });
});

describe('periodReturn and daysBetween', () => {
  it('turns an annual rate back into the period return', () => {
    expect(daysBetween('2025-01-01', '2025-07-02')).toBe(182);
    expect(periodReturn(0.1, 365)).toBeCloseTo(0.1, 12);
    expect(periodReturn(1.05 ** (365 / 182) - 1, 182)).toBeCloseTo(0.05, 12);
  });
});
