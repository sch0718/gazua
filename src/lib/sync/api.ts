// sync-worker HTTP 클라이언트. 토큰·세션 헤더, 재시도, 공통 실패 매핑은 @sch0718/firebase-session/client가 한다.
// 여기서는 가즈아 고유 실패(409 conflict, 410 gone)와 profiles·shares·keys 메서드를 더한다.
import {
  createSessionClient,
  type ApiResult as BaseResult,
  type BaseFail,
  type Credentials,
  type DeviceSession,
  type SessionClient,
} from '@sch0718/firebase-session/client';
import type { ShareKind, ShareSnapshot } from '../share/snapshot';
import { PROFILE_DOC_VERSION, type ProfileDoc } from './dto';
import type { RekeyBody, Sealed } from './keyWire';

export type { Credentials, DeviceSession };

/** 설치된 PWA가 보내는 헤더라 바꾸지 않는다(sync-worker의 SESSION_HEADER와 같다). */
export const SESSION_HEADER = 'X-Gazua-Session';

type GazuaFail =
  | {
      ok: false;
      kind: 'conflict';
      revision: number;
      doc: ProfileDoc | null;
      /** 409의 error: conflict·vault-exists·no-vault·vault-changed·not-deleted */
      code?: string;
      vaultRevision?: number | null;
      deleted?: boolean;
      /** 검사 전 값. keySync.ts가 checkVaultHead·checkBlobRows로 본 뒤에만 쓴다 */
      keyVault?: unknown;
      keyBlobs?: unknown;
    }
  | {
      ok: false;
      kind: 'gone';
      deletedAt: number | null;
      purgeAt: number | null;
      revision?: number;
    };

/** 공통 실패(auth·not-allowed·offline·limit·invalid·not-found·server)와 가즈아 고유 실패(conflict·gone) */
export type ApiFail = BaseFail | GazuaFail;
export type ApiResult<T> = BaseResult<T, ApiFail>;

function mapStatus(status: number, body: Record<string, unknown>): GazuaFail | undefined {
  if (status === 409)
    return {
      ok: false,
      kind: 'conflict',
      revision: Number(body.revision ?? 0),
      doc: (body.doc as ProfileDoc | undefined) ?? null,
      ...(typeof body.error === 'string' && { code: body.error }),
      ...('vaultRevision' in body && { vaultRevision: typeof body.vaultRevision === 'number' ? body.vaultRevision : null }),
      ...(typeof body.deleted === 'boolean' && { deleted: body.deleted }),
      ...('keyVault' in body && { keyVault: body.keyVault }),
      ...('keyBlobs' in body && { keyBlobs: body.keyBlobs }),
    };
  if (status === 410) {
    return {
      ok: false,
      kind: 'gone',
      deletedAt: typeof body.deletedAt === 'number' ? body.deletedAt : null,
      purgeAt: typeof body.purgeAt === 'number' ? body.purgeAt : null,
      ...(typeof body.revision === 'number' && { revision: body.revision }),
    };
  }
  return undefined;
}

export interface IndexRow {
  profileId: string;
  revision: number;
  updatedAt: number;
  deletedAt: number | null;
  purgeAt: number | null;
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

export interface SyncApi {
  createSocialSession: SessionClient<GazuaFail>['createSocialSession'];
  createSession(idToken: string, label: string): Promise<ApiResult<{ sessionId: string; expiresAt: number }>>;
  endSession(): Promise<ApiResult<unknown>>;
  endSessionById(id: string): Promise<ApiResult<unknown>>;
  listSessions(): Promise<ApiResult<{ sessions: DeviceSession[] }>>;
  revokeSession(id: string | 'others'): Promise<ApiResult<{ revoked: number }>>;
  listProfiles(): Promise<ApiResult<{ profiles: IndexRow[] }>>;
  getProfile(id: string): Promise<ApiResult<{ revision: number; doc: ProfileDoc }>>;
  putProfile(id: string, body: { opId: string; expectedRevision: number; doc: ProfileDoc }): Promise<ApiResult<{ revision: number }>>;
  deleteProfile(id: string, body: { opId: string; expectedRevision: number }): Promise<ApiResult<{ revision: number; deletedAt: number; purgeAt: number }>>;
  restoreProfile(id: string, opId: string): Promise<ApiResult<{ revision: number; doc: ProfileDoc }>>;
  listRevisions(id: string): Promise<ApiResult<{ revisions: { revision: number; createdAt: number; deleted: boolean }[] }>>;
  getRevision(id: string, rev: number): Promise<ApiResult<{ revision: number; doc: ProfileDoc }>>;
  createShare(body: { sourceProfileId: string; kind: ShareKind; snapshot: ShareSnapshot; ttlDays: number }): Promise<ApiResult<{ id: string; capability: string; expiresAt: number }>>;
  listShares(): Promise<ApiResult<{ shares: ShareRow[] }>>;
  revokeShare(id: string): Promise<ApiResult<{ revoked: boolean }>>;
  readShare(capability: string): Promise<ApiResult<SharedRead>>;
  listKeys(): Promise<ApiResult<{ keyVault: unknown; keyBlobs: unknown }>>;
  getKeyBlob(id: string): Promise<ApiResult<unknown>>;
  createKeyVault(body: { vaultId: string; kdf: 'PBKDF2-SHA256'; iter: number; salt: string; verifier: Sealed }): Promise<ApiResult<{ vaultRevision: number; updatedAt: number }>>;
  putKeyBlob(
    id: string,
    body: { expectedRevision: number; newRevision: number; contentId: string; vaultId: string; vaultRevision: number } & Sealed,
  ): Promise<ApiResult<{ revision: number; updatedAt: number }>>;
  /** 본문 없음 */
  deleteKeyBlob(id: string): Promise<ApiResult<{ deleted: boolean; revision: number }>>;
  rekey(body: RekeyBody): Promise<ApiResult<{ vaultRevision: number; updatedAt: number }>>;
  /** 본문 없음 */
  wipeKeys(): Promise<ApiResult<{ deleted: { vault: boolean; blobs: number } }>>;
}

export function createSyncApi(
  baseUrl: string,
  creds: Credentials,
  fetchImpl: typeof fetch = (...a) => fetch(...a),
): SyncApi {
  const c = createSessionClient<GazuaFail>({
    baseUrl,
    allowSessionOnly: true,
    credentials: creds,
    sessionHeader: SESSION_HEADER,
    fetch: fetchImpl,
    mapStatus,
  });
  const send = c.send;
  const enc = encodeURIComponent;
  const docQuery = `?docVersion=${PROFILE_DOC_VERSION}`;
  return {
    createSession: c.createSession,
    createSocialSession: c.createSocialSession,
    endSession: c.endSession,
    endSessionById: (id) => send('DELETE', '/v1/session', { auth: 'none', headers: { [SESSION_HEADER]: id } }),
    listSessions: c.listSessions,
    revokeSession: c.revokeSession,
    listProfiles: () => send('GET', '/v1/profiles'),
    getProfile: (id) => send('GET', `/v1/profiles/${enc(id)}${docQuery}`),
    putProfile: (id, body) => send('PUT', `/v1/profiles/${enc(id)}${docQuery}`, { body }),
    deleteProfile: (id, body) => send('DELETE', `/v1/profiles/${enc(id)}${docQuery}`, { body }),
    restoreProfile: (id, opId) =>
      send('POST', `/v1/profiles/${enc(id)}/restore${docQuery}`, { body: { opId } }),
    listRevisions: (id) => send('GET', `/v1/profiles/${enc(id)}/revisions`),
    getRevision: (id, rev) => send('GET', `/v1/profiles/${enc(id)}/revisions/${rev}${docQuery}`),
    createShare: (body) => send('POST', '/v1/shares', { body }),
    listShares: () => send('GET', '/v1/shares'),
    revokeShare: (id) => send('DELETE', `/v1/shares/${enc(id)}`),
    readShare: (capability) =>
      send('GET', '/v1/public/share', { auth: 'none', headers: { 'X-Share-Token': capability } }),
    listKeys: () => send('GET', '/v1/keys'),
    getKeyBlob: (id) => send('GET', `/v1/keys/${enc(id)}`),
    createKeyVault: (body) => send('PUT', '/v1/keys/vault', { body }),
    putKeyBlob: (id, body) => send('PUT', `/v1/keys/${enc(id)}`, { body }),
    deleteKeyBlob: (id) => send('DELETE', `/v1/keys/${enc(id)}`),
    rekey: (body) => send('POST', '/v1/keys/rekey', { body }),
    wipeKeys: () => send('DELETE', '/v1/keys'),
  };
}
