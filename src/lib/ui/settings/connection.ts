// 연결 폼(ConnectionForm)의 순수 로직: 키 가리기, 프록시 주소 정리, 키 합치기.
import { trimCredential, type Secrets } from '../../state/secrets';

/** 끝 4자리만 보인다. 4자 이하면 전부 가린다. */
export function maskTail(v: string): string {
  if (v === '') return '';
  return v.length > 4 ? `••••••${v.slice(-4)}` : '••••••';
}

export type UrlResult = { ok: true; url: string } | { ok: false; reason: string };

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** 앞뒤 공백·끝 슬래시를 지운다. https만(로컬 개발 주소는 http도). 빈 값은 '지움'. */
export function normalizeProxyUrl(raw: string): UrlResult {
  const trimmed = trimCredential(raw);
  if (trimmed === '') return { ok: true, url: '' };
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return { ok: false, reason: '프록시 URL은 https://로 시작해야 해요' };
  }
  const secure = u.protocol === 'https:' || (u.protocol === 'http:' && LOCAL_HOSTS.has(u.hostname));
  if (!secure) return { ok: false, reason: '프록시 URL은 https://로 시작해야 해요' };
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
