import { describe, expect, it } from 'vitest';
import { addDays, kstDate, kstEpoch, kstMinuteOfDay, kstWeekday } from './kst';

describe('kst', () => {
  it('kstDate converts UTC instant to KST calendar date', () => {
    expect(kstDate(Date.UTC(2026, 9, 10, 15, 30))).toBe('2026-10-11'); // 00:30 KST
  });
  it('kstEpoch is independent of device TZ', () => {
    expect(kstEpoch('2026-10-08', '09:00:00')).toBe(Date.UTC(2026, 9, 8, 0, 0));
  });
  it('kstMinuteOfDay', () => {
    expect(kstMinuteOfDay(kstEpoch('2026-10-08', '15:30:00'))).toBe(930);
  });
  it('kstWeekday', () => {
    expect(kstWeekday('2026-10-11')).toBe(0);
  });
  it('addDays crosses month', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
  });
});
