import { describe, expect, it } from 'vitest';
import { sessionsForDay } from '../../market/sessions';
import type { StockMeta } from '../../providers/types';
import { kstEpoch } from '../../time/kst';
import { effectiveVenueMode, nextVenueMode, quoteVenue } from './venue';

const DAY = '2026-10-12';
const at = (hhmm: string) => kstEpoch(DAY, `${hhmm}:00`);
const sessions = sessionsForDay({ date: DAY, isOpen: true });
const meta = (nxtSupported: boolean): StockMeta => ({
  symbol: 'A',
  name: 'A',
  market: 'KOSPI',
  securityType: 'STOCK',
  nxtSupported,
  krxSuspended: false,
  nxtSuspended: null,
  liquidationTrading: false,
});
const KIS = ['KRX', 'NXT', 'UNIFIED'] as const;
const TOSS = ['UNIFIED'] as const;

describe('effectiveVenueMode', () => {
  it('keeps supported modes and falls back to 통합', () => {
    expect(effectiveVenueMode(KIS, 'AUTO')).toBe('AUTO');
    expect(effectiveVenueMode(KIS, 'NXT')).toBe('NXT');
    expect(effectiveVenueMode(TOSS, 'AUTO')).toBe('UNIFIED');
    expect(effectiveVenueMode(TOSS, 'KRX')).toBe('UNIFIED');
  });
});

describe('quoteVenue', () => {
  it('auto follows the KRX-first rule per stock, KRX outside sessions', () => {
    expect(quoteVenue(KIS, 'AUTO', meta(true), sessions, at('08:10'))).toBe('NXT');
    expect(quoteVenue(KIS, 'AUTO', meta(true), sessions, at('10:00'))).toBe('KRX');
    expect(quoteVenue(KIS, 'AUTO', meta(false), sessions, at('08:10'))).toBe('KRX');
    expect(quoteVenue(KIS, 'AUTO', meta(true), sessions, at('21:00'))).toBe('KRX');
  });

  it('NXT mode uses KRX for stocks NXT does not list; Toss is always 통합', () => {
    expect(quoteVenue(KIS, 'NXT', meta(false), sessions, at('10:00'))).toBe('KRX');
    expect(quoteVenue(KIS, 'NXT', meta(true), sessions, at('10:00'))).toBe('NXT');
    expect(quoteVenue(TOSS, 'AUTO', meta(true), sessions, at('10:00'))).toBe('UNIFIED');
  });
});

describe('nextVenueMode', () => {
  it('cycles 자동 → KRX → NXT → 통합 → 자동 for a provider that has them all', () => {
    expect(nextVenueMode(KIS, 'AUTO')).toBe('KRX');
    expect(nextVenueMode(KIS, 'KRX')).toBe('NXT');
    expect(nextVenueMode(KIS, 'NXT')).toBe('UNIFIED');
    expect(nextVenueMode(KIS, 'UNIFIED')).toBe('AUTO');
  });

  it('skips modes the provider does not support', () => {
    expect(nextVenueMode(['KRX', 'UNIFIED'], 'AUTO')).toBe('KRX');
    expect(nextVenueMode(['KRX', 'UNIFIED'], 'KRX')).toBe('UNIFIED');
    expect(nextVenueMode(['KRX', 'UNIFIED'], 'UNIFIED')).toBe('KRX');
  });

  it('starts from the effective mode: a saved KRX under 토스 is already 통합 and stays there', () => {
    expect(nextVenueMode(TOSS, 'KRX')).toBe('UNIFIED');
    expect(nextVenueMode(TOSS, 'AUTO')).toBe('UNIFIED');
    expect(nextVenueMode(TOSS, 'UNIFIED')).toBe('UNIFIED');
  });
});
