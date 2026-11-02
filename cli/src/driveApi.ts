// Drive REST v3(appDataFolder). 401은 토큰을 한 번 새로 받아 다시, 429·5xx는 1·2·4초 백오프로 세 번까지 다시 한다(설계 6.4).
import type { Ctx } from './context';
import { CliError } from './errors';

const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const QUERY = "appProperties has { key='gazua' and value='market-data' }";
const BACKOFF_MS = [1000, 2000, 4000];
const TIMEOUT_MS = 10 * 60 * 1000;
// 업로드 PUT은 느린 회선(초당 64 KiB)에서도 끝나게 크기에 맞춰 늘린다
const UPLOAD_BYTES_PER_SEC = 64 * 1024;

export interface DriveFileInfo {
  id: string;
  md5Checksum?: string;
  size?: string;
  trashed?: boolean;
  createdTime?: string;
}
export interface DriveApi {
  get(id: string): Promise<DriveFileInfo | null>;
  upload(meta: { name: string; sha256: string }, bytes: Uint8Array): Promise<DriveFileInfo>;
  remove(id: string): Promise<void>;
  listMarket(): Promise<DriveFileInfo[]>;
}

export function createDriveApi(ctx: Ctx, token: (force?: boolean) => Promise<string>): DriveApi {
  async function call(method: string, url: string, init: { headers?: Record<string, string>; body?: BodyInit; timeoutMs?: number } = {}): Promise<Response> {
    let refreshed = false;
    let force = false;
    let retries = 0;
    for (;;) {
      // 강제 갱신은 401 직후 한 번만. 401 재시도는 백오프 횟수에 세지 않는다
      const t = await token(force);
      force = false;
      let res: Response;
      try {
        res = await ctx.fetch(url, { method, body: init.body, headers: { ...init.headers, Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(init.timeoutMs ?? TIMEOUT_MS) });
      } catch {
        throw new CliError('network');
      }
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        force = true;
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && retries < BACKOFF_MS.length) {
        await ctx.sleep(BACKOFF_MS[retries++]);
        continue;
      }
      return res;
    }
  }
  async function failOf(res: Response): Promise<CliError> {
    if (res.status === 401) return new CliError('drive-login-required');
    const text = await res.text().catch(() => '');
    if (res.status === 429 || (res.status === 403 && /storageQuotaExceeded|rateLimitExceeded|userRateLimitExceeded/.test(text))) return new CliError('drive-quota');
    return new CliError('drive-failed', `Drive 요청이 실패했어요(HTTP ${res.status})`);
  }
  const json = async (res: Response) => (await res.json()) as Record<string, unknown>;

  return {
    async get(id) {
      const res = await call('GET', `${FILES}/${encodeURIComponent(id)}?fields=id,md5Checksum,size,trashed`);
      if (res.status === 404) return null;
      if (!res.ok) throw await failOf(res);
      return (await json(res)) as unknown as DriveFileInfo;
    },
    async upload(meta, bytes) {
      const start = await call('POST', `${UPLOAD}?uploadType=resumable&fields=id,md5Checksum,size`, {
        headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/gzip', 'X-Upload-Content-Length': String(bytes.byteLength) },
        body: JSON.stringify({ name: meta.name, parents: ['appDataFolder'], mimeType: 'application/gzip', appProperties: { gazua: 'market-data', sha256: meta.sha256 } }),
      });
      if (!start.ok) throw await failOf(start);
      const session = start.headers.get('Location');
      if (!session?.startsWith('https://www.googleapis.com/')) throw new CliError('drive-failed', 'Drive 업로드 주소를 받지 못했어요');
      const put = await call('PUT', session, {
        headers: { 'Content-Type': 'application/gzip' },
        body: bytes as BodyInit,
        timeoutMs: Math.max(TIMEOUT_MS, Math.ceil(bytes.byteLength / UPLOAD_BYTES_PER_SEC) * 1000),
      });
      if (!put.ok) throw await failOf(put);
      return (await json(put)) as unknown as DriveFileInfo;
    },
    async remove(id) {
      const res = await call('DELETE', `${FILES}/${encodeURIComponent(id)}`);
      if (!res.ok && res.status !== 404) throw await failOf(res);
    },
    async listMarket() {
      const out: DriveFileInfo[] = [];
      let page: string | undefined;
      do {
        const u = new URL(FILES);
        u.searchParams.set('spaces', 'appDataFolder');
        u.searchParams.set('q', QUERY);
        u.searchParams.set('fields', 'nextPageToken,files(id,createdTime)');
        u.searchParams.set('pageSize', '100');
        if (page) u.searchParams.set('pageToken', page);
        const res = await call('GET', u.toString());
        if (!res.ok) throw await failOf(res);
        const b = await json(res);
        for (const f of (b.files as DriveFileInfo[] | undefined) ?? []) if (typeof f.id === 'string') out.push(f);
        page = typeof b.nextPageToken === 'string' ? b.nextPageToken : undefined;
      } while (page);
      return out;
    },
  };
}
