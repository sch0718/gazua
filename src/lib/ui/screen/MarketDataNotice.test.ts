// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import MarketDataNotice from './MarketDataNotice.svelte';

const info = { collectedAt: '2026-10-16T09:00:00+09:00', stocks: 30, range: { from: '2024-10-16', to: '2026-10-15' } };

describe('MarketDataNotice', () => {
  it('without data: the spec 7.2 card with import and how-to', async () => {
    const onimport = vi.fn();
    render(MarketDataNotice, { info: null, ageDays: null, onimport, ondismiss: vi.fn() });
    expect(screen.getByText('시장 데이터가 없어요. 수집 스크립트로 만든 파일을 가져와 주세요')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: '데이터 가져오기' }));
    expect(onimport).toHaveBeenCalled();
    const how = screen.getByRole('link', { name: '수집 방법' });
    expect(how.getAttribute('href')).toMatch(/^https:\/\/github\.com\/sch0718\/gazua/);
    expect(how.getAttribute('rel')).toContain('noopener');
  });

  it('data not older than 30 days shows nothing', () => {
    const { container } = render(MarketDataNotice, { info, ageDays: 30, onimport: vi.fn(), ondismiss: vi.fn() });
    expect(container.textContent?.trim()).toBe('');
  });

  it('older than 30 days: the stale text with a close button', async () => {
    const ondismiss = vi.fn();
    render(MarketDataNotice, { info, ageDays: 31, onimport: vi.fn(), ondismiss });
    expect(screen.getByText('데이터가 31일 전 것이에요. 최근 기간은 검증에 빠져요')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(ondismiss).toHaveBeenCalled();
  });
});
