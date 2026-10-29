// 공급자 로그인 실행·콜백은 필요한 때만 불러온다.
import { beginSocialSignIn, readSocialCallback, stripSocialCallback, type SocialProvider } from '@sch0718/firebase-session/client';
import { callbackPath, SOCIAL_RETURN_KEY, SOCIAL_RETURN_TTL, type SocialReturn } from './social';

const validHash = (hash: unknown): hash is string => typeof hash === 'string' && /^#\/[A-Za-z0-9/_%.-]*$/.test(hash) && !hash.startsWith('#/s/');

export async function startSocialSignIn(provider: SocialProvider, o: {
  clientId: string; apiUrl: string; label: string; returnHash: string; storage?: Storage; reauth?: boolean; userAgent?: string;
  navigate?: (url: string) => void; now?: () => number; random?: (n: number) => Uint8Array; origin?: string; base?: string;
}): Promise<void> {
  const storage = o.storage ?? localStorage;
  const userAgent = o.userAgent ?? globalThis.navigator?.userAgent ?? '';
  storage.setItem(SOCIAL_RETURN_KEY, JSON.stringify({ hash: validHash(o.returnHash) ? o.returnHash : '#/settings', label: o.label, createdAt: (o.now ?? Date.now)() }));
  let navigate = o.navigate;
  if (import.meta.env.DEV && import.meta.env.VITE_SOCIAL_DEV_MOCK === 'true') {
    if (!navigate) {
      const { devAuthorizeUrl } = await import('./socialDev');
      navigate = (url) => location.assign(devAuthorizeUrl(url, o.apiUrl));
    }
  }
  await beginSocialSignIn(provider, { clientId: o.clientId, redirectUri: (o.origin ?? location.origin) + callbackPath(o.base), storage, navigate, now: o.now, random: o.random, ...(provider === 'kakao' && o.reauth && !/KAKAOTALK/i.test(userAgent) && { prompt: 'login' }) });
}

export function takeSocialCallback(o: {
  location: Pick<Location, 'href' | 'pathname'>; history: Pick<History, 'replaceState' | 'state'>;
  storage?: Storage; now?: () => number; base?: string;
}): SocialReturn | null {
  if (o.location.pathname !== callbackPath(o.base)) return null;
  const params = new URL(o.location.href).searchParams;
  const hadParams = params.has('code') || params.has('error');
  let callback: SocialReturn['callback'] = null;
  try {
    callback = readSocialCallback(o.location.href, { storage: o.storage, now: o.now });
  } catch {
    // 저장소가 막혀도 주소는 지운다.
  }
  o.history.replaceState(o.history.state, '', stripSocialCallback(o.location.href));
  let returnHash = '#/settings';
  let label = '';
  try {
    const storage = o.storage ?? localStorage;
    const saved = storage.getItem(SOCIAL_RETURN_KEY);
    storage.removeItem(SOCIAL_RETURN_KEY);
    const info = saved ? JSON.parse(saved) : null;
    const age = info && typeof info.createdAt === 'number' ? (o.now ?? Date.now)() - info.createdAt : NaN;
    if (info && validHash(info.hash) && age >= 0 && age < SOCIAL_RETURN_TTL) {
      returnHash = info.hash;
      label = typeof info.label === 'string' ? info.label : '';
    }
  } catch {
    // 돌아갈 정보가 없으면 설정으로 간다.
  }
  if (!hadParams) {
    o.history.replaceState(o.history.state, '', (o.base ?? import.meta.env.BASE_URL) + returnHash);
    return null;
  }
  return { callback, hadParams, returnHash, label };
}
