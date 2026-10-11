import { describe, expect, it } from 'vitest';
import { fmtPct, fmtTrillion, fmtWon, trendClass } from './format';

describe('fmtPct', () => {
  it('renders null as an em dash', () => expect(fmtPct(null)).toBe('—'));
  it('renders zero without a sign or arrow', () => expect(fmtPct(0)).toBe('0.00%'));
  it('prefixes positives with ▲ and +', () => expect(fmtPct(1.9)).toBe('▲ +1.90%'));
  it('prefixes negatives with ▼', () => expect(fmtPct(-1.2)).toBe('▼ -1.20%'));
  it('rounds to two decimals', () => expect(fmtPct(12.3456)).toBe('▲ +12.35%'));
  it('treats values that round to 0.00 as flat', () => {
    expect(fmtPct(0.004)).toBe('0.00%');
    expect(fmtPct(-0.004)).toBe('0.00%');
  });
  it('keeps the smallest visible moves', () => {
    expect(fmtPct(0.005)).toBe('▲ +0.01%');
    expect(fmtPct(-0.01)).toBe('▼ -0.01%');
  });
});

describe('fmtWon', () => {
  it('groups thousands', () => expect(fmtWon(71300)).toBe('71,300'));
  it('handles large values', () => expect(fmtWon(1234567890)).toBe('1,234,567,890'));
  it('drops fractions', () => expect(fmtWon(71300.6)).toBe('71,301'));
  it('handles zero', () => expect(fmtWon(0)).toBe('0'));
});

describe('fmtTrillion', () => {
  it('uses one decimal and the 조 unit', () => expect(fmtTrillion(414.36)).toBe('414.4조'));
  it('keeps a trailing zero', () => expect(fmtTrillion(2)).toBe('2.0조'));
});

describe('trendClass', () => {
  it('maps positives to up and negatives to down', () => {
    expect(trendClass(1.2, 'kr')).toBe('up');
    expect(trendClass(-0.3, 'kr')).toBe('down');
  });
  it('maps null and zero to empty', () => {
    expect(trendClass(null, 'kr')).toBe('');
    expect(trendClass(0, 'global')).toBe('');
  });
  it('does not depend on the color convention', () => {
    expect(trendClass(1, 'global')).toBe('up');
    expect(trendClass(-1, 'global')).toBe('down');
  });
  it('treats values that round to 0.00 as flat, like fmtPct', () => {
    expect(trendClass(0.004, 'kr')).toBe('');
    expect(trendClass(-0.004, 'kr')).toBe('');
  });
});
