// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UniverseItem } from '../lib/data/universe';
import { ApiError } from '../lib/providers/errors';
import type { GroupImportSource, ImportStock } from '../lib/providers/types';
import type { App } from '../lib/state/app.svelte';
import { kstEpoch } from '../lib/time/kst';
import { currentSnackbar, dismissSnackbar } from '../lib/ui/components/snackbarStore.svelte';
import TossImport from './TossImport.svelte';
import { itemsOf, makeTestApp } from './testApp';

const NOW = kstEpoch('2026-10-16', '10:00:00');
const CODES = ['005930', '000660', '042700', '000990', '128940', '009150', '069500', '247540', '035420', '005380', '051910'];
const UNIVERSE: UniverseItem[] = [
  ...CODES.map((s, i): UniverseItem => ({ s, n: `종목${i + 1}`, m: 'KOSPI', t: 'STOCK' })),
  { s: 'Q500023', n: '콩 ETN', m: 'KOSPI', t: 'ETN' },
];
const stocks = (codes: string[]): ImportStock[] => codes.map((symbol) => ({ symbol, name: symbol }));

let apps: App[] = [];
function setup(source: Partial<GroupImportSource>) {
  const app = makeTestApp({ groups: [{ id: 'g1', name: '기존', items: itemsOf(['005930']) }], now: NOW });
  apps.push(app);
  const onclose = vi.fn();
  const full: GroupImportSource = {
    holdings: async () => [],
    sectors: async () => [],
    sectorStocks: async () => [],
    ...source,
  };
  render(TossImport, { app, source: full, onclose, now: () => NOW, loadUniverse: async () => UNIVERSE });
  return { app, onclose };
}

afterEach(() => {
  for (const a of apps) a.destroy();
  apps = [];
  dismissSnackbar();
});

describe('TossImport', () => {
  it('holdings: previews up to 10 by value, maps the ETN code, and creates a new group', async () => {
    const { app, onclose } = setup({ holdings: async () => stocks(['500023', ...CODES, 'AAPL']) });
    await fireEvent.click(screen.getByRole('button', { name: '보유 종목' }));
    const create = await vi.waitFor(() => screen.getByRole('button', { name: "'토스 보유' 그룹 만들기" }));
    expect(screen.getByText(/^콩 ETN, 종목1, /)).toBeTruthy();
    expect(screen.getByText('12개 중 큰 순서로 10개만 넣어요 · 지원하지 않는 종목 1개는 뺐어요')).toBeTruthy();
    await fireEvent.click(create);
    const groups = app.watchlists.groups;
    expect(groups).toHaveLength(2);
    expect(groups[0].items.map((i) => i.symbol)).toEqual(['005930']);
    expect(groups[1].name).toBe('토스 보유');
    expect(groups[1].items.map((i) => i.symbol)).toEqual(['Q500023', ...CODES.slice(0, 9)]);
    expect(currentSnackbar()?.message).toBe("'토스 보유' 그룹을 만들었어요");
    expect(onclose).toHaveBeenCalled();
    expect(location.hash).toBe(`#/compare/${groups[1].id}`);
  });

  it('holdings: says when there is no brokerage account or the request fails', async () => {
    setup({ holdings: async () => Promise.reject(new ApiError('upstream', 'Toss has no brokerage account')) });
    await fireEvent.click(screen.getByRole('button', { name: '보유 종목' }));
    expect((await vi.waitFor(() => screen.getByRole('alert'))).textContent).toBe('토스 종합매매 계좌가 없어요');
  });

  it('holdings: no domestic stocks means no create button', async () => {
    setup({ holdings: async () => stocks(['AAPL']) });
    await fireEvent.click(screen.getByRole('button', { name: '보유 종목' }));
    await vi.waitFor(() => screen.getByText('넣을 수 있는 국내 종목이 없어요'));
    expect(screen.queryByRole('button', { name: /그룹 만들기$/ })).toBeNull();
  });

  // PR #25 리뷰: 가져온 국내 종목이 모두 앱에 없으면 뺀 개수가 안 보였다.
  it('holdings: when every stock is unsupported it still says how many were left out', async () => {
    setup({ holdings: async () => stocks(['999998', '999999']) });
    await fireEvent.click(screen.getByRole('button', { name: '보유 종목' }));
    await vi.waitFor(() => screen.getByText('넣을 수 있는 국내 종목이 없어요'));
    expect(screen.getByText('지원하지 않는 종목 2개는 뺐어요')).toBeTruthy();
  });

  it('sectors: shows top-level sectors, searches every level, and creates a group named after the sector', async () => {
    const sectorStocks = vi.fn(async () => stocks(['000660', '005930']));
    const { app } = setup({
      sectors: async () => [
        { id: '1', name: 'IT', path: 'IT' },
        { id: '10', name: '반도체', path: 'IT › 반도체' },
        { id: '2', name: '금융', path: '금융' },
      ],
      sectorStocks,
    });
    await fireEvent.click(screen.getByRole('button', { name: '섹터' }));
    await vi.waitFor(() => screen.getByRole('button', { name: 'IT' }));
    expect(screen.queryByRole('button', { name: 'IT › 반도체' })).toBeNull();
    await fireEvent.input(screen.getByRole('searchbox', { name: '섹터 검색' }), { target: { value: '반도' } });
    await fireEvent.click(screen.getByRole('button', { name: 'IT › 반도체' }));
    expect(sectorStocks).toHaveBeenCalledWith('10');
    await fireEvent.click(await vi.waitFor(() => screen.getByRole('button', { name: "'반도체' 그룹 만들기" })));
    expect(app.watchlists.groups[1].name).toBe('반도체');
    expect(app.watchlists.groups[1].items.map((i) => i.symbol)).toEqual(['000660', '005930']);
  });
});
