// 테스트 전용 도우미. main.ts가 import하지 않으므로 번들에 들어가지 않는다.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200, headers: { 'content-type': 'application/json', ...reply.headers } });
  }) as typeof fetch;
  return Object.assign(f, { calls });
}
