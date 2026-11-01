import { readAuth, removeAuth, writeAuth } from '../config';
import type { Command } from '../context';
import { CliError, toCliError } from '../errors';
import { resolveServer } from '../session';
import { createSyncClient } from '../syncClient';

const INTERVAL_STEP_MS = 5000;
const INTERVAL_CAP_MS = 60_000;
const LABEL_MAX = 64;

/** 기기 코드 흐름(스펙 §6.8). 사람이 앱에서 승인해야 끝나므로 AI 도구가 대신 할 수 없다 */
export const login: Command = async (ctx) => {
  const server = resolveServer(ctx);
  const label = (ctx.args.label ?? `gazua@${ctx.hostname()}`).trim().slice(0, LABEL_MAX);
  if (label === '') throw new CliError('invalid-args', '--label이 비어 있어요');
  const client = createSyncClient({ server, fetchImpl: ctx.fetch });
  const grant = await client.device(label);
  ctx.redact.add(grant.deviceCode);
  ctx.say(`앱의 설정 › 동기화·공유 › CLI 연결에 이 코드를 넣어 주세요: ${grant.userCode} (${Math.round(grant.expiresIn / 60)}분)`);
  ctx.say(grant.verifyUrl);
  const deadline = ctx.now() + grant.expiresIn * 1000;
  let interval = grant.interval * 1000;
  for (;;) {
    await ctx.sleep(interval);
    if (ctx.now() >= deadline) throw new CliError('login-expired');
    const r = await client.token(grant.deviceCode);
    if (r.kind === 'pending') continue;
    if (r.kind === 'slow_down') {
      interval = Math.min(interval + INTERVAL_STEP_MS, INTERVAL_CAP_MS);
      continue;
    }
    ctx.redact.add(r.token);
    writeAuth(ctx.dir, { v: 1, server, token: r.token, tokenId: r.tokenId, label, expiresAt: r.expiresAt });
    return { label, expiresAt: r.expiresAt };
  }
};

/** 서버 토큰을 끊고 auth.json을 지운다. 이미 끊긴 토큰(401 revoked·expired)은 성공으로 본다 */
export const logout: Command = async (ctx) => {
  const { auth, warnings } = readAuth(ctx.dir);
  for (const w of warnings) ctx.warn(w);
  if (!auth) return { serverRevoked: false, fileRemoved: false };
  ctx.redact.add(auth.token);
  let serverRevoked = true;
  try {
    await createSyncClient({ server: auth.server, token: auth.token, fetchImpl: ctx.fetch }).revoke();
  } catch (e) {
    const err = toCliError(e);
    if (err.code !== 'cli-token-revoked' && err.code !== 'cli-token-expired') {
      serverRevoked = false;
      ctx.warn('서버 연결은 앱에서 끊어 주세요(설정 › 동기화·공유 › 로그인한 기기)');
    }
  }
  removeAuth(ctx.dir);
  return { serverRevoked, fileRemoved: true };
};
