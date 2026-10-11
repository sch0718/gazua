import { describe, expect, it } from 'vitest';
import { kstEpoch } from '../time/kst';
import { sessionsForDay } from './sessions';
import { autoVenueAt, sessionLabelAt, tradableIntervals, type TradableMeta } from './tradable';

const DATE = '2026-10-08';
const s = sessionsForDay({ date: DATE, isOpen: true });
const at = (hms: string) => kstEpoch(DATE, hms);
const hm = (ms: number) =>
  new Date(ms + 9 * 3600_000).toISOString().slice(11, 16);

const nxtStock: TradableMeta = {
  securityType: 'STOCK',
  nxtSupported: true,
  krxSuspended: false,
  nxtSuspended: false,
};
const krxOnlyStock: TradableMeta = { ...nxtStock, nxtSupported: false, nxtSuspended: null };
const krxOnlyEtf: TradableMeta = { ...krxOnlyStock, securityType: 'ETF' };

describe('autoVenueAt (KRX first)', () => {
  it.each([
    ['07:59:59', null, null, null],
    ['08:00:00', 'NXT', null, null],
    ['08:49:59', 'NXT', null, null],
    ['08:50:00', null, null, null],
    ['09:00:00', 'KRX', 'KRX', 'KRX'],
    ['15:19:59', 'KRX', 'KRX', 'KRX'],
    ['15:20:00', null, null, null],
    ['15:30:00', null, null, null],
    ['15:40:00', 'NXT', null, null],
    ['16:00:00', 'KRX', 'KRX', null],
    ['19:59:59', 'KRX', 'KRX', null],
    ['20:00:00', null, null, null],
  ])('%s -> NXT stock %s / KRX-only stock %s / KRX-only ETF %s', (time, a, b, c) => {
    expect(autoVenueAt(s, nxtStock, at(time))).toBe(a);
    expect(autoVenueAt(s, krxOnlyStock, at(time))).toBe(b);
    expect(autoVenueAt(s, krxOnlyEtf, at(time))).toBe(c);
  });

  it('krxSuspended falls through to NXT during regular hours', () => {
    expect(autoVenueAt(s, { ...nxtStock, krxSuspended: true }, at('10:00:00'))).toBe('NXT');
  });

  it('nxtSuspended removes NXT but unknown (null) does not', () => {
    expect(autoVenueAt(s, { ...nxtStock, nxtSuspended: true }, at('08:30:00'))).toBeNull();
    expect(autoVenueAt(s, { ...nxtStock, nxtSuspended: null }, at('08:30:00'))).toBe('NXT');
  });

  it('ETF on NXT is excluded only where the session says so', () => {
    const nxtEtf: TradableMeta = { ...nxtStock, securityType: 'ETF' };
    expect(autoVenueAt(s, nxtEtf, at('08:30:00'))).toBe('NXT');
    expect(autoVenueAt(s, nxtEtf, at('17:00:00'))).toBe('NXT');
  });
});

describe('tradableIntervals', () => {
  it('AUTO intervals for NXT stock', () => {
    expect(
      tradableIntervals(s, nxtStock, 'AUTO').map((i) => [hm(i.start), hm(i.end), i.venue, i.kind]),
    ).toEqual([
      ['08:00', '08:50', 'NXT', 'continuous'],
      ['08:50', '09:00', 'KRX', 'auction'],
      ['09:00', '15:20', 'KRX', 'continuous'],
      ['15:20', '15:30', 'KRX', 'auction'],
      ['15:30', '15:40', 'NXT', 'auction'],
      ['15:40', '16:00', 'NXT', 'continuous'],
      ['16:00', '20:00', 'KRX', 'continuous'],
    ]);
  });

  it('NXT mode on unsupported stock falls back to KRX with flag', () => {
    const r = tradableIntervals(s, krxOnlyStock, 'NXT');
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((i) => i.venue === 'KRX' && i.fallback)).toBe(true);
  });

  it('UNIFIED is the union labelled UNIFIED', () => {
    const r = tradableIntervals(s, nxtStock, 'UNIFIED');
    expect(r[0]).toMatchObject({ venue: 'UNIFIED', start: at('08:00:00') });
    expect(r.at(-1)!.end).toBe(at('20:00:00'));
    expect(r.every((i) => i.venue === 'UNIFIED')).toBe(true);
  });

  it('KRX mode returns only KRX sessions', () => {
    expect(
      tradableIntervals(s, nxtStock, 'KRX').map((i) => [hm(i.start), hm(i.end), i.venue, i.kind]),
    ).toEqual([
      ['08:30', '09:00', 'KRX', 'auction'],
      ['09:00', '15:20', 'KRX', 'continuous'],
      ['15:20', '15:30', 'KRX', 'auction'],
      ['16:00', '20:00', 'KRX', 'continuous'],
    ]);
  });

  it('ETF excludes the KRX after session', () => {
    const r = tradableIntervals(s, krxOnlyEtf, 'AUTO');
    expect(r.at(-1)!.end).toBe(at('15:30:00'));
  });

  it('no sessions yields no intervals', () => {
    expect(tradableIntervals([], nxtStock, 'AUTO')).toEqual([]);
  });
});

describe('sessionLabelAt', () => {
  it('status chip label', () => {
    expect(sessionLabelAt(s, at('17:42:00'))).toEqual({ label: 'KRX 애프터', venue: 'KRX' });
  });

  it.each([
    ['08:10:00', 'NXT 프리', 'NXT'],
    ['08:40:00', 'NXT 프리', 'NXT'],
    ['08:55:00', 'KRX 시가 단일가', 'KRX'],
    ['09:00:10', 'KRX 정규', 'KRX'],
    ['15:25:00', 'KRX 종가 단일가', 'KRX'],
    ['15:35:00', 'NXT 종가 단일가', 'NXT'],
    ['15:50:00', 'NXT 애프터', 'NXT'],
  ])('%s -> %s', (time, label, venue) => {
    expect(sessionLabelAt(s, at(time))).toEqual({ label, venue });
  });

  it('returns null outside all sessions', () => {
    expect(sessionLabelAt(s, at('07:00:00'))).toBeNull();
    expect(sessionLabelAt(s, at('20:00:00'))).toBeNull();
  });
});
