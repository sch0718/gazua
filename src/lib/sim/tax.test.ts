import { describe, expect, it } from 'vitest';
import { sellTaxPct, settlementDate } from './tax';

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
  it('연말 경계: 2023-12-31 KOSPI 0.2, 2024-12-31 KOSDAQ 0.18', () => {
    expect(sellTaxPct('2023-12-31', 'KOSPI', false)).toBe(0.2);
    expect(sellTaxPct('2024-12-31', 'KOSDAQ', false)).toBe(0.18);
  });
  it('ETF와 KR_ETC는 0', () => {
    expect(sellTaxPct('2026-03-02', 'KOSPI', true)).toBe(0);
    expect(sellTaxPct('2026-03-02', 'KR_ETC', false)).toBe(0);
  });
});

describe('settlementDate', () => {
  it('체결일 다음 2번째 거래일', () => {
    expect(settlementDate('2025-12-29', ['2025-12-26', '2025-12-29', '2025-12-30', '2026-01-02'])).toBe('2026-01-02');
  });
  it('축 끝을 넘으면 토·일을 건너뛴 평일 +2', () => {
    expect(settlementDate('2026-10-09', ['2026-10-08', '2026-10-09'])).toBe('2026-10-13');
  });
  it('축 끝에서 한 칸만 모자라면 남은 만큼만 평일로 더한다', () => {
    expect(settlementDate('2026-10-08', ['2026-10-08', '2026-10-09'])).toBe('2026-10-12');
  });
  it('체결일이 축에 없으면 그 이후 첫 거래일부터 센다', () => {
    expect(settlementDate('2025-12-27', ['2025-12-26', '2025-12-29', '2025-12-30', '2026-01-02'])).toBe('2026-01-02');
  });
});
