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
    expect(denied('/universe.json')).toBe(true);
    expect(denied('/assets/index-abc.js')).toBe(true);
    expect(denied('/')).toBe(false);
    expect(denied('/compare/g1')).toBe(false);
  });

  it('precaches only the app shell, not fonts or the universe', () => {
    expect(wb.globPatterns).toEqual(['**/*.{html,js,css,svg,png,webmanifest}']);
  });

  it('keeps help pictures out of the precache and caches them when first viewed', () => {
    expect(wb.globIgnores).toContain('help/**');
    const rule = (wb.runtimeCaching ?? []).find((r) => (r.options as { cacheName?: string } | undefined)?.cacheName === 'gazua-help');
    const match = rule!.urlPattern as (ctx: { url: URL; sameOrigin: boolean }) => boolean;
    expect(match({ url: new URL('https://gazua.sch0718.dev/help/img/compare-dark.svg'), sameOrigin: true })).toBe(true);
    expect(match({ url: new URL('https://gazua.sch0718.dev/assets/index.js'), sameOrigin: true })).toBe(false);
    expect(rule!.handler).toBe('StaleWhileRevalidate');
  });

  it('never caches API or proxy requests at runtime', () => {
    for (const rule of wb.runtimeCaching ?? []) {
      const match = rule.urlPattern as (ctx: { url: URL; sameOrigin: boolean }) => boolean;
      const api = new URL('https://proxy.example.workers.dev/kis/uapi/domestic-stock/v1/quotations/inquire-price');
      expect(match({ url: api, sameOrigin: false })).toBe(false);
      // 같은 출처 경로여도 시세 API 모양이면 담지 않는다.
      expect(match({ url: new URL('https://gazua.example.dev/kis/quotes.json'), sameOrigin: true })).toBe(false);
    }
  });
});
