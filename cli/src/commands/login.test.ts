import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bundle } from '../../build.mjs';
import { authPath, readAuth, writeAuth } from '../config';
import { COMMANDS, run } from '../main';
import { cleanupDirs, fakeFetch, makeIo, tempDir, type FakeCall, type FakeReply } from '../testing';

afterEach(cleanupDirs);

const GRANT = { deviceCode: 'D'.repeat(43), userCode: 'BCDF-GHJK', verifyUrl: 'https://app.example/#/settings/sync', interval: 5, expiresIn: 600 };
const TOKEN = `gzc_${'T'.repeat(43)}`;

/** 폴링 응답을 차례로 돌려주는 가짜 서버 */
function server(polls: FakeReply[]) {
  let n = 0;
  return fakeFetch((c: FakeCall) => {
    if (c.url.pathname === '/v1/cli/device') return { body: GRANT };
    if (c.url.pathname === '/v1/cli/token') return polls[Math.min(n++, polls.length - 1)];
    return undefined;
  });
}
const pending: FakeReply = { status: 400, body: { error: 'pending' } };
const slow: FakeReply = { status: 400, body: { error: 'slow_down', interval: 10 } };
const granted: FakeReply = { body: { token: TOKEN, tokenId: 'tid-1', expiresAt: 1770000000000 } };

describe('gazua login', () => {
  it('device → pending → slow_down(간격 +5초) → 토큰, auth.json(600)에 쓰고 토큰은 출력하지 않는다', async () => {
    const f = server([pending, slow, granted]);
    const t = makeIo({ fetch: f, env: { GAZUA_SYNC_URL: 'https://sync.example/' } });
    const start = t.clock.now;
    expect(await run(['login'], t.io)).toBe(0);
    expect(t.result()).toEqual({ ok: true, data: { label: 'gazua@testhost', expiresAt: 1770000000000 } });
    expect(t.clock.now - start).toBe(5000 + 5000 + 10_000); // 5초 → pending, 5초 → slow_down, 10초 → 토큰
    expect(readAuth(t.dir).auth).toEqual({ v: 1, server: 'https://sync.example', token: TOKEN, tokenId: 'tid-1', label: 'gazua@testhost', expiresAt: 1770000000000 });
    if (process.platform !== 'win32') expect(statSync(authPath(t.dir)).mode & 0o777).toBe(0o600);
    expect(t.out.join('')).not.toContain(TOKEN);
    expect(t.err.join('')).toContain('BCDF-GHJK');
    expect(t.err.join('')).toContain(GRANT.verifyUrl);
    expect(t.err.join('')).not.toContain(GRANT.deviceCode);
    expect(f.calls[0].body).toEqual({ label: 'gazua@testhost' });
    expect(f.calls.slice(1).every((c) => (c.body as { deviceCode: string }).deviceCode === GRANT.deviceCode)).toBe(true);
  });

  it('간격은 60초를 넘지 않는다', async () => {
    let polls = 0;
    const f = fakeFetch((c) => {
      if (c.url.pathname === '/v1/cli/device') return { body: { ...GRANT, expiresIn: 100_000 } };
      return ++polls <= 14 ? slow : granted;
    });
    const t = makeIo({ fetch: f, env: { GAZUA_SYNC_URL: 'https://sync.example' } });
    const sleeps: number[] = [];
    t.io.sleep = async (ms) => {
      sleeps.push(ms);
      t.clock.now += ms;
    };
    expect(await run(['login'], t.io)).toBe(0);
    expect(Math.max(...sleeps)).toBe(60_000);
  });

  it('expired·denied는 login-expired·login-denied', async () => {
    const a = makeIo({ fetch: server([{ status: 410, body: { error: 'expired' } }]), env: { GAZUA_SYNC_URL: 'https://sync.example' } });
    expect(await run(['login'], a.io)).toBe(1);
    expect(a.result().error.code).toBe('login-expired');
    const b = makeIo({ fetch: server([pending, { status: 403, body: { error: 'denied' } }]), env: { GAZUA_SYNC_URL: 'https://sync.example' } });
    await run(['login'], b.io);
    expect(b.result().error.code).toBe('login-denied');
    expect(existsSync(authPath(b.dir))).toBe(false);
  });

  it('승인이 없이 10분이 지나면 login-expired(CLI 쪽 시한)', async () => {
    const t = makeIo({ fetch: server([pending]), env: { GAZUA_SYNC_URL: 'https://sync.example' } });
    await run(['login'], t.io);
    expect(t.result().error.code).toBe('login-expired');
  });

  it('서버 주소 우선순위: --server > GAZUA_SYNC_URL. 없으면 invalid-args', async () => {
    const f = server([granted]);
    const t = makeIo({ fetch: f, env: { GAZUA_SYNC_URL: 'https://from-env.example' } });
    await run(['login', '--server', 'https://from-flag.example/'], t.io);
    expect(f.calls[0].url.origin).toBe('https://from-flag.example');
    expect(readAuth(t.dir).auth?.server).toBe('https://from-flag.example');
    const none = makeIo();
    expect(await run(['login'], none.io)).toBe(2);
    expect(none.result().error.code).toBe('invalid-args');
  });

  it('https가 아니면 거절하고, localhost의 http만 허용한다', async () => {
    const bad = makeIo({ fetch: server([granted]) });
    expect(await run(['login', '--server', 'http://sync.example'], bad.io)).toBe(2);
    expect(await run(['login', '--server', 'not a url'], makeIo({ fetch: server([granted]) }).io)).toBe(2);
    const local = makeIo({ fetch: server([granted]) });
    expect(await run(['login', '--server', 'http://localhost:8787'], local.io)).toBe(0);
  });

  it('--label을 쓰고 64자로 자른다', async () => {
    const f = server([granted]);
    await run(['login', '--server', 'https://s.example', '--label', 'x'.repeat(80)], makeIo({ fetch: f }).io);
    expect((f.calls[0].body as { label: string }).label).toHaveLength(64);
  });

  it('login·logout은 등록돼 있다', () => {
    expect(COMMANDS.login).toBeTypeOf('function');
    expect(COMMANDS.logout).toBeTypeOf('function');
  });
});

describe('빌드에 넣은 기본 서버 주소', () => {
  it('VITE_SYNC_API_URL이 번들에 상수로 들어가고(끝 슬래시는 뗀다), 없으면 빈 문자열이다', { timeout: 60_000 }, async () => {
    const withUrl = await bundle(join(tempDir(), 'gazua.mjs'), { VITE_SYNC_API_URL: 'https://sync.example.test/' }); // 테스트마다 따로 임시 경로
    const text = readFileSync(withUrl, 'utf8');
    expect(text).toContain('https://sync.example.test');
    expect(text).not.toContain('https://sync.example.test/"');
    const without = await bundle(join(tempDir(), 'gazua.mjs'), { VITE_SYNC_API_URL: '' });
    expect(readFileSync(without, 'utf8')).not.toContain('https://sync.example.test');
  });
});

describe('gazua logout', () => {
  const AUTH = { v: 1 as const, server: 'https://sync.example', token: TOKEN, tokenId: 'tid-1', label: 'gazua@mac', expiresAt: 1770000000000 };

  it('서버에서 토큰을 끊고 auth.json을 지운다', async () => {
    const f = fakeFetch(() => ({ body: { revoked: true } }));
    const t = makeIo({ fetch: f });
    writeAuth(t.dir, AUTH);
    expect(await run(['logout'], t.io)).toBe(0);
    expect(t.result()).toEqual({ ok: true, data: { serverRevoked: true, fileRemoved: true } });
    expect(f.calls[0]).toMatchObject({ method: 'DELETE' });
    expect(f.calls[0].url.href).toBe('https://sync.example/v1/cli/token');
    expect(f.calls[0].headers.get('authorization')).toBe(`Gazua-CLI ${TOKEN}`);
    expect(existsSync(authPath(t.dir))).toBe(false);
  });

  it.each([['cli-token-revoked'], ['cli-token-expired']])('서버가 401 %s면 이미 끊긴 것이라 성공(경고 없음)', async (error) => {
    const t = makeIo({ fetch: fakeFetch(() => ({ status: 401, body: { error } })) });
    writeAuth(t.dir, AUTH);
    await run(['logout'], t.io);
    const r = t.result();
    expect(r).toEqual({ ok: true, data: { serverRevoked: true, fileRemoved: true } });
    expect(existsSync(authPath(t.dir))).toBe(false);
  });

  it('서버에 닿지 않아도 파일은 지우고 warnings를 붙인다', async () => {
    const t = makeIo({ fetch: fakeFetch(() => new TypeError('fetch failed')) });
    writeAuth(t.dir, AUTH);
    expect(await run(['logout'], t.io)).toBe(0);
    const r = t.result();
    expect(r.data).toEqual({ serverRevoked: false, fileRemoved: true });
    expect(r.warnings).toEqual(['서버 연결은 앱에서 끊어 주세요(설정 › 동기화·공유 › 로그인한 기기)']);
    expect(existsSync(authPath(t.dir))).toBe(false);
  });

  it('로그인하지 않았으면 아무것도 하지 않고 성공', async () => {
    const f = fakeFetch(() => ({ body: {} }));
    const t = makeIo({ fetch: f });
    await run(['logout'], t.io);
    expect(t.result().data).toEqual({ serverRevoked: false, fileRemoved: false });
    expect(f.calls).toHaveLength(0);
  });
});
