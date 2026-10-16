<script lang="ts">
  // 업종 고르기(스펙 7.3): 대분류 목록과 펼치는 중분류 목록. 이름은 수집 파일의 업종 이름이다.
  // 파일의 업종 목록에는 대·중분류의 상하 관계가 없어서 단계별 두 목록으로 보인다. 소분류(3)는 고르지 않는다.
  import type { MarketSector } from '../../marketData/store';

  let { sectors, selected, onchange }: { sectors: MarketSector[]; selected: string[]; onchange: (next: string[]) => void } = $props();

  let showMid = $state(false);
  const big = $derived(sectors.filter((s) => s.level === 1));
  const mid = $derived(sectors.filter((s) => s.level === 2));
  const midId = `sectors-mid-${Math.random().toString(36).slice(2, 9)}`;

  function toggle(code: string, on: boolean) {
    onchange(on ? [...selected.filter((c) => c !== code), code] : selected.filter((c) => c !== code));
  }
</script>

{#snippet list(items: MarketSector[])}
  {#each items as s (s.code)}
    <label class="opt">
      <input type="checkbox" checked={selected.includes(s.code)} onchange={(e) => toggle(s.code, e.currentTarget.checked)} />
      <span>{s.name}</span>
    </label>
  {/each}
{/snippet}

<div class="picker">
  <div class="top">
    <span class="sum">{selected.length === 0 ? '전체 업종' : `${selected.length}개 선택`}</span>
    {#if selected.length > 0}
      <button type="button" class="act" onclick={() => onchange([])}>전체 업종으로</button>
    {/if}
  </div>
  {#if big.length === 0 && mid.length === 0}
    <p class="hint">업종 정보가 없어요</p>
  {:else}
    <p class="group-title">대분류</p>
    <div class="opts">{@render list(big)}</div>
    {#if mid.length > 0}
      <button type="button" class="act" aria-expanded={showMid} aria-controls={showMid ? midId : undefined} onclick={() => (showMid = !showMid)}>
        {showMid ? '중분류 접기' : '중분류 펼치기'}
      </button>
      {#if showMid}
        <div class="opts" id={midId}>{@render list(mid)}</div>
      {/if}
    {/if}
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
  .opts {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 4px;
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
  .opt span {
    word-break: keep-all;
    overflow-wrap: anywhere;
  }
</style>
