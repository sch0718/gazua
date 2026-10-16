// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { IDBFactory } from 'fake-indexeddb';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeTestApp } from '../../../sheets/testApp';
import type { App } from '../../state/app.svelte';
import { kstEpoch } from '../../time/kst';
import SnackbarHost from '../components/SnackbarHost.svelte';
import { dismissSnackbar } from '../components/snackbarStore.svelte';
import { openMarketData, type ImportDeps } from '../../marketData/store';
import DataTools from './DataTools.svelte';

const NOW = kstEpoch('2026-10-12', '10:00:00');
const SECRETS = { kis: { appKey: 'kis-key-0000-1234', appSecret: 'kis-secret-5678' } };

let apps: App[] = [];
async function setup(confirmFn = vi.fn(() => true)) {
  const app = makeTestApp({ groups: [{ id: 'g1', name: '반도체', items: [] }], now: NOW, settings: { provider: 'kis' } });
  apps.push(app);
  await app.setSecrets(SECRETS);
  const download = vi.fn();
  const estimate = vi.fn(async () => 1572864);
  render(SnackbarHost);
  render(DataTools, { app, download, estimate, now: () => NOW, confirmFn });
  return { app, download, estimate, confirmFn };
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

  it('asks before exporting with keys: declining downloads nothing, accepting downloads with keys', async () => {
    const confirmFn = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    const { download } = await setup(confirmFn);
    await fireEvent.click(screen.getByRole('checkbox', { name: '키 포함' }));
    await fireEvent.click(screen.getByRole('button', { name: '내보내기' }));
    expect(confirmFn).toHaveBeenCalledWith(
      '키가 들어 있는 파일을 내보낼까요? 이 파일을 가진 사람은 누구나 이 키로 증권사 API를 쓸 수 있어요.',
    );
    expect(download).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: '내보내기' }));
    expect(confirmFn).toHaveBeenCalledTimes(2);
    expect(download.mock.calls[0][1]).toContain(SECRETS.kis.appKey);
  });

  it('does not ask when exporting without keys', async () => {
    const { download, confirmFn } = await setup();
    await fireEvent.click(screen.getByRole('button', { name: '내보내기' }));
    expect(confirmFn).not.toHaveBeenCalled();
    expect(download).toHaveBeenCalledTimes(1);
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

  describe('시장 데이터', () => {
    const gz = readFileSync('tests/fixtures/market-data-demo.json.gz');
    const decompress = async (b: Blob) => gunzipSync(Buffer.from(await b.arrayBuffer())).toString('utf8');
    const roomy = async () => ({ quota: 10 ** 12, usage: 0 });
    let marketData = openMarketData();

    async function mount(marketImportDeps: ImportDeps = { decompress, estimate: roomy }) {
      globalThis.indexedDB = new IDBFactory();
      marketData = openMarketData();
      const app = makeTestApp({ groups: [], now: NOW, settings: { provider: 'kis' } });
      apps.push(app);
      render(SnackbarHost);
      render(DataTools, { app, estimate: async () => 0, marketData, marketImportDeps });
      return app;
    }
    const pick = (f: File) => fireEvent.change(screen.getByLabelText('시장 데이터 파일'), { target: { files: [f] } });
    const demo = () => new File([gz], 'market-data-20261016.json.gz');

    it('imports a file and shows the summary line; 지우기 removes it', async () => {
      await mount();
      expect(screen.queryByRole('button', { name: '지우기' })).toBeNull();
      await pick(demo());
      expect(await screen.findByText('수집 2026-10-16 · 30종목 · 2024-10-16 ~ 2026-10-15 · 환율·유가·테마 포함')).toBeTruthy();
      await fireEvent.click(screen.getByRole('button', { name: '지우기' }));
      await waitFor(() => expect(screen.queryByText(/^수집 /)).toBeNull());
      expect(await marketData.info()).toBeNull();
    });

    it('a v1 file gets the re-collect hint instead', async () => {
      const j = JSON.parse(await decompress(new Blob([gz])));
      j.version = 1;
      delete j.macro;
      delete j.themes;
      await mount({ decompress: async () => JSON.stringify(j), estimate: roomy });
      await pick(demo());
      expect(
        await screen.findByText('수집 2026-10-16 · 30종목 · 2024-10-16 ~ 2026-10-15 · 다시 수집하면 환율·유가·테마도 쓸 수 있어요'),
      ).toBeTruthy();
    });

    const base = '수집 2026-10-16 · 30종목 · 2024-10-16 ~ 2026-10-15';
    async function importVariant(edit: (j: any) => void) {
      const j = JSON.parse(await decompress(new Blob([gz])));
      edit(j);
      await mount({ decompress: async () => JSON.stringify(j), estimate: roomy });
      await pick(demo());
    }
    const emptyMacro = (j: any) => (j.macro = { usdkrw: { d: [], v: [] }, wti: { d: [], v: [] } });

    it('v2 with empty macro names only themes', async () => {
      await importVariant(emptyMacro);
      expect(await screen.findByText(`${base} · 테마 포함 · 환율·유가는 다시 수집하면 쓸 수 있어요`)).toBeTruthy();
    });

    it('v2 with empty themes names only macro', async () => {
      await importVariant((j) => (j.themes = []));
      expect(await screen.findByText(`${base} · 환율·유가 포함 · 테마는 다시 수집하면 쓸 수 있어요`)).toBeTruthy();
    });

    it('v2 with both empty gets the re-collect hint', async () => {
      await importVariant((j) => {
        emptyMacro(j);
        j.themes = [];
      });
      expect(await screen.findByText(`${base} · 다시 수집하면 환율·유가·테마도 쓸 수 있어요`)).toBeTruthy();
    });

    it('shows the corrupt-file message and keeps what was there', async () => {
      await mount();
      await pick(demo());
      await screen.findByText(/^수집 /);
      await pick(new File(['x'], 'bad.json.gz'));
      // 두 번째 파일은 기본 decompress 대신 주입된 것으로 풀리므로 gzip이 아니어서 실패한다
      expect(await screen.findByText('파일을 읽을 수 없어요. 수집을 다시 해 주세요')).toBeTruthy();
      expect(screen.getByText(/^수집 2026-10-16/)).toBeTruthy();
    });

    it('shows the newer-version message', async () => {
      const j = JSON.parse(await decompress(new Blob([gz])));
      await mount({ decompress: async () => JSON.stringify({ ...j, version: 4 }), estimate: roomy });
      await pick(demo());
      expect(await screen.findByText('새 형식의 파일이에요. 앱을 새로 고친 뒤 다시 가져와 주세요')).toBeTruthy();
    });

    it('shows the needed MB when space is short', async () => {
      await mount({ decompress, estimate: async () => ({ quota: 100, usage: 0 }) });
      await pick(demo());
      expect(await screen.findByText(/^저장 공간이 부족해요\(필요 약 \d+ MB\)$/)).toBeTruthy();
    });

    it('warns when the browser refuses persistence', async () => {
      Object.defineProperty(navigator, 'storage', { value: { persist: async () => false }, configurable: true });
      await mount();
      await pick(demo());
      expect(await screen.findByText('브라우저가 공간이 부족할 때 지울 수 있어요')).toBeTruthy();
    });
  });
});
