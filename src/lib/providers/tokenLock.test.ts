import { describe, expect, it, vi } from 'vitest';
import { webTokenLock } from './tokenLock';

describe('webTokenLock', () => {
  it('is undefined without Web Locks', () => {
    expect(webTokenLock('t', null)).toBeUndefined();
  });

  it('runs the callback under navigator.locks.request with the given name and returns its result', async () => {
    const request = vi.fn((_name: string, cb: () => Promise<unknown>) => cb());
    const lock = webTokenLock('gazua:p1:token-lock:toss', { request } as unknown as LockManager)!;
    await expect(lock(async () => 42)).resolves.toBe(42);
    expect(request).toHaveBeenCalledWith('gazua:p1:token-lock:toss', expect.any(Function));
  });

  it('passes a rejection through so the lock is released and the caller sees the error', async () => {
    const request = vi.fn((_name: string, cb: () => Promise<unknown>) => cb());
    const lock = webTokenLock('t', { request } as unknown as LockManager)!;
    await expect(lock(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
  });
});
