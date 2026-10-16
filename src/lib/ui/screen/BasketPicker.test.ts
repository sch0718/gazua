// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { itemsOf, makeTestApp } from '../../../sheets/testApp';
import { newBasket } from '../../screen/baskets';
import { NOW } from '../../screen/testData';
import type { App } from '../../state/app.svelte';
import BasketPicker from './BasketPicker.svelte';

const ITEMS = [{ s: '005930', n: '삼성전자', m: 'KOSPI', t: 'STOCK' }] as never;
let app: App | undefined;
afterEach(() => app?.destroy());

describe('BasketPicker focus', () => {
  it('after 종목 추가 → 완료 focus is on 종목 추가 inside the dialog; closing returns it to 묶음 관리', async () => {
    app = makeTestApp({ groups: [{ id: 'g1', name: 'g', items: itemsOf(['005930']) }], now: NOW });
    app.setBaskets([{ ...newBasket(NOW, '하나', ['005930']), id: 'b1' }]);
    render(BasketPicker, { app, selected: [], onchange: () => {}, loadItems: async () => ITEMS, themes: [] });
    const manage = screen.getByRole('button', { name: '묶음 관리' });
    manage.focus();
    await fireEvent.click(manage);
    await fireEvent.click(screen.getByRole('button', { name: '하나 편집' }));
    await fireEvent.click(screen.getByRole('button', { name: '종목 추가' }));
    await fireEvent.click(screen.getByRole('button', { name: '완료' }));
    await vi.waitFor(() => {
      const dlg = screen.getByRole('dialog', { name: '묶음 관리' });
      expect(document.activeElement).toBe(screen.getByRole('button', { name: '종목 추가' }));
      expect(dlg.contains(document.activeElement)).toBe(true);
    });
    await fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    await vi.waitFor(() => expect(document.activeElement).toBe(manage));
  });
});
