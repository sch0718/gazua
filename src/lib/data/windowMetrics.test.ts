import { describe, expect, it } from 'vitest';
import { kstEpoch } from '../time/kst';
import type { LoadedSeries } from './candleService';
import type { Candle } from './metrics';
import { volumePace, windowApplies, windowPoints, windowStart } from './windowMetrics';

const DAY = '2026-10-12';
const at = (hhmm: string) => kstEpoch(DAY, `${hhmm}:00`);
const bar = (t: number, c: number, v = 100): Candle => ({ t, o: c, h: c, l: c, c, v });

function series(candles: Candle[], over: Partial<LoadedSeries> = {}): LoadedSeries {
  return {
    symbol: '005930',
    tradingDate: DAY,
    base: 100,
    baseDate: '2026-10-08',
    avgDailyVolume: 1000,
    avgVolumeVenue: 'KRX',
    candles,
    daily: [],
    segments: [],
    intervals: [],
    computedAt: at('10:00'),
    ...over,
  };
}
const values = (ps: { v: number | null }[]) => ps.map((p) => (p.v === null ? null : Math.round(p.v * 1000) / 1000));

describe('windowPoints', () => {
  const s = series([bar(at('09:00'), 110), bar(at('09:10'), 100), bar(at('09:20'), 120)]);

  it('change: 구간 시작 이하 마지막 봉을 0으로 맞추고 그 앞 봉은 비운다', () => {
    expect(values(windowPoints(s, 'change', at('09:15')))).toEqual([null, 0, 20]);
  });

  it('change: 시작까지 봉이 없으면 전일 종가를 기준으로 쓴다', () => {
    expect(values(windowPoints(s, 'change', at('08:50')))).toEqual([10, 0, 20]);
  });

  it('excess: 같은 구간의 지수 변화를 뺀다', () => {
    const index = series([bar(at('09:00'), 1000), bar(at('09:10'), 1000), bar(at('09:20'), 1050)]);
    expect(values(windowPoints(s, 'excess', at('09:10'), { index }))).toEqual([null, 0, 15]);
  });

  it('excess: 지수가 없거나 지수 마지막 봉 뒤면 비운다', () => {
    expect(values(windowPoints(s, 'excess', at('09:10')))).toEqual([null, null, null]);
    const index = series([bar(at('09:00'), 1000), bar(at('09:10'), 1000)]);
    expect(values(windowPoints(s, 'excess', at('09:10'), { index, indexUntil: at('09:10') }))).toEqual([null, 0, null]);
  });
});

describe('volumePace', () => {
  // 09:00~09:59 매 분 100, 마지막 10분(09:50 초과~09:59)만 400
  const candles = Array.from({ length: 60 }, (_, i) => bar(at('09:00') + i * 60_000, 100, i >= 51 ? 400 : 100));

  it('구간 분당 거래량을 오늘 분당 거래량으로 나눈다', () => {
    const end = at('09:59');
    const pace = volumePace(candles, windowStart(end, 9), end);
    // 구간 9분 × 400 / 9 = 400, 오늘 (51×100 + 9×400) / 60 = 145
    expect(pace).toBeCloseTo(400 / 145, 3);
  });

  it('오늘 지난 시간이 구간의 두 배보다 짧으면 null', () => {
    expect(volumePace(candles, windowStart(at('09:20'), 15), at('09:20'))).toBeNull();
  });
});

describe('windowApplies', () => {
  it('1일의 등락률·초과수익에서만 쓴다', () => {
    expect(windowApplies({ unit: 'D', n: 1 }, 'excess')).toBe(true);
    expect(windowApplies({ unit: 'D', n: 1 }, 'rvol')).toBe(false);
    expect(windowApplies({ unit: 'W', n: 1 }, 'change')).toBe(false);
  });
});
