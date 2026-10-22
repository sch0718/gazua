<script lang="ts">
  import { untrack } from 'svelte';
  import { orderRanked, RANK_METRICS, rankCandidates, type RankMetric, type RankRow } from '../lib/data/rankCandidates';
  import { METRICS } from '../lib/data/metricRegistry';
  import { searchUniverse, type UniverseItem } from '../lib/data/universe';
  import type { App } from '../lib/state/app.svelte';
  import type { Period } from '../lib/state/schema';
  import { MAX_ITEMS } from '../lib/state/watchlist';
  import { formatMetricValue } from '../lib/ui/compare/compareText';
  import Sheet from '../lib/ui/components/Sheet.svelte';
  import { showSnackbar } from '../lib/ui/components/snackbarStore.svelte';
  import { planGroup, withNewGroup } from './groupImport';
  import { sharedUniverse } from './universeSource';

  // 조건으로 골라 새 그룹 만들기: 후보(최대 30개)를 담고 지표·방향·기간을 고른 뒤 미리보기로 순위를 보고,
  // 위에서부터 MAX_ITEMS개로 새 그룹을 만든다. 기존 그룹은 건드리지 않는다.
  let {
    open,
    app,
    onclose,
    now = () => Date.now(),
    loadItems = sharedUniverse,
  }: {
    open: boolean;
    app: App;
    onclose: () => void;
    now?: () => number;
    loadItems?: () => Promise<UniverseItem[]>;
  } = $props();

  const MAX_CANDIDATES = 30;
  const SEARCH_LIMIT = 8;
  const PERIODS: { label: string; period: Period }[] = [
    { label: '1주', period: { unit: 'W', n: 1 } },
    { label: '1개월', period: { unit: 'M', n: 1 } },
    { label: '3개월', period: { unit: 'M', n: 3 } },
    { label: '6개월', period: { unit: 'M', n: 6 } },
    { label: '1년', period: { unit: 'Y', n: 1 } },
  ];
  const metricDef = (id: RankMetric) => METRICS.find((m) => m.id === id)!;

  let universe = $state.raw<UniverseItem[] | null>(null);
  let candidates = $state<string[]>([]);
  let query = $state('');
  let metric = $state<RankMetric>('excess');
  let direction = $state<'desc' | 'asc'>('desc');
  let periodIdx = $state(1);
  let preview = $state.raw<RankRow[] | null>(null);
  let progress = $state<{ done: number; total: number } | null>(null);
  let name = $state('');
  let notice = $state<string | null>(null);
  let error = $state<string | null>(null);
  /** 미리보기 요청 번호. 후보·기준이 바뀌거나 시트를 열고 닫으면 올려서, 늦게 끝난 이전 계산을 버린다. */
  let run = 0;
  /** 종목 목록을 받는 중이면 다시 부르지 않는다. 실패하면 null로 두어 다음에 열 때 다시 받는다. */
  let loadingUniverse = false;

  function loadUniverse() {
    if (universe || loadingUniverse) return;
    loadingUniverse = true;
    loadItems().then(
      (u) => {
        universe = u;
        loadingUniverse = false;
      },
      () => {
        loadingUniverse = false;
      },
    );
  }

  // 시트는 닫혀도 남아 있다(CompareSheets). 열 때마다 새로 시작하고, 열고 닫을 때 진행 중인 미리보기를 버린다.
  $effect(() => {
    const isOpen = open;
    untrack(() => {
      run++;
      progress = null;
      if (!isOpen) return;
      candidates = [];
      query = '';
      preview = null;
      notice = null;
      error = null;
      loadUniverse();
    });
  });

  const byCode = $derived(new Map((universe ?? []).map((u) => [u.s, u])));
  const nameOf = (s: string) => byCode.get(s)?.n ?? s;
  const full = $derived(candidates.length >= MAX_CANDIDATES);
  const results = $derived(universe && query.trim() ? searchUniverse(universe, query.trim(), SEARCH_LIMIT) : []);
  const defaultName = $derived(`${metricDef(metric).label} ${direction === 'desc' ? '상위' : '하위'}`);

  /** 후보·기준이 바뀌면 이전 미리보기는 맞지 않으니 버린다. */
  function changed() {
    run++;
    preview = null;
    progress = null;
    error = null;
  }

  /** 앞에서부터 빈자리만큼 담는다. 몇 개를 담았고 몇 개가 넘쳤는지 알린다. */
  function addMany(symbols: string[], from: string) {
    const fresh = symbols.filter((s, i) => !candidates.includes(s) && symbols.indexOf(s) === i);
    const room = MAX_CANDIDATES - candidates.length;
    const taken = fresh.slice(0, room);
    candidates = [...candidates, ...taken];
    const over = fresh.length - taken.length;
    notice = `${from}에서 ${taken.length}개를 담았어요${over > 0 ? ` · 후보는 ${MAX_CANDIDATES}개까지라 ${over}개는 뺐어요` : ''}`;
    changed();
  }

  function toggle(symbol: string) {
    if (candidates.includes(symbol)) candidates = candidates.filter((s) => s !== symbol);
    else if (!full) candidates = [...candidates, symbol];
    else return void showSnackbar(`후보는 ${MAX_CANDIDATES}개까지 담을 수 있어요`);
    notice = null;
    changed();
  }

  async function addHoldings() {
    const source = app.provider.groupImport;
    if (!source) return;
    notice = '토스 보유 종목을 불러오는 중';
    try {
      const [list, u] = await Promise.all([source.holdings(), loadItems()]);
      addMany(planGroup(list, u, MAX_CANDIDATES).symbols, '토스 보유 종목');
    } catch {
      notice = '토스 보유 종목을 불러오지 못했어요';
    }
  }

  async function runPreview() {
    const mine = ++run;
    const symbols = [...candidates];
    progress = { done: 0, total: symbols.length };
    preview = null;
    error = null;
    const { cache, memo } = app.data;
    let rows: RankRow[];
    try {
      rows = await rankCandidates({
        provider: app.provider,
        cache,
        memo,
        now: now(),
        venueMode: app.settings.venueMode,
        benchmark: app.settings.benchmark,
        symbols,
        metric,
        period: PERIODS[periodIdx].period,
        onProgress: (done, total) => {
          if (mine === run) progress = { done, total };
        },
      });
    } catch {
      // 종목 정보부터 받지 못한 경우(연결·키 문제). 종목별 실패는 rankCandidates가 행으로 돌려준다.
      if (mine === run) {
        progress = null;
        error = '종목 정보를 받지 못했어요. 다시 시도해 주세요';
      }
      return;
    }
    if (mine !== run) return;
    progress = null;
    preview = orderRanked(rows, direction);
    if (name.trim() === '') name = defaultName;
  }

  const picked = $derived(preview ? preview.filter((r) => r.value !== null).slice(0, MAX_ITEMS) : []);

  function create() {
    const groupName = name.trim() || defaultName;
    const { watchlists, groupId } = withNewGroup(app.watchlists, groupName, picked.map((r) => r.symbol), now());
    app.setWatchlists(watchlists);
    showSnackbar(`'${groupName}' 그룹을 만들었어요`);
    onclose();
    app.navigate({ name: 'compare', groupId });
  }
</script>

<Sheet {open} title="조건으로 골라 새 그룹 만들기" {onclose}>
  <section aria-labelledby="pick-candidates">
    <h3 id="pick-candidates">후보 <span class="num">{candidates.length}/{MAX_CANDIDATES}</span></h3>
    <input
      type="search"
      class="search"
      placeholder="종목 이름·코드·초성"
      aria-label="후보 종목 검색"
      bind:value={query}
    />
    {#if results.length > 0}
      <ul class="results">
        {#each results as item (item.s)}
          {@const has = candidates.includes(item.s)}
          <li>
            <button type="button" class="pick" aria-pressed={has} onclick={() => toggle(item.s)}>
              <span>{item.n} <em class="num">{item.s}</em></span><b aria-hidden="true">{has ? '✓' : '＋'}</b>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    <div class="sources">
      {#each app.watchlists.groups as g (g.id)}
        <button type="button" class="chip" disabled={full || g.items.length === 0} onclick={() => addMany(g.items.map((i) => i.symbol), `'${g.name}'`)}
          >'{g.name}' 담기</button
        >
      {/each}
      {#if app.provider.groupImport}
        <button type="button" class="chip" disabled={full} onclick={addHoldings}>토스 보유 종목 담기</button>
      {/if}
    </div>
    {#if notice}<p class="hint" role="status">{notice}</p>{/if}
    {#if candidates.length > 0}
      <ul class="cands" aria-label="담은 후보">
        {#each candidates as s (s)}
          <li>
            {nameOf(s)}<button type="button" class="x" aria-label="{nameOf(s)} 빼기" onclick={() => toggle(s)}>✕</button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section aria-labelledby="pick-criteria">
    <h3 id="pick-criteria">기준</h3>
    <label class="row"
      >지표
      <select bind:value={metric} onchange={changed}>
        {#each RANK_METRICS as id (id)}<option value={id}>{metricDef(id).label}</option>{/each}
      </select>
    </label>
    <div class="row" role="group" aria-label="정렬 방향">
      <button type="button" class="chip" aria-pressed={direction === 'desc'} onclick={() => ((direction = 'desc'), changed())}>큰 순</button>
      <button type="button" class="chip" aria-pressed={direction === 'asc'} onclick={() => ((direction = 'asc'), changed())}>작은 순</button>
    </div>
    <div class="row" role="group" aria-label="기간">
      {#each PERIODS as p, i (p.label)}
        <button type="button" class="chip" aria-pressed={periodIdx === i} onclick={() => ((periodIdx = i), changed())}>{p.label}</button>
      {/each}
    </div>
    <button type="button" class="btn" disabled={candidates.length === 0 || progress !== null} onclick={runPreview}>미리보기</button>
  </section>

  {#if error}
    <p class="hint err" role="alert">{error}</p>
  {/if}
  {#if progress}
    <p class="hint" role="status">계산 중 {progress.done}/{progress.total}</p>
  {:else if preview}
    <section aria-labelledby="pick-preview">
      <h3 id="pick-preview">미리보기 · {PERIODS[periodIdx].label} · {metricDef(metric).label} {direction === 'desc' ? '큰 순' : '작은 순'}</h3>
      <ol class="ranked" aria-label="순위">
        {#each preview as r, i (r.symbol)}
          {@const inGroup = picked.includes(r)}
          <li class:in={inGroup} class:none={r.value === null}>
            <span class="rank num">{i + 1}</span>
            <span class="nm">{nameOf(r.symbol)}</span>
            <span class="val num">{r.value === null ? (r.reason ?? '값 없음') : formatMetricValue(r.value, metricDef(metric).unit)}</span>
            {#if inGroup}<span class="tag">넣음</span>{/if}
          </li>
        {/each}
      </ol>
      {#if picked.length === 0}
        <p class="hint">값을 계산한 종목이 없어요</p>
      {:else}
        <label class="row">그룹 이름 <input class="name" bind:value={name} maxlength="30" /></label>
        <button type="button" class="btn primary" onclick={create}>상위 {picked.length}개로 새 그룹 만들기</button>
      {/if}
    </section>
  {/if}
</Sheet>

<style>
  section {
    padding: 4px 20px 14px;
  }
  h3 {
    font-size: 14px;
    margin: 6px 0 8px;
  }
  .hint {
    font-size: 12px;
    color: var(--t2);
    margin: 6px 20px;
  }
  .hint.err {
    color: var(--err);
  }
  section .hint {
    margin: 6px 0;
  }
  .search,
  .name,
  select {
    font-size: 16px;
    padding: 8px 10px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--surface2);
    color: var(--t1);
  }
  .search {
    width: 100%;
  }
  ul,
  ol {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
  }
  .pick {
    width: 100%;
    display: flex;
    justify-content: space-between;
    padding: 8px;
    border-radius: 8px;
    color: var(--t1);
    font-size: 14px;
  }
  .pick:hover {
    background: var(--surface2);
  }
  .pick em {
    font-style: normal;
    color: var(--t3);
    font-size: 12px;
  }
  .sources,
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin: 8px 0;
    font-size: 13px;
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
    color: var(--on-accent);
  }
  .chip:disabled {
    opacity: 0.4;
  }
  .cands {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .cands li {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px 4px 2px 10px;
    border-radius: var(--r-chip);
    background: var(--surface2);
    font-size: 13px;
  }
  .x {
    width: 28px;
    height: 28px;
    color: var(--t2);
  }
  .ranked li {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) auto auto;
    gap: 8px;
    align-items: center;
    padding: 8px 6px;
    border-radius: 8px;
    font-size: 14px;
  }
  .ranked li.in {
    background: var(--accent-soft);
  }
  .ranked li.none {
    color: var(--t3);
  }
  .rank {
    color: var(--t3);
    text-align: right;
  }
  .nm {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tag {
    font-size: 11px;
    font-weight: 700;
    color: var(--accent);
  }
  .btn {
    margin-top: 8px;
    width: 100%;
    min-height: 44px;
    padding: 10px 16px;
    border-radius: 12px;
    font-size: 15px;
    font-weight: 700;
    background: var(--surface2);
    color: var(--t1);
  }
  .btn.primary {
    background: var(--accent);
    color: var(--on-accent);
  }
  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
