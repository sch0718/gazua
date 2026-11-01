<script lang="ts">
  // 묶음 카드(스펙 §10.2): 안의 조건은 모두 맞아야 한다. 조건을 더하면 새 줄의 종류 선택으로, 지우면 앞 줄(없으면 [＋ 조건])로 포커스.
  import { tick } from 'svelte';
  import { defaultCond, MAX_CONDS } from '../../../sim/strategyV2';
  import type { Cond, CondGroup } from '../../../sim/types';
  import CondRow from './CondRow.svelte';

  let {
    group,
    index,
    prefix,
    allowPattern,
    patternTaken,
    update,
    onremove,
  }: {
    group: CondGroup;
    index: number;
    /** `매수 묶음` · `조건 매도 묶음` */
    prefix: string;
    allowPattern: boolean;
    patternTaken: boolean;
    update: (fn: (g: CondGroup) => void) => void;
    onremove: () => void;
  } = $props();

  const rows: CondRow[] = $state([]);
  let addBtn: HTMLButtonElement;
  const full = $derived(group.conds.length >= MAX_CONDS);

  // 묶음을 더하거나 지운 뒤 첫 조건으로, 조건이 없으면 추가 버튼으로 포커스.
  export function focusFirstCond() {
    if (group.conds.length) rows[0]?.focusKind();
    else addBtn?.focus();
  }

  async function addCond() {
    if (full) return;
    update((g) => void g.conds.push(defaultCond('maPrice')));
    await tick();
    rows[group.conds.length - 1]?.focusKind();
  }
  async function removeCond(ci: number) {
    update((g) => void g.conds.splice(ci, 1));
    await tick();
    if (ci > 0) rows[ci - 1]?.focusKind();
    else addBtn?.focus();
  }
  const setCond = (ci: number) => (fn: (c: Cond) => Cond | void) =>
    update((g) => {
      const next = fn(g.conds[ci]);
      if (next) g.conds[ci] = next;
    });
</script>

<section class="group" role="group" aria-label="{prefix} {index + 1}">
  <div class="g-head">
    <span class="g-title">{prefix} {index + 1} · 모두 만족</span>
    <button type="button" class="link" aria-label="{prefix} {index + 1} 지우기" onclick={onremove}>묶음 지우기</button>
  </div>
  {#each group.conds as cond, ci (ci)}
    <CondRow
      bind:this={rows[ci]}
      {cond}
      label="{prefix} {index + 1}의 조건 {ci + 1}"
      {allowPattern}
      patternTaken={patternTaken && cond.kind !== 'pattern'}
      update={setCond(ci)}
      onremove={() => removeCond(ci)}
    />
  {/each}
  <button type="button" class="act" bind:this={addBtn} disabled={full} onclick={addCond}>＋ 조건</button>
  {#if full}<p class="hint">조건은 묶음마다 {MAX_CONDS}개까지예요</p>{/if}
</section>

<style>
  .group {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: var(--r-card);
  }
  .g-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .g-title {
    font-weight: 600;
  }
  .link {
    min-height: 44px;
  }
</style>
