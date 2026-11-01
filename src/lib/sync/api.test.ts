import { describe, expect, it, vi } from 'vitest';
import { SESSION_HEADER, createSyncApi } from './api';
import { deviceApi, testServer } from '../../../sync-worker/test/server';
import { doc, docV2 } from '../../../sync-worker/test/docs';

describe('createSyncApi', () => {
  it('프로필 요청에 docVersion=2를 붙인다(§8.3)', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}'));
    const api = createSyncApi('https://sync.example.test', { idToken: async () => 't', sessionId: async () => 's' }, fetchImpl);
    await Promise.allSettled([
      api.getProfile('p1'),
      api.putProfile('p1', { opId: 'o', expectedRevision: 0, doc: {} as never }),
      api.deleteProfile('p1', { opId: 'o', expectedRevision: 1 }),
      api.restoreProfile('p1', 'o'),
      api.getRevision('p1', 3),
    ]);
    const urls = vi.mocked(fetchImpl as typeof fetch).mock.calls.map(([u]) => String(u));
    expect(urls).toHaveLength(5);
    for (const u of urls) expect(new URL(u).searchParams.get('docVersion')).toBe('2');
  });

  it('지정한 세션만 철회할 때 현재 세션과 Google 토큰을 보내지 않아요', async () => {
    const creds = { idToken: vi.fn(async () => 'current-token'), sessionId: vi.fn(async () => 'current-session') };
    const fetchImpl = vi.fn(async () => new Response('{}'));
    const api = createSyncApi('https://sync.example.test', creds, fetchImpl);
    expect((await api.endSessionById('late-session')).ok).toBe(true);
    const [url, init] = vi.mocked(fetchImpl as typeof fetch).mock.calls[0];
    expect(String(url)).toBe('https://sync.example.test/v1/session');
    expect(init?.method).toBe('DELETE');
    const headers = new Headers(init?.headers);
    expect(headers.get(SESSION_HEADER)).toBe('late-session');
    expect(headers.has('Authorization')).toBe(false);
    expect(creds.idToken).not.toHaveBeenCalled();
    expect(creds.sessionId).not.toHaveBeenCalled();
  });

  it('v2 문서를 저장·읽기·삭제·복원하고 과거 리비전을 읽는다', async () => {
    const { api } = await deviceApi(testServer());
    const d = docV2();
    expect(await api.putProfile('p1', { opId: 'op-1', expectedRevision: 0, doc: d })).toEqual({ ok: true, data: { revision: 1 } });
    expect(await api.getProfile('p1')).toEqual({ ok: true, data: { revision: 1, doc: d } });
    expect(await api.deleteProfile('p1', { opId: 'op-2', expectedRevision: 2 })).toMatchObject({
      ok: false, kind: 'conflict', revision: 1, doc: d,
    });
    expect(await api.deleteProfile('p1', { opId: 'op-3', expectedRevision: 1 })).toMatchObject({ ok: true, data: { revision: 2 } });
    expect(await api.restoreProfile('p1', 'op-4')).toEqual({ ok: true, data: { revision: 3, doc: d } });
    expect(await api.getRevision('p1', 1)).toEqual({ ok: true, data: { revision: 1, doc: d } });
  });

  // Codex 리뷰(PR #39) 3: 오프라인에서 토큰 갱신이 실패해도 예외로 새지 않고 실패 결과가 된다(엔진이 백오프·재시도로 넘어가게).
  it('ID 토큰을 받다 실패하면 offline 실패로 돌려준다', async () => {
    const fetchImpl = vi.fn();
    const api = createSyncApi('https://sync.example.test', { idToken: async () => Promise.reject(new Error('auth/network-request-failed')), sessionId: async () => 's' }, fetchImpl);
    expect(await api.listProfiles()).toEqual({ ok: false, kind: 'offline' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('CLI 연결: 조회 → 거절·승인 → 토큰 목록 → 끊기', async () => {
    const s = testServer();
    const { api } = await deviceApi(s);
    const dev = (await (await s.h.call('POST', '/v1/cli/device', { origin: null, token: null, body: { label: 'gazua@mac' }, headers: { 'CF-Connecting-IP': '203.0.113.5' } })).json()) as { userCode: string; deviceCode: string };
    expect(await api.cliApprove(dev.userCode)).toEqual({ ok: true, data: { label: 'gazua@mac', createdAt: s.h.clock.now, geo: null } });
    expect(await api.cliApprove('ZZZZ-ZZZZ')).toMatchObject({ ok: false, kind: 'invalid', code: 'invalid-code' });
    expect(await api.cliApprove(dev.userCode, true)).toEqual({ ok: true, data: { label: 'gazua@mac', createdAt: s.h.clock.now } });
    const tok = (await (await s.h.call('POST', '/v1/cli/token', { origin: null, token: null, body: { deviceCode: dev.deviceCode } })).json()) as { tokenId: string };
    expect(await api.cliTokens()).toMatchObject({ ok: true, data: { tokens: [{ id: tok.tokenId, label: 'gazua@mac' }] } });
    expect(await api.cliRevoke(tok.tokenId)).toEqual({ ok: true, data: { revoked: true } });
    expect(await api.cliTokens()).toEqual({ ok: true, data: { tokens: [] } });
    expect(await api.cliRevoke('nope')).toMatchObject({ ok: false, kind: 'not-found' });
  });
  it('CLI 경로가 없는 옛 Worker는 not-found로 읽는다', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"error":"not-found"}', { status: 404 }));
    const api = createSyncApi('https://sync.example.test', { idToken: async () => 't', sessionId: async () => 's' }, fetchImpl);
    expect(await api.cliApprove('BCDF-GHJK')).toMatchObject({ ok: false, kind: 'not-found' });
    expect(await api.cliTokens()).toMatchObject({ ok: false, kind: 'not-found' });
  });

});

describe('키 금고 메서드', () => {
  const A = (n: number, c: string) => c.repeat(n);
  const vault = (vaultId = A(24, 'V')) => ({ vaultId, kdf: 'PBKDF2-SHA256' as const, iter: 600000, salt: A(24, 'S'), verifier: { nonce: A(16, 'N'), ciphertext: A(56, 'C') } });

  it('금고·블롭·목록·끄기·전체 삭제가 서버와 왕복하고, 409는 code와 금고·목록을 담는다', async () => {
    const s = testServer();
    const { api } = await deviceApi(s);
    expect((await api.putProfile('p1', { opId: 'op-1', expectedRevision: 0, doc: doc() })).ok).toBe(true);
    expect(await api.createKeyVault(vault())).toEqual({ ok: true, data: { vaultRevision: 1, updatedAt: s.h.clock.now } });
    const exists = await api.createKeyVault(vault(A(24, 'W')));
    expect(exists).toMatchObject({ ok: false, kind: 'conflict', code: 'vault-exists' });
    expect(exists.ok === false && exists.kind === 'conflict' && exists.keyVault).toMatchObject({ vaultId: A(24, 'V') });
    const body = { expectedRevision: 0, newRevision: 1, contentId: A(24, 'I'), vaultId: A(24, 'V'), vaultRevision: 1, nonce: A(16, 'N'), ciphertext: A(64, 'X') };
    expect(await api.putKeyBlob('p1', body)).toEqual({ ok: true, data: { revision: 1, updatedAt: s.h.clock.now } });
    expect(await api.putKeyBlob('p1', { ...body, contentId: A(24, 'J'), nonce: A(16, 'O') })).toMatchObject({ ok: false, kind: 'conflict', code: 'conflict', revision: 1, vaultRevision: 1, deleted: false });
    // 첫 요청과 nonce가 다르게: 같은 newRevision·nonce면 서버가 재전송으로 보고 200을 준다(설계 4.5)
    expect(await api.putKeyBlob('p1', { ...body, nonce: A(16, 'P'), vaultRevision: 2 })).toMatchObject({ ok: false, kind: 'conflict', code: 'vault-changed', vaultRevision: 1 });
    const list = await api.listKeys();
    expect(list.ok && (list.data.keyBlobs as unknown[]).length).toBe(1);
    expect(await api.getKeyBlob('p1')).toMatchObject({ ok: true, data: { revision: 1, ciphertext: A(64, 'X') } });
    expect(await api.getKeyBlob('p9')).toEqual({ ok: false, kind: 'not-found' });
    expect(await api.deleteKeyBlob('p1')).toEqual({ ok: true, data: { deleted: true, revision: 2 } });
    const rk = await api.rekey({ expectedVaultId: A(24, 'V'), expectedVaultRevision: 1, salt: A(24, 'T'), verifier: { nonce: A(16, 'M'), ciphertext: A(56, 'D') }, keyBlobs: [] });
    expect(rk).toEqual({ ok: true, data: { vaultRevision: 2, updatedAt: s.h.clock.now } });
    expect(await api.wipeKeys()).toEqual({ ok: true, data: { deleted: { vault: true, blobs: 1 } } });
    expect(await api.putKeyBlob('p1', { ...body, expectedRevision: 2, newRevision: 3 })).toMatchObject({ ok: false, kind: 'conflict', code: 'no-vault', vaultRevision: null });
    expect(await api.createKeyVault({ ...vault(), iter: 310000 })).toMatchObject({ ok: false, kind: 'invalid', code: 'invalid' });
  });

  it('두 DELETE는 본문을 보내지 않는다', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"deleted":false,"revision":0}'));
    const api = createSyncApi('https://sync.example.test', { idToken: async () => 't', sessionId: async () => 's' }, fetchImpl);
    await api.deleteKeyBlob('p1');
    await api.wipeKeys();
    const calls = vi.mocked(fetchImpl as typeof fetch).mock.calls;
    expect(calls.map(([url, init]) => [String(url), init?.method, init?.body ?? null])).toEqual([
      ['https://sync.example.test/v1/keys/p1', 'DELETE', null],
      ['https://sync.example.test/v1/keys', 'DELETE', null],
    ]);
  });
});
