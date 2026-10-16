// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { itemsOf, makeTestApp } from '../../../sheets/testApp';
import type { UniverseItem } from '../../data/universe';
import { BASKET_CAP_MESSAGE, MAX_BASKETS, newBasket, type Basket } from '../../screen/baskets';
import { NOW } from '../../screen/testData';
import type { App } from '../../state/app.svelte';
import { currentSnackbar, dismissSnackbar, runSnackbarAction } from '../components/snackbarStore.svelte';
import BasketSheet from './BasketSheet.svelte';

const ITEMS = [
  { s: '005930', n: '삼성전자', m: 'KOSPI', t: 'STOCK' },
  { s: '000660', n: 'SK하이닉스', m: 'KOSPI', t: 'STOCK' },
  { s: '035420', n: 'NAVER', m: 'KOSPI', t: 'STOCK' },
] as unknown as UniverseItem[];
const NAMES = { '005930': '삼성전자', '000660': 'SK하이닉스', '035420': 'NAVER' };
const THEMES = [{ code: 'T01', name: '반도체', count: 2 }];

let apps: App[] = [];
function setup(o: { baskets?: Basket[]; themeSymbols?: string[]; themes?: typeof THEMES } = {}) {
  const app = makeTestApp({ groups: [{ id: 'g1', name: '반도체주', items: itemsOf(['005930', '000660']) }], now: NOW });
  apps.push(app);
  if (o.baskets) app.setBaskets(o.baskets);
  const onclose = vi.fn();
  const loadThemeSymbols = vi.fn(async () => o.themeSymbols ?? ['005930', '035420']);
  render(BasketSheet, { open: true, app, onclose, names: NAMES, loadItems: async () => ITEMS, themes: o.themes ?? THEMES, loadThemeSymbols });
  return { app, onclose, loadThemeSymbols };
}
const mk = (id: string, name: string, symbols: string[]): Basket => ({ ...newBasket(NOW, name, symbols), id });
afterEach(() => {
  for (const a of apps) a.destroy();
  apps = [];
  dismissSnackbar();
});

describe('BasketSheet', () => {
  it('a new basket is not saved until it has a stock', async () => {
    const { app } = setup();
    await fireEvent.click(screen.getByRole('button', { name: '＋ 새 묶음' }));
    expect(screen.getByRole('status').textContent).toContain('종목을 1개 이상 넣으면 저장돼요');
    expect(app.baskets).toEqual([]);
    // 이름을 고쳐도 저장하지 않는다
    const name = screen.getByRole('textbox', { name: '이름' });
    await fireEvent.input(name, { target: { value: '반도체 묶음' } });
    await fireEvent.keyDown(name, { key: 'Enter' });
    expect(app.baskets).toEqual([]);
    // 관심 그룹에서 가져오면 비로소 저장된다
    await fireEvent.click(screen.getByRole('button', { name: '관심 그룹에서 가져오기' }));
    expect(app.baskets).toHaveLength(1);
    expect(app.baskets[0].name).toBe('반도체 묶음');
    expect(app.baskets[0].symbols).toEqual(['005930', '000660']);
    expect(currentSnackbar()?.message).toBe('종목 2개를 가져왔어요');
  });

  it('closing the sheet drops a basket that never got a stock', async () => {
    const { app, onclose } = setup();
    await fireEvent.click(screen.getByRole('button', { name: '＋ 새 묶음' }));
    await fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(onclose).toHaveBeenCalled();
    expect(app.baskets).toEqual([]);
  });

  it('imports a theme through loadThemeSymbols, skipping stocks already in the basket', async () => {
    const { app, loadThemeSymbols } = setup({ baskets: [mk('b1', '내 묶음', ['005930'])] });
    await fireEvent.click(screen.getByRole('button', { name: '내 묶음 편집' }));
    await fireEvent.click(screen.getByRole('button', { name: '테마에서 가져오기' }));
    await vi.waitFor(() => expect(app.baskets[0].symbols).toEqual(['005930', '035420']));
    expect(loadThemeSymbols).toHaveBeenCalledWith('T01');
  });

  it('theme import is off with the re-collect hint on data without themes', async () => {
    setup({ baskets: [mk('b1', '내 묶음', ['005930'])], themes: [] });
    await fireEvent.click(screen.getByRole('button', { name: '내 묶음 편집' }));
    expect((screen.getByRole('button', { name: '테마에서 가져오기' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('테마: 다시 수집하면 쓸 수 있어요')).toBeTruthy();
  });

  it('removing a stock keeps the basket; removing the last one deletes it with undo', async () => {
    const { app } = setup({ baskets: [mk('b1', '내 묶음', ['005930', '000660'])] });
    await fireEvent.click(screen.getByRole('button', { name: '내 묶음 편집' }));
    await fireEvent.click(screen.getByRole('button', { name: '삼성전자 빼기' }));
    expect(app.baskets[0].symbols).toEqual(['000660']);
    await fireEvent.click(screen.getByRole('button', { name: 'SK하이닉스 빼기' }));
    // 0종목 묶음은 저장하지 않는다 = 삭제
    expect(app.baskets).toEqual([]);
    expect(currentSnackbar()?.message).toBe("'내 묶음' 묶음을 삭제했어요");
    expect(screen.getByRole('button', { name: '＋ 새 묶음' })).toBeTruthy();
    runSnackbarAction();
    expect(app.baskets).toHaveLength(1);
    expect(app.baskets[0].symbols).toEqual(['000660']);
  });

  it('deleting a basket offers undo, restores it in place, and moves focus to a neighbour', async () => {
    const { app } = setup({ baskets: [mk('b1', '하나', ['005930']), mk('b2', '둘', ['000660']), mk('b3', '셋', ['035420'])] });
    await fireEvent.click(screen.getByRole('button', { name: '둘 삭제' }));
    expect(app.baskets.map((b) => b.id)).toEqual(['b1', 'b3']);
    await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '셋 삭제' })));
    runSnackbarAction();
    expect(app.baskets.map((b) => b.id)).toEqual(['b1', 'b2', 'b3']);
  });

  it('deleting the last basket moves focus to ＋ 새 묶음', async () => {
    const { app } = setup({ baskets: [mk('b1', '하나', ['005930'])] });
    await fireEvent.click(screen.getByRole('button', { name: '하나 삭제' }));
    expect(app.baskets).toEqual([]);
    await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '＋ 새 묶음' })));
  });

  it('renames a saved basket and rejects an empty name', async () => {
    const { app } = setup({ baskets: [mk('b1', '하나', ['005930'])] });
    await fireEvent.click(screen.getByRole('button', { name: '하나 편집' }));
    const name = screen.getByRole('textbox', { name: '이름' }) as HTMLInputElement;
    expect(name.maxLength).toBe(30);
    await fireEvent.input(name, { target: { value: '  ' } });
    await fireEvent.keyDown(name, { key: 'Enter' });
    expect(screen.getByRole('alert').textContent).toBe('이름을 적어 주세요');
    expect(app.baskets[0].name).toBe('하나');
    await fireEvent.input(name, { target: { value: '새 이름' } });
    await fireEvent.keyDown(name, { key: 'Enter' });
    expect(app.baskets[0].name).toBe('새 이름');
  });

  it('adds stocks through the multi-add sheet, then returns to the basket', async () => {
    const { app } = setup({ baskets: [mk('b1', '하나', ['005930'])] });
    await fireEvent.click(screen.getByRole('button', { name: '하나 편집' }));
    await fireEvent.click(screen.getByRole('button', { name: '종목 추가' }));
    expect(screen.getByRole('dialog', { name: '묶음에 종목 추가' })).toBeTruthy();
    await fireEvent.input(await screen.findByRole('searchbox', { name: '종목 검색' }), { target: { value: 'NAVER' } });
    await fireEvent.click(await screen.findByRole('button', { name: 'NAVER 추가' }));
    expect(app.baskets[0].symbols).toEqual(['005930', '035420']);
    expect(screen.getByRole('button', { name: 'NAVER 추가됨' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: '완료' }));
    const dlg = screen.getByRole('dialog', { name: '묶음 관리' });
    expect(within(dlg).getByRole('button', { name: 'NAVER 빼기' })).toBeTruthy();
  });

  it('stops at the cap of 30 baskets', async () => {
    const many = Array.from({ length: MAX_BASKETS }, (_, i) => mk(`b${i}`, `묶음${i}`, ['005930']));
    setup({ baskets: many });
    const add = screen.getByRole('button', { name: '＋ 새 묶음' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(screen.getByText(BASKET_CAP_MESSAGE)).toBeTruthy();
  });
});
