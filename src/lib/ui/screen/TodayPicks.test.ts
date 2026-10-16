// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { itemsOf, makeTestApp } from '../../../sheets/testApp';
import { NAME_MAX } from '../../screen/defaults';
import { NOW } from '../../screen/testData';
import type { App } from '../../state/app.svelte';
import { MAX_ITEMS } from '../../state/watchlist';
import { validationResult } from './resultFixture';
import TodayPicks from './TodayPicks.svelte';

let apps: App[] = [];
const selection = validationResult().today;
const symbols = selection.picked.map((p) => p.symbol);

function setup(groups = [{ id: 'g1', name: '반도체', items: itemsOf(['005930', '000660', '035420', '051910', '068270']) }], sel = selection) {
  const app = makeTestApp({ groups, now: NOW });
  apps.push(app);
  render(TodayPicks, { app, selection: sel, names: { [symbols[0]]: '이름있는종목' }, criteriaName: '반등 기준' });
  return app;
}
afterEach(() => {
  for (const a of apps) a.destroy();
  apps = [];
});

describe('TodayPicks', () => {
  it('lists the picks with names, falling back to the code', () => {
    setup();
    expect(screen.getByText('이름있는종목')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(10);
    expect(screen.getByText(symbols[1], { selector: 'span.nm' })).toBeTruthy();
  });

  it('makes a new group named after the criteria with the top 8 of 10 and says 상위 8개만 넣었어요', async () => {
    const app = setup();
    await fireEvent.click(screen.getByRole('button', { name: '관심 그룹으로 만들기' }));
    expect((screen.getByRole('textbox', { name: '새 그룹 이름' }) as HTMLInputElement).value).toBe('반등 기준');
    await fireEvent.click(screen.getByRole('button', { name: '새 그룹으로 만들기' }));
    const g = app.watchlists.groups.find((x) => x.name === '반등 기준')!;
    expect(g.items.map((i) => i.symbol)).toEqual(symbols.slice(0, MAX_ITEMS));
    expect(screen.getByText('상위 8개만 넣었어요')).toBeTruthy();
  });

  it('does not say it cut anything when all picks fit', async () => {
    const app = setup(undefined, { ...selection, picked: selection.picked.slice(0, 5) });
    await fireEvent.click(screen.getByRole('button', { name: '관심 그룹으로 만들기' }));
    await fireEvent.click(screen.getByRole('button', { name: '새 그룹으로 만들기' }));
    expect(app.watchlists.groups.at(-1)!.items).toHaveLength(5);
    expect(screen.queryByText(/만 넣었어요/)).toBeNull();
  });

  it('adding to an existing group fills only the free slots', async () => {
    const app = setup();
    await fireEvent.click(screen.getByRole('button', { name: '관심 그룹으로 만들기' }));
    await fireEvent.click(screen.getByRole('button', { name: /반도체/ }));
    const g = app.watchlists.groups[0];
    expect(g.items).toHaveLength(MAX_ITEMS);
    expect(g.items.slice(5).map((i) => i.symbol)).toEqual(symbols.slice(0, 3));
    expect(screen.getByText('상위 3개만 넣었어요')).toBeTruthy();
  });

  it('a full group cannot be chosen, and symbols already in the group do not use a slot', async () => {
    const full = { id: 'full', name: '가득', items: itemsOf(Array.from({ length: 8 }, (_, i) => `10000${i}`)) };
    const part = { id: 'part', name: '일부', items: itemsOf([symbols[0], '200000']) };
    const app = setup([full, part]);
    await fireEvent.click(screen.getByRole('button', { name: '관심 그룹으로 만들기' }));
    expect((screen.getByRole('button', { name: /가득/ }) as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(screen.getByRole('button', { name: /일부/ }));
    const g = app.watchlists.groups.find((x) => x.id === 'part')!;
    expect(g.items.map((i) => i.symbol)).toEqual([symbols[0], '200000', ...symbols.slice(1, 7)]);
    expect(screen.getByText(/'일부'에 6개를 넣었어요\(이미 있던 1개는 건너뛰었어요\)/)).toBeTruthy();
  });

  it('an empty name falls back to the criteria name', async () => {
    const app = setup();
    await fireEvent.click(screen.getByRole('button', { name: '관심 그룹으로 만들기' }));
    await fireEvent.input(screen.getByRole('textbox', { name: '새 그룹 이름' }), { target: { value: '   ' } });
    await fireEvent.click(screen.getByRole('button', { name: '새 그룹으로 만들기' }));
    expect(app.watchlists.groups.at(-1)!.name).toBe('반등 기준');
  });

  it('the name field is capped at NAME_MAX and the sheet subheading is an h3', async () => {
    setup();
    await fireEvent.click(screen.getByRole('button', { name: '관심 그룹으로 만들기' }));
    expect((screen.getByRole('textbox', { name: '새 그룹 이름' }) as HTMLInputElement).maxLength).toBe(NAME_MAX);
    expect(screen.getByRole('heading', { name: '기존 그룹에 더하기' }).tagName).toBe('H3');
  });

  it('after creating, a button goes to the compare screen with that group selected', async () => {
    const app = setup();
    await fireEvent.click(screen.getByRole('button', { name: '관심 그룹으로 만들기' }));
    await fireEvent.click(screen.getByRole('button', { name: '새 그룹으로 만들기' }));
    await fireEvent.click(screen.getByRole('button', { name: '비교 화면에서 보기' }));
    const id = app.watchlists.groups.find((x) => x.name === '반등 기준')!.id;
    expect(app.route).toEqual({ name: 'compare', groupId: id });
  });

  it('no picks today: says so and offers no group button', () => {
    setup(undefined, { ...selection, passed: 0, picked: [] });
    expect(screen.getByText('오늘 기준으로 조건을 통과한 종목이 없어요')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '관심 그룹으로 만들기' })).toBeNull();
  });
});
