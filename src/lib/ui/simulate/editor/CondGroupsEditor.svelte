<script lang="ts">
  // 묶음 목록(스펙 §10.2): 묶음끼리는 하나만 맞으면 된다(또는). 매수 조건·조건 매도가 같이 쓴다.
  import { tick } from 'svelte';
  import { defaultCond, MAX_GROUPS } from '../../../sim/strategyV2';
  import type { CondGroup } from '../../../sim/types';
  import CondGroupCard from './CondGroupCard.svelte';

  let {
    groups,
    prefix,
    allowPattern,
    update,
  }: { groups: CondGroup[]; prefix: string; allowPattern: boolean; update: (fn: (groups: CondGroup[]) => void) => void } = $props();

  const full = $derived(groups.length >= MAX_GROUPS);
  const patternTaken = $derived(groups.some((g) => g.conds.some((c) => c.kind === 'pattern')));
  let root: HTMLElement;

  async function addGroup() {
    if (full) return;
    update((gs) => void gs.push({ conds: [defaultCond('maPrice')] }));
    await tick();
    const selects = root.querySelectorAll<HTMLSelectElement>('select[aria-label$=" 종류"]');
    selects[selects.length - 1]?.focus();
  }
</script>

<div class="groups" bind:this={root}>
  {#each groups as group, gi (gi)}
    {#if gi > 0}<p class="or" aria-hidden="true">또는</p>{/if}
    <CondGroupCard
      {group}
      index={gi}
      {prefix}
      {allowPattern}
      {patternTaken}
      update={(fn) => update((gs) => fn(gs[gi]))}
      onremove={() => update((gs) => void gs.splice(gi, 1))}
    />
  {/each}
  <button type="button" class="act" disabled={full} onclick={addGroup}>＋ 또는 묶음</button>
  {#if full}<p class="hint">묶음은 {MAX_GROUPS}개까지예요</p>{/if}
</div>

<style>
  .groups {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .or {
    text-align: center;
    color: var(--t2);
    margin: 0;
  }
</style>
