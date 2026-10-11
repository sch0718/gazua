import { describe, expect, it } from 'vitest';
import { pwaOptions } from './pwa.config';

describe('pwaOptions', () => {
  const wb = pwaOptions.workbox!;

  it('registers from a same-origin script (CSP script-src self) and updates automatically', () => {
    expect(pwaOptions.registerType).toBe('autoUpdate');
    expect(pwaOptions.injectRegister).toBe('script');
  });

  // injectRegister 'script'에서는 플러그인이 skipWaiting/clientsClaim 기본값을 넣지 않는다.
  // 명시하지 않으면 설치된 사용자가 새 버전을 받아도 옛 앱 셸에 머문다.
  it('activates a new service worker immediately and takes over open pages', () => {
    expect(wb.skipWaiting).toBe(true);
    expect(wb.clientsClaim).toBe(true);
  });

  it('does not answer non-app URLs (universe.json, assets) with the app shell', () => {
    const deny = wb.navigateFallbackDenylist ?? [];
    const denied = (path: string) => deny.some((re) => re.test(path));
    expect(denied('/gazua/universe.json')).toBe(true);
    expect(denied('/gazua/assets/index-abc.js')).toBe(true);
    expect(denied('/gazua/')).toBe(false);
    expect(denied('/gazua/compare/g1')).toBe(false);
  });

  it('precaches only the app shell, not fonts or the universe', () => {
    expect(wb.globPatterns).toEqual(['**/*.{html,js,css,svg,png,webmanifest}']);
  });

  it('never caches API or proxy requests at runtime', () => {
    for (const rule of wb.runtimeCaching ?? []) {
      const match = rule.urlPattern as (ctx: { url: URL; sameOrigin: boolean }) => boolean;
      const api = new URL('https://proxy.example.workers.dev/kis/uapi/domestic-stock/v1/quotations/inquire-price');
      expect(match({ url: api, sameOrigin: false })).toBe(false);
      // 같은 출처 경로여도 시세 API 모양이면 담지 않는다.
      expect(match({ url: new URL('https://x.github.io/gazua/kis/quotes.json'), sameOrigin: true })).toBe(false);
    }
  });
});
