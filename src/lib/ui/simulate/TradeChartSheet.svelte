<script lang="ts">
  // 거래 차트(스펙 7.4-5): 한 포지션의 종가 선 + 거래 마커 + A/B/L 가격선.
  // 규칙이 의도한 패턴을 잡았는지 눈으로 확인하는 용도다.
  import {
    ColorType,
    createChart,
    createSeriesMarkers,
    LineSeries,
    LineStyle,
    type SeriesMarker,
    type Time,
  } from 'lightweight-charts';
  import type { Candle } from '../../data/metrics';
  import type { Trade } from '../../sim/types';
  import { kstDate } from '../../time/kst';
  import Sheet from '../components/Sheet.svelte';
  import { fmtWon } from '../format';
  import { positionOf } from './positions';

  let {
    open,
    trade,
    trades,
    candles,
    name,
    onclose,
  }: { open: boolean; trade: Trade | null; trades: Trade[]; candles: Candle[]; name: string; onclose: () => void } = $props();

  const MARGIN_BARS = 20;
  const LABEL: Record<Trade['kind'], string> = { buy: '매수', add: '추가', take: '익절', gapTake: '익절', stop: '손절', gapStop: '손절' };
  // 마커·가격선 색 토큰: 매수 = 강조색, 익절 = 상승색, 손절 = 하락색
  const MARKER_COLOR: Record<Trade['kind'], [string, string]> = {
    buy: ['--accent', '#2a78d6'],
    add: ['--accent', '#2a78d6'],
    take: ['--up', '#e5484d'],
    gapTake: ['--up', '#e5484d'],
    stop: ['--down', '#3b82f6'],
    gapStop: ['--down', '#3b82f6'],
  };

  const position = $derived(trade ? positionOf(trades, trade) : null);
  const pattern = $derived(position?.trades.find((t) => t.kind === 'buy')?.pattern ?? null);
  const dates = $derived(candles.map((k) => kstDate(k.t)));

  // 표시 범위: aDate 20봉 전 ~ 전량 매도 20봉 뒤. 보유 중이면 마지막 봉까지.
  const range = $derived.by(() => {
    if (!position || candles.length === 0) return null;
    const first = position.trades[0];
    const startDate = pattern?.aDate ?? first.date;
    const at = dates.findIndex((d) => d >= startDate);
    const from = Math.max(0, (at < 0 ? candles.length - 1 : at) - MARGIN_BARS);
    let to = candles.length - 1;
    if (position.closed) {
      const exit = position.trades.at(-1)!.date;
      const ei = dates.findIndex((d) => d >= exit);
      to = Math.min(candles.length - 1, (ei < 0 ? candles.length - 1 : ei) + MARGIN_BARS);
    }
    return { from, to };
  });

  const md = (d: string) => `${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}`;
  const summary = $derived(position?.trades.map((t) => `${LABEL[t.kind]} ${md(t.date)} ${fmtWon(t.price)}원`).join(' → ') ?? '');

  let el = $state<HTMLDivElement>();

  $effect(() => {
    if (!el || !range || !position) return;
    const node = el;
    const bars = candles.slice(range.from, range.to + 1);
    const cs = getComputedStyle(document.documentElement);
    const v = (token: [string, string]) => cs.getPropertyValue(token[0]).trim() || token[1];
    const c = createChart(node, {
      width: node.clientWidth,
      height: node.clientHeight,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: v(['--t3', '#676d77']), fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { color: v(['--grid', 'rgba(17,19,23,.07)']) } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
      localization: { locale: 'ko-KR', priceFormatter: (p: number) => fmtWon(Math.round(p)) },
    });
    const observer = new ResizeObserver(() => c.resize(node.clientWidth, node.clientHeight));
    observer.observe(node);
    const line = c.addSeries(LineSeries, { color: v(['--t2', '#4b5059']), lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
    line.setData(bars.map((k) => ({ time: kstDate(k.t) as Time, value: k.c })));

    // 마커는 시간 순이어야 한다
    const markers: SeriesMarker<Time>[] = position.trades.map((t) => {
      const buying = t.kind === 'buy' || t.kind === 'add';
      return {
        time: t.date as Time,
        position: buying ? 'belowBar' : 'aboveBar',
        shape: buying ? 'arrowUp' : 'arrowDown',
        color: v(MARKER_COLOR[t.kind]),
        text: LABEL[t.kind],
      };
    });
    createSeriesMarkers(line, markers);

    if (pattern) {
      for (const [title, price] of [['A', pattern.a], ['B', pattern.b], ['L', pattern.l]] as const) {
        line.createPriceLine({ price, title, color: v(['--t3', '#676d77']), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true });
      }
    }
    c.timeScale().fitContent();
    return () => {
      observer.disconnect();
      c.remove();
    };
  });
</script>

<Sheet {open} title={name} {onclose}>
  <div class="trade-chart">
    <div class="plot" bind:this={el} aria-hidden="true"></div>
    <p class="summary">{summary}</p>
  </div>
</Sheet>

<style>
  .trade-chart {
    padding: 0 16px;
  }
  .plot {
    height: 260px;
  }
  .summary {
    margin: 8px 0 0;
    font-size: 13px;
    color: var(--t2);
  }
</style>
