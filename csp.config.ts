// 콘텐츠 보안 정책(index.html의 meta CSP)과 개발 서버 전용 완화.
// 빌드는 connect-src 'self' https: 그대로다. 로컬 http 프록시(Node 컨테이너·wrangler dev)는
// 개발 서버(pnpm dev)에서만 쓸 수 있게 connect-src에 로컬 http 출처를 더한다.
// 연결 폼의 검사(normalizeProxyUrl)도 같은 규칙을 따른다(개발 서버에서만 http://localhost 허용).
import { KAKAO_SDK_URL } from '@sch0718/kakao-share';
import type { Plugin } from 'vite';

export const DEV_LOCAL_PROXY_SOURCES = ['http://localhost:*', 'http://127.0.0.1:*', 'http://[::1]:*'];

const BUILD_CONNECT_SRC = "connect-src 'self' https:";

export function devCsp(html: string): string {
  if (!html.includes(BUILD_CONNECT_SRC)) throw new Error(`index.html CSP has no "${BUILD_CONNECT_SRC}"`);
  return html.replace(BUILD_CONNECT_SRC, `${BUILD_CONNECT_SRC} ${DEV_LOCAL_PROXY_SOURCES.join(' ')}`);
}

/** Google 로그인 팝업이 쓰는 gapi 스크립트. */
export const FIREBASE_SCRIPT_SOURCES = ['https://apis.google.com'];

const DOMAIN_RE = /^[a-z0-9.-]+$/;

/**
 * 동기화 설정(VITE_FIREBASE_AUTH_DOMAIN)이 있을 때만 Firebase Auth 팝업에 필요한 출처를 더한다:
 * script-src에 gapi, frame-src에 인증 도메인. connect-src(https:)는 이미 Firebase API를 허용한다.
 * 설정이 없으면 index.html의 CSP를 그대로 둔다.
 */
export function firebaseCsp(html: string, authDomain: string | undefined): string {
  if (!authDomain) return html;
  if (!DOMAIN_RE.test(authDomain)) throw new Error(`invalid VITE_FIREBASE_AUTH_DOMAIN: ${authDomain}`);
  const script = "script-src 'self'";
  if (!html.includes(script)) throw new Error(`index.html CSP has no "${script}"`);
  const base = "default-src 'self';";
  if (!html.includes(base)) throw new Error(`index.html CSP has no "${base}"`);
  return html
    .replace(script, `${script} ${FIREBASE_SCRIPT_SOURCES.join(' ')}`)
    .replace(base, `${base} frame-src https://${authDomain};`);
}

export function firebaseCspPlugin(): Plugin {
  let authDomain: string | undefined;
  return {
    name: 'gazua-firebase-csp',
    configResolved(c) {
      const v = c.env.VITE_FIREBASE_AUTH_DOMAIN;
      authDomain = typeof v === 'string' && v.trim() ? v.trim() : undefined;
    },
    transformIndexHtml: (html) => firebaseCsp(html, authDomain),
  };
}

/** 카카오톡 공유 SDK를 받는 출처(SRI로 확인한다). 공유 화면은 sharer.kakao.com으로 이동하므로 다른 지시어는 그대로다. */
export const KAKAO_SCRIPT_SOURCES = [new URL(KAKAO_SDK_URL).origin];

/** 카카오 JS 키(VITE_KAKAO_JS_KEY)가 있을 때만 script-src에 SDK 출처를 더한다. 없으면 index.html의 CSP를 그대로 둔다. */
export function kakaoCsp(html: string, enabled: boolean): string {
  if (!enabled) return html;
  const script = "script-src 'self'";
  if (!html.includes(script)) throw new Error(`index.html CSP has no "${script}"`);
  return html.replace(script, `${script} ${KAKAO_SCRIPT_SOURCES.join(' ')}`);
}

export function kakaoCspPlugin(): Plugin {
  let enabled = false;
  return {
    name: 'gazua-kakao-csp',
    configResolved(c) {
      const v = c.env.VITE_KAKAO_JS_KEY;
      enabled = typeof v === 'string' && v.trim() !== '';
    },
    transformIndexHtml: (html) => kakaoCsp(html, enabled),
  };
}

export const devCspPlugin: Plugin = {
  name: 'gazua-dev-csp',
  apply: 'serve',
  transformIndexHtml: devCsp,
};
