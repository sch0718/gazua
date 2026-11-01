import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { afterEach, describe, expect, it } from 'vitest';
import { createFileLock, LOCK_WAIT_MS } from './fileLock';
import { cleanupDirs, tempDir } from './testing';

const children: { child: ChildProcess; exited: Promise<[number | null, NodeJS.Signals | null]> }[] = [];
afterEach(async () => {
  for (const { child } of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  await Promise.all(children.splice(0).map(({ exited }) => exited));
  cleanupDirs();
});

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const options = (dir: string, waitMs = 1000) => ({ dir, name: 'toss' as const, waitMs });
const lockPath = (dir: string) => join(dir, 'toss.lock.db');
const nextMessage = async (child: ChildProcess) => (await once(child, 'message', { signal: AbortSignal.timeout(5000) }))[0];

async function childLauncher(dir: string) {
  const outfile = join(dir, 'child.mjs');
  await build({
    entryPoints: [fileURLToPath(new URL('./fixtures/fileLockChild.ts', import.meta.url))],
    outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22.13', external: ['node:sqlite'],
  });
  return (mode: 'hold' | 'record') => {
    const child = fork(outfile, [dir, mode, join(dir, 'events.log')], { silent: true, execArgv: [] });
    let stderr = '';
    child.stderr?.on('data', (data) => { stderr += String(data); });
    const exited = new Promise<[number | null, NodeJS.Signals | null]>((resolve) => child.once('exit', (code, signal) => resolve([code, signal])));
    children.push({ child, exited });
    return { child, ready: nextMessage(child), exited, stderr: () => stderr };
  };
}

describe('SQLite TokenLock', () => {
  it('기본 대기 상한은 30초다', () => {
    expect(LOCK_WAIT_MS).toBe(30_000);
  });

  it('같은 프로세스의 두 번째 획득은 첫 해제까지 기다린다(서로 다른 인스턴스)', async () => {
    const dir = tempDir();
    const events: string[] = [];
    await Promise.all([
      createFileLock(options(dir))(async () => {
        events.push('first enter');
        await wait(30);
        events.push('first leave');
      }),
      createFileLock(options(dir))(async () => { events.push('second enter'); }),
    ]);
    expect(events).toEqual(['first enter', 'first leave', 'second enter']);
  });

  it('같은 프로세스에서 해제 전 대기 상한을 넘으면 token-busy, 해제 후에는 획득한다', async () => {
    const dir = tempDir();
    const second = createFileLock(options(dir, 50));
    let entered = false;
    await createFileLock(options(dir))(async () => {
      const started = Date.now();
      await expect(second(async () => { entered = true; })).rejects.toMatchObject({ code: 'token-busy' });
      expect(Date.now() - started).toBeGreaterThanOrEqual(40);
      expect(entered).toBe(false);
    });
    await expect(second(async () => 'released')).resolves.toBe('released');
  });

  it('실제 SQLite 쓰기 잠금을 유지하고 COMMIT 후 해제한다', async () => {
    const dir = tempDir();
    await createFileLock(options(dir))(async () => {
      const db = new DatabaseSync(lockPath(dir));
      try {
        db.exec('PRAGMA busy_timeout = 20');
        expect(() => db.exec('BEGIN IMMEDIATE')).toThrow(/locked/);
      } finally {
        db.close();
      }
    });
    const db = new DatabaseSync(lockPath(dir));
    try {
      db.exec('PRAGMA busy_timeout = 20; BEGIN IMMEDIATE; COMMIT');
    } finally {
      db.close();
    }
    expect(existsSync(lockPath(dir))).toBe(true); // DB 파일은 삭제하지 않는다
  });

  it('임계 구역이 던져도 ROLLBACK 후 다시 획득한다', async () => {
    const dir = tempDir();
    const lock = createFileLock(options(dir));
    const error = new Error('critical section failed');
    await expect(lock(async () => { throw error; })).rejects.toBe(error);
    await expect(lock(async () => 42)).resolves.toBe(42);
  });

  it('공급자별 잠금은 독립적이다', async () => {
    const dir = tempDir();
    await createFileLock({ ...options(dir), name: 'kis' })(async () => {
      await expect(createFileLock(options(dir))(async () => 'toss')).resolves.toBe('toss');
    });
    expect(existsSync(join(dir, 'kis.lock.db'))).toBe(true);
    expect(existsSync(lockPath(dir))).toBe(true);
  });

  it.skipIf(process.platform === 'win32')('DB 파일은 최초 생성과 재사용 모두 권한 600이다', async () => {
    const dir = tempDir();
    const lock = createFileLock(options(dir));
    await lock(async () => { expect(statSync(lockPath(dir)).mode & 0o777).toBe(0o600); });
    chmodSync(lockPath(dir), 0o644);
    await lock(async () => { expect(statSync(lockPath(dir)).mode & 0o777).toBe(0o600); });
  });

  it.each(['exit', 'SIGKILL'] as const)('자식이 잠금을 쥔 채 %s로 종료하면 회수 없이 즉시 획득한다', { timeout: 15_000 }, async (termination) => {
    const dir = tempDir();
    const launch = await childLauncher(dir);
    const holder = launch('hold');
    expect(await holder.ready).toBe('ready');
    const locked = nextMessage(holder.child);
    holder.child.send('start');
    expect(await locked).toBe('locked');

    // 살아 있는 자식의 쓰기 잠금은 부모도 획득할 수 없다.
    const contender = createFileLock(options(dir, 50));
    const started = Date.now();
    await expect(contender(async () => 'never')).rejects.toMatchObject({ code: 'token-busy' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(40);
    if (termination === 'exit') holder.child.send('exit');
    else holder.child.kill('SIGKILL');
    expect(await holder.exited, holder.stderr()).toEqual(termination === 'exit' ? [0, null] : [null, 'SIGKILL']);

    expect(existsSync(lockPath(dir))).toBe(true);
    // 짧은 상한 내에 획득해야 한다. 오래된 잠금의 유예 시간은 없다.
    await expect(contender(async () => 'acquired')).resolves.toBe('acquired');
  });

  it('동시에 출발한 여러 자식의 공유 파일 기록에 임계 구역 겹침이 없다', { timeout: 15_000 }, async () => {
    const dir = tempDir();
    const launch = await childLauncher(dir);
    const workers = Array.from({ length: 6 }, () => launch('record'));
    expect(await Promise.all(workers.map((w) => w.ready))).toEqual(Array(6).fill('ready'));
    for (const { child } of workers) child.send('start');
    for (const worker of workers) expect(await worker.exited, worker.stderr()).toEqual([0, null]);

    const events = readFileSync(join(dir, 'events.log'), 'utf8').trim().split('\n');
    expect(events).toHaveLength(6 * 4 * 2);
    const active = new Set<string>();
    let overlaps = 0;
    const entrants = new Set<string>();
    for (const event of events) {
      const [action, pid] = event.split(' ');
      if (action === 'enter') {
        if (active.size) overlaps++;
        active.add(pid);
        entrants.add(pid);
      } else {
        expect(action).toBe('leave');
        expect(active.delete(pid)).toBe(true);
      }
    }
    expect(entrants.size).toBe(6);
    expect(active.size).toBe(0);
    expect(overlaps).toBe(0);
  });
});
