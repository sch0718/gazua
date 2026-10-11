<script lang="ts" module>
  import { kstMinuteOfDay } from '../../time/kst';

  const HALF_HOUR = 30;

  /**
   * 표에 올릴 시각(오름차순, 중복 없음).
   * 1일(분봉)은 KST 매 30분 정각과 마지막 점, 일봉은 모든 봉.
   */
  export function tableTimes(all: number[], mode: 'intraday' | 'daily'): number[] {
    const sorted = [...new Set(all)].sort((a, b) => a - b);
    if (mode === 'daily' || sorted.length === 0) return sorted;
    const last = sorted[sorted.length - 1];
    return sorted.filter((t) => t === last || kstMinuteOfDay(t) % HALF_HOUR === 0);
  }
</script>

<script lang="ts">
  import type { ChartSeriesInput } from '../../chart/lineData';
  import { kstDate } from '../../time/kst';
  import { trendClass } from '../format';
  import { formatMetricValue, kstHHMM, monthDay, type MetricUnit } from './compareText';
  import { valueAt } from './rows';

  // 차트와 같은 값을 시각×종목 표로 보여 준다(스크린리더·정확한 값 확인용). 숨긴 종목은 뺀다.
  let {
    series,
    mode,
    unit,
    metricLabel,
    periodLabel,
    conv,
  }: {
    series: ChartSeriesInput[];
    mode: 'intraday' | 'daily';
    unit: MetricUnit;
    metricLabel: string;
    /** 캡션에 쓰는 기간(`1일`·`2주`) */
    periodLabel: string;
    conv: 'kr' | 'global';
  } = $props();

  let open = $state(false);
  const tableId = `data-table-${Math.random().toString(36).slice(2, 9)}`;

  const visible = $derived(series.filter((s) => !s.hidden));
  // 표가 닫혀 있으면 계산하지 않는다.
  const times = $derived(open ? tableTimes(visible.flatMap((s) => s.points.map((p) => p.t)), mode) : []);
  const timeLabel = (t: number) => (mode === 'intraday' ? kstHHMM(t) : monthDay(kstDate(t)));

  /** 1일은 거래가 없던 분에도 마지막 값을 잇고(차트와 같다), 일봉은 그 날의 값만 보인다. */
  function cell(s: ChartSeriesInput, t: number): { text: string; cls: string } {
    const v = mode === 'intraday' ? valueAt(s.points, t) : (s.points.find((p) => p.t === t)?.v ?? null);
    if (v === null) return { text: '—', cls: 'muted' };
    return { text: formatMetricValue(v, unit), cls: unit === '%' ? trendClass(v, conv) : '' };
  }
</script>

<div class="data-table">
  <button type="button" class="toggle" aria-expanded={open} aria-controls={tableId} onclick={() => (open = !open)}>표 보기</button>
  <div id={tableId} hidden={!open}>
    {#if open}
      {#if visible.length === 0}
        <p class="empty" role="status">차트에 보이는 종목이 없어요</p>
      {:else}
        <!-- 가로·세로로 넘치면 키보드로도 스크롤할 수 있어야 해서 tabindex를 둔다. -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div class="scroll" role="region" aria-label="{metricLabel} 표" tabindex="0">
          <table>
            <caption>{metricLabel} 표 · {periodLabel}</caption>
            <thead>
              <tr>
                <th scope="col">시각</th>
                {#each visible as s (s.id)}
                  <th scope="col"><i class="dot" style:background="var(--s{s.slot})" aria-hidden="true"></i>{s.label}</th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each times as t (t)}
                <tr>
                  <th scope="row" class="num">{timeLabel(t)}</th>
                  {#each visible as s (s.id)}
                    {@const c = cell(s, t)}
                    <td class="num {c.cls}">{c.text}</td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .data-table {
    padding: 2px var(--gutter) 6px;
  }
  .toggle {
    min-height: var(--touch);
    padding: 0 4px;
    font-size: 13px;
    font-weight: 700;
    color: var(--accent);
  }
  .toggle[aria-expanded='true']::after {
    content: ' ▴';
  }
  .toggle[aria-expanded='false']::after {
    content: ' ▾';
  }
  .scroll {
    max-height: 320px;
    overflow: auto;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--surface);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
  }
  caption {
    text-align: left;
    padding: 8px 12px;
    font-size: 12px;
    font-weight: 700;
    color: var(--t2);
  }
  th,
  td {
    padding: 7px 12px;
    text-align: right;
    white-space: nowrap;
    border-top: 1px solid var(--line);
  }
  thead th {
    position: sticky;
    top: 0;
    background: var(--surface2);
    color: var(--t2);
    font-weight: 700;
  }
  th:first-child {
    text-align: left;
    position: sticky;
    left: 0;
    background: var(--surface);
    color: var(--t2);
    font-weight: 600;
  }
  thead th:first-child {
    background: var(--surface2);
    z-index: 1;
  }
  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 6px;
  }
  .muted {
    color: var(--t3);
  }
  .empty {
    font-size: 13px;
    color: var(--t3);
    padding: 4px 0 8px;
  }
</style>
