import { describe, expect, it } from 'vitest';
import { compareSnapshot } from './compact';

describe('compareSnapshot', () => {
  it('숨긴 종목만 있으면 빈 종목 목록이 된다(화면은 이때 공유 단추를 숨긴다)', () => {
    const g = { id: 'g', name: '빈 그룹', items: [{ symbol: '005930', colorSlot: 1 as const, hidden: true, addedAt: 1 }] };
    expect(compareSnapshot(g, { period: { unit: 'D', n: 1 }, metric: 'change', benchmark: 'KOSPI', boardOrder: 'mine' }).symbols).toEqual([]);
  });
});
