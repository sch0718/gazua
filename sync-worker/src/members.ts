// 초대 링크 가입(설계 2026-11-03-invite-signup). 공용 초대 코드 하나(INVITE_CODE)로 멤버가 되고, 관리자는 고정 허용 목록 계정이다.
// 멤버 판정은 @sch0718/firebase-session의 isAllowed로 매 요청 다시 본다. 코드 원문은 저장하지 않는다.
import { HttpError, parseAccountList, parseAllowList, type AuthContext, type SessionAuthOptions } from '@sch0718/firebase-session/worker';
import type { SyncDeps, SyncEnv } from './env';

/** 이보다 짧은 INVITE_CODE는 초대를 닫은 것으로 본다. 추측을 막는 진짜 방어선은 이 길이다(base64url 32자 = 192비트). */
export const INVITE_MIN = 32;
/** 계정당 시도 제한(덧댄 장치). 넘으면 맞는 코드여도 429 */
export const ATTEMPT_LIMIT = 5;
export const ATTEMPT_WINDOW = 60 * 60 * 1000;
export const DEFAULT_MEMBER_LIMIT = 20;

export function memberLimit(env: SyncEnv): number {
  const n = Number(env.MEMBER_LIMIT);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MEMBER_LIMIT;
}

const sha256 = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

/** 상수 시간 비교: 길이가 같은 해시를 바이트마다 XOR로 모은다 */
export async function codeMatches(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** 고정 목록(ALLOWED_EMAILS·ALLOWED_ACCOUNTS)에 있는 계정만 관리자다. 멤버는 관리자가 아니다. */
export function isAdmin(env: SyncEnv, user: AuthContext['user']): boolean {
  if (user.provider) return parseAccountList(env.ALLOWED_ACCOUNTS).has(user.sub);
  return user.email !== '' && parseAllowList(env.ALLOWED_EMAILS).has(user.email.toLowerCase());
}

export async function isActiveMember(env: SyncEnv, identity: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT 1 AS ok FROM members WHERE identity = ? AND removed_at IS NULL').bind(identity).first<{ ok: number }>();
  return row !== null;
}

/** 패키지 isAllowed: 고정 목록에 없는 계정이 멤버인지, 가입 요청이면 초대 코드로 멤버가 되는지 본다 */
export const allowMember =
  (env: SyncEnv, deps: SyncDeps): NonNullable<SessionAuthOptions['isAllowed']> =>
  async ({ identity }, signup) => {
    if (await isActiveMember(env, identity)) return true;
    const body = signup?.body;
    const invite = body && typeof body === 'object' ? (body as { invite?: unknown }).invite : undefined;
    if (typeof invite !== 'string') return false;
    const db = env.DB;
    const removed = await db.prepare('SELECT 1 AS ok FROM members WHERE identity = ?').bind(identity).first<{ ok: number }>();
    if (removed) return false; // 내보낸 사람은 코드를 알아도 다시 들어오지 못한다
    const now = deps.now();
    // 적고 나서 센다. 동시 요청도 각자 자기 순번(rowid)까지만 세므로 제한을 넘지 못한다
    const mine = await db.prepare('INSERT INTO invite_attempts (identity, at) VALUES (?, ?) RETURNING rowid AS id').bind(identity, now).first<{ id: number }>();
    const seen = await db
      .prepare('SELECT count(*) AS n FROM invite_attempts WHERE identity = ? AND at > ? AND rowid <= ?')
      .bind(identity, now - ATTEMPT_WINDOW, mine!.id)
      .first<{ n: number }>();
    if (seen!.n > ATTEMPT_LIMIT) throw new HttpError(429, 'invite-limit');
    const code = env.INVITE_CODE ?? '';
    if (code.length < INVITE_MIN || !(await codeMatches(invite, code))) throw new HttpError(403, 'invite-invalid');
    // 상한 검사와 넣기를 한 문장으로 한다(SQLite가 문장 단위로 직렬화하므로 동시 가입도 상한을 넘지 못한다)
    const r = await db
      .prepare(
        `INSERT INTO members (identity, joined_at) SELECT ?, ? WHERE (SELECT count(*) FROM members WHERE removed_at IS NULL) < ?
         ON CONFLICT (identity) DO NOTHING`,
      )
      .bind(identity, now, memberLimit(env))
      .run();
    if (r.meta.changes === 0 && !(await isActiveMember(env, identity))) throw new HttpError(403, 'members-full');
    await db.prepare('DELETE FROM invite_attempts WHERE identity = ?').bind(identity).run();
    return true;
  };

function requireAdmin(env: SyncEnv, ctx: AuthContext): void {
  if (!isAdmin(env, ctx.user)) throw new HttpError(403, 'not-admin');
}

export async function listMembers(env: SyncEnv, ctx: AuthContext): Promise<{ members: { identity: string; joinedAt: number }[]; limit: number }> {
  requireAdmin(env, ctx);
  const { results } = await env.DB.prepare('SELECT identity, joined_at AS joinedAt FROM members WHERE removed_at IS NULL ORDER BY joined_at, identity').all<{
    identity: string;
    joinedAt: number;
  }>();
  return { members: results, limit: memberLimit(env) };
}

/** 내보내기: 멤버에서 빼고 그 계정의 기기 세션과 CLI 토큰을 모두 철회한다(매 요청 재확인과 별개로 바로 끊는다) */
export async function removeMember(env: SyncEnv, deps: SyncDeps, ctx: AuthContext, identity: string): Promise<{ removed: true }> {
  requireAdmin(env, ctx);
  const db = env.DB;
  const now = deps.now();
  // Google 사용자는 users.email, 소셜 사용자는 users.firebase_sub('kakao:<sub>')가 identity다
  const users = `SELECT id FROM users WHERE firebase_sub = ?1 OR (email = ?1 AND firebase_sub NOT LIKE '%:%')`;
  const [r] = await db.batch([
    db.prepare('UPDATE members SET removed_at = ? WHERE identity = ? AND removed_at IS NULL').bind(now, identity),
    db.prepare(`UPDATE sessions SET revoked_at = ?2 WHERE revoked_at IS NULL AND user_id IN (${users})`).bind(identity, now),
    db.prepare(`UPDATE cli_tokens SET revoked_at = ?2 WHERE revoked_at IS NULL AND user_id IN (${users})`).bind(identity, now),
  ]);
  if (r.meta.changes === 0) throw new HttpError(404, 'not-found');
  return { removed: true };
}

/** 하루 지난 초대 시도 기록을 지운다 */
export async function purgeInviteAttempts(env: SyncEnv, now: number, limit: number): Promise<number> {
  const r = await env.DB.prepare('DELETE FROM invite_attempts WHERE rowid IN (SELECT rowid FROM invite_attempts WHERE at <= ? LIMIT ?)')
    .bind(now - 24 * 60 * 60 * 1000, limit)
    .run();
  return r.meta.changes;
}
