// Google Identity Services 토큰 모델의 CSP(설계 D9). 토큰 모델은 팝업이라 script-src만 더한다.
// frame-src·style-src는 One Tap·로그인 버튼용이라 넣지 않는다. connect-src는 이미 https:를 허용한다.
import type { Plugin } from 'vite';

export const DRIVE_SCRIPT_SOURCES = ['https://accounts.google.com/gsi/client'];

export function driveCsp(html: string, enabled: boolean): string {
  if (!enabled) return html;
  const script = "script-src 'self'";
  if (!html.includes(script)) throw new Error(`index.html CSP has no "${script}"`);
  return html.replace(script, `${script} ${DRIVE_SCRIPT_SOURCES.join(' ')}`);
}

export function driveCspPlugin(): Plugin {
  let enabled = false;
  return {
    name: 'gazua-drive-csp',
    configResolved(c) {
      const v = c.env.VITE_GOOGLE_DRIVE_CLIENT_ID;
      enabled = typeof v === 'string' && v.trim() !== '';
    },
    transformIndexHtml: (html) => driveCsp(html, enabled),
  };
}
