// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
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

  describe('keyboard (roving tabindex, manual activation)', () => {
    const setup = (currentId: string | undefined) => {
      const onselect = vi.fn();
      const view = render(GroupTabs, {
        groups: [group('a', '반도체'), group('b', '2차전지'), group('c', '배당')],
        currentId,
        onselect,
        onadd: vi.fn(),
        onmanage: vi.fn(),
      });
      const tabs = screen.getAllByRole('tab');
      return { onselect, view, tabs };
    };
    const stops = (tabs: HTMLElement[]) => tabs.filter((t) => t.getAttribute('tabindex') === '0');

    it('only the selected tab is a tab stop; without a selection the first tab is', () => {
      const a = setup('b');
      expect(stops(a.tabs)).toEqual([a.tabs[1]]);
      cleanup();
      const b = setup(undefined);
      expect(stops(b.tabs)).toEqual([b.tabs[0]]);
    });

    it('ArrowRight/ArrowLeft move focus only (wrapping) and do not select', async () => {
      const { onselect, tabs } = setup('b');
      tabs[1].focus();
      await fireEvent.keyDown(tabs[1], { key: 'ArrowRight' });
      expect(document.activeElement).toBe(tabs[2]);
      expect(stops(tabs)).toEqual([tabs[2]]);
      await fireEvent.keyDown(tabs[2], { key: 'ArrowRight' });
      expect(document.activeElement).toBe(tabs[0]); // 끝에서 처음으로 순환
      await fireEvent.keyDown(tabs[0], { key: 'ArrowLeft' });
      expect(document.activeElement).toBe(tabs[2]);
      expect(onselect).not.toHaveBeenCalled();
    });

    it('Home and End jump to the first and last tab', async () => {
      const { onselect, tabs } = setup('b');
      tabs[1].focus();
      await fireEvent.keyDown(tabs[1], { key: 'End' });
      expect(document.activeElement).toBe(tabs[2]);
      await fireEvent.keyDown(tabs[2], { key: 'Home' });
      expect(document.activeElement).toBe(tabs[0]);
      expect(onselect).not.toHaveBeenCalled();
    });

    it('Enter selects the focused tab (the click a native button fires)', async () => {
      const { onselect, tabs } = setup('b');
      tabs[1].focus();
      await fireEvent.keyDown(tabs[1], { key: 'End' });
      await fireEvent.click(document.activeElement as HTMLElement); // button의 Enter·Space는 click으로 온다
      expect(onselect).toHaveBeenCalledExactlyOnceWith('c');
    });

    it('resets the tab stop to the selected tab when currentId changes', async () => {
      const { view, tabs } = setup('a');
      tabs[0].focus();
      await fireEvent.keyDown(tabs[0], { key: 'End' });
      expect(stops(tabs)).toEqual([tabs[2]]);
      await view.rerender({ currentId: 'b' });
      expect(stops(tabs)).toEqual([tabs[1]]);
    });
  });
});
