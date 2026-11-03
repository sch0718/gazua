// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../share/testAxe';
import type { MarketFileRow } from '../../marketData/manifest';
import type { MarketDataInfo, MarketDataStore } from '../../marketData/store';
import type { SyncController, MarketFilesResult } from '../../sync/controller.svelte';
import MarketDrive from './MarketDrive.svelte';

afterEach(cleanup);
const row = (n: number, o: Partial<MarketFileRow> = {}): MarketFileRow => ({
  id: `r${n}`, driveFileId: `FILEID1234${n}`, name: `market-data-2026103${n}.json.gz`, sha256: String(n).repeat(64), size: 3 * 1048576, version: 4,
  collectedAt: `2026-10-3${n}T18:00:00+09:00`, range: { from: '2021-10-31', to: `2026-10-3${n}` }, stocks: 2600, createdAt: 1, updatedAt: 1, ...o,
});
const local = (o: Partial<MarketDataInfo> = {}): MarketDataInfo => ({ collectedAt: '2026-10-30T18:00:00+09:00', stocks: 2600, range: { from: '2021-10-30', to: '2026-10-30' }, ...o });

function setup(o: { importResult?: unknown; files?: MarketFilesResult; account?: unknown; info?: MarketDataInfo | null; token?: any; fetchImpl?: typeof fetch; confirm?: boolean; digest?: (b: Blob) => Promise<string>; preload?: () => Promise<void> } = {}) {
  const marketFiles = vi.fn(async () => o.files ?? { ok: true as const, files: [row(1), row(0)] });
  const wipeMarketFiles = vi.fn(async () => true);
  const marketOwner = vi.fn(async () => 'a'.repeat(32));
  const sync = { account: o.account === undefined ? { provider: 'google', id: 'me', display: 'me' } : o.account, marketFiles, wipeMarketFiles, marketOwner } as unknown as SyncController;
  const importFile = vi.fn(async (..._a: unknown[]) => o.importResult ?? ({ ok: true as const, info: local({ sha256: row(1).sha256, collectedAt: row(1).collectedAt }) }));
  const onImported = vi.fn();
  const forget = vi.fn();
  const auth = { token: vi.fn(async () => o.token ?? { ok: true, token: 't' }), forget };
  const preload = vi.fn(o.preload ?? (async () => {}));
  const fetchImpl = o.fetchImpl ?? ((async () => new Response(new Uint8Array(3 * 1048576), { status: 200 })) as typeof fetch);
  render(MarketDrive, {
    sync, marketData: { importFile } as unknown as MarketDataStore, localInfo: o.info === undefined ? local() : o.info, onImported, clientId: 'cid',
    fetchImpl, auth, preload, confirmFn: () => o.confirm ?? true, digest: o.digest ?? (async () => row(1).sha256),
  });
  return { marketFiles, wipeMarketFiles, importFile, onImported, auth, preload, marketOwner };
}

describe('MarketDrive', () => {
  it('로그인 전에는 안내만 보이고 목록을 읽지 않는다', async () => {
    const { marketFiles } = setup({ account: null });
    expect(await screen.findByText('동기화에 로그인하면 맥에서 올린 시장 파일을 받을 수 있어요')).toBeTruthy();
    expect(marketFiles).not.toHaveBeenCalled();
  });
  it('새 파일이 있으면 받기 버튼과 크기·종목 수를 보이고 GIS를 미리 부른다', async () => {
    const { preload } = setup();
    expect(await screen.findByText('Drive에 새 파일이 있어요 · 수집 2026-10-31 · 2,600종목 · 3.0 MB')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Drive에서 받기' })).toBeTruthy();
    await waitFor(() => expect(preload).toHaveBeenCalledTimes(1));
    await expectNoAxeViolations(document.body);
  });
  it.each(['Drive에서 받기', 'Drive 보관본 지우기'])('%s: GIS 미리 불러오기 실패 뒤 클릭으로 불러오고 다음 클릭에서 진행한다', async (buttonName) => {
    let finishLoading!: () => void;
    const retry = new Promise<void>((resolve) => { finishLoading = resolve; });
    const preload = vi.fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('gis-load'))
      .mockReturnValueOnce(retry);
    const fetchImpl = (async (_u: string, init?: RequestInit) => init?.method === 'DELETE'
      ? new Response(null, { status: 204 })
      : new Response(new Uint8Array(3 * 1048576), { status: 200 })) as typeof fetch;
    const { auth, importFile, wipeMarketFiles } = setup({ preload, fetchImpl });
    await waitFor(() => expect(preload).toHaveBeenCalledTimes(1));
    auth.token.mockResolvedValueOnce({ ok: false, reason: 'not-ready' });
    const button = await screen.findByRole('button', { name: buttonName });
    await fireEvent.click(button);
    await waitFor(() => expect(preload).toHaveBeenCalledTimes(2));
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(auth.token).toHaveBeenCalledTimes(1);
    expect(importFile).not.toHaveBeenCalled();
    expect(wipeMarketFiles).not.toHaveBeenCalled();
    finishLoading();
    expect((await screen.findByRole('alert')).textContent).toBe('Google 로그인 준비 중이에요. 한 번 더 눌러 주세요');
    const retryButton = await screen.findByRole('button', { name: buttonName });
    expect((retryButton as HTMLButtonElement).disabled).toBe(false);
    expect(auth.token).toHaveBeenCalledTimes(1);
    await fireEvent.click(retryButton);
    await waitFor(() => expect(buttonName === 'Drive에서 받기' ? importFile : wipeMarketFiles).toHaveBeenCalledTimes(1));
    expect(auth.token).toHaveBeenCalledTimes(2);
    expect(preload).toHaveBeenCalledTimes(2);
  });
  it('같은 sha256이면 같다고 보이고 받기 버튼이 없다', async () => {
    setup({ info: local({ sha256: row(1).sha256 }) });
    expect(await screen.findByText('Drive 최신 파일과 같아요 · 수집 2026-10-31')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Drive에서 받기' })).toBeNull();
  });
  it('이 기기에 파일이 없을 때·이 기기가 더 새것일 때 문구', async () => {
    setup({ info: null });
    expect(await screen.findByText('Drive에 시장 파일이 있어요 · 수집 2026-10-31 · 2,600종목 · 3.0 MB')).toBeTruthy();
    cleanup();
    setup({ info: local({ collectedAt: '2026-11-01T18:00:00+09:00', sha256: 'x' }) });
    expect(await screen.findByText('이 기기 파일이 더 새것이에요 · 수집 2026-10-31 · 2,600종목 · 3.0 MB')).toBeTruthy();
  });
  it('비어 있음·옛 서버·오류 문구', async () => {
    setup({ files: { ok: true, files: [] } });
    expect(await screen.findByText('Drive에 올린 시장 파일이 없어요. 맥에서 pnpm collect -- --drive로 올려요')).toBeTruthy();
    cleanup();
    setup({ files: { ok: false, reason: 'outdated' } });
    expect(await screen.findByText('서버 업데이트가 필요해요')).toBeTruthy();
    cleanup();
    setup({ files: { ok: false, reason: 'error' } });
    expect(await screen.findByRole('button', { name: '다시 확인' })).toBeTruthy();
  });
  it('받기를 누르면 토큰을 받고 교체한 뒤 알린다', async () => {
    const { importFile, onImported, auth } = setup();
    await fireEvent.click(await screen.findByRole('button', { name: 'Drive에서 받기' }));
    await waitFor(() => expect(onImported).toHaveBeenCalled());
    expect(auth.token).toHaveBeenCalledTimes(1);
    expect(importFile).toHaveBeenCalledTimes(1);
    expect((await screen.findByRole('status')).textContent).toBe('Drive에서 받았어요');
  });
  it('받을 때 지금 계정의 표시를 importFile에 넘긴다', async () => {
    const { importFile, onImported, marketOwner } = setup();
    await fireEvent.click(await screen.findByRole('button', { name: 'Drive에서 받기' }));
    await waitFor(() => expect(onImported).toHaveBeenCalled());
    const deps = importFile.mock.calls[0][1] as { owner: () => Promise<string | null> };
    expect(await deps.owner()).toBe('a'.repeat(32));
    expect(marketOwner).toHaveBeenCalled();
  });
  it.each([
    ['owner-mismatch', '다른 계정에서 수집한 파일이에요. 수집한 계정으로 로그인한 앱에서만 가져올 수 있어요'],
    ['owner-signed-out', '수집한 계정으로 로그인한 뒤 가져와 주세요'],
  ])('%s면 이유를 알린다', async (reason, text) => {
    setup({ importResult: { ok: false, reason } });
    await fireEvent.click(await screen.findByRole('button', { name: 'Drive에서 받기' }));
    expect((await screen.findByRole('alert')).textContent).toBe(text);
  });
  it('404면 계정 확인 안내', async () => {
    setup({ fetchImpl: (async () => new Response(null, { status: 404 })) as typeof fetch });
    await fireEvent.click(await screen.findByRole('button', { name: 'Drive에서 받기' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Drive에서 파일을 찾지 못했어요. 맥에서 올린 Google 계정과 같은지 확인해 주세요');
  });
  it('이전 파일 받기는 두 번째 행을 받는다', async () => {
    const { importFile } = setup({ info: local({ sha256: row(1).sha256 }), digest: async () => row(0).sha256 });
    await fireEvent.click(await screen.findByRole('button', { name: '이전 파일 받기' }));
    await waitFor(() => expect(importFile).toHaveBeenCalled());
  });
  it('지우기는 확인 뒤 Drive와 manifest를 비우고 목록을 다시 읽는다', async () => {
    const fetchImpl = (async (_u: string, init?: RequestInit) => (init?.method === 'DELETE' ? new Response(null, { status: 204 }) : new Response(JSON.stringify({ files: [] }), { status: 200 }))) as typeof fetch;
    const { wipeMarketFiles, marketFiles } = setup({ fetchImpl });
    await fireEvent.click(await screen.findByRole('button', { name: 'Drive 보관본 지우기' }));
    await waitFor(() => expect(wipeMarketFiles).toHaveBeenCalled());
    expect((await screen.findByRole('status')).textContent).toBe('Drive 보관본을 지웠어요');
    expect(marketFiles).toHaveBeenCalledTimes(2);
  });
});
