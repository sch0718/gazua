import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CliError } from './errors';
import { createFileLock, LOCK_RETRY_MS, LOCK_WAIT_MS, processGone } from './fileLock';
import { cleanupDirs, tempDir } from './testing';

afterEach(cleanupDirs);
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const lockPath = (dir: string) => join(dir, 'toss.lock');
const body = (dir: string) => JSON.parse(readFileSync(lockPath(dir), 'utf8')) as { pid: number; hostname: string; nonce: string; createdAt: number };
const writeLock = (dir: string, o: { pid: unknown; hostname?: string; nonce?: string }) =>
  writeFileSync(lockPath(dir), JSON.stringify({ pid: o.pid, hostname: o.hostname ?? 'host-a', nonce: o.nonce ?? 'old', createdAt: 0 }));
const busy = (e: unknown) => e instanceof CliError && e.code === 'token-busy';
const base = { name: 'toss' as const, hostname: () => 'host-a', retryMs: 10 };

describe('상수', () => {
  it('재시도 200ms, 대기 상한 30초', () => {
    expect([LOCK_RETRY_MS, LOCK_WAIT_MS]).toEqual([200, 30_000]);
  });
});

describe('processGone', () => {
  it('없는 pid(ESRCH)만 true, 살아 있는 pid(자기 자신)는 false', () => {
    expect(processGone(process.pid)).toBe(false);
    expect(processGone(2_147_483_646)).toBe(true);
  });
});

describe('createFileLock', () => {
  it('겹치면 하나씩 실행하고 끝나면 잠금 파일이 없다(안에 pid·hostname·nonce·시각이 있다)', async () => {
    const dir = tempDir();
    let active = 0;
    let max = 0;
    let seen: ReturnType<typeof body> | null = null;
    const job = async () => {
      active++;
      max = Math.max(max, active);
      seen ??= body(dir);
      await wait(30);
      active--;
    };
    const mk = () => createFileLock({ dir, ...base, waitMs: 5000 });
    await Promise.all([mk()(job), mk()(job), mk()(job)]);
    expect(max).toBe(1);
    expect(seen).toMatchObject({ pid: process.pid, hostname: 'host-a', nonce: expect.stringMatching(/^[0-9a-f]{16}$/), createdAt: expect.any(Number) });
    expect(existsSync(lockPath(dir))).toBe(false);
  });

  it('fn이 던져도 잠금을 푼다', async () => {
    const dir = tempDir();
    await expect(createFileLock({ dir, ...base })(async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(existsSync(lockPath(dir))).toBe(false);
  });

  it('해제는 자기 nonce일 때만 지운다: 그 사이 남의 잠금으로 바뀌었으면 그대로 둔다', async () => {
    const dir = tempDir();
    await createFileLock({ dir, ...base })(async () => {
      writeLock(dir, { pid: 4242, nonce: 'someone-else' });
    });
    expect(body(dir).nonce).toBe('someone-else');
  });

  it('같은 host에서 pid가 없는(ESRCH) 잠금만 회수한다', async () => {
    const dir = tempDir();
    writeLock(dir, { pid: 2_147_483_646 });
    expect(await createFileLock({ dir, ...base, waitMs: 1000 })(async () => 'ran')).toBe('ran');
    expect(existsSync(lockPath(dir))).toBe(false);
  });

  it('깨진 내용의 잠금은 회수하지 않는다 → 대기 상한 뒤 token-busy', async () => {
    const dir = tempDir();
    writeFileSync(lockPath(dir), '{');
    await expect(createFileLock({ dir, ...base, waitMs: 100 })(async () => 'never')).rejects.toSatisfy(busy);
    expect(readFileSync(lockPath(dir), 'utf8')).toBe('{');
  });

  it.each([0, -1, 1.5, '4242', null])('pid가 잘못된 잠금(%s)은 프로세스 검사·회수를 하지 않는다', async (pid) => {
    const dir = tempDir();
    writeLock(dir, { pid });
    let checked = false;
    await expect(createFileLock({
      dir,
      ...base,
      waitMs: 20,
      isGone: () => { checked = true; return true; },
    })(async () => 'never')).rejects.toSatisfy(busy);
    expect(checked).toBe(false);
    expect(body(dir).nonce).toBe('old');
  });

  it('pid가 살아 있으면 얼마나 오래됐든 회수하지 않고, 대기 상한 뒤 token-busy', async () => {
    const dir = tempDir();
    writeLock(dir, { pid: process.pid });
    const started = Date.now();
    await expect(createFileLock({ dir, ...base, waitMs: 300 })(async () => 'never')).rejects.toSatisfy(busy);
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    expect(body(dir)).toMatchObject({ pid: process.pid, nonce: 'old' });
  });

  it('다른 host의 잠금은 pid가 없어 보여도 회수하지 않는다', async () => {
    const dir = tempDir();
    writeLock(dir, { pid: 2_147_483_646, hostname: 'other-host' });
    await expect(createFileLock({ dir, ...base, waitMs: 100 })(async () => 'never')).rejects.toSatisfy(busy);
    expect(body(dir)).toMatchObject({ hostname: 'other-host', nonce: 'old' });
  });

  it('회수 직전에 다시 읽어 nonce가 달라졌으면 지우지 않는다', async () => {
    const dir = tempDir();
    writeLock(dir, { pid: 2_147_483_646 });
    const lock = createFileLock({
      dir,
      ...base,
      waitMs: 150,
      beforeUnlink: async () => writeLock(dir, { pid: process.pid, nonce: 'new' }),
    });
    await expect(lock(async () => 'never')).rejects.toSatisfy(busy);
    expect(body(dir)).toMatchObject({ pid: process.pid, nonce: 'new' });
  });

  it('kis와 toss는 서로 다른 잠금 파일을 쓴다', async () => {
    const dir = tempDir();
    const kis = createFileLock({ dir, ...base, name: 'kis', waitMs: 100 });
    const toss = createFileLock({ dir, ...base, waitMs: 100 });
    expect(await kis(async () => toss(async () => existsSync(join(dir, 'kis.lock')) && existsSync(join(dir, 'toss.lock'))))).toBe(true);
  });
});
