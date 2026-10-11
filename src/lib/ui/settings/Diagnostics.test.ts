// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeTestApp } from '../../../sheets/testApp';
import kisPrice from '../../providers/fixtures/kis/inquire-price-005930.json';
import kisToken from '../../providers/fixtures/kis/token.json';
import type { App } from '../../state/app.svelte';
import { kstEpoch } from '../../time/kst';
import Diagnostics from './Diagnostics.svelte';

// 토큰 픽스처의 만료(2026-10-12 09:00 KST)보다 앞선 시각.
const NOW = kstEpoch('2026-10-11', '10:00:00');

function proxyFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/health')) return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
    const body = url.includes('/oauth2/tokenP') ? kisToken : kisPrice;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
}

let apps: App[] = [];
afterEach(() => {
  for (const a of apps) a.destroy();
  apps = [];
});

describe('Diagnostics', () => {
  it('the live region exists before the first run', () => {
    const app = makeTestApp({ groups: [], now: NOW, settings: { provider: 'kis', proxyUrl: 'https://proxy.test' } });
    apps.push(app);
    const { container } = render(Diagnostics, { app });
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
  });

  it('after a successful diagnosis the app reuses its token instead of issuing another', async () => {
    const fetchImpl = proxyFetch();
    const app = makeTestApp({
      groups: [],
      now: NOW,
      settings: { provider: 'kis', proxyUrl: 'https://proxy.test' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    apps.push(app);
    await app.setSecrets({ kis: { appKey: 'kis-key-1234', appSecret: 'kis-secret-5678' } });
    const onsuccess = vi.fn();
    render(Diagnostics, { app, fetchImpl: fetchImpl as unknown as typeof fetch, onsuccess });
    await fireEvent.click(screen.getByRole('button', { name: '진단 시작' }));
    await waitFor(() => expect(onsuccess).toHaveBeenCalled());
    const posts = () => fetchImpl.mock.calls.filter(([u]) => String(u).includes('/oauth2/tokenP')).length;
    expect(posts()).toBe(1);
    await app.provider.getQuotes(['005930'], 'KRX');
    expect(posts()).toBe(1);
  });
});
