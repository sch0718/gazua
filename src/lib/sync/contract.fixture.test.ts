// 한 번만 실행: WRITE_CONTRACT=1이면 지금 코드로 v1 문서·공유를 만들어 __fixtures__/contract-v1.json에 쓴다(전략 빌더 PR② Task 3).
// 그 뒤로는 건너뛴다. 파일은 이후 코드가 Worker 공용 경로 동작을 바꾸지 않았다는 기준이다(contract.test.ts).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { newCriteria } from '../screen/defaults';
import { simResultFixture } from '../share/testFixtures';
import { strategySnapshot } from '../share/snapshot';
import { newStrategy } from '../sim/defaults';

const T = Date.UTC(2026, 10, 1, 3);

describe.runIf(process.env.WRITE_CONTRACT === '1')('계약 고정값 쓰기', () => {
  it('contract-v1.json', () => {
    const strategy = { ...newStrategy(T, 'g0', '눌림목'), id: 's1' };
    const criteria = { ...newCriteria(T, null), id: 'c1' };
    const doc = {
      v: 1,
      name: '계약',
      settings: { period: { unit: 'D', n: 1 }, metric: 'change', benchmark: 'AUTO', perfBenchmark: null, colorConvention: 'kr', boardOrder: 'value' },
      watchlists: { groups: [{ id: 'g0', name: '관심', items: [{ symbol: '005930', colorSlot: 1, hidden: false, addedAt: 1 }] }] },
      strategies: [strategy],
      criteria: [criteria],
      baskets: [],
    };
    const share = strategySnapshot({ ...strategy, universe: { kind: 'symbols', symbols: ['005930'] } }, { groups: [] }, { hideCapital: false, now: T });
    const sim = simResultFixture();
    writeFileSync(join(import.meta.dirname, '__fixtures__', 'contract-v1.json'), `${JSON.stringify({ now: T, doc, share, sim }, null, 2)}\n`);
  });
});
