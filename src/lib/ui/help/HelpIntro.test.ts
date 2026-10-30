// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { createHelpSeenStore } from '../../help/seen';
import { clearImport, stashImport } from '../../share/pendingImport';
import { groupSnapshot } from '../../share/snapshot';
import type { App } from '../../state/app.svelte';
import { makeTestApp } from '../../../sheets/testApp';
import HelpIntro from './HelpIntro.svelte';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  } as unknown as Storage;
}

let apps: App[] = [];
function setup() {
  const app = makeTestApp({ groups: [{ id: 'g1', name: '반도체', items: [] }], now: Date.UTC(2026, 9, 16) });
  apps.push(app);
  const storage = memoryStorage();
  const store = createHelpSeenStore(() => storage);
  render(HelpIntro, { app, store });
  return { app, store };
}
const intro = () => screen.queryByRole('dialog', { name: '비교 차트' });

afterEach(() => {
  for (const a of apps) a.destroy();
  apps = [];
  document.body.innerHTML = '';
  clearImport();
});

describe('HelpIntro', () => {
  it('shows the menu intro once; 시작하기 closes it and it does not come back', async () => {
    const { app, store } = setup();
    await waitFor(() => expect(intro()).toBeTruthy());
    expect(screen.getByRole('img', { name: /비교 차트 사용법/ })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: '시작하기' }));
    expect(intro()).toBeNull();
    expect(store.read().has('compare')).toBe(true);
    app.navigate({ name: 'settings' });
    app.navigate({ name: 'compare', groupId: 'g1' });
    await tick();
    await new Promise((r) => setTimeout(r, 0));
    expect(intro()).toBeNull();
  });

  it('도움말 자세히 opens that menu help and counts as seen', async () => {
    const { app, store } = setup();
    await waitFor(() => expect(intro()).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: '도움말 자세히' }));
    expect(app.route).toEqual({ name: 'help', helpId: 'compare' });
    expect(store.read().has('compare')).toBe(true);
  });

  it('each entry menu has its own intro, but editors and settings have none', async () => {
    const { app } = setup();
    await waitFor(() => expect(intro()).toBeTruthy());
    app.navigate({ name: 'performance' });
    await waitFor(() => expect(screen.getByRole('dialog', { name: '내 성과' })).toBeTruthy());
    app.navigate({ name: 'settings' });
    await tick();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('waits while another dialog (a sheet) is open', async () => {
    const other = document.createElement('div');
    other.setAttribute('role', 'dialog');
    other.setAttribute('aria-modal', 'true');
    document.body.append(other);
    setup();
    await tick();
    await new Promise((r) => setTimeout(r, 0));
    expect(intro()).toBeNull();
    other.remove();
    await waitFor(() => expect(intro()).toBeTruthy());
  });

  it('waits while an import is pending, then shows after it is cleared and the dialog closes', async () => {
    stashImport(groupSnapshot({ id: 'shared', name: '반도체', items: [] }), Date.now());
    setup();
    await tick();
    await new Promise((r) => setTimeout(r, 0));
    expect(intro()).toBeNull();
    const other = document.createElement('div');
    other.setAttribute('role', 'dialog');
    document.body.append(other);
    await tick();
    clearImport();
    other.remove();
    await waitFor(() => expect(intro()).toBeTruthy());
  });

  it('shows when the pending import is cleared without a DOM change', async () => {
    stashImport(groupSnapshot({ id: 'shared', name: '반도체', items: [] }), Date.now());
    setup();
    await tick();
    await new Promise((r) => setTimeout(r, 0));
    expect(intro()).toBeNull();
    clearImport();
    await waitFor(() => expect(intro()).toBeTruthy());
  });
});
