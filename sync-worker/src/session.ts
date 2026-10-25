// D1 자체 세션: 기기별, 마지막 사용 후 30일 슬라이딩 만료, 기기별·전체 철회(사용자 결정 2026-10-25).
// 세션 원문은 기기에만 있고 D1에는 SHA-256 hex만 둔다. 매 요청에서 ID 토큰과 세션을 둘 다 검사한다.
import { AuthError, bearer, parseAllowList, verifyIdToken, type VerifiedUser } from './auth/verify';
import { DAY, type SyncDeps, type SyncEnv } from './env';
import { base64url, HttpError, sha256Hex } from './http';

export const SESSION_TTL = 30 * DAY;
/** last_used_at 갱신 간격. D1 쓰기를 아낀다. */
export const TOUCH_INTERVAL = 60 * 60 * 1000;
/** 새 세션은 방금 Google 로그인을 거친 토큰으로만 만든다(철회된 기기가 갱신 토큰만으로 돌아오지 못하게). */
export const REAUTH_WINDOW = 5 * 60 * 1000;
export const LABEL_MAX = 40;
export const SESSION_HEADER = 'X-Gazua-Session';

export interface AuthContext {
  userId: string;
  sessionHash: string;
  user: VerifiedUser;
}

/** 토큰 검증 + 허용 목록. 실패는 HttpError로 바꾼다. */
export async function verifiedUser(req: Request, env: SyncEnv, deps: SyncDeps): Promise<VerifiedUser> {
  const token = bearer(req);
  if (!token) throw new HttpError(401, 'missing-token');
  try {
    return await verifyIdToken(token, {
      projectId: env.FIREBASE_PROJECT_ID,
      certs: deps.certs,
      now: deps.now(),
      allowedEmails: parseAllowList(env.ALLOWED_EMAILS),
    });
  } catch (e) {
    if (e instanceof AuthError) throw new HttpError(e.code === 'not-allowed' ? 403 : 401, e.code);
    throw e;
  }
}

export function cleanLabel(v: unknown): string {
  const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
  return [...s].slice(0, LABEL_MAX).join('') || '이름 없는 기기';
}

/** POST /v1/session. 사용자를 만들거나 갱신하고 새 세션을 돌려준다. */
export async function createSession(req: Request, env: SyncEnv, deps: SyncDeps, body: unknown): Promise<{ sessionId: string; expiresAt: number }> {
  const user = await verifiedUser(req, env, deps);
  const now = deps.now();
  if (now - user.authTime > REAUTH_WINDOW) throw new HttpError(401, 'reauth-required');
  const label = cleanLabel(typeof body === 'object' && body !== null ? (body as { label?: unknown }).label : undefined);
  const row = await env.DB.prepare(
    `INSERT INTO users (id, firebase_sub, email, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (firebase_sub) DO UPDATE SET email = excluded.email, last_seen_at = excluded.last_seen_at
     RETURNING id`,
  )
    .bind(deps.uuid(), user.sub, user.email, now, now)
    .first<{ id: string }>();
  const sessionId = base64url(deps.random(32));
  await env.DB.prepare('INSERT INTO sessions (id_hash, user_id, label, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256Hex(sessionId), row!.id, label, now, now)
    .run();
  return { sessionId, expiresAt: now + SESSION_TTL };
}

/** 개인 API 공통 검사: 토큰·허용 목록·세션(같은 사용자, 철회·만료 아님). */
export async function authenticate(req: Request, env: SyncEnv, deps: SyncDeps): Promise<AuthContext> {
  const user = await verifiedUser(req, env, deps);
  const raw = req.headers.get(SESSION_HEADER);
  if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw)) throw new HttpError(401, 'no-session');
  const hash = await sha256Hex(raw);
  const row = await env.DB.prepare(
    `SELECT s.user_id AS userId, s.last_used_at AS lastUsedAt, s.revoked_at AS revokedAt
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id_hash = ? AND u.firebase_sub = ?`,
  )
    .bind(hash, user.sub)
    .first<{ userId: string; lastUsedAt: number; revokedAt: number | null }>();
  if (!row) throw new HttpError(401, 'no-session');
  if (row.revokedAt !== null) throw new HttpError(401, 'session-revoked');
  const now = deps.now();
  if (row.lastUsedAt + SESSION_TTL <= now) throw new HttpError(401, 'session-expired');
  if (now - row.lastUsedAt >= TOUCH_INTERVAL) {
    await env.DB.prepare('UPDATE sessions SET last_used_at = ? WHERE id_hash = ?').bind(now, hash).run();
  }
  return { userId: row.userId, sessionHash: hash, user };
}

export const publicSessionId = (hash: string) => hash.slice(0, 12);

export async function listSessions(env: SyncEnv, ctx: AuthContext, now: number) {
  const { results } = await env.DB.prepare(
    `SELECT id_hash AS hash, label, created_at AS createdAt, last_used_at AS lastUsedAt
     FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND last_used_at > ? ORDER BY last_used_at DESC`,
  )
    .bind(ctx.userId, now - SESSION_TTL)
    .all<{ hash: string; label: string; createdAt: number; lastUsedAt: number }>();
  return results.map((r) => ({
    id: publicSessionId(r.hash),
    label: r.label,
    createdAt: r.createdAt,
    lastUsedAt: r.lastUsedAt,
    expiresAt: r.lastUsedAt + SESSION_TTL,
    current: r.hash === ctx.sessionHash,
  }));
}

/** 기기 하나(공개 ID), 이 기기(current), 또는 이 기기를 뺀 전부(others)를 철회한다. */
export async function revokeSessions(env: SyncEnv, ctx: AuthContext, now: number, target: { id: string } | 'current' | 'others'): Promise<number> {
  const db = env.DB;
  let r;
  if (target === 'current') {
    r = await db.prepare('UPDATE sessions SET revoked_at = ? WHERE id_hash = ? AND revoked_at IS NULL').bind(now, ctx.sessionHash).run();
  } else if (target === 'others') {
    r = await db
      .prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id_hash <> ? AND revoked_at IS NULL')
      .bind(now, ctx.userId, ctx.sessionHash)
      .run();
  } else {
    if (!/^[0-9a-f]{12}$/.test(target.id)) throw new HttpError(404, 'not-found');
    r = await db
      .prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND substr(id_hash, 1, 12) = ? AND revoked_at IS NULL')
      .bind(now, ctx.userId, target.id)
      .run();
    if (r.meta.changes === 0) throw new HttpError(404, 'not-found');
  }
  return r.meta.changes;
}
