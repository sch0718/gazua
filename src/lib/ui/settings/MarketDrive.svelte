<script lang="ts">
  // 시장 파일 Drive 전달(설계 2026-11-02-market-drive 8.3). 맥에서 올린 파일을 받기만 한다.
  import { untrack } from 'svelte';
  import { fetchFromDrive, wipeDrive, type DriveOutcome } from '../../marketData/driveSync';
  import { createDriveAuth, loadGis, type DriveAuth } from '../../marketData/gis';
  import type { MarketFileRow } from '../../marketData/manifest';
  import { OWNER_TEXT, type ImportDeps, type MarketDataInfo, type MarketDataStore } from '../../marketData/store';
  import type { SyncController } from '../../sync/controller.svelte';

  let {
    sync, marketData, localInfo, onImported, clientId,
    fetchImpl = (...a: Parameters<typeof fetch>) => fetch(...a),
    auth = createDriveAuth(clientId),
    importDeps, preload = () => loadGis(), confirmFn = (m: string) => confirm(m), digest,
  }: {
    sync: SyncController; marketData: MarketDataStore; localInfo: MarketDataInfo | null; onImported: (info: MarketDataInfo) => void; clientId: string;
    fetchImpl?: typeof fetch; auth?: DriveAuth; importDeps?: ImportDeps; preload?: () => Promise<void>; confirmFn?: (m: string) => boolean; digest?: (b: Blob) => Promise<string>;
  } = $props();

  type View = { kind: 'loading' } | { kind: 'outdated' } | { kind: 'error' } | { kind: 'files'; files: MarketFileRow[] };
  let view = $state<View>({ kind: 'loading' });
  let busy = $state(false);
  let progress = $state<number | null>(null);
  let note = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);
  let preloaded = false;

  const FAIL: Record<string, string> = {
    denied: 'Google에서 Drive 권한을 허용해야 받을 수 있어요',
    'not-ready': 'Google 로그인 준비 중이에요. 한 번 더 눌러 주세요',
    'not-found': 'Drive에서 파일을 찾지 못했어요. 맥에서 올린 Google 계정과 같은지 확인해 주세요',
    mismatch: '받은 파일이 손상됐어요. 다시 받아 주세요',
    auth: 'Google 로그인이 끝났어요. 다시 눌러 주세요',
    quota: 'Drive 요청 한도에 걸렸어요. 잠시 뒤 다시 시도해 주세요',
    offline: 'Drive에 연결할 수 없어요',
    'version-newer': '앱보다 새 형식의 파일이에요. 앱을 새로 고쳐 주세요',
    format: '시장 데이터 파일 형식이 아니에요',
    corrupt: '시장 데이터 파일 형식이 아니에요',
    server: 'Drive 목록을 비우지 못했어요',
    ...OWNER_TEXT,
  };
  const failText = (o: { reason: string; neededMb?: number }) =>
    o.reason === 'quota-device' ? `기기 공간이 부족해요(약 ${o.neededMb ?? '?'} MB 필요)` : (FAIL[o.reason] ?? 'Drive에서 받지 못했어요');

  async function load() {
    if (!sync.account) return;
    view = { kind: 'loading' };
    const r = await sync.marketFiles();
    view = r.ok ? { kind: 'files', files: r.files } : r.reason === 'outdated' ? { kind: 'outdated' } : { kind: 'error' };
  }
  $effect(() => {
    if (sync.account) untrack(() => void load());
  });
  $effect(() => {
    if (!preloaded && view.kind === 'files' && view.files.length > 0) {
      preloaded = true;
      preload().catch(() => {});
    }
  });

  const day = (iso: string) => iso.slice(0, 10);
  const mb = (n: number) => (n / 1048576).toFixed(1);
  const detail = (f: MarketFileRow) => `수집 ${day(f.collectedAt)} · ${f.stocks.toLocaleString('ko-KR')}종목 · ${mb(f.size)} MB`;
  function headline(latest: MarketFileRow): string {
    if (!localInfo) return `Drive에 시장 파일이 있어요 · ${detail(latest)}`;
    if (localInfo.sha256 === latest.sha256) return `Drive 최신 파일과 같아요 · 수집 ${day(latest.collectedAt)}`;
    if (Date.parse(localInfo.collectedAt) > Date.parse(latest.collectedAt)) return `이 기기 파일이 더 새것이에요 · ${detail(latest)}`;
    return `Drive에 새 파일이 있어요 · ${detail(latest)}`;
  }

  // 클릭 처리기에서 await 전에 fetchFromDrive를 불러야 팝업이 막히지 않는다
  function receive(row: MarketFileRow) {
    if (busy) return;
    busy = true;
    note = null;
    progress = null;
    // 계정 표시는 importFile 안에서 묻는다. 여기서 await하면 팝업이 막힌다
    fetchFromDrive(row, { fetch: fetchImpl, auth, store: marketData, importDeps: { ...importDeps, owner: () => sync.marketOwner() }, digest }, (done, total) => {
      progress = total ? Math.floor((done / total) * 100) : null;
    }).then(async (r: DriveOutcome) => {
      if (!r.ok && r.reason === 'not-ready') await preload().catch(() => {});
      busy = false;
      if (r.ok) {
        onImported(r.info);
        note = { kind: 'ok', text: 'Drive에서 받았어요' };
      } else if (r.reason !== 'cancelled') note = { kind: 'error', text: failText(r) };
    }).catch(() => {
      // importFile은 용량 초과가 아닌 쓰기 오류를 다시 던진다. 받는 중 상태에 멈추지 않게 푼다
      busy = false;
      note = { kind: 'error', text: 'Drive에서 받지 못했어요' };
    });
  }

  function wipe() {
    if (busy || view.kind !== 'files') return;
    if (!confirmFn('Drive의 시장 파일을 모두 지울까요? 이 기기의 시장 데이터는 남아요.')) return;
    busy = true;
    note = null;
    wipeDrive(view.files, { fetch: fetchImpl, auth, store: marketData, wipeManifest: () => sync.wipeMarketFiles() }).then(async (r) => {
      if (!r.ok && r.reason === 'not-ready') await preload().catch(() => {});
      busy = false;
      if (r.ok) note = { kind: 'ok', text: 'Drive 보관본을 지웠어요' };
      else if (r.reason !== 'cancelled') note = { kind: 'error', text: failText(r) };
      await load();
    }).catch(() => {
      busy = false;
      note = { kind: 'error', text: 'Drive 목록을 비우지 못했어요' };
    });
  }
</script>

<div class="row col" role="group" aria-label="Drive 전달">
  <div class="text">
    <b>Drive 전달</b>
    {#if !sync.account}
      <p>동기화에 로그인하면 맥에서 올린 시장 파일을 받을 수 있어요</p>
    {:else if view.kind === 'loading'}
      <p>Drive 목록을 확인하는 중…</p>
    {:else if view.kind === 'outdated'}
      <p>서버 업데이트가 필요해요</p>
    {:else if view.kind === 'error'}
      <p>Drive 목록을 확인하지 못했어요</p>
    {:else if view.files.length === 0}
      <p>Drive에 올린 시장 파일이 없어요. 맥에서 pnpm collect -- --drive로 올려요</p>
    {:else}
      <p class="num">{busy && progress !== null ? `받는 중… ${progress}%` : busy ? '받는 중…' : headline(view.files[0])}</p>
    {/if}
  </div>
  {#if sync.account && view.kind === 'error'}
    <button type="button" class="btn" onclick={load}>다시 확인</button>
  {/if}
  {#if sync.account && view.kind === 'files' && view.files.length > 0}
    <div class="line">
      {#if localInfo?.sha256 !== view.files[0].sha256}
        <button type="button" class="btn primary" disabled={busy} onclick={() => view.kind === 'files' && receive(view.files[0])}>Drive에서 받기</button>
      {/if}
      <button type="button" class="btn" disabled={busy} onclick={wipe}>Drive 보관본 지우기</button>
    </div>
    {#if view.files[1]}
      {@const prev = view.files[1]}
      <details>
        <summary>이전 파일</summary>
        <p class="num">수집 {day(prev.collectedAt)} · {prev.stocks.toLocaleString('ko-KR')}종목</p>
        <button type="button" class="btn" disabled={busy} onclick={() => receive(prev)}>이전 파일 받기</button>
      </details>
    {/if}
  {/if}
  {#if note}
    <p class={note.kind === 'error' ? 'warn' : 'done'} role={note.kind === 'error' ? 'alert' : 'status'}>{note.text}</p>
  {/if}
</div>

<style>
  .row {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 0;
    border-bottom: 1px solid var(--line);
  }
  .text b { font-size: var(--fs-body); }
  .text p,
  details p {
    font-size: var(--fs-sub);
    color: var(--t2);
    margin-top: 2px;
  }
  summary { font-size: var(--fs-sub); color: var(--t2); min-height: var(--touch); display: flex; align-items: center; }
  .line { display: flex; gap: 8px; }
  .btn {
    flex: none;
    min-height: var(--touch);
    padding: 0 14px;
    border-radius: 12px;
    background: var(--surface2);
    color: var(--t1);
    font-weight: 700;
  }
  .btn.primary { background: var(--accent); color: var(--on-accent, #fff); }
  .btn:disabled { opacity: 0.5; }
  .warn { font-size: var(--fs-sub); color: var(--warn); }
  .done { font-size: var(--fs-sub); color: var(--t1); }
</style>
