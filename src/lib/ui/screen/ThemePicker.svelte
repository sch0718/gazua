<script lang="ts">
  // 테마 고르기(스펙 5.1): 검색할 수 있는 목록(이름 · 종목 수)과 고른 테마 칩(칩마다 지우기). v1 데이터면 선택을 끈다.
  import type { MarketThemeSummary } from '../../marketData/store';
  import { NEED_RECOLLECT_TEXT } from './screenText';

  let {
    themes,
    selected,
    onchange,
    disabled = false,
  }: {
    /** 파일의 테마 요약. 아직 읽는 중이면 undefined */
    themes: MarketThemeSummary[] | undefined;
    selected: string[];
    onchange: (next: string[]) => void;
    /** v1 데이터: 새로 고르는 것만 막는다(저장돼 있던 테마는 칩으로 지울 수 있다) */
    disabled?: boolean;
  } = $props();

  const SHOW_MAX = 100;
  let query = $state('');
  const uid = Math.random().toString(36).slice(2, 9);
  const all = $derived(themes ?? []);
  const byCode = $derived(new Map(all.map((t) => [t.code, t])));
  const q = $derived(query.trim().toLowerCase());
  const matched = $derived(q ? all.filter((t) => t.name.toLowerCase().includes(q)) : all);
  const shown = $derived(matched.slice(0, SHOW_MAX));

  function toggle(code: string, on: boolean) {
    onchange(on ? [...selected.filter((c) => c !== code), code] : selected.filter((c) => c !== code));
  }
</script>

<div class="picker">
  <div class="top">
    <span class="sum">{selected.length === 0 ? '고른 테마 없음' : `${selected.length}개 선택`}</span>
    {#if selected.length > 0}
      <button type="button" class="act" onclick={() => onchange([])}>모두 지우기</button>
    {/if}
  </div>
  {#if selected.length > 0}
    <ul class="chips" aria-label="고른 테마">
      {#each selected as code (code)}
        {@const name = byCode.get(code)?.name ?? code}
        <li class="chip">
          <span>{name}</span>
          <button type="button" class="chipx" aria-label="{name} 테마 지우기" onclick={() => toggle(code, false)}>✕</button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if disabled}
    <p class="hint" id="theme-off-{uid}">{NEED_RECOLLECT_TEXT}</p>
  {:else if themes === undefined}
    <p class="hint">테마를 불러오는 중이에요</p>
  {:else if all.length === 0}
    <p class="hint">데이터에 테마가 없어요</p>
  {/if}
  <input
    type="search"
    class="search"
    aria-label="테마 검색"
    placeholder="테마 이름 검색"
    autocomplete="off"
    disabled={disabled || all.length === 0}
    aria-describedby={disabled ? `theme-off-${uid}` : undefined}
    bind:value={query}
  />
  {#if !disabled && all.length > 0}
    <div class="opts" role="group" aria-label="테마 목록">
      {#each shown as t (t.code)}
        <label class="opt">
          <input type="checkbox" checked={selected.includes(t.code)} onchange={(e) => toggle(t.code, e.currentTarget.checked)} />
          <span class="nm">{t.name}</span>
          <em class="num">{t.count}종목</em>
        </label>
      {/each}
      {#if shown.length === 0}<p class="hint">'{query.trim()}'에 맞는 테마가 없어요</p>{/if}
    </div>
    {#if matched.length > SHOW_MAX}<p class="hint">{matched.length}개 중 {SHOW_MAX}개만 보여요. 검색해서 좁혀 보세요</p>{/if}
  {/if}
</div>

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
  .chips {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    padding-left: 12px;
    border-radius: 999px;
    background: var(--surface2);
  }
  .chipx {
    min-width: var(--touch);
    min-height: var(--touch);
    color: var(--t2);
  }
  .search {
    width: 100%;
    min-width: 0;
    min-height: var(--touch);
    padding: 0 12px;
    border-radius: 10px;
    border: 1px solid transparent;
    background: var(--surface2);
    color: var(--t1);
    font: inherit;
    font-size: 16px;
  }
  .search:focus {
    border-color: var(--accent);
    outline: none;
  }
  .search:disabled {
    opacity: 0.5;
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
    word-break: keep-all;
    overflow-wrap: anywhere;
  }
  .opt em {
    font-style: normal;
    font-size: var(--fs-sub);
    color: var(--t3);
    flex: none;
  }
</style>
