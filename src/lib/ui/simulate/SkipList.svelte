<script lang="ts">
  // 건너뛴 신호 목록: 날짜 · 종목 · 사유
  import type { Skip } from '../../sim/types';
  import { dotDate } from './simText';

  let { skipped, names }: { skipped: Skip[]; names: Record<string, string> } = $props();
</script>

<ul class="rows" aria-label="건너뛴 신호">
  {#each skipped as k, i (i)}
    <li>
      <span class="num date">{dotDate(k.date)}</span>
      <span class="name">{names[k.symbol] ?? k.symbol}</span>
      <span class="why">{k.reason}</span>
    </li>
  {/each}
</ul>

<style>
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
    font-size: 14px;
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
