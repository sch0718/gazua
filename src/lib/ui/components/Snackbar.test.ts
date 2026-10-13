// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SnackbarHost from './SnackbarHost.svelte';
import { dismissSnackbar, holdSnackbar, releaseSnackbar, showSnackbar } from './snackbarStore.svelte';

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
});
