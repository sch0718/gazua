<script lang="ts">
  import type { Period } from '../../state/schema';
  import { freshnessText, headlineLabel } from './compareText';

  // 헤드라인(스펙 7.2-2)과 신선도 줄(4.4).
  let {
    period,
    metricLabel,
    scrubT,
    tradingDate,
    today,
    baseDate,
    now,
    inSession,
    closeAt,
    anyStale,
    loadFailed = false,
    lastOkAt = null,
  }: {
    period: Period;
    metricLabel: string;
    scrubT: number | null;
    tradingDate: string | null;
    today: string;
    baseDate: string | null;
    now: number;
    inSession: boolean;
    closeAt: number | null;
    anyStale: boolean;
    /** 마지막 로딩이 모두 실패했다(● 실시간을 감춘다) */
    loadFailed?: boolean;
    lastOkAt?: number | null;
  } = $props();

  const label = $derived(headlineLabel({ period, metricLabel, scrubT, tradingDate, today, baseDate }));
  const fresh = $derived(freshnessText({ now, inSession, tradingDate, today, closeAt, anyStale, loadFailed, lastOkAt }));
</script>

<div class="head">
  <div class="k">{label}</div>
  {#if fresh.text}
    <div class="fresh num">
      {#if fresh.live}<span class="live" aria-hidden="true">●</span>{:else}<span aria-hidden="true">◌</span>{/if}
      {fresh.text}
    </div>
  {/if}
</div>

<style>
  .head {
    padding: 2px var(--gutter) 0;
  }
  .k {
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  .fresh {
    font-size: 12.5px;
    color: var(--t2);
    margin-top: 2px;
  }
  .live {
    color: var(--ok);
    font-size: 9px;
    vertical-align: 1px;
  }
</style>
