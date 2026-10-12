import { describe, expect, it } from 'vitest';
import { sellTaxPct } from './tax';

describe('sellTaxPct', () => {
  it('날짜 경계별 세율', () => {
    expect(sellTaxPct('2026-03-02', 'KOSPI', false)).toBe(0.2);
    expect(sellTaxPct('2025-12-31', 'KOSDAQ', false)).toBe(0.15);
    expect(sellTaxPct('2021-01-01', 'KOSPI', false)).toBe(0.23);
    expect(sellTaxPct('2019-06-02', 'KOSPI', false)).toBe(0.3);
    expect(sellTaxPct('2019-06-03', 'KOSPI', false)).toBe(0.25);
    expect(sellTaxPct('2020-12-31', 'KOSDAQ', false)).toBe(0.25);
    expect(sellTaxPct('2022-12-31', 'KOSPI', false)).toBe(0.23);
    expect(sellTaxPct('2023-01-01', 'KOSPI', false)).toBe(0.2);
    expect(sellTaxPct('2024-01-01', 'KOSDAQ', false)).toBe(0.18);
    expect(sellTaxPct('2025-01-01', 'KOSPI', false)).toBe(0.15);
    expect(sellTaxPct('2026-01-01', 'KOSDAQ', false)).toBe(0.2);
  });
  it('ETF와 KR_ETC는 0', () => {
    expect(sellTaxPct('2026-03-02', 'KOSPI', true)).toBe(0);
    expect(sellTaxPct('2026-03-02', 'KR_ETC', false)).toBe(0);
  });
});
