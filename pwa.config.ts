import { AUTH_GLOB_IGNORES, AUTH_NAVIGATE_DENYLIST } from '@sch0718/firebase-session/vite';
import { createPwaOptions } from '@sch0718/vite-app';

// vite.config.ts에서 쓰는 PWA 설정. 테스트(pwa.config.test.ts)가 이 객체를 직접 확인한다.
// 공통값(autoUpdate, registerSW.js, skipWaiting, 앱 셸 globPatterns, 글꼴 캐시)은 @sch0718/vite-app이 정한다.
export const pwaOptions = createPwaOptions({
  manifest: {
    name: '가즈아',
    short_name: '가즈아',
    description: '관심종목을 한 차트에 나란히 놓고 비교해요',
    theme_color: '#5b47e0',
    background_color: '#f6f7f9',
    icons: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
  cachePrefix: 'gazua',
  // 도움말 그림(help/img, 약 400KB)은 도움말을 열 때 받아 담는다(아래 gazua-help).
  // 카카오 카드 고정 이미지(share/*.png)는 카카오 서버만 받아 가므로 미리 저장하지 않는다(공유 확장 설계 4.6).
  // Firebase Auth 청크와 같은 도메인의 로그인 도우미는 로그인할 때만 받는다(AUTH_GLOB_IGNORES).
  globIgnores: ['help/**', 'share/**', ...AUTH_GLOB_IGNORES],
  navigateFallbackDenylist: AUTH_NAVIGATE_DENYLIST,
  runtimeCaching: [
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
});
