// 시장 파일 수집 계정 표시(설계 2026-11-03-market-owner-tag 4절). 수집 스크립트가 부른다. MCP 도구로는 내보내지 않는다.
import { readAuth, readDriveAuth, type AuthFile } from '../config';
import type { Command, Ctx } from '../context';
import { CliError } from '../errors';
import { createSyncClient } from '../syncClient';

/** 만료 전 토큰 파일을 drive-auth.json → auth.json 순서로 */
function usableAuths(ctx: Ctx): AuthFile[] {
  const out: AuthFile[] = [];
  for (const read of [readDriveAuth, readAuth]) {
    const { auth, warnings } = read(ctx.dir);
    for (const w of warnings) ctx.warn(w);
    if (!auth) continue;
    ctx.redact.add(auth.token);
    if (auth.expiresAt > ctx.now()) out.push(auth);
  }
  return out;
}

const isTokenError = (e: unknown): boolean => e instanceof CliError && (e.code === 'cli-token-revoked' || e.code === 'cli-token-expired');

export const owner: Command = async (ctx) => {
  const auths = usableAuths(ctx);
  if (auths.length === 0) throw new CliError('not-logged-in', '로그인하지 않았어요. gazua login 또는 gazua drive login을 먼저 실행해 주세요');
  let last: unknown;
  for (const auth of auths) {
    try {
      return { owner: await createSyncClient({ server: auth.server, token: auth.token, fetchImpl: ctx.fetch }).owner() };
    } catch (e) {
      if (!isTokenError(e)) throw e;
      last = e; // 서버가 거절한 토큰이면 남은 파일로 한 번 더
    }
  }
  throw last;
};
