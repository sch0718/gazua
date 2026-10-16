import { describe, expect, it } from 'vitest';
import { holdSelection } from './holdSelection';
import type { Selection } from './select';
import { DATES, mkFile, mkStock } from './testData';

const sel = (i: number, ...symbols: string[]): Selection => ({ date: DATES[i], passed: symbols.length, picked: symbols.map((symbol) => ({ symbol, values: {} })) });
const run = (stocks: ReturnType<typeof mkStock>[], selections: Selection[], capital: number, feePct: number, end: number, n = 10) =>
  holdSelection({ axis: DATES.slice(0, n), selections, data: mkFile(stocks, n), capital, feePct, periodEnd: DATES[end] });

// 손계산: 자본 1,000,000 · 수수료 0.1% · 2025년 KOSPI 매도세 0.15%(결제일 T+2 기준)
const A = [100, 100, 100, 110, 110, 110, 120, 120, 120, 130];
const B = [200, 200, 200, 190, 190, 190, 190, 190, 190, 190];

describe('holdSelection', () => {
  it('재선정 3회 손계산과 자산 값이 같다', () => {
    const r = run([mkStock('A', A), mkStock('B', B)], [sel(0, 'A', 'B'), sel(3, 'A'), sel(6)], 1_000_000, 0.1, 9);
    // 0일: A 4995주(499,999.5) B 2497주(499,899.4) 현금 101.1 → 종가 평가 999,001.1
    // 3일: 총 1,023,981.1, B 전량 매도(수수료 474.43 세금 711.645) → 현금 473,345.025, A는 차이 4298주만 매수(473,252.78) → 현금 92.245
    // 6일: A 9293주 전량 매도 1,115,160 − 1,115.16 − 1,672.74 → 현금 1,112,464.345
    const v = [999_001.1, 999_001.1, 999_001.1, 1_022_322.245, 1_022_322.245, 1_022_322.245, ...Array(4).fill(1_112_464.345)];
    expect(r.equity.map((e) => e.value)).toEqual(v);
    expect(r.equity.map((e) => e.date)).toEqual(DATES.slice(0, 10));
  });

  it('구간 정보: 선정 종목별 수익률, 통과 0개 구간은 비어 있다', () => {
    const r = run([mkStock('A', A), mkStock('B', B)], [sel(0, 'A', 'B'), sel(3, 'A'), sel(6)], 1_000_000, 0.1, 9);
    expect(r.segments.map((s) => [s.from, s.to])).toEqual([[DATES[0], DATES[3]], [DATES[3], DATES[6]], [DATES[6], DATES[9]]]);
    expect(r.segments[0].picked).toEqual([
      { symbol: 'A', retPct: expect.closeTo(10, 9), soldAtLastClose: false, notBought: false },
      { symbol: 'B', retPct: expect.closeTo(-5, 9), soldAtLastClose: false, notBought: false },
    ]);
    expect(r.segments[1].picked[0].retPct).toBeCloseTo((120 / 110 - 1) * 100, 9);
    expect(r.segments[2].picked).toEqual([]);
  });

  it('다시 뽑힌 종목은 차이만 거래하고 수수료는 그 차이에만 붙는다', () => {
    // 수수료 0.1%, 매도세는 2025년 0.15%. 0일 A 9990주(1,000,000/100.1).
    const r = run([mkStock('A', A)], [sel(0, 'A'), sel(3, 'A')], 1_000_000, 0.1, 6, 7);
    // 0일: 9990주, 비용 9990*100*1.001=999,999 → 현금 1. 종가 999,001+1=999,001
    // 3일: 총 1+9990*110=1,098,901 → 목표 9980주(9980*110*1.001=1,098,897.8). 10주만 매도: 1,100 − 1.1 − 1.65 = 1,097.25
    // 현금 1,098.25, 보유 9980주 → 종가 1,097,800+1,098.25 = 1,098,898.25
    expect(r.equity[0].value).toBe(999_001);
    expect(r.equity[3].value).toBe(1_098_898.25);
  });

  it('재선정일에 봉이 없는 선정 종목은 사지 않고 그 몫은 현금이며, 나머지 수량은 늘지 않는다', () => {
    const C = [50, 50, 50, null, null, null, null, null];
    const r = run([mkStock('A', A.slice(0, 8)), mkStock('C', C)], [sel(0, 'A'), sel(3, 'A', 'C')], 1_000_000, 0, 6, 8);
    // 0일: A 10,000주. 3일: 총 1,100,000 → 목표 550,000 → A 5,000주만 보유, 5,000주 매도(1,100,000/2): 550,000 − 세금 825 → 현금 549,175
    expect(r.equity[3].value).toBe(1_099_175);
    expect(r.equity[6].value).toBe(1_149_175);
    expect(r.segments[1].picked).toEqual([
      { symbol: 'A', retPct: expect.closeTo((120 / 110 - 1) * 100, 9), soldAtLastClose: false, notBought: false },
      { symbol: 'C', retPct: null, soldAtLastClose: false, notBought: true },
    ]);
  });

  it('구간 중 봉이 끊기면 직전 종가로 평가한다', () => {
    const D = [10, 10, 10, null, null, 12, 12, 12, 12, 12];
    const r = run([mkStock('D', D)], [sel(0, 'D')], 1000, 0, 9);
    expect(r.equity.map((e) => e.value)).toEqual([1000, 1000, 1000, 1000, 1000, 1200, 1200, 1200, 1200, 1200]);
  });

  it('다음 재선정일에 봉이 없으면 마지막 종가로 판 것으로 계산하고 표시한다', () => {
    const E = [10, 10, 10, null, null, null, null, null, null, null];
    const r = run([mkStock('E', E)], [sel(0, 'E'), sel(3)], 1000, 0, 5, 6);
    // 100주 × 10 = 1,000, 세금 0.15% = 1.5 → 현금 998.5
    expect(r.equity[3].value).toBe(998.5);
    expect(r.segments[0].picked).toEqual([{ symbol: 'E', retPct: 0, soldAtLastClose: true, notBought: false }]);
  });

  it('통과 0개 구간만 있으면 현금 그대로다', () => {
    const r = run([mkStock('A', A)], [sel(0)], 1_000_000, 0.1, 5, 6);
    expect(r.equity.every((e) => e.value === 1_000_000)).toBe(true);
    expect(r.segments).toEqual([{ from: DATES[0], to: DATES[5], picked: [] }]);
  });

  it('마지막 구간은 기간 끝 종가로 평가하고 팔지 않는다', () => {
    const r = run([mkStock('A', A)], [sel(0, 'A')], 1_000_000, 0, 9);
    expect(r.equity[9].value).toBe(1_000_000 * 1.3);
    expect(r.segments[0].picked[0].retPct).toBeCloseTo(30, 9);
  });

  it('배정 금액으로 1주도 못 사면 사지 않고 notBought로 표시한다', () => {
    const r = run([mkStock('B', Array(10).fill(999))], [sel(0, 'B')], 500, 0, 5, 6);
    expect(r.equity.every((e) => e.value === 500)).toBe(true);
    expect(r.segments[0].picked).toEqual([{ symbol: 'B', retPct: null, soldAtLastClose: false, notBought: true }]);
  });

  it('다시 뽑혔어도 재선정일에 봉이 없으면 마지막 종가로 팔고 notBought다', () => {
    const X = [10, 10, 10, null, null, null, null, null];
    const r = run([mkStock('X', X)], [sel(0, 'X'), sel(3, 'X')], 1000, 0, 6, 8);
    expect(r.equity[3].value).toBe(998.5); // 1,000 − 세금 1.5
    expect(r.segments[0].picked).toEqual([{ symbol: 'X', retPct: 0, soldAtLastClose: true, notBought: false }]);
    expect(r.segments[1].picked).toEqual([{ symbol: 'X', retPct: null, soldAtLastClose: false, notBought: true }]);
  });

  it('마지막 종가 매도의 세율은 재선정일의 결제일 기준이다(연도가 다를 때)', () => {
    const axis = ['2024-12-26', '2024-12-27', '2024-12-30', '2025-01-02', '2025-01-03', '2025-01-06'];
    const x = mkStock('X', [10]);
    x.d = ['20241226'];
    const data = { ...mkFile([x], 6), range: { from: axis[0], to: axis[5] } };
    const mk = (d: string, ...symbols: string[]): Selection => ({ date: d, passed: symbols.length, picked: symbols.map((symbol) => ({ symbol, values: {} })) });
    const r = holdSelection({ axis, selections: [mk(axis[0], 'X'), mk(axis[3])], data, capital: 1000, feePct: 0, periodEnd: axis[5] });
    // 결제일 2025-01-06 → 0.15%(2024년 0.18%였다면 998.2)
    expect(r.equity[3].value).toBe(998.5);
  });

  it('매도 비용으로 현금이 모자라 살 수 있는 주수가 0이 되면 notBought다', () => {
    const r = run([mkStock('A', Array(10).fill(10)), mkStock('B', Array(10).fill(999))], [sel(0, 'A'), sel(3, 'B')], 1000, 0, 5, 6);
    // 3일: A 100주 전량 매도 1,000 − 1.5 = 998.5 < B 1주 999 → 0주
    expect(r.equity[3].value).toBe(998.5);
    expect(r.segments[1].picked).toEqual([{ symbol: 'B', retPct: null, soldAtLastClose: false, notBought: true }]);
  });
});
