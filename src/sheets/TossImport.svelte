<script lang="ts">
  import type { UniverseItem } from '../lib/data/universe';
  import type { GroupImportSource, ImportSector, ImportStock } from '../lib/providers/types';
  import type { App } from '../lib/state/app.svelte';
  import { MAX_ITEMS } from '../lib/state/watchlist';
  import { errorText } from '../lib/ui/compare/compareController.svelte';
  import { showSnackbar } from '@sch0718/ui-svelte';
  import { planGroup, withNewGroup, type GroupPlan } from './groupImport';
  import { sharedUniverse } from './universeSource';

  // 토스에서 관심그룹 만들기(그룹 관리 시트 아래). 공식 Open API에는 관심종목 조회가 없어서,
  // 보유 종목(평가금액 큰 순)이나 토스 섹터(시가총액 큰 순)로 새 그룹을 만든다. 기존 그룹은 건드리지 않는다.
  let {
    app,
    source,
    onclose,
    now = () => Date.now(),
    loadUniverse = sharedUniverse,
  }: {
    app: App;
    source: GroupImportSource;
    onclose: () => void;
    now?: () => number;
    loadUniverse?: () => Promise<UniverseItem[]>;
  } = $props();

  const SECTOR_RESULTS = 30;
  const HOLDINGS_NAME = '토스 보유';

  type Load<T> = { state: 'loading' } | { state: 'error'; text: string } | { state: 'ready'; value: T };
  interface Preview {
    plan: GroupPlan;
    names: string[];
  }

  let mode = $state<'holdings' | 'sectors' | null>(null);
  let holdings = $state<Load<Preview> | null>(null);
  let sectors = $state<Load<ImportSector[]> | null>(null);
  let query = $state('');
  let picked = $state<ImportSector | null>(null);
  let sectorPreview = $state<Load<Preview> | null>(null);

  function failText(e: unknown): string {
    if (e instanceof Error && e.message === 'Toss has no brokerage account') return '토스 종합매매 계좌가 없어요';
    return errorText(e);
  }

  async function preview(stocks: Promise<ImportStock[]>): Promise<Preview> {
    const [list, universe] = await Promise.all([stocks, loadUniverse()]);
    const plan = planGroup(list, universe);
    const byCode = new Map(universe.map((u) => [u.s, u.n]));
    return { plan, names: plan.symbols.map((s) => byCode.get(s) ?? s) };
  }

  async function showHoldings() {
    mode = 'holdings';
    if (holdings?.state === 'ready' || holdings?.state === 'loading') return;
    holdings = { state: 'loading' };
    try {
      holdings = { state: 'ready', value: await preview(source.holdings()) };
    } catch (e) {
      holdings = { state: 'error', text: failText(e) };
    }
  }

  async function showSectors() {
    mode = 'sectors';
    if (sectors?.state === 'ready' || sectors?.state === 'loading') return;
    sectors = { state: 'loading' };
    try {
      sectors = { state: 'ready', value: await source.sectors() };
    } catch (e) {
      sectors = { state: 'error', text: failText(e) };
    }
  }

  async function pickSector(s: ImportSector) {
    picked = s;
    sectorPreview = { state: 'loading' };
    try {
      const value = await preview(source.sectorStocks(s.id));
      if (picked === s) sectorPreview = { state: 'ready', value };
    } catch (e) {
      if (picked === s) sectorPreview = { state: 'error', text: failText(e) };
    }
  }

  const matches = $derived.by(() => {
    if (sectors?.state !== 'ready') return [];
    const q = query.trim();
    const list = q ? sectors.value.filter((s) => s.path.includes(q)) : sectors.value.filter((s) => !s.path.includes(' › '));
    return list.slice(0, SECTOR_RESULTS);
  });

  function create(name: string, symbols: string[]) {
    const { watchlists, groupId } = withNewGroup(app.watchlists, name, symbols, now());
    app.setWatchlists(watchlists);
    showSnackbar(`'${name}' 그룹을 만들었어요`);
    onclose();
    app.navigate({ name: 'compare', groupId });
  }

  function note(p: GroupPlan): string {
    const parts: string[] = [];
    if (p.found > MAX_ITEMS) parts.push(`${p.found}개 중 큰 순서로 ${MAX_ITEMS}개만 넣어요`);
    if (p.unknown > 0) parts.push(`지원하지 않는 종목 ${p.unknown}개는 뺐어요`);
    return parts.join(' · ');
  }
</script>

{#snippet result(load: Load<Preview> | null, name: string)}
  {#if load?.state === 'loading'}
    <p class="status" role="status">불러오는 중</p>
  {:else if load?.state === 'error'}
    <p class="status err" role="alert">{load.text}</p>
  {:else if load?.state === 'ready'}
    {@const p = load.value.plan}
    {#if p.symbols.length === 0}
      <p class="status">넣을 수 있는 국내 종목이 없어요</p>
      {#if note(p)}<p class="status">{note(p)}</p>{/if}
    {:else}
      <p class="names">{load.value.names.join(', ')}</p>
      {#if note(p)}<p class="status">{note(p)}</p>{/if}
      <button type="button" class="btn" onclick={() => create(name, p.symbols)}>'{name}' 그룹 만들기</button>
    {/if}
  {/if}
{/snippet}

<section class="import" aria-labelledby="toss-import-title">
  <h3 id="toss-import-title">토스에서 가져오기</h3>
  <p class="hint">새 그룹을 만들어요. 한 그룹에는 {MAX_ITEMS}종목까지 넣을 수 있어요.</p>
  <div class="tabs">
    <button type="button" class="chip" aria-pressed={mode === 'holdings'} onclick={showHoldings}>보유 종목</button>
    <button type="button" class="chip" aria-pressed={mode === 'sectors'} onclick={showSectors}>섹터</button>
  </div>

  {#if mode === 'holdings'}
    {@render result(holdings, HOLDINGS_NAME)}
  {:else if mode === 'sectors'}
    {#if sectors?.state === 'loading'}
      <p class="status" role="status">불러오는 중</p>
    {:else if sectors?.state === 'error'}
      <p class="status err" role="alert">{sectors.text}</p>
    {:else if sectors?.state === 'ready'}
      {#if picked}
        <button type="button" class="link" onclick={() => ((picked = null), (sectorPreview = null))}>‹ 섹터 목록</button>
        <p class="path">{picked.path}</p>
        {@render result(sectorPreview, picked.name)}
      {:else}
        <input type="search" class="search" placeholder="섹터 이름 (예: 반도체)" aria-label="섹터 검색" bind:value={query} />
        {#if matches.length === 0}
          <p class="status">'{query.trim()}'에 맞는 섹터가 없어요</p>
        {:else}
          <ul class="sectors">
            {#each matches as s (s.id)}
              <li><button type="button" class="sector" onclick={() => pickSector(s)}>{s.path}</button></li>
            {/each}
          </ul>
        {/if}
      {/if}
    {/if}
  {/if}
</section>

<style>
  .import {
    border-top: 1px solid var(--line);
    margin: 8px 12px 0;
    padding: 14px 8px 4px;
  }
  h3 {
    font-size: 14px;
    margin: 0 0 2px;
  }
  .hint,
  .status,
  .path {
    font-size: 12px;
    color: var(--t2);
    margin: 4px 0 8px;
  }
  .status.err {
    color: var(--err);
  }
  .names {
    font-size: 13px;
    margin: 8px 0 4px;
  }
  .tabs {
    display: flex;
    gap: 6px;
    margin: 8px 0;
  }
  .chip {
    padding: 6px 12px;
    border-radius: var(--r-chip);
    background: var(--surface2);
    color: var(--t1);
    font-size: 13px;
    font-weight: 600;
  }
  .chip[aria-pressed='true'] {
    background: var(--accent);
    color: #fff;
  }
  .search {
    width: 100%;
    font-size: 16px;
    padding: 8px 10px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--surface2);
    color: var(--t1);
  }
  .sectors {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
    max-height: 240px;
    overflow: auto;
  }
  .sector {
    width: 100%;
    text-align: left;
    padding: 10px 8px;
    border-radius: 8px;
    font-size: 14px;
    color: var(--t1);
  }
  .sector:hover {
    background: var(--surface2);
  }
  .link {
    font-size: 13px;
    color: var(--accent);
    padding: 4px 0;
  }
</style>
