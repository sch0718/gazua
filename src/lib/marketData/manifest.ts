// 시장 파일 manifest(설계 2026-11-02-market-drive 5.2). sync-worker·CLI·앱이 같은 규칙을 쓴다.
// 시세는 담지 않는다(파일 이름·해시·크기·형식·수집 시각·기간·종목 수만).

export const MARKET_FILE_MAX_BYTES = 512 * 1024 * 1024;
export const MARKET_FILES_LIMIT = 10;
export const DRIVE_FILE_ID_RE = /^[A-Za-z0-9_-]{10,128}$/;
const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;
const SHA_RE = /^[0-9a-f]{64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface MarketFileMeta {
  name: string;
  sha256: string;
  size: number;
  version: number;
  collectedAt: string;
  range: { from: string; to: string };
  stocks: number;
}
export interface MarketFileBody extends MarketFileMeta {
  driveFileId: string;
}
export interface MarketFileRow extends MarketFileBody {
  id: string;
  createdAt: number;
  updatedAt: number;
}
export type ManifestCheck<T> = { ok: true; value: T } | { ok: false; code: 'invalid' | 'unknown-field'; path: string };

const META_KEYS = ['name', 'sha256', 'size', 'version', 'collectedAt', 'range', 'stocks'] as const;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const intIn = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
/** 달력에 있는 YYYY-MM-DD(2026-02-30은 아니다) */
const realDate = (d: unknown): d is string => {
  if (typeof d !== 'string' || !DATE_RE.test(d)) return false;
  const time = Date.parse(`${d}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === d;
};
const bad = (path: string) => ({ ok: false as const, code: 'invalid' as const, path });

function metaFields(v: Record<string, unknown>): ManifestCheck<MarketFileMeta> {
  if (typeof v.name !== 'string' || !NAME_RE.test(v.name) || !v.name.endsWith('.json.gz')) return bad('name');
  if (typeof v.sha256 !== 'string' || !SHA_RE.test(v.sha256)) return bad('sha256');
  if (!intIn(v.size, 1, MARKET_FILE_MAX_BYTES)) return bad('size');
  if (!intIn(v.version, 1, 99)) return bad('version');
  if (typeof v.collectedAt !== 'string' || v.collectedAt.length > 40 || Number.isNaN(Date.parse(v.collectedAt))) return bad('collectedAt');
  const r = v.range;
  if (!isRecord(r) || Object.keys(r).length !== 2 || !realDate(r.from) || !realDate(r.to) || r.from > r.to) return bad('range');
  if (!intIn(v.stocks, 0, 100000)) return bad('stocks');
  return {
    ok: true,
    value: { name: v.name, sha256: v.sha256, size: v.size as number, version: v.version as number, collectedAt: v.collectedAt, range: { from: r.from, to: r.to }, stocks: v.stocks as number },
  };
}

function check(v: unknown, keys: readonly string[]): ManifestCheck<Record<string, unknown>> {
  if (!isRecord(v)) return bad('');
  for (const k of Object.keys(v)) if (!keys.includes(k)) return { ok: false, code: 'unknown-field', path: k };
  return { ok: true, value: v };
}

export function checkMarketMeta(v: unknown): ManifestCheck<MarketFileMeta> {
  const c = check(v, META_KEYS);
  return c.ok ? metaFields(c.value) : c;
}

export function checkMarketBody(v: unknown): ManifestCheck<MarketFileBody> {
  const c = check(v, [...META_KEYS, 'driveFileId']);
  if (!c.ok) return c;
  if (typeof c.value.driveFileId !== 'string' || !DRIVE_FILE_ID_RE.test(c.value.driveFileId)) return bad('driveFileId');
  const m = metaFields(c.value);
  return m.ok ? { ok: true, value: { ...m.value, driveFileId: c.value.driveFileId } } : m;
}

/** 서버 응답의 files 배열. 하나라도 모양이 다르면 null */
export function checkMarketFiles(v: unknown): MarketFileRow[] | null {
  if (!Array.isArray(v)) return null;
  const out: MarketFileRow[] = [];
  for (const row of v) {
    if (!isRecord(row) || typeof row.id !== 'string' || typeof row.createdAt !== 'number' || typeof row.updatedAt !== 'number') return null;
    const { id, createdAt, updatedAt, ...rest } = row;
    const b = checkMarketBody(rest);
    if (!b.ok) return null;
    out.push({ ...b.value, id, createdAt, updatedAt });
  }
  return out;
}
