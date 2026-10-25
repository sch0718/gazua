import { describe, expect, it } from 'vitest';
import { hashFor, parseHash } from './routes';

describe('simulate routes', () => {
  it('parses the list and a strategy', () => {
    expect(parseHash('#/simulate')).toEqual({ name: 'simulate' });
    expect(parseHash('#/simulate/')).toEqual({ name: 'simulate' });
    expect(parseHash('#/simulate/abc')).toEqual({ name: 'simulate', strategyId: 'abc' });
  });

  it('round-trips ids that need encoding', () => {
    const h = hashFor({ name: 'simulate', strategyId: '전략 1' });
    expect(h).toBe(`#/simulate/${encodeURIComponent('전략 1')}`);
    expect(parseHash(h!)).toEqual({ name: 'simulate', strategyId: '전략 1' });
    expect(hashFor({ name: 'simulate' })).toBe('#/simulate');
  });

  it('a bad percent encoding falls back to the list', () => {
    expect(parseHash('#/simulate/%E0%A4%A')).toEqual({ name: 'simulate' });
  });

  it('keeps existing routes', () => {
    expect(parseHash('#/compare/g1')).toEqual({ name: 'compare', groupId: 'g1' });
    expect(parseHash('#/simulates')).toBeNull();
  });
});

describe('criteria routes', () => {
  it('parses the criteria list, an editor and the result', () => {
    expect(parseHash('#/simulate/criteria')).toEqual({ name: 'simulate', tab: 'criteria' });
    expect(parseHash('#/simulate/criteria/')).toEqual({ name: 'simulate', tab: 'criteria' });
    expect(parseHash('#/simulate/criteria/c1')).toEqual({ name: 'simulate', tab: 'criteria', criteriaId: 'c1' });
    expect(parseHash('#/simulate/criteria/c1/result')).toEqual({ name: 'simulate', tab: 'criteria', criteriaId: 'c1', view: 'result' });
    expect(parseHash('#/simulate/criteria/c1/other')).toBeNull();
  });

  it('writes the same hashes and round-trips an encoded id', () => {
    expect(hashFor({ name: 'simulate', tab: 'criteria' })).toBe('#/simulate/criteria');
    expect(hashFor({ name: 'simulate', tab: 'criteria', criteriaId: '기준 1' })).toBe(`#/simulate/criteria/${encodeURIComponent('기준 1')}`);
    const h = hashFor({ name: 'simulate', tab: 'criteria', criteriaId: '기준 1', view: 'result' })!;
    expect(h.endsWith('/result')).toBe(true);
    expect(parseHash(h)).toEqual({ name: 'simulate', tab: 'criteria', criteriaId: '기준 1', view: 'result' });
  });

  it('a broken escape falls back to the criteria list; the strategy routes are unchanged', () => {
    expect(parseHash('#/simulate/criteria/%E0%A4%A')).toEqual({ name: 'simulate', tab: 'criteria' });
    expect(parseHash('#/simulate/abc')).toEqual({ name: 'simulate', strategyId: 'abc' });
    expect(hashFor({ name: 'simulate', strategyId: 'abc' })).toBe('#/simulate/abc');
  });
});


describe('performance route', () => {
  it('parses and builds #/performance', () => {
    expect(parseHash('#/performance')).toEqual({ name: 'performance' });
    expect(parseHash('#/performance/')).toEqual({ name: 'performance' });
    expect(parseHash('#/performance/x')).toBeNull();
    expect(hashFor({ name: 'performance' })).toBe('#/performance');
  });
});

describe('help routes', () => {
  it('parses the help index and a page', () => {
    expect(parseHash('#/help')).toEqual({ name: 'help' });
    expect(parseHash('#/help/')).toEqual({ name: 'help' });
    expect(parseHash('#/help/compare')).toEqual({ name: 'help', helpId: 'compare' });
    expect(parseHash('#/help/compare/x')).toBeNull();
  });

  it('writes the same hashes', () => {
    expect(hashFor({ name: 'help' })).toBe('#/help');
    expect(hashFor({ name: 'help', helpId: 'performance' })).toBe('#/help/performance');
  });
});

describe('shared route', () => {
  const cap = 'A'.repeat(20) + '_-' + 'b'.repeat(21);
  it('parses a 43-char capability and writes it back', () => {
    expect(parseHash(`#/s/${cap}`)).toEqual({ name: 'shared', capability: cap });
    expect(hashFor({ name: 'shared', capability: cap })).toBe(`#/s/${cap}`);
  });
  it('keeps the shared screen for a malformed capability without carrying it', () => {
    expect(parseHash('#/s/short')).toEqual({ name: 'shared' });
    expect(parseHash(`#/s/${cap}x`)).toEqual({ name: 'shared' });
    expect(parseHash(`#/s/${cap}/extra`)).toBeNull();
    expect(hashFor({ name: 'shared' })).toBeNull();
  });
});

