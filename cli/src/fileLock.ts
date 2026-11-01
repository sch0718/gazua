// 공급자별 토큰 발급을 파일 잠금으로 묶는다. 같은 host에서 pid가 없는 잠금만 회수한다.
// 시간 기준 회수·별도 회수 잠금은 두지 않는다. 지우기 직전에 nonce를 다시 확인한다.
import { randomBytes } from 'node:crypto';
import { open, readFile, rm } from 'node:fs/promises';
import { hostname as osHostname } from 'node:os';
import { join } from 'node:path';
import type { TokenLock } from '../../src/lib/providers/types';
import { ensureDir } from './config';
import { CliError } from './errors';

export const LOCK_RETRY_MS = 200;
export const LOCK_WAIT_MS = 30_000;

interface LockBody {
  pid: number;
  hostname: string;
  nonce: string;
  createdAt: number;
}

export interface FileLockOptions {
  dir: string;
  name: 'kis' | 'toss';
  pid?: number;
  hostname?: () => string;
  /** pid가 존재하지 않으면 true(기본: process.kill(pid, 0)이 ESRCH) */
  isGone?: (pid: number) => boolean;
  waitMs?: number;
  retryMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** 테스트용: 회수 직전에 nonce를 다시 읽기 전에 불린다 */
  beforeUnlink?: () => Promise<void>;
}

/** 프로세스가 없으면(ESRCH) true. 있거나 권한이 없으면(EPERM) false */
export function processGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

async function readBody(path: string): Promise<LockBody | null> {
  try {
    const b = JSON.parse(await readFile(path, 'utf8')) as Partial<LockBody>;
    return typeof b.pid === 'number' && Number.isInteger(b.pid) && b.pid > 0 && typeof b.hostname === 'string' && typeof b.nonce === 'string' ? (b as LockBody) : null;
  } catch {
    return null; // 없거나 깨진 잠금
  }
}

export function createFileLock(o: FileLockOptions): TokenLock {
  const path = join(o.dir, `${o.name}.lock`);
  const pid = o.pid ?? process.pid;
  const host = o.hostname ?? osHostname;
  const isGone = o.isGone ?? processGone;
  const waitMs = o.waitMs ?? LOCK_WAIT_MS;
  const retryMs = o.retryMs ?? LOCK_RETRY_MS;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = o.now ?? Date.now;

  async function create(nonce: string): Promise<boolean> {
    try {
      const fh = await open(path, 'wx', 0o600);
      try {
        await fh.writeFile(JSON.stringify({ pid, hostname: host(), nonce, createdAt: now() } satisfies LockBody));
      } finally {
        await fh.close();
      }
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw e;
    }
  }

  async function reclaimIfDead(): Promise<boolean> {
    const seen = await readBody(path);
    if (seen === null || seen.hostname !== host() || !isGone(seen.pid)) return false;
    await o.beforeUnlink?.();
    const again = await readBody(path);
    if (again?.nonce !== seen.nonce) return false;
    await rm(path, { force: true });
    return true;
  }

  async function acquire(nonce: string): Promise<void> {
    ensureDir(o.dir);
    const started = now();
    for (;;) {
      if (await create(nonce)) return;
      if (await reclaimIfDead()) continue;
      if (now() - started >= waitMs) throw new CliError('token-busy');
      await sleep(retryMs);
    }
  }

  return async (fn) => {
    const nonce = randomBytes(8).toString('hex');
    await acquire(nonce);
    try {
      return await fn();
    } finally {
      if ((await readBody(path))?.nonce === nonce) await rm(path, { force: true });
    }
  };
}
