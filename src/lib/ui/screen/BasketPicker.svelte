<script lang="ts">
  // 내 묶음 고르기(스펙 5.1): 목록에서 체크로 고르고, `묶음 관리` 시트에서 만들고 고친다.
  import type { UniverseItem } from '../../data/universe';
  import type { MarketThemeSummary } from '../../marketData/store';
  import type { App } from '../../state/app.svelte';
  import BasketSheet from './BasketSheet.svelte';

  let {
    app,
    selected,
    onchange,
    names = {},
    loadItems,
    themes,
    loadThemeSymbols,
  }: {
    app: App;
    selected: string[];
    onchange: (next: string[]) => void;
    names?: Record<string, string>;
    loadItems?: () => Promise<UniverseItem[]>;
    themes?: MarketThemeSummary[];
    loadThemeSymbols?: (code: string) => Promise<string[]>;
  } = $props();

  let managing = $state(false);
  let manageBtn = $state<HTMLButtonElement>();
  const baskets = $derived(app.baskets);
  // 지워진 묶음을 가리키는 id는 해제할 수 있게 줄로 남긴다(편집 화면 경고와 짝)
  const gone = $derived(selected.filter((id) => !baskets.some((b) => b.id === id)));

  function toggle(id: string, on: boolean) {
    onchange(on ? [...selected.filter((x) => x !== id), id] : selected.filter((x) => x !== id));
  }
</script>

<div class="picker">
  <div class="top">
    <span class="sum">{selected.length === 0 ? '고른 묶음 없음' : `${selected.length}개 선택`}</span>
    <button type="button" class="act" bind:this={manageBtn} onclick={() => (managing = true)}>묶음 관리</button>
  </div>
  {#if baskets.length === 0 && gone.length === 0}
    <p class="hint">만든 묶음이 없어요</p>
  {:else}
    <div class="opts" role="group" aria-label="내 묶음 목록">
      {#each baskets as b (b.id)}
        <label class="opt">
          <input type="checkbox" checked={selected.includes(b.id)} onchange={(e) => toggle(b.id, e.currentTarget.checked)} />
          <span class="nm">{b.name}</span>
          <em class="num">{b.symbols.length}종목</em>
        </label>
      {/each}
      {#each gone as id (id)}
        <label class="opt gone">
          <input type="checkbox" checked onchange={() => toggle(id, false)} />
          <span class="nm">지워진 묶음</span>
        </label>
      {/each}
    </div>
  {/if}
</div>

<BasketSheet open={managing} {app} {names} {loadItems} {themes} {loadThemeSymbols} returnTo={() => manageBtn} onclose={() => (managing = false)} />

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .sum {
    font-weight: 700;
  }
  .opts {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 280px;
    overflow-y: auto;
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: var(--touch);
    padding: 0 8px;
    border-radius: 10px;
    cursor: pointer;
  }
  .opt:hover {
    background: var(--surface2);
  }
  .opt input {
    width: 20px;
    height: 20px;
    accent-color: var(--accent);
    flex: none;
  }
  .nm {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
    word-break: keep-all;
  }
  .gone .nm {
    color: var(--t3);
  }
  .opt em {
    font-style: normal;
    font-size: var(--fs-sub);
    color: var(--t3);
    flex: none;
  }
</style>
