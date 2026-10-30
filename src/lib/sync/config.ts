// Firebase 없이 소셜 로그인만 쓰는 빌드도 허용한다.
import { readSyncConfig as read, type FirebaseConfig } from '@sch0718/firebase-session/client';

export interface SyncConfig {
  apiUrl: string;
  firebase: FirebaseConfig | null;
  social: { kakao?: { clientId: string }; naver?: { clientId: string } } | null;
}

export function readSyncConfig(
  env: Record<string, string | boolean | undefined> = import.meta.env,
): SyncConfig | null {
  const config = read(env);
  // 첫 화면에서는 설정만 읽어 소셜 로그인 실행 코드의 지연 로드를 유지한다.
  const kakao = typeof env.VITE_KAKAO_LOGIN_CLIENT_ID === 'string' ? env.VITE_KAKAO_LOGIN_CLIENT_ID.trim() : '';
  const naver = typeof env.VITE_NAVER_LOGIN_CLIENT_ID === 'string' ? env.VITE_NAVER_LOGIN_CLIENT_ID.trim() : '';
  const social = kakao || naver ? { ...(kakao && { kakao: { clientId: kakao } }), ...(naver && { naver: { clientId: naver } }) } : null;
  if (config) return { ...config, social };
  if (!social) return null;
  const apiUrl = typeof env.VITE_SYNC_API_URL === 'string' ? env.VITE_SYNC_API_URL.trim().replace(/\/+$/, '') : '';
  try {
    const u = new URL(apiUrl);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    if (u.protocol === 'https:' || (env.DEV === true && u.protocol === 'http:' && local)) return { apiUrl, firebase: null, social };
  } catch {
    // 주소 형식이 아니다.
  }
  return null;
}
