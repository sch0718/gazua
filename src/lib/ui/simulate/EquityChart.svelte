<script lang="ts" module>
  export type EquityKey = 'strategy' | 'hold' | 'benchmark' | 'index';
  export interface EquityLine {
    key: EquityKey;
    /** [CSS 변수, 대체 색(라이트 토큰 값)] */
    color: [string, string];
    width: number;
    dashed: boolean;
  }

  // 색(스펙 7.4-3): 전략 = 강조색 굵게(파랑 슬롯 7은 하락색으로 읽혀서), 보유 = 회색 실선,
  // 지정 종목 = --line-bench 굵은 점선(슬롯 1 --s1은 라이트 --bg 위 2.99:1이라 따로 둔 진한 주황), 지수 = 진한 회색 점선.
  // 얇은 점선은 밝은 배경에서 3:1이 안 나와 굵기를 올렸다.
  export const EQUITY_LINES: EquityLine[] = [
    { key: 'strategy', color: ['--accent', '#5b47e0'], width: 2, dashed: false },
    { key: 'hold', color: ['--t3', '#676d77'], width: 1, dashed: false },
    { key: 'benchmark', color: ['--line-bench', '#d95926'], width: 2, dashed: true },
    { key: 'index', color: ['--t2', '#5b6069'], width: 1.5, dashed: true },
  ];
</script>

<script lang="ts">
  // 자산 곡선(스펙 7.4-3): 전략·보유·지정 종목·지수를 초기 자금 대비 수익률(%)로. 크로스헤어로 그날 값을 보인다.
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
  import type { SimResult } from '../../sim/types';
  import LineSwatch from './LineSwatch.svelte';
  import { fmtReturnPct } from './simText';

  type Row = SimResult['equity'][number];

  let {
    equity,
    initial,
    labels,
    theme,
  }: {
    equity: Row[];
    initial: number;
    labels: { benchmark: string | null; index: string };
    /** 바뀌면 CSS 변수에서 색을 다시 읽는다(CompareChart와 같은 방식) */
    theme?: string;
  } = $props();

  const pct = (v: number) => (v / initial - 1) * 100;
  const shown = $derived(EQUITY_LINES.filter((l) => equity.some((e) => e[l.key] !== null)));
  const name = (k: EquityKey) => ({ strategy: '내 전략', hold: '같은 종목 사서 보유', benchmark: labels.benchmark ?? '', index: labels.index })[k];

  let el: HTMLDivElement;
  let hover = $state<string | null>(null);
  const row = $derived(equity.find((e) => e.date === hover) ?? equity.at(-1) ?? null);

  let chart = $state.raw<IChartApi | null>(null);
  let lines: { line: EquityLine; series: ISeriesApi<'Line'> }[] = [];

  function token(name: string, fallback: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }
  const chartColors = () => ({
    layout: { textColor: token('--t3', '#676d77') },
    grid: { horzLines: { color: token('--grid', 'rgba(17,19,23,.07)') } },
  });

  // 테마가 바뀌면 색만 다시 넣는다(시리즈는 그대로)
  $effect(() => {
    void theme;
    const c = chart;
    if (!c) return;
    c.applyOptions(chartColors());
    for (const { line, series } of lines) series.applyOptions({ color: token(...line.color) });
  });

  onMount(() => {
    const colors = chartColors();
    const c = createChart(el, {
      width: el.clientWidth,
      height: el.clientHeight,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: colors.layout.textColor, fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: colors.grid.horzLines },
      // 맨 위 y 라벨(+30.0%)이 잘리지 않게 위 여백
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: { borderVisible: false },
      crosshair: { mode: CrosshairMode.Normal, horzLine: { visible: false, labelVisible: false } },
      handleScroll: { mouseWheel: false, vertTouchDrag: false },
      handleScale: { mouseWheel: false },
      localization: { locale: 'ko-KR', priceFormatter: (p: number) => fmtReturnPct(p, true) },
    });
    c.subscribeCrosshairMove((p: MouseEventParams<Time>) => (hover = typeof p.time === 'string' ? p.time : null));
    const observer = new ResizeObserver(() => c.resize(el.clientWidth, el.clientHeight));
    observer.observe(el);
    lines = shown.map((l) => {
      const s = c.addSeries(LineSeries, {
        color: token(...l.color),
        // LWC 타입은 정수 굵기만 받지만 선 그리기는 소수 굵기도 그대로 쓴다(지수 1.5)
        lineWidth: l.width as LineWidth,
        lineStyle: l.dashed ? LineStyle.Dashed : LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerRadius: 3,
      });
      s.setData(equity.flatMap((e) => (e[l.key] === null ? [] : [{ time: e.date as Time, value: pct(e[l.key]!) }])));
      return { line: l, series: s };
    });
    c.timeScale().fitContent();
    chart = c;
    return () => {
      observer.disconnect();
      chart = null;
      lines = [];
      c.remove();
    };
  });
</script>

<div class="equity">
  {#if row}
    <dl class="legend">
      <dt class="date">{row.date.replaceAll('-', '.')}</dt>
      {#each shown as l (l.key)}
        <dd><LineSwatch line={l} />{name(l.key)} <b class="num">{row[l.key] === null ? '—' : fmtReturnPct(pct(row[l.key]!), true)}</b></dd>
      {/each}
    </dl>
  {/if}
  <div class="plot" bind:this={el} role="group" aria-label="자산 곡선"></div>
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
    height: 220px;
  }
</style>
