import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { firebaseAuthHelper, firebaseCsp } from '@sch0718/firebase-session/vite';
import { devCsp } from '@sch0718/vite-app';
import { kakaoCspPlugin } from './kakao-csp.config';
import { pwaOptions } from './pwa.config';

export default defineConfig({
  // 커스텀 도메인(gazua.sch0718.dev)의 루트에서 서비스한다. GitHub Pages Settings › Custom domain과 함께 바꾼다.
  base: '/',
  // 콜백은 no-referrer가 있는 별도 문서로 내보낸다.
  build: { rollupOptions: { input: { main: resolve(fileURLToPath(new URL('.', import.meta.url)), 'index.html'), callback: resolve(fileURLToPath(new URL('.', import.meta.url)), 'auth/callback/index.html') } } },
  // 개발 서버만 로컬 http 프록시(Node 컨테이너·wrangler dev)를 connect-src에 더한다. 연결 폼의 normalizeProxyUrl도 같은 규칙이다.
  plugins: [svelte(), VitePWA(pwaOptions), devCsp(), firebaseCsp(), kakaoCspPlugin(), firebaseAuthHelper()],
});
