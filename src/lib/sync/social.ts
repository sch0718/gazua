// 첫 화면에서 쓰는 이름·안내만 둔다. 로그인 실행은 socialFlow에서 지연 로드한다.
import type { SocialCallback, SocialProvider } from '@sch0718/firebase-session/client';

export type LoginProvider = 'google' | 'kakao' | 'naver';
export const PROVIDER_NAMES: Record<LoginProvider, string> = { google: 'Google', kakao: '카카오', naver: '네이버' };
export const SOCIAL_RETURN_KEY = 'gazua:social-return';
export const SOCIAL_RETURN_TTL = 10 * 60 * 1000;
export const callbackPath = (base = import.meta.env.BASE_URL): string => `${base}auth/callback/`;
export const isInAppBrowser = (ua: string): boolean => /KAKAOTALK/i.test(ua) || /NAVER\(inapp/i.test(ua);

export type SocialReturn = { callback: SocialCallback | null; hadParams: boolean; returnHash: string; label: string };
export type SocialOutcome =
  | { ok: true; provider: SocialProvider }
  | { ok: false; provider: SocialProvider | null; reason: 'cancelled' | 'mismatch' | 'expired' | 'provider-error' | 'no-pending' | 'not-configured' | 'not-allowed' | 'limit' | 'offline' | 'invalid-code' | 'invalid-token' | 'not-enabled' | 'bad-request' | 'server' | 'storage'; account?: string; error?: string };

export function socialFailureText(o: Extract<SocialOutcome, { ok: false }>): { title: string; detail: string } {
  const p = o.provider ? PROVIDER_NAMES[o.provider] : '공급자';
  const texts: Record<typeof o.reason, [string, string]> = {
    cancelled: ['로그인을 취소했어요', '다시 하려면 아래 단추를 눌러 주세요.'],
    mismatch: ['로그인 요청을 확인하지 못했어요', '다른 탭이나 창에서 시작한 로그인과 섞였을 수 있어요. 다시 로그인해 주세요.'],
    expired: ['로그인 시간이 지났어요', '시작한 지 10분이 지나 이어서 할 수 없어요. 다시 로그인해 주세요.'],
    'provider-error': [`${p}가 로그인을 마치지 못했어요`, `${p} 개발자 설정(Redirect URI·OpenID Connect)을 확인해 주세요.${o.error ? ` (${o.error})` : ''}`],
    'no-pending': ['이 브라우저에서 시작한 로그인이 아니에요', '카카오톡·네이버 앱에서 로그인한 뒤 다른 브라우저로 돌아오면 이어서 할 수 없어요. 여기서 다시 로그인해 주세요.'],
    'not-configured': [`이 빌드에는 ${p} 로그인이 설정되지 않았어요`, `동기화 서버 주소와 ${p} 로그인 키가 들어간 빌드에서 쓸 수 있어요.`],
    'not-allowed': [`이 ${p} 계정은 아직 허용 목록에 없어요`, '아래 계정 값을 동기화 서버의 ALLOWED_ACCOUNTS에 더한 뒤 다시 로그인해 주세요.'],
    limit: [`${p} 서버에 잠시 연결할 수 없어요`, '잠시 뒤 다시 시도해 주세요.'],
    offline: ['동기화 서버에 연결할 수 없어요', '인터넷 연결을 확인하고 다시 시도해 주세요.'],
    'invalid-code': ['로그인 코드가 만료됐거나 이미 쓰였어요', '다시 로그인해 주세요.'],
    'invalid-token': [`${p} 로그인 응답을 확인하지 못했어요`, `${p} 앱에서 OpenID Connect가 켜져 있는지 확인해 주세요.`],
    'not-enabled': [`동기화 서버에 ${p} 로그인이 켜져 있지 않아요`, `Worker에 ${p} 클라이언트 ID와 시크릿을 넣어 주세요.`],
    'bad-request': ['동기화 서버가 로그인 요청을 받지 않았어요', 'Worker의 SOCIAL_REDIRECT_URIS에 이 주소의 콜백이 있는지 확인해 주세요.'],
    storage: ['이 브라우저에서는 로그인을 시작할 수 없어요', '저장소를 쓸 수 없어요(사생활 보호 모드 등). 다른 브라우저로 열어 주세요.'],
    server: ['서버 오류예요', '잠시 뒤 다시 시도해 주세요.'],
  };
  const [title, detail] = texts[o.reason];
  return { title, detail };
}
