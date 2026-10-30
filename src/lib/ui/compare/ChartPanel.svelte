<script lang="ts">
  import CompareChart from '../../chart/CompareChart.svelte';
  import type { ChartSeriesInput } from '../../chart/lineData';
  import type { DaySession } from '../../market/sessions';

  // 차트 + 세션 레인 + 범례(스펙 5.4) + 첫 로딩 진행률.
  let {
    series,
    mode,
    sessions,
    markers,
    unit,
    openDays,
    progress,
    theme,
    oncrosshair,
  }: {
    series: ChartSeriesInput[];
    mode: 'intraday' | 'daily';
    sessions: DaySession[];
    markers: boolean;
    unit: '%' | 'x' | '조';
    openDays: string[];
    progress: { done: number; total: number } | null;
    theme?: string;
    oncrosshair: (t: number | null) => void;
  } = $props();
  let chartRef = $state<ReturnType<typeof CompareChart>>();
  export function screenshot(): HTMLCanvasElement | null {
    return chartRef?.screenshot() ?? null;
  }

</script>

<div class="panel">
  {#if progress}
    <div class="loading num" role="status">불러오는 중 {progress.done}/{progress.total}</div>
  {/if}
  <div class="chart">
    <CompareChart bind:this={chartRef} {series} {mode} {sessions} {markers} {unit} {openDays} {theme} directLabels {oncrosshair} />
  </div>
  <div class="legend">
    {#if mode === 'intraday'}
      <span><i class="sw hatch" aria-hidden="true"></i>거래 불가</span>
      <span><i class="sw auction" aria-hidden="true"></i>단일가</span>
      <span><i class="sw dotted" aria-hidden="true"></i>거래 없음(마지막 값 유지)</span>
    {:else}
      {#if markers}<span>● 봉이 적어 점으로 표시</span>{/if}
      <span><i class="sw hatch" aria-hidden="true"></i>거래정지</span>
      <span><i class="sw dotted" aria-hidden="true"></i>거래 없음</span>
      <span>휴장일은 축에서 빼요</span>
    {/if}
  </div>
</div>

<style>
  .panel {
    position: relative;
    padding: 6px 0 0 var(--gutter);
    min-width: 0;
  }
  @media (min-width: 600px) {
    .panel {
      padding: 6px 12px 0 var(--gutter);
    }
  }
  /* 높이를 고정하지 않고 최소 높이로 둔다. 차트(최소 260px) 아래 세션 레인이 종목 수만큼 늘어나므로,
     종목이 많은 좁은 폰(360×780에서 10종목이면 260 + 109px > 45dvh)에서는 이 칸이 함께 늘어나 범례와 겹치지 않는다. */
  .chart {
    display: flex;
    flex-direction: column;
    min-height: max(260px, 45vh);
    min-height: max(260px, 45dvh);
    touch-action: pan-y;
    user-select: none;
    -webkit-user-select: none;
  }
  /* PC(레일·사이드가 보이는 폭)는 차트를 더 높게 쓴다. 위의 머리말·조작 줄과 아래 범례(약 320px)를 빼고 남는 높이까지만 써서
     노트북 화면(768px)에서도 범례가 화면 안에 들어오게 한다. */
  @media (min-width: 1024px) {
    .chart {
      min-height: max(360px, min(62vh, 100vh - 320px));
      min-height: max(360px, min(62dvh, 100dvh - 320px));
    }
  }
  .loading {
    position: absolute;
    top: 10px;
    left: var(--gutter);
    z-index: 3;
    font-size: 12px;
    font-weight: 700;
    color: var(--t2);
    background: var(--surface2);
    padding: 4px 10px;
    border-radius: var(--r-chip);
  }
  .legend {
    display: flex;
    gap: 14px;
    flex-wrap: wrap;
    padding: 4px 0 2px;
    font-size: 11.5px;
    color: var(--t3);
  }
  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .sw {
    width: 14px;
    height: 8px;
    border-radius: 2px;
    display: inline-block;
  }
  .sw.hatch {
    background: repeating-linear-gradient(135deg, var(--hatch) 0 1.5px, transparent 1.5px 4px);
    outline: 1px solid var(--line);
  }
  .sw.auction {
    background: repeating-linear-gradient(90deg, var(--hatch) 0 1px, transparent 1px 3px);
    outline: 1px solid var(--line);
  }
  .sw.dotted {
    height: 0;
    border-top: 2px dotted var(--t3);
    border-radius: 0;
    width: 16px;
  }
</style>
