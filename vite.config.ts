import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/gazua/',
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      // CSP가 script-src 'self'이므로 인라인 등록 스크립트 대신 같은 출처의 registerSW.js를 쓴다.
      injectRegister: 'script',
      manifest: {
        name: '가즈아',
        short_name: '가즈아',
        description: '관심종목을 한 차트에 나란히 놓고 비교해요',
        lang: 'ko',
        start_url: './',
        scope: './',
        display: 'standalone',
        theme_color: '#5b47e0',
        background_color: '#f6f7f9',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 앱 셸만 미리 담는다. Pretendard 글꼴 조각(woff2 약 90개)과 universe.json은 제외한다.
        globPatterns: ['**/*.{html,js,css,svg,png,webmanifest}'],
        runtimeCaching: [
          {
            // 글꼴 조각은 쓰는 것만 처음 받을 때 담는다.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.endsWith('.woff2'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'gazua-fonts',
              expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // 종목 유니버스는 배포 스케줄(평일 새벽)마다 바뀐다. 캐시를 먼저 보이고 뒤에서 새로 받는다.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.endsWith('/universe.json'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'gazua-universe' },
          },
          // 시세·프록시 같은 외부 API 요청은 캐시하지 않는다(런타임 규칙 없음 = 네트워크 그대로).
        ],
      },
    }),
  ],
});
