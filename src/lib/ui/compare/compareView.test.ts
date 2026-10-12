import { describe, expect, it } from 'vitest';
import type { LoadedSeries } from '../../data/candleService';
import { sessionsForDay } from '../../market/sessions';
import { kstEpoch } from '../../time/kst';
import { chartTradingDate, indexLoadOf, staleIndexAt, lastSessionEnd, marketAutoVenue, openDaysOf, sessionsOn } from './compareView';

const DAY = '2026-10-12';
const at = (hhmm: string) => kstEpoch(DAY, `${hhmm}:00`);
const today = sessionsForDay({ date: DAY, isOpen: true, integrated: { regularStart: kstEpoch(DAY, '10:00:00') } });

describe('compareView', () => {
  it('marketAutoVenue follows KRX first', () => {
    const s = sessionsForDay({ date: DAY, isOpen: true });
    expect(marketAutoVenue(s, at('08:10'))).toBe('NXT');
    expect(marketAutoVenue(s, at('10:00'))).toBe('KRX');
    expect(marketAutoVenue(s, at('15:45'))).toBe('NXT');
    expect(marketAutoVenue(s, at('21:00'))).toBeNull();
  });

  it('sessionsOn uses today’s calendar sessions, the default timetable otherwise', () => {
    expect(sessionsOn(DAY, DAY, today)).toBe(today);
    expect(sessionsOn('2026-10-08', DAY, today)).toEqual(sessionsForDay({ date: '2026-10-08', isOpen: true }));
    expect(sessionsOn('1999-01-04', DAY, today)).toEqual([]);
  });

  it('lastSessionEnd', () => {
    expect(lastSessionEnd(sessionsForDay({ date: DAY, isOpen: true }))).toBe(at('20:00'));
    expect(lastSessionEnd([])).toBeNull();
  });

  it('openDaysOf is the sorted union of candle dates', () => {
    const s = (dates: string[]) => ({ candles: dates.map((d) => ({ t: kstEpoch(d, '00:00:00'), o: 1, h: 1, l: 1, c: 1, v: 1 })) }) as LoadedSeries;
    expect(openDaysOf([s(['2026-10-08', '2026-10-12']), s(['2026-10-07', '2026-10-08'])])).toEqual([
      '2026-10-07',
      '2026-10-08',
      '2026-10-12',
    ]);
  });

  it('chartTradingDate: intraday uses the latest trading date among loaded series; daily keeps the first', () => {
    const d = (tradingDate: string) => ({ tradingDate }) as LoadedSeries;
    expect(chartTradingDate([d('2026-10-08'), d('2026-10-12'), d('2026-10-08')], 'intraday')).toBe('2026-10-12');
    expect(chartTradingDate([d('2026-10-08'), d('2026-10-12')], 'daily')).toBe('2026-10-08');
    expect(chartTradingDate([], 'intraday')).toBeNull();
  });

  it('staleIndexAt: the oldest computedAt among stale index entries, else null', () => {
    const s = (computedAt: number) => ({ computedAt }) as LoadedSeries;
    expect(staleIndexAt([{ status: 'ok', series: s(5) }, undefined])).toBeNull();
    expect(
      staleIndexAt([
        { status: 'ok', series: s(9), stale: true },
        { status: 'loading', series: s(7), stale: true },
        { status: 'ok', series: s(3) },
      ]),
    ).toBe(7);
  });

  it('indexLoadOf: failed > null > ok', () => {
    expect(indexLoadOf([{ status: 'ok', series: null }, { status: 'failed', series: null }])).toBe('failed');
    expect(indexLoadOf([{ status: 'null', series: null }, undefined])).toBe('null');
    expect(indexLoadOf([{ status: 'loading', series: null }, undefined])).toBe('ok');
  });
});
