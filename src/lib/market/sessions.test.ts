import { describe, expect, it } from 'vitest';
import { kstEpoch } from '../time/kst';
import { SCHEDULES } from './sessions.config';
import { scheduleFor, sessionsForDay } from './sessions';

describe('sessionsForDay', () => {
  it('weekend and holidays have no sessions', () => {
    expect(sessionsForDay({ date: '2026-10-11', isOpen: false })).toEqual([]);
  });

  it('regular day yields 8 sessions in KST epoch', () => {
    const s = sessionsForDay({ date: '2026-10-08', isOpen: true });
    expect(s).toHaveLength(8);
    expect(s.find((x) => x.venue === 'KRX' && x.label === 'after')!.start).toBe(
      kstEpoch('2026-10-08', '16:00:00'),
    );
  });

  it('keeps seconds of NXT regular start and the ETF/ETN exclusion', () => {
    const s = sessionsForDay({ date: '2026-10-08', isOpen: true });
    expect(s.find((x) => x.venue === 'NXT' && x.label === 'regular')!.start).toBe(
      kstEpoch('2026-10-08', '09:00:30'),
    );
    expect(s.find((x) => x.venue === 'KRX' && x.label === 'after')!.excludes).toEqual(['ETF', 'ETN']);
  });

  it('calendar shift (exam day: regular starts 10:00) shifts every session by +60m', () => {
    const day = {
      date: '2026-11-19',
      isOpen: true,
      integrated: { regularStart: kstEpoch('2026-11-19', '10:00:00') },
    };
    const s = sessionsForDay(day);
    expect(s.find((x) => x.venue === 'NXT' && x.label === 'pre')!.start).toBe(
      kstEpoch('2026-11-19', '09:00:00'),
    );
    expect(s.find((x) => x.venue === 'KRX' && x.label === 'regular')!.end).toBe(
      kstEpoch('2026-11-19', '16:20:00'),
    );
    expect(Math.max(...s.map((x) => x.end))).toBe(kstEpoch('2026-11-19', '21:00:00'));
  });

  it('calendar afterEnd clips after sessions', () => {
    const day = {
      date: '2026-12-30',
      isOpen: true,
      integrated: { afterEnd: kstEpoch('2026-12-30', '18:00:00') },
    };
    expect(Math.max(...sessionsForDay(day).map((x) => x.end))).toBe(kstEpoch('2026-12-30', '18:00:00'));
  });

  it('afterEnd drops sessions starting at/after it and keeps earlier ones intact', () => {
    const day = {
      date: '2026-12-30',
      isOpen: true,
      integrated: { afterEnd: kstEpoch('2026-12-30', '15:40:00') },
    };
    const s = sessionsForDay(day);
    // KRX after (16:00) and NXT after (15:40, start == afterEnd) are dropped.
    expect(s.some((x) => x.label === 'after')).toBe(false);
    expect(s).toHaveLength(6);
    expect(s.find((x) => x.venue === 'NXT' && x.label === 'after-auction')!.end).toBe(
      kstEpoch('2026-12-30', '15:40:00'),
    );
  });

  it('shift and afterEnd combine: shift first, then clip', () => {
    const day = {
      date: '2026-11-19',
      isOpen: true,
      integrated: {
        regularStart: kstEpoch('2026-11-19', '10:00:00'),
        afterEnd: kstEpoch('2026-11-19', '19:00:00'),
      },
    };
    const s = sessionsForDay(day);
    expect(s.find((x) => x.venue === 'KRX' && x.label === 'after')!.start).toBe(
      kstEpoch('2026-11-19', '17:00:00'),
    );
    expect(Math.max(...s.map((x) => x.end))).toBe(kstEpoch('2026-11-19', '19:00:00'));
  });
});

describe('scheduleFor', () => {
  it('picks latest effectiveFrom <= date', () => {
    expect(scheduleFor('2026-10-08').effectiveFrom).toBe('2026-09-14');
    expect(scheduleFor('2026-09-14').effectiveFrom).toBe('2026-09-14');
  });

  it('throws when no schedule is in effect yet', () => {
    expect(() => scheduleFor('2026-09-13')).toThrow();
  });

  it('SCHEDULES holds the 2026-09-14 schedule', () => {
    expect(SCHEDULES.map((x) => x.effectiveFrom)).toEqual(['2026-09-14']);
  });
});
