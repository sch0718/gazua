// 카카오톡 공유 SDK의 CSP(가즈아 전용). Firebase·개발 서버 CSP는 @sch0718/firebase-session/vite, @sch0718/vite-app이 맡는다.
import { KAKAO_SDK_URL } from '@sch0718/kakao-share';
import type { Plugin } from 'vite';

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
