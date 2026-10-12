<script lang="ts">
  // 거래 내역(임시): 날짜 · 종목 · 사유, 매도 행은 손익 %. Task 12의 TradeList가 대신한다.
  import type { Trade } from '../../sim/types';
  import { trendClass } from '../format';
  import { shortDate, trendReturn } from './simText';

  let {
    trades,
    names,
    colorConvention,
    onTrade,
  }: { trades: Trade[]; names: Record<string, string>; colorConvention: 'kr' | 'global'; onTrade: (t: Trade) => void } = $props();

  const what = (t: Trade) => (t.kind === 'buy' ? `${t.reason} 매수` : t.kind === 'add' ? `${t.reason} 추가 매수` : t.reason);
</script>

<ul class="rows" aria-label="거래 내역">
  {#each trades as t, i (i)}
    <li>
      <button type="button" onclick={() => onTrade(t)}>
        <span class="num date">{shortDate(t.date)}</span>
        <span class="name">{names[t.symbol] ?? t.symbol}</span>
        <span class="why">· {what(t)}</span>
        {#if t.pnlPct !== undefined}
          <span class="num pnl {trendClass(t.pnlPct, colorConvention)}">{trendReturn(t.pnlPct)}</span>
        {/if}
      </button>
    </li>
  {/each}
</ul>

<style>
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  button {
    display: flex;
    gap: 6px;
    width: 100%;
    min-height: 44px;
    align-items: center;
    text-align: left;
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
    color: var(--t2);
  }
  .pnl {
    margin-left: auto;
    font-weight: 600;
  }
</style>
