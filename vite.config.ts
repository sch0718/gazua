import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { devCspPlugin } from './csp.config';
import { pwaOptions } from './pwa.config';

export default defineConfig({
  base: '/gazua/',
  plugins: [svelte(), VitePWA(pwaOptions), devCspPlugin],
});
