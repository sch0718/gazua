// 테스트 전용: jsdom에는 canvas가 없으므로 lightweight-charts를 이 가짜로 바꾼다.
//   vi.mock('lightweight-charts', async () => (await import('.../chart/lwcStub')).lwcModule());
// 만든 차트와 시리즈는 lwcCharts에 남아 단언에 쓸 수 있다.

export interface StubSeries {
  options: Record<string, unknown>;
  data: unknown[];
}

export interface StubChart {
  series: StubSeries[];
  removed: boolean;
  /** addSeries 호출 수(시리즈를 다시 만든 횟수 확인용) */
  addSeriesCalls: number;
}

export const lwcCharts: StubChart[] = [];

/**
 * 실제 lightweight-charts는 포인터가 차트 위에 있으면 setData·removeSeries 안에서
 * 크로스헤어 구독자를 동기로 부른다. 값을 넣으면 가짜도 그렇게 한다(null이면 부르지 않음).
 */
export const lwcStubHooks: { crosshairOnSetData: { time?: number } | null } = { crosshairOnSetData: null };

function createChart(): unknown {
  const chart: StubChart = { series: [], removed: false, addSeriesCalls: 0 };
  const byApi = new Map<unknown, StubSeries>();
  const crosshair: ((p: { time?: number }) => void)[] = [];
  const fireCrosshair = () => {
    const p = lwcStubHooks.crosshairOnSetData;
    if (p) for (const h of crosshair) h(p);
  };
  lwcCharts.push(chart);
  const timeScale = {
    subscribeVisibleLogicalRangeChange: () => {},
    subscribeSizeChange: () => {},
    width: () => 300,
    logicalToCoordinate: (l: number) => l,
    timeToCoordinate: () => null,
    setVisibleLogicalRange: () => {},
    fitContent: () => {},
  };
  return {
    subscribeCrosshairMove: (h: (p: { time?: number }) => void) => {
      crosshair.push(h);
    },
    timeScale: () => timeScale,
    resize: () => {},
    applyOptions: () => {},
    remove: () => {
      chart.removed = true;
    },
    addSeries: (_def: unknown, options: Record<string, unknown>) => {
      const s: StubSeries = { options, data: [] };
      chart.series.push(s);
      chart.addSeriesCalls++;
      const api = {
        setData: (d: unknown[]) => {
          s.data = d;
          fireCrosshair();
        },
        createPriceLine: () => {},
        applyOptions: () => {},
        attachPrimitive: () => {},
        priceToCoordinate: () => null,
      };
      byApi.set(api, s);
      return api;
    },
    removeSeries: (api: unknown) => {
      const s = byApi.get(api);
      chart.series = chart.series.filter((x) => x !== s);
      byApi.delete(api);
      fireCrosshair();
    },
  };
}

export function lwcModule() {
  return {
    createChart,
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
