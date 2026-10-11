import { defineConfig } from '@playwright/test';

// 프로덕션 빌드(vite preview)를 대상으로 4개 뷰포트에서 데모 흐름을 돌린다.
// 앱은 base `/gazua/` 아래에서 해시 라우팅을 쓴다.
const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}/gazua/`;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    // PWA 서비스 워커가 테스트에 끼어들지 않게 한다.
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'phone', use: { browserName: 'chromium', viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true } },
    { name: 'tablet-portrait', use: { browserName: 'chromium', viewport: { width: 820, height: 1180 } } },
    { name: 'tablet-landscape', use: { browserName: 'chromium', viewport: { width: 1180, height: 820 } } },
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: 'corepack pnpm build && corepack pnpm preview --port 4173 --strictPort',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
