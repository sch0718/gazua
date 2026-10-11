// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UniverseItem } from '../lib/data/universe';
import type { App } from '../lib/state/app.svelte';
import { kstEpoch } from '../lib/time/kst';
import { currentSnackbar, dismissSnackbar } from '../lib/ui/components/snackbarStore.svelte';
import AddStockSheet from './AddStockSheet.svelte';
import { itemsOf, makeTestApp } from './testApp';

const NOW = kstEpoch('2026-10-12', '10:00:00');
const UNIVERSE: UniverseItem[] = [
  { s: '005930', n: '삼성전자', m: 'KOSPI', t: 'STOCK' },
  { s: '000660', n: 'SK하이닉스', m: 'KOSPI', t: 'STOCK' },
  { s: '042700', n: '한미반도체', m: 'KOSPI', t: 'STOCK' },
  { s: '000990', n: 'DB하이텍', m: 'KOSPI', t: 'STOCK' },
  { s: '128940', n: '한미약품', m: 'KOSPI', t: 'STOCK' },
  { s: '009150', n: '삼성전기', m: 'KOSPI', t: 'STOCK' },
  { s: '069500', n: 'KODEX 200', m: 'KOSPI', t: 'ETF' },
  { s: '247540', n: '에코프로비엠', m: 'KOSDAQ', t: 'STOCK' },
];
const EXAMPLE = ['005930', '000660', '042700', '000990'];
const EIGHT = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8'];

let apps: App[] = [];
function setup(symbols: string[], opts: { recent?: string[]; load?: () => Promise<UniverseItem[]> } = {}) {
  const app = makeTestApp({ groups: [{ id: 'g1', name: '반도체', items: itemsOf(symbols) }], now: NOW, recent: opts.recent });
  apps.push(app);
  const onclose = vi.fn();
  render(AddStockSheet, {
    open: true,
    app,
    groupId: 'g1',
    metas: {},
    now: NOW,
    onclose,
    loadItems: opts.load ?? (async () => UNIVERSE),
  });
  return { app, onclose };
}
const search = (q: string) => fireEvent.input(screen.getByRole('searchbox', { name: '종목 검색' }), { target: { value: q } });
const rowOf = (name: string) => screen.getByText((_, el) => el?.tagName === 'B' && el.textContent === name).closest('li')!;

afterEach(() => {
  for (const a of apps) a.destroy();
  apps = [];
  dismissSnackbar();
});

describe('AddStockSheet', () => {
  it('ㅎㅁ finds 한미반도체 (already in the group) with the match highlighted; subtitle counts the group', async () => {
    setup(EXAMPLE);
    expect(screen.getByText('반도체 그룹 · 4/8 · 4개 더 추가할 수 있어요')).toBeTruthy();
    await vi.waitFor(() => expect(screen.getByRole('searchbox', { name: '종목 검색' }).hasAttribute('data-autofocus')).toBe(true));
    await search('ㅎㅁ');
    const row = await vi.waitFor(() => rowOf('한미반도체'));
    expect(within(row).getByText(/042700 · KOSPI · 이미 추가됨/)).toBeTruthy();
    expect(within(row).getByRole('button', { name: '한미반도체 추가됨' }).textContent).toContain('✓');
    expect(row.querySelector('mark')?.textContent).toBe('한미');
    expect(within(rowOf('한미약품')).getByRole('button', { name: '한미약품 추가' }).textContent).toContain('＋');
  });

  it('a full group disables every ＋ and says why', async () => {
    setup(EIGHT);
    await search('삼성');
    await vi.waitFor(() => rowOf('삼성전자'));
    expect(screen.getByText('한 차트에 8개까지 비교할 수 있어요')).toBeTruthy();
    const plus = screen.getAllByRole('button', { name: /추가$/ });
    expect(plus.length).toBeGreaterThan(0);
    for (const b of plus) expect(b.getAttribute('aria-disabled')).toBe('true');
    await fireEvent.click(plus[0]);
    expect(currentSnackbar()?.message).toBe('한 차트에 8개까지 비교할 수 있어요');
  });

  it('adding two in a row counts them in the footer, saves them and remembers them as recent', async () => {
    const { app, onclose } = setup(['005930']);
    expect(screen.getByText('여러 개를 연달아 추가할 수 있어요')).toBeTruthy();
    await search('삼성');
    await fireEvent.click(await vi.waitFor(() => screen.getByRole('button', { name: '삼성전기 추가' })));
    await search('에코');
    await fireEvent.click(await vi.waitFor(() => screen.getByRole('button', { name: '에코프로비엠 추가' })));
    expect(screen.getByText('이번에 2개 추가했어요')).toBeTruthy();
    expect(app.watchlists.groups[0].items.map((i) => i.symbol)).toEqual(['005930', '009150', '247540']);
    expect(app.watchlists.groups[0].items.map((i) => i.colorSlot)).toEqual([1, 2, 3]);
    expect(app.recent).toEqual(['247540', '009150']);
    expect(screen.getByText('반도체 그룹 · 3/8 · 5개 더 추가할 수 있어요')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: '완료' }));
    expect(onclose).toHaveBeenCalled();
  });

  it('an empty query lists the recent additions, most recent first', async () => {
    setup(['005930'], { recent: ['069500', '005930'] });
    await vi.waitFor(() => expect(screen.getByText('최근 추가')).toBeTruthy());
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((r) => r.querySelector('b')?.textContent)).toEqual(['KODEX 200', '삼성전자']);
    expect(within(rows[0]).getByText('ETF')).toBeTruthy();
  });

  it('says when nothing matches', async () => {
    setup([]);
    await search('없는종목');
    await vi.waitFor(() => expect(screen.getByText("'없는종목'에 맞는 종목이 없어요")).toBeTruthy());
  });

  it('a failed universe load offers 다시 시도', async () => {
    const load = vi.fn<() => Promise<UniverseItem[]>>().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(UNIVERSE);
    setup([], { load });
    await vi.waitFor(() => expect(screen.getByText('종목 목록을 불러오지 못했어요')).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    await search('삼성전자');
    await vi.waitFor(() => rowOf('삼성전자'));
    expect(screen.queryByText('종목 목록을 불러오지 못했어요')).toBeNull();
  });
});
