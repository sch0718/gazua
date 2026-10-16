// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ThemePicker from './ThemePicker.svelte';

const THEMES = [
  { code: 'T01', name: '반도체 장비', count: 12 },
  { code: 'T02', name: '2차전지', count: 30 },
  { code: 'T03', name: '반도체 소재', count: 8 },
];

function setup(o: { selected?: string[]; disabled?: boolean; themes?: typeof THEMES | undefined } = {}) {
  const onchange = vi.fn();
  render(ThemePicker, { themes: 'themes' in o ? o.themes : THEMES, selected: o.selected ?? [], disabled: o.disabled, onchange });
  return { onchange };
}

describe('ThemePicker', () => {
  it('lists every theme with its stock count', () => {
    setup();
    const group = screen.getByRole('group', { name: '테마 목록' });
    expect(within(group).getAllByRole('checkbox')).toHaveLength(3);
    expect(within(group).getByText('12종목')).toBeTruthy();
    expect(within(group).getByText('2차전지')).toBeTruthy();
  });

  it('search narrows the list by name', async () => {
    setup();
    await fireEvent.input(screen.getByRole('searchbox', { name: '테마 검색' }), { target: { value: '반도체' } });
    const group = screen.getByRole('group', { name: '테마 목록' });
    expect(within(group).getAllByRole('checkbox')).toHaveLength(2);
    expect(within(group).queryByText('2차전지')).toBeNull();
    await fireEvent.input(screen.getByRole('searchbox', { name: '테마 검색' }), { target: { value: '없는테마' } });
    expect(screen.getByText("'없는테마'에 맞는 테마가 없어요")).toBeTruthy();
  });

  it('checking a theme reports the new code list', async () => {
    const { onchange } = setup({ selected: ['T02'] });
    await fireEvent.click(screen.getByRole('checkbox', { name: /반도체 장비/ }));
    expect(onchange).toHaveBeenCalledWith(['T02', 'T01']);
  });

  it('selected themes are chips and each chip has its own remove button', async () => {
    const { onchange } = setup({ selected: ['T01', 'T02'] });
    const chips = screen.getByRole('list', { name: '고른 테마' });
    expect(within(chips).getAllByRole('listitem')).toHaveLength(2);
    await fireEvent.click(screen.getByRole('button', { name: '반도체 장비 테마 지우기' }));
    expect(onchange).toHaveBeenCalledWith(['T02']);
  });

  it('a chip for a theme missing from the file shows its code and can still be removed', async () => {
    const { onchange } = setup({ selected: ['T99'] });
    await fireEvent.click(screen.getByRole('button', { name: 'T99 테마 지우기' }));
    expect(onchange).toHaveBeenCalledWith([]);
  });

  it('v1 data: picking is off with the re-collect hint, but a saved chip can still be removed', async () => {
    const { onchange } = setup({ themes: [], disabled: true, selected: ['T01'] });
    expect(screen.getByText('다시 수집하면 쓸 수 있어요')).toBeTruthy();
    expect((screen.getByRole('searchbox', { name: '테마 검색' }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('group', { name: '테마 목록' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'T01 테마 지우기' }));
    expect(onchange).toHaveBeenCalledWith([]);
  });
});
