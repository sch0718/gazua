// sync-worker/src/market.ts
// 시장 파일 manifest(설계 2026-11-02-market-drive 5절). 파일 본문은 사용자 Drive appDataFolder에 있다.
// 로그에는 Drive 파일 ID·해시·이름을 남기지 않는다(handler가 경로 패턴만 남긴다).
import { HttpError } from '@sch0718/firebase-session/worker';
import { checkMarketBody, MARKET_FILES_LIMIT, type MarketFileRow } from '../../src/lib/marketData/manifest';
import { findForbidden } from '../../src/lib/sync/forbidden';
import type { SyncDeps, SyncEnv } from './env';
import type { AuthContext } from './session';

const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const COLUMNS = `id, drive_file_id AS driveFileId, name, sha256, size, format_version AS version, collected_at AS collectedAt,
  range_from AS rangeFrom, range_to AS rangeTo, stocks, created_at AS createdAt, updated_at AS updatedAt`;
type Raw = Omit<MarketFileRow, 'range'> & { rangeFrom: string; rangeTo: string };
const toRow = ({ rangeFrom, rangeTo, ...r }: Raw): MarketFileRow => ({ ...r, range: { from: rangeFrom, to: rangeTo } });

export async function listMarketFiles(env: SyncEnv, ctx: AuthContext): Promise<MarketFileRow[]> {
  const { results } = await env.DB.prepare(`SELECT ${COLUMNS} FROM market_files WHERE user_id = ? ORDER BY collected_at DESC, created_at DESC`)
    .bind(ctx.userId)
    .all<Raw>();
  return results.map(toRow);
}

/** 같은 sha256이면 갱신(한도에 세지 않는다), 새 sha256이면 사용자당 10행까지 */
export async function putMarketFile(env: SyncEnv, deps: SyncDeps, ctx: AuthContext, body: unknown): Promise<MarketFileRow> {
  const hit = findForbidden(body);
  if (hit) throw new HttpError(422, 'forbidden-field', { path: hit });
  const c = checkMarketBody(body);
  if (!c.ok) throw new HttpError(422, c.code, { path: c.path });
  const b = c.value;
  const now = deps.now();
  const r = await env.DB.prepare(
    `INSERT INTO market_files (id, user_id, drive_file_id, name, sha256, size, format_version, collected_at, range_from, range_to, stocks, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     WHERE (SELECT count(*) FROM market_files WHERE user_id = ?) < ? OR EXISTS (SELECT 1 FROM market_files WHERE user_id = ? AND sha256 = ?)
     ON CONFLICT (user_id, sha256) DO UPDATE SET drive_file_id = excluded.drive_file_id, name = excluded.name, updated_at = excluded.updated_at`,
  )
    .bind(deps.uuid(), ctx.userId, b.driveFileId, b.name, b.sha256, b.size, b.version, b.collectedAt, b.range.from, b.range.to, b.stocks, now, now,
      ctx.userId, MARKET_FILES_LIMIT, ctx.userId, b.sha256)
    .run();
  if (r.meta.changes === 0) throw new HttpError(429, 'market-limit');
  const row = await env.DB.prepare(`SELECT ${COLUMNS} FROM market_files WHERE user_id = ? AND sha256 = ?`).bind(ctx.userId, b.sha256).first<Raw>();
  if (!row) throw new Error('market: row missing after upsert');
  return toRow(row);
}

export async function deleteMarketFile(env: SyncEnv, ctx: AuthContext, id: string): Promise<void> {
  if (!ID_RE.test(id)) throw new HttpError(404, 'not-found');
  const r = await env.DB.prepare('DELETE FROM market_files WHERE id = ? AND user_id = ?').bind(id, ctx.userId).run();
  if (r.meta.changes === 0) throw new HttpError(404, 'not-found');
}

export async function wipeMarketFiles(env: SyncEnv, ctx: AuthContext): Promise<{ deleted: number }> {
  const r = await env.DB.prepare('DELETE FROM market_files WHERE user_id = ?').bind(ctx.userId).run();
  return { deleted: r.meta.changes };
}
