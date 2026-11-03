// 동기화 API 클라이언트: /v1/cli/*, /v1/profiles. CLI 토큰은 Authorization: Gazua-CLI 헤더로 보낸다(Origin은 보내지 않는다).
// 앱 dto.ts(전략 검증기까지 끌어오는 모듈)를 번들에 넣지 않으려고 두 값을 여기에 따로 두고, 같은지는 테스트가 확인한다.
import { OWNER_TAG_RE } from '../../src/lib/marketData/owner';
import { checkMarketFiles, type MarketFileBody, type MarketFileRow } from '../../src/lib/marketData/manifest';
import { CliError } from './errors';

export const DOC_VERSION = 2;
export const APP_OUTDATED_CODE = '앱을 새로 고쳐 주세요';
const TIMEOUT_MS = 15_000;

export interface DeviceGrant {
  deviceCode: string;
  userCode: string;
  verifyUrl: string;
  interval: number;
  expiresIn: number;
}
export type PollResult = { kind: 'token'; token: string; tokenId: string; expiresAt: number; scope?: string } | { kind: 'pending' } | { kind: 'slow_down' };
export interface ProfileIndexRow {
  profileId: string;
  revision: number;
  updatedAt: number;
  deletedAt: number | null;
  purgeAt: number | null;
}
export interface SyncClient {
  device(label: string, scope?: 'market-upload'): Promise<DeviceGrant>;
  token(deviceCode: string): Promise<PollResult>;
  profiles(): Promise<ProfileIndexRow[]>;
  profile(id: string): Promise<{ revision: number; doc: unknown }>;
  revoke(): Promise<void>;
  marketFiles(): Promise<MarketFileRow[]>;
  registerMarketFile(b: MarketFileBody): Promise<MarketFileRow>;
  deleteMarketFile(id: string): Promise<void>;
  /** 시장 파일 수집 계정 표시(32자 소문자 hex). read·market-upload 토큰 모두 된다 */
  owner(): Promise<string>;
}

type Where = 'device' | 'token' | 'profiles' | 'profile' | 'revoke' | 'market' | 'owner';
type Body = Record<string, unknown>;
const isRecord = (v: unknown): v is Body => typeof v === 'object' && v !== null && !Array.isArray(v);
const internal = (message = '서버 응답 모양이 맞지 않아요') => new CliError('internal', message);

function failFrom(status: number, body: Body, where: Where): CliError {
  const code = typeof body.error === 'string' ? body.error : '';
  if (where === 'market' && status === 500) return new CliError('drive-failed'); // 0006 미적용 서버 포함
  if (where === 'market' && status === 429 && code === 'market-limit') return new CliError('market-limit');
  if (where === 'market' && status === 422) return new CliError('market-file-invalid', `서버가 시장 파일 정보를 받지 않았어요(${typeof body.path === 'string' ? body.path : code || '422'})`);
  // 옛 Worker는 /v1/cli/owner를 모르는 경로로 보고 403 cli-scope를 준다
  if (where === 'owner' && status === 403 && code === 'cli-scope') return new CliError('server-outdated', '서버 업데이트가 필요해요(sync-worker 배포)');
  if (status === 401) return new CliError(code === 'cli-token-expired' ? 'cli-token-expired' : 'cli-token-revoked');
  if (status === 403) {
    if (code === 'denied') return new CliError('login-denied');
    if (code === 'not-allowed') return new CliError('not-allowed');
    if (code === 'cli-scope') return new CliError('cli-scope');
    return new CliError('server-outdated'); // Origin 없는 요청을 403 origin으로 막는 옛 Worker
  }
  if (status === 404) {
    if (where === 'profile' && code === 'not-found') return new CliError('profile-not-found');
    if (where === 'token' && code === 'unknown-device') return new CliError('login-expired');
    return new CliError('server-outdated');
  }
  // 410: 기기 코드 폴링의 expired만 로그인 만료. 삭제된 프로필 조회의 410 gone은 프로필을 못 찾는 것
  if (status === 410) return where === 'token' ? new CliError('login-expired') : where === 'profile' ? new CliError('profile-not-found') : internal(`서버 오류예요(HTTP ${status})`);
  if (status === 422) return code === APP_OUTDATED_CODE ? new CliError('app-outdated') : internal(`서버가 요청을 받지 않았어요(${code || '422'})`);
  if (status === 429) return new CliError('rate-limited');
  if (status === 503 && code === 'cli-disabled') return new CliError('server-outdated');
  return internal(`서버 오류예요(HTTP ${status})`);
}

export function createSyncClient(o: { server: string; token?: string; fetchImpl: typeof fetch; timeoutMs?: number }): SyncClient {
  async function call(method: string, path: string, body?: unknown): Promise<{ status: number; body: Body }> {
    const headers: Record<string, string> = {};
    if (o.token) headers.Authorization = `Gazua-CLI ${o.token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    try {
      const res = await o.fetchImpl(`${o.server}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(o.timeoutMs ?? TIMEOUT_MS),
        redirect: 'manual', // 토큰이 다른 출처로 넘어가지 않게
      });
      const text = await res.text();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        /* 본문이 JSON이 아니면 빈 객체로 본다 */
      }
      return { status: res.status, body: isRecord(parsed) ? parsed : {} };
    } catch {
      throw new CliError('network');
    }
  }
  const must = async (where: Where, method: string, path: string, body?: unknown): Promise<Body> => {
    const r = await call(method, path, body);
    if (r.status !== 200) throw failFrom(r.status, r.body, where);
    return r.body;
  };

  return {
    async device(label, scope) {
      const b = await must('device', 'POST', '/v1/cli/device', scope ? { label, scope } : { label });
      if (typeof b.deviceCode !== 'string' || typeof b.userCode !== 'string' || typeof b.verifyUrl !== 'string' || typeof b.interval !== 'number' || typeof b.expiresIn !== 'number') throw internal();
      return { deviceCode: b.deviceCode, userCode: b.userCode, verifyUrl: b.verifyUrl, interval: b.interval, expiresIn: b.expiresIn };
    },
    async token(deviceCode) {
      const r = await call('POST', '/v1/cli/token', { deviceCode });
      if (r.status === 400 && r.body.error === 'pending') return { kind: 'pending' };
      if (r.status === 400 && r.body.error === 'slow_down') return { kind: 'slow_down' };
      if (r.status !== 200) throw failFrom(r.status, r.body, 'token');
      const b = r.body;
      if (typeof b.token !== 'string' || typeof b.tokenId !== 'string' || typeof b.expiresAt !== 'number') throw internal();
      return { kind: 'token', token: b.token, tokenId: b.tokenId, expiresAt: b.expiresAt, ...(typeof b.scope === 'string' && { scope: b.scope }) };
    },
    async profiles() {
      const b = await must('profiles', 'GET', '/v1/profiles');
      if (!Array.isArray(b.profiles)) throw internal();
      return b.profiles as ProfileIndexRow[];
    },
    async profile(id) {
      const b = await must('profile', 'GET', `/v1/profiles/${encodeURIComponent(id)}?docVersion=${DOC_VERSION}`);
      if (typeof b.revision !== 'number' || !('doc' in b)) throw internal();
      return { revision: b.revision, doc: b.doc };
    },
    async revoke() {
      await must('revoke', 'DELETE', '/v1/cli/token');
    },
    async marketFiles() {
      const files = checkMarketFiles((await must('market', 'GET', '/v1/market/files')).files);
      if (!files) throw internal();
      return files;
    },
    async registerMarketFile(body) {
      const b = await must('market', 'POST', '/v1/market/files', body);
      const [row] = checkMarketFiles([b]) ?? [];
      if (!row) throw internal();
      return row;
    },
    async deleteMarketFile(id) {
      await must('market', 'DELETE', `/v1/market/files/${encodeURIComponent(id)}`);
    },
    async owner() {
      const b = await must('owner', 'GET', '/v1/cli/owner');
      if (typeof b.owner !== 'string' || !OWNER_TAG_RE.test(b.owner)) throw internal();
      return b.owner;
    },
  };
}
