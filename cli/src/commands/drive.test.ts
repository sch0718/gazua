// cli/src/commands/drive.test.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { readDriveAuth, readDriveToken, writeDriveAuth, writeDriveToken } from '../config';
import { run } from '../main';
import { cleanupDirs, fakeFetch, makeIo, tempDir, tinyMarket, type FakeCall } from '../testing';
import { driveDeps } from './drive';

afterEach(cleanupDirs);
const ENV = { GAZUA_DRIVE_CLIENT_ID: 'cid', GAZUA_DRIVE_CLIENT_SECRET: 'csecret', GAZUA_SYNC_URL: 'https://sync.test' };
const SERVER = 'https://sync.test';

function marketFile(name = 'market-data-20261031.json.gz') {
  const p = join(tempDir(), name);
  const bytes = gzipSync(Buffer.from(JSON.stringify(tinyMarket())));
  writeFileSync(p, bytes);
  return { p, bytes, sha: createHash('sha256').update(bytes).digest('hex'), md5: createHash('md5').update(bytes).digest('hex') };
}
function loggedIn(dir: string, now: number) {
  writeDriveAuth(dir, { v: 1, server: SERVER, token: 'gzc_' + 'a'.repeat(43), tokenId: 't1', label: 'gazua-drive@testhost', expiresAt: now + 1e9 });
  writeDriveToken(dir, { v: 1, clientId: 'cid', refreshToken: 'refresh-1', createdAt: 0 });
}
const rowOf = (o: Record<string, unknown>) => ({ id: 'r-new', createdAt: 1, updatedAt: 1, ...o });

/** 동기화 서버 + Google 토큰 + Drive를 함께 흉내 낸다 */
function world(o: { files?: any[]; driveFiles?: { id: string; createdTime: string }[]; putStatus?: number[]; md5?: string; existing?: Record<string, { trashed?: boolean } | null> } = {}) {
  const files = [...(o.files ?? [])];
  const drive = [...(o.driveFiles ?? [])];
  const putStatus = [...(o.putStatus ?? [])];
  const deletedDrive: string[] = [];
  const deletedRows: string[] = [];
  const f = fakeFetch((c: FakeCall) => {
    const u = c.url;
    if (u.href === 'https://oauth2.googleapis.com/token') return { body: { access_token: 'acc', expires_in: 3600 } };
    if (u.origin === SERVER && u.pathname === '/v1/market/files' && c.method === 'GET') return { body: { files } };
    if (u.origin === SERVER && u.pathname === '/v1/market/files' && c.method === 'POST') {
      const s = putStatus.shift() ?? 200;
      if (s !== 200) return { status: s, body: { error: s === 429 ? 'market-limit' : 'invalid' } };
      const b = c.body as Record<string, unknown>;
      const row = rowOf(b);
      files.unshift(row);
      return { body: row };
    }
    const del = /^\/v1\/market\/files\/(.+)$/.exec(u.pathname);
    if (u.origin === SERVER && del && c.method === 'DELETE') {
      deletedRows.push(del[1]);
      files.splice(files.findIndex((x) => x.id === del[1]), 1);
      return { body: { deleted: true } };
    }
    if (u.pathname.startsWith('/upload/drive/v3/files') && c.method === 'POST') return { headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=u1' }, body: {} };
    if (u.pathname.startsWith('/upload/drive/v3/files') && c.method === 'PUT') {
      const bytes = c.body as Uint8Array;
      return { body: { id: 'DRIVENEW123', md5Checksum: o.md5 ?? createHash('md5').update(bytes).digest('hex'), size: String(bytes.byteLength) } };
    }
    const one = /^\/drive\/v3\/files\/(.+)$/.exec(u.pathname);
    if (one && c.method === 'DELETE') return (deletedDrive.push(one[1]), { status: 204, body: {} });
    if (one && c.method === 'GET') {
      const e = o.existing?.[one[1]];
      return e === null || e === undefined ? { status: 404, body: {} } : { body: { id: one[1], ...e } };
    }
    if (u.pathname === '/drive/v3/files' && c.method === 'GET') return { body: { files: drive } };
    return undefined;
  });
  return { f, files, deletedDrive, deletedRows };
}

describe('drive 토큰 오류 안내', () => {
  const revoked = () => fakeFetch((c: FakeCall) => (c.url.href === 'https://oauth2.googleapis.com/token' ? { body: { access_token: 'acc', expires_in: 3600 } } : c.url.origin === SERVER && c.url.pathname === '/v1/market/files' ? { status: 401, body: { error: 'cli-token-revoked' } } : undefined));
  it('upload가 서버 401을 받으면 gazua login이 아니라 drive logout 뒤 drive login을 안내한다', async () => {
    const m = marketFile();
    const { io, dir, result, clock } = makeIo({ env: { ...ENV }, fetch: revoked() });
    loggedIn(dir, clock.now);
    expect(await run(['drive', 'upload', m.p], io)).toBe(1);
    expect(result().error.code).toBe('cli-token-revoked');
    expect(result().error.message).toContain('gazua drive logout 뒤 gazua drive login');
    expect(result().error.message).not.toContain('gazua login');
  });
  it('drive-auth.json이 로컬에서 만료됐으면 gazua drive login을 안내한다', async () => {
    const m = marketFile();
    const { io, dir, result, clock } = makeIo({ env: { ...ENV } });
    loggedIn(dir, clock.now);
    writeDriveAuth(dir, { v: 1, server: SERVER, token: 'gzc_' + 'a'.repeat(43), tokenId: 't1', label: 'gazua-drive@testhost', expiresAt: clock.now - 1 });
    expect(await run(['drive', 'upload', m.p], io)).toBe(1);
    expect(result().error.code).toBe('cli-token-expired');
    expect(result().error.message).toContain('gazua drive login');
    expect(result().error.message).not.toContain('gazua login');
  });
  it('status 경고도 drive 명령을 안내한다', async () => {
    const { io, dir, result, clock } = makeIo({ env: { ...ENV }, fetch: revoked() });
    loggedIn(dir, clock.now);
    expect(await run(['drive', 'status'], io)).toBe(0);
    expect(JSON.stringify(result().warnings)).toContain('gazua drive logout 뒤 gazua drive login');
  });
});

describe('gazua drive upload', () => {
  it('올리고 등록하고 결과를 낸다', async () => {
    const m = marketFile();
    const w = world();
    const { io, dir, result, clock } = makeIo({ env: { ...ENV }, fetch: w.f });
    loggedIn(dir, clock.now);
    expect(await run(['drive', 'upload', m.p], io)).toBe(0);
    expect(result()).toMatchObject({ ok: true, data: { uploaded: true, removed: 0, file: { driveFileId: 'DRIVENEW123', sha256: m.sha, name: 'market-data-20261031.json.gz' } } });
    expect(JSON.stringify(result())).not.toContain('refresh-1');
  });
  it('검증 실패 파일은 토큰 갱신·Drive 요청 없이 market-file-invalid', async () => {
    const p = join(tempDir(), '시장.json.gz');
    writeFileSync(p, gzipSync(Buffer.from(JSON.stringify(tinyMarket()))));
    const w = world();
    const { io, dir, result, clock } = makeIo({ env: { ...ENV }, fetch: w.f });
    loggedIn(dir, clock.now);
    expect(await run(['drive', 'upload', p], io)).toBe(1);
    expect(result().error.code).toBe('market-file-invalid');
    expect(w.f.calls).toHaveLength(0);
  });
  it('같은 sha256이 manifest에 있고 Drive에도 있으면 올리지 않는다', async () => {
    const m = marketFile();
    const w = world({ files: [rowOf({ id: 'r1', driveFileId: 'DRIVEOLD123', name: 'market-data-20261031.json.gz', sha256: m.sha, size: m.bytes.byteLength, version: 1, collectedAt: '2026-10-31T18:00:00+09:00', range: { from: '2026-10-30', to: '2026-10-31' }, stocks: 1 })], existing: { DRIVEOLD123: {} } });
    const { io, dir, result, clock } = makeIo({ env: { ...ENV }, fetch: w.f });
    loggedIn(dir, clock.now);
    expect(await run(['drive', 'upload', m.p], io)).toBe(0);
    expect(result().data.uploaded).toBe(false);
    expect(w.f.calls.some((c) => c.method === 'PUT')).toBe(false);
  });
  it('md5가 다르면 올린 파일을 지우고 drive-failed', async () => {
    const m = marketFile();
    const w = world({ md5: 'different' });
    const { io, dir, result, clock } = makeIo({ env: { ...ENV }, fetch: w.f });
    loggedIn(dir, clock.now);
    expect(await run(['drive', 'upload', m.p], io)).toBe(1);
    expect(result().error.code).toBe('drive-failed');
    expect(w.deletedDrive).toEqual(['DRIVENEW123']);
  });
  it('등록 429면 정리 후 한 번 다시 하고, 그래도 막히면 올린 파일을 지우고 market-limit', async () => {
    const m = marketFile();
    const old = (n: number) => rowOf({ id: `r${n}`, driveFileId: `DRIVEOLD${n}00`, name: `market-data-2026100${n}.json.gz`, sha256: String(n).repeat(64), size: 1, version: 1, collectedAt: `2026-10-0${n}T18:00:00+09:00`, range: { from: '2026-10-01', to: `2026-10-0${n}` }, stocks: 1 });
    const ok = world({ files: [old(3), old(2), old(1)], putStatus: [429, 200] });
    const a = makeIo({ env: { ...ENV }, fetch: ok.f });
    loggedIn(a.dir, a.clock.now);
    expect(await run(['drive', 'upload', m.p], a.io)).toBe(0);
    expect(ok.deletedRows).toContain('r1');
    const stuck = world({ putStatus: [429, 429] });
    const b = makeIo({ env: { ...ENV }, fetch: stuck.f });
    loggedIn(b.dir, b.clock.now);
    expect(await run(['drive', 'upload', m.p], b.io)).toBe(1);
    expect(b.result().error.code).toBe('market-limit');
    expect(stuck.deletedDrive).toContain('DRIVENEW123');
  });
  it('정리는 keep 밖 행과 1시간 지난 고아 파일만 지운다', async () => {
    const m = marketFile();
    const old = (n: number) => rowOf({ id: `r${n}`, driveFileId: `DRIVEOLD${n}00`, name: `market-data-2026100${n}.json.gz`, sha256: String(n).repeat(64), size: 1, version: 1, collectedAt: `2026-10-0${n}T18:00:00+09:00`, range: { from: '2026-10-01', to: `2026-10-0${n}` }, stocks: 1 });
    const { io, dir, result, clock } = makeIo({ env: { ...ENV } });
    const w = world({
      files: [old(2), old(1)],
      driveFiles: [{ id: 'ORPHANOLD12', createdTime: new Date(clock.now - 2 * 3600_000).toISOString() }, { id: 'ORPHANNEW12', createdTime: new Date(clock.now - 60_000).toISOString() }],
    });
    io.fetch = w.f;
    loggedIn(dir, clock.now);
    expect(await run(['drive', 'upload', m.p, '--keep', '2'], io)).toBe(0);
    expect(w.deletedRows).toEqual(['r1']);
    expect(w.deletedDrive.sort()).toEqual(['DRIVEOLD100', 'ORPHANOLD12']);
    expect(result().data.removed).toBe(1);
  });
  it('더 새 수집 파일이 keep개 이상 있으면 올리지 않고 market-file-invalid(올려도 바로 정리되므로)', async () => {
    const m = marketFile(); // collectedAt 2026-10-31T18:00:00+09:00
    const newer = (n: number) => rowOf({ id: `n${n}`, driveFileId: `DRIVENEWER${n}0`, name: `market-data-2026110${n}.json.gz`, sha256: `${n}`.repeat(64), size: 1, version: 1, collectedAt: `2026-11-0${n}T09:00:00Z`, range: { from: '2026-10-01', to: `2026-11-0${n}` }, stocks: 1 });
    const w = world({ files: [newer(2), newer(1)] });
    const { io, dir, result, clock } = makeIo({ env: { ...ENV }, fetch: w.f });
    loggedIn(dir, clock.now);
    expect(await run(['drive', 'upload', m.p, '--keep', '2'], io)).toBe(1);
    expect(result().error.code).toBe('market-file-invalid');
    expect(result().error.message).toContain('--keep');
    expect(w.f.calls.some((c) => c.method === 'PUT')).toBe(false);
    expect(w.deletedRows).toEqual([]);
    // keep을 늘리면 올린다
    const w3 = world({ files: [newer(2), newer(1)] });
    const b = makeIo({ env: { ...ENV }, fetch: w3.f });
    loggedIn(b.dir, b.clock.now);
    expect(await run(['drive', 'upload', m.p, '--keep', '3'], b.io)).toBe(0);
    expect(w3.deletedRows).toEqual([]);
  });
  it('정리 순서는 수집 시각 값으로 정한다(오프셋이 달라도)', async () => {
    const m = marketFile(); // 2026-10-31T09:00Z
    // 문자열로는 '2026-10-31T10:00:00+09:00'(=01:00Z)이 더 커 보이지만 실제로는 더 오래됐다
    const row = (id: string, at: string) => rowOf({ id, driveFileId: `DRIVE${id.toUpperCase()}000000`, name: `${id}.json.gz`, sha256: id.charCodeAt(0).toString(16).repeat(32), size: 1, version: 1, collectedAt: at, range: { from: '2026-10-01', to: '2026-10-31' }, stocks: 1 });
    const w = world({ files: [row('a', '2026-10-31T10:00:00+09:00'), row('b', '2026-10-31T05:00:00Z')] });
    const { io, dir, clock } = makeIo({ env: { ...ENV }, fetch: w.f });
    loggedIn(dir, clock.now);
    expect(await run(['drive', 'upload', m.p, '--keep', '2'], io)).toBe(0);
    expect(w.deletedRows).toEqual(['a']);
  });
  it('로그인 파일이 없으면 drive-login-required', async () => {
    const m = marketFile();
    const { io, result } = makeIo({ env: { ...ENV }, fetch: world().f });
    expect(await run(['drive', 'upload', m.p], io)).toBe(1);
    expect(result().error.code).toBe('drive-login-required');
  });
});

describe('gazua drive login', () => {
  it('market-upload 기기 코드와 Google 로그인을 하고 두 파일을 쓴다', async () => {
    driveDeps.waitForCallback = async () => new URLSearchParams({ code: 'c', state: 'STATE' });
    const f = fakeFetch((c) => {
      if (c.url.pathname === '/v1/cli/device') return { body: { deviceCode: 'd'.repeat(43), userCode: 'BCDF-GHJK', verifyUrl: 'u', interval: 5, expiresIn: 600 } };
      if (c.url.pathname === '/v1/cli/token') return { body: { token: 'gzc_' + 'b'.repeat(43), tokenId: 'tid', expiresAt: 9e15, scope: 'market-upload' } };
      if (c.url.href === 'https://oauth2.googleapis.com/token') return { body: { access_token: 'a', refresh_token: 'rt', scope: 'https://www.googleapis.com/auth/drive.appdata' } };
      return undefined;
    });
    const { io, dir, err } = makeIo({ env: { ...ENV }, fetch: f });
    // googleLogin이 출력한 주소의 state를 받아 돌려준다
    driveDeps.waitForCallback = async () => {
      const url = err.join('').split('\n').find((l) => l.startsWith('https://accounts.google.com/'))!;
      return new URLSearchParams({ code: 'c', state: new URL(url).searchParams.get('state')! });
    };
    expect(await run(['drive', 'login'], io)).toBe(0);
    expect(f.calls[0].body).toEqual({ label: 'gazua-drive@testhost', scope: 'market-upload' });
    expect(readDriveAuth(dir).auth?.tokenId).toBe('tid');
    expect(readDriveToken(dir)).toMatchObject({ clientId: 'cid', refreshToken: 'rt' });
    expect(err.join('')).not.toContain('csecret');
  });
  it('저장된 갱신 토큰이 invalid_grant면 Google 로그인을 다시 하고 덮어쓴다', async () => {
    let n = 0;
    const f = fakeFetch((c) => {
      if (c.url.href === 'https://oauth2.googleapis.com/token') {
        if (String(c.body).includes('refresh_token')) return { status: 400, body: { error: 'invalid_grant' } };
        return { body: { access_token: 'a', refresh_token: 'rt-new', scope: 'https://www.googleapis.com/auth/drive.appdata' } };
      }
      return undefined;
    });
    const { io, dir, err, clock } = makeIo({ env: { ...ENV }, fetch: f });
    loggedIn(dir, clock.now);
    driveDeps.waitForCallback = async () => {
      n++;
      const url = err.join('').split('\n').find((l) => l.startsWith('https://accounts.google.com/'))!;
      return new URLSearchParams({ code: 'c', state: new URL(url).searchParams.get('state')! });
    };
    expect(await run(['drive', 'login'], io)).toBe(0);
    expect(n).toBe(1);
    expect(readDriveToken(dir)).toMatchObject({ clientId: 'cid', refreshToken: 'rt-new' });
  });
  it('저장된 갱신 토큰이 유효하면 Google 로그인을 다시 하지 않는다', async () => {
    let n = 0;
    driveDeps.waitForCallback = async () => (n++, new URLSearchParams());
    const { io, dir, clock } = makeIo({ env: { ...ENV }, fetch: world().f });
    loggedIn(dir, clock.now);
    expect(await run(['drive', 'login'], io)).toBe(0);
    expect(n).toBe(0);
    expect(readDriveToken(dir)).toMatchObject({ refreshToken: 'refresh-1' });
  });
  it('옛 Worker가 scope 없이 토큰을 주면 저장하지 않고 철회를 시도하고 server-outdated', async () => {
    const f = fakeFetch((c) => {
      if (c.url.pathname === '/v1/cli/device') return { body: { deviceCode: 'd'.repeat(43), userCode: 'BCDF-GHJK', verifyUrl: 'u', interval: 5, expiresIn: 600 } };
      if (c.url.pathname === '/v1/cli/token' && c.method === 'POST') return { body: { token: 'gzc_' + 'c'.repeat(43), tokenId: 'tid', expiresAt: 9e15 } };
      if (c.url.pathname === '/v1/cli/token' && c.method === 'DELETE') return { body: { revoked: true } };
      return undefined;
    });
    const { io, dir, result } = makeIo({ env: { ...ENV }, fetch: f });
    expect(await run(['drive', 'login'], io)).toBe(1);
    expect(result().error.code).toBe('server-outdated');
    expect(readDriveAuth(dir).auth).toBeNull();
    expect(f.calls.some((c) => c.method === 'DELETE' && c.url.pathname === '/v1/cli/token')).toBe(true);
  });
  it('설정이 없으면 drive-not-configured', async () => {
    const { io, result } = makeIo({ env: { GAZUA_SYNC_URL: SERVER } });
    expect(await run(['drive', 'login'], io)).toBe(1);
    expect(result().error.code).toBe('drive-not-configured');
  });
});

describe('gazua drive logout·status', () => {
  it('logout은 서버·Google 철회 후 두 파일을 지운다', async () => {
    const f = fakeFetch((c) => (c.url.pathname === '/v1/cli/token' || c.url.href === 'https://oauth2.googleapis.com/revoke' ? { body: {} } : undefined));
    const { io, dir, result, clock } = makeIo({ env: { ...ENV }, fetch: f });
    loggedIn(dir, clock.now);
    expect(await run(['drive', 'logout'], io)).toBe(0);
    expect(result().data).toEqual({ serverRevoked: true, googleRevoked: true, filesRemoved: true });
    expect(readDriveAuth(dir).auth).toBeNull();
    expect(readDriveToken(dir)).toBeNull();
  });
  it('status는 로그인 상태와 목록을 낸다', async () => {
    const w = world();
    const { io, dir, result, clock } = makeIo({ env: { ...ENV }, fetch: w.f });
    loggedIn(dir, clock.now);
    expect(await run(['drive', 'status'], io)).toBe(0);
    expect(result().data).toMatchObject({ google: true, files: [], sync: { label: 'gazua-drive@testhost' } });
  });
  it('모르는 하위 명령은 invalid-args', async () => {
    const { io, result } = makeIo({ env: { ...ENV } });
    expect(await run(['drive', 'nope'], io)).toBe(2);
    expect(result().error.code).toBe('invalid-args');
  });
});
