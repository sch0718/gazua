import { describe, expect, it, vi } from 'vitest';
import { createTokenManager } from './auth';
import type { IssuedAtStore, TokenInfo, TokenStore } from './types';

function memoryStore(initial: TokenInfo | null = null): TokenStore & { saved: TokenInfo[] } {
  let value = initial;
  const saved: TokenInfo[] = [];
  return {
    saved,
    load: () => value,
    save: (t) => {
      value = t;
      saved.push(t);
    },
  };
}

function issuedAtStore(initial: number | null = null): IssuedAtStore & { saved: number[] } {
  let value = initial;
  const saved: number[] = [];
  return {
    saved,
    load: () => value,
    save: (t) => {
      value = t;
      saved.push(t);
    },
  };
}

describe('createTokenManager', () => {
  it('concurrent authenticate calls share one token request', async () => {
    let n = 0;
    const issue = vi.fn(async () => ({ accessToken: `tok${++n}`, expiresAt: 10_000_000 }));
    const mgr = createTokenManager(issue, memoryStore(), () => 0);
    const tokens = await Promise.all([mgr.get(), mgr.get(), mgr.get()]);
    expect(tokens).toEqual(['tok1', 'tok1', 'tok1']);
    expect(issue).toHaveBeenCalledTimes(1);
  });

  it('info() returns the whole token and shares the issue with get()', async () => {
    const issue = vi.fn(async () => ({ accessToken: 'tok', expiresAt: 10_000_000 }));
    const mgr = createTokenManager(issue, memoryStore(), () => 0);
    const [info, token] = await Promise.all([mgr.info(), mgr.get()]);
    expect(info).toEqual({ accessToken: 'tok', expiresAt: 10_000_000 });
    expect(token).toBe('tok');
    expect(issue).toHaveBeenCalledTimes(1);
  });

  it('reuses a valid token without issuing again', async () => {
    const issue = vi.fn(async () => ({ accessToken: 'a', expiresAt: 1_000_000 }));
    const mgr = createTokenManager(issue, memoryStore(), () => 0);
    await mgr.get();
    await mgr.get();
    expect(issue).toHaveBeenCalledTimes(1);
  });

  it('refreshes when less than 60 seconds remain', async () => {
    let now = 0;
    let n = 0;
    const issue = vi.fn(async () => ({ accessToken: `tok${++n}`, expiresAt: now + 100_000 }));
    const mgr = createTokenManager(issue, memoryStore(), () => now);
    expect(await mgr.get()).toBe('tok1');
    now = 39_999; // 60_001ms left
    expect(await mgr.get()).toBe('tok1');
    now = 40_001; // 59_999ms left
    expect(await mgr.get()).toBe('tok2');
    expect(issue).toHaveBeenCalledTimes(2);
  });

  it('invalidate forces re-issue even if the stored token is still valid', async () => {
    let n = 0;
    const issue = vi.fn(async () => ({ accessToken: `tok${++n}`, expiresAt: 10_000_000 }));
    const mgr = createTokenManager(issue, memoryStore(), () => 0);
    expect(await mgr.get()).toBe('tok1');
    mgr.invalidate();
    expect(await mgr.get()).toBe('tok2');
  });

  it('retries after a rejected issue', async () => {
    const issue = vi
      .fn<() => Promise<TokenInfo>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ accessToken: 'ok', expiresAt: 10_000_000 });
    const mgr = createTokenManager(issue, memoryStore(), () => 0);
    await expect(mgr.get()).rejects.toThrow('boom');
    expect(await mgr.get()).toBe('ok');
    expect(issue).toHaveBeenCalledTimes(2);
  });

  it('shares a rejected issue between concurrent callers', async () => {
    const issue = vi.fn(async () => {
      throw new Error('boom');
    });
    const mgr = createTokenManager(issue, memoryStore(), () => 0);
    const results = await Promise.allSettled([mgr.get(), mgr.get()]);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(issue).toHaveBeenCalledTimes(1);
  });

  it('reads the store first and saves after a successful issue', async () => {
    const stored = { accessToken: 'stored', expiresAt: 1_000_000 };
    const issue = vi.fn(async () => ({ accessToken: 'new', expiresAt: 2_000_000 }));
    const store = memoryStore(stored);
    const mgr = createTokenManager(issue, store, () => 0);
    expect(await mgr.get()).toBe('stored');
    expect(issue).not.toHaveBeenCalled();
    mgr.invalidate();
    expect(await mgr.get()).toBe('new');
    expect(store.saved).toEqual([{ accessToken: 'new', expiresAt: 2_000_000 }]);
  });

  it('issues when the stored token is about to expire', async () => {
    const store = memoryStore({ accessToken: 'old', expiresAt: 30_000 });
    const issue = vi.fn(async () => ({ accessToken: 'new', expiresAt: 1_000_000 }));
    const mgr = createTokenManager(issue, store, () => 0);
    expect(await mgr.get()).toBe('new');
  });

  it('does not save when issue fails', async () => {
    const store = memoryStore();
    const mgr = createTokenManager(
      async () => {
        throw new Error('x');
      },
      store,
      () => 0,
    );
    await expect(mgr.get()).rejects.toThrow('x');
    expect(store.saved).toEqual([]);
  });

  it('ignores a stale in-flight result after invalidate', async () => {
    let release!: (t: TokenInfo) => void;
    const first = new Promise<TokenInfo>((r) => (release = r));
    const issue = vi
      .fn<() => Promise<TokenInfo>>()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce({ accessToken: 'fresh', expiresAt: 10_000_000 });
    const store = memoryStore();
    const mgr = createTokenManager(issue, store, () => 0);
    const stale = mgr.get();
    mgr.invalidate();
    expect(await mgr.get()).toBe('fresh');
    release({ accessToken: 'stale', expiresAt: 10_000_000 });
    await stale;
    expect(await mgr.get()).toBe('fresh');
    expect(store.saved.map((t) => t.accessToken)).toEqual(['fresh']);
  });

  it('still returns the token when store.save throws, and re-issues after expiry', async () => {
    let now = 0;
    let n = 0;
    const issue = vi.fn(async () => ({ accessToken: `tok${++n}`, expiresAt: now + 100_000 }));
    const store: TokenStore = {
      load: () => null,
      save: () => {
        throw new Error('quota');
      },
    };
    const mgr = createTokenManager(issue, store, () => now);
    expect(await mgr.get()).toBe('tok1');
    expect(await mgr.get()).toBe('tok1');
    expect(issue).toHaveBeenCalledTimes(1);
    now = 50_000; // 50_000ms left (< 60s)
    expect(await mgr.get()).toBe('tok2');
    expect(issue).toHaveBeenCalledTimes(2);
  });

  it('records the issue time and a new manager (reload) reads it from the same store', async () => {
    let now = 1_000;
    const issued = issuedAtStore();
    const issue = async () => ({ accessToken: 'a', expiresAt: now + 86_400_000 });
    const mgr = createTokenManager(issue, memoryStore(), () => now, issued);
    expect(mgr.lastIssuedAt()).toBeNull();
    await mgr.get();
    expect(issued.saved).toEqual([1_000]);
    expect(mgr.lastIssuedAt()).toBe(1_000);
    now = 21_000;
    const reloaded = createTokenManager(issue, memoryStore(), () => now, issued);
    expect(reloaded.lastIssuedAt()).toBe(1_000);
  });

  it('does not record a time when the issue fails, and still records a stale issue (KIS counted it)', async () => {
    const issued = issuedAtStore();
    const failing = createTokenManager(
      async () => {
        throw new Error('x');
      },
      memoryStore(),
      () => 5,
      issued,
    );
    await expect(failing.get()).rejects.toThrow('x');
    expect(issued.saved).toEqual([]);

    let release!: (t: TokenInfo) => void;
    const first = new Promise<TokenInfo>((r) => (release = r));
    const issue = vi
      .fn<() => Promise<TokenInfo>>()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce({ accessToken: 'fresh', expiresAt: 10_000_000 });
    let now = 100;
    const mgr = createTokenManager(issue, memoryStore(), () => now, issued);
    const stale = mgr.get();
    mgr.invalidate();
    await mgr.get();
    now = 200;
    release({ accessToken: 'stale', expiresAt: 10_000_000 });
    await stale;
    expect(issued.saved).toEqual([100, 200]);
    expect(mgr.lastIssuedAt()).toBe(200);
  });

  it('keeps the issue time in memory when the store cannot save it', async () => {
    const issued: IssuedAtStore = {
      load: () => null,
      save: () => {
        throw new Error('quota');
      },
    };
    const mgr = createTokenManager(async () => ({ accessToken: 'a', expiresAt: 10_000_000 }), memoryStore(), () => 42, issued);
    expect(await mgr.get()).toBe('a');
    expect(mgr.lastIssuedAt()).toBe(42);
  });
});
