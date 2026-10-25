// sync-worker HTTP 클라이언트. 응답을 동기화 엔진이 다루는 몇 가지 결과로 나눈다.
// ID 토큰은 매 요청 Authorization: Bearer로, 기기 세션은 X-Gazua-Session으로 보낸다. 토큰·세션은 로그에 남기지 않는다.
import type { ShareKind, ShareSnapshot } from '../share/snapshot';
import type { ProfileDocV1 } from './dto';

export type ApiFail =
  | { ok: false; kind: 'conflict'; revision: number; doc: ProfileDocV1 | null }
  | { ok: false; kind: 'gone'; deletedAt: number | null; purgeAt: number | null; revision?: number }
  /** 다시 로그인해야 한다. code: missing-token·invalid-token·no-session·session-revoked·session-expired·reauth-required */
  | { ok: false; kind: 'auth'; code: string }
  | { ok: false; kind: 'not-allowed' }
  | { ok: false; kind: 'offline' }
  /** 자체 한도(공유 50개)·무료 한도 초과(429·503) */
  | { ok: false; kind: 'limit'; code: string }
  | { ok: false; kind: 'invalid'; code: string; path?: string }
  | { ok: false; kind: 'not-found' }
  | { ok: false; kind: 'server'; status: number };
export type ApiResult<T> = { ok: true; data: T } | ApiFail;

export interface IndexRow {
  profileId: string;
  revision: number;
  updatedAt: number;
  deletedAt: number | null;
  purgeAt: number | null;
}
export interface DeviceSession {
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
  current: boolean;
}
export interface ShareRow {
  id: string;
  kind: ShareKind;
  title: string;
  sourceProfileId: string;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
}
export interface SharedRead {
  kind: ShareKind;
  title: string;
  snapshot: ShareSnapshot;
  createdAt: number;
  expiresAt: number;
}

export interface Credentials {
  /** forceRefresh면 SDK에서 새 ID 토큰을 받는다. 로그인돼 있지 않으면 null. */
  idToken(forceRefresh?: boolean): Promise<string | null>;
  sessionId(): Promise<string | null>;
}

export interface SyncApi {
  createSession(idToken: string, label: string): Promise<ApiResult<{ sessionId: string; expiresAt: number }>>;
  endSession(): Promise<ApiResult<unknown>>;
  listSessions(): Promise<ApiResult<{ sessions: DeviceSession[] }>>;
  revokeSession(id: string | 'others'): Promise<ApiResult<{ revoked: number }>>;
  listProfiles(): Promise<ApiResult<{ profiles: IndexRow[] }>>;
  getProfile(id: string): Promise<ApiResult<{ revision: number; doc: ProfileDocV1 }>>;
  putProfile(id: string, body: { opId: string; expectedRevision: number; doc: ProfileDocV1 }): Promise<ApiResult<{ revision: number }>>;
  deleteProfile(id: string, body: { opId: string; expectedRevision: number }): Promise<ApiResult<{ revision: number; deletedAt: number; purgeAt: number }>>;
  restoreProfile(id: string, opId: string): Promise<ApiResult<{ revision: number; doc: ProfileDocV1 }>>;
  listRevisions(id: string): Promise<ApiResult<{ revisions: { revision: number; createdAt: number; deleted: boolean }[] }>>;
  getRevision(id: string, rev: number): Promise<ApiResult<{ revision: number; doc: ProfileDocV1 }>>;
  createShare(body: { sourceProfileId: string; kind: ShareKind; snapshot: ShareSnapshot; ttlDays: number }): Promise<ApiResult<{ id: string; capability: string; expiresAt: number }>>;
  listShares(): Promise<ApiResult<{ shares: ShareRow[] }>>;
  revokeShare(id: string): Promise<ApiResult<{ revoked: boolean }>>;
  readShare(capability: string): Promise<ApiResult<SharedRead>>;
}

const AUTH_CODES = new Set(['missing-token', 'invalid-token', 'no-session', 'session-revoked', 'session-expired', 'reauth-required']);

async function toResult<T>(res: Response): Promise<ApiResult<T>> {
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // 본문이 없거나 JSON이 아니다
  }
  if (res.ok) return { ok: true, data: body as T };
  const code = typeof body.error === 'string' ? body.error : '';
  switch (res.status) {
    case 401:
      return { ok: false, kind: 'auth', code: AUTH_CODES.has(code) ? code : 'invalid-token' };
    case 403:
      return code === 'not-allowed' ? { ok: false, kind: 'not-allowed' } : { ok: false, kind: 'server', status: 403 };
    case 404:
      return { ok: false, kind: 'not-found' };
    case 409:
      return { ok: false, kind: 'conflict', revision: Number(body.revision ?? 0), doc: (body.doc as ProfileDocV1 | undefined) ?? null };
    case 410:
      return {
        ok: false,
        kind: 'gone',
        deletedAt: typeof body.deletedAt === 'number' ? body.deletedAt : null,
        purgeAt: typeof body.purgeAt === 'number' ? body.purgeAt : null,
        ...(typeof body.revision === 'number' && { revision: body.revision }),
      };
    case 413:
      return { ok: false, kind: 'invalid', code: 'too-large' };
    case 422:
      return { ok: false, kind: 'invalid', code: code || 'invalid', ...(typeof body.path === 'string' && { path: body.path }) };
    case 429:
    case 503:
      return { ok: false, kind: 'limit', code: code || String(res.status) };
    default:
      return { ok: false, kind: 'server', status: res.status };
  }
}

export function createSyncApi(baseUrl: string, creds: Credentials, fetchImpl: typeof fetch = (...a) => fetch(...a)): SyncApi {
  const base = baseUrl.replace(/\/+$/, '');

  async function send<T>(method: string, path: string, opts: { body?: unknown; auth?: 'session' | 'token' | 'none'; headers?: Record<string, string>; token?: string } = {}): Promise<ApiResult<T>> {
    const auth = opts.auth ?? 'session';
    const attempt = async (force: boolean): Promise<ApiResult<T>> => {
      const headers: Record<string, string> = { ...opts.headers };
      if (auth !== 'none') {
        const token = opts.token ?? (await creds.idToken(force));
        if (!token) return { ok: false, kind: 'auth', code: 'missing-token' };
        headers.Authorization = `Bearer ${token}`;
        if (auth === 'session') {
          const s = await creds.sessionId();
          if (!s) return { ok: false, kind: 'auth', code: 'no-session' };
          headers['X-Gazua-Session'] = s;
        }
      }
      if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
      let res: Response;
      try {
        res = await fetchImpl(base + path, {
          method,
          headers,
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          cache: 'no-store',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        });
      } catch {
        return { ok: false, kind: 'offline' };
      }
      return toResult<T>(res);
    };
    const first = await attempt(false);
    // 만료 직전에 받은 ID 토큰이면 한 번만 새로 받아 다시 보낸다
    if (!first.ok && first.kind === 'auth' && first.code === 'invalid-token' && auth !== 'none' && !opts.token) return attempt(true);
    return first;
  }

  const enc = encodeURIComponent;
  return {
    createSession: (idToken, label) => send('POST', '/v1/session', { auth: 'token', token: idToken, body: { label } }),
    endSession: () => send('DELETE', '/v1/session'),
    listSessions: () => send('GET', '/v1/sessions'),
    revokeSession: (id) => (id === 'others' ? send('DELETE', '/v1/sessions?others=1') : send('DELETE', `/v1/sessions/${enc(id)}`)),
    listProfiles: () => send('GET', '/v1/profiles'),
    getProfile: (id) => send('GET', `/v1/profiles/${enc(id)}`),
    putProfile: (id, body) => send('PUT', `/v1/profiles/${enc(id)}`, { body }),
    deleteProfile: (id, body) => send('DELETE', `/v1/profiles/${enc(id)}`, { body }),
    restoreProfile: (id, opId) => send('POST', `/v1/profiles/${enc(id)}/restore`, { body: { opId } }),
    listRevisions: (id) => send('GET', `/v1/profiles/${enc(id)}/revisions`),
    getRevision: (id, rev) => send('GET', `/v1/profiles/${enc(id)}/revisions/${rev}`),
    createShare: (body) => send('POST', '/v1/shares', { body }),
    listShares: () => send('GET', '/v1/shares'),
    revokeShare: (id) => send('DELETE', `/v1/shares/${enc(id)}`),
    readShare: (capability) => send('GET', '/v1/public/share', { auth: 'none', headers: { 'X-Share-Token': capability } }),
  };
}
