import { describe, expect, it } from 'vitest';
import { createHelpSeenStore, HELP_SEEN_KEY } from './seen';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
}

describe('help seen store', () => {
  it('remembers the menus whose first intro was shown, and forgets them on reset', () => {
    const s = memoryStorage();
    const store = createHelpSeenStore(() => s as unknown as Storage);
    expect(store.read().size).toBe(0);
    store.mark('compare');
    store.mark('performance');
    expect([...createHelpSeenStore(() => s as unknown as Storage).read()].sort()).toEqual(['compare', 'performance']);
    store.reset();
    expect(s.data.has(HELP_SEEN_KEY)).toBe(false);
    expect(store.read().size).toBe(0);
  });

  it('reads a broken value as empty and drops unknown ids', () => {
    expect(createHelpSeenStore(() => memoryStorage({ [HELP_SEEN_KEY]: '{oops' }) as unknown as Storage).read().size).toBe(0);
    const s = memoryStorage({ [HELP_SEEN_KEY]: JSON.stringify(['compare', 'nope']) });
    expect([...createHelpSeenStore(() => s as unknown as Storage).read()]).toEqual(['compare']);
  });

  it('keeps working in memory when storage throws', () => {
    const store = createHelpSeenStore(() => {
      throw new Error('blocked');
    });
    store.mark('simulate');
    expect([...store.read()]).toEqual(['simulate']);
  });
});
