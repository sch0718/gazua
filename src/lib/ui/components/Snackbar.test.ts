// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SnackbarHost from './SnackbarHost.svelte';
import { dismissSnackbar, holdSnackbar, holdSnackbarWhileFocused, releaseSnackbar, showSnackbar } from './snackbarStore.svelte';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  dismissSnackbar();
  vi.useRealTimers();
});

describe('Snackbar', () => {
  it('renders the message in a status region', () => {
    render(SnackbarHost);
    showSnackbar('삭제했어요');
    flushSync();
    expect(screen.getByRole('status').textContent).toContain('삭제했어요');
  });

  it('a new snackbar replaces the old one', () => {
    render(SnackbarHost);
    showSnackbar('첫째');
    flushSync();
    showSnackbar('둘째');
    flushSync();
    const text = screen.getByRole('status').textContent;
    expect(text).toContain('둘째');
    expect(text).not.toContain('첫째');
  });

  it('disappears after the default 5 seconds', () => {
    render(SnackbarHost);
    showSnackbar('곧 사라져요');
    flushSync();
    vi.advanceTimersByTime(4999);
    flushSync();
    expect(screen.getByRole('status').textContent).toContain('곧 사라져요');
    vi.advanceTimersByTime(1);
    flushSync();
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('the replaced snackbar timer does not dismiss the new one early', () => {
    render(SnackbarHost);
    showSnackbar('첫째');
    vi.advanceTimersByTime(3000);
    showSnackbar('둘째');
    vi.advanceTimersByTime(3000);
    flushSync();
    expect(screen.getByRole('status').textContent).toContain('둘째');
  });

  it('honors a custom duration', () => {
    render(SnackbarHost);
    showSnackbar('짧게', undefined, 1000);
    vi.advanceTimersByTime(1000);
    flushSync();
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('runs the action and dismisses', async () => {
    const run = vi.fn();
    render(SnackbarHost);
    showSnackbar('삭제했어요', { label: '되돌리기', run });
    flushSync();
    await fireEvent.click(screen.getByRole('button', { name: '되돌리기' }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('lets the action show a follow-up snackbar', async () => {
    render(SnackbarHost);
    showSnackbar('삭제했어요', { label: '되돌리기', run: () => showSnackbar('되돌렸어요') });
    flushSync();
    await fireEvent.click(screen.getByRole('button', { name: '되돌리기' }));
    expect(screen.getByRole('status').textContent).toContain('되돌렸어요');
  });

  it('marks the action button with data-snackbar-action', () => {
    render(SnackbarHost);
    showSnackbar('삭제했어요', { label: '되돌리기', run: () => {} });
    flushSync();
    expect(screen.getByRole('button', { name: '되돌리기' }).hasAttribute('data-snackbar-action')).toBe(true);
  });

  it('does not close while focus is inside, then resumes the remaining time of a custom duration', async () => {
    render(SnackbarHost);
    const outside = document.createElement('button');
    document.body.append(outside);
    showSnackbar('가져왔어요', { label: '되돌리기', run: () => {} }, 8000);
    flushSync();
    vi.advanceTimersByTime(3000);
    const undo = screen.getByRole('button', { name: '되돌리기' });
    undo.focus();
    await fireEvent.focusIn(undo);
    vi.advanceTimersByTime(60_000);
    flushSync();
    expect(screen.getByRole('status').textContent).toContain('가져왔어요');

    outside.focus();
    await fireEvent.focusOut(undo, { relatedTarget: outside });
    vi.advanceTimersByTime(4999);
    flushSync();
    expect(screen.getByRole('status').textContent).toContain('가져왔어요');
    vi.advanceTimersByTime(1);
    flushSync();
    expect(screen.getByRole('status').textContent).toBe('');
    outside.remove();
  });

  it('hold and release do nothing without a snackbar, and a new snackbar is not held', () => {
    render(SnackbarHost);
    holdSnackbar();
    releaseSnackbar();
    showSnackbar('첫째');
    holdSnackbar();
    showSnackbar('둘째', undefined, 1000);
    vi.advanceTimersByTime(1000);
    flushSync();
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('after the action, focuses what action.focus() returns once the update has rendered', async () => {
    render(SnackbarHost);
    const target = document.createElement('button');
    const order: string[] = [];
    const focus = vi.fn(() => {
      order.push('focus');
      return target;
    });
    showSnackbar('삭제했어요', {
      label: '되돌리기',
      run: () => {
        order.push('run');
        document.body.append(target);
      },
      focus,
    });
    flushSync();
    screen.getByRole('button', { name: '되돌리기' }).click();
    expect(focus).not.toHaveBeenCalled(); // 렌더(tick) 뒤에 찾는다
    await tick();
    expect(order).toEqual(['run', 'focus']);
    expect(document.activeElement).toBe(target);
    target.remove();
  });

  it('action.focus() returning nothing leaves focus alone', async () => {
    render(SnackbarHost);
    const focus = vi.fn(() => null);
    showSnackbar('삭제했어요', { label: '되돌리기', run: () => {}, focus });
    flushSync();
    await fireEvent.click(screen.getByRole('button', { name: '되돌리기' }));
    await tick();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toBe('');
  });

  describe('holdSnackbarWhileFocused (focus moved after a delete)', () => {
    const text = () => screen.getByRole('status').textContent;
    let row: HTMLButtonElement;
    let other: HTMLButtonElement;
    beforeEach(() => {
      row = document.createElement('button');
      other = document.createElement('button');
      document.body.append(row, other);
    });
    afterEach(() => {
      row.remove();
      other.remove();
    });

    it('holds while focus rests on the element, then resumes the remaining time after it leaves', () => {
      render(SnackbarHost);
      showSnackbar('삭제했어요', { label: '되돌리기', run: () => {} });
      vi.advanceTimersByTime(1000);
      row.focus();
      holdSnackbarWhileFocused(row);
      vi.advanceTimersByTime(60_000);
      flushSync();
      expect(text()).toContain('삭제했어요');
      other.focus();
      vi.advanceTimersByTime(3999);
      flushSync();
      expect(text()).toContain('삭제했어요');
      vi.advanceTimersByTime(1);
      flushSync();
      expect(text()).toBe('');
    });

    it('does nothing when the element does not have focus', () => {
      render(SnackbarHost);
      showSnackbar('삭제했어요');
      holdSnackbarWhileFocused(row);
      vi.advanceTimersByTime(5000);
      flushSync();
      expect(text()).toBe('');
    });

    it('moving from the element to the snackbar button keeps it held by the snackbar itself', async () => {
      render(SnackbarHost);
      showSnackbar('삭제했어요', { label: '되돌리기', run: () => {} });
      flushSync();
      row.focus();
      holdSnackbarWhileFocused(row);
      screen.getByRole('button', { name: '되돌리기' }).focus();
      vi.advanceTimersByTime(60_000);
      flushSync();
      expect(text()).toContain('삭제했어요');
    });

    it('the element leaving the document releases the hold', async () => {
      render(SnackbarHost);
      showSnackbar('삭제했어요');
      row.focus();
      holdSnackbarWhileFocused(row);
      row.remove();
      await Promise.resolve(); // MutationObserver
      vi.advanceTimersByTime(5000);
      flushSync();
      expect(text()).toBe('');
    });

    it('a focusout caused by a re-sort (focus is back on the element right away) keeps the hold', async () => {
      render(SnackbarHost);
      showSnackbar('삭제했어요', { label: '되돌리기', run: () => {} });
      vi.advanceTimersByTime(1000);
      row.focus();
      holdSnackbarWhileFocused(row);
      // 행이 옮겨지며 브라우저가 포커스를 버렸다가(focusout) 같은 렌더 안에서 되돌린다
      row.blur();
      row.focus();
      await Promise.resolve();
      vi.advanceTimersByTime(60_000);
      flushSync();
      expect(text()).toContain('삭제했어요');
      // 그 뒤 다른 곳으로 옮기면 멈춘 시점의 남은 시간(4초)부터 다시 흐른다
      other.focus();
      vi.advanceTimersByTime(3999);
      flushSync();
      expect(text()).toContain('삭제했어요');
      vi.advanceTimersByTime(1);
      flushSync();
      expect(text()).toBe('');
    });

    it('a focusout to nowhere that stays gone releases the hold after a microtask', async () => {
      render(SnackbarHost);
      showSnackbar('삭제했어요');
      row.focus();
      holdSnackbarWhileFocused(row);
      row.blur();
      await Promise.resolve();
      vi.advanceTimersByTime(5000);
      flushSync();
      expect(text()).toBe('');
    });

    it('a new snackbar is not held by the earlier element, and leaving that element later does nothing', () => {
      render(SnackbarHost);
      showSnackbar('삭제했어요');
      row.focus();
      holdSnackbarWhileFocused(row);
      showSnackbar('다음', undefined, 8000);
      vi.advanceTimersByTime(3000);
      other.focus(); // 이전 요소의 focusout: 새 스낵바의 남은 시간을 건드리지 않는다
      vi.advanceTimersByTime(4999);
      flushSync();
      expect(text()).toContain('다음');
      vi.advanceTimersByTime(1);
      flushSync();
      expect(text()).toBe('');
    });
  });
});
