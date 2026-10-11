// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SnackbarHost from './SnackbarHost.svelte';
import { dismissSnackbar, showSnackbar } from './snackbarStore.svelte';

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
});
