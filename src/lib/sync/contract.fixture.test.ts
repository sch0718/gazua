// WRITE_CONTRACT=1이면 v1 문서·공유를 쓴다. CONTRACT_OUTPUT으로 임시 출력 경로를 고른다.
// 고정값은 Worker 공용 경로 동작의 기준이다(contract.test.ts). 앱의 v2 기본값을 쓰지 않는다.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { newCriteria } from '../screen/defaults';
import { newStrategyV1 } from '../sim/strategyV1';
// 시뮬레이션 공유는 v1 전략·결과·받은 시각을 함께 고정한다.
import sim from './__fixtures__/sim-result-v1.json';

const T = Date.UTC(2026, 10, 1, 3);

const fixturePath = join(import.meta.dirname, '__fixtures__', 'contract-v1.json');

function contractV1Fixture() {
  const strategy = { ...newStrategyV1(T, 'g0', '눌림목'), id: 's1' };
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
  const share = {
    kind: 'strategy',
    v: 1,
    title: strategy.name,
    strategy: { ...strategy, id: 'shared', updatedAt: 0, universe: { kind: 'symbols', symbols: ['005930'] } },
    capitalHidden: false,
  };
  return { now: T, doc, share, sim };
}

function contractV1Json(): string {
  return `${JSON.stringify(contractV1Fixture(), null, 2)}\n`;
}

describe('계약 고정값 생성기', () => {
  it('다시 만들어도 커밋된 v1 계약과 바이트가 같다', () => {
    expect(contractV1Json()).toBe(readFileSync(fixturePath, 'utf8'));
  });
});

describe.runIf(process.env.WRITE_CONTRACT === '1')('계약 고정값 쓰기', () => {
  it('contract-v1.json', () => {
    writeFileSync(process.env.CONTRACT_OUTPUT ?? fixturePath, contractV1Json());
  });
});
