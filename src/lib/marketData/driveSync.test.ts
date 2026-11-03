import { describe, expect, it, vi } from 'vitest';
import type { MarketFileRow } from './manifest';
import { fetchFromDrive, wipeDrive, type DriveDeps } from './driveSync';

const row = (o: Partial<MarketFileRow> = {}): MarketFileRow => ({
  id: 'r1', driveFileId: 'FILEID12345', name: 'market-data-20261031.json.gz', sha256: 'c'.repeat(64), size: 3, version: 4,
  collectedAt: '2026-10-31T18:00:00+09:00', range: { from: '2021-10-31', to: '2026-10-31' }, stocks: 1, createdAt: 1, updatedAt: 1, ...o,
});
function deps(o: Partial<DriveDeps> = {}) {
  const importFile = vi.fn(async () => ({ ok: true as const, info: { collectedAt: 'x', stocks: 1, range: { from: 'a', to: 'b' }, sha256: 'c'.repeat(64) } }));
  const d: DriveDeps = {
    fetch: (async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })) as typeof fetch,
    auth: { token: async () => ({ ok: true, token: 't' }), forget: vi.fn() },
    store: { importFile } as unknown as DriveDeps['store'],
    digest: async () => 'c'.repeat(64),
    ...o,
  };
  return { d, importFile };
}

describe('fetchFromDrive', () => {
  it('크기·해시가 맞으면 importFile로 교체한다', async () => {
    const { d, importFile } = deps();
    expect(await fetchFromDrive(row(), d)).toMatchObject({ ok: true });
    expect(importFile).toHaveBeenCalledTimes(1);
    // 확인한 해시를 넘겨 importFile이 수백 MB를 다시 해시하지 않게 한다
    expect(importFile).toHaveBeenCalledWith(expect.any(Blob), expect.objectContaining({ sha256: 'c'.repeat(64) }));
  });
  it('크기나 해시가 다르면 mismatch이고 저장하지 않는다', async () => {
    const a = deps();
    expect(await fetchFromDrive(row({ size: 4 }), a.d)).toEqual({ ok: false, reason: 'mismatch' });
    const b = deps({ digest: async () => 'd'.repeat(64) });
    expect(await fetchFromDrive(row(), b.d)).toEqual({ ok: false, reason: 'mismatch' });
    expect(a.importFile).not.toHaveBeenCalled();
    expect(b.importFile).not.toHaveBeenCalled();
  });
  it('토큰 실패는 그대로, Drive 401은 토큰을 잊고 auth', async () => {
    const c = deps({ auth: { token: async () => ({ ok: false, reason: 'cancelled' }), forget: vi.fn() } });
    expect(await fetchFromDrive(row(), c.d)).toEqual({ ok: false, reason: 'cancelled' });
    const forget = vi.fn();
    const u = deps({ fetch: (async () => new Response(null, { status: 401 })) as typeof fetch, auth: { token: async () => ({ ok: true, token: 't' }), forget } });
    expect(await fetchFromDrive(row(), u.d)).toEqual({ ok: false, reason: 'auth' });
    expect(forget).toHaveBeenCalled();
  });
  it('importFile의 계정 거절 이유는 그대로 돌려준다', async () => {
    for (const reason of ['owner-mismatch', 'owner-signed-out'] as const) {
      const { d } = deps({ store: { importFile: async () => ({ ok: false, reason }) } as unknown as DriveDeps['store'] });
      expect(await fetchFromDrive(row(), d)).toEqual({ ok: false, reason });
    }
  });
  it('importFile의 기기 공간 부족은 quota-device로 바꾼다', async () => {
    const { d } = deps({ store: { importFile: async () => ({ ok: false, reason: 'quota', neededMb: 90 }) } as unknown as DriveDeps['store'] });
    expect(await fetchFromDrive(row(), d)).toEqual({ ok: false, reason: 'quota-device', neededMb: 90 });
  });
});

describe('wipeDrive', () => {
  it('manifest의 파일과 표식 파일을 모두 지우고 manifest를 비운다', async () => {
    const deleted: string[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return (deleted.push(new URL(url).pathname.split('/').pop()!), new Response(null, { status: 204 }));
      return new Response(JSON.stringify({ files: [{ id: 'ORPHAN12345' }, { id: 'FILEID12345' }] }), { status: 200 });
    }) as typeof fetch;
    const wipeManifest = vi.fn(async () => true);
    const { d } = deps({ fetch: f });
    expect(await wipeDrive([row()], { ...d, wipeManifest })).toEqual({ ok: true });
    expect(deleted.sort()).toEqual(['FILEID12345', 'ORPHAN12345']);
    expect(wipeManifest).toHaveBeenCalled();
  });
  it('Drive 삭제가 실패하면 manifest를 비우지 않는다', async () => {
    const f = (async (_u: string, init?: RequestInit) => (init?.method === 'DELETE' ? new Response(null, { status: 500 }) : new Response(JSON.stringify({ files: [] }), { status: 200 }))) as typeof fetch;
    const wipeManifest = vi.fn(async () => true);
    const { d } = deps({ fetch: f });
    expect(await wipeDrive([row()], { ...d, wipeManifest })).toEqual({ ok: false, reason: 'failed' });
    expect(wipeManifest).not.toHaveBeenCalled();
  });
});
