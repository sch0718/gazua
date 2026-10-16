<script lang="ts">
  // 업종 고르기(스펙 7.3): 대분류 목록과 펼치는 중분류 목록. 이름은 수집 파일의 업종 이름이다.
  // 파일의 업종 목록에는 대·중분류의 상하 관계가 없어서 단계별 두 목록으로 보인다. 소분류(3)는 고르지 않는다.
  // 같은 (레벨, 이름)의 업종은 시장이 달라도 한 줄이다(R10). 고르면 그 코드를 모두 넣고, 하나라도 있으면 체크로 본다.
  import type { MarketSector } from '../../marketData/store';
  import { sectorGroupCount, sectorGroupKey } from '../../screen/precompute';

  let { sectors, selected, onchange }: { sectors: MarketSector[]; selected: string[]; onchange: (next: string[]) => void } = $props();

  type Row = { key: string; name: string; level: number; codes: string[] };

  let showMid = $state(false);
  const rows = $derived.by(() => {
    const m = new Map<string, Row>();
    for (const s of sectors) {
      const key = sectorGroupKey(s);
      const r = m.get(key);
      if (r) r.codes.push(s.code);
      else m.set(key, { key, name: s.name, level: s.level, codes: [s.code] });
    }
    return [...m.values()];
  });
  const big = $derived(rows.filter((r) => r.level === 1));
  const mid = $derived(rows.filter((r) => r.level === 2));
  const count = $derived(sectorGroupCount(selected, sectors));
  const midId = `sectors-mid-${Math.random().toString(36).slice(2, 9)}`;

  function toggle(r: Row, on: boolean) {
    const rest = selected.filter((c) => !r.codes.includes(c));
    onchange(on ? [...rest, ...r.codes] : rest);
  }
</script>

{#snippet list(items: Row[])}
  {#each items as r (r.key)}
    <label class="opt">
      <input type="checkbox" checked={r.codes.some((c) => selected.includes(c))} onchange={(e) => toggle(r, e.currentTarget.checked)} />
      <span>{r.name}</span>
    </label>
  {/each}
{/snippet}

<div class="picker">
  <div class="top">
    <span class="sum">{selected.length === 0 ? '전체 업종' : `${count}개 선택`}</span>
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
