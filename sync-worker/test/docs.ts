import type { ProfileDocV1 } from '../../src/lib/sync/dto';
import { newStrategy } from '../../src/lib/sim/defaults';
import { T0 } from './harness';

export function doc(name = '내 프로필', groups = ['관심']): ProfileDocV1 {
  return {
    v: 1,
    name,
    settings: { period: { unit: 'D', n: 1 }, metric: 'change', benchmark: 'AUTO', perfBenchmark: null, colorConvention: 'kr', boardOrder: 'value' },
    watchlists: { groups: groups.map((g, i) => ({ id: `g${i}`, name: g, items: [{ symbol: '005930', colorSlot: 1, hidden: false, addedAt: 1 }] })) },
    strategies: [{ ...newStrategy(T0, 'g0', '눌림목'), id: 's1' }],
    criteria: [],
    baskets: [],
  };
}
