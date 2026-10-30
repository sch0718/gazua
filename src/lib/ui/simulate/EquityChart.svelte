<script lang="ts" module>
  export type EquityKey = 'strategy' | 'hold' | 'benchmark' | 'index';
  export interface EquityLine {
    key: EquityKey;
    /** [CSS 변수, 대체 색(라이트 토큰 값)] */
    color: [string, string];
    width: number;
    dashed: boolean;
  }

  /** 곡선 여러 개를 직접 넘길 때(선정 기준 검증). value는 평가액이라 initial로 수익률(%)을 낸다 */
  export interface CurveLine {
    id: string;
    name: string;
    color: [string, string];
    width: number;
    dashed: boolean;
    points: { date: string; value: number }[];
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
    equity = [],
    initial,
    labels = { benchmark: null, index: '' },
    theme,
    curves,
    rebalanceDates,
    sampledNote,
  }: {
    equity?: Row[];
    initial: number;
    labels?: { benchmark: string | null; index: string };
    /** 바뀌면 CSS 변수에서 색을 다시 읽는다(CompareChart와 같은 방식) */
    theme?: string;
    /** 주면 equity 대신 이 곡선들을 그리고, 범례가 켜고 끄는 버튼이 된다 */
    curves?: CurveLine[];
    /** 재선정일: 세로 눈금으로 표시한다 */
    rebalanceDates?: string[];
    /** 곡선을 솎은 공유의 안내 */
    sampledNote?: string;
  } = $props();

  const pct = (v: number) => (v / initial - 1) * 100;
  const name = (k: EquityKey) => ({ strategy: '내 전략', hold: '같은 종목 사서 보유', benchmark: labels.benchmark ?? '', index: labels.index })[k];

  // 그릴 선을 한 모양으로 맞춘다: 기존 4선(equity)이든 곡선 여러 개(curves)든
  interface Item {
    id: string;
    name: string;
    line: Pick<EquityLine, 'color' | 'width' | 'dashed'>;
    points: { date: string; value: number }[];
  }
  const items = $derived<Item[]>(
    curves
      ? curves.filter((c) => c.points.length > 0).map((c) => ({ id: c.id, name: c.name, line: c, points: c.points.map((p) => ({ date: p.date, value: pct(p.value) })) }))
      : EQUITY_LINES.filter((l) => equity.some((e) => e[l.key] !== null)).map((l) => ({
          id: l.key,
          name: name(l.key),
          line: l,
          points: equity.flatMap((e) => (e[l.key] === null ? [] : [{ date: e.date, value: pct(e[l.key]!) }])),
        })),
  );
  const toggles = $derived(curves !== undefined);

  let el: HTMLDivElement;
  let hover = $state<string | null>(null);
  const lastDate = $derived(curves ? items.reduce((m, i) => (i.points.at(-1)!.date > m ? i.points.at(-1)!.date : m), '') : (equity.at(-1)?.date ?? ''));
  const date = $derived(curves ? (hover && items.some((i) => i.points.some((p) => p.date === hover)) ? hover : lastDate) : (equity.find((e) => e.date === hover)?.date ?? lastDate));
  const valueAt = (i: Item): number | null => i.points.find((p) => p.date === date)?.value ?? null;

  // 범례 버튼으로 끈 선(곡선 여러 개일 때만)
  let off = $state<Record<string, boolean>>({});
  let ticks = $state.raw<number[]>([]);

  let chart = $state.raw<IChartApi | null>(null);
  let lines: { id: string; line: Item['line']; series: ISeriesApi<'Line'> }[] = [];

  function placeTicks() {
    const ts = chart?.timeScale();
    if (!ts || !rebalanceDates) return;
    ticks = rebalanceDates.flatMap((d) => {
      const x = ts.timeToCoordinate(d as Time);
      return x === null ? [] : [x];
    });
  }

  $effect(() => {
    void chart; // 시리즈가 만들어진 뒤에 한 번 더 돈다
    for (const l of lines) l.series.applyOptions({ visible: !off[l.id] });
  });

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
    const observer = new ResizeObserver(() => {
      c.resize(el.clientWidth, el.clientHeight);
      placeTicks();
    });
    observer.observe(el);
    lines = items.map((it) => {
      const l = it.line;
      const s = c.addSeries(LineSeries, {
        color: token(...l.color),
        // LWC 타입은 정수 굵기만 받지만 선 그리기는 소수 굵기도 그대로 쓴다(지수 1.5)
        lineWidth: l.width as LineWidth,
        lineStyle: l.dashed ? LineStyle.Dashed : LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerRadius: 3,
      });
      s.setData(it.points.map((p) => ({ time: p.date as Time, value: p.value })));
      return { id: it.id, line: l, series: s };
    });
    c.timeScale().fitContent();
    chart = c;
    if (rebalanceDates) {
      c.timeScale().subscribeVisibleLogicalRangeChange(placeTicks);
      placeTicks();
    }
    return () => {
      if (rebalanceDates) c.timeScale().unsubscribeVisibleLogicalRangeChange(placeTicks);
      observer.disconnect();
      chart = null;
      lines = [];
      c.remove();
    };
  });
</script>

<div class="equity">
  {#if date}
    <dl class="legend">
      <dt class="date">{date.replaceAll('-', '.')}</dt>
      {#each items as it (it.id)}
        {@const v = valueAt(it)}
        <dd>
          {#if toggles}
            <button type="button" class="tog" aria-pressed={!off[it.id]} onclick={() => (off[it.id] = !off[it.id])}>
              <LineSwatch line={it.line} />{it.name} <b class="num">{v === null ? '—' : fmtReturnPct(v, true)}</b>
            </button>
          {:else}
            <LineSwatch line={it.line} />{it.name} <b class="num">{v === null ? '—' : fmtReturnPct(v, true)}</b>
          {/if}
        </dd>
      {/each}
    </dl>
  {/if}
  <div class="plotbox">
    <div class="plot" bind:this={el} role="group" aria-label="자산 곡선"></div>
    {#if rebalanceDates}
      <div class="ticks" aria-hidden="true">
        {#each ticks as x, i (i)}<i data-rebalance-tick style:left="{x}px"></i>{/each}
      </div>
    {/if}
  </div>
  {#if sampledNote}<p class="sampled">{sampledNote}</p>{/if}
</div>

<style>
  .sampled {
    margin: 4px 0 0;
    font-size: var(--fs-sub);
    color: var(--t2);
  }
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
  .plotbox {
    position: relative;
  }
  /* 재선정일 세로 눈금: 차트 위에 얹고 클릭은 통과시킨다 */
  .ticks {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
  }
  .ticks i {
    position: absolute;
    top: 0;
    bottom: 24px;
    width: 1px;
    background: var(--hatch);
  }
  .tog {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: var(--touch);
    padding: 0 6px;
    border-radius: 10px;
    color: inherit;
  }
  .tog[aria-pressed='false'] {
    opacity: 0.5;
    text-decoration: line-through;
  }
</style>
