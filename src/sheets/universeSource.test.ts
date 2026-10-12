import { describe, expect, it, vi } from 'vitest';
import type { UniverseItem } from '../lib/data/universe';
import { createUniverseSource } from './universeSource';

const ITEMS: UniverseItem[] = [{ s: '005930', n: '삼성전자', m: 'KOSPI', t: 'STOCK' }];

describe('createUniverseSource', () => {
  it('loads once and shares the result', async () => {
    const load = vi.fn(async () => ITEMS);
    const get = createUniverseSource(load);
    await expect(get()).resolves.toBe(ITEMS);
    await expect(get()).resolves.toBe(ITEMS);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('forgets a failed load so the next call retries', async () => {
    const load = vi.fn<() => Promise<UniverseItem[]>>().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(ITEMS);
    const get = createUniverseSource(load);
    await expect(get()).rejects.toThrow('offline');
    await expect(get()).resolves.toBe(ITEMS);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
