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
