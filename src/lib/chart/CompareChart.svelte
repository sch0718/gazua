<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import {
    ColorType,
    createChart,
    CrosshairMode,
    LineSeries,
    LineStyle,
    type AutoscaleInfo,
    type DeepPartial,
    type ChartOptions,
    type IChartApi,
    type ISeriesApi,
    type LineData,
    type Logical,
    type MouseEventParams,
    type Time,
    type UTCTimestamp,
    type WhitespaceData,
  } from 'lightweight-charts';
  import type { DaySession } from '../market/sessions';
  import { kstDate, kstEpoch } from '../time/kst';
  import { SessionBandsPrimitive, sessionBands, type BandsColors, type BandsInput } from './bandsPrimitive';
  import {
    buildLineData,
    fillMissingDays,
    fromChartTime,
    haltDays,
    hasValue,
    minuteGrid,
    toChartTime,
    withLineBreaks,
    type ChartSeriesInput,
    type ColoredLineDatum,
    type LineDatum,
  } from './lineData';
  import SessionLanes from './SessionLanes.svelte';

  type Unit = '%' | 'x' | '조';

  interface Props {
    series: ChartSeriesInput[];
    mode: 'intraday' | 'daily';
    sessions: DaySession[];
    markers: boolean;
    unit: Unit;
    directLabels: boolean;
    oncrosshair: (t: number | null) => void;
    /** 일봉: 기간 안의 거래일(KST `YYYY-MM-DD`). 거래정지 띠와 X축 자리에 쓴다 */
    openDays?: string[];
    /** 기준선 값. 생략하면 단위로 정한다(% → 0, x → 1, 조 → 없음) */
    baseline?: number | null;
    /** 바뀌면 CSS 변수에서 색을 다시 읽는다 */
    theme?: string;
  }

  let {
    series,
    mode,
    sessions,
    markers,
    unit,
    directLabels,
    oncrosshair,
    openDays = [],
    baseline,
    theme,
  }: Props = $props();

  const GRID_MINUTES = 720;
  const MAX_DIRECT_LABELS = 4;
  const LABEL_MIN_GAP = 14;
  const LIGHT = {
    s: ['#eb6834', '#1baf7a', '#4a3aa7', '#eda100', '#e87ba4', '#008300', '#2a78d6', '#e34948'],
    t1: '#111317',
    t3: '#676d77',
    grid: 'rgba(17,19,23,.07)',
    band: 'rgba(17,19,23,.045)',
    hatch: 'rgba(17,19,23,.22)',
    surface: '#ffffff',
  };

  type Palette = typeof LIGHT;

  interface Built {
    input: ChartSeriesInput;
    solid: ISeriesApi<'Line'>;
    last: { time: number; value: number } | null;
  }

  interface EndLabel {
    id: string;
    text: string;
    x: number;
    y: number;
  }

  let plotEl: HTMLDivElement;
  let canvasEl: HTMLDivElement;
  let chart = $state.raw<IChartApi | null>(null);
  let built: Built[] = [];
  let gridStart: number | null = null;
  let frame = 0;
  /** 시리즈를 다시 만드는 중(효과 본문·정리). 이때 온 크로스헤어는 끝난 뒤 전달한다. */
  let rebuilding = false;
  let pendingCrosshair: { t: number | null } | null = null;
  /** 같은 데이터 묶음을 다시 그릴 때(주기 갱신) 사용자가 맞춘 확대·이동을 되살린다. 묶음이 바뀌면 다시 맞춘다. */
  let fitKey: string | null = null;
  let keptRange: { from: number; to: number } | null = null;

  let plotWidth = $state(0);
  let endLabels = $state.raw<EndLabel[]>([]);
  let laneXOf = $state.raw<((t: number) => number | null) | null>(null);

  const visible = $derived(series.filter((s) => !s.hidden));
  const day = $derived(dayOf(sessions, visible));
  const shownLabels = $derived(directLabels && visible.length <= MAX_DIRECT_LABELS ? endLabels : []);

  function dayOf(daySessions: DaySession[], inputs: ChartSeriesInput[]): string | undefined {
    if (daySessions.length > 0) return kstDate(daySessions[0].start);
    const first = inputs.flatMap((s) => s.points).find((p) => p.v !== null);
    return first ? kstDate(first.t) : undefined;
  }

  function readPalette(): Palette {
    const cs = getComputedStyle(document.documentElement);
    const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
    return {
      s: LIGHT.s.map((c, i) => v(`--s${i + 1}`, c)),
      t1: v('--t1', LIGHT.t1),
      t3: v('--t3', LIGHT.t3),
      grid: v('--grid', LIGHT.grid),
      band: v('--band', LIGHT.band),
      hatch: v('--hatch', LIGHT.hatch),
      surface: v('--surface', LIGHT.surface),
    };
  }

  function withAlpha(color: string, alpha: number): string {
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
    if (hex) {
      const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    const rgb = /^rgba?\(([^)]+)\)$/i.exec(color);
    if (rgb) {
      const [r, g, b] = rgb[1].split(/[\s,/]+/);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return color;
  }

  const pad2 = (n: number) => String(n).padStart(2, '0');
  const utc = (time: Time) => new Date((time as number) * 1000);
  const hhmm = (time: Time) => {
    const d = utc(time);
    return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  };
  const monthDay = (time: Time) => {
    const d = utc(time);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  };

  function formatValue(u: Unit, v: number): string {
    if (u === '%') return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
    if (u === 'x') return `${v.toFixed(2)}x`;
    return `${v.toFixed(Math.abs(v) < 10 ? 2 : 1)}조`;
  }

  function chartOptions(m: Props['mode'], u: Unit, p: Palette, font: string): DeepPartial<ChartOptions> {
    return {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: p.t3,
        fontSize: 11,
        fontFamily: font,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: p.grid } },
      rightPriceScale: { visible: true, borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.06 } },
      leftPriceScale: { visible: false },
      timeScale: {
        borderVisible: false,
        lockVisibleTimeRangeOnResize: true,
        rightOffset: 0,
        minBarSpacing: 0.05,
        tickMarkFormatter: (time: Time) =>
          m === 'intraday' ? (utc(time).getUTCMinutes() === 0 ? pad2(utc(time).getUTCHours()) : hhmm(time)) : monthDay(time),
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        horzLine: { visible: false, labelVisible: false },
        vertLine: { color: p.t1, width: 1, style: LineStyle.Solid, labelBackgroundColor: p.t1 },
      },
      // 스펙 7.6: 가로 스와이프(마우스 끌기) = 이동, 두 손가락 = 확대, 길게 누르기 = 스크럽(LWC 터치 크로스헤어).
      // 휠과 세로 스와이프는 페이지 스크롤에 남겨 둔다.
      handleScroll: { horzTouchDrag: true, vertTouchDrag: false, pressedMouseMove: true, mouseWheel: false },
      handleScale: { pinch: true, mouseWheel: false, axisPressedMouseMove: false, axisDoubleClickReset: true },
      localization: {
        locale: 'ko-KR',
        priceFormatter: (v: number) => formatValue(u, v),
        timeFormatter: (time: Time) => (m === 'intraday' ? hhmm(time) : monthDay(time)),
      },
    };
  }

  type LwcDatum = LineData<Time> | WhitespaceData<Time>;
  const toLwc = (data: ColoredLineDatum[]): LwcDatum[] =>
    data.map((d) => ({ ...d, time: d.time as UTCTimestamp }));

  function lastValue(solid: LineDatum[], dotted: LineDatum[]): Built['last'] {
    for (let i = solid.length - 1; i >= 0; i--) {
      const s = solid[i];
      const d = dotted[i];
      if (hasValue(s)) return s;
      if (hasValue(d)) return d;
    }
    return null;
  }

  /** 1일 차트: epoch ms → 그 분 칸의 왼쪽 경계 x. 축은 08:00부터 매 분 한 칸이다. */
  function intradayXOf(c: IChartApi, start: number) {
    return (t: number): number | null => {
      const idx = (t - start) / 60_000;
      if (idx < 0 || idx > GRID_MINUTES) return null;
      const ts = c.timeScale();
      const x0 = ts.logicalToCoordinate(0 as Logical);
      const x1 = ts.logicalToCoordinate(1 as Logical);
      if (x0 === null || x1 === null) return null;
      const spacing = x1 - x0;
      return x0 + idx * spacing - spacing / 2;
    };
  }

  function dailyBand(c: IChartApi) {
    return (t: number) => {
      const ts = c.timeScale();
      const x = ts.timeToCoordinate(toChartTime(t) as UTCTimestamp);
      const x0 = ts.logicalToCoordinate(0 as Logical);
      const x1 = ts.logicalToCoordinate(1 as Logical);
      if (x === null || x0 === null || x1 === null) return null;
      return { x, w: (x1 - x0) * 0.6 };
    };
  }

  function refreshOverlay() {
    frame = 0;
    const c = chart;
    if (!c) return;
    const ts = c.timeScale();
    plotWidth = ts.width();
    laneXOf = gridStart === null ? null : intradayXOf(c, gridStart);

    const placed: EndLabel[] = [];
    for (const b of built) {
      if (!b.last) continue;
      const x = ts.timeToCoordinate(b.last.time as UTCTimestamp);
      const y = b.solid.priceToCoordinate(b.last.value);
      // 확대·이동으로 마지막 점이 보이는 범위 밖이면 라벨도 감춘다.
      if (x === null || y === null || x < 0 || x > plotWidth) continue;
      placed.push({ id: b.input.id, text: b.input.label, x, y });
    }
    placed.sort((a, b) => a.y - b.y);
    for (let i = 1; i < placed.length; i++) {
      if (placed[i].y - placed[i - 1].y < LABEL_MIN_GAP) placed[i].y = placed[i - 1].y + LABEL_MIN_GAP;
    }
    endLabels = placed;
  }

  /** 1일 차트는 아직 오지 않은 시간(마지막 봉 뒤 whitespace)까지 08:00–20:00 전체를 보인다. */
  function fitRange(c: IChartApi) {
    if (gridStart !== null) {
      c.timeScale().setVisibleLogicalRange({ from: -0.5, to: GRID_MINUTES - 0.5 });
    } else {
      c.timeScale().fitContent();
    }
  }

  function scheduleOverlay() {
    if (frame === 0) frame = requestAnimationFrame(refreshOverlay);
  }

  function deliverCrosshair(t: number | null) {
    // 부모 콜백이 읽는 상태가 이 컴포넌트 효과의 의존성이 되지 않게 한다.
    untrack(() => oncrosshair(t));
  }

  /**
   * lightweight-charts는 포인터가 차트 위에 있으면 setData·removeSeries 안에서 이 구독자를 동기로 부른다.
   * 리빌드 효과 안에서 부모 상태를 쓰면 효과가 스스로를 무효화하므로, 그동안 온 값은 마지막 것만 모아 뒤에 전달한다.
   */
  function onCrosshairMove(param: MouseEventParams<Time>) {
    const t = param.time === undefined ? null : fromChartTime(param.time as number);
    if (!rebuilding) {
      deliverCrosshair(t);
      return;
    }
    const queued = pendingCrosshair !== null;
    pendingCrosshair = { t };
    if (queued) return;
    queueMicrotask(() => {
      const p = pendingCrosshair;
      pendingCrosshair = null;
      if (p && chart) deliverCrosshair(p.t);
    });
  }

  onMount(() => {
    const c = createChart(canvasEl, {
      width: plotEl.clientWidth,
      height: plotEl.clientHeight,
    });
    c.subscribeCrosshairMove(onCrosshairMove);
    // 확대·이동·크기 변경 때 차트 밖에 그리는 것(세션 레인·끝 라벨)을 다시 배치한다. 띠(primitive)는 그릴 때 좌표를 다시 읽는다.
    c.timeScale().subscribeVisibleLogicalRangeChange(scheduleOverlay);
    c.timeScale().subscribeSizeChange(scheduleOverlay);
    let lastWidth = plotEl.clientWidth;
    const observer = new ResizeObserver(() => {
      const width = plotEl.clientWidth;
      c.resize(width, plotEl.clientHeight);
      // 높이만 바뀐 경우(휴대폰 주소창이 접히거나 펴짐)는 다시 맞추지 않는다: 사용자가 맞춘 확대·이동을 지킨다.
      // 너비가 바뀌면(첫 배치·회전·창 크기) 전체를 다시 맞춘다.
      if (width !== lastWidth) {
        lastWidth = width;
        fitRange(c);
      }
      scheduleOverlay();
    });
    observer.observe(plotEl);
    chart = c;
    return () => {
      observer.disconnect();
      c.timeScale().unsubscribeVisibleLogicalRangeChange(scheduleOverlay);
      c.timeScale().unsubscribeSizeChange(scheduleOverlay);
      if (frame !== 0) cancelAnimationFrame(frame);
      chart = null;
      built = [];
      c.remove();
    };
  });

  // 입력이 바뀌면 시리즈를 모두 다시 만든다(최대 8종목 × 3, 1일 720점이라 충분히 가볍다).
  $effect(() => {
    const c = chart;
    if (!c) return;
    rebuilding = true;
    try {
      return build(c);
    } finally {
      rebuilding = false;
    }
  });

  function build(c: IChartApi): () => void {
    void theme;
    const palette = readPalette();
    const font = getComputedStyle(plotEl).fontFamily;
    c.applyOptions(chartOptions(mode, unit, palette, font));

    const effectiveBaseline = baseline !== undefined ? baseline : unit === '%' ? 0 : unit === 'x' ? 1 : null;
    // 첫 값 전 점선은 기준선에 둔다(% → 0, x → 1, 조 → 비움).
    const startValue = effectiveBaseline;
    const grid = mode === 'intraday' && day ? minuteGrid(day) : undefined;
    gridStart = grid ? grid[0] : null;

    const lastReal = (s: ChartSeriesInput) =>
      Math.max(-Infinity, ...s.points.filter((p) => p.v !== null).map((p) => p.t));
    const latest = Math.max(-Infinity, ...visible.map(lastReal));
    const until = grid && Number.isFinite(latest) ? latest : undefined;
    const dayTimes = mode === 'daily' ? openDays.map((d) => kstEpoch(d, '00:00:00')) : [];
    const knownDays = dayTimes.filter((t) => t <= latest);

    const created: ISeriesApi<'Line'>[] = [];
    const nextBuilt: Built[] = [];
    for (const input of visible) {
      const color = palette.s[input.slot - 1];
      const points = mode === 'daily' ? fillMissingDays(input.points, knownDays) : input.points;
      const { solid, dotted } = buildLineData(points, input.intervals, grid, { startValue, until });

      const dottedSeries = c.addSeries(LineSeries, {
        // 스펙은 1.5px·40%. LWC 선 두께는 정수라 1px이면 점이 거의 안 보여 2px로 둔다.
        color: withAlpha(color, 0.4),
        lineWidth: 2,
        lineStyle: LineStyle.SparseDotted,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      dottedSeries.setData(toLwc(withLineBreaks(dotted, 'transparent')));

      const solidSeries = c.addSeries(LineSeries, {
        color,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerRadius: 4,
        crosshairMarkerBorderColor: palette.surface,
      });
      solidSeries.setData(toLwc(withLineBreaks(solid, 'transparent')));
      created.push(dottedSeries, solidSeries);

      // 선을 끊으려고 투명하게 만든 점도 점 마커는 보여야 하므로 마커는 따로 그린다.
      if (mode === 'daily' && markers) {
        const markerSeries = c.addSeries(LineSeries, {
          color,
          lineVisible: false,
          pointMarkersVisible: true,
          pointMarkersRadius: 4,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        markerSeries.setData(toLwc(solid));
        created.push(markerSeries);
      }
      nextBuilt.push({ input, solid: solidSeries, last: lastValue(solid, dotted) });
    }

    const first = nextBuilt[0]?.solid;
    if (first && effectiveBaseline !== null) {
      first.createPriceLine({
        price: effectiveBaseline,
        color: palette.t3,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: false,
        title: '',
      });
      // 기준선이 늘 보이도록 자동 범위에 포함한다.
      first.applyOptions({
        autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
          const info = original();
          if (!info?.priceRange) return info;
          return {
            ...info,
            priceRange: {
              minValue: Math.min(info.priceRange.minValue, effectiveBaseline),
              maxValue: Math.max(info.priceRange.maxValue, effectiveBaseline),
            },
          };
        },
      });
    }

    const bandColors: BandsColors = { band: palette.band, hatch: palette.hatch, label: palette.t3, font };
    let bandsInput: BandsInput;
    if (mode === 'intraday') {
      const venues = visible.flatMap((s) => s.intervals.map((iv) => iv.venue));
      const unified = venues.length > 0 && venues.every((v) => v === 'UNIFIED');
      bandsInput = {
        mode: 'intraday',
        bands: sessionBands(sessions, unified),
        xOf: grid ? intradayXOf(c, grid[0]) : () => null,
      };
    } else {
      bandsInput = {
        mode: 'daily',
        halts: haltDays(visible.map((s) => ({ label: s.label, points: s.points, bars: s.bars })), dayTimes),
        dayBand: dailyBand(c),
      };
    }
    first?.attachPrimitive(new SessionBandsPrimitive(bandsInput, bandColors));

    // 기간·모드·종목 묶음이 바뀌면 전체를 맞추고, 같은 묶음의 주기 갱신이면 보던 범위를 유지한다.
    const key = [mode, unit, gridStart ?? '', openDays.join(','), series.map((s) => s.id).join(',')].join('|');
    if (key === fitKey && keptRange) c.timeScale().setVisibleLogicalRange(keptRange);
    else fitRange(c);
    fitKey = key;
    keptRange = null;
    built = nextBuilt;
    scheduleOverlay();

    return () => {
      if (chart !== c) return;
      const range = c.timeScale().getVisibleLogicalRange();
      keptRange = range ? { from: range.from, to: range.to } : null;
      rebuilding = true;
      try {
        for (const s of created) c.removeSeries(s);
      } finally {
        rebuilding = false;
      }
      built = [];
    };
  }
</script>

<div class="compare-chart">
  <!-- role="img"는 자식을 장식으로 만들어, 차트 라이브러리가 넣는 TradingView 출처 링크(포커스 가능)와 충돌한다(axe nested-interactive). -->
  <div class="plot" bind:this={plotEl} role="group" aria-label="종목 비교 차트">
    <div class="lwc" bind:this={canvasEl}></div>
    {#each shownLabels as l (l.id)}
      <span
        class="end-label"
        class:flip={l.x > plotWidth - 64}
        style:left="{l.x > plotWidth - 64 ? l.x - 8 : l.x + 8}px"
        style:top="{l.y}px">{l.text}</span
      >
    {/each}
  </div>
  {#if mode === 'intraday' && laneXOf}
    <SessionLanes {series} xOf={laneXOf} width={plotWidth} {day} />
  {/if}
</div>

<style>
  .compare-chart {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .plot {
    position: relative;
    flex: 1 1 auto;
    min-height: 260px;
  }
  .lwc {
    position: absolute;
    inset: 0;
  }
  .end-label {
    position: absolute;
    transform: translateY(-50%);
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
    color: var(--t1);
    white-space: nowrap;
    pointer-events: none;
    z-index: 2;
  }
  .end-label.flip {
    transform: translate(-100%, -50%);
  }
</style>
