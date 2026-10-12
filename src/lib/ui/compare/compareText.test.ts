import { describe, expect, it } from 'vitest';
import { kstEpoch } from '../../time/kst';
import { INDEX_BASE_MISSING_NOTE, formatMetricValue, freshnessText, headlineLabel, indexStaleNote, prevDayBadge, staleBadge } from './compareText';

const TODAY = '2026-10-12';
const at = (d: string, hhmm: string, ss = '00') => kstEpoch(d, `${hhmm}:${ss}`);

describe('headlineLabel', () => {
  const base = { metricLabel: '등락률', scrubT: null, today: TODAY, baseDate: null };

  it('1 day, today: 오늘 · 등락률 · 기준 전일 종가', () => {
    expect(headlineLabel({ ...base, period: { unit: 'D', n: 1 }, tradingDate: TODAY })).toBe('오늘 · 등락률 · 기준 전일 종가');
  });

  it('1 day on a closed day shows the last trading day with weekday', () => {
    expect(headlineLabel({ ...base, period: { unit: 'D', n: 1 }, tradingDate: '2026-10-08' })).toBe('10/8(목) · 등락률');
  });

  it('1 day while scrubbing: HH:MM · metric', () => {
    expect(
      headlineLabel({ ...base, period: { unit: 'D', n: 1 }, tradingDate: TODAY, scrubT: at(TODAY, '14:32') }),
    ).toBe('14:32 · 등락률');
  });

  it('daily periods: n주/개월/년 · metric · 기준 M/D 종가', () => {
    const p = { ...base, tradingDate: TODAY, baseDate: '2026-09-23' };
    expect(headlineLabel({ ...p, period: { unit: 'W', n: 2 } })).toBe('2주 · 등락률 · 기준 9/23 종가');
    expect(headlineLabel({ ...p, period: { unit: 'M', n: 3 } })).toBe('3개월 · 등락률 · 기준 9/23 종가');
    expect(headlineLabel({ ...p, period: { unit: 'Y', n: 1 } })).toBe('1년 · 등락률 · 기준 9/23 종가');
    expect(headlineLabel({ ...p, baseDate: null, period: { unit: 'Y', n: 1 } })).toBe('1년 · 등락률');
  });

  it('daily periods while scrubbing: M/D · metric', () => {
    expect(
      headlineLabel({ ...base, period: { unit: 'W', n: 2 }, tradingDate: TODAY, scrubT: at('2026-10-06', '00:00') }),
    ).toBe('10/6 · 등락률');
  });
});

describe('freshnessText', () => {
  const close = at(TODAY, '20:00');
  it('in session: ● 실시간 HH:MM:SS', () => {
    expect(
      freshnessText({ now: at(TODAY, '17:42', '05'), inSession: true, tradingDate: TODAY, today: TODAY, closeAt: close, anyStale: false }),
    ).toEqual({ live: true, text: '실시간 17:42:05' });
  });

  it('after the close today: ◌ HH:MM 기준 (장 마감)', () => {
    expect(
      freshnessText({ now: at(TODAY, '21:10'), inSession: false, tradingDate: TODAY, today: TODAY, closeAt: close, anyStale: false }),
    ).toEqual({ live: false, text: '20:00 기준 (장 마감)' });
  });

  it('past trading day: ◌ M/D HH:MM 기준', () => {
    expect(
      freshnessText({
        now: at(TODAY, '07:00'),
        inSession: false,
        tradingDate: '2026-10-08',
        today: TODAY,
        closeAt: at('2026-10-08', '20:00'),
        anyStale: false,
      }),
    ).toEqual({ live: false, text: '10/8 20:00 기준' });
  });

  it('any stale row appends 일부 종목은 이전 데이터예요', () => {
    expect(
      freshnessText({ now: at(TODAY, '17:42', '05'), inSession: true, tradingDate: TODAY, today: TODAY, closeAt: close, anyStale: true })
        .text,
    ).toBe('실시간 17:42:05 · 일부 종목은 이전 데이터예요');
  });
});

describe('staleBadge', () => {
  it('same KST day: HH:MM 기준 with a spoken label', () => {
    expect(staleBadge(at(TODAY, '17:20'), at(TODAY, '17:42'))).toEqual({
      text: '17:20 기준',
      label: '17시 20분 기준 데이터, 새로 받지 못했어요',
    });
  });

  it('another day: M/D 기준', () => {
    expect(staleBadge(at('2026-10-08', '17:20'), at(TODAY, '09:00'))).toEqual({
      text: '10/8 기준',
      label: '10월 8일 기준 데이터, 새로 받지 못했어요',
    });
  });
});

describe('formatMetricValue', () => {
  it('formats by unit', () => {
    expect(formatMetricValue(1.234, '%')).toBe('▲ +1.23%');
    expect(formatMetricValue(-0.5, '%')).toBe('▼ -0.50%');
    expect(formatMetricValue(1.5, 'x')).toBe('1.50x');
    expect(formatMetricValue(426.31, '조')).toBe('426.3조');
  });
});

describe('prevDayBadge', () => {
  it('names the previous trading day the row still shows', () => {
    expect(prevDayBadge('2026-10-08')).toEqual({
      text: '10/8 거래일 값',
      label: '10월 8일 거래일 값이에요, 이번 거래일 데이터를 새로 받지 못했어요',
    });
  });
});

describe('indexStaleNote', () => {
  it('same KST day: 지수는 HH:MM 기준이에요; another day adds M/D', () => {
    expect(indexStaleNote(at(TODAY, '10:00'), at(TODAY, '10:01'))).toBe('지수는 10:00 기준이에요');
    expect(indexStaleNote(at('2026-10-08', '15:30'), at(TODAY, '09:00'))).toBe('지수는 10/8 15:30 기준이에요');
  });
});

describe('INDEX_BASE_MISSING_NOTE', () => {
  it('says why excess is empty when the index has no close on the base date', () => {
    expect(INDEX_BASE_MISSING_NOTE).toBe('지수 기준일 값이 없어 초과수익을 계산할 수 없어요');
  });
});
