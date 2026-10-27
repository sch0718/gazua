<script lang="ts" module>
  import type { IndexAvailability } from '../lib/data/metricRegistry';
  import type { Period } from '../lib/state/schema';

  /** metricAvailability에 넘기는 지금 화면의 조건 */
  export interface MetricCtx {
    period: Period;
    index: IndexAvailability;
    hasShares: boolean;
  }
</script>

<script lang="ts">
  import { METRICS, metricAvailability } from '../lib/data/metricRegistry';
  import type { MetricId } from '../lib/state/schema';
  import { Sheet } from '@sch0718/ui-svelte';

  // 지표 선택 시트(스펙 7.3, 9-5·6): 고를 수 없는 지표는 비활성 + 이유, 고르면 바로 반영하고 닫는다.
  let {
    open,
    current,
    ctx,
    onselect,
    onclose,
  }: {
    open: boolean;
    current: MetricId;
    ctx: MetricCtx;
    onselect: (id: MetricId) => void;
    onclose: () => void;
  } = $props();

  /** 지표 모양을 보여 주는 고정 예시 그래프(44×22) */
  const SPARKS: Record<MetricId, string> = {
    change: '0,16 10,12 20,13 30,7 44,4',
    drawdown: '0,4 10,4 18,10 28,8 44,14',
    excess: '0,12 12,11 22,8 32,9 44,5',
    rvol: '0,16 10,15 18,6 26,13 44,12',
    mcap: '0,10 10,10 22,9 32,8 44,7',
    volatility: '0,11 8,6 16,15 26,5 44,12',
    rsi: '0,14 10,6 22,10 32,4 44,9',
  };

  const rows = $derived(METRICS.map((m) => ({ ...m, availability: metricAvailability(m.id, ctx) })));

  function pick(id: MetricId, ok: boolean) {
    if (!ok) return;
    onselect(id);
    onclose();
  }
</script>

<Sheet {open} title="비교 지표" {onclose}>
  <p class="sub">모든 종목을 같은 기준으로 한 축에 놓아요</p>
  {#each rows as m (m.id)}
    {@const on = m.id === current}
    <button
      type="button"
      class="mrow"
      class:on
      aria-pressed={on}
      aria-disabled={m.availability.ok ? undefined : 'true'}
      onclick={() => pick(m.id, m.availability.ok)}
    >
      <svg width="44" height="22" viewBox="0 0 44 22" aria-hidden="true">
        <polyline points={SPARKS[m.id]} fill="none" stroke={on ? 'var(--accent)' : 'var(--t3)'} stroke-width="1.6" />
      </svg>
      <span class="mi">
        <b>{m.label}</b>
        <span>{m.availability.ok ? m.description : m.availability.reason}</span>
      </span>
      {#if on}<b class="check" aria-hidden="true">✓</b>{/if}
    </button>
  {/each}
</Sheet>

<style>
  .sub {
    font-size: 13px;
    color: var(--t2);
    padding: 0 20px 10px;
  }
  .mrow {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 11px 20px;
    width: 100%;
    text-align: left;
    min-height: 56px;
  }
  .mrow:hover {
    background: var(--surface2);
  }
  .mi {
    flex: 1;
    min-width: 0;
  }
  .mi b {
    font-size: 15px;
    display: block;
  }
  .mi span {
    font-size: 12.5px;
    color: var(--t2);
  }
  .mrow.on {
    background: var(--accent-soft);
  }
  .mrow.on b {
    color: var(--accent);
  }
  .mrow[aria-disabled='true'] {
    opacity: 0.42;
    cursor: not-allowed;
  }
  .mrow[aria-disabled='true']:hover {
    background: none;
  }
  svg {
    flex: none;
  }
</style>
