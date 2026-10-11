// 콘텐츠 보안 정책(index.html의 meta CSP)과 개발 서버 전용 완화.
// 빌드는 connect-src 'self' https: 그대로다. 로컬 http 프록시(Node 컨테이너·wrangler dev)는
// 개발 서버(pnpm dev)에서만 쓸 수 있게 connect-src에 로컬 http 출처를 더한다.
// 연결 폼의 검사(normalizeProxyUrl)도 같은 규칙을 따른다(개발 서버에서만 http://localhost 허용).
import type { Plugin } from 'vite';

export const DEV_LOCAL_PROXY_SOURCES = ['http://localhost:*', 'http://127.0.0.1:*', 'http://[::1]:*'];

const BUILD_CONNECT_SRC = "connect-src 'self' https:";

export function devCsp(html: string): string {
  if (!html.includes(BUILD_CONNECT_SRC)) throw new Error(`index.html CSP has no "${BUILD_CONNECT_SRC}"`);
  return html.replace(BUILD_CONNECT_SRC, `${BUILD_CONNECT_SRC} ${DEV_LOCAL_PROXY_SOURCES.join(' ')}`);
}

export const devCspPlugin: Plugin = {
  name: 'gazua-dev-csp',
  apply: 'serve',
  transformIndexHtml: devCsp,
};
