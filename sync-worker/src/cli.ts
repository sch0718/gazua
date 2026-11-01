// 읽기 전용 CLI(설계 2026-11-01-readonly-cli): 기기 코드 로그인, CLI 토큰 인증, 읽기 전용 허용 목록.
// 원문 기기 코드·토큰은 D1에 두지 않는다(SHA-256 hex만). 원 IP도 두지 않는다(HMAC-SHA256 hex만).
import { base64url, errorBody, HttpError, json, readJson, sha256Hex } from '@sch0718/firebase-session/worker';
import { DAY, type SyncDeps, type SyncEnv } from './env';
import type { AuthContext } from './session';

export const CLI_GRANT_TTL = 10 * 60 * 1000;
export const POLL_INTERVAL_MS = 5000;
export const IP_LIMIT = 5;
export const IP_WINDOW_MS = 10 * 60 * 1000;
export const PENDING_LIMIT = 50;
export const CLI_LABEL_MAX = 64;
export const GEO_MAX = 64;
export const TOKEN_TTL = 90 * DAY;
export const INTERVAL_STEP_MS = 5000;
export const INTERVAL_CAP_MS = 60_000;
export const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
const USER_CODE_RE = /^[BCDFGHJKLMNPQRSTVWXZ]{8}$/;

type Row = Record<string, unknown>;
const isRecord = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);

function expandV6(ip: string): string[] | null {
  const parts = ip.split('::');
  if (parts.length > 2) return null;
  const side = (s: string) => (s === '' ? [] : s.split(':'));
  const head = side(parts[0]);
  const tail = parts.length === 2 ? side(parts[1]) : [];
  const fill = 8 - head.length - tail.length;
  if (parts.length === 1 ? head.length !== 8 : fill < 0) return null;
  const groups = parts.length === 1 ? head : [...head, ...Array<string>(fill).fill('0'), ...tail];
  return groups.every((g) => /^[0-9a-f]{1,4}$/.test(g)) ? groups : null;
}

/** 횟수 제한 묶음 키. IPv6는 앞 4그룹(/64), IPv4-mapped는 IPv4, 없으면 'unknown' */
export function normalizeIp(raw: string | null): string {
  const ip = (raw ?? '').trim().toLowerCase().replace(/%.*$/, '');
  if (ip === '') return 'unknown';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped) return mapped[1];
  if (!ip.includes(':')) return ip;
  const groups = expandV6(ip);
  return groups ? `v6:${groups.slice(0, 4).map((g) => g.padStart(4, '0')).join(':')}` : ip;
}

export async function ipHash(salt: string, ip: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(salt), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ip));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 자음 20자에서 8자. 바이트 240 이상은 버려 치우침을 없앤다 */
export function makeUserCode(random: (n: number) => Uint8Array): string {
  let out = '';
  while (out.length < 8) {
    for (const b of random(32)) {
      if (b < 240 && out.length < 8) out += USER_CODE_ALPHABET[b % USER_CODE_ALPHABET.length];
    }
  }
  return out;
}

export function normalizeUserCode(raw: string): string | null {
  const code = raw.toUpperCase().replace(/[\s-]/g, '');
  return USER_CODE_RE.test(code) ? code : null;
}

export const formatUserCode = (code: string): string => `${code.slice(0, 4)}-${code.slice(4)}`;

function geoOf(req: Request): string | null {
  const cf = (req as Request & { cf?: { country?: unknown; city?: unknown } }).cf;
  const parts = [cf?.country, cf?.city].filter((p): p is string => typeof p === 'string' && p !== '');
  return parts.length ? parts.join(' · ').slice(0, GEO_MAX) : null;
}

function verifyUrl(env: SyncEnv): string {
  const first = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).find(Boolean) ?? '';
  return `${first.replace(/\/+$/, '')}/#/settings/sync`;
}

function checkLabel(body: unknown): string {
  const label = isRecord(body) && typeof body.label === 'string' ? body.label.trim() : '';
  // eslint-disable-next-line no-control-regex
  if (label === '' || label.length > CLI_LABEL_MAX || /[\u0000-\u001f\u007f]/.test(label)) throw new HttpError(422, 'invalid', { path: 'label' });
  return label;
}

const INSERT_GRANT = `
  INSERT INTO cli_grants (id, device_hash, user_code, label, ip_hash, status, user_id, interval_ms, last_polled_at, consumed_token_hash, geo, created_at, expires_at)
  SELECT ?, ?, ?, ?, ?, 'pending', NULL, ?, NULL, NULL, ?, ?, ?
  WHERE (SELECT count(*) FROM cli_grants WHERE ip_hash = ? AND created_at > ?) < ?
    AND (SELECT count(*) FROM cli_grants WHERE status = 'pending' AND expires_at > ?) < ?`;

const isUserCodeCollision = (e: unknown) => e instanceof Error && /UNIQUE constraint failed: cli_grants\.user_code/i.test(e.message);

/** 기기 코드와 사용자 코드를 만든다. 한도는 넣기 문장 안에서 센다(겹친 요청 둘이 함께 지나가지 않게) */
export async function createDevice(req: Request, env: SyncEnv, deps: SyncDeps, body: unknown): Promise<Response> {
  const salt = env.CLI_IP_SALT;
  if (!salt) throw new HttpError(503, 'cli-disabled');
  const label = checkLabel(body);
  const now = deps.now();
  const ip = await ipHash(salt, normalizeIp(req.headers.get('CF-Connecting-IP')));
  const deviceCode = base64url(deps.random(32));
  const deviceHash = await sha256Hex(deviceCode);
  const geo = geoOf(req);
  for (let attempt = 0; attempt < 5; attempt++) {
    const userCode = makeUserCode(deps.random);
    try {
      const r = await env.DB.prepare(INSERT_GRANT)
        .bind(deps.uuid(), deviceHash, userCode, label, ip, POLL_INTERVAL_MS, geo, now, now + CLI_GRANT_TTL, ip, now - IP_WINDOW_MS, IP_LIMIT, now, PENDING_LIMIT)
        .run();
      if (r.meta.changes === 0) return json(429, errorBody('rate-limited'), { 'Retry-After': '60' });
      return json(200, { deviceCode, userCode: formatUserCode(userCode), verifyUrl: verifyUrl(env), interval: POLL_INTERVAL_MS / 1000, expiresIn: CLI_GRANT_TTL / 1000 });
    } catch (e) {
      if (!isUserCodeCollision(e)) throw e;
    }
  }
  throw new Error('cli: user code collision');
}

/**
 * 기기 코드를 폴링한다. 승인된 코드는 조건부 UPDATE와 EXISTS 조건 INSERT를 한 batch로 처리한다.
 * consumed_token_hash를 다시 읽어 내 해시일 때만 토큰을 돌려줘 겹친 폴링 중 하나만 받도록 한다.
 */
export async function pollToken(env: SyncEnv, deps: SyncDeps, body: unknown): Promise<{ token: string; tokenId: string; expiresAt: number }> {
  const b = isRecord(body) ? body : {};
  if (typeof b.deviceCode !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(b.deviceCode)) throw new HttpError(422, 'invalid', { path: 'deviceCode' });
  const now = deps.now();
  const g = await env.DB.prepare(
    `SELECT id, status, user_id AS userId, label, interval_ms AS intervalMs, expires_at AS expiresAt FROM cli_grants WHERE device_hash = ?`,
  )
    .bind(await sha256Hex(b.deviceCode))
    .first<{ id: string; status: string; userId: string | null; label: string; intervalMs: number; expiresAt: number }>();
  if (!g) throw new HttpError(404, 'unknown-device');
  if (g.status === 'consumed' || g.expiresAt <= now) throw new HttpError(410, 'expired');
  if (g.status === 'denied') throw new HttpError(403, 'denied');

  if (g.status === 'pending') {
    // 간격이 지났으면 last_polled_at을 지금으로. 바뀐 행이 0이면 너무 빠른 폴링이다.
    const r = await env.DB.prepare(
      `UPDATE cli_grants SET last_polled_at = ? WHERE id = ? AND status = 'pending' AND (last_polled_at IS NULL OR last_polled_at + interval_ms <= ?)`,
    )
      .bind(now, g.id, now)
      .run();
    if (r.meta.changes > 0) throw new HttpError(400, 'pending');
    const grow = g.intervalMs < INTERVAL_CAP_MS;
    if (grow) await env.DB.prepare('UPDATE cli_grants SET interval_ms = interval_ms + ? WHERE id = ? AND interval_ms < ?').bind(INTERVAL_STEP_MS, g.id, INTERVAL_CAP_MS).run();
    throw new HttpError(400, 'slow_down', { interval: (g.intervalMs + (grow ? INTERVAL_STEP_MS : 0)) / 1000 });
  }

  const token = `gzc_${base64url(deps.random(32))}`;
  const hash = await sha256Hex(token);
  const tokenId = deps.uuid();
  const expiresAt = now + TOKEN_TTL;
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE cli_grants SET status = 'consumed', consumed_token_hash = ? WHERE id = ? AND status = 'approved' AND consumed_token_hash IS NULL AND expires_at > ?`,
    ).bind(hash, g.id, now),
    env.DB.prepare(
      `INSERT INTO cli_tokens (id, token_hash, user_id, label, scope, created_at, last_used_at, expires_at, revoked_at)
       SELECT ?, ?, ?, ?, 'read', ?, ?, ?, NULL WHERE EXISTS (SELECT 1 FROM cli_grants WHERE id = ? AND consumed_token_hash = ?)`,
    ).bind(tokenId, hash, g.userId, g.label, now, now, expiresAt, g.id, hash),
  ]);
  const mine = await env.DB.prepare('SELECT consumed_token_hash AS hash FROM cli_grants WHERE id = ?').bind(g.id).first<{ hash: string | null }>();
  if (mine?.hash !== hash) throw new HttpError(410, 'expired');
  return { token, tokenId, expiresAt };
}

/** Origin 없는 요청 중 CLI 분기로 받을 것이면 로그에 남길 패턴, 아니면 null */
export function cliEntry(req: Request, url: URL): string | null {
  if (req.method === 'POST' && url.pathname === '/v1/cli/device') return '/v1/cli/device';
  if (req.method === 'POST' && url.pathname === '/v1/cli/token') return '/v1/cli/token';
  return null;
}

export async function handleCli(req: Request, env: SyncEnv, deps: SyncDeps, url: URL): Promise<Response> {
  if (req.method === 'POST' && url.pathname === '/v1/cli/device') return createDevice(req, env, deps, await readJson(req, 4096));
  return json(200, await pollToken(env, deps, await readJson(req, 4096)));
}

/**
 * 앱 세션 사용자가 코드를 확인(approve 없음: 조회만)하거나 승인·거절한다.
 * 없음·만료·이미 처리된 코드는 모두 422 invalid-code(어느 경우인지 알려 주지 않는다).
 */
export async function approveCli(env: SyncEnv, deps: SyncDeps, ctx: AuthContext, body: unknown) {
  const b = isRecord(body) ? body : {};
  if (typeof b.userCode !== 'string') throw new HttpError(422, 'invalid', { path: 'userCode' });
  const code = normalizeUserCode(b.userCode);
  if (code === null) throw new HttpError(422, 'invalid-code');
  if (b.approve !== undefined && typeof b.approve !== 'boolean') throw new HttpError(422, 'invalid', { path: 'approve' });
  const now = deps.now();
  const row = await env.DB.prepare(
    `SELECT id, label, created_at AS createdAt, geo FROM cli_grants WHERE user_code = ? AND status = 'pending' AND expires_at > ?`,
  )
    .bind(code, now)
    .first<{ id: string; label: string; createdAt: number; geo: string | null }>();
  if (!row) throw new HttpError(422, 'invalid-code');
  if (b.approve === undefined) return { label: row.label, createdAt: row.createdAt, geo: row.geo };
  const r = await env.DB.prepare(`UPDATE cli_grants SET status = ?, user_id = ? WHERE id = ? AND status = 'pending' AND expires_at > ?`)
    .bind(b.approve ? 'approved' : 'denied', ctx.userId, row.id, now)
    .run();
  if (r.meta.changes === 0) throw new HttpError(422, 'invalid-code');
  return { label: row.label, createdAt: row.createdAt };
}
