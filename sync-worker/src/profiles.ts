// 프로필 API: expectedRevision 조건부 갱신, opId 재시도, tombstone 삭제와 30일 복구, 리비전 보존(현재 + 과거 10개).
// 비교·갱신·이력 기록은 D1 batch(한 트랜잭션)로 묶고, 뒤 문장은 `last_op_id = 이 작업`일 때만 적용한다.
import { checkProfileDoc } from '../../src/lib/sync/dto';
import type { D1PreparedStatement } from './db';
import { DAY, type SyncEnv } from './env';
import { HttpError } from './http';
import type { AuthContext } from './session';

export const PAST_REVISIONS = 10;
export const RESTORE_WINDOW = 30 * DAY;
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;

export interface IndexRow {
  profileId: string;
  revision: number;
  updatedAt: number;
  deletedAt: number | null;
  purgeAt: number | null;
}
type Head = IndexRow & { lastOpId: string };

export function checkId(id: string): string {
  if (!ID_RE.test(id)) throw new HttpError(404, 'not-found');
  return id;
}

function opArgs(body: unknown): { opId: string; expectedRevision: number; doc?: unknown } {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  if (typeof b.opId !== 'string' || !ID_RE.test(b.opId)) throw new HttpError(422, 'invalid', { path: 'opId' });
  const r = b.expectedRevision;
  if (typeof r !== 'number' || !Number.isInteger(r) || r < 0) throw new HttpError(422, 'invalid', { path: 'expectedRevision' });
  return { opId: b.opId, expectedRevision: r, doc: b.doc };
}

async function head(env: SyncEnv, userId: string, profileId: string): Promise<Head | null> {
  return env.DB.prepare(
    `SELECT profile_id AS profileId, revision, updated_at AS updatedAt, deleted_at AS deletedAt, purge_at AS purgeAt, last_op_id AS lastOpId
     FROM profile_index WHERE user_id = ? AND profile_id = ?`,
  )
    .bind(userId, profileId)
    .first<Head>();
}

async function currentDoc(env: SyncEnv, userId: string, profileId: string): Promise<unknown> {
  const row = await env.DB.prepare('SELECT body FROM profiles WHERE user_id = ? AND profile_id = ?').bind(userId, profileId).first<{ body: string }>();
  return row ? JSON.parse(row.body) : null;
}

/** 이미 처리한 opId면 그 결과. 다른 프로필에 쓴 opId를 다시 쓰면 거절한다. */
async function replayed(env: SyncEnv, userId: string, profileId: string, opId: string): Promise<{ revision: number } | null> {
  const r = await env.DB.prepare('SELECT profile_id AS profileId, revision FROM revisions WHERE user_id = ? AND op_id = ?')
    .bind(userId, opId)
    .first<{ profileId: string; revision: number }>();
  if (!r) return null;
  if (r.profileId !== profileId) throw new HttpError(422, 'invalid', { path: 'opId' });
  return { revision: r.revision };
}

/** 작업이 반영되지 않았을 때의 응답: 정리돼 없으면 410, 삭제됐으면 410, 아니면 409와 현재 본문. */
async function rejected(env: SyncEnv, userId: string, profileId: string): Promise<never> {
  const h = await head(env, userId, profileId);
  if (!h) throw new HttpError(410, 'gone', { deletedAt: null, purgeAt: null });
  if (h.deletedAt !== null) throw new HttpError(410, 'gone', { deletedAt: h.deletedAt, purgeAt: h.purgeAt, revision: h.revision });
  throw new HttpError(409, 'conflict', { revision: h.revision, doc: await currentDoc(env, userId, profileId) });
}

/** 이 작업이 색인에 반영됐을 때만 참. 뒤에 user_id·profile_id·opId를 바인딩한다. */
const APPLIED = 'EXISTS (SELECT 1 FROM profile_index WHERE user_id = ? AND profile_id = ? AND last_op_id = ?)';

function historyStatements(env: SyncEnv, ctx: AuthContext, profileId: string, opId: string, revision: number, body: string | null, now: number): D1PreparedStatement[] {
  const key = [ctx.userId, profileId, opId];
  return [
    // 같은 opId 요청이 겹쳐 둘 다 재시도 확인을 지나면 뒤 요청의 넣기가 고유 제약에 걸린다. 무시해 처음 결과를 그대로 돌려주게 한다.
    env.DB.prepare(`INSERT OR IGNORE INTO revisions (user_id, profile_id, revision, op_id, body, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE ${APPLIED}`).bind(
      ctx.userId,
      profileId,
      revision,
      opId,
      body,
      now,
      ...key,
    ),
    env.DB.prepare(`DELETE FROM revisions WHERE user_id = ? AND profile_id = ? AND revision <= ? AND ${APPLIED}`).bind(
      ctx.userId,
      profileId,
      revision - PAST_REVISIONS - 1,
      ...key,
    ),
  ];
}

export async function listProfiles(env: SyncEnv, ctx: AuthContext): Promise<IndexRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT profile_id AS profileId, revision, updated_at AS updatedAt, deleted_at AS deletedAt, purge_at AS purgeAt
     FROM profile_index WHERE user_id = ? ORDER BY profile_id`,
  )
    .bind(ctx.userId)
    .all<IndexRow>();
  return results;
}

export async function getProfile(env: SyncEnv, ctx: AuthContext, profileId: string): Promise<{ revision: number; doc: unknown }> {
  const h = await head(env, ctx.userId, checkId(profileId));
  if (!h) throw new HttpError(404, 'not-found');
  if (h.deletedAt !== null) throw new HttpError(410, 'gone', { deletedAt: h.deletedAt, purgeAt: h.purgeAt, revision: h.revision });
  return { revision: h.revision, doc: await currentDoc(env, ctx.userId, profileId) };
}

/** PUT: 새로 만들기(expectedRevision 0) 또는 조건부 갱신. */
export async function putProfile(env: SyncEnv, ctx: AuthContext, profileId: string, body: unknown, now: number): Promise<{ revision: number }> {
  checkId(profileId);
  const { opId, expectedRevision, doc } = opArgs(body);
  const checked = checkProfileDoc(doc, now);
  if (!checked.ok) throw new HttpError(422, checked.code, checked.path ? { path: checked.path } : {});
  const again = await replayed(env, ctx.userId, profileId, opId);
  if (again) return again;

  const text = JSON.stringify(checked.doc);
  const size = new TextEncoder().encode(text).length;
  const revision = expectedRevision + 1;
  const first =
    expectedRevision === 0
      ? env.DB.prepare(
          `INSERT INTO profile_index (user_id, profile_id, revision, last_op_id, updated_at) VALUES (?, ?, 1, ?, ?)
           ON CONFLICT (user_id, profile_id) DO NOTHING`,
        ).bind(ctx.userId, profileId, opId, now)
      : env.DB.prepare(
          `UPDATE profile_index SET revision = ?, last_op_id = ?, updated_at = ?
           WHERE user_id = ? AND profile_id = ? AND revision = ? AND deleted_at IS NULL`,
        ).bind(revision, opId, now, ctx.userId, profileId, expectedRevision);
  await env.DB.batch([
    first,
    env.DB.prepare(`INSERT OR REPLACE INTO profiles (user_id, profile_id, body, size) SELECT ?, ?, ?, ? WHERE ${APPLIED}`).bind(
      ctx.userId,
      profileId,
      text,
      size,
      ctx.userId,
      profileId,
      opId,
    ),
    ...historyStatements(env, ctx, profileId, opId, revision, text, now),
  ]);
  const h = await head(env, ctx.userId, profileId);
  if (h?.lastOpId === opId) return { revision: h.revision };
  return rejected(env, ctx.userId, profileId);
}

/** DELETE: tombstone. 본문은 30일 복구를 위해 남기고, 공유 읽기는 막힌다. */
export async function deleteProfile(
  env: SyncEnv,
  ctx: AuthContext,
  profileId: string,
  body: unknown,
  now: number,
): Promise<{ revision: number; deletedAt: number; purgeAt: number }> {
  checkId(profileId);
  const { opId, expectedRevision } = opArgs(body);
  if (expectedRevision < 1) throw new HttpError(422, 'invalid', { path: 'expectedRevision' });
  if (!(await replayed(env, ctx.userId, profileId, opId))) {
    const revision = expectedRevision + 1;
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE profile_index SET revision = ?, last_op_id = ?, updated_at = ?, deleted_at = ?, purge_at = ?
         WHERE user_id = ? AND profile_id = ? AND revision = ? AND deleted_at IS NULL`,
      ).bind(revision, opId, now, now, now + RESTORE_WINDOW, ctx.userId, profileId, expectedRevision),
      ...historyStatements(env, ctx, profileId, opId, revision, null, now),
    ]);
  }
  const h = await head(env, ctx.userId, profileId);
  if (h?.lastOpId === opId && h.deletedAt !== null) return { revision: h.revision, deletedAt: h.deletedAt, purgeAt: h.purgeAt! };
  if (h?.lastOpId === opId) throw new HttpError(409, 'conflict', { revision: h.revision, doc: await currentDoc(env, ctx.userId, profileId) });
  if (h && h.deletedAt !== null) throw new HttpError(410, 'gone', { deletedAt: h.deletedAt, purgeAt: h.purgeAt, revision: h.revision });
  return rejected(env, ctx.userId, profileId);
}

/** 삭제 후 30일 안이면 마지막 본문으로 되살린다. */
export async function restoreProfile(env: SyncEnv, ctx: AuthContext, profileId: string, body: unknown, now: number): Promise<{ revision: number; doc: unknown }> {
  checkId(profileId);
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  if (typeof b.opId !== 'string' || !ID_RE.test(b.opId)) throw new HttpError(422, 'invalid', { path: 'opId' });
  const opId = b.opId;
  const again = await replayed(env, ctx.userId, profileId, opId);
  if (!again) {
    const h = await head(env, ctx.userId, profileId);
    if (!h) throw new HttpError(404, 'not-found');
    if (h.deletedAt === null) throw new HttpError(409, 'not-deleted', { revision: h.revision });
    if (h.purgeAt! <= now) throw new HttpError(410, 'gone', { deletedAt: h.deletedAt, purgeAt: h.purgeAt });
    const revision = h.revision + 1;
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE profile_index SET revision = ?, last_op_id = ?, updated_at = ?, deleted_at = NULL, purge_at = NULL
         WHERE user_id = ? AND profile_id = ? AND revision = ? AND deleted_at IS NOT NULL`,
      ).bind(revision, opId, now, ctx.userId, profileId, h.revision),
      env.DB.prepare(
        `INSERT INTO revisions (user_id, profile_id, revision, op_id, body, created_at)
         SELECT user_id, profile_id, ?, ?, body, ? FROM profiles WHERE user_id = ? AND profile_id = ? AND ${APPLIED}`,
      ).bind(revision, opId, now, ctx.userId, profileId, ctx.userId, profileId, opId),
      historyStatements(env, ctx, profileId, opId, revision, null, now)[1],
    ]);
    const after = await head(env, ctx.userId, profileId);
    if (after?.lastOpId !== opId) throw new HttpError(409, 'conflict', { revision: after?.revision ?? null });
  }
  const h = await head(env, ctx.userId, profileId);
  return { revision: h!.revision, doc: await currentDoc(env, ctx.userId, profileId) };
}

export async function listRevisions(env: SyncEnv, ctx: AuthContext, profileId: string) {
  checkId(profileId);
  const { results } = await env.DB.prepare(
    `SELECT revision, created_at AS createdAt, body IS NULL AS deleted FROM revisions
     WHERE user_id = ? AND profile_id = ? ORDER BY revision DESC`,
  )
    .bind(ctx.userId, profileId)
    .all<{ revision: number; createdAt: number; deleted: number }>();
  if (results.length === 0) throw new HttpError(404, 'not-found');
  return results.map((r) => ({ revision: r.revision, createdAt: r.createdAt, deleted: r.deleted === 1 }));
}

export async function getRevision(env: SyncEnv, ctx: AuthContext, profileId: string, rev: string) {
  checkId(profileId);
  if (!/^\d{1,9}$/.test(rev)) throw new HttpError(404, 'not-found');
  const row = await env.DB.prepare('SELECT body FROM revisions WHERE user_id = ? AND profile_id = ? AND revision = ? AND body IS NOT NULL')
    .bind(ctx.userId, profileId, Number(rev))
    .first<{ body: string }>();
  if (!row) throw new HttpError(404, 'not-found');
  return { revision: Number(rev), doc: JSON.parse(row.body) };
}
