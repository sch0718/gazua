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
}

export const lwcCharts: StubChart[] = [];

function createChart(): unknown {
  const chart: StubChart = { series: [], removed: false };
  const byApi = new Map<unknown, StubSeries>();
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
    subscribeCrosshairMove: () => {},
    timeScale: () => timeScale,
    resize: () => {},
    applyOptions: () => {},
    remove: () => {
      chart.removed = true;
    },
    addSeries: (_def: unknown, options: Record<string, unknown>) => {
      const s: StubSeries = { options, data: [] };
      chart.series.push(s);
      const api = {
        setData: (d: unknown[]) => {
          s.data = d;
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
