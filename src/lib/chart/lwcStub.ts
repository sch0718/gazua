// 테스트 전용: jsdom에는 canvas가 없으므로 lightweight-charts를 이 가짜로 바꾼다.
//   vi.mock('lightweight-charts', async () => (await import('.../chart/lwcStub')).lwcModule());
// 만든 차트와 시리즈는 lwcCharts에 남아 단언에 쓸 수 있다.

export interface StubSeries {
  options: Record<string, unknown>;
  data: unknown[];
  /** createSeriesMarkers로 넣은 마커(마지막 setMarkers 기준) */
  markers: unknown[];
  /** createPriceLine으로 만든 가격선 옵션 */
  priceLines: Record<string, unknown>[];
}

export interface StubChart {
  series: StubSeries[];
  removed: boolean;
  /** addSeries 호출 수(시리즈를 다시 만든 횟수 확인용) */
  addSeriesCalls: number;
  /** createChart·applyOptions로 받은 옵션(얕게 합침) */
  options: Record<string, unknown>;
  /** logicalToCoordinate(l) = offset + l × spacing. 확대·이동을 흉내 낼 때 바꾼다. */
  scale: { offset: number; spacing: number };
  /** setVisibleLogicalRange로 정한 범위(fitContent면 'fit') */
  visibleRange: { from: number; to: number } | 'fit' | null;
  /** 시간 → x. 기본은 null(라벨을 그리지 않음) */
  timeToX: (time: number) => number | null;
  /** 가격 → y. 기본은 null */
  priceToY: (price: number) => number | null;
  /** 보이는 범위 구독자 수(정리 확인용) */
  readonly rangeSubscribers: number;
  readonly sizeSubscribers: number;
  /** 보이는 범위가 바뀐 것처럼 구독자를 부른다 */
  fireVisibleRange(): void;
}

export const lwcCharts: StubChart[] = [];
// 시리즈 api → 기록. 차트가 여럿이어도 한 곳에서 찾는다.
const seriesByApi = new Map<unknown, StubSeries>();

/**
 * 실제 lightweight-charts는 포인터가 차트 위에 있으면 setData·removeSeries 안에서
 * 크로스헤어 구독자를 동기로 부른다. 값을 넣으면 가짜도 그렇게 한다(null이면 부르지 않음).
 */
export const lwcStubHooks: { crosshairOnSetData: { time?: number } | null } = { crosshairOnSetData: null };

function createChart(_el: unknown, initial: Record<string, unknown> = {}): unknown {
  const rangeHandlers = new Set<() => void>();
  const sizeHandlers = new Set<() => void>();
  const chart: StubChart = {
    series: [],
    removed: false,
    addSeriesCalls: 0,
    options: { ...initial },
    scale: { offset: 0, spacing: 1 },
    visibleRange: null,
    timeToX: () => null,
    priceToY: () => null,
    get rangeSubscribers() {
      return rangeHandlers.size;
    },
    get sizeSubscribers() {
      return sizeHandlers.size;
    },
    fireVisibleRange() {
      for (const h of rangeHandlers) h();
    },
  };
  const crosshair: ((p: { time?: number }) => void)[] = [];
  const fireCrosshair = () => {
    const p = lwcStubHooks.crosshairOnSetData;
    if (p) for (const h of crosshair) h(p);
  };
  lwcCharts.push(chart);
  const timeScale = {
    subscribeVisibleLogicalRangeChange: (h: () => void) => rangeHandlers.add(h),
    unsubscribeVisibleLogicalRangeChange: (h: () => void) => rangeHandlers.delete(h),
    subscribeSizeChange: (h: () => void) => sizeHandlers.add(h),
    unsubscribeSizeChange: (h: () => void) => sizeHandlers.delete(h),
    width: () => 300,
    logicalToCoordinate: (l: number) => chart.scale.offset + l * chart.scale.spacing,
    timeToCoordinate: (time: number) => chart.timeToX(time),
    getVisibleLogicalRange: () => (chart.visibleRange === 'fit' ? null : chart.visibleRange),
    setVisibleLogicalRange: (r: { from: number; to: number }) => {
      chart.visibleRange = { from: r.from, to: r.to };
    },
    fitContent: () => {
      chart.visibleRange = 'fit';
    },
  };
  return {
    subscribeCrosshairMove: (h: (p: { time?: number }) => void) => {
      crosshair.push(h);
    },
    timeScale: () => timeScale,
    resize: () => {},
    applyOptions: (o: Record<string, unknown>) => {
      chart.options = { ...chart.options, ...o };
    },
    remove: () => {
      chart.removed = true;
    },
    addSeries: (_def: unknown, options: Record<string, unknown>) => {
      const s: StubSeries = { options, data: [], markers: [], priceLines: [] };
      chart.series.push(s);
      chart.addSeriesCalls++;
      const api = {
        setData: (d: unknown[]) => {
          s.data = d;
          fireCrosshair();
        },
        createPriceLine: (o: Record<string, unknown>) => {
          s.priceLines.push(o);
          return {};
        },
        // 테마가 바뀌어 색을 다시 넣는 경우를 확인하도록 옵션에 얕게 합친다
        applyOptions: (o: Record<string, unknown>) => {
          s.options = { ...s.options, ...o };
        },
        attachPrimitive: () => {},
        priceToCoordinate: (price: number) => chart.priceToY(price),
      };
      seriesByApi.set(api, s);
      return api;
    },
    removeSeries: (api: unknown) => {
      const s = seriesByApi.get(api);
      chart.series = chart.series.filter((x) => x !== s);
      seriesByApi.delete(api);
      fireCrosshair();
    },
  };
}

/** 테스트 사이에 기록을 비운다(beforeEach에서 부른다). */
export function resetLwcStub(): void {
  lwcCharts.length = 0;
  seriesByApi.clear();
}

/** v5의 createSeriesMarkers: 시리즈 api에서 StubSeries를 찾아 마커를 기록한다. */
function createSeriesMarkers(api: unknown, markers: unknown[] = []) {
  const s = seriesByApi.get(api);
  if (s) s.markers = markers;
  return {
    setMarkers: (m: unknown[]) => {
      if (s) s.markers = m;
    },
    detach: () => {},
  };
}

export function lwcModule() {
  return {
    createChart,
    createSeriesMarkers,
    ColorType: { Solid: 'solid' },
    CrosshairMode: { Normal: 0 },
    LineSeries: { type: 'Line' },
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3, SparseDotted: 4 },
  };
}

/** ResizeObserver가 없는 jsdom용. */
export class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
