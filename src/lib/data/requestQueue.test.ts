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

  it('pauses the whole group after a 429, and leaves other groups alone', async () => {
    const c = fakeClock();
    const q = createRequestQueue({ ratesPerSec: { kis: 100, toss: 100 }, now: c.now, sleep: c.sleep });
    const starts: Record<string, number> = {};
    let aRuns = 0;
    const ps = [
      q.run('kis', 'a', 0, async () => {
        if (++aRuns === 1) throw err('rate-limited', { status: 429, retryAfterMs: 3000 });
        return 'a';
      }),
      q.run('kis', 'b', 0, async () => void (starts.b = c.now())),
      q.run('toss', 'c', 0, async () => void (starts.c = c.now())),
    ];
    await c.settle();
    await Promise.all(ps);
    expect(starts.b).toBeGreaterThanOrEqual(3000);
    expect(starts.c).toBeLessThan(1000);
  });

  it('a 429 that exhausted its retries still pauses the group', async () => {
    const c = fakeClock();
    const q = createRequestQueue({ ratesPerSec: { kis: 100 }, now: c.now, sleep: c.sleep });
    let aRuns = 0;
    let lastAt = -1;
    const a = q
      .run('kis', 'a', 0, async () => {
        lastAt = c.now();
        // 재시도(3번)를 다 쓴 마지막 시도도 429다
        throw err('rate-limited', { status: 429, retryAfterMs: ++aRuns < 4 ? 1 : 5000 });
      })
      .catch((e) => e);
    await c.settle();
    expect((await a).code).toBe('rate-limited');
    expect(aRuns).toBe(4);
    let bStart = -1;
    const b = q.run('kis', 'b', 0, async () => void (bStart = c.now()));
    await c.settle();
    await b;
    // 마지막 429의 Retry-After(5000ms)만큼 그룹이 쉰 뒤에야 다음 요청이 시작한다
    expect(bStart).toBeGreaterThanOrEqual(lastAt + 5000);
  });

  // 같은 그룹의 요청 둘이 이미 나간 상태에서 잇달아 429를 받는다. 나중에 온 429가 더 짧아도 그룹 정지는 가장 늦은 시각을 따른다.
  it.each([
    { name: '긴 정지 뒤에 짧은 정지가 와도 줄어들지 않아요', first: 5000, second: 1000 },
    { name: '짧은 정지 뒤에 긴 정지가 오면 늘어나요', first: 1000, second: 5000 },
  ])('successive 429s in one group: $name', async ({ first, second }) => {
    const c = fakeClock();
    const q = createRequestQueue({ ratesPerSec: { kis: 100 }, now: c.now, sleep: c.sleep });
    const gates: Array<() => void> = [];
    const delays = [first, second];
    const runs = { a: 0, b: 0 };
    const starts: number[] = [];
    const flight = (id: 'a' | 'b', order: number) =>
      q.run('kis', id, 0, async () => {
        starts.push(c.now());
        if (++runs[id] > 1) return id;
        await new Promise<void>((r) => (gates[order] = r));
        throw err('rate-limited', { status: 429, retryAfterMs: delays[order] });
      });
    const pa = flight('a', 0);
    const pb = flight('b', 1);
    await c.settle(); // 둘 다 시작했고 아직 응답을 기다린다
    const t = c.now();
    gates[0]();
    gates[1]();
    let cStart = -1;
    const pc = q.run('kis', 'c', 0, async () => void (cStart = c.now()));
    await c.settle();
    await Promise.all([pa, pb, pc]);
    expect(cStart).toBeGreaterThanOrEqual(t + Math.max(first, second));
    // 재시도도 그 시각 전에는 나가지 않는다 (처음 두 번의 시작 뒤 모든 시작)
    for (const at of starts.slice(2)) expect(at).toBeGreaterThanOrEqual(t + Math.max(first, second));
  });

  // 두 429가 다른 시각에 온다: 첫 번째(t)는 5000ms, 500ms 뒤의 두 번째는 1000ms. 정지는 t+5000 전에 풀리지 않는다.
  it('successive 429s at different times: a shorter later pause does not release the group early', async () => {
    const c = fakeClock();
    const q = createRequestQueue({ ratesPerSec: { kis: 100 }, now: c.now, sleep: c.sleep });
    const starts: number[] = [];
    const runs = { a: 0, b: 0 };
    let t = -1;
    const flight = (id: 'a' | 'b', respondAfter: number, retryAfterMs: number) =>
      q.run('kis', id, 0, async () => {
        starts.push(c.now());
        if (++runs[id] > 1) return id;
        await c.sleep(respondAfter);
        if (id === 'a') t = c.now();
        throw err('rate-limited', { status: 429, retryAfterMs });
      });
    const pa = flight('a', 100, 5000);
    const pb = flight('b', 600, 1000);
    // 두 번째 429(t+500)가 처리된 뒤에 들어온 요청
    let cStart = -1;
    const pc = c.sleep(700).then(() => q.run('kis', 'c', 0, async () => void (cStart = c.now())));
    await c.settle();
    await Promise.all([pa, pb, pc]);
    expect(t).toBe(100);
    expect(cStart).toBeGreaterThanOrEqual(t + 5000);
    // 처음 두 번의 시작 뒤 모든 시작(재시도 포함)
    for (const at of starts.slice(2)) expect(at).toBeGreaterThanOrEqual(t + 5000);
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
