// cli/src/googleAuth.ts
// Google OAuth(웹 클라이언트, 루프백 리디렉션 + PKCE + 클라이언트 시크릿)로 drive.appdata 갱신 토큰을 받는다(설계 6.3).
// 시크릿·코드·토큰은 출력 거르기에 넣고 파일에는 갱신 토큰만 둔다(config.ts writeDriveToken).
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { Ctx } from './context';
import { CliError } from './errors';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 15_000;

export interface DriveClient {
  clientId: string;
  clientSecret: string;
  port: number;
}
export type WaitForCallback = (port: number, timeoutMs: number) => Promise<URLSearchParams | null>;

export function driveClientFrom(env: Record<string, string | undefined>): DriveClient {
  const clientId = env.GAZUA_DRIVE_CLIENT_ID?.trim() ?? '';
  const clientSecret = env.GAZUA_DRIVE_CLIENT_SECRET?.trim() ?? '';
  if (!clientId || !clientSecret) throw new CliError('drive-not-configured');
  const raw = env.GAZUA_DRIVE_PORT?.trim();
  const port = raw ? Number(raw) : 53682;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new CliError('invalid-args', 'GAZUA_DRIVE_PORT는 1024~65535 사이 정수예요');
  return { clientId, clientSecret, port };
}

export const redirectUri = (c: DriveClient): string => `http://127.0.0.1:${c.port}/`;
const b64url = (b: Buffer) => b.toString('base64url');

/** 127.0.0.1:<port>에서 첫 요청 하나만 받는다. 시간이 지나면 null */
export const listenOnce: WaitForCallback = (port, timeoutMs) =>
  new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const params = new URL(req.url ?? '/', `http://127.0.0.1:${port}`).searchParams;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('<!doctype html><meta charset="utf-8"><title>gazua</title><p>터미널로 돌아가세요</p>');
      clearTimeout(timer);
      server.close();
      resolve(params);
    });
    const timer = setTimeout(() => {
      server.close();
      resolve(null);
    }, timeoutMs);
    server.on('error', (e) => {
      clearTimeout(timer);
      reject(new CliError('invalid-args', `127.0.0.1:${port}를 열 수 없어요(${(e as NodeJS.ErrnoException).code ?? 'error'})`));
    });
    server.listen(port, '127.0.0.1');
  });

async function postForm(ctx: Ctx, url: string, form: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    const res = await ctx.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, body: typeof body === 'object' && body !== null ? body : {} };
  } catch {
    throw new CliError('network');
  }
}

export async function googleLogin(ctx: Ctx, c: DriveClient, wait: WaitForCallback = listenOnce): Promise<string> {
  ctx.redact.add(c.clientSecret);
  const state = b64url(randomBytes(32));
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const u = new URL(AUTH_URL);
  for (const [k, v] of Object.entries({
    response_type: 'code', client_id: c.clientId, redirect_uri: redirectUri(c), scope: DRIVE_SCOPE,
    access_type: 'offline', prompt: 'consent', code_challenge: challenge, code_challenge_method: 'S256', state,
  })) u.searchParams.set(k, v);
  ctx.say('브라우저에서 아래 주소를 열어 Google 계정으로 Drive 앱 데이터 접근을 허락해 주세요(5분)');
  ctx.say(u.toString());
  const params = await wait(c.port, LOGIN_TIMEOUT_MS);
  if (params === null) throw new CliError('drive-login-timeout');
  const code = params.get('code');
  if (params.get('error') || params.get('state') !== state || !code) throw new CliError('drive-denied');
  ctx.redact.add(code);
  const r = await postForm(ctx, TOKEN_URL, {
    grant_type: 'authorization_code', code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: redirectUri(c), code_verifier: verifier,
  });
  const rt = r.body.refresh_token;
  if (typeof r.body.access_token === 'string') ctx.redact.add(r.body.access_token);
  if (r.status !== 200) throw new CliError('drive-failed');
  // 동의 화면에서 범위를 빼고 허락했거나 갱신 토큰을 주지 않았다
  if (typeof rt !== 'string' || !String(r.body.scope ?? '').split(' ').includes(DRIVE_SCOPE)) throw new CliError('drive-denied');
  ctx.redact.add(rt);
  return rt;
}

export async function refreshAccess(ctx: Ctx, c: DriveClient, refreshToken: string): Promise<string> {
  ctx.redact.add(c.clientSecret);
  ctx.redact.add(refreshToken);
  const r = await postForm(ctx, TOKEN_URL, { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: c.clientId, client_secret: c.clientSecret });
  if (r.status === 400 && r.body.error === 'invalid_grant') throw new CliError('drive-login-required');
  if (r.status !== 200 || typeof r.body.access_token !== 'string') throw new CliError('drive-failed');
  ctx.redact.add(r.body.access_token);
  return r.body.access_token;
}

export async function revokeGoogle(ctx: Ctx, token: string): Promise<boolean> {
  ctx.redact.add(token);
  try {
    return (await postForm(ctx, REVOKE_URL, { token })).status === 200;
  } catch {
    return false;
  }
}
