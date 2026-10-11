// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeTestApp } from '../../../sheets/testApp';
import type { App } from '../../state/app.svelte';
import { kstEpoch } from '../../time/kst';
import SnackbarHost from '../components/SnackbarHost.svelte';
import { dismissSnackbar } from '../components/snackbarStore.svelte';
import DataTools from './DataTools.svelte';

const NOW = kstEpoch('2026-10-12', '10:00:00');
const SECRETS = { kis: { appKey: 'kis-key-0000-1234', appSecret: 'kis-secret-5678' } };

let apps: App[] = [];
async function setup() {
  const app = makeTestApp({ groups: [{ id: 'g1', name: '반도체', items: [] }], now: NOW, settings: { provider: 'kis' } });
  apps.push(app);
  await app.setSecrets(SECRETS);
  const download = vi.fn();
  const estimate = vi.fn(async () => 1572864);
  render(SnackbarHost);
  render(DataTools, { app, download, estimate, now: () => NOW });
  return { app, download, estimate };
}

afterEach(() => {
  for (const a of apps) a.destroy();
  apps = [];
  dismissSnackbar();
});

describe('DataTools', () => {
  it('exports without keys by default; 키 포함 shows a warning and includes them', async () => {
    const { download } = await setup();
    await fireEvent.click(screen.getByRole('button', { name: '내보내기' }));
    const [name, text] = download.mock.calls[0];
    expect(name).toBe('gazua-내 프로필-2026-10-12.json');
    expect(text).not.toContain(SECRETS.kis.appKey);
    expect(JSON.parse(text).watchlists.groups[0].name).toBe('반도체');

    expect(screen.queryByText('키가 포함된 파일은 안전하게 보관하세요')).toBeNull();
    await fireEvent.click(screen.getByRole('checkbox', { name: '키 포함' }));
    expect(screen.getByText('키가 포함된 파일은 안전하게 보관하세요')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: '내보내기' }));
    expect(download.mock.calls[1][1]).toContain(SECRETS.kis.appKey);
  });

  it('imports a file into a new profile, and shows the reason for a broken file', async () => {
    const { app } = await setup();
    const input = screen.getByLabelText('가져올 파일') as HTMLInputElement;
    await fireEvent.change(input, { target: { files: [new File(['{oops'], 'x.json', { type: 'application/json' })] } });
    expect(await screen.findByText('파일 형식이 맞지 않아요')).toBeTruthy();

    const good = app.exportData(false);
    await fireEvent.change(input, { target: { files: [new File([good], 'y.json', { type: 'application/json' })] } });
    await waitFor(() => expect(app.meta.profiles.map((p) => p.name)).toContain('내 프로필 (가져옴)'));
    expect(await screen.findByText("'내 프로필 (가져옴)' 프로필을 만들었어요")).toBeTruthy();
  });

  it('shows cache usage in MB and clears the cache', async () => {
    const { app, estimate } = await setup();
    expect(await screen.findByText('1.5 MB')).toBeTruthy();
    const clear = vi.spyOn(app.data.cache, 'clear');
    estimate.mockResolvedValue(0);
    await fireEvent.click(screen.getByRole('button', { name: '캐시 비우기' }));
    await waitFor(() => expect(clear).toHaveBeenCalled());
    expect(await screen.findByText('0.0 MB')).toBeTruthy();
  });
});
