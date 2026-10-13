<script lang="ts">
  // 거래 내역(스펙 7.4-5): 날짜 · 종목 · 사유, 매수는 수량@가격, 매도는 손익 %. 행을 누르면 거래 차트.
  import type { Trade } from '../../sim/types';
  import { fmtWon } from '../format';
  import { fmtReturnPct, returnClass, shortDate } from './simText';

  let {
    trades,
    names,
    onTrade,
  }: { trades: Trade[]; names: Record<string, string>; colorConvention: 'kr' | 'global'; onTrade: (t: Trade) => void } = $props();

  const isBuy = (t: Trade) => t.kind === 'buy' || t.kind === 'add';
  const why = (t: Trade) => (t.kind === 'buy' ? `${t.reason} 매수` : t.kind === 'add' ? '추가 매수' : t.reason);
  // 매도 손익: 부호는 ▲▼가 맡으므로 절댓값
  const pnl = (v: number) => (returnClass(v) === '' ? '0.0%' : `${v > 0 ? '▲' : '▼'}${fmtReturnPct(Math.abs(v))}`);
</script>

<ul class="rows" aria-label="거래 내역">
  {#each trades as t, i (i)}
    <li>
      <button type="button" onclick={() => onTrade(t)}>
        <span class="num date">{shortDate(t.date)}</span>
        <span class="name">{names[t.symbol] ?? t.symbol}</span>
        <span class="why">· {why(t)}</span>
        {#if isBuy(t)}
          <span class="why num">· {t.qty}주 @ {fmtWon(t.price)}</span>
        {:else if t.pnlPct !== undefined}
          <span class="why">·</span>
          <span class="num pnl {returnClass(t.pnlPct)}">{pnl(t.pnlPct)}</span>
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
    flex-wrap: wrap;
    gap: 2px 6px;
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
    font-weight: 600;
  }
</style>
