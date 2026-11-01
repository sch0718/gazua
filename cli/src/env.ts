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

/** --provider가 있으면 그 키가 있어야 한다. 없으면 키가 있는 쪽, 둘 다면 toss */
export function chooseProvider(creds: Creds, flag?: ProviderId): ProviderId {
  if (flag !== undefined) {
    if (!creds[flag]) throw new CliError('no-credentials');
    return flag;
  }
  if (creds.toss) return 'toss';
  if (creds.kis) return 'kis';
  throw new CliError('no-credentials');
}
