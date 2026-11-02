import { describe, expect, it } from 'vitest';
import { deleteFile, downloadFile, listMarketFileIds } from './driveClient';

const respond = (status: number, body: BodyInit | null = null, headers: Record<string, string> = {}) => async () => new Response(body, { status, headers });

describe('downloadFile', () => {
  it('alt=media로 받아 Blob과 진행률을 준다', async () => {
    const seen: string[] = [];
    const progress: [number, number | null][] = [];
    const f = (async (url: string, init?: RequestInit) => {
      seen.push(`${url} ${new Headers(init?.headers).get('Authorization')}`);
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-length': '3' } });
    }) as typeof fetch;
    const r = await downloadFile(f, 'tok', 'FILEID12345', (d, t) => progress.push([d, t]));
    expect(r.ok && r.blob.size).toBe(3);
    expect(seen).toEqual(['https://www.googleapis.com/drive/v3/files/FILEID12345?alt=media Bearer tok']);
    expect(progress.at(-1)).toEqual([3, 3]);
  });
  it.each([
    [401, 'auth'],
    [404, 'not-found'],
    [429, 'quota'],
    [500, 'failed'],
  ])('%i → %s', async (status, kind) => {
    expect(await downloadFile(respond(status) as unknown as typeof fetch, 't', 'FILEID12345')).toEqual({ ok: false, kind });
  });
  it('403 storageQuotaExceeded·rateLimitExceeded는 quota, 그 밖 403은 failed, 네트워크 실패는 offline', async () => {
    const q = JSON.stringify({ error: { errors: [{ reason: 'rateLimitExceeded' }] } });
    expect(await downloadFile(respond(403, q) as unknown as typeof fetch, 't', 'FILEID12345')).toEqual({ ok: false, kind: 'quota' });
    expect(await downloadFile(respond(403, '{}') as unknown as typeof fetch, 't', 'FILEID12345')).toEqual({ ok: false, kind: 'failed' });
    const off = (async () => { throw new TypeError('fail'); }) as unknown as typeof fetch;
    expect(await downloadFile(off, 't', 'FILEID12345')).toEqual({ ok: false, kind: 'offline' });
  });
});

describe('deleteFile·listMarketFileIds', () => {
  it('삭제 404는 성공으로 본다', async () => {
    expect(await deleteFile(respond(404) as unknown as typeof fetch, 't', 'FILEID12345')).toEqual({ ok: true });
    expect(await deleteFile(respond(204) as unknown as typeof fetch, 't', 'FILEID12345')).toEqual({ ok: true });
  });
  it('appDataFolder에서 gazua 표식 파일 ID를 페이지를 넘기며 모은다', async () => {
    const urls: URL[] = [];
    const f = (async (url: string) => {
      const u = new URL(url);
      urls.push(u);
      const body = u.searchParams.get('pageToken') ? { files: [{ id: 'B' }] } : { files: [{ id: 'A' }], nextPageToken: 'n' };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    expect(await listMarketFileIds(f, 't')).toEqual({ ok: true, ids: ['A', 'B'] });
    expect(urls[0].searchParams.get('spaces')).toBe('appDataFolder');
    expect(urls[0].searchParams.get('q')).toBe("appProperties has { key='gazua' and value='market-data' }");
  });
});
