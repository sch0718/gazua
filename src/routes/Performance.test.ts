// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lwcCharts, resetLwcStub, ResizeObserverStub } from '../lib/chart/lwcStub';
import { ApiError } from '../lib/providers/errors';
import type { MarketDataProvider } from '../lib/providers/types';
import type { App } from '../lib/state/app.svelte';
import { kstEpoch } from '../lib/time/kst';
import { makeTestApp } from '../sheets/testApp';
import Performance from './Performance.svelte';

vi.mock('lightweight-charts', async () => (await import('../lib/chart/lwcStub')).lwcModule());

const NOW = kstEpoch('2026-10-16', '10:00:00');
const barEnd = createRawSnippet(() => ({ render: () => '<span></span>' }));

let apps: App[] = [];
function setup(provider?: (base: MarketDataProvider) => MarketDataProvider) {
  const app = makeTestApp({ groups: [{ id: 'g1', name: '반도체', items: [] }], now: NOW });
  apps.push(app);
  if (provider) {
    const p = provider(app.provider);
    vi.spyOn(app, 'provider', 'get').mockReturnValue(p);
  }
  app.navigate({ name: 'performance' });
  render(Performance, { app, barEnd, now: () => NOW });
  return app;
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const a of apps) a.destroy();
  apps = [];
  vi.unstubAllGlobals();
  resetLwcStub();
});

const cards = () => screen.getByRole('region', { name: '요약' });

describe('Performance', () => {
  it('shows the demo account: three cards, three lines, a row per stock, and the notes', async () => {
    setup();
    await waitFor(() => expect(cards()).toBeTruthy(), { timeout: 5000 });
    const c = cards();
    expect(within(c).getByText('내 IRR')).toBeTruthy();
    expect(within(c).getByText('자동(시장 지수) IRR')).toBeTruthy();
    expect(within(c).getByText('초과')).toBeTruthy();
    expect(screen.getByText('데모 계좌예요')).toBeTruthy();
    await waitFor(() => expect(lwcCharts[0]?.series).toHaveLength(3));
    expect(lwcCharts[0].series[0].data.length).toBeGreaterThan(100);
    const rows = screen.getAllByRole('button', { expanded: false }).filter((b) => b.classList.contains('row'));
    expect(rows).toHaveLength(4);
    expect(screen.getByText(/한미반도체: 주문 합계 7주, 보유 8주 · 입고했거나 시간외 종가로 산 주식이 있을 수 있어요/)).toBeTruthy();
    expect(screen.getByText('해외 주문 1건은 뺐어요')).toBeTruthy();
    expect(screen.getByText(/배당·입출금·입고는 토스 API에 없어 빠져요/)).toBeTruthy();
    // 데모는 저장하지 않으므로 다시 받기 버튼이 없다
    expect(screen.queryByRole('button', { name: '처음부터 다시 받기' })).toBeNull();
  });

  it('switching to KODEX 200 remembers it and fetches the ETF', async () => {
    const app = setup();
    await waitFor(() => expect(cards()).toBeTruthy(), { timeout: 5000 });
    await fireEvent.change(screen.getByLabelText('벤치마크'), { target: { value: '069500' } });
    expect(app.settings.perfBenchmark).toBe('069500');
    await waitFor(() => expect(within(cards()).getByText('KODEX 200 IRR')).toBeTruthy(), { timeout: 5000 });
  });

  it('offers the whole period and each year, and a year narrows the dates', async () => {
    setup();
    await waitFor(() => expect(cards()).toBeTruthy(), { timeout: 5000 });
    const period = screen.getByLabelText('기간') as HTMLSelectElement;
    expect([...period.options].map((o) => o.textContent)).toEqual(['전체', '2026', '2025']);
    await fireEvent.change(period, { target: { value: '2026' } });
    await waitFor(() => expect(screen.getByText(/^2026\.01\.\d\d ~ 2026\.10\.16$/)).toBeTruthy());
  });

  it('a row opens its fills', async () => {
    setup();
    await waitFor(() => expect(cards()).toBeTruthy(), { timeout: 5000 });
    const row = screen.getAllByRole('button').find((b) => b.classList.contains('row') && b.textContent?.includes('삼성전자'))!;
    await fireEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('true');
    const table = screen.getByRole('table', { name: '삼성전자 체결 목록' });
    expect(within(table).getAllByRole('row')).toHaveLength(1 + 4);
  });

  it('without an account source it points to the settings', async () => {
    const app = setup((base) => ({ ...base, account: undefined }));
    const btn = await screen.findByRole('button', { name: '설정 열기' });
    expect(screen.getByText('내 성과는 토스증권 계좌에서 볼 수 있어요')).toBeTruthy();
    await fireEvent.click(btn);
    expect(app.route.name).toBe('settings');
  });

  it('a blocked proxy path asks to update the proxy, and can retry', async () => {
    let fail = true;
    setup((base) => ({
      ...base,
      account: {
        ...base.account!,
        closedOrders: async (o) => (fail ? Promise.reject(new ApiError('path-blocked', undefined, { status: 403 })) : base.account!.closedOrders(o)),
      },
    }));
    expect((await screen.findByRole('alert')).textContent).toContain('프록시가 주문 조회를 막고 있어요 · 프록시를 새 버전으로 바꿔 주세요');
    fail = false;
    await fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    await waitFor(() => expect(cards()).toBeTruthy(), { timeout: 5000 });
  });
});
