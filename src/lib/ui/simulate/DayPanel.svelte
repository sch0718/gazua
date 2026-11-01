<script lang="ts">
  // 그날 상황(설계 §4.4): 머리(날짜·총자산·현금·수익률) · 보유 카드 · 예약 매수 · 그날 체결 · 그날 건너뜀.
  // motion이면(하루만 움직였을 때) 새 보유 카드·새 체결 줄이 150ms 떠오른다. 아니면 duration 0이라 효과 없이 값만 바뀐다.
  // Svelte 5 전환은 기본이 local이라 {#if}/{:else} 분기가 새로 생길 때(보유 0→1, 체결 0→n) 돌지 않는다. 그래서 |global로 건다.
  import { fly } from 'svelte/transition';
  import type { DayFrame, Skip, Strategy, Trade } from '../../sim/types';
  import { fmtWon } from '../format';
  import HoldingCard from './HoldingCard.svelte';
  import { NO_HOLDINGS, pendingSellText, pendingText, replayDate, returnClass, skipReasonLabel, tradeWhy, trendReturn } from './simText';

  let {
    frame,
    trades,
    skipped,
    names,
    initial,
    strategy,
    motion = false,
  }: {
    frame: DayFrame;
    /** 그날 체결만 */
    trades: Trade[];
    /** 그날 건너뜀만 */
    skipped: Skip[];
    names: Record<string, string>;
    initial: number;
    strategy: Strategy;
    motion?: boolean;
  } = $props();

  const nameOf = (s: string) => names[s] ?? s;
  const ret = $derived((frame.value / initial - 1) * 100);
  const cashPct = $derived(frame.value > 0 ? Math.round((frame.cash / frame.value) * 100) : 0);
  const rise = $derived({ y: 8, duration: motion ? 150 : 0 });
  // 사유별로 종목 이름을 모은다: `현금이 모자랐어요 · SK하이닉스, 삼성전자`
  const skipGroups = $derived.by(() => {
    const by = new Map<Skip['reason'], string[]>();
    for (const k of skipped) {
      const list = by.get(k.reason) ?? [];
      const n = nameOf(k.symbol);
      if (!list.includes(n)) list.push(n);
      by.set(k.reason, list);
    }
    return [...by].map(([reason, list]) => ({ reason, text: `${skipReasonLabel(reason)} · ${list.join(', ')}` }));
  });
</script>

<section class="day" aria-label="그날 상황" tabindex="-1">
  <p class="when num">{replayDate(frame.date)}</p>
  <ul class="totals" aria-label="그날 자산">
    <li><span class="label">총자산</span> <b class="num">{fmtWon(frame.value)}원</b></li>
    <li><span class="label">현금</span> <b class="num">{fmtWon(frame.cash)}원 ({cashPct}%)</b></li>
    <li><span class="label">그날까지 수익률</span> <b class="num {returnClass(ret)}">{trendReturn(ret)}</b></li>
  </ul>

  {#if frame.holdings.length === 0}
    <p class="empty">{NO_HOLDINGS}</p>
  {:else}
    <ul class="cards" aria-label="보유 종목">
      {#each frame.holdings as h (h.symbol)}
        <li in:fly|global={rise}><HoldingCard {h} name={nameOf(h.symbol)} stopOn={strategy.rules.sell.stopLoss.on} timeExitDays={strategy.rules.sell.timeExit.on ? strategy.rules.sell.timeExit.days : null} {motion} /></li>
      {/each}
    </ul>
  {/if}

  {#if frame.pendingSells.length > 0}
    <ul class="lines" aria-label="다음 거래일 매도 예약">
      {#each frame.pendingSells as p (p.symbol)}<li>{pendingSellText(nameOf(p.symbol), p.reason)}</li>{/each}
    </ul>
  {/if}
  {#if frame.pending.length > 0}
    <ul class="lines" aria-label="예약 매수">
      {#each frame.pending as p (p.symbol)}<li>{pendingText(nameOf(p.symbol), p.reason)}</li>{/each}
    </ul>
  {/if}
  {#if trades.length > 0}
    <ul class="lines" aria-label="그날 체결">
      {#each trades as t (t)}
        <li in:fly|global={rise}><b>{nameOf(t.symbol)}</b> · {tradeWhy(t)} · <span class="num">{fmtWon(t.qty)}주 · {fmtWon(t.price)}원</span></li>
      {/each}
    </ul>
  {/if}
  {#if skipGroups.length > 0}
    <ul class="lines" aria-label="그날 건너뜀">
      {#each skipGroups as g (g.reason)}<li>{g.text}</li>{/each}
    </ul>
  {/if}
</section>

<style>
  .day {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .when {
    margin: 0;
    font-weight: 700;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .totals {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    font-size: var(--fs-sub);
  }
  .label {
    color: var(--t3);
  }
  /* 보유 카드는 한 줄에 하나 */
  .cards {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .lines {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  .lines b {
    color: var(--t1);
  }
  .empty {
    margin: 0;
    color: var(--t2);
  }
</style>
