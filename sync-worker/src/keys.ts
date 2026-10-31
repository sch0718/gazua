// 키 금고 API(docs/superpowers/specs/2026-10-31-key-sync-design.md 4절). 서버는 암호문만 두고 암호 연산을 하지 않는다.
// 조건(금고·리비전·프로필 살아 있음·개수)은 모두 한 문장 안에 둔다(사이에 다른 요청이 끼어도 어긋나지 않게).
// 응답·로그에 블롭 암호문을 담지 않는다(rekey 409의 목록도 4.2처럼 암호문 없이).
import { HttpError } from '@sch0718/firebase-session/worker';
import {
  checkBlobBody,
  checkRekeyBody,
  checkVaultBody,
  KEY_BLOBS_MAX,
  KEY_ITER,
  KEY_KDF,
  type KeyBlob,
  type KeyBlobRow,
  type KeyVaultHead,
  type WireCheck,
} from '../../src/lib/sync/keyWire';
import type { SyncEnv } from './env';
import { KEY_TOMBSTONE_SQL } from './keySql';
import { checkId } from './profiles';
import type { AuthContext } from './session';

/** 살아 있는 블롭 수(2.1 정의). 바인딩: user_id */
const LIVE_COUNT = `(SELECT count(*) FROM key_blobs lb JOIN profile_index li ON li.user_id = lb.user_id AND li.profile_id = lb.profile_id
  WHERE lb.user_id = ? AND lb.ciphertext IS NOT NULL AND li.deleted_at IS NULL)`;
/** 금고 맞음. 바인딩: user_id, vault_id, vault_revision */
const VAULT_OK = 'EXISTS (SELECT 1 FROM key_vault WHERE user_id = ? AND vault_id = ? AND vault_revision = ?)';
/** 프로필 살아 있음. 바인딩: user_id, profile_id */
const PROFILE_LIVE = 'EXISTS (SELECT 1 FROM profile_index WHERE user_id = ? AND profile_id = ? AND deleted_at IS NULL)';

const HEAD_SQL = `SELECT vault_id AS vaultId, salt, verifier_nonce AS verifierNonce, verifier_ciphertext AS verifierCiphertext,
  vault_revision AS vaultRevision, updated_at AS updatedAt FROM key_vault WHERE user_id = ?`;
const ROWS_SQL = `SELECT b.profile_id AS profileId, b.revision AS revision, b.vault_revision AS vaultRevision, b.content_id AS contentId,
  b.ciphertext IS NULL AS deleted, b.updated_at AS updatedAt
  FROM key_blobs b JOIN profile_index i ON i.user_id = b.user_id AND i.profile_id = b.profile_id
  WHERE b.user_id = ? AND i.deleted_at IS NULL ORDER BY b.profile_id`;

type HeadRow = { vaultId: string; salt: string; verifierNonce: string; verifierCiphertext: string; vaultRevision: number; updatedAt: number };
type ListRow = Omit<KeyBlobRow, 'deleted'> & { deleted: number };

const toHead = (r: HeadRow): KeyVaultHead => ({
  vaultId: r.vaultId,
  kdf: KEY_KDF,
  iter: KEY_ITER,
  salt: r.salt,
  verifier: { nonce: r.verifierNonce, ciphertext: r.verifierCiphertext },
  vaultRevision: r.vaultRevision,
  updatedAt: r.updatedAt,
});

function body<T>(c: WireCheck<T>): T {
  if (!c.ok) throw new HttpError(422, c.code, { path: c.path });
  return c.value;
}

/** :profileId. vault·rekey는 앞 행이 맡는 이름이라 404로 막는다(4.1) */
export function checkKeyId(id: string): string {
  if (id === 'vault' || id === 'rekey') throw new HttpError(404, 'not-found');
  return checkId(id);
}

async function head(env: SyncEnv, userId: string): Promise<KeyVaultHead | null> {
  const r = await env.DB.prepare(HEAD_SQL).bind(userId).first<HeadRow>();
  return r ? toHead(r) : null;
}

export async function listKeys(env: SyncEnv, ctx: AuthContext): Promise<{ keyVault: KeyVaultHead | null; keyBlobs: KeyBlobRow[] }> {
  // 머리와 목록을 한 batch(한 트랜잭션)로 읽는다. 사이에 rekey가 끼면 금고 리비전이 짝지어지지 않으므로
  const [h, list] = await env.DB.batch([env.DB.prepare(HEAD_SQL).bind(ctx.userId), env.DB.prepare(ROWS_SQL).bind(ctx.userId)]);
  const hr = (h.results as unknown as HeadRow[])[0];
  if (!hr) return { keyVault: null, keyBlobs: [] };
  const keyBlobs = (list.results as unknown as ListRow[]).map((r) => ({
    profileId: r.profileId,
    revision: r.revision,
    vaultRevision: r.vaultRevision,
    contentId: r.contentId,
    deleted: r.deleted === 1,
    updatedAt: r.updatedAt,
  }));
  return { keyVault: toHead(hr), keyBlobs };
}

export async function getKeyBlob(env: SyncEnv, ctx: AuthContext, profileId: string): Promise<KeyBlob> {
  // 리비전과 암호문을 한 문장으로 읽는다(getProfile과 같은 이유)
  const row = await env.DB.prepare(
    `SELECT b.revision AS revision, b.content_id AS contentId, b.vault_revision AS vaultRevision, b.nonce AS nonce, b.ciphertext AS ciphertext, b.updated_at AS updatedAt
     FROM key_blobs b JOIN profile_index i ON i.user_id = b.user_id AND i.profile_id = b.profile_id
     WHERE b.user_id = ? AND b.profile_id = ? AND b.ciphertext IS NOT NULL AND i.deleted_at IS NULL`,
  )
    .bind(ctx.userId, checkKeyId(profileId))
    .first<KeyBlob>();
  if (!row) throw new HttpError(404, 'not-found');
  return row;
}

export async function createVault(env: SyncEnv, ctx: AuthContext, raw: unknown, now: number): Promise<{ vaultRevision: number; updatedAt: number }> {
  const b = body(checkVaultBody(raw));
  await env.DB.prepare(
    `INSERT INTO key_vault (user_id, vault_id, kdf, iter, salt, verifier_nonce, verifier_ciphertext, vault_revision, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?) ON CONFLICT (user_id) DO NOTHING`,
  )
    .bind(ctx.userId, b.vaultId, b.kdf, b.iter, b.salt, b.verifier.nonce, b.verifier.ciphertext, now, now)
    .run();
  const h = await head(env, ctx.userId);
  // 다시 보낸 같은 요청도 금고 ID가 같으면 성공이다
  if (h && h.vaultId === b.vaultId) return { vaultRevision: h.vaultRevision, updatedAt: h.updatedAt };
  throw new HttpError(409, 'vault-exists', { keyVault: h });
}

export async function putKeyBlob(env: SyncEnv, ctx: AuthContext, profileId: string, raw: unknown, now: number): Promise<{ revision: number; updatedAt: number }> {
  checkKeyId(profileId);
  const b = body(checkBlobBody(raw));
  const u = ctx.userId;
  const cond = [u, b.vaultId, b.vaultRevision, u, profileId, u];
  if (b.expectedRevision === 0) {
    await env.DB.prepare(
      `INSERT INTO key_blobs (user_id, profile_id, revision, vault_revision, content_id, nonce, ciphertext, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${VAULT_OK} AND ${PROFILE_LIVE} AND ${LIVE_COUNT} < ${KEY_BLOBS_MAX}
       ON CONFLICT (user_id, profile_id) DO NOTHING`,
    )
      .bind(u, profileId, b.newRevision, b.vaultRevision, b.contentId, b.nonce, b.ciphertext, now, ...cond)
      .run();
  } else {
    await env.DB.prepare(
      `UPDATE key_blobs SET revision = ?, vault_revision = ?, content_id = ?, nonce = ?, ciphertext = ?, updated_at = ?
       WHERE user_id = ? AND profile_id = ? AND revision = ? AND ${VAULT_OK} AND ${PROFILE_LIVE}
         AND (ciphertext IS NOT NULL OR ${LIVE_COUNT} < ${KEY_BLOBS_MAX})`,
    )
      .bind(b.newRevision, b.vaultRevision, b.contentId, b.nonce, b.ciphertext, now, u, profileId, b.expectedRevision, ...cond)
      .run();
  }
  const row = await env.DB.prepare('SELECT revision, nonce, ciphertext IS NULL AS deleted, updated_at AS updatedAt FROM key_blobs WHERE user_id = ? AND profile_id = ?')
    .bind(u, profileId)
    .first<{ revision: number; nonce: string | null; deleted: number; updatedAt: number }>();
  // 응답을 잃고 같은 본문을 다시 보내도 같은 결과(4.5)
  if (row && row.revision === b.newRevision && row.nonce === b.nonce) return { revision: row.revision, updatedAt: row.updatedAt };
  // 실패 이유는 쓴 뒤 다시 읽어 4.5 표 순서로 정한다
  const p = await env.DB.prepare('SELECT revision, deleted_at AS deletedAt, purge_at AS purgeAt FROM profile_index WHERE user_id = ? AND profile_id = ?')
    .bind(u, profileId)
    .first<{ revision: number; deletedAt: number | null; purgeAt: number | null }>();
  if (!p) throw new HttpError(404, 'not-found');
  if (p.deletedAt !== null) throw new HttpError(410, 'gone', { deletedAt: p.deletedAt, purgeAt: p.purgeAt, revision: p.revision });
  const v = await env.DB.prepare('SELECT vault_id AS vaultId, vault_revision AS vaultRevision FROM key_vault WHERE user_id = ?')
    .bind(u)
    .first<{ vaultId: string; vaultRevision: number }>();
  if (!v) throw new HttpError(409, 'no-vault', { vaultRevision: null });
  if (v.vaultId !== b.vaultId || v.vaultRevision !== b.vaultRevision) throw new HttpError(409, 'vault-changed', { vaultRevision: v.vaultRevision });
  const current = row?.revision ?? 0;
  if (current !== b.expectedRevision) throw new HttpError(409, 'conflict', { revision: current, vaultRevision: v.vaultRevision, deleted: row ? row.deleted === 1 : false });
  throw new HttpError(422, 'key-limit');
}

/** 끄기(4.6): 조건 없이 삭제 표시. 늘 200 */
export async function deleteKeyBlob(env: SyncEnv, ctx: AuthContext, profileId: string, now: number): Promise<{ deleted: boolean; revision: number }> {
  checkKeyId(profileId);
  const r = await env.DB.prepare(KEY_TOMBSTONE_SQL).bind(now, ctx.userId, profileId).run();
  const row = await env.DB.prepare('SELECT revision FROM key_blobs WHERE user_id = ? AND profile_id = ?').bind(ctx.userId, profileId).first<{ revision: number }>();
  return { deleted: r.meta.changes > 0, revision: row?.revision ?? 0 };
}

/** 암호 바꾸기(4.7): batch 한 번. 감시 문장이 어긋남을 보면 CHECK로 batch 전체를 되돌린다 */
export async function rekey(env: SyncEnv, ctx: AuthContext, raw: unknown, now: number): Promise<{ vaultRevision: number; updatedAt: number }> {
  const b = body(checkRekeyBody(raw));
  const u = ctx.userId;
  const next = b.expectedVaultRevision + 1;
  const NEW_VAULT = 'EXISTS (SELECT 1 FROM key_vault WHERE user_id = ? AND vault_id = ? AND vault_revision = ? AND salt = ?)';
  const nv = [u, b.expectedVaultId, next, b.salt];
  const LIVE_FROM = `FROM key_blobs gb JOIN profile_index gi ON gi.user_id = gb.user_id AND gi.profile_id = gb.profile_id
    WHERE gb.user_id = ? AND gb.ciphertext IS NOT NULL AND gi.deleted_at IS NULL`;
  try {
    await env.DB.batch([
      // 0. 정리: 프로필이 없거나 삭제된 행 중 암호문이 남은 고아를 삭제 표시로
      env.DB.prepare(
        `UPDATE key_blobs SET content_id = NULL, nonce = NULL, ciphertext = NULL, revision = revision + 1, updated_at = ?
         WHERE user_id = ? AND ciphertext IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM profile_index i WHERE i.user_id = key_blobs.user_id AND i.profile_id = key_blobs.profile_id AND i.deleted_at IS NULL)`,
      ).bind(now, u),
      // 1. 금고 머리
      env.DB.prepare(
        `UPDATE key_vault SET salt = ?, verifier_nonce = ?, verifier_ciphertext = ?, vault_revision = ? + 1, updated_at = ?
         WHERE user_id = ? AND vault_id = ? AND vault_revision = ?`,
      ).bind(b.salt, b.verifier.nonce, b.verifier.ciphertext, b.expectedVaultRevision, now, u, b.expectedVaultId, b.expectedVaultRevision),
      // 2. 블롭마다(바인딩 12개)
      ...b.keyBlobs.map((k) =>
        env.DB.prepare(
          `UPDATE key_blobs SET vault_revision = ?, nonce = ?, ciphertext = ?, updated_at = ?
           WHERE user_id = ? AND profile_id = ? AND revision = ? AND content_id = ? AND ciphertext IS NOT NULL AND ${NEW_VAULT}`,
        ).bind(next, k.nonce, k.ciphertext, now, u, k.profileId, k.revision, k.contentId, ...nv),
      ),
      // 3. 감시
      env.DB.prepare(
        `INSERT INTO key_guard (ok) SELECT 0 WHERE NOT ${NEW_VAULT}
           OR (SELECT count(*) ${LIVE_FROM} AND gb.vault_revision <> ?) > 0
           OR (SELECT count(*) ${LIVE_FROM} AND gb.vault_revision = ?) <> ?`,
      ).bind(...nv, u, next, u, next, b.keyBlobs.length),
    ]);
  } catch (e) {
    let h: KeyVaultHead | null;
    try {
      h = await head(env, u);
    } catch {
      throw e;
    }
    if (!h) throw new HttpError(409, 'no-vault');
    if (h.vaultId !== b.expectedVaultId) throw new HttpError(409, 'vault-changed', { vaultRevision: h.vaultRevision });
    // 앞선 같은 요청이 이미 반영됐다
    if (h.salt === b.salt) return { vaultRevision: h.vaultRevision, updatedAt: h.updatedAt };
    throw new HttpError(409, 'conflict', await listKeys(env, ctx));
  }
  const h = await head(env, u);
  return { vaultRevision: h!.vaultRevision, updatedAt: h!.updatedAt };
}

/** 서버의 키 모두 지우기(4.8). 다시 보내도 200 */
export async function wipeKeys(env: SyncEnv, ctx: AuthContext): Promise<{ deleted: { vault: boolean; blobs: number } }> {
  const [blobs, vault] = await env.DB.batch([
    env.DB.prepare('DELETE FROM key_blobs WHERE user_id = ?').bind(ctx.userId),
    env.DB.prepare('DELETE FROM key_vault WHERE user_id = ?').bind(ctx.userId),
  ]);
  return { deleted: { vault: vault.meta.changes > 0, blobs: blobs.meta.changes } };
}
