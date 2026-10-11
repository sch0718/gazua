import { ApiError } from '../providers/errors';

/** 0 시세, 1 화면 차트, 2 미리 받기 */
export type Priority = 0 | 1 | 2;

export interface RequestQueue {
  run<T>(group: string, key: string, priority: Priority, task: () => Promise<T>): Promise<T>;
}

export interface RequestQueueConfig {
  /** Start rate per group, used as given (callers pass already-reduced rates). */
  ratesPerSec: Record<string, number>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const MAX_RETRIES = 3;
const BACKOFF_MS = [500, 1000, 2000];
const DEFAULT_RATE_LIMIT_WAIT_MS = 1000;

interface Entry {
  key: string;
  priority: Priority;
  seq: number;
  attempt: number;
  task: () => Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

interface GroupState {
  intervalMs: number;
  nextStart: number;
  waiting: Entry[];
  pumping: boolean;
}

/** How long to wait before retrying, or undefined if the error is not retryable. */
function retryDelay(e: unknown, attempt: number): number | undefined {
  if (attempt >= MAX_RETRIES || !(e instanceof ApiError)) return undefined;
  if (e.code === 'rate-limited') return e.retryAfterMs ?? DEFAULT_RATE_LIMIT_WAIT_MS;
  if (e.code === 'timeout' || (e.code === 'upstream' && (e.status === undefined || e.status >= 500))) {
    return BACKOFF_MS[attempt];
  }
  return undefined;
}

export function createRequestQueue(cfg: RequestQueueConfig): RequestQueue {
  const now = cfg.now ?? (() => Date.now());
  const sleep = cfg.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const groups = new Map<string, GroupState>();
  for (const [name, rate] of Object.entries(cfg.ratesPerSec)) {
    if (!(rate > 0) || !Number.isFinite(rate)) throw new Error(`invalid rate for group "${name}"`);
    groups.set(name, { intervalMs: 1000 / rate, nextStart: 0, waiting: [], pumping: false });
  }
  const inFlight = new Map<string, Promise<unknown>>();
  let seq = 0;

  function takeNext(g: GroupState): Entry {
    let best = 0;
    for (let i = 1; i < g.waiting.length; i++) {
      const a = g.waiting[i];
      const b = g.waiting[best];
      if (a.priority < b.priority || (a.priority === b.priority && a.seq < b.seq)) best = i;
    }
    return g.waiting.splice(best, 1)[0];
  }

  async function attemptEntry(g: GroupState, entry: Entry): Promise<void> {
    try {
      entry.resolve(await entry.task());
    } catch (e) {
      const delay = retryDelay(e, entry.attempt);
      if (delay === undefined) {
        entry.reject(e);
        return;
      }
      await sleep(delay);
      // Re-enter the queue so retries are paced and prioritised like any other start.
      entry.attempt++;
      entry.seq = seq++;
      g.waiting.push(entry);
      void pump(g);
    }
  }

  async function pump(g: GroupState): Promise<void> {
    if (g.pumping) return;
    g.pumping = true;
    try {
      while (g.waiting.length > 0) {
        const wait = g.nextStart - now();
        if (wait > 0) await sleep(wait);
        // Choose after waiting so a higher-priority arrival during the pause goes first.
        const entry = takeNext(g);
        g.nextStart = Math.max(now(), g.nextStart) + g.intervalMs;
        void attemptEntry(g, entry);
      }
    } finally {
      g.pumping = false;
    }
  }

  return {
    async run<T>(group: string, key: string, priority: Priority, task: () => Promise<T>): Promise<T> {
      const g = groups.get(group);
      if (!g) throw new Error(`unknown request group "${group}"`);

      const flightKey = `${group}\u0000${key}`;
      const existing = inFlight.get(flightKey);
      if (existing) return existing as Promise<T>;

      const promise = new Promise<T>((resolve, reject) => {
        g.waiting.push({
          key,
          priority,
          seq: seq++,
          attempt: 0,
          task,
          resolve: resolve as (v: unknown) => void,
          reject,
        });
      });
      inFlight.set(flightKey, promise);
      const clear = () => {
        if (inFlight.get(flightKey) === promise) inFlight.delete(flightKey);
      };
      promise.then(clear, clear);
      void pump(g);
      return promise;
    },
  };
}
