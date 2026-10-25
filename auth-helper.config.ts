// Firebase 로그인 도우미(/__/auth/handler 등)를 앱과 같은 도메인에서 서빙한다.
// authDomain이 <프로젝트>.firebaseapp.com이면 리다이렉트·팝업 결과가 그 도메인의 저장소를 거치는데,
// 서드파티 저장소를 막는 브라우저(iOS Safari, 홈 화면 PWA 등)에서는 결과를 넘겨받지 못해 로그인이 되지 않는다.
// authDomain을 앱 도메인으로 두면, 빌드가 도우미 파일을 받아 dist/__/auth/에 넣는다.
// Firebase 문서 「Best practices for using signInWithRedirect on browsers that block third-party storage」의 3번 방법.
// GitHub Pages는 /__/auth/handler를 handler.html로 답한다. 파일은 빌드 때마다 받아 Firebase 쪽 갱신을 따른다.
import type { Plugin } from 'vite';

/** 받아 올 도우미 파일(src)과 dist 안의 위치(out). */
export const AUTH_HELPER_FILES = [
  { src: 'handler', out: '__/auth/handler.html', marker: 'fireauth.oauthhelper' },
  { src: 'handler.js', out: '__/auth/handler.js' },
  { src: 'experiments.js', out: '__/auth/experiments.js' },
  { src: 'iframe', out: '__/auth/iframe.html', marker: 'fireauth.iframe' },
  { src: 'iframe.js', out: '__/auth/iframe.js' },
] as const;

const FIREBASE_HOSTED = /\.(firebaseapp\.com|web\.app)$/;
const PROJECT_ID_RE = /^[a-z0-9-]+$/;

/** authDomain이 Firebase 호스팅이 아니면(앱 도메인이면) 빌드가 도우미를 직접 서빙한다. */
export function selfHostsAuthHelper(authDomain: string | undefined): boolean {
  return !!authDomain && !FIREBASE_HOSTED.test(authDomain);
}

type FetchFn = (url: string) => Promise<Response>;

export async function fetchAuthHelper(projectId: string, fetchFn: FetchFn = fetch): Promise<{ fileName: string; source: string }[]> {
  if (!PROJECT_ID_RE.test(projectId)) throw new Error(`invalid VITE_FIREBASE_PROJECT_ID: ${projectId}`);
  const out: { fileName: string; source: string }[] = [];
  for (const f of AUTH_HELPER_FILES) {
    const url = `https://${projectId}.firebaseapp.com/__/auth/${f.src}`;
    const res = await fetchFn(url);
    if (res.status !== 200) throw new Error(`Firebase auth helper ${f.src}: HTTP ${res.status} (${url})`);
    const source = await res.text();
    if ('marker' in f && !source.includes(f.marker)) throw new Error(`Firebase auth helper ${f.src} does not look like a Firebase helper (${url})`);
    out.push({ fileName: f.out, source });
  }
  return out;
}

export function authHelperPlugin(fetchFn?: FetchFn): Plugin {
  let authDomain: string | undefined;
  let projectId = '';
  return {
    name: 'gazua-firebase-auth-helper',
    apply: 'build',
    configResolved(c) {
      const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
      authDomain = s(c.env.VITE_FIREBASE_AUTH_DOMAIN) || undefined;
      projectId = s(c.env.VITE_FIREBASE_PROJECT_ID);
    },
    async generateBundle() {
      if (!selfHostsAuthHelper(authDomain) || !projectId) return;
      for (const f of await fetchAuthHelper(projectId, fetchFn)) this.emitFile({ type: 'asset', fileName: f.fileName, source: f.source });
    },
  };
}
