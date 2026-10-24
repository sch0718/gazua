import type { VitePWAOptions } from 'vite-plugin-pwa';

// vite.config.ts에서 쓰는 PWA 설정. 테스트(pwa.config.test.ts)가 이 객체를 직접 확인한다.
export const pwaOptions: Partial<VitePWAOptions> = {
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
    // injectRegister 'script'에서는 플러그인이 autoUpdate의 skipWaiting/clientsClaim 기본값을 넣지 않는다.
    // 직접 켜야 새 버전이 바로 활성화돼 설치된 사용자가 옛 앱 셸에 머무르지 않는다.
    skipWaiting: true,
    clientsClaim: true,
    // 앱 셸만 미리 담는다. Pretendard 글꼴 조각(woff2 약 90개)과 universe.json은 제외한다.
    globPatterns: ['**/*.{html,js,css,svg,png,webmanifest}'],
    // 도움말 그림(help/img, 약 400KB)은 도움말을 열 때 받아 담는다(아래 gazua-help).
    globIgnores: ['help/**'],
    // 확장자가 있는 주소(universe.json·assets 등)는 앱 셸 index.html로 대신 답하지 않는다.
    navigateFallbackDenylist: [/\.\w+$/],
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
      {
        // 도움말 그림은 배포마다 같은 이름으로 바뀔 수 있다. 담아 둔 것을 먼저 보이고 뒤에서 새로 받는다.
        urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.includes('/help/img/'),
        handler: 'StaleWhileRevalidate',
        options: { cacheName: 'gazua-help' },
      },
      // 시세·프록시 같은 외부 API 요청은 캐시하지 않는다(런타임 규칙 없음 = 네트워크 그대로).
    ],
  },
};
