import { describe, expect, it } from 'vitest';
import { sessionsForDay } from '../../market/sessions';
import type { StockMeta } from '../../providers/types';
import { kstEpoch } from '../../time/kst';
import { effectiveVenueMode, quoteVenue } from './venue';

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
