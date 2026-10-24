import { describe, expect, it } from 'vitest';
import { helpIdForRoute, introIdFor } from './routing';

describe('helpIdForRoute', () => {
  it('maps each screen to its help page', () => {
    expect(helpIdForRoute({ name: 'compare', groupId: 'g1' })).toBe('compare');
    expect(helpIdForRoute({ name: 'simulate' })).toBe('simulate');
    expect(helpIdForRoute({ name: 'simulate', strategyId: 's1' })).toBe('simulate');
    expect(helpIdForRoute({ name: 'simulate', tab: 'criteria', criteriaId: 'c1', view: 'result' })).toBe('criteria');
    expect(helpIdForRoute({ name: 'performance' })).toBe('performance');
    expect(helpIdForRoute({ name: 'settings' })).toBe('settings');
    expect(helpIdForRoute({ name: 'onboarding' })).toBeNull();
    expect(helpIdForRoute({ name: 'help' })).toBeNull();
  });
});

describe('introIdFor', () => {
  const none = new Set<string>();
  it('shows the first intro on the four menu entries only', () => {
    expect(introIdFor({ name: 'compare', groupId: 'g1' }, none, false)).toBe('compare');
    expect(introIdFor({ name: 'simulate' }, none, false)).toBe('simulate');
    expect(introIdFor({ name: 'simulate', tab: 'criteria' }, none, false)).toBe('criteria');
    expect(introIdFor({ name: 'performance' }, none, false)).toBe('performance');
    expect(introIdFor({ name: 'simulate', strategyId: 's1' }, none, false)).toBeNull();
    expect(introIdFor({ name: 'simulate', tab: 'criteria', criteriaId: 'c1' }, none, false)).toBeNull();
    expect(introIdFor({ name: 'settings' }, none, false)).toBeNull();
    expect(introIdFor({ name: 'help', helpId: 'compare' }, none, false)).toBeNull();
  });

  it('does not show an intro already seen or while something else is open', () => {
    expect(introIdFor({ name: 'compare' }, new Set(['compare']), false)).toBeNull();
    expect(introIdFor({ name: 'compare' }, none, true)).toBeNull();
  });
});
