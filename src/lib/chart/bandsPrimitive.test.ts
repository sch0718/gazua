import { describe, expect, it } from 'vitest';
import { sessionsForDay } from '../market/sessions';
import { kstEpoch } from '../time/kst';
import { sessionBands, type BandSpan } from './bandsPrimitive';

const DAY = '2026-10-08';
const sessions = sessionsForDay({ date: DAY, isOpen: true });
const hm = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(11, 16);
const spans = (xs: BandSpan[]) => xs.map((s) => `${hm(s.start)}-${hm(s.end)}`);

describe('sessionBands', () => {
  it('shades pre and after, hatches the auctions, and labels each phase (AUTO/KRX/NXT)', () => {
    const b = sessionBands(sessions, false);
    expect(spans(b.shades)).toEqual(['08:00-08:50', '15:30-20:00']);
    expect(spans(b.auctions)).toEqual(['08:50-09:00', '15:20-15:40']);
    expect(b.labels.map((l) => `${hm(l.start)}-${hm(l.end)} ${l.texts[0]}`)).toEqual([
      '08:00-08:50 NXT 프리',
      '08:50-15:30 KRX 정규',
      '15:30-16:00 NXT',
      '16:00-20:00 KRX 애프터',
    ]);
  });

  it('uses 프리 · 정규 · 애프터 labels for the unified mode', () => {
    const b = sessionBands(sessions, true);
    expect(b.labels.map((l) => `${hm(l.start)}-${hm(l.end)} ${l.texts.join('/')}`)).toEqual([
      '08:00-08:50 프리',
      '08:50-15:30 정규',
      '15:30-20:00 애프터',
    ]);
  });

  it('returns nothing on a closed day', () => {
    expect(sessionBands([], false)).toEqual({ shades: [], auctions: [], labels: [] });
  });

  it('keeps day boundaries in epoch ms', () => {
    const b = sessionBands(sessions, false);
    expect(b.shades[0].start).toBe(kstEpoch(DAY, '08:00:00'));
  });
});
