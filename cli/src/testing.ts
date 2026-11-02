// 테스트 전용 도우미. main.ts가 import하지 않으므로 번들에 들어가지 않는다.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newStrategyV1 } from '../../src/lib/sim/strategyV1';
import { fullStrategyV2 } from '../../src/lib/sim/testStrategyV2';
import type { Io } from './context';

const dirs: string[] = [];
export function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'gazua-cli-test-'));
  dirs.push(d);
  return d;
}
export function cleanupDirs(): void {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
}

export function makeIo(o: { env?: Record<string, string | undefined>; fetch?: typeof fetch; dir?: string; now?: number } = {}) {
  const dir = o.dir ?? tempDir();
  const clock = { now: o.now ?? Date.UTC(2026, 10, 2, 3, 0, 0) };
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    stdout: (s) => void out.push(s),
    stderr: (s) => void err.push(s),
    env: o.env ?? {},
    fetch: o.fetch ?? ((async () => {
      throw new TypeError('테스트에는 네트워크가 없어요');
    }) as typeof fetch),
    now: () => clock.now,
    sleep: async (ms) => {
      clock.now += ms;
    },
    hostname: () => 'testhost',
    dir,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { io, out, err, clock, dir, result: (): any => JSON.parse(out.join('')) };
}

export interface FakeCall {
  method: string;
  url: URL;
  headers: Headers;
  /** JSON 본문은 파싱해서, 그 밖(폼)은 문자열 그대로 */
  body: unknown;
}
export type FakeReply = { status?: number; body?: unknown; headers?: Record<string, string> } | Error;

export function fakeFetch(handler: (call: FakeCall) => FakeReply | undefined | Promise<FakeReply | undefined>): typeof fetch & { calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = init?.body;
    let body: unknown = raw ?? undefined;
    if (typeof raw === 'string') {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }
    const call: FakeCall = { method: init?.method ?? 'GET', url: new URL(String(input)), headers: new Headers(init?.headers), body };
    calls.push(call);
    const r = await handler(call);
    if (r instanceof Error) throw r;
    const reply = r ?? { status: 404, body: { error: 'unrouted' } };
    const status = reply.status ?? 200;
    // 204·205는 본문이 있으면 Response가 던진다
    const payload = status === 204 || status === 205 ? null : JSON.stringify(reply.body ?? {});
    return new Response(payload, { status, headers: { 'content-type': 'application/json', ...reply.headers } });
  }) as typeof fetch;
  return Object.assign(f, { calls });
}

/** 서버가 돌려주는 프로필 문서 모양(v1 또는 v2). 그룹 g0에 005930·000660, 전략 하나 */
export function profileDoc(v: 1 | 2, name = '내 프로필'): Record<string, unknown> {
  return {
    v,
    name,
    settings: { period: { unit: 'D', n: 1 }, metric: 'change', benchmark: 'AUTO', perfBenchmark: null, colorConvention: 'kr', boardOrder: 'value' },
    watchlists: {
      groups: [
        {
          id: 'g0',
          name: '반도체',
          items: [
            { symbol: '005930', colorSlot: 1, hidden: false, addedAt: 1 },
            { symbol: '000660', colorSlot: 2, hidden: true, addedAt: 1 },
          ],
        },
      ],
    },
    strategies: v === 1 ? [{ ...newStrategyV1(1, 'g0', '눌림목'), id: 's1' }] : [fullStrategyV2()],
    criteria: [],
    baskets: [],
  };
}

/** /v1/profiles와 /v1/profiles/:id?docVersion=2를 흉내 내는 가짜 동기화 서버 */
export function syncServer(profiles: Record<string, { doc: unknown; revision?: number; deleted?: boolean }>) {
  return fakeFetch((c) => {
    if (c.url.pathname === '/v1/profiles') {
      return {
        body: {
          profiles: Object.entries(profiles).map(([profileId, p]) => ({ profileId, revision: p.revision ?? 1, updatedAt: 1, deletedAt: p.deleted ? 5 : null, purgeAt: p.deleted ? 9 : null })),
        },
      };
    }
    const m = /^\/v1\/profiles\/([^/]+)$/.exec(c.url.pathname);
    if (m && c.url.searchParams.get('docVersion') === '2') {
      const p = profiles[decodeURIComponent(m[1])];
      return p ? { body: { revision: p.revision ?? 1, doc: p.doc } } : { status: 404, body: { error: 'not-found' } };
    }
    return undefined;
  });
}

/** validateMarketData를 통과하는 가장 작은 v1 시장 파일 */
export const tinyMarket = (o: Record<string, unknown> = {}) => ({
  format: 'gazua-market-data',
  version: 1,
  collectedAt: '2026-10-31T18:00:00+09:00',
  source: 'kis',
  adjusted: true,
  range: { from: '2026-10-30', to: '2026-10-31' },
  sectors: [],
  stocks: [{ s: '005930', n: '삼성전자', m: 'KOSPI', t: 'STOCK', sec: ['', '', ''], shares: 1, managed: false, halted: false, d: ['20261030', '20261031'], o: [1, 1], h: [1, 1], l: [1, 1], c: [1, 1], v: [1, 1], tv: [1, 1] }],
  indices: [],
  ...o,
});
