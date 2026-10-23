<script lang="ts" module>
  export interface PerfLine {
    key: 'actual' | 'virtual' | 'invested';
    /** [CSS 변수, 대체 색(라이트 토큰 값)] */
    color: [string, string];
    width: number;
    dashed: boolean;
  }
  // 내 계좌 = 강조색 굵게(시뮬레이션의 내 전략과 같다), 벤치마크 = 회색 실선, 넣은 돈 = 진한 회색 점선.
  export const PERF_LINES: PerfLine[] = [
    { key: 'actual', color: ['--accent', '#5b47e0'], width: 2, dashed: false },
    { key: 'virtual', color: ['--t3', '#676d77'], width: 2, dashed: false },
    { key: 'invested', color: ['--t2', '#5b6069'], width: 1.5, dashed: true },
  ];
</script>

<script lang="ts">
  // 내 성과 곡선(스펙 4.3-3): 평가금액 + 회수액(원), 실제와 가상, 그리고 넣은 돈. 크로스헤어로 그날 값을 보인다.
  import { onMount } from 'svelte';
  import {
    ColorType,
    createChart,
    CrosshairMode,
    LineSeries,
    LineStyle,
    type IChartApi,
    type ISeriesApi,
    type LineWidth,
    type MouseEventParams,
    type Time,
  } from 'lightweight-charts';
  import type { CurvePoint } from '../../perf/types';
  import LineSwatch from '../simulate/LineSwatch.svelte';
  import { dotDate } from '../simulate/simText';
  import { fmtWon } from '../format';
  import { axisWon } from './perfText';

  let { curve, benchName, theme }: { curve: CurvePoint[]; benchName: string; theme?: string } = $props();

  const names = $derived({ actual: '내 계좌', virtual: benchName, invested: '넣은 돈' });

  let el: HTMLDivElement;
  let hover = $state<string | null>(null);
  let showTable = $state(false);
  const point = $derived(curve.find((p) => p.date === hover) ?? curve.at(-1));

  let chart = $state.raw<IChartApi | null>(null);
  let series: { line: PerfLine; s: ISeriesApi<'Line'> }[] = [];

  function token(name: string, fallback: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }
  const chartColors = () => ({
    layout: { textColor: token('--t3', '#676d77') },
    grid: { horzLines: { color: token('--grid', 'rgba(17,19,23,.07)') } },
  });

  // 데이터가 바뀌면(벤치마크·기간) 선만 다시 넣는다
  $effect(() => {
    const c = chart;
    const pts = curve;
    if (!c) return;
    for (const { line, s } of series) s.setData(pts.map((p) => ({ time: p.date as Time, value: p[line.key] })));
    c.timeScale().fitContent();
  });

  $effect(() => {
    void theme;
    const c = chart;
    if (!c) return;
    c.applyOptions(chartColors());
    for (const { line, s } of series) s.applyOptions({ color: token(...line.color) });
  });

  onMount(() => {
    const colors = chartColors();
    const c = createChart(el, {
      width: el.clientWidth,
      height: el.clientHeight,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: colors.layout.textColor, fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: colors.grid.horzLines },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: { borderVisible: false },
      crosshair: { mode: CrosshairMode.Normal, horzLine: { visible: false, labelVisible: false } },
      handleScroll: { mouseWheel: false, vertTouchDrag: false },
      handleScale: { mouseWheel: false },
      localization: { locale: 'ko-KR', priceFormatter: (p: number) => axisWon(p) },
    });
    c.subscribeCrosshairMove((p: MouseEventParams<Time>) => (hover = typeof p.time === 'string' ? p.time : null));
    const observer = new ResizeObserver(() => c.resize(el.clientWidth, el.clientHeight));
    observer.observe(el);
    series = PERF_LINES.map((line) => ({
      line,
      s: c.addSeries(LineSeries, {
        color: token(...line.color),
        // LWC 타입은 정수 굵기만 받지만 선 그리기는 소수 굵기도 그대로 쓴다
        lineWidth: line.width as LineWidth,
        lineStyle: line.dashed ? LineStyle.Dashed : LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerRadius: 3,
      }),
    }));
    chart = c;
    return () => {
      observer.disconnect();
      chart = null;
      series = [];
      c.remove();
    };
  });
</script>

<div class="perf-chart">
  {#if point}
    <dl class="legend">
      <dt class="date">{dotDate(point.date)}</dt>
      {#each PERF_LINES as l (l.key)}
        <dd><LineSwatch line={l} />{names[l.key]} <b class="num">{axisWon(point[l.key])}</b></dd>
      {/each}
    </dl>
  {/if}
  <div class="plot" bind:this={el} role="group" aria-label="평가금액과 회수액 곡선"></div>
  <button type="button" class="table-toggle" aria-expanded={showTable} onclick={() => (showTable = !showTable)}>
    {showTable ? '표 닫기' : '표 보기'}
  </button>
  {#if showTable}
    <div class="table-wrap">
      <table>
        <caption class="sr-only">날짜별 평가금액과 회수액</caption>
        <thead>
          <tr><th scope="col">날짜</th><th scope="col">{names.actual}</th><th scope="col">{names.virtual}</th><th scope="col">{names.invested}</th></tr>
        </thead>
        <tbody>
          {#each curve as p (p.date)}
            <tr>
              <th scope="row">{dotDate(p.date)}</th>
              <td class="num">{fmtWon(Math.round(p.actual))}원</td>
              <td class="num">{fmtWon(Math.round(p.virtual))}원</td>
              <td class="num">{fmtWon(Math.round(p.invested))}원</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 12px;
    margin: 0 0 6px;
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  .legend .date {
    color: var(--t3);
  }
  .legend dd {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .legend b {
    color: var(--t1);
    font-weight: 600;
  }
  .plot {
    height: 240px;
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
  .table-toggle {
    min-height: var(--touch);
    padding: 0 12px;
    border-radius: 10px;
    color: var(--t2);
    font-size: var(--fs-sub);
  }
  .table-toggle:hover {
    background: var(--surface2);
  }
  .table-wrap {
    max-height: 320px;
    overflow: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-sub);
  }
  th,
  td {
    padding: 6px 8px;
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
    position: sticky;
    top: 0;
    background: var(--surface);
  }
</style>
