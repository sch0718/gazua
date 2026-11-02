// Drive에서 받은 파일을 manifest(크기·SHA-256)와 맞춰 본 뒤 기존 importFile로 교체한다(설계 D7).
import { deleteFile, downloadFile, listMarketFileIds } from './driveClient';
import type { DriveAuth } from './gis';
import type { MarketFileRow } from './manifest';
import { sha256Hex, type ImportDeps, type MarketDataInfo, type MarketDataStore } from './store';

export interface DriveDeps {
  fetch: typeof fetch;
  auth: DriveAuth;
  store: MarketDataStore;
  importDeps?: ImportDeps;
  digest?: (b: Blob) => Promise<string>;
}
export type DriveOutcome =
  | { ok: true; info: MarketDataInfo; persisted?: boolean }
  | { ok: false; reason: 'cancelled' | 'denied' | 'not-ready' | 'auth' | 'not-found' | 'quota' | 'offline' | 'failed' | 'mismatch' | 'format' | 'version-newer' | 'corrupt' | 'quota-device'; neededMb?: number };

/** 클릭 처리기에서 곧바로 부른다. 첫 await가 auth.token()이라 팝업이 막히지 않는다 */
export async function fetchFromDrive(row: MarketFileRow, deps: DriveDeps, onProgress?: (done: number, total: number | null) => void): Promise<DriveOutcome> {
  const t = await deps.auth.token();
  if (!t.ok) return { ok: false, reason: t.reason };
  const dl = await downloadFile(deps.fetch, t.token, row.driveFileId, onProgress);
  if (!dl.ok) {
    if (dl.kind === 'auth') deps.auth.forget();
    return { ok: false, reason: dl.kind };
  }
  if (dl.blob.size !== row.size || (await (deps.digest ?? sha256Hex)(dl.blob)) !== row.sha256) return { ok: false, reason: 'mismatch' };
  const r = await deps.store.importFile(dl.blob, deps.importDeps);
  if (r.ok) return r;
  return r.reason === 'quota' ? { ok: false, reason: 'quota-device', neededMb: r.neededMb } : { ok: false, reason: r.reason };
}

/** Drive의 manifest 파일과 표식 파일을 모두 지운 뒤에만 manifest를 비운다 */
export async function wipeDrive(files: MarketFileRow[], deps: DriveDeps & { wipeManifest: () => Promise<boolean> }): Promise<{ ok: true } | { ok: false; reason: string }> {
  const t = await deps.auth.token();
  if (!t.ok) return { ok: false, reason: t.reason };
  const listed = await listMarketFileIds(deps.fetch, t.token);
  if (!listed.ok) {
    if (listed.kind === 'auth') deps.auth.forget();
    return { ok: false, reason: listed.kind };
  }
  for (const id of new Set([...files.map((f) => f.driveFileId), ...listed.ids])) {
    const r = await deleteFile(deps.fetch, t.token, id);
    if (!r.ok) {
      if (r.kind === 'auth') deps.auth.forget();
      return { ok: false, reason: r.kind };
    }
  }
  return (await deps.wipeManifest()) ? { ok: true } : { ok: false, reason: 'server' };
}
