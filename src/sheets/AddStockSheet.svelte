<script lang="ts">
  import { untrack } from 'svelte';
  import { matchSpan, searchUniverse, type UniverseItem } from '../lib/data/universe';
  import type { StockMeta } from '../lib/providers/types';
  import type { App } from '../lib/state/app.svelte';
  import { MAX_ITEMS } from '../lib/state/watchlist';
  import Badge from '../lib/ui/components/Badge.svelte';
  import Sheet from '../lib/ui/components/Sheet.svelte';
  import { FULL_MESSAGE, addToGroup } from './groupActions';
  import { sharedUniverse } from './universeSource';

  // 종목 추가 시트(스펙 7.3, 9-5·6·7): 초성 검색, 최근 추가, 연속 추가, 8종목 한도.
  let {
    open,
    app,
    groupId,
    metas,
    now,
    onclose,
    loadItems = sharedUniverse,
  }: {
    open: boolean;
    app: App;
    groupId: string;
    /** 불러온 종목 메타(NXT 배지는 아는 종목만) */
    metas: Record<string, StockMeta>;
    now: number;
    onclose: () => void;
    loadItems?: () => Promise<UniverseItem[]>;
  } = $props();

  const RESULT_LIMIT = 30;

  let universe = $state.raw<UniverseItem[] | null>(null);
  let failed = $state(false);
  let query = $state('');
  let added = $state(0);

  function load() {
    failed = false;
    loadItems().then(
      (items) => (universe = items),
      () => (failed = true),
    );
  }

  // 열 때마다 검색어·이번에 추가한 수를 새로 시작한다. 목록은 처음 열 때 받는다.
  $effect(() => {
    if (!open) return;
    untrack(() => {
      query = '';
      added = 0;
      if (!universe) load();
    });
  });

  const group = $derived(app.watchlists.groups.find((g) => g.id === groupId));
  const count = $derived(group?.items.length ?? 0);
  const full = $derived(count >= MAX_ITEMS);
  const present = $derived(new Set(group?.items.map((i) => i.symbol) ?? []));
  const trimmed = $derived(query.trim());

  const results = $derived(universe && trimmed ? searchUniverse(universe, trimmed, RESULT_LIMIT) : []);
  const recentRows = $derived.by(() => {
    if (!universe) return [];
    const bySymbol = new Map(universe.map((u) => [u.s, u]));
    return app.recent.flatMap((s) => bySymbol.get(s) ?? []);
  });
  const rows = $derived(trimmed ? results : recentRows);

  function add(item: UniverseItem) {
    if (present.has(item.s)) return;
    if (addToGroup(app, groupId, item.s, now) !== 'added') return;
    app.addRecent(item.s);
    added++;
  }

  function parts(name: string): [string, string, string] {
    const span = trimmed ? matchSpan(name, trimmed) : null;
    if (!span) return [name, '', ''];
    const end = span.start + span.length;
    return [name.slice(0, span.start), name.slice(span.start, end), name.slice(end)];
  }
</script>

<Sheet {open} title="종목 추가" {onclose}>
  <p class="sub">
    {group?.name} 그룹 · {count}/{MAX_ITEMS}{full ? '' : ` · ${MAX_ITEMS - count}개 더 추가할 수 있어요`}
  </p>
  <label class="search">
    <span aria-hidden="true">⌕</span>
    <input
      type="search"
      data-autofocus
      bind:value={query}
      placeholder="종목명·초성·코드 (예: ㅅㅅㅈㄱ)"
      autocomplete="off"
      aria-label="종목 검색"
    />
  </label>
  {#if full}
    <p class="limit" role="status">{FULL_MESSAGE}</p>
  {/if}

  {#if failed}
    <div class="state">
      <span>종목 목록을 불러오지 못했어요</span>
      <button type="button" class="link" onclick={load}>다시 시도</button>
    </div>
  {:else if !universe}
    <p class="sec">종목 목록을 불러오는 중</p>
  {:else if trimmed}
    <p class="sec">{results.length > 0 ? `검색 결과 ${results.length}` : `'${trimmed}'에 맞는 종목이 없어요`}</p>
  {:else if recentRows.length > 0}
    <p class="sec">최근 추가</p>
  {/if}

  {#if universe && !failed}
    <ul>
      {#each rows as item (item.s)}
        {@const has = present.has(item.s)}
        {@const [before, hit, after] = parts(item.n)}
        <li class="srow">
          <div class="nm">
            <b>{before}{#if hit}<mark>{hit}</mark>{/if}{after}</b>{#if metas[item.s]?.nxtSupported}<Badge tone="nxt"
                >NXT</Badge
              >{/if}{#if item.t === 'ETF' || item.t === 'ETN'}<Badge>{item.t}</Badge>{/if}
            <em class="num">{item.s} · {item.m}{has ? ' · 이미 추가됨' : ''}</em>
          </div>
          <button
            type="button"
            class="addbtn"
            class:done={has}
            aria-label="{item.n} {has ? '추가됨' : '추가'}"
            aria-disabled={!has && full ? 'true' : undefined}
            onclick={() => add(item)}
          >
            {has ? '✓' : '＋'}
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  <div class="foot">
    <span>{added > 0 ? `이번에 ${added}개 추가했어요` : '여러 개를 연달아 추가할 수 있어요'}</span>
    <button type="button" class="btn" onclick={onclose}>완료</button>
  </div>
</Sheet>

<style>
  .sub {
    font-size: 13px;
    color: var(--t2);
    padding: 0 20px 10px;
  }
  .search {
    margin: 4px 16px 8px;
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--surface2);
    border-radius: 14px;
    padding: 0 14px;
    color: var(--t3);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: none;
    font-size: 16px;
    padding: 12px 0;
    outline: none;
    color: var(--t1);
  }
  .limit {
    margin: 4px 16px;
    padding: 10px 12px;
    border-radius: 12px;
    background: color-mix(in srgb, var(--warn) 12%, transparent);
    color: var(--t1);
    font-size: 13px;
  }
  .sec {
    font-size: 12px;
    font-weight: 700;
    color: var(--t3);
    padding: 10px 20px 4px;
  }
  .state {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    font-size: 14px;
    color: var(--t2);
  }
  .link {
    min-height: var(--touch);
    color: var(--accent);
    font-weight: 700;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .srow {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 20px;
    min-height: 56px;
  }
  .nm {
    flex: 1;
    min-width: 0;
  }
  .nm b {
    font-size: 15px;
    font-weight: 700;
  }
  mark {
    background: none;
    color: var(--accent);
  }
  .nm em {
    font-style: normal;
    font-size: 12px;
    color: var(--t3);
    display: block;
  }
  .addbtn {
    width: var(--touch);
    height: var(--touch);
    border-radius: 12px;
    display: grid;
    place-items: center;
    background: var(--surface2);
    font-size: 20px;
    font-weight: 700;
    flex: none;
  }
  .addbtn.done {
    background: var(--accent);
    color: var(--on-accent);
    font-size: 15px;
  }
  .addbtn[aria-disabled='true'] {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px 0;
    border-top: 1px solid var(--line);
    margin-top: 8px;
    /* 결과가 길어도 완료 버튼이 보이게 */
    position: sticky;
    bottom: 0;
    padding-bottom: 12px;
    background: var(--surface);
  }
  .foot span {
    flex: 1;
    font-size: 13px;
    color: var(--t2);
  }
  .btn {
    padding: 12px 18px;
    border-radius: 14px;
    font-weight: 800;
    font-size: 15px;
    background: var(--t1);
    color: var(--bg);
    min-height: 46px;
  }
</style>
