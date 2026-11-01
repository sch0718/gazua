// 공급자별 SQLite 쓰기 잠금. 프로세스가 종료되면 OS가 잠금을 해제하므로 회수가 필요 없다.
import { closeSync, fchmodSync, openSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { TokenLock } from '../../src/lib/providers/types';
import { ensureDir, FILE_MODE } from './config';
import { CliError } from './errors';

export const LOCK_WAIT_MS = 30_000;

export interface FileLockOptions {
  dir: string;
  name: 'kis' | 'toss';
  /** SQLite busy_timeout 및 같은 프로세스의 대기 상한(ms) */
  waitMs?: number;
}

// DatabaseSync의 대기가 이벤트 루프를 막아 보유자의 비동기 작업을 멈추지 않도록,
// 같은 프로세스에서는 DB를 열기 전에 기다린다. 인스턴스 사이에도 공유한다.
const active = new Map<string, Promise<void>>();

export function createFileLock(o: FileLockOptions): TokenLock {
  const path = resolve(o.dir, `${o.name}.lock.db`);
  const waitMs = o.waitMs ?? LOCK_WAIT_MS;

  return async (fn) => {
    const started = Date.now();
    for (let running = active.get(path); running; running = active.get(path)) {
      const remaining = waitMs - (Date.now() - started);
      if (remaining <= 0) throw new CliError('token-busy');
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new CliError('token-busy')), remaining);
        void running.then(() => { clearTimeout(timer); resolve(); });
      });
    }

    let release!: () => void;
    active.set(path, new Promise<void>((resolve) => { release = resolve; }));
    let db: DatabaseSync | undefined;
    try {
      ensureDir(o.dir);
      // SQLite로 열기 전에 600으로 만든다. 기존 DB도 권한을 맞추고 삭제·교체하지 않는다.
      const fd = openSync(path, 'a', FILE_MODE);
      try {
        fchmodSync(fd, FILE_MODE);
      } finally {
        closeSync(fd);
      }
      db = new DatabaseSync(path);
      db.exec(`PRAGMA busy_timeout = ${waitMs}`);
      try {
        db.exec('BEGIN IMMEDIATE');
      } catch (error) {
        if ((error as { errcode?: number }).errcode === 5) throw new CliError('token-busy'); // SQLITE_BUSY
        throw error;
      }
      try {
        const result = await fn();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    } finally {
      try {
        db?.close();
      } finally {
        active.delete(path);
        release();
      }
    }
  };
}
