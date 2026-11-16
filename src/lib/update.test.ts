// @vitest-environment jsdom
import { currentSnackbar, dismissSnackbar, runSnackbarAction } from '@sch0718/ui-svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RELEASE_SEEN_KEY, startAppUpdate } from './update';

vi.mock('./help/release-notes', () => ({
  RELEASE_NOTES: [
    { version: 'v2.0.0', date: '2026-12-01', items: ['새 기능'] },
    { version: 'v1.0.0', date: '2026-11-01', items: ['첫 판'] },
  ],
}));

function memoryStorage(init: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  };
}

afterEach(() => dismissSnackbar());

describe('startAppUpdate', () => {
  it('처음 쓰는 사람에게는 바뀐 점을 알리지 않는다', () => {
    const storage = memoryStorage();
    startAppUpdate(() => {}, () => storage)();
    expect(currentSnackbar()).toBeNull();
    expect(JSON.parse(storage.getItem(RELEASE_SEEN_KEY) ?? '[]')).toEqual(['v2.0.0', 'v1.0.0']);
  });

  it('업데이트 뒤 첫 실행에서 한 번 알리고, 누르면 바뀐 점을 연다', () => {
    const storage = memoryStorage({ [RELEASE_SEEN_KEY]: '["v1.0.0"]' });
    const open = vi.fn();
    startAppUpdate(open, () => storage)();
    expect(currentSnackbar()?.message).toBe('업데이트했어요 (v2.0.0)');
    runSnackbarAction();
    expect(open).toHaveBeenCalledOnce();
    startAppUpdate(open, () => storage)();
    expect(currentSnackbar()).toBeNull();
  });
});
