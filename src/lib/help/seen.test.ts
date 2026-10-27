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

  // 공용 패키지(@sch0718/seen-store)로 바꾸며 이전 구현과 같게 도는지 확인한 경우들
  it('continues the record written by the previous implementation under the same key', () => {
    const s = memoryStorage({ [HELP_SEEN_KEY]: JSON.stringify(['compare', 'simulate']) });
    const store = createHelpSeenStore(() => s as unknown as Storage);
    store.mark('performance');
    expect(JSON.parse(s.data.get(HELP_SEEN_KEY)!).sort()).toEqual(['compare', 'performance', 'simulate']);
  });

  it('drops non-array values and non-string entries', () => {
    expect(createHelpSeenStore(() => memoryStorage({ [HELP_SEEN_KEY]: '{"compare":1}' }) as unknown as Storage).read().size).toBe(0);
    const s = memoryStorage({ [HELP_SEEN_KEY]: JSON.stringify([1, null, 'compare', ['simulate']]) });
    expect([...createHelpSeenStore(() => s as unknown as Storage).read()]).toEqual(['compare']);
  });

  it('switches to memory for this load when a write fails, without touching storage again', () => {
    const s = memoryStorage({ [HELP_SEEN_KEY]: JSON.stringify(['compare']) });
    let writes = 0;
    const blocked = {
      ...s,
      setItem: () => {
        writes += 1;
        throw new Error('quota');
      },
    };
    const store = createHelpSeenStore(() => blocked as unknown as Storage);
    store.mark('simulate');
    store.mark('performance');
    expect(writes).toBe(1);
    expect([...store.read()].sort()).toEqual(['compare', 'performance', 'simulate']);
    expect(JSON.parse(s.data.get(HELP_SEEN_KEY)!)).toEqual(['compare']);
  });

  it('forgets in memory even when removing from storage fails', () => {
    const s = memoryStorage({ [HELP_SEEN_KEY]: JSON.stringify(['compare']) });
    const store = createHelpSeenStore(() => ({ ...s, removeItem: () => { throw new Error('blocked'); } }) as unknown as Storage);
    expect(store.read().size).toBe(1);
    store.reset();
    expect(store.read().size).toBe(0);
  });
});
