// 하루 한 번 Cron: 삭제 30일 지난 프로필의 본문·이력·공유·색인, 오래된 공유·세션을 지운다.
// 무료 쓰기 한도를 아끼려고 한 번에 지우는 양을 제한한다. 남은 것은 다음 날 이어서 지운다.
import { DAY, type SyncEnv } from './env';

export const PURGE_PROFILES_PER_RUN = 50;
export const PURGE_ROWS_PER_RUN = 500;
/** 만료·철회된 공유와 세션도 30일 뒤에 지운다(그동안은 목록에서 상태를 볼 수 있다). */
export const KEEP_AFTER_END = 30 * DAY;

export async function purge(env: SyncEnv, now: number): Promise<{ profiles: number; shares: number; sessions: number }> {
  const db = env.DB;
  const { results: due } = await db
    .prepare('SELECT user_id AS userId, profile_id AS profileId FROM profile_index WHERE purge_at IS NOT NULL AND purge_at <= ? LIMIT ?')
    .bind(now, PURGE_PROFILES_PER_RUN)
    .all<{ userId: string; profileId: string }>();
  // 그사이 복구됐으면 지우지 않도록 문장마다 다시 확인한다
  const STILL_DUE = 'EXISTS (SELECT 1 FROM profile_index WHERE user_id = ? AND profile_id = ? AND purge_at IS NOT NULL AND purge_at <= ?)';
  for (const p of due) {
    const k = [p.userId, p.profileId];
    const cond = [...k, now];
    await db.batch([
      db.prepare(`DELETE FROM profiles WHERE user_id = ? AND profile_id = ? AND ${STILL_DUE}`).bind(...k, ...cond),
      db.prepare(`DELETE FROM revisions WHERE user_id = ? AND profile_id = ? AND ${STILL_DUE}`).bind(...k, ...cond),
      db.prepare(`DELETE FROM shares WHERE user_id = ? AND source_profile_id = ? AND ${STILL_DUE}`).bind(...k, ...cond),
      db.prepare('DELETE FROM profile_index WHERE user_id = ? AND profile_id = ? AND purge_at IS NOT NULL AND purge_at <= ?').bind(...cond),
    ]);
  }
  const old = now - KEEP_AFTER_END;
  const shares = await db
    .prepare(
      `DELETE FROM shares WHERE id IN (SELECT id FROM shares WHERE expires_at <= ? OR (revoked_at IS NOT NULL AND revoked_at <= ?) LIMIT ?)`,
    )
    .bind(old, old, PURGE_ROWS_PER_RUN)
    .run();
  const sessions = await db
    .prepare(
      `DELETE FROM sessions WHERE id_hash IN (SELECT id_hash FROM sessions WHERE last_used_at <= ? OR (revoked_at IS NOT NULL AND revoked_at <= ?) LIMIT ?)`,
    )
    .bind(old - 30 * DAY, old, PURGE_ROWS_PER_RUN)
    .run();
  return { profiles: due.length, shares: shares.meta.changes, sessions: sessions.meta.changes };
}
