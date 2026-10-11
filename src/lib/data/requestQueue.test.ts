import { describe, expect, it } from 'vitest';
import { ApiError, type ErrorCode } from '../providers/errors';
import { createRequestQueue } from './requestQueue';

/** Fake clock: sleep() registers a timer; settle() flushes microtasks and jumps time to the next timer. */
function fakeClock() {
  let t = 0;
  const timers: Array<{ at: number; resolve: () => void }> = [];
  const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  return {
    now: () => t,
    sleep: (ms: number) =>
      new Promise<void>((resolve) => {
        timers.push({ at: t + ms, resolve });
      }),
    async settle() {
      await flush();
      while (timers.length) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers.shift()!;
        t = Math.max(t, next.at);
        next.resolve();
        await flush();
      }
    },
  };
}

const err = (code: ErrorCode, extra: { status?: number; retryAfterMs?: number } = {}) =>
  new ApiError(code, undefined, extra);

describe('createRequestQueue', () => {
  it('paces a group at exactly its rate without bursting', async () => {
    const c = fakeClock();
    const q = createRequestQueue({ ratesPerSec: { kis: 4 }, now: c.now, sleep: c.sleep });
    const starts: number[] = [];
    const ps = Array.from({ length: 10 }, (_, i) =>
      q.run('kis', `k${i}`, 0, async () => {
        starts.push(c.now());
        return i;
      }),
    );
    await c.settle();
    expect(await Promise.all(ps)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(starts).toHaveLength(10);
    expect(starts[9] - starts[0]).toBeGreaterThanOrEqual(2250);
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(250);
  });

  it('paces groups independently', async () => {
    const c = fakeClock();
    const q = createRequestQueue({ ratesPerSec: { kis: 1, toss: 1 }, now: c.now, sleep: c.sleep });
    const starts: Record<string, number[]> = { kis: [], toss: [] };
    const run = (g: 'kis' | 'toss', k: string) => q.run(g, k, 0, async () => void starts[g].push(c.now()));
    const ps = [run('kis', 'a'), run('kis', 'b'), run('toss', 'a'), run('toss', 'b')];
    await c.settle();
    await Promise.all(ps);
    expect(starts.kis).toEqual([0, 1000]);
    expect(starts.toss).toEqual([0, 1000]);
  });

  it('starts lower priority numbers first among waiting tasks, FIFO within a priority', async () => {
    const c = fakeClock();
    const q = createRequestQueue({ ratesPerSec: { kis: 1 }, now: c.now, sleep: c.sleep });
    const order: string[] = [];
    const run = (key: string, p: 0 | 1 | 2) => q.run('kis', key, p, async () => void order.push(key));
    const ps = [run('first', 2), run('p2a', 2), run('p1', 1), run('p2b', 2), run('p0', 0)];
    await c.settle();
    await Promise.all(ps);
    // 'first' starts immediately (nothing else waiting yet is not guaranteed), the rest by priority
    expect(order.slice(1)).toEqual(['p0', 'p1', 'p2a', 'p2b']);
    expect(order[0]).toBe('first');
  });

  it('shares one execution among concurrent callers with the same key', async () => {
    const c = fakeClock();
    const q = createRequestQueue({ ratesPerSec: { kis: 5 }, now: c.now, sleep: c.sleep });
    let runs = 0;
    const task = async () => {
      runs++;
      return { v: 1 };
    };
    const a = q.run('kis', 'same', 0, task);
    const b = q.run('kis', 'same', 1, task);
    await c.settle();
    const [ra, rb] = await Promise.all([a, b]);
    expect(runs).toBe(1);
    expect(ra).toBe(rb);
    // after completion the key is free again
    const again = q.run('kis', 'same', 0, task);
    await c.settle();
    await again;
    expect(runs).toBe(2);
  });

  it('shares a rejection among callers with the same key', async () => {
    const c = fakeClock();
    const q = createRequestQueue({ ratesPerSec: { kis: 5 }, now: c.now, sleep: c.sleep });
    let runs = 0;
    const task = async () => {
      runs++;
      throw err('invalid-credentials', { status: 401 });
    };
    const a = q.run('kis', 'same', 0, task).catch((e) => e);
    const b = q.run('kis', 'same', 0, task).catch((e) => e);
    await c.settle();
    const [ea, eb] = await Promise.all([a, b]);
    expect(runs).toBe(1);
    expect(ea).toBe(eb);
    expect(ea.code).toBe('invalid-credentials');
  });

  it('waits retryAfterMs on rate-limited, then retries', async () => {
    const c = fakeClock();
    const q = createRequestQueue({ ratesPerSec: { kis: 100 }, now: c.now, sleep: c.sleep });
    const starts: number[] = [];
    const p = q.run('kis', 'k', 0, async () => {
      starts.push(c.now());
      if (starts.length === 1) throw err('rate-limited', { status: 429, retryAfterMs: 2000 });
      return 'ok';
    });
    await c.settle();
    expect(await p).toBe('ok');
    expect(starts).toHaveLength(2);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(2000);
  });

  it('waits 1000 ms on rate-limited without retryAfterMs', async () => {
    const c = fakeClock();
    const q = createRequestQueue({ ratesPerSec: { kis: 100 }, now: c.now, sleep: c.sleep });
    const starts: number[] = [];
    const p = q.run('kis', 'k', 0, async () => {
      starts.push(c.now());
      if (starts.length === 1) throw err('rate-limited', { status: 429 });
      return 'ok';
    });
    await c.settle();
    await p;
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1000);
  });

  it('retries upstream failures with 500/1000/2000 ms backoff, 4 attempts total, then throws', async () => {
    const c = fakeClock();
    const q = createRequestQueue({ ratesPerSec: { kis: 100 }, now: c.now, sleep: c.sleep });
    const starts: number[] = [];
    const p = q.run('kis', 'k', 0, async () => {
      starts.push(c.now());
      throw err('upstream', { status: 503 });
    });
    const result = p.catch((e) => e);
    await c.settle();
    const e = await result;
    expect(e).toBeInstanceOf(ApiError);
    expect(e.code).toBe('upstream');
    expect(starts).toHaveLength(4);
    const gaps = starts.slice(1).map((s, i) => s - starts[i]);
    expect(gaps[0]).toBeGreaterThanOrEqual(500);
    expect(gaps[1]).toBeGreaterThanOrEqual(1000);
    expect(gaps[2]).toBeGreaterThanOrEqual(2000);
  });

  it('retries timeouts and ApiError upstream without status', async () => {
    const c = fakeClock();
    const q = createRequestQueue({ ratesPerSec: { kis: 100 }, now: c.now, sleep: c.sleep });
    let n = 0;
    const p = q.run('kis', 'k', 0, async () => {
      n++;
      if (n === 1) throw err('timeout');
      if (n === 2) throw err('upstream');
      return n;
    });
    await c.settle();
    expect(await p).toBe(3);
  });

  it.each<[string, () => unknown]>([
    ['invalid-credentials', () => err('invalid-credentials', { status: 401 })],
    ['upstream 4xx', () => err('upstream', { status: 404 })],
    ['cors-blocked', () => err('cors-blocked')],
    ['plain Error', () => new Error('boom')],
  ])('does not retry %s', async (_n, make) => {
    const c = fakeClock();
    const q = createRequestQueue({ ratesPerSec: { kis: 100 }, now: c.now, sleep: c.sleep });
    let n = 0;
    const p = q
      .run('kis', 'k', 0, async () => {
        n++;
        throw make();
      })
      .catch((e) => e);
    await c.settle();
    await p;
    expect(n).toBe(1);
  });

  it('rejects an unknown group', async () => {
    const c = fakeClock();
    const q = createRequestQueue({ ratesPerSec: { kis: 4 }, now: c.now, sleep: c.sleep });
    await expect(q.run('nope', 'k', 0, async () => 1)).rejects.toThrow(Error);
  });
});
