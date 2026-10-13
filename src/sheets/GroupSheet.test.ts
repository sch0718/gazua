// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../lib/state/app.svelte';
import type { Group } from '../lib/state/schema';
import { kstEpoch } from '../lib/time/kst';
import SnackbarHost from '../lib/ui/components/SnackbarHost.svelte';
import { dismissSnackbar } from '../lib/ui/components/snackbarStore.svelte';
import GroupSheet from './GroupSheet.svelte';
import { itemsOf, makeTestApp } from './testApp';

const NOW = kstEpoch('2026-10-12', '10:00:00');
const TWO: Group[] = [
  { id: 'g1', name: '반도체', items: itemsOf(['005930', '000660', '042700', '000990']) },
  { id: 'g2', name: '배당', items: itemsOf(['069500']) },
];

let apps: App[] = [];
function setup(groups: Group[] = TWO) {
  const app = makeTestApp({ groups, now: NOW });
  apps.push(app);
  app.navigate({ name: 'compare', groupId: 'g1' });
  render(SnackbarHost);
  const view = render(GroupSheet, { open: true, app, onclose: vi.fn() });
  return Object.assign(app, { rerender: view.rerender });
}
const rowOf = (name: string) => screen.getByText(name, { selector: '.name' }).closest('li')!;
const names = (app: App) => app.watchlists.groups.map((g) => g.name);

afterEach(() => {
  for (const a of apps) a.destroy();
  apps = [];
  dismissSnackbar();
});

describe('GroupSheet', () => {
  it('lists the groups with their item counts', () => {
    setup();
    expect(screen.getByRole('dialog', { name: '그룹 관리' })).toBeTruthy();
    expect(within(rowOf('반도체')).getByText('4종목')).toBeTruthy();
    expect(within(rowOf('배당')).getByText('1종목')).toBeTruthy();
  });

  it('renames with a trimmed name and ignores a blank one', async () => {
    const app = setup();
    await fireEvent.click(screen.getByRole('button', { name: '반도체 이름 바꾸기' }));
    const input = screen.getByRole('textbox', { name: '그룹 이름' });
    await fireEvent.input(input, { target: { value: '  칩  ' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(names(app)).toEqual(['칩', '배당']);
    await fireEvent.click(screen.getByRole('button', { name: '칩 이름 바꾸기' }));
    const again = screen.getByRole('textbox', { name: '그룹 이름' });
    await fireEvent.input(again, { target: { value: '   ' } });
    await fireEvent.keyDown(again, { key: 'Enter' });
    expect(names(app)).toEqual(['칩', '배당']);
    const error = screen.getByText('이름을 입력해 주세요');
    expect(again.getAttribute('aria-describedby')).toBe(error.id);
    expect(again.getAttribute('aria-invalid')).toBe('true');
  });

  it('closing and reopening forgets an open delete prompt and an unfinished rename', async () => {
    const app = setup();
    await fireEvent.click(screen.getByRole('button', { name: '반도체 삭제' }));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    await app.rerender({ open: false, app, onclose: vi.fn() });
    await app.rerender({ open: true, app, onclose: vi.fn() });
    expect(screen.queryByRole('alertdialog')).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: '배당 이름 바꾸기' }));
    expect(screen.getByRole('textbox', { name: '그룹 이름' })).toBeTruthy();
    await app.rerender({ open: false, app, onclose: vi.fn() });
    await app.rerender({ open: true, app, onclose: vi.fn() });
    expect(screen.queryByRole('textbox', { name: '그룹 이름' })).toBeNull();
    expect(names(app)).toEqual(['반도체', '배당']);
  });

  it('moves groups up and down; the ends are disabled', async () => {
    const app = setup();
    expect(screen.getByRole('button', { name: '반도체 위로' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '배당 아래로' }).hasAttribute('disabled')).toBe(true);
    await fireEvent.click(screen.getByRole('button', { name: '반도체 아래로' }));
    expect(names(app)).toEqual(['배당', '반도체']);
    await fireEvent.click(screen.getByRole('button', { name: '반도체 위로' }));
    expect(names(app)).toEqual(['반도체', '배당']);
  });

  it('delete asks first with the item count, then deletes with 되돌리기 and leaves the deleted active group', async () => {
    const app = setup();
    await fireEvent.click(screen.getByRole('button', { name: '반도체 삭제' }));
    const confirm = screen.getByRole('alertdialog');
    expect(within(confirm).getByText("'반도체' 그룹과 종목 4개를 삭제할까요?")).toBeTruthy();
    await fireEvent.click(within(confirm).getByRole('button', { name: '취소' }));
    expect(names(app)).toEqual(['반도체', '배당']);

    await fireEvent.click(screen.getByRole('button', { name: '반도체 삭제' }));
    await fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '삭제' }));
    expect(names(app)).toEqual(['배당']);
    expect(app.route).toEqual({ name: 'compare', groupId: 'g2' });
    expect(screen.getByRole('status').textContent).toContain('그룹을 삭제했어요');
    await fireEvent.click(screen.getByRole('button', { name: '되돌리기' }));
    expect(names(app)).toEqual(['반도체', '배당']);
    expect(app.watchlists.groups[0].items).toHaveLength(4);
  });

  it('the last group cannot be deleted and says why', async () => {
    const app = setup([TWO[0]]);
    const del = screen.getByRole('button', { name: '반도체 삭제' });
    expect(del.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('그룹은 하나 이상 있어야 해요')).toBeTruthy();
    await fireEvent.click(del);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(names(app)).toEqual(['반도체']);
  });

  describe('focus after the delete prompt', () => {
    const THREE: Group[] = [...TWO, { id: 'g3', name: '해외', items: itemsOf(['133690']) }];
    const confirmDeleteOf = async (name: string) => {
      const del = screen.getByRole('button', { name: `${name} 삭제` });
      del.focus();
      await fireEvent.click(del);
      await fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '삭제' }));
      await tick();
    };

    it('moves to the delete button of the group now at the same position', async () => {
      setup(THREE);
      await confirmDeleteOf('반도체');
      expect(document.activeElement).toBe(screen.getByRole('button', { name: '배당 삭제' }));
      expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    });

    it('moves to 닫기 when the deleted group was the last one in the list', async () => {
      setup(THREE);
      await confirmDeleteOf('해외');
      expect(document.activeElement).toBe(screen.getByRole('button', { name: '닫기' }));
    });

    it('cancel returns focus to the group delete button', async () => {
      setup(THREE);
      const del = screen.getByRole('button', { name: '배당 삭제' });
      await fireEvent.click(del);
      await fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '취소' }));
      await tick();
      expect(document.activeElement).toBe(del);
    });

    it('되돌리기 is reachable by Tab from the last control and restores the group', async () => {
      const app = setup(THREE);
      await confirmDeleteOf('해외');
      const dialog = screen.getByRole('dialog');
      const inside = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled])')];
      inside.at(-1)!.focus();
      await fireEvent.keyDown(dialog, { key: 'Tab' });
      const undo = screen.getByRole('button', { name: '되돌리기' });
      expect(document.activeElement).toBe(undo);
      await fireEvent.click(undo);
      expect(names(app)).toEqual(['반도체', '배당', '해외']);
      // 되돌린 그룹의 삭제 버튼으로(대화상자 밖 body로 빠지지 않게)
      await tick();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: '해외 삭제' }));
    });
  });
});
