// 연결 폼(ConnectionForm)의 순수 로직: 키 가리기, 프록시 주소 정리, 키 합치기.
import { trimCredential, type Secrets } from '../../state/secrets';

/** 끝 4자리만 보인다. 4자 이하면 전부 가린다. */
export function maskTail(v: string): string {
  if (v === '') return '';
  return v.length > 4 ? `••••••${v.slice(-4)}` : '••••••';
}

export type UrlResult = { ok: true; url: string } | { ok: false; reason: string };

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const NEED_HTTPS = '프록시 URL은 https://로 시작해야 해요';
const LOCAL_DEV_ONLY = `${NEED_HTTPS} · http://localhost 프록시는 개발 서버(pnpm dev)에서만 쓸 수 있어요`;

/**
 * 앞뒤 공백·끝 슬래시를 지운다. 빈 값은 '지움'. https만 받는다.
 * 빌드의 CSP(connect-src 'self' https:)가 http를 막으므로, http://localhost 프록시는 CSP를 넓힌
 * 개발 서버(allowLocalHttp, 기본은 import.meta.env.DEV)에서만 받는다(csp.config.ts).
 */
export function normalizeProxyUrl(raw: string, opts: { allowLocalHttp?: boolean } = {}): UrlResult {
  const allowLocalHttp = opts.allowLocalHttp ?? import.meta.env.DEV;
  const trimmed = trimCredential(raw);
  if (trimmed === '') return { ok: true, url: '' };
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return { ok: false, reason: NEED_HTTPS };
  }
  if (u.protocol === 'http:' && LOCAL_HOSTS.has(u.hostname)) {
    if (!allowLocalHttp) return { ok: false, reason: LOCAL_DEV_ONLY };
  } else if (u.protocol !== 'https:') {
    return { ok: false, reason: NEED_HTTPS };
  }
  if (u.search || u.hash || u.username || u.password) return { ok: false, reason: '프록시 URL에는 주소만 넣어 주세요' };
  return { ok: true, url: `${u.origin}${u.pathname.replace(/\/+$/, '')}` };
}

export const KEY_FIELDS = {
  kis: [
    { name: 'appKey', label: 'App Key' },
    { name: 'appSecret', label: 'App Secret' },
  ],
  toss: [
    { name: 'clientId', label: 'Client ID' },
    { name: 'clientSecret', label: 'Client Secret' },
  ],
} as const;

export type MergeResult = { ok: true; secrets: Secrets | null } | { ok: false; reason: string };

/**
 * 입력한 키(앞뒤 공백 제거)를 저장된 키에 합친다. 비운 칸은 저장된 값을 유지한다.
 * 둘 다 비었으면 바뀐 게 없다(secrets: null).
 */
export function mergeKeys(current: Secrets | null, provider: 'kis' | 'toss', first: string, second: string): MergeResult {
  const a = trimCredential(first);
  const b = trimCredential(second);
  if (a === '' && b === '') return { ok: true, secrets: null };
  const base: Secrets = { ...(current ?? {}) };
  if (provider === 'kis') {
    const appKey = a || base.kis?.appKey || '';
    const appSecret = b || base.kis?.appSecret || '';
    if (!appKey || !appSecret) return { ok: false, reason: '두 값을 모두 입력해 주세요' };
    return { ok: true, secrets: { ...base, kis: { appKey, appSecret } } };
  }
  const clientId = a || base.toss?.clientId || '';
  const clientSecret = b || base.toss?.clientSecret || '';
  if (!clientId || !clientSecret) return { ok: false, reason: '두 값을 모두 입력해 주세요' };
  return { ok: true, secrets: { ...base, toss: { clientId, clientSecret } } };
}
