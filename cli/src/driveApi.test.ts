import { afterEach, describe, expect, it } from 'vitest';
import { createDriveApi } from './driveApi';
import { cleanupDirs, fakeFetch, makeIo } from './testing';
import { createRedactor } from './output';
import { parseArgv } from './args';
import type { Ctx } from './context';

afterEach(cleanupDirs);
function ctxWith(f: typeof fetch) {
  const { io } = makeIo({ fetch: f });
  const ctx: Ctx = { args: parseArgv(['drive', 'upload', 'x']), env: {}, fetch: io.fetch, now: io.now, sleep: io.sleep, hostname: io.hostname, dir: io.dir!, say: () => {}, log: () => {}, warn: () => {}, redact: createRedactor() };
  return ctx;
}
const tokens = () => {
  const calls: boolean[] = [];
  return { calls, token: async (force?: boolean) => (calls.push(!!force), force ? 'fresh' : 'old') };
};

describe('createDriveApi', () => {
  it('resumable 업로드: 메타데이터 POST → Location에 PUT, appDataFolder·표식', async () => {
    const f = fakeFetch((c) => {
      if (c.method === 'POST') return { headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=u1' }, body: {} };
      return { body: { id: 'NEWID12345', md5Checksum: 'm', size: '3' } };
    });
    const t = tokens();
    const api = createDriveApi(ctxWith(f), t.token);
    expect(await api.upload({ name: 'a.json.gz', sha256: 's' }, new Uint8Array([1, 2, 3]))).toEqual({ id: 'NEWID12345', md5Checksum: 'm', size: '3' });
    expect(f.calls[0].url.searchParams.get('uploadType')).toBe('resumable');
    expect(f.calls[0].body).toEqual({ name: 'a.json.gz', parents: ['appDataFolder'], mimeType: 'application/gzip', appProperties: { gazua: 'market-data', sha256: 's' } });
    expect(f.calls[1].method).toBe('PUT');
    expect(f.calls[1].headers.get('Authorization')).toBe('Bearer old');
  });
  it('401이면 토큰을 한 번 새로 받아 다시 한다', async () => {
    let n = 0;
    const f = fakeFetch(() => (n++ === 0 ? { status: 401, body: {} } : { body: { id: 'X1234567890' } }));
    const t = tokens();
    expect(await createDriveApi(ctxWith(f), t.token).get('X1234567890')).toEqual({ id: 'X1234567890' });
    expect(t.calls).toEqual([false, true]);
  });
  it('429·5xx는 1·2·4초 백오프로 세 번까지, 그래도 429면 drive-quota', async () => {
    const f = fakeFetch(() => ({ status: 429, body: {} }));
    const ctx = ctxWith(f);
    const slept: number[] = [];
    ctx.sleep = async (ms) => void slept.push(ms);
    await expect(createDriveApi(ctx, tokens().token).get('X1234567890')).rejects.toMatchObject({ code: 'drive-quota' });
    expect(slept).toEqual([1000, 2000, 4000]);
    expect(f.calls).toHaveLength(4);
  });
  it('get 404는 null, remove 404·204는 성공, 403 storageQuotaExceeded는 drive-quota, 그 밖은 drive-failed', async () => {
    expect(await createDriveApi(ctxWith(fakeFetch(() => ({ status: 404, body: {} }))), tokens().token).get('X1234567890')).toBeNull();
    await createDriveApi(ctxWith(fakeFetch(() => ({ status: 404, body: {} }))), tokens().token).remove('X1234567890');
    await createDriveApi(ctxWith(fakeFetch(() => ({ status: 204 }))), tokens().token).remove('X1234567890');
    const q = fakeFetch(() => ({ status: 403, body: { error: { errors: [{ reason: 'storageQuotaExceeded' }] } } }));
    await expect(createDriveApi(ctxWith(q), tokens().token).upload({ name: 'a', sha256: 's' }, new Uint8Array())).rejects.toMatchObject({ code: 'drive-quota' });
    await expect(createDriveApi(ctxWith(fakeFetch(() => ({ status: 400, body: {} }))), tokens().token).get('X1234567890')).rejects.toMatchObject({ code: 'drive-failed' });
  });
  it('listMarket은 표식 쿼리로 페이지를 넘긴다', async () => {
    const f = fakeFetch((c) => (c.url.searchParams.get('pageToken') ? { body: { files: [{ id: 'B', createdTime: 't2' }] } } : { body: { files: [{ id: 'A', createdTime: 't1' }], nextPageToken: 'n' } }));
    expect(await createDriveApi(ctxWith(f), tokens().token).listMarket()).toEqual([{ id: 'A', createdTime: 't1' }, { id: 'B', createdTime: 't2' }]);
    expect(f.calls[0].url.searchParams.get('spaces')).toBe('appDataFolder');
    expect(f.calls[0].url.searchParams.get('q')).toBe("appProperties has { key='gazua' and value='market-data' }");
  });
});
