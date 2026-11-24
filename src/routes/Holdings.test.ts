// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLwcStub, ResizeObserverStub } from '../lib/chart/lwcStub';
import { newManualHolding } from '../lib/holdings/manual';
import type { App } from '../lib/state/app.svelte';
import { kstEpoch } from '../lib/time/kst';
import { makeTestApp } from '../sheets/testApp';
import Holdings from './Holdings.svelte';

vi.mock('lightweight-charts', async () => (await import('../lib/chart/lwcStub')).lwcModule());

const NOW = kstEpoch('2026-10-16', '10:00:00');
const barEnd = createRawSnippet(() => ({ render: () => '<span></span>' }));

let apps: App[] = [];
function setup(manual = false) {
  const app = makeTestApp({ groups: [{ id: 'g1', name: '반도체', items: [] }], now: NOW });
  apps.push(app);
  if (manual) app.setManualHoldings([newManualHolding({ symbol: '005930', name: '삼성전자', qty: 10, avgPrice: 70000, account: '연금저축' })]);
  app.navigate({ name: 'holdings' });
  render(Holdings, { app, now: NOW, sessions: [], isOpenToday: false, barEnd, wide: false });
  return app;
}
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  resetLwcStub();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const a of apps) a.destroy();
  apps = [];
});

describe('Holdings', () => {
  it('계좌 보유(데모)와 직접 넣은 종목을 라벨 칩으로 나눠 보여 준다', async () => {
    setup(true);
    const chips = screen.getByRole('group', { name: '계좌 구분' });
    await waitFor(() => expect(within(chips).getByRole('button', { name: '연금저축' })).toBeTruthy());
    expect(within(chips).getByRole('button', { name: '데모' })).toBeTruthy();
    await fireEvent.click(within(chips).getByRole('button', { name: '연금저축' }));
    const list = await screen.findByRole('list', { name: '보유 내역' });
    expect(within(list).getAllByRole('button')).toHaveLength(1);
    expect(within(list).getByText('삼성전자')).toBeTruthy();
    // 차트 그룹도 그 계좌의 종목만 남는다(리더보드 행 1개)
    expect(screen.getByRole('button', { name: '삼성전자 수정' })).toBeTruthy();
  });

  it('직접 넣은 종목은 이 기기에만 저장된다고 알린다', async () => {
    setup(true);
    await waitFor(() => expect(screen.getByText(/이 기기에만 저장/)).toBeTruthy());
  });
});
