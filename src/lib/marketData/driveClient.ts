// Drive REST(appDataFolder). 실패를 화면 문구용 종류로만 바꾼다. 응답 본문·토큰은 남기지 않는다.
const API = 'https://www.googleapis.com/drive/v3/files';
export const MARKET_QUERY = "appProperties has { key='gazua' and value='market-data' }";
export type DriveFail = { ok: false; kind: 'auth' | 'not-found' | 'quota' | 'offline' | 'failed' };

async function failOf(res: Response): Promise<DriveFail> {
  if (res.status === 401) return { ok: false, kind: 'auth' };
  if (res.status === 404) return { ok: false, kind: 'not-found' };
  if (res.status === 429) return { ok: false, kind: 'quota' };
  if (res.status === 403) {
    const text = await res.text().catch(() => '');
    if (/storageQuotaExceeded|rateLimitExceeded|userRateLimitExceeded/.test(text)) return { ok: false, kind: 'quota' };
  }
  return { ok: false, kind: 'failed' };
}

async function send(f: typeof fetch, url: string, token: string, init: RequestInit = {}): Promise<Response | DriveFail> {
  try {
    return await f(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
  } catch {
    return { ok: false, kind: 'offline' };
  }
}

export async function downloadFile(f: typeof fetch, token: string, id: string, onProgress?: (done: number, total: number | null) => void): Promise<{ ok: true; blob: Blob } | DriveFail> {
  const res = await send(f, `${API}/${encodeURIComponent(id)}?alt=media`, token);
  if (!(res instanceof Response)) return res;
  if (!res.ok) return failOf(res);
  const len = Number(res.headers.get('content-length'));
  const total = Number.isFinite(len) && len > 0 ? len : null;
  if (!res.body) return { ok: true, blob: await res.blob() };
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let done = 0;
  try {
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      parts.push(r.value);
      done += r.value.byteLength;
      onProgress?.(done, total);
    }
  } catch {
    return { ok: false, kind: 'offline' };
  }
  return { ok: true, blob: new Blob(parts as BlobPart[]) };
}

export async function deleteFile(f: typeof fetch, token: string, id: string): Promise<{ ok: true } | DriveFail> {
  const res = await send(f, `${API}/${encodeURIComponent(id)}`, token, { method: 'DELETE' });
  if (!(res instanceof Response)) return res;
  return res.ok || res.status === 404 ? { ok: true } : failOf(res);
}

export async function listMarketFileIds(f: typeof fetch, token: string): Promise<{ ok: true; ids: string[] } | DriveFail> {
  const ids: string[] = [];
  let page: string | undefined;
  do {
    const u = new URL(API);
    u.searchParams.set('spaces', 'appDataFolder');
    u.searchParams.set('q', MARKET_QUERY);
    u.searchParams.set('fields', 'nextPageToken,files(id)');
    u.searchParams.set('pageSize', '100');
    if (page) u.searchParams.set('pageToken', page);
    const res = await send(f, u.toString(), token);
    if (!(res instanceof Response)) return res;
    if (!res.ok) return failOf(res);
    const body = (await res.json().catch(() => null)) as { files?: { id?: unknown }[]; nextPageToken?: unknown } | null;
    for (const x of body?.files ?? []) if (typeof x.id === 'string') ids.push(x.id);
    page = typeof body?.nextPageToken === 'string' ? body.nextPageToken : undefined;
  } while (page);
  return { ok: true, ids };
}
