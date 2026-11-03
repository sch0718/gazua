// 테스트용 D1: node:sqlite 위에 이 Worker가 쓰는 D1 API(prepare/bind/first/all/run/batch)를 흉내 낸다.
// 실제 D1과 같게 batch는 한 트랜잭션이고 하나라도 실패하면 전부 되돌린다. 마이그레이션 SQL을 그대로 적용한다.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { D1Database, D1PreparedStatement, D1Result } from '@sch0718/firebase-session/worker';

const MIGRATIONS = join(import.meta.dirname, '..', 'migrations');
const RETURNS_ROWS = /^\s*(select|with)\b|\breturning\b/i;

class Stmt implements D1PreparedStatement {
  constructor(
    private db: DatabaseSync,
    readonly sql: string,
    readonly values: unknown[] = [],
    private gate: () => Promise<void> = async () => {},
  ) {}
  bind(...values: unknown[]): D1PreparedStatement {
    for (const v of values) if (v === undefined || typeof v === 'boolean') throw new TypeError(`D1 bind: ${typeof v}`);
    return new Stmt(this.db, this.sql, values, this.gate);
  }
  exec(): D1Result {
    const s = this.db.prepare(this.sql);
    const params = this.values as (string | number | null)[];
    if (RETURNS_ROWS.test(this.sql)) {
      const rows = s.all(...params) as Record<string, unknown>[];
      return { results: rows.map((r) => ({ ...r })), success: true, meta: { changes: 0 } };
    }
    const r = s.run(...params);
    return { results: [], success: true, meta: { changes: Number(r.changes) } };
  }
  async first<T>(): Promise<T | null> {
    await this.gate();
    return (this.exec().results[0] as T | undefined) ?? null;
  }
  async all<T>(): Promise<D1Result<T>> {
    await this.gate();
    return this.exec() as D1Result<T>;
  }
  async run(): Promise<D1Result> {
    await this.gate();
    return this.exec();
  }
}

export interface TestD1 extends D1Database {
  raw: DatabaseSync;
  /** 다음 batch를 n번째 문장에서 실패시킨다(롤백 확인용). */
  failNextBatchAt(n: number): void;
  /** 참이면 문장마다 매크로태스크로 양보해 동시 요청이 문장 사이에서 엇갈리게 한다(경쟁 조건 시험용). */
  interleave: boolean;
}

export function createTestD1(): TestD1 {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()) {
    raw.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  let failAt: number | null = null;
  const db: TestD1 = {
    raw,
    interleave: false,
    failNextBatchAt(n) {
      failAt = n;
    },
    prepare: (sql) => new Stmt(raw, sql, [], () => (db.interleave ? new Promise((r) => setTimeout(r, 0)) : Promise.resolve())),
    async batch(statements) {
      const at = failAt;
      failAt = null;
      raw.exec('BEGIN');
      try {
        const out = statements.map((s, i) => {
          if (i === at) throw new Error('injected batch failure');
          return (s as Stmt).exec();
        });
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return db;
}
