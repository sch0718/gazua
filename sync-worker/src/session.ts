// 기기 세션은 @sch0718/firebase-session이 맡는다(D1 users·sessions, 30일 슬라이딩 만료, 기기별·전체 철회).
// 가즈아는 세션 헤더 이름과 환경값만 넘긴다. 헤더 이름은 설치된 PWA가 보내는 값이라 바꾸지 않는다.
import { createSessionAuth, socialLoginOptions, type AuthContext } from '@sch0718/firebase-session/worker';
import type { SyncDeps, SyncEnv } from './env';
import { allowMember } from './members';

export {
  LABEL_MAX,
  REAUTH_WINDOW,
  SESSION_TTL,
  TOUCH_INTERVAL,
  type AuthContext,
} from '@sch0718/firebase-session/worker';

export const SESSION_HEADER = 'X-Gazua-Session';

// 요청마다 만든다. env(ALLOWED_EMAILS 등)를 그때그때 읽는다.
export const sessions = (env: SyncEnv, deps: SyncDeps) => {
  return createSessionAuth({
    db: env.DB,
    projectId: env.FIREBASE_PROJECT_ID,
    allowedEmails: env.ALLOWED_EMAILS,
    certs: deps.certs,
    sessionHeader: SESSION_HEADER,
    now: deps.now,
    random: deps.random,
    uuid: deps.uuid,
    // 고정 목록 밖 계정은 멤버 표로 판단하고, 가입 요청이면 초대 코드로 멤버가 된다
    isAllowed: allowMember(env, deps),
    social: socialLoginOptions({
      allowedAccounts: env.ALLOWED_ACCOUNTS,
      kakao: { clientId: env.KAKAO_CLIENT_ID, clientSecret: env.KAKAO_CLIENT_SECRET },
      naver: { clientId: env.NAVER_CLIENT_ID, clientSecret: env.NAVER_CLIENT_SECRET },
      redirectUris: env.SOCIAL_REDIRECT_URIS,
      keys: deps.socialKeys,
      fetch: deps.socialFetch,
    }),
  });
};

export const authenticate = (req: Request, env: SyncEnv, deps: SyncDeps): Promise<AuthContext> =>
  sessions(env, deps).authenticate(req);
