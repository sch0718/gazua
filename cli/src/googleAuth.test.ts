// cli/src/googleAuth.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import { DRIVE_SCOPE, driveClientFrom, googleLogin, refreshAccess, revokeGoogle } from './googleAuth';
import { cleanupDirs, fakeFetch, makeIo } from './testing';
import type { Ctx } from './context';
import { createRedactor } from './output';
import { parseArgv } from './args';

afterEach(cleanupDirs);
const env = { GAZUA_DRIVE_CLIENT_ID: 'cid.apps.googleusercontent.com', GAZUA_DRIVE_CLIENT_SECRET: 'csecret' };
function ctxWith(fetchImpl: typeof fetch) {
  const { io, err } = makeIo({ env, fetch: fetchImpl });
  const said: string[] = [];
  const ctx: Ctx = {
    args: parseArgv(['drive', 'login']), env: io.env, fetch: io.fetch, now: io.now, sleep: io.sleep, hostname: io.hostname, dir: io.dir!,
    say: (l) => said.push(l), log: () => {}, warn: () => {}, redact: createRedactor(),
  };
  return { ctx, said, err };
}

describe('driveClientFrom', () => {
  it('두 값이 없으면 drive-not-configured, 포트 기본 53682', () => {
    expect(() => driveClientFrom({})).toThrow(expect.objectContaining({ code: 'drive-not-configured' }));
    expect(driveClientFrom(env)).toEqual({ clientId: env.GAZUA_DRIVE_CLIENT_ID, clientSecret: 'csecret', port: 53682 });
    expect(() => driveClientFrom({ ...env, GAZUA_DRIVE_PORT: '80' })).toThrow(expect.objectContaining({ code: 'invalid-args' }));
  });
});

describe('googleLogin', () => {
  it('state·PKCE로 코드를 받아 교환하고 갱신 토큰을 돌려준다', async () => {
    let authUrl: URL | null = null;
    const f = fakeFetch((c) => {
      expect(c.url.toString()).toBe('https://oauth2.googleapis.com/token');
      const p = new URLSearchParams(c.body as string);
      expect(p.get('grant_type')).toBe('authorization_code');
      expect(p.get('code')).toBe('the-code');
      expect(p.get('redirect_uri')).toBe('http://127.0.0.1:53682/');
      expect(p.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/);
      return { body: { access_token: 'a', refresh_token: 'r-token', scope: DRIVE_SCOPE } };
    });
    const { ctx, said } = ctxWith(f);
    const rt = await googleLogin(ctx, driveClientFrom(env), async (port) => {
      expect(port).toBe(53682);
      authUrl = new URL(said.find((l) => l.startsWith('https://accounts.google.com/'))!);
      return new URLSearchParams({ code: 'the-code', state: authUrl.searchParams.get('state')! });
    });
    expect(rt).toBe('r-token');
    expect(authUrl!.searchParams.get('scope')).toBe(DRIVE_SCOPE);
    expect(authUrl!.searchParams.get('access_type')).toBe('offline');
    expect(authUrl!.searchParams.get('code_challenge_method')).toBe('S256');
    expect(ctx.redact.apply('r-token csecret')).not.toContain('r-token');
  });
  it('state가 다르거나 error면 drive-denied, 시간 초과는 drive-login-timeout', async () => {
    const { ctx } = ctxWith(fakeFetch(() => undefined));
    await expect(googleLogin(ctx, driveClientFrom(env), async () => new URLSearchParams({ code: 'c', state: 'wrong' }))).rejects.toMatchObject({ code: 'drive-denied' });
    await expect(googleLogin(ctx, driveClientFrom(env), async () => new URLSearchParams({ error: 'access_denied' }))).rejects.toMatchObject({ code: 'drive-denied' });
    await expect(googleLogin(ctx, driveClientFrom(env), async () => null)).rejects.toMatchObject({ code: 'drive-login-timeout' });
  });
  it('refresh_token이 없거나 범위가 없으면 drive-denied', async () => {
    for (const body of [{ access_token: 'a', scope: DRIVE_SCOPE }, { access_token: 'a', refresh_token: 'r', scope: 'openid' }]) {
      const { ctx, said } = ctxWith(fakeFetch(() => ({ body })));
      await expect(
        googleLogin(ctx, driveClientFrom(env), async () => new URLSearchParams({ code: 'c', state: new URL(said.find((l) => l.startsWith('https://'))!).searchParams.get('state')! })),
      ).rejects.toMatchObject({ code: 'drive-denied' });
    }
  });
});

describe('refreshAccess·revokeGoogle', () => {
  it('갱신 성공·invalid_grant는 drive-login-required·그 밖은 drive-failed', async () => {
    const ok = ctxWith(fakeFetch(() => ({ body: { access_token: 'acc', expires_in: 3599 } })));
    expect(await refreshAccess(ok.ctx, driveClientFrom(env), 'r')).toBe('acc');
    const bad = ctxWith(fakeFetch(() => ({ status: 400, body: { error: 'invalid_grant' } })));
    await expect(refreshAccess(bad.ctx, driveClientFrom(env), 'r')).rejects.toMatchObject({ code: 'drive-login-required' });
    const down = ctxWith(fakeFetch(() => ({ status: 500, body: {} })));
    await expect(refreshAccess(down.ctx, driveClientFrom(env), 'r')).rejects.toMatchObject({ code: 'drive-failed' });
  });
  it('철회는 성공·실패를 불리언으로', async () => {
    expect(await revokeGoogle(ctxWith(fakeFetch(() => ({ body: {} }))).ctx, 'r')).toBe(true);
    expect(await revokeGoogle(ctxWith(fakeFetch(() => ({ status: 400, body: {} }))).ctx, 'r')).toBe(false);
  });
});
