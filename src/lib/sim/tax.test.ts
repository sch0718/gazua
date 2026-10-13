import { describe, expect, it } from 'vitest';
import { simulateCore } from './simulate';
import { newStrategy } from './defaults';
import { bar, tradingDates } from './testBars';
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
  it('축 끝을 넘으면 KRX 연말·연초 휴장일(12-31, 01-01)도 건너뛴다', () => {
    // 축 마지막 날 2025-12-29(월) 체결 → 12-30(1) · 12-31 휴장 · 01-01 휴장 · 01-02(2)
    const settle = settlementDate('2025-12-29', ['2025-12-26', '2025-12-29']);
    expect(settle).toBe('2026-01-02');
    expect(sellTaxPct(settle, 'KOSPI', false)).toBe(0.2);
  });
  it('축 밖 체결일이 연초 휴장일이면 다음 평일부터 센다', () => {
    // 2026-01-01(목) 휴장 → 01-02(금) 기준 +2 = 01-06(화)
    expect(settlementDate('2026-01-01', ['2025-12-29', '2025-12-30'])).toBe('2026-01-06');
  });
  it('체결일이 축에 없으면 그 이후 첫 거래일부터 센다', () => {
    expect(settlementDate('2025-12-27', ['2025-12-26', '2025-12-29', '2025-12-30', '2026-01-02'])).toBe('2026-01-02');
  });
  it('12-31이 일요일인 해(2023): 연말 휴장일은 12-29(금)이라 12-27 체결의 결제일은 2024-01-02', () => {
    expect(settlementDate('2023-12-27', ['2023-12-26', '2023-12-27', '2023-12-28'])).toBe('2024-01-02');
  });
  it('12-31이 토요일인 해(2022): 연말 휴장일은 12-30(금)', () => {
    // 12-28 체결, 축 끝 → 12-29(1) · 12-30 휴장 · 01-02(2)
    expect(settlementDate('2022-12-28', ['2022-12-27', '2022-12-28'])).toBe('2023-01-02');
  });
  it('12-31이 평일인 해(2025)는 그대로 12-31이 휴장', () => {
    expect(settlementDate('2025-12-29', ['2025-12-26', '2025-12-29'])).toBe('2026-01-02');
    expect(settlementDate('2025-12-30', ['2025-12-29', '2025-12-30'])).toBe('2026-01-05');
  });
});

describe('연말 휴장일이 주말인 해의 매도세', () => {
  it('2023: 축이 12-28에서 끝나도 12-27 매도(10주 × 90,000원)의 세금은 2024년 0.18% = 1,620원', () => {
    const days = tradingDates('2023-12-04', 19); // 12-04 ~ 12-28
    expect(days[18]).toBe('2023-12-28');
    const closes = [90, 100, 92, 95, 88, 80, 82, 84, 86].map((c) => c * 1000);
    const rest: [number, number, number, number][] = [
      ...Array.from({ length: 8 }, (): [number, number, number, number] => [100_000, 100_000, 100_000, 100_000]),
      [100_000, 100_000, 90_000, 90_000],
      [90_000, 90_000, 90_000, 90_000],
    ];
    const candles = [...closes.map((c, i) => bar(days[i], c, c, c, c)), ...rest.map(([o, h, l, c], i) => bar(days[9 + i], o, h, l, c))];
    const s = newStrategy(0, null);
    s.capital = { initial: 10_000_000, perBuyPct: 10 };
    s.costs.feePct = 0;
    s.entry.triggers.breakout.on = false;
    s.exit.stopLoss = { pct: 10, basis: 'avgAlways' };
    const core = simulateCore({
      strategy: s,
      days,
      stocks: [{ symbol: 'S0', name: 'S0', market: 'KOSPI', isEtf: false, candles }],
      index: null,
      benchmarkStock: null,
    });
    const sell = core.trades.find((t) => t.kind === 'stop')!;
    expect(sell).toMatchObject({ date: '2023-12-27', qty: 10 });
    expect(sell.price).toBeCloseTo(90_000, 6);
    expect(sell.tax).toBeCloseTo(1_620, 6);
  });
});
