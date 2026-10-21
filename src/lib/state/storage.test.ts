import { describe, expect, it } from 'vitest';
import { createSafeStorage } from './storage';
import { DEFAULT_SETTINGS, loadMeta } from './schema';

function makeBacking(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => void data.delete(k),
    setItem: (k: string, v: string) => void data.set(k, String(v)),
  };
}

describe('createSafeStorage', () => {
  it('prefixes keys with gazua:v1: and round-trips JSON', () => {
    const backing = makeBacking();
    const st = createSafeStorage(backing);
    st.set('p:p1:settings', { a: 1 });
    expect(backing.getItem('gazua:v1:p:p1:settings')).toBe('{"a":1}');
    expect(st.get('p:p1:settings', null)).toEqual({ a: 1 });
    expect(st.persistent).toBe(true);
    expect(st.issues).toEqual([]);
  });

  it('reportProxyCleared records the detail once per key', () => {
    const st = createSafeStorage(makeBacking());
    st.reportProxyCleared('k', 'http://localhost:8787');
    st.reportProxyCleared('k', 'http://localhost:8787');
    st.reportProxyCleared('j');
    expect(st.issues).toEqual([
      { key: 'k', kind: 'proxy-cleared', detail: 'http://localhost:8787' },
      { key: 'j', kind: 'proxy-cleared' },
    ]);
  });

  it('clearProxyCleared drops only the proxy-cleared issue of that key', () => {
    const st = createSafeStorage(makeBacking());
    st.reportProxyCleared('k', 'http://localhost:8787');
    st.reportCorrupt('k');
    st.reportProxyCleared('j');
    st.clearProxyCleared('k');
    st.clearProxyCleared('nope');
    expect(st.issues).toEqual([
      { key: 'k', kind: 'corrupt' },
      { key: 'j', kind: 'proxy-cleared' },
    ]);
    // 다시 지워진 뒤에는 새로 알릴 수 있다.
    st.reportProxyCleared('k');
    expect(st.issues).toContainEqual({ key: 'k', kind: 'proxy-cleared' });
  });

  it('returns the fallback for missing keys', () => {
    const st = createSafeStorage(makeBacking());
    expect(st.get('nope', 42)).toBe(42);
  });

  it('remove deletes the stored value', () => {
    const backing = makeBacking();
    const st = createSafeStorage(backing);
    st.set('x', 1);
    st.remove('x');
    expect(backing.getItem('gazua:v1:x')).toBeNull();
    expect(st.get('x', 0)).toBe(0);
  });

  it('memory fallback when setItem throws', () => {
    const st = createSafeStorage({
      ...makeBacking(),
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
    } as Storage);
    st.set('x', 1);
    expect(st.get('x', 0)).toBe(1);
    expect(st.persistent).toBe(false);
    expect(st.issues).toContainEqual({ key: 'x', kind: 'write-failed' });
  });

  it('keeps reading earlier persisted values after falling back to memory', () => {
    const backing = makeBacking();
    backing.setItem('gazua:v1:old', '7');
    let fail = false;
    const st = createSafeStorage({
      ...backing,
      getItem: (k: string) => backing.getItem(k),
      setItem: (k: string, v: string) => {
        if (fail) throw new DOMException('quota', 'QuotaExceededError');
        backing.setItem(k, v);
      },
    } as Storage);
    fail = true;
    st.set('new', 1);
    expect(st.get('old', 0)).toBe(7);
    expect(st.get('new', 0)).toBe(1);
  });

  it('remove stays effective when the backing removeItem throws', () => {
    const backing = makeBacking();
    backing.setItem('gazua:v1:x', '1');
    const st = createSafeStorage({
      ...backing,
      getItem: (k: string) => backing.getItem(k),
      removeItem: () => {
        throw new Error('nope');
      },
    } as Storage);
    st.remove('x');
    expect(st.get('x', 0)).toBe(0);
  });

  it('null backing starts in memory mode', () => {
    const st = createSafeStorage(null);
    expect(st.persistent).toBe(false);
    st.set('a', { b: 2 });
    expect(st.get('a', null)).toEqual({ b: 2 });
    st.remove('a');
    expect(st.get('a', 'gone')).toBe('gone');
    expect(st.issues).toEqual([]);
  });

  it('corrupted JSON falls back to defaults and reports', () => {
    const backing = makeBacking();
    backing.setItem('gazua:v1:p:p1:settings', '{oops');
    const st = createSafeStorage(backing);
    expect(st.get('p:p1:settings', DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    expect(st.issues).toContainEqual({ key: 'p:p1:settings', kind: 'corrupt' });
  });

  it('reports a corrupt key only once', () => {
    const backing = makeBacking();
    backing.setItem('gazua:v1:k', '{oops');
    const st = createSafeStorage(backing);
    st.get('k', 0);
    st.get('k', 0);
    expect(st.issues).toEqual([{ key: 'k', kind: 'corrupt' }]);
  });
});

describe('loadMeta', () => {
  it('creates default profile on first run', () => {
    const backing = makeBacking();
    const st = createSafeStorage(backing);
    const meta = loadMeta(st);
    expect(meta.schemaVersion).toBe(1);
    expect(meta.profiles[0].name).toBe('내 프로필');
    expect(meta.activeProfileId).toBe(meta.profiles[0].id);
    expect(backing.getItem('gazua:v1:meta')).not.toBeNull();
    expect(loadMeta(st)).toEqual(meta);
  });

  it('replaces structurally invalid stored meta with a default profile', () => {
    const backing = makeBacking();
    backing.setItem('gazua:v1:meta', '{"schemaVersion":1,"activeProfileId":"zz","profiles":[]}');
    const meta = loadMeta(createSafeStorage(backing));
    expect(meta.profiles).toHaveLength(1);
    expect(meta.activeProfileId).toBe(meta.profiles[0].id);
  });
});

describe('DEFAULT_SETTINGS', () => {
  it('has the specified defaults', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      provider: 'demo',
      venueMode: 'AUTO',
      period: { unit: 'D', n: 1 },
      metric: 'change',
      theme: 'system',
      colorConvention: 'kr',
      boardOrder: 'value',
      keyLock: false,
      onboarded: false,
    });
  });
});

describe('createSafeStorage — remove reports whether the backing store dropped the key', () => {
  it('true when removed from the backing store; false without a backing store or when removeItem throws', () => {
    const backing = makeBacking();
    const st = createSafeStorage(backing);
    st.set('k', 1);
    expect(st.backed).toBe(true);
    expect(st.remove('k')).toBe(true);
    expect(backing.data.size).toBe(0);

    const none = createSafeStorage(null);
    expect(none.backed).toBe(false);
    expect(none.remove('k')).toBe(false);

    const stuck = makeBacking();
    stuck.removeItem = () => {
      throw new Error('denied');
    };
    expect(createSafeStorage(stuck).remove('k')).toBe(false);
  });
});

describe('createSafeStorage — trySet', () => {
  it('writes straight to the backing store even after an earlier failure, and reports whether it persisted', () => {
    const backing = makeBacking();
    const st = createSafeStorage(backing);
    const setItem = backing.setItem;
    backing.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    st.set('a', 1); // 메모리로 대체, persistent=false
    expect(st.persistent).toBe(false);
    expect(st.trySet('k', { v: 1 })).toBe(false);
    expect(st.get('k', null)).toBeNull(); // 실패하면 아무것도 바꾸지 않는다
    backing.setItem = setItem;
    expect(st.trySet('k', { v: 2 })).toBe(true);
    expect(JSON.parse(backing.data.get('gazua:v1:k')!)).toEqual({ v: 2 });
    expect(createSafeStorage(null).trySet('k', 1)).toBe(false);
  });
});

describe('createSafeStorage — readBacking', () => {
  it('reads what is in the backing store, skipping this tab’s memory overlay', () => {
    const backing = makeBacking();
    const st = createSafeStorage(backing);
    backing.data.set('gazua:v1:k', JSON.stringify({ from: 'other tab' }));
    const setItem = backing.setItem;
    backing.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    st.set('k', { from: 'this tab' }); // 메모리 덮어쓰기
    expect(st.get('k', null)).toEqual({ from: 'this tab' });
    expect(st.readBacking('k', null)).toEqual({ from: 'other tab' });
    backing.setItem = setItem;
    expect(st.readBacking('missing', 'fallback')).toBe('fallback');
    expect(createSafeStorage(null).readBacking('k', 7)).toBe(7);
  });
});
