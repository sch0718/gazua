// 첫 화면에서 쓰는 이름·안내만 둔다. 로그인 실행은 socialFlow에서 지연 로드한다.
import type { SocialCallback, SocialProvider } from '@sch0718/firebase-session/client';

export type LoginProvider = 'google' | 'kakao' | 'naver';
export const PROVIDER_NAMES: Record<LoginProvider, string> = { google: 'Google', kakao: '카카오', naver: '네이버' };
export const SOCIAL_RETURN_KEY = 'gazua:social-return';
export const SOCIAL_RETURN_TTL = 10 * 60 * 1000;
export const callbackPath = (base = import.meta.env.BASE_URL): string => `${base}auth/callback/`;
export const isInAppBrowser = (ua: string): boolean => /KAKAOTALK/i.test(ua) || /NAVER\(inapp/i.test(ua);

export function restoreReferrerPolicy(doc: Document = document): void {
  // HTML 명세상 메타를 지워도 정책은 남으므로 content를 바꿔 갱신한다.
  doc.querySelector('meta[name="referrer"]')?.setAttribute('content', 'strict-origin-when-cross-origin');
}

export type SocialReturn = { callback: SocialCallback | null; hadParams: boolean; returnHash: string; label: string };
export type SocialOutcome =
  | { ok: true; provider: SocialProvider }
  | { ok: false; provider: SocialProvider | null; reason: 'cancelled' | 'mismatch' | 'expired' | 'provider-error' | 'no-pending' | 'not-configured' | 'not-allowed' | 'limit' | 'offline' | 'invalid-code' | 'invalid-token' | 'not-enabled' | 'bad-request' | 'server' | 'storage' | 'timeout'; account?: string; error?: string };
