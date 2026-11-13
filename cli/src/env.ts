// 증권사 키는 환경변수로만 받는다(--env-file은 main이 읽는다). 파일에는 쓰지 않는다.
import { CliError } from './errors';

export type ProviderId = 'kis' | 'toss';
export interface Creds {
  kis?: { appKey: string; appSecret: string };
  toss?: { clientId: string; clientSecret: string };
}

const val = (env: Record<string, string | undefined>, name: string): string => (env[name] ?? '').trim();

export function readCreds(env: Record<string, string | undefined>): Creds {
  const appKey = val(env, 'KIS_APP_KEY');
  const appSecret = val(env, 'KIS_APP_SECRET');
  const clientId = val(env, 'TOSS_CLIENT_ID');
  const clientSecret = val(env, 'TOSS_CLIENT_SECRET');
  return {
    ...(appKey && appSecret ? { kis: { appKey, appSecret } } : {}),
    ...(clientId && clientSecret ? { toss: { clientId, clientSecret } } : {}),
  };
}

/** 토스는 키나 프록시 설정이 있으면 고를 수 있다. KIS는 키가 있어야 한다. */
export function chooseProvider(creds: Creds, flag?: ProviderId, proxy?: unknown): ProviderId {
  if (flag !== undefined) {
    if (!creds[flag] && !(flag === 'toss' && proxy)) throw new CliError('no-credentials');
    return flag;
  }
  if (creds.toss || proxy) return 'toss';
  if (creds.kis) return 'kis';
  throw new CliError('no-credentials');
}
