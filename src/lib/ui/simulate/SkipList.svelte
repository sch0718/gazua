<script lang="ts">
  // 건너뛴 신호 목록: 날짜 · 종목 · 사유
  import type { Skip } from '../../sim/types';
  import { dotDate, skipReasonLabel } from './simText';

  let { skipped, names, counts }: { skipped: Skip[]; names: Record<string, string>; counts?: [Skip['reason'], number][] } = $props();
</script>

{#if counts}
  <ul class="rows" aria-label="건너뛴 이유">
    {#each counts as [reason, n] (reason)}
      <li><span class="why">{skipReasonLabel(reason)}</span> <span class="num">{n}번</span></li>
    {/each}
  </ul>
  <p class="none">목록은 크기 때문에 빼고 보냈어요</p>
{:else if skipped.length === 0}
  <p class="none">건너뛴 신호가 없어요</p>
{:else}
  <ul class="rows" aria-label="건너뛴 신호">
    {#each skipped as k, i (i)}
      <li>
        <span class="num date">{dotDate(k.date)}</span>
        <span class="name">{names[k.symbol] ?? k.symbol}</span>
        <span class="why">{skipReasonLabel(k.reason)}</span>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .none {
    margin: 0;
    padding: 10px 0;
    font-size: var(--fs-body);
    color: var(--t2);
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    gap: 10px;
    padding: 10px 0;
    border-bottom: 1px solid var(--line);
    font-size: var(--fs-body);
  }
  .date {
    color: var(--t3);
  }
  .name {
    font-weight: 600;
  }
  .why {
    margin-left: auto;
    color: var(--t2);
  }
</style>
