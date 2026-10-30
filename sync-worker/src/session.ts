// 기기 세션은 @sch0718/firebase-session이 맡는다(D1 users·sessions, 30일 슬라이딩 만료, 기기별·전체 철회).
// 가즈아는 세션 헤더 이름과 환경값만 넘긴다. 헤더 이름은 설치된 PWA가 보내는 값이라 바꾸지 않는다.
import { createSessionAuth, type AuthContext } from '@sch0718/firebase-session/worker';
import type { SyncDeps, SyncEnv } from './env';

export {
  LABEL_MAX,
  REAUTH_WINDOW,
  SESSION_TTL,
  TOUCH_INTERVAL,
  type AuthContext,
} from '@sch0718/firebase-session/worker';

export const SESSION_HEADER = 'X-Gazua-Session';

// 요청마다 만든다. env(ALLOWED_EMAILS 등)를 그때그때 읽는다.
const sessions = (env: SyncEnv, deps: SyncDeps) => {
  const redirectUris = (env.SOCIAL_REDIRECT_URIS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const provider = (id?: string, secret?: string) => id?.trim() && secret?.trim()
    ? { clientId: id.trim(), clientSecret: secret.trim(), redirectUris }
    : undefined;
  const kakao = provider(env.KAKAO_CLIENT_ID, env.KAKAO_CLIENT_SECRET);
  const naver = provider(env.NAVER_CLIENT_ID, env.NAVER_CLIENT_SECRET);
  return createSessionAuth({
    db: env.DB,
    projectId: env.FIREBASE_PROJECT_ID,
    allowedEmails: env.ALLOWED_EMAILS,
    certs: deps.certs,
    sessionHeader: SESSION_HEADER,
    now: deps.now,
    random: deps.random,
    uuid: deps.uuid,
    ...(kakao || naver ? { social: {
      allowedAccounts: env.ALLOWED_ACCOUNTS,
      ...(kakao && { kakao }),
      ...(naver && { naver }),
      keys: deps.socialKeys,
      ...(deps.socialFetch !== undefined && { fetch: deps.socialFetch }),
    } } : {}),
  });
};

export const createSession = (req: Request, env: SyncEnv, deps: SyncDeps, body: unknown) =>
  sessions(env, deps).create(req, body);
export const createSocialSession = (req: Request, env: SyncEnv, deps: SyncDeps, body: unknown) =>
  sessions(env, deps).createSocial(req, body);
export const authenticate = (req: Request, env: SyncEnv, deps: SyncDeps): Promise<AuthContext> =>
  sessions(env, deps).authenticate(req);
export const listSessions = (env: SyncEnv, deps: SyncDeps, ctx: AuthContext) =>
  sessions(env, deps).list(ctx);
export const revokeSessions = (
  env: SyncEnv,
  deps: SyncDeps,
  ctx: AuthContext,
  target: { id: string } | 'current' | 'others',
) => sessions(env, deps).revoke(ctx, target);
