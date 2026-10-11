// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { Group } from '../../state/schema';
import GroupTabs from './GroupTabs.svelte';

const group = (id: string, name: string): Group => ({ id, name, items: [] }) as unknown as Group;

describe('GroupTabs', () => {
  it('keeps only tabs inside the tablist (the add and manage buttons sit outside it)', () => {
    render(GroupTabs, {
      groups: [group('a', '반도체'), group('b', '2차전지')],
      currentId: 'a',
      onselect: vi.fn(),
      onadd: vi.fn(),
      onmanage: vi.fn(),
    });
    const list = screen.getByRole('tablist', { name: '관심 그룹' });
    expect(within(list).queryAllByRole('button')).toHaveLength(0); // 탭은 role=tab이라 button이 아니다
    expect(within(list).getAllByRole('tab').map((t) => t.textContent?.trim())).toEqual(['반도체', '2차전지']);
    expect(within(list).queryByRole('button', { name: '새 그룹' })).toBeNull();
    expect(screen.getByRole('button', { name: '새 그룹' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '그룹 관리' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '반도체' }).getAttribute('aria-selected')).toBe('true');
  });
});
