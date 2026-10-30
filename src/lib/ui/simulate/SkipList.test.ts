// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import SkipList from './SkipList.svelte';
import type { Skip } from '../../sim/types';

describe('SkipList 개수만 받은 공유', () => {
  it('양수인 이유만 그리고 이유는 왼쪽, 개수는 오른쪽에 둔다', () => {
    render(SkipList, { skipped: [], names: {}, counts: [['현금 부족', 2], ['거래 없음', 0], ['1주가 1회 금액보다 비쌈', -1]] });
    const rows = within(screen.getByRole('list', { name: '건너뛴 이유' })).getAllByRole('listitem');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent?.replace(/\s+/g, ' ').trim()).toBe('현금이 모자랐어요 2번');
    expect(rows[0].firstElementChild?.classList.contains('why')).toBe(false);
    expect(rows[0].lastElementChild?.classList.contains('count')).toBe(true);
    expect(screen.getByText('목록은 크기 때문에 빼고 보냈어요').tagName).toBe('P');
  });

  const emptyCases: { counts: [Skip['reason'], number][] }[] = [{ counts: [] }, { counts: [['현금 부족', 0]] }, { counts: [['거래 없음', -1]] }];
  it.each(emptyCases)('양수 개수가 없는 $counts는 빈 상태 문구를 보인다', ({ counts }) => {
    render(SkipList, { skipped: [], names: {}, counts });
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByText('건너뛴 신호가 없어요').tagName).toBe('P');
    expect(screen.queryByText('목록은 크기 때문에 빼고 보냈어요')).toBeNull();
  });
});
