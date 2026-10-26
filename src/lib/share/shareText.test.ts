import { describe, expect, it } from 'vitest';
import { newStrategy } from '../sim/defaults';
import { groupSnapshot, strategySnapshot } from './snapshot';
import { snapshotLines, symbolNames } from './shareText';

const group = groupSnapshot({
  id: 'g',
  name: '반도체',
  items: [
    { symbol: '000660', colorSlot: 1, hidden: false, addedAt: 1 },
    { symbol: '999999', colorSlot: 2, hidden: false, addedAt: 2 },
  ],
});
const names = symbolNames([
  { s: '000660', n: 'SK하이닉스', m: 'KOSPI', t: 'STOCK' },
  { s: '005930', n: '삼성전자', m: 'KOSPI', t: 'STOCK' },
]);

describe('snapshotLines', () => {
  it('이름을 알면 「이름(코드)」, 모르면 코드만 보인다', () => {
    expect(snapshotLines(group, names)[1]).toBe('종목 2개: SK하이닉스(000660), 999999');
  });

  it('이름 목록이 없으면 코드만 보인다', () => {
    expect(snapshotLines(group)[1]).toBe('종목 2개: 000660, 999999');
  });

  it('전략 종목에도 이름을 붙인다', () => {
    const s = newStrategy(1, null);
    s.universe = { kind: 'symbols', symbols: ['005930'] };
    const snap = strategySnapshot(s, { groups: [], activeGroupId: null } as never, { hideCapital: true });
    expect(snapshotLines(snap, names)[1]).toBe('종목 1개: 삼성전자(005930)');
  });
});
