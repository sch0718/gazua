// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
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

  it('shows an extra sentence only when the import repaired values', async () => {
    const { app } = await setup();
    const input = screen.getByLabelText('가져올 파일') as HTMLInputElement;
    const repaired = JSON.parse(app.exportData(false));
    repaired.settings.theme = '없는 테마';
    await fireEvent.change(input, { target: { files: [new File([JSON.stringify(repaired)], 'r.json', { type: 'application/json' })] } });
    expect(await screen.findByText(/일부 값이 맞지 않아 기본값으로 바꿨어요/)).toBeTruthy();
    expect(screen.getByText(/'내 프로필 \(가져옴\)' 프로필을 만들었어요/)).toBeTruthy();

    dismissSnackbar();
    await fireEvent.change(input, { target: { files: [new File([app.exportData(false)], 'c.json', { type: 'application/json' })] } });
    expect(await screen.findByText(/프로필을 만들었어요/)).toBeTruthy();
    expect(screen.queryByText(/일부 값이 맞지 않아/)).toBeNull();
  });

  it('keeps the repaired snackbar for 8 seconds, longer than the 5 second default', async () => {
    const { app } = await setup();
    const repaired = JSON.parse(app.exportData(false));
    repaired.settings.theme = '없는 테마';
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await fireEvent.change(screen.getByLabelText('가져올 파일'), {
        target: { files: [new File([JSON.stringify(repaired)], 'r.json', { type: 'application/json' })] },
      });
      await waitFor(() => expect(screen.queryByText(/일부 값이 맞지 않아/)).toBeTruthy());
      vi.advanceTimersByTime(7900);
      await tick();
      expect(screen.queryByText(/일부 값이 맞지 않아/)).toBeTruthy();
      vi.advanceTimersByTime(200);
      await tick();
      await waitFor(() => expect(screen.queryByText(/일부 값이 맞지 않아/)).toBeNull());
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses files over 1 MB without reading them', async () => {
    const { app } = await setup();
    const big = new File(['x'], 'big.json', { type: 'application/json' });
    Object.defineProperty(big, 'size', { value: 1024 * 1024 + 1 });
    const text = vi.spyOn(big, 'text');
    await fireEvent.change(screen.getByLabelText('가져올 파일'), { target: { files: [big] } });
    expect(await screen.findByText('파일이 너무 커요')).toBeTruthy();
    expect(text).not.toHaveBeenCalled();
    expect(app.meta.profiles).toHaveLength(1);
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
