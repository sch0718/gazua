import { describe, expect, it } from 'vitest';
import type { UniverseItem } from '../lib/data/universe';
import { planGroup, withNewGroup } from './groupImport';

const U = (s: string, t: UniverseItem['t'] = 'STOCK'): UniverseItem => ({ s, n: s, m: 'KOSPI', t });
const UNIVERSE = ['005930', '000660', '042700', '000990', '128940', '009150', '069500', '247540', '035420', '005380', '051910'].map((s) => U(s));

describe('planGroup', () => {
  it('keeps the given order and takes the first 10', () => {
    const stocks = UNIVERSE.map((u) => ({ symbol: u.s, name: u.n }));
    expect(planGroup(stocks, UNIVERSE)).toEqual({ symbols: UNIVERSE.slice(0, 10).map((u) => u.s), found: 11, unknown: 0 });
  });

  it('maps a Toss ETN code (no Q) to the app code and counts unknown codes', () => {
    const plan = planGroup(
      [
        { symbol: '500023', name: 'ETN' },
        { symbol: 'AAPL', name: '애플' },
        { symbol: '005930', name: '삼성전자' },
        { symbol: '005930', name: '삼성전자' },
      ],
      [...UNIVERSE, U('Q500023', 'ETN')],
    );
    expect(plan).toEqual({ symbols: ['Q500023', '005930'], found: 2, unknown: 1 });
  });
});

describe('withNewGroup', () => {
  it('appends a new group with the symbols in color-slot order and leaves other groups alone', () => {
    const before = { groups: [{ id: 'g1', name: '기존', items: [] }] };
    const { watchlists, groupId } = withNewGroup(before, '  토스 보유 ', ['005930', '000660'], 1);
    expect(watchlists.groups).toHaveLength(2);
    expect(watchlists.groups[0]).toBe(before.groups[0]);
    const g = watchlists.groups[1];
    expect(g.id).toBe(groupId);
    expect(g.name).toBe('토스 보유');
    expect(g.items.map((i) => [i.symbol, i.colorSlot])).toEqual([
      ['005930', 1],
      ['000660', 2],
    ]);
  });
});
