// 읽기 전용 CLI(설계 2026-11-01-readonly-cli): 기기 코드 로그인, CLI 토큰 인증, 읽기 전용 허용 목록.
// 원문 기기 코드·토큰은 D1에 두지 않는다(SHA-256 hex만). 원 IP도 두지 않는다(HMAC-SHA256 hex만).
import { base64url, errorBody, HttpError, json, readJson, sha256Hex } from '@sch0718/firebase-session/worker';
import type { SyncDeps, SyncEnv } from './env';

export const CLI_GRANT_TTL = 10 * 60 * 1000;
export const POLL_INTERVAL_MS = 5000;
export const IP_LIMIT = 5;
export const IP_WINDOW_MS = 10 * 60 * 1000;
export const PENDING_LIMIT = 50;
export const CLI_LABEL_MAX = 64;
export const GEO_MAX = 64;
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

/** Origin 없는 요청 중 CLI 분기로 받을 것이면 로그에 남길 패턴, 아니면 null */
export function cliEntry(req: Request, url: URL): string | null {
  if (req.method === 'POST' && url.pathname === '/v1/cli/device') return '/v1/cli/device';
  return null;
}

export async function handleCli(req: Request, env: SyncEnv, deps: SyncDeps, url: URL): Promise<Response> {
  void url;
  return createDevice(req, env, deps, await readJson(req, 4096));
}
