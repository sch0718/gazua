import { describe, expect, it } from 'vitest';
import { createTestD1 } from './d1';

describe('테스트용 D1', () => {
  it('마이그레이션으로 표를 만든다', async () => {
    const db = createTestD1();
    const { results } = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all<{ name: string }>();
    expect(results.map((r) => r.name)).toEqual(['profile_index', 'profiles', 'revisions', 'sessions', 'shares', 'users']);
  });

  it('batch는 하나가 실패하면 전부 되돌린다', async () => {
    const db = createTestD1();
    const ins = (id: string) =>
      db.prepare('INSERT INTO users (id, firebase_sub, email, created_at, last_seen_at) VALUES (?, ?, ?, 0, 0)').bind(id, id, 'a@example.test');
    db.failNextBatchAt(1);
    await expect(db.batch([ins('u1'), ins('u2')])).rejects.toThrow();
    expect(await db.prepare('SELECT count(*) AS n FROM users').first()).toEqual({ n: 0 });
    // 제약 위반도 같은 방식으로 되돌린다
    await expect(db.batch([ins('u3'), ins('u3')])).rejects.toThrow();
    expect(await db.prepare('SELECT count(*) AS n FROM users').first()).toEqual({ n: 0 });
  });

  it('run은 바뀐 행 수를 알려 준다', async () => {
    const db = createTestD1();
    await db.prepare("INSERT INTO users VALUES ('u', 's', 'e', 0, 0)").run();
    expect((await db.prepare("UPDATE users SET email = 'f' WHERE id = 'u'").run()).meta.changes).toBe(1);
    expect((await db.prepare("UPDATE users SET email = 'f' WHERE id = 'x'").run()).meta.changes).toBe(0);
  });
});
