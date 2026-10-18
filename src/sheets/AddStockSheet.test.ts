// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UniverseItem } from '../lib/data/universe';
import type { App } from '../lib/state/app.svelte';
import { kstEpoch } from '../lib/time/kst';
import { currentSnackbar, dismissSnackbar, runSnackbarAction } from '../lib/ui/components/snackbarStore.svelte';
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
    expect(within(row).getByRole('button', { name: '한미반도체 빼기' }).textContent).toContain('✓');
    expect(row.querySelector('mark')?.textContent).toBe('한미');
    expect(within(rowOf('한미약품')).getByRole('button', { name: '한미약품 추가' }).textContent).toContain('＋');
  });

  it('a full group disables every ＋ and says why', async () => {
    setup(EIGHT);
    await search('삼성');
    await vi.waitFor(() => rowOf('삼성전자'));
    const note = screen.getByText('한 차트에 8개까지 비교할 수 있어요');
    const plus = screen.getAllByRole('button', { name: /추가$/ });
    expect(plus.length).toBeGreaterThan(0);
    for (const b of plus) {
      expect(b.getAttribute('aria-disabled')).toBe('true');
      expect(b.getAttribute('aria-describedby')).toBe(note.id);
    }
    await fireEvent.click(plus[0]);
    expect(currentSnackbar()?.message).toBe('한 차트에 8개까지 비교할 수 있어요');
  });

  it('adding two in a row counts them in the footer, saves them and remembers them as recent', async () => {
    const { app, onclose } = setup(['005930']);
    expect(screen.getByText('여러 개를 연달아 추가하고, ✓를 누르면 빼요')).toBeTruthy();
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

  it('tapping an already-added stock (✓) removes it from the group with an undo', async () => {
    const { app } = setup(EXAMPLE);
    await search('ㅎㅁ');
    await fireEvent.click(await vi.waitFor(() => screen.getByRole('button', { name: '한미반도체 빼기' })));
    expect(app.watchlists.groups[0].items.map((i) => i.symbol)).toEqual(['005930', '000660', '000990']);
    expect(within(rowOf('한미반도체')).getByRole('button', { name: '한미반도체 추가' }).textContent).toContain('＋');
    expect(screen.getByText('반도체 그룹 · 3/8 · 5개 더 추가할 수 있어요')).toBeTruthy();
    expect(screen.getByText('이번에 1개 뺐어요')).toBeTruthy();
    expect(currentSnackbar()?.message).toBe('한미반도체을(를) 삭제했어요');
    currentSnackbar()?.action?.run();
    expect(app.watchlists.groups[0].items.map((i) => i.symbol)).toContain('042700');
  });

  // PR #24 리뷰: 키보드로 되돌리면 포커스가 body로 빠졌다. 되돌린 종목의 버튼으로 돌려준다.
  it('after 되돌리기 the focus goes back to the restored stock\'s button', async () => {
    setup(EXAMPLE);
    await search('ㅎㅁ');
    await fireEvent.click(await vi.waitFor(() => screen.getByRole('button', { name: '한미반도체 빼기' })));
    runSnackbarAction();
    await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '한미반도체 빼기' })));
  });

  it('a full group still lets you remove an added stock, which frees a slot', async () => {
    const { app } = setup(['005930', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8']);
    await search('삼성');
    const remove = await vi.waitFor(() => screen.getByRole('button', { name: '삼성전자 빼기' }));
    expect(remove.getAttribute('aria-disabled')).toBeNull();
    await fireEvent.click(remove);
    expect(app.watchlists.groups[0].items).toHaveLength(7);
    expect(screen.getByRole('button', { name: '삼성전기 추가' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('the footer counts additions and removals together', async () => {
    setup(['005930']);
    await search('삼성');
    await fireEvent.click(await vi.waitFor(() => screen.getByRole('button', { name: '삼성전기 추가' })));
    await fireEvent.click(screen.getByRole('button', { name: '삼성전자 빼기' }));
    expect(screen.getByText('이번에 1개 추가, 1개 뺐어요')).toBeTruthy();
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

describe('AddStockSheet modes (전략 편집)', () => {
  function setupMode(props: Record<string, unknown>) {
    const app = makeTestApp({ groups: [{ id: 'g1', name: '반도체', items: itemsOf([]) }], now: NOW });
    apps.push(app);
    const onclose = vi.fn();
    const onpick = vi.fn();
    render(AddStockSheet, { open: true, app, groupId: '', metas: {}, now: NOW, onclose, onpick, loadItems: async () => UNIVERSE, ...props });
    return { app, onclose, onpick };
  }

  it('single: tapping a row picks it, closes, and never touches the watchlist', async () => {
    const { app, onclose, onpick } = setupMode({ mode: 'single', title: '비교 종목' });
    expect(screen.getByRole('dialog', { name: '비교 종목' })).toBeTruthy();
    await search('삼성전자');
    await fireEvent.click(await vi.waitFor(() => screen.getByRole('button', { name: '삼성전자 선택' })));
    expect(onpick).toHaveBeenCalledWith(expect.objectContaining({ s: '005930', n: '삼성전자' }));
    expect(onclose).toHaveBeenCalled();
    expect(app.watchlists.groups[0].items).toHaveLength(0);
  });

  it('multi: picks without closing, marks picked rows, and tells when the limit is reached', async () => {
    const { onpick, onclose } = setupMode({ mode: 'multi', picked: ['005930'], max: 2, title: '종목 고르기' });
    expect(screen.getByText(/1\/2/)).toBeTruthy();
    await search('삼성');
    await vi.waitFor(() => rowOf('삼성전자'));
    expect(within(rowOf('삼성전자')).getByRole('button', { name: '삼성전자 추가됨' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: '삼성전기 추가' }));
    expect(onpick).toHaveBeenCalledWith(expect.objectContaining({ s: '009150' }));
    expect(onclose).not.toHaveBeenCalled();
  });

  it('multi: at the limit a tap shows the snackbar instead of picking', async () => {
    const { onpick } = setupMode({ mode: 'multi', picked: ['A1', 'A2'], max: 2, limitMessage: '2종목까지 넣을 수 있어요' });
    await search('삼성');
    await fireEvent.click(await vi.waitFor(() => screen.getByRole('button', { name: '삼성전기 추가' })));
    expect(onpick).not.toHaveBeenCalled();
    expect(currentSnackbar()?.message).toBe('2종목까지 넣을 수 있어요');
  });
});

