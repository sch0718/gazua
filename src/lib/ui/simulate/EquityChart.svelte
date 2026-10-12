<script lang="ts">
  // 자산 곡선(스펙 7.4-3): 전략·보유·지정 종목·지수를 초기 자금 대비 수익률(%)로. 크로스헤어로 그날 값을 보인다.
  import { onMount } from 'svelte';
  import {
    ColorType,
    createChart,
    CrosshairMode,
    LineSeries,
    LineStyle,
    type MouseEventParams,
    type Time,
  } from 'lightweight-charts';
  import type { SimResult } from '../../sim/types';
  import { fmtReturnPct } from './simText';

  type Row = SimResult['equity'][number];
  type Key = 'strategy' | 'hold' | 'benchmark' | 'index';

  let {
    equity,
    initial,
    labels,
  }: { equity: Row[]; initial: number; labels: { benchmark: string | null; index: string } } = $props();

  // 색: 전략 = 슬롯 7(굵게), 보유 = 회색, 지정 종목 = 슬롯 1 점선, 지수 = 슬롯 2 점선
  const LINES: { key: Key; color: [string, string]; width: 1 | 2; dashed: boolean }[] = [
    { key: 'strategy', color: ['--s7', '#2a78d6'], width: 2, dashed: false },
    { key: 'hold', color: ['--t3', '#676d77'], width: 1, dashed: false },
    { key: 'benchmark', color: ['--s1', '#eb6834'], width: 1, dashed: true },
    { key: 'index', color: ['--s2', '#1baf7a'], width: 1, dashed: true },
  ];

  const pct = (v: number) => (v / initial - 1) * 100;
  const shown = $derived(LINES.filter((l) => equity.some((e) => e[l.key] !== null)));
  const name = (k: Key) => ({ strategy: '내 전략', hold: '같은 종목 보유', benchmark: labels.benchmark ?? '', index: labels.index })[k];

  let el: HTMLDivElement;
  let hover = $state<string | null>(null);
  const row = $derived(equity.find((e) => e.date === hover) ?? equity.at(-1) ?? null);

  onMount(() => {
    const cs = getComputedStyle(document.documentElement);
    const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
    const c = createChart(el, {
      width: el.clientWidth,
      height: el.clientHeight,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: v('--t3', '#676d77'), fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { color: v('--grid', 'rgba(17,19,23,.07)') } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
      crosshair: { mode: CrosshairMode.Normal, horzLine: { visible: false, labelVisible: false } },
      handleScroll: { mouseWheel: false, vertTouchDrag: false },
      handleScale: { mouseWheel: false },
      localization: { locale: 'ko-KR', priceFormatter: (p: number) => fmtReturnPct(p, true) },
    });
    c.subscribeCrosshairMove((p: MouseEventParams<Time>) => (hover = typeof p.time === 'string' ? p.time : null));
    const observer = new ResizeObserver(() => c.resize(el.clientWidth, el.clientHeight));
    observer.observe(el);
    for (const l of shown) {
      const s = c.addSeries(LineSeries, {
        color: v(l.color[0], l.color[1]),
        lineWidth: l.width,
        lineStyle: l.dashed ? LineStyle.Dashed : LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerRadius: 3,
      });
      s.setData(equity.flatMap((e) => (e[l.key] === null ? [] : [{ time: e.date as Time, value: pct(e[l.key]!) }])));
    }
    c.timeScale().fitContent();
    return () => {
      observer.disconnect();
      c.remove();
    };
  });
</script>

<div class="equity">
  {#if row}
    <dl class="legend">
      <dt class="date">{row.date.replaceAll('-', '.')}</dt>
      {#each shown as l (l.key)}
        <dd><i style:background="var({l.color[0]})"></i>{name(l.key)} <b class="num">{row[l.key] === null ? '—' : fmtReturnPct(pct(row[l.key]!), true)}</b></dd>
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
    font-size: 12px;
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
  .legend i {
    width: 10px;
    height: 3px;
    border-radius: 2px;
  }
  .legend b {
    color: var(--t1);
    font-weight: 600;
  }
  .plot {
    height: 220px;
  }
</style>
