// 로그인 세션: 서버 주소 정하기, auth.json 읽기, 인증된 동기화 클라이언트.
import { readAuth, type AuthFile } from './config';
import type { Ctx } from './context';
import { CliError } from './errors';
import { createSyncClient, type SyncClient } from './syncClient';

// 빌드 때 esbuild define이 넣는 기본 서버 주소(VITE_SYNC_API_URL). 정의되지 않은 환경(테스트)에서는 ''.
declare const __GAZUA_DEFAULT_SERVER__: string | undefined;
const DEFAULT_SERVER = typeof __GAZUA_DEFAULT_SERVER__ === 'string' ? __GAZUA_DEFAULT_SERVER__ : '';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** https만. 로컬 개발(localhost·127.0.0.1·[::1])의 http만 예외. 경로·쿼리는 버리고 origin으로 */
export function normalizeServer(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new CliError('invalid-args', '서버 주소가 올바른 URL이 아니에요');
  }
  if (u.protocol === 'https:' || (u.protocol === 'http:' && LOCAL_HOSTS.has(u.hostname))) return u.origin;
  throw new CliError('invalid-args', '서버 주소는 https여야 해요(로컬 개발의 localhost만 http를 써요)');
}

export function resolveServer(ctx: Ctx): string {
  const raw = ctx.args.server ?? ctx.env.GAZUA_SYNC_URL ?? DEFAULT_SERVER;
  if (raw.trim() === '') throw new CliError('invalid-args', '서버 주소가 없어요. --server 또는 GAZUA_SYNC_URL로 알려 주세요');
  return normalizeServer(raw);
}

/** 로그인했는지 보고 auth.json을 돌려준다. 토큰은 출력 거르기에 등록한다 */
export function requireAuth(ctx: Ctx): AuthFile {
  const { auth, warnings } = readAuth(ctx.dir);
  for (const w of warnings) ctx.warn(w);
  if (!auth) throw new CliError('not-logged-in');
  ctx.redact.add(auth.token);
  if (auth.expiresAt <= ctx.now()) throw new CliError('cli-token-expired');
  return auth;
}

export function authedClient(ctx: Ctx): SyncClient {
  const auth = requireAuth(ctx);
  return createSyncClient({ server: auth.server, token: auth.token, fetchImpl: ctx.fetch });
}
