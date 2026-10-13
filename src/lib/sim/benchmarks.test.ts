import { describe, expect, it } from 'vitest';
import { holdCurve, indexCurve, singleCurve } from './benchmarks';
import { bar, tradingDates } from './testBars';

const DAYS = tradingDates('2026-01-05', 4);
const stock = (symbol: string, bars: ReturnType<typeof bar>[]) => ({
  symbol,
  name: symbol,
  market: 'KOSPI' as const,
  isEtf: false,
  candles: bars,
});

describe('holdCurve', () => {
  it('2종목 균등 보유', () => {
    const a = stock('A', DAYS.map((d, i) => bar(d, i === 0 ? 100 : 110, 110, 100, i === 3 ? 110 : 105)));
    const b = stock('B', DAYS.map((d, i) => bar(d, i === 0 ? 200 : 180, 200, 180, i === 3 ? 180 : 190)));
    const c = holdCurve(DAYS, [a, b], 10_000_000, 0);
    expect(c).toHaveLength(4);
    expect(c[3]).toBeCloseTo(10_000_000 * (0.5 * 1.1 + 0.5 * 0.9), 0);
  });

  it('첫날 값 = 50,000주 × A 종가 + 25,000주 × B 종가 + 남은 현금', () => {
    // 초기 10,000,100 → 몫 5,000,050: A 시가 100 → 50,000주(남 50), B 시가 200 → 25,000주(남 50)
    const a = stock('A', DAYS.map((d) => bar(d, 100, 110, 95, 102)));
    const b = stock('B', DAYS.map((d) => bar(d, 200, 210, 185, 190)));
    const c = holdCurve(DAYS, [a, b], 10_000_100, 0);
    expect(c[0]).toBe(50_000 * 102 + 25_000 * 190 + 100);
  });

  it('기간 중 상장 종목은 첫 봉 전까지 현금, 첫 봉 시가에 매수', () => {
    const a = stock('A', DAYS.map((d) => bar(d, 100, 100, 100, 100)));
    const b = stock('B', [bar(DAYS[2], 50, 50, 50, 50), bar(DAYS[3], 50, 50, 50, 100)]);
    const c = holdCurve(DAYS, [a, b], 1_000_000, 0);
    expect(c[0]).toBe(1_000_000);
    expect(c[1]).toBe(1_000_000);
    expect(c[3]).toBe(1_500_000);
  });

  it('수수료와 floor 잔액', () => {
    const a = stock('A', DAYS.map((d) => bar(d, 300, 300, 300, 300)));
    const c = holdCurve(DAYS, [a], 1000, 0);
    expect(c[0]).toBe(1000); // 3주 + 현금 100
    const f = holdCurve(DAYS, [a], 1000, 10); // 300*1.1=330 → 3주, 비용 990
    expect(f[0]).toBeCloseTo(1000 - 90, 6);
  });

  it('봉이 없는 날은 직전 종가, 기간 내 봉이 없는 종목은 계속 현금', () => {
    const a = stock('A', [bar(DAYS[0], 100, 100, 100, 100), bar(DAYS[1], 100, 100, 100, 120), bar(DAYS[3], 120, 120, 120, 130)]);
    const z = stock('Z', []);
    const c = holdCurve(DAYS, [a, z], 2000, 0);
    expect(c[2]).toBe(1000 + 1000 * 1.2);
    expect(c[3]).toBe(1000 + 1000 * 1.3);
  });
});

describe('indexCurve', () => {
  it('시가 대비 종가 비례', () => {
    const k = [bar(DAYS[0], 2500, 2500, 2500, 2600), bar(DAYS[1], 1, 1, 1, 2650), bar(DAYS[2], 1, 1, 1, 2700), bar(DAYS[3], 1, 1, 1, 2750)];
    const c = indexCurve(DAYS, k, 10_000_000)!;
    expect(c[3]).toBeCloseTo(11_000_000, 0);
  });
  it('첫날 또는 마지막 날 봉이 없으면 null', () => {
    expect(indexCurve(DAYS, [bar(DAYS[1], 1, 1, 1, 1), bar(DAYS[3], 1, 1, 1, 1)], 100)).toBeNull();
    expect(indexCurve(DAYS, [bar(DAYS[0], 1, 1, 1, 1), bar(DAYS[2], 1, 1, 1, 1)], 100)).toBeNull();
  });
  it('중간에 빠진 날은 직전 값', () => {
    const k = [bar(DAYS[0], 100, 100, 100, 100), bar(DAYS[1], 100, 100, 100, 110), bar(DAYS[3], 100, 100, 100, 120)];
    const c = indexCurve(DAYS, k, 1000)!;
    expect(c[2]).toBeCloseTo(c[1], 6);
    expect(c[3]).toBeCloseTo(1200, 6);
  });
});

describe('singleCurve', () => {
  it('전액 매수, 첫 봉이 늦으면 그때까지 현금', () => {
    const k = [bar(DAYS[2], 100, 100, 100, 100), bar(DAYS[3], 100, 100, 100, 150)];
    const c = singleCurve(DAYS, k, 1000, 0);
    expect(c.slice(0, 2)).toEqual([1000, 1000]);
    expect(c[3]).toBe(1500);
  });
});
