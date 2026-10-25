// 읽기 전용 공유: 256비트 capability는 만들 때 한 번만 돌려주고 D1에는 SHA-256 hex만 둔다.
// 만료 기본 7일·최대 30일, 언제든 철회, 원본 프로필이 삭제되면 읽을 수 없다. 응답은 캐시하지 않는다.
import { checkShareSnapshot, SHARE_TTL_DEFAULT_DAYS, SHARE_TTL_MAX_DAYS } from '../../src/lib/share/snapshot';
import { DAY, type SyncDeps, type SyncEnv } from './env';
import { base64url, HttpError, isCapability, sha256Hex } from './http';
import { checkId } from './profiles';
import type { AuthContext } from './session';

export const MAX_ACTIVE_SHARES = 50;
export const SHARE_HEADER = 'X-Share-Token';

export async function createShare(env: SyncEnv, deps: SyncDeps, ctx: AuthContext, body: unknown) {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  for (const k of Object.keys(b))
    if (!['sourceProfileId', 'kind', 'snapshot', 'ttlDays'].includes(k)) throw new HttpError(422, 'unknown-field', { path: k });
  if (typeof b.sourceProfileId !== 'string') throw new HttpError(422, 'invalid', { path: 'sourceProfileId' });
  const profileId = checkId(b.sourceProfileId);
  const ttl = b.ttlDays === undefined ? SHARE_TTL_DEFAULT_DAYS : b.ttlDays;
  if (typeof ttl !== 'number' || !Number.isInteger(ttl) || ttl < 1 || ttl > SHARE_TTL_MAX_DAYS)
    throw new HttpError(422, 'invalid', { path: 'ttlDays' });
  const now = deps.now();
  const checked = checkShareSnapshot(b.snapshot, b.kind, now);
  if (!checked.ok) throw new HttpError(422, checked.code, checked.path ? { path: checked.path } : {});

  const src = await env.DB.prepare('SELECT deleted_at AS deletedAt FROM profile_index WHERE user_id = ? AND profile_id = ?')
    .bind(ctx.userId, profileId)
    .first<{ deletedAt: number | null }>();
  if (!src || src.deletedAt !== null) throw new HttpError(404, 'not-found');
  const active = await env.DB.prepare('SELECT count(*) AS n FROM shares WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?')
    .bind(ctx.userId, now)
    .first<{ n: number }>();
  if ((active?.n ?? 0) >= MAX_ACTIVE_SHARES) throw new HttpError(429, 'share-limit');

  const capability = base64url(deps.random(32));
  const id = deps.uuid();
  const expiresAt = now + ttl * DAY;
  await env.DB.prepare(
    `INSERT INTO shares (id, user_id, token_hash, source_profile_id, kind, title, snapshot, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, ctx.userId, await sha256Hex(capability), profileId, checked.snapshot.kind, checked.snapshot.title, JSON.stringify(checked.snapshot), now, expiresAt)
    .run();
  return { id, capability, expiresAt };
}

export async function listShares(env: SyncEnv, ctx: AuthContext) {
  const { results } = await env.DB.prepare(
    `SELECT id, kind, title, source_profile_id AS sourceProfileId, created_at AS createdAt, expires_at AS expiresAt, revoked_at AS revokedAt
     FROM shares WHERE user_id = ? ORDER BY created_at DESC`,
  )
    .bind(ctx.userId)
    .all();
  return results;
}

export async function revokeShare(env: SyncEnv, ctx: AuthContext, id: string, now: number): Promise<void> {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) throw new HttpError(404, 'not-found');
  const r = await env.DB.prepare('UPDATE shares SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL').bind(now, id, ctx.userId).run();
  if (r.meta.changes > 0) return;
  // 이미 철회했으면 그대로 성공, 남의 것이거나 없으면 404(있는지 알려 주지 않는다)
  const mine = await env.DB.prepare('SELECT 1 AS x FROM shares WHERE id = ? AND user_id = ?').bind(id, ctx.userId).first();
  if (!mine) throw new HttpError(404, 'not-found');
}

/** 로그인 없이 capability로 읽는다. 형식이 틀리거나 없으면 404, 만료·철회·원본 삭제면 410. */
export async function readShare(env: SyncEnv, req: Request, now: number) {
  const cap = req.headers.get(SHARE_HEADER);
  if (!isCapability(cap)) throw new HttpError(404, 'not-found');
  const row = await env.DB.prepare(
    `SELECT s.kind, s.title, s.snapshot, s.created_at AS createdAt, s.expires_at AS expiresAt, s.revoked_at AS revokedAt, p.deleted_at AS deletedAt, p.profile_id AS live
     FROM shares s LEFT JOIN profile_index p ON p.user_id = s.user_id AND p.profile_id = s.source_profile_id
     WHERE s.token_hash = ?`,
  )
    .bind(await sha256Hex(cap))
    .first<{ kind: string; title: string; snapshot: string; createdAt: number; expiresAt: number; revokedAt: number | null; deletedAt: number | null; live: string | null }>();
  if (!row) throw new HttpError(404, 'not-found');
  if (row.revokedAt !== null || row.expiresAt <= now || row.live === null || row.deletedAt !== null) throw new HttpError(410, 'share-gone');
  return { kind: row.kind, title: row.title, snapshot: JSON.parse(row.snapshot), createdAt: row.createdAt, expiresAt: row.expiresAt };
}
