// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UniverseItem } from '../lib/data/universe';
import type { App } from '../lib/state/app.svelte';
import { kstEpoch } from '../lib/time/kst';
import { currentSnackbar, dismissSnackbar } from '../lib/ui/components/snackbarStore.svelte';
import { MAX_ITEMS } from '../lib/state/watchlist';
import PickByCriteriaSheet from './PickByCriteriaSheet.svelte';
import { itemsOf, makeTestApp } from './testApp';

const NOW = kstEpoch('2026-10-16', '20:30:00');
const CODES = Array.from({ length: 34 }, (_, i) => `1${String(i).padStart(5, '0')}`);
const UNIVERSE: UniverseItem[] = [
  { s: '005930', n: '삼성전자', m: 'KOSPI', t: 'STOCK' },
  { s: '000660', n: 'SK하이닉스', m: 'KOSPI', t: 'STOCK' },
  ...CODES.map((s, i): UniverseItem => ({ s, n: `종목${i + 1}`, m: 'KOSPI', t: 'STOCK' })),
];

let apps: App[] = [];
function setup(groups = [{ id: 'g1', name: '반도체', items: itemsOf(CODES.slice(0, 12).slice(0, MAX_ITEMS)) }]) {
  const app = makeTestApp({ groups, now: NOW });
  apps.push(app);
  const onclose = vi.fn();
  render(PickByCriteriaSheet, { open: true, app, onclose, now: () => NOW, loadItems: async () => UNIVERSE });
  return { app, onclose };
}
const candidates = () => within(screen.getByRole('list', { name: '담은 후보' })).getAllByRole('listitem');

afterEach(() => {
  for (const a of apps) a.destroy();
  apps = [];
  dismissSnackbar();
});

describe('PickByCriteriaSheet', () => {
  it('adds candidates by search and from a group, and removes one', async () => {
    setup();
    await fireEvent.input(screen.getByRole('searchbox', { name: '후보 종목 검색' }), { target: { value: '삼성' } });
    await fireEvent.click(await vi.waitFor(() => screen.getByRole('button', { name: /삼성전자/ })));
    await fireEvent.click(screen.getByRole('button', { name: "'반도체' 담기" }));
    expect(candidates()).toHaveLength(1 + MAX_ITEMS);
    expect(screen.getByText(`'반도체'에서 ${MAX_ITEMS}개를 담았어요`)).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: '삼성전자 빼기' }));
    expect(candidates()).toHaveLength(MAX_ITEMS);
  });

  it('keeps at most 30 candidates and says how many were left out', async () => {
    const groups = [
      { id: 'g1', name: '하나', items: itemsOf(CODES.slice(0, 10)) },
      { id: 'g2', name: '둘', items: itemsOf(CODES.slice(10, 20)) },
      { id: 'g3', name: '셋', items: itemsOf(CODES.slice(20, 30)) },
      { id: 'g4', name: '넷', items: itemsOf(CODES.slice(24, 34)) },
    ];
    setup(groups);
    for (const n of ['하나', '둘', '셋']) await fireEvent.click(screen.getByRole('button', { name: `'${n}' 담기` }));
    expect(candidates()).toHaveLength(30);
    expect((screen.getByRole('button', { name: "'넷' 담기" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('30/30')).toBeTruthy();
  });

  it('previews the ranking and makes a new group from the top ones, leaving other groups alone', async () => {
    const { app, onclose } = setup();
    await fireEvent.click(screen.getByRole('button', { name: "'반도체' 담기" }));
    await fireEvent.change(screen.getByRole('combobox', { name: '지표' }), { target: { value: 'change' } });
    await fireEvent.click(screen.getByRole('button', { name: '1개월' }));
    await fireEvent.click(screen.getByRole('button', { name: '미리보기' }));
    const make = await vi.waitFor(() => screen.getByRole('button', { name: /개로 새 그룹 만들기$/ }), { timeout: 4000 });
    expect(screen.getByRole('heading', { name: /미리보기 · 1개월 · 등락률 큰 순/ })).toBeTruthy();
    const rows = within(screen.getByRole('list', { name: '순위' })).getAllByRole('listitem');
    expect(rows).toHaveLength(MAX_ITEMS);
    const top = rows.filter((r) => within(r).queryByText('넣음')).map((r) => r.querySelector('.nm')!.textContent);
    expect((screen.getByRole('textbox', { name: '그룹 이름' }) as HTMLInputElement).value).toBe('등락률 상위');
    await fireEvent.click(make);
    const groups = app.watchlists.groups;
    expect(groups).toHaveLength(2);
    expect(groups[0].items).toHaveLength(MAX_ITEMS);
    expect(groups[1].name).toBe('등락률 상위');
    // 미리보기에서 `넣음`으로 표시된 종목이 그 순서대로 새 그룹이 된다.
    expect(groups[1].items.map((i) => UNIVERSE.find((u) => u.s === i.symbol)!.n)).toEqual(top);
    expect(top.length).toBeGreaterThan(0);
    expect(currentSnackbar()?.message).toBe("'등락률 상위' 그룹을 만들었어요");
    expect(onclose).toHaveBeenCalled();
    expect(location.hash).toBe(`#/compare/${groups[1].id}`);
  });

  it('changing the criteria clears the preview', async () => {
    setup();
    await fireEvent.click(screen.getByRole('button', { name: "'반도체' 담기" }));
    await fireEvent.click(screen.getByRole('button', { name: '미리보기' }));
    await vi.waitFor(() => screen.getByRole('button', { name: /개로 새 그룹 만들기$/ }), { timeout: 4000 });
    await fireEvent.click(screen.getByRole('button', { name: '작은 순' }));
    expect(screen.queryByRole('button', { name: /개로 새 그룹 만들기$/ })).toBeNull();
  });

  // Codex 리뷰(PR #32) 1: 종목 정보 요청이 실패하면 진행 표시에 멈추지 않고 알린 뒤 다시 시도할 수 있다.
  it('a failed stock-meta request ends the preview with a message and the button works again', async () => {
    const { app } = setup();
    vi.spyOn(app.provider, 'getStockMeta').mockRejectedValueOnce(new Error('offline'));
    await fireEvent.click(screen.getByRole('button', { name: "'반도체' 담기" }));
    await fireEvent.click(screen.getByRole('button', { name: '미리보기' }));
    await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toBe('종목 정보를 받지 못했어요. 다시 시도해 주세요'));
    expect(screen.queryByText(/계산 중/)).toBeNull();
    expect((screen.getByRole('button', { name: '미리보기' }) as HTMLButtonElement).disabled).toBe(false);
  });

  // Codex 리뷰(PR #32) 2: 계산 중에 닫았다 다시 열면 이전 계산 결과가 새 시트에 나오지 않는다.
  it('a preview still running when the sheet closes does not show up after reopening', async () => {
    const app = makeTestApp({ groups: [{ id: 'g1', name: '반도체', items: itemsOf(CODES.slice(0, 3)) }], now: NOW });
    apps.push(app);
    const real = app.provider.getStockMeta.bind(app.provider);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.spyOn(app.provider, 'getStockMeta').mockImplementationOnce(async (s) => {
      await gate;
      return real(s);
    });
    const view = render(PickByCriteriaSheet, { open: true, app, onclose: vi.fn(), now: () => NOW, loadItems: async () => UNIVERSE });
    await fireEvent.click(screen.getByRole('button', { name: "'반도체' 담기" }));
    await fireEvent.click(screen.getByRole('button', { name: '미리보기' }));
    await view.rerender({ open: false });
    await view.rerender({ open: true });
    release();
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByRole('list', { name: '순위' })).toBeNull();
    expect(screen.queryByRole('button', { name: /개로 새 그룹 만들기$/ })).toBeNull();
    expect(screen.getByText('0/30')).toBeTruthy();
  });

  // Codex 리뷰(PR #32) 3: 종목 목록을 처음에 받지 못했어도 다시 열면 다시 받는다.
  it('a failed universe load is retried on the next open', async () => {
    const app = makeTestApp({ groups: [{ id: 'g1', name: '반도체', items: [] }], now: NOW });
    apps.push(app);
    const loadItems = vi.fn<() => Promise<UniverseItem[]>>().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(UNIVERSE);
    const view = render(PickByCriteriaSheet, { open: true, app, onclose: vi.fn(), now: () => NOW, loadItems });
    await vi.waitFor(() => expect(loadItems).toHaveBeenCalledTimes(1));
    await view.rerender({ open: false });
    await view.rerender({ open: true });
    await vi.waitFor(() => expect(loadItems).toHaveBeenCalledTimes(2));
    await fireEvent.input(screen.getByRole('searchbox', { name: '후보 종목 검색' }), { target: { value: '삼성' } });
    await vi.waitFor(() => screen.getByRole('button', { name: /삼성전자/ }));
  });

  // Codex 리뷰(PR #32) 4: 닫기 전에 시작한 토스 보유 종목 담기는 다시 연 시트에 들어가지 않는다.
  it('a holdings import still running when the sheet closes does not land in the reopened sheet', async () => {
    const app = makeTestApp({ groups: [{ id: 'g1', name: '반도체', items: [] }], now: NOW });
    apps.push(app);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    (app.provider as { groupImport?: unknown }).groupImport = {
      holdings: async () => {
        await gate;
        return [{ symbol: '005930', name: '삼성전자' }];
      },
      sectors: async () => [],
      sectorStocks: async () => [],
    };
    const view = render(PickByCriteriaSheet, { open: true, app, onclose: vi.fn(), now: () => NOW, loadItems: async () => UNIVERSE });
    await fireEvent.click(screen.getByRole('button', { name: '토스 보유 종목 담기' }));
    await view.rerender({ open: false });
    await view.rerender({ open: true });
    release();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText('0/30')).toBeTruthy();
    expect(screen.queryByText(/토스 보유 종목에서/)).toBeNull();
  });
});
