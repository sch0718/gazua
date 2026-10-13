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
  import { positionOf, positionReturnPct } from './positions';
  import { returnClass, shortDate, trendReturn } from './simText';

  let {
    open,
    trade,
    trades,
    candles,
    name,
    level = null,
    onclose,
  }: {
    open: boolean;
    trade: Trade | null;
    trades: Trade[];
    candles: Candle[];
    name: string;
    /** 전략이 고른 돌파 기준(A·B). 돌파 트리거를 안 쓰면 null */
    level?: 'A' | 'B' | null;
    onclose: () => void;
  } = $props();

  const MARGIN_BARS = 20;
  /** 양 끝 x 라벨(`2025년`·`10월` 등)이 잘리지 않게 앞뒤로 비워 둘 봉 수: 표시 봉의 7%(최소 3). 폭과 무관하게 라벨 반 폭(약 16px) 이상 */
  const edgePadBars = (n: number) => Math.max(3, Math.ceil(n * 0.07));
  /** 같은 방향 마커가 이 봉 수 안이면 하나로 합친다(라벨 겹침 방지) */
  const MERGE_BARS = 3;
  const LABEL: Record<Trade['kind'], string> = { buy: '매수', add: '추가', take: '익절', gapTake: '익절', stop: '손절', gapStop: '손절' };
  // 토큰을 못 읽을 때의 폴백은 라이트 토큰 값(tokens.css)과 같게, 토큰마다 하나
  const ACCENT: [string, string] = ['--accent', '#5b47e0'];
  const T2: [string, string] = ['--t2', '#5b6069'];
  const UP: [string, string] = ['--up', '#d4202f'];
  const DOWN: [string, string] = ['--down', '#1d5fd6'];
  // 마커·가격선 색 토큰: 매수 = 강조색, 익절 = 상승색, 손절 = 하락색
  const MARKER_COLOR: Record<Trade['kind'], [string, string]> = {
    buy: ACCENT,
    add: ACCENT,
    take: UP,
    gapTake: UP,
    stop: DOWN,
    gapStop: DOWN,
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

  // 첫 매수와 해가 다른 단계는 `25.01.10`처럼 연도를 붙인다(해를 넘기면 MM.DD만으로는 거꾸로 읽힌다)
  const steps = $derived.by(() => {
    if (!position) return [];
    const year = position.trades[0].date.slice(0, 4);
    const when = (d: string) => (d.slice(0, 4) === year ? shortDate(d) : d.slice(2).replaceAll('-', '.'));
    return position.trades.map((t) => `${LABEL[t.kind]} ${when(t.date)} ${fmtWon(t.price)}원`);
  });
  const outcome = $derived.by(() => {
    if (!position) return null;
    const r = positionReturnPct(position);
    return r === null ? { text: '보유 중', cls: '' } : { text: trendReturn(r), cls: returnClass(r) };
  });
  // 제목: `DB하이텍 · 25.03.24 매수`(포지션의 첫 매수일)
  const title = $derived(position ? `${name} · ${position.trades[0].date.slice(2).replaceAll('-', '.')} 매수` : name);

  const buying = (t: Trade) => t.kind === 'buy' || t.kind === 'add';

  /** 같은 방향 거래가 MERGE_BARS봉 안에 몰리면 마커 하나로(라벨 `매수·추가`·`익절·손절`). 시간 순으로 돌려준다. */
  function mergedMarkers(list: Trade[], barOf: (date: string) => number) {
    type Group = { time: string; bar: number; buying: boolean; kinds: Trade['kind'][] };
    const groups: Group[] = [];
    const lastOf = new Map<boolean, Group>();
    for (const t of list) {
      const bar = barOf(t.date);
      const last = lastOf.get(buying(t));
      if (last && bar - last.bar <= MERGE_BARS) {
        last.kinds.push(t.kind);
        continue;
      }
      const g = { time: t.date, bar, buying: buying(t), kinds: [t.kind] };
      groups.push(g);
      lastOf.set(g.buying, g);
    }
    return groups.sort((a, b) => a.bar - b.bar);
  }

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
      // 위는 매도 마커, 아래는 매수 마커·출처 로고 자리
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.22 } },
      timeScale: { borderVisible: false },
      localization: { locale: 'ko-KR', priceFormatter: (p: number) => fmtWon(Math.round(p)) },
    });
    const observer = new ResizeObserver(() => c.resize(node.clientWidth, node.clientHeight));
    observer.observe(node);
    const line = c.addSeries(LineSeries, { color: v(T2), lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
    line.setData(bars.map((k) => ({ time: kstDate(k.t) as Time, value: k.c })));

    // 마커는 시간 순이어야 한다
    const barOf = (date: string) => {
      const i = dates.findIndex((d) => d >= date);
      return i < 0 ? dates.length : i;
    };
    const markers: SeriesMarker<Time>[] = mergedMarkers(position.trades, barOf).map((g) => {
      const colors = [...new Set(g.kinds.map((k) => v(MARKER_COLOR[k])))];
      return {
        time: g.time as Time,
        position: g.buying ? 'belowBar' : 'aboveBar',
        shape: g.buying ? 'arrowUp' : 'arrowDown',
        // 익절·손절처럼 색이 섞이면 중립색
        color: colors.length === 1 ? colors[0] : v(T2),
        text: [...new Set(g.kinds.map((k) => LABEL[k]))].join('·'),
      };
    });
    createSeriesMarkers(line, markers);

    if (pattern) {
      // 고른 돌파 기준선만 강조색. L은 참고용이라 성긴 점선, 값은 요약 글에 있으니 축 라벨은 뺀다
      const gray = v(['--t3', '#676d77']);
      const accent = v(ACCENT);
      for (const [title, price] of [['A', pattern.a], ['B', pattern.b]] as const) {
        line.createPriceLine({ price, title, color: title === level ? accent : gray, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true });
      }
      line.createPriceLine({ price: pattern.l, title: 'L', color: gray, lineWidth: 1, lineStyle: LineStyle.SparseDotted, axisLabelVisible: false });
    }
    const pad = edgePadBars(bars.length);
    c.timeScale().setVisibleLogicalRange({ from: -pad, to: bars.length - 1 + pad });
    return () => {
      observer.disconnect();
      c.remove();
    };
  });
</script>

<Sheet {open} {title} {onclose}>
  <div class="trade-chart">
    <div class="plot" bind:this={el} aria-hidden="true"></div>
    <p class="summary num">
      {#each steps as step, i (i)}{#if i > 0}{' → '}{/if}<span class="step">{step}</span>{/each}{#if outcome}{' · '}<span
          class="step {outcome.cls}">{outcome.text}</span
        >{/if}
    </p>
    {#if pattern}
      <!-- 차트가 aria-hidden이라 A/B/L 가격선도 글로 남긴다 -->
      <p class="summary num">A {fmtWon(pattern.a)}원 · B {fmtWon(pattern.b)}원 · L {fmtWon(pattern.l)}원</p>
    {/if}
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
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  /* 단계 하나(`매수 03.24 50,875원`)는 중간에서 줄바꿈하지 않는다 */
  .step {
    white-space: nowrap;
  }
</style>
