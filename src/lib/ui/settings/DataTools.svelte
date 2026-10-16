<script lang="ts">
  // 데이터(스펙 7.4): 관심종목 JSON 내보내기·가져오기(키 제외가 기본), 캐시 사용량·비우기.
  import { onMount } from 'svelte';
  import type { App } from '../../state/app.svelte';
  import { exportFileName } from '../../state/exportImport';
  import { showSnackbar } from '../components/snackbarStore.svelte';
  import { fmtMB } from '../format';
  import { openMarketData, type ImportDeps, type MarketDataInfo, type MarketDataStore } from '../../marketData/store';

  let {
    app,
    download = saveFile,
    estimate,
    now = () => Date.now(),
    confirmFn = (m: string) => window.confirm(m),
    marketData = openMarketData(),
    marketImportDeps,
  }: {
    app: App;
    download?: (filename: string, text: string) => void;
    /** 기본값: navigator.storage.estimate()의 usage, 없으면 봉 캐시 추정치. */
    estimate?: () => Promise<number>;
    now?: () => number;
    confirmFn?: (message: string) => boolean;
    marketData?: MarketDataStore;
    /** 시장 데이터 가져오기의 풀기·공간 확인 주입(테스트용). 기본은 브라우저 구현. */
    marketImportDeps?: ImportDeps;
  } = $props();

  const uid = Math.random().toString(36).slice(2, 8);
  /** 내보낸 파일은 수십 KB다. 그보다 훨씬 큰 파일은 읽지 않는다. */
  const MAX_IMPORT_BYTES = 1024 * 1024;
  let includeSecrets = $state(false);
  let usage = $state<number | null>(null);
  let clearing = $state(false);
  let fileInput = $state<HTMLInputElement>();

  function saveFile(filename: string, text: string) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function storageUsage(): Promise<number> {
    if (estimate) return estimate();
    const est = await navigator.storage?.estimate?.();
    if (est && typeof est.usage === 'number') return est.usage;
    return app.data.cache.estimateBytes();
  }

  async function refreshUsage() {
    try {
      usage = await storageUsage();
    } catch {
      usage = null;
    }
  }
  onMount(refreshUsage);

  // 시장 데이터(스펙 4): 기기 단위. 프로필·내보내기와 무관하다.
  let marketInfo = $state<MarketDataInfo | null>(null);
  let marketBusy = $state(false);
  let marketInput = $state<HTMLInputElement>();
  onMount(() => {
    marketData
      .info()
      .then((i) => (marketInfo = i))
      .catch(() => {});
  });

  const marketLine = (i: MarketDataInfo) =>
    `수집 ${i.collectedAt.slice(0, 10)} · ${i.stocks.toLocaleString('ko-KR')}종목 · ${i.range.from} ~ ${i.range.to}` +
    (i.version === 2 ? ' · 환율·유가·테마 포함' : ' · 다시 수집하면 환율·유가·테마도 쓸 수 있어요');

  async function onMarketFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || marketBusy) return;
    marketBusy = true;
    try {
      const res = await marketData.importFile(file, marketImportDeps);
      if (res.ok) {
        marketInfo = res.info;
        showSnackbar(res.persisted === false ? '브라우저가 공간이 부족할 때 지울 수 있어요' : '시장 데이터를 가져왔어요');
      } else if (res.reason === 'version-newer') {
        showSnackbar('새 형식의 파일이에요. 앱을 새로 고친 뒤 다시 가져와 주세요');
      } else if (res.reason === 'quota') {
        showSnackbar(`저장 공간이 부족해요(필요 약 ${res.neededMb ?? '?'} MB)`);
      } else {
        showSnackbar('파일을 읽을 수 없어요. 수집을 다시 해 주세요');
      }
    } catch {
      showSnackbar('시장 데이터를 저장하지 못했어요');
    } finally {
      marketBusy = false;
    }
  }

  async function clearMarket() {
    try {
      await marketData.clear();
      marketInfo = null;
      showSnackbar('시장 데이터를 지웠어요');
    } catch {
      showSnackbar('시장 데이터를 지우지 못했어요');
    }
  }

  function exportNow() {
    // 키가 든 파일은 가진 사람 누구나 쓸 수 있어서 한 번 더 확인한다
    if (
      includeSecrets &&
      !confirmFn('키가 들어 있는 파일을 내보낼까요? 이 파일을 가진 사람은 누구나 이 키로 증권사 API를 쓸 수 있어요.')
    ) {
      return;
    }
    const profile = app.meta.profiles.find((p) => p.id === app.meta.activeProfileId);
    download(exportFileName(profile?.name ?? '', now()), app.exportData(includeSecrets));
  }

  async function onFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      showSnackbar('파일이 너무 커요');
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      showSnackbar('파일을 읽지 못했어요');
      return;
    }
    const res = app.importData(text);
    if (!res.ok) {
      showSnackbar(res.reason);
      return;
    }
    const name = app.meta.profiles.find((p) => p.id === res.profileId)?.name ?? '';
    const made = `'${name}' 프로필을 만들었어요`;
    const action = { label: '전환', run: () => app.switchProfile(res.profileId) };
    // 문장이 길어지면 읽을 시간이 더 필요해 8초 보인다
    if (res.repaired) showSnackbar(`${made}. 일부 값이 맞지 않아 기본값으로 바꿨어요`, action, 8000);
    else showSnackbar(made, action);
  }

  async function clearCache() {
    if (clearing) return;
    clearing = true;
    try {
      await app.data.cache.clear();
      showSnackbar('캐시를 비웠어요');
    } catch {
      showSnackbar('캐시를 비우지 못했어요');
    } finally {
      clearing = false;
      await refreshUsage();
    }
  }
</script>

<div class="card">
  <div class="row">
    <div class="text">
      <b>관심종목 내보내기</b>
      <p>그룹·설정을 JSON 파일로 저장해요. 키는 빼는 게 기본이에요.</p>
    </div>
    <button type="button" class="btn" onclick={exportNow}>내보내기</button>
  </div>
  <label class="check" for="{uid}-secrets">
    <input id="{uid}-secrets" type="checkbox" bind:checked={includeSecrets} />
    키 포함
  </label>
  {#if includeSecrets}
    <p class="warn" role="note">키가 포함된 파일은 안전하게 보관하세요</p>
  {/if}

  <div class="row">
    <div class="text">
      <b>가져오기</b>
      <p>내보낸 파일을 새 프로필로 가져와요.</p>
    </div>
    <button type="button" class="btn" onclick={() => fileInput?.click()}>가져오기</button>
    <input
      bind:this={fileInput}
      class="sr-only"
      type="file"
      accept="application/json,.json"
      aria-label="가져올 파일"
      tabindex="-1"
      onchange={onFile}
    />
  </div>

  <div class="row">
    <div class="text">
      <b>시장 데이터</b>
      <p class="num">{marketBusy ? '가져오는 중…' : marketInfo ? marketLine(marketInfo) : '수집한 .json.gz 파일을 가져와요.'}</p>
    </div>
    {#if marketInfo}
      <button type="button" class="btn" disabled={marketBusy} onclick={clearMarket}>지우기</button>
    {/if}
    <button
      type="button"
      class="btn"
      disabled={marketBusy}
      onclick={() => marketInput?.click()}
    >시장 데이터 가져오기</button>
    <input
      bind:this={marketInput}
      class="sr-only"
      type="file"
      accept=".gz,application/gzip"
      aria-label="시장 데이터 파일"
      tabindex="-1"
      onchange={onMarketFile}
    />
  </div>

  <div class="row">
    <div class="text">
      <b>캐시 사용량</b>
      <p class="num">{usage === null ? '확인 중…' : fmtMB(usage)}</p>
    </div>
    <button type="button" class="btn" disabled={clearing} onclick={clearCache}>캐시 비우기</button>
  </div>
</div>

<style>
  .card {
    background: var(--surface);
    border-radius: var(--r-card);
    padding: 4px 16px 8px;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 0;
    border-bottom: 1px solid var(--line);
  }
  .row:last-child {
    border-bottom: 0;
  }
  .text b {
    font-size: var(--fs-body);
  }
  .text p {
    font-size: var(--fs-sub);
    color: var(--t2);
    margin-top: 2px;
  }
  .btn {
    flex: none;
    min-height: var(--touch);
    padding: 0 14px;
    border-radius: 12px;
    background: var(--surface2);
    color: var(--t1);
    font-weight: 700;
  }
  .btn:disabled {
    opacity: 0.5;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: var(--touch);
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  .check input {
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
  }
  .warn {
    font-size: var(--fs-sub);
    color: var(--warn);
    padding-bottom: 8px;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
</style>
