import { describe, expect, it } from 'vitest';
import { PROFILE_DOC_VERSION, APP_OUTDATED_CODE as APP_CODE } from '../../src/lib/sync/dto';
import { CliError, type CliErrorCode } from './errors';
import { APP_OUTDATED_CODE, createSyncClient, DOC_VERSION } from './syncClient';
import { fakeFetch, type FakeReply } from './testing';

const TOKEN = `gzc_${'A'.repeat(43)}`;
/** token을 null로 주면 무인증(Authorization 없음). undefined는 기본 토큰이 되므로 쓰지 않는다 */
const client = (reply: FakeReply | ((path: string) => FakeReply), token: string | null = TOKEN) => {
  const f = fakeFetch((c) => (typeof reply === 'function' ? reply(c.url.pathname + c.url.search) : reply));
  return { c: createSyncClient({ server: 'https://sync.example', ...(token === null ? {} : { token }), fetchImpl: f }), f };
};
const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    return (e as CliError).code;
  }
  return 'no-error';
};

describe('앱과 같은 값', () => {
  it('문서 버전과 앱 갱신 코드가 앱과 같다(번들에 앱의 dto.ts를 끌어오지 않으려고 따로 둔 값)', () => {
    expect(DOC_VERSION).toBe(PROFILE_DOC_VERSION);
    expect(APP_OUTDATED_CODE).toBe(APP_CODE);
  });
});

describe('요청', () => {
  it('Authorization: Gazua-CLI 헤더, Origin 없음, docVersion=2', async () => {
    const { c, f } = client({ body: { revision: 3, doc: { v: 2 } } });
    await c.profile('p 1');
    const call = f.calls[0];
    expect(call.url.href).toBe('https://sync.example/v1/profiles/p%201?docVersion=2');
    expect(call.method).toBe('GET');
    expect(call.headers.get('authorization')).toBe(`Gazua-CLI ${TOKEN}`);
    expect(call.headers.has('origin')).toBe(false);
  });

  it('토큰이 없는 클라이언트는 Authorization을 보내지 않는다(device·token)', async () => {
    const { c, f } = client({ body: { deviceCode: 'd', userCode: 'BCDF-GHJK', verifyUrl: 'https://app/#/settings/sync', interval: 5, expiresIn: 600 } }, null);
    expect(await c.device('gazua@mac')).toMatchObject({ userCode: 'BCDF-GHJK', interval: 5 });
    expect(f.calls[0]).toMatchObject({ method: 'POST', body: { label: 'gazua@mac' } });
    expect(f.calls[0].headers.has('authorization')).toBe(false);
  });

  it('profiles는 색인을, revoke는 DELETE /v1/cli/token을 부른다', async () => {
    const rows = [{ profileId: 'p1', revision: 2, updatedAt: 1, deletedAt: null, purgeAt: null }];
    const a = client({ body: { profiles: rows } });
    expect(await a.c.profiles()).toEqual(rows);
    const b = client({ body: { revoked: true } });
    await b.c.revoke();
    expect(b.f.calls[0]).toMatchObject({ method: 'DELETE' });
    expect(b.f.calls[0].url.pathname).toBe('/v1/cli/token');
  });

  it('token 폴링은 pending·slow_down을 결과로, 200은 토큰으로 돌려준다', async () => {
    expect(await client({ status: 400, body: { error: 'pending' } }, null).c.token('d')).toEqual({ kind: 'pending' });
    expect(await client({ status: 400, body: { error: 'slow_down', interval: 10 } }, null).c.token('d')).toEqual({ kind: 'slow_down' });
    expect(await client({ body: { token: TOKEN, tokenId: 'id1', expiresAt: 5 } }, null).c.token('d')).toEqual({ kind: 'token', token: TOKEN, tokenId: 'id1', expiresAt: 5 });
  });
});

describe('응답 → 오류 코드', () => {
  const cases: [string, FakeReply, CliErrorCode][] = [
    ['401 cli-token-revoked', { status: 401, body: { error: 'cli-token-revoked' } }, 'cli-token-revoked'],
    ['401 cli-token-expired', { status: 401, body: { error: 'cli-token-expired' } }, 'cli-token-expired'],
    ['401 cli-token', { status: 401, body: { error: 'cli-token' } }, 'cli-token-revoked'],
    ['403 cli-scope', { status: 403, body: { error: 'cli-scope' } }, 'cli-scope'],
    ['403 not-allowed', { status: 403, body: { error: 'not-allowed' } }, 'not-allowed'],
    ['403 origin(옛 Worker)', { status: 403, body: { error: 'origin' } }, 'server-outdated'],
    ['404', { status: 404, body: { error: 'not-found' } }, 'server-outdated'],
    ['422 앱 갱신', { status: 422, body: { error: APP_OUTDATED_CODE } }, 'app-outdated'],
    ['422 그 밖', { status: 422, body: { error: 'invalid' } }, 'internal'],
    ['429', { status: 429, body: { error: 'rate-limited' } }, 'rate-limited'],
    ['503 cli-disabled', { status: 503, body: { error: 'cli-disabled' } }, 'server-outdated'],
    ['500', { status: 500, body: { error: 'internal' } }, 'internal'],
    ['연결 실패', new TypeError('fetch failed'), 'network'],
    ['리다이렉트', { status: 307, body: {} }, 'internal'],
  ];
  it.each(cases)('%s', async (_n, reply, want) => {
    expect(await codeOf(client(reply).c.profiles())).toBe(want);
  });

  it('profile(id)가 404 not-found면 profile-not-found, token의 410·403 denied·404 unknown-device', async () => {
    expect(await codeOf(client({ status: 404, body: { error: 'not-found' } }).c.profile('x'))).toBe('profile-not-found');
    expect(await codeOf(client({ status: 410, body: { error: 'expired' } }, null).c.token('d'))).toBe('login-expired');
    expect(await codeOf(client({ status: 410, body: { error: 'gone' } }).c.profile('p1'))).toBe('profile-not-found'); // 목록을 본 뒤 다른 기기에서 지운 프로필
    expect(await codeOf(client({ status: 410, body: { error: 'gone' } }).c.profiles())).toBe('internal');
    expect(await codeOf(client({ status: 403, body: { error: 'denied' } }, null).c.token('d'))).toBe('login-denied');
    expect(await codeOf(client({ status: 404, body: { error: 'unknown-device' } }, null).c.token('d'))).toBe('login-expired');
  });

  it('성공 응답의 모양이 틀리면 internal', async () => {
    expect(await codeOf(client({ body: { profiles: 'x' } }).c.profiles())).toBe('internal');
    expect(await codeOf(client({ body: { revision: 'x' } }).c.profile('p'))).toBe('internal');
    expect(await codeOf(client({ body: {} }, null).c.device('l'))).toBe('internal');
  });
});

describe('시장 파일(Drive 전달)', () => {
  it('device에 scope를 주면 본문에 넣고, 토큰 응답의 scope를 돌려준다', async () => {
    const f = fakeFetch((c) =>
      c.url.pathname === '/v1/cli/device'
        ? { body: { deviceCode: 'd', userCode: 'BCDF-GHJK', verifyUrl: 'u', interval: 5, expiresIn: 600 } }
        : { body: { token: 'gzc_x', tokenId: 'id', expiresAt: 9, scope: 'market-upload' } },
    );
    const c = createSyncClient({ server: 'https://s.test', fetchImpl: f });
    await c.device('gazua-drive@mac', 'market-upload');
    expect(f.calls[0].body).toEqual({ label: 'gazua-drive@mac', scope: 'market-upload' });
    expect(await c.token('d')).toEqual({ kind: 'token', token: 'gzc_x', tokenId: 'id', expiresAt: 9, scope: 'market-upload' });
    await c.device('gazua@mac');
    expect(f.calls[2].body).toEqual({ label: 'gazua@mac' });
  });

  it('market 메서드: 목록 검사, 등록, 삭제, 429 market-limit, 422 market-file-invalid', async () => {
    const row = { id: 'r1', driveFileId: 'drive-file-0001', name: 'market-data-20261031.json.gz', sha256: 'a'.repeat(64), size: 1, version: 4, collectedAt: '2026-10-31T18:00:00+09:00', range: { from: '2021-10-31', to: '2026-10-31' }, stocks: 1, createdAt: 1, updatedAt: 1 };
    let mode = 'ok';
    const f = fakeFetch((c) => {
      if (c.method === 'GET') return { body: { files: [row] } };
      if (c.method === 'DELETE') return { body: { deleted: true } };
      if (mode === 'limit') return { status: 429, body: { error: 'market-limit' } };
      if (mode === 'bad') return { status: 422, body: { error: 'invalid', path: 'name' } };
      return { body: row };
    });
    const c = createSyncClient({ server: 'https://s.test', token: 'gzc_t', fetchImpl: f });
    expect(await c.marketFiles()).toEqual([row]);
    const { id, createdAt, updatedAt, ...body } = row;
    expect(await c.registerMarketFile(body)).toEqual(row);
    await c.deleteMarketFile('r1');
    expect(f.calls.at(-1)?.url.pathname).toBe('/v1/market/files/r1');
    mode = 'limit';
    await expect(c.registerMarketFile(body)).rejects.toMatchObject({ code: 'market-limit' });
    mode = 'bad';
    await expect(c.registerMarketFile(body)).rejects.toMatchObject({ code: 'market-file-invalid' });
  });

  it('market 500은 drive-failed(0006 미적용 포함), 다른 요청의 500은 internal 그대로', async () => {
    const { c } = client({ status: 500, body: { error: 'boom' } });
    expect(await codeOf(c.marketFiles())).toBe('drive-failed');
    expect(await codeOf(c.profiles())).toBe('internal');
  });
});

describe('owner(시장 파일 계정 표시)', () => {
  it('GET /v1/cli/owner의 owner(32자 소문자 hex)를 돌려준다', async () => {
    const { c, f } = client({ body: { owner: 'a'.repeat(32) } });
    expect(await c.owner()).toBe('a'.repeat(32));
    expect(f.calls[0].method).toBe('GET');
    expect(f.calls[0].url.pathname).toBe('/v1/cli/owner');
  });

  it('owner 모양이 틀리면 internal', async () => {
    for (const owner of ['A'.repeat(32), 'a'.repeat(31), 1, undefined]) expect(await codeOf(client({ body: { owner } }).c.owner())).toBe('internal');
  });

  it('403 cli-scope는 서버 업데이트 안내(server-outdated), 401은 토큰 오류 그대로', async () => {
    const scope = client({ status: 403, body: { error: 'cli-scope' } }).c.owner();
    await expect(scope).rejects.toMatchObject({ code: 'server-outdated', message: expect.stringContaining('서버 업데이트가 필요해요(sync-worker 배포)') });
    expect(await codeOf(client({ status: 401, body: { error: 'cli-token-expired' } }).c.owner())).toBe('cli-token-expired');
  });
});
