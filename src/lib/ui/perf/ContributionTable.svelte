<script lang="ts">
  // 종목별 기여도(스펙 4.3-4): 실제 손익, 벤치마크 손익, 차이, 수량 대조. 행을 누르면 체결 목록이 펼쳐진다.
  // 좁은 화면은 종목·차이·대조 배지만 보이고 나머지 값은 펼친 줄에 둔다.
  import type { Reconciliation } from '../../perf/reconcile';
  import type { SymbolRow } from '../../perf/types';
  import { Badge } from '@sch0718/ui-svelte';
  import { fmtWon } from '../format';
  import { dotDate } from '../simulate/simText';
  import { irrText, RECONCILE_LABEL, signClass, signedWon } from './perfText';

  let { rows, reconcile }: { rows: SymbolRow[]; reconcile: Reconciliation } = $props();

  let open = $state<Record<string, boolean>>({});
  const idBase = `perf-row-${Math.random().toString(36).slice(2, 9)}`;
</script>

<div class="contrib">
  <div class="head" aria-hidden="true">
    <span>종목</span><span class="wide-only">내 손익</span><span class="wide-only">벤치마크</span><span>차이</span><span>수량</span>
  </div>
  <ul>
    {#each rows as r (r.symbol)}
      {@const rec = reconcile.bySymbol.get(r.symbol)}
      {@const status = rec?.status ?? 'unknown'}
      <li>
        <button
          type="button"
          class="row"
          aria-expanded={!!open[r.symbol]}
          aria-controls="{idBase}-{r.symbol}"
          onclick={() => (open[r.symbol] = !open[r.symbol])}
        >
          <span class="name">
            {r.name}
            {#if r.splitAdjusted}<Badge>분할 보정</Badge>{/if}
            {#if r.excessQty > 0}<Badge>초과 매도 {fmtWon(r.excessQty)}주</Badge>{/if}
          </span>
          <span class="num wide-only {signClass(r.actualProfit)}">{signedWon(r.actualProfit)}</span>
          <span class="num wide-only {signClass(r.virtualProfit)}">{signedWon(r.virtualProfit)}</span>
          <span class="num diff {signClass(r.diff)}">{signedWon(r.diff)}</span>
          <span class="rec" class:bad={status === 'more' || status === 'less'}>{RECONCILE_LABEL[status]}</span>
        </button>
        {#if open[r.symbol]}
          <div class="detail" id="{idBase}-{r.symbol}">
            <p class="facts">
              내 손익 <b class="num {signClass(r.actualProfit)}">{signedWon(r.actualProfit)}</b> · {r.benchName ?? '벤치마크 없음'}
              <b class="num {signClass(r.virtualProfit)}">{signedWon(r.virtualProfit)}</b> · 내 IRR <b class="num">{irrText(r.actualIrr)}</b>
              {#if rec && rec.held !== null}
                · 주문 합계 {fmtWon(rec.computed)}주 / 보유 {fmtWon(rec.held)}주
              {/if}
              {#if r.uncompared > 0}
                · 벤치마크와 비교 못 한 거래 {r.uncompared}건
              {/if}
            </p>
            {#if r.trades.length > 0}
              <table>
                <caption class="sr-only">{r.name} 체결 목록</caption>
                <thead>
                  <tr><th scope="col">날짜</th><th scope="col">구분</th><th scope="col">수량</th><th scope="col">체결가</th><th scope="col">금액</th></tr>
                </thead>
                <tbody>
                  {#each r.trades as t (t.orderId)}
                    <tr>
                      <th scope="row">{dotDate(t.date)}</th>
                      <td>{t.side === 'BUY' ? '매수' : '매도'}</td>
                      <td class="num">{fmtWon(t.qty)}주</td>
                      <td class="num">{fmtWon(t.price)}원</td>
                      <td class="num">{fmtWon(t.amount)}원</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {:else}
              <p class="facts">이 기간에는 체결이 없어요</p>
            {/if}
          </div>
        {/if}
      </li>
    {/each}
  </ul>
</div>

<style>
  .head,
  .row {
    display: grid;
    grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr) 5.5em;
    gap: 8px;
    align-items: center;
  }
  .head {
    padding: 0 10px 6px;
    color: var(--t3);
    font-size: var(--fs-label);
  }
  .head span:not(:first-child) {
    text-align: right;
  }
  .wide-only {
    display: none;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    border-top: 1px solid var(--line);
  }
  .row {
    width: 100%;
    min-height: var(--touch);
    padding: 8px 10px;
    text-align: left;
    border-radius: 10px;
    font-size: var(--fs-body);
  }
  .row:hover {
    background: var(--surface2);
  }
  .name {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
    min-width: 0;
  }
  .num {
    font-variant-numeric: tabular-nums;
    text-align: right;
    white-space: nowrap;
  }
  .rec {
    text-align: right;
    font-size: var(--fs-sub);
    color: var(--t3);
  }
  .rec.bad {
    color: var(--warn);
    font-weight: 600;
  }
  .up {
    color: var(--up);
  }
  .down {
    color: var(--down);
  }
  .detail {
    padding: 0 10px 12px;
  }
  .facts {
    margin: 0 0 8px;
    color: var(--t2);
    font-size: var(--fs-sub);
    line-height: 1.6;
  }
  .facts b {
    font-weight: 600;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-sub);
  }
  th,
  td {
    padding: 5px 6px;
    text-align: right;
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
  }
  th[scope='row'],
  thead th:first-child {
    text-align: left;
    font-weight: 500;
  }
  thead th {
    color: var(--t3);
    font-weight: 500;
  }
  @media (min-width: 600px) {
    .head,
    .row {
      grid-template-columns: minmax(0, 1.6fr) repeat(3, minmax(0, 1fr)) 5.5em;
    }
    .wide-only {
      display: block;
    }
  }
</style>
