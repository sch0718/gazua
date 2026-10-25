import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { authHelperPlugin } from './auth-helper.config';
import { devCspPlugin, firebaseCspPlugin } from './csp.config';
import { pwaOptions } from './pwa.config';

export default defineConfig({
  // 커스텀 도메인(gazua.sch0718.dev)의 루트에서 서비스한다. GitHub Pages Settings › Custom domain과 함께 바꾼다.
  base: '/',
  plugins: [svelte(), VitePWA(pwaOptions), devCspPlugin, firebaseCspPlugin(), authHelperPlugin()],
});
