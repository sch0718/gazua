import type { ProfileDocV1, ProfileDocV2 } from '../../src/lib/sync/dto';
import { newStrategy } from '../../src/lib/sim/defaults';
import { fullStrategyV2 } from '../../src/lib/sim/testStrategyV2';
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

/** 전략 v2를 담은 문서(전략 빌더 PR①). 나머지는 doc()과 같다 */
export function docV2(name = '내 프로필'): ProfileDocV2 {
  const d = doc(name);
  return { ...d, v: 2, strategies: [{ ...fullStrategyV2(), id: 's1' }] };
}
