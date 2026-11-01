// @vitest-environment jsdom
import { render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lwcCharts, lwcStubHooks, resetLwcStub, ResizeObserverStub } from '../../chart/lwcStub';
import type { Trade } from '../../sim/types';
import EquityChart from './EquityChart.svelte';
import { doneState } from './resultFixture';

vi.mock('lightweight-charts', async () => (await import('../../chart/lwcStub')).lwcModule());

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  resetLwcStub();
});
afterEach(() => vi.unstubAllGlobals());

describe('EquityChart', () => {
  const props = (theme?: string) => ({
    equity: doneState().result.equity,
    initial: 10_000_000,
    labels: { benchmark: 'KODEX 200', index: 'KOSPI' },
    theme,
  });

  it('선 4개: 전략 accent 굵기 2 실선, 보유 회색 1 실선, 지정 종목 --line-bench 2 점선, 지수 t2 1.5 점선', async () => {
    render(EquityChart, props());
    await vi.waitFor(() => expect(lwcCharts[0]?.series).toHaveLength(4));
    const [strategy, hold, bench, index] = lwcCharts[0].series;
    // jsdom에는 토큰 값이 없어 대체 색(라이트 토큰 값)을 쓴다
    expect([strategy, hold, bench, index].map((s) => [s.options.color, s.options.lineWidth, s.options.lineStyle])).toEqual([
      ['#5b47e0', 2, 0],
      ['#676d77', 1, 0],
      ['#d95926', 2, 2],
      ['#5b6069', 1.5, 2],
    ]);
    // 수익률(%)로 그린다
    expect(strategy.data.at(-1)).toEqual({ time: '2026-10-08', value: expect.closeTo(32.4, 5) });
    // 맨 위 y 라벨이 잘리지 않게 위 여백
    expect(lwcCharts[0].options.rightPriceScale).toMatchObject({ scaleMargins: { top: 0.1 } });
  });

  it('지정 종목 선은 --line-bench 토큰(--s1은 비교 화면 슬롯이라 그대로 둔다), 견본도 같은 토큰', () => {
    render(EquityChart, props());
    const swatches = [...document.querySelectorAll<HTMLElement>('.legend .swatch')];
    expect(swatches[2].style.getPropertyValue('--c')).toBe('var(--line-bench)');
  });

  it('범례: 같은 종목 사서 보유, 견본은 실선/점선을 구분한다', () => {
    render(EquityChart, props());
    const legend = document.querySelector('.legend')!;
    expect(legend.textContent).toContain('같은 종목 사서 보유');
    const swatches = [...legend.querySelectorAll('.swatch')];
    expect(swatches.map((s) => s.classList.contains('dashed'))).toEqual([false, false, true, true]);
  });

  it('범례 견본 높이는 선 굵기와 같다(2 · 1 · 2 · 1.5px)', () => {
    render(EquityChart, props());
    const swatches = [...document.querySelectorAll<HTMLElement>('.legend .swatch')];
    expect(swatches.map((s) => s.style.height)).toEqual(['2px', '1px', '2px', '1.5px']);
  });

  it('지수가 없으면 3개', async () => {
    const s = doneState();
    const equity = s.result.equity.map((e) => ({ ...e, index: null }));
    render(EquityChart, { ...props(), equity });
    await vi.waitFor(() => expect(lwcCharts[0]?.series).toHaveLength(3));
  });

  it('테마가 바뀌면 CSS 변수에서 색을 다시 읽어 넣는다', async () => {
    const { rerender } = render(EquityChart, props('light'));
    await vi.waitFor(() => expect(lwcCharts[0]?.series).toHaveLength(4));
    const root = document.documentElement.style;
    root.setProperty('--accent', '#a093ff');
    root.setProperty('--t3', '#868b94');
    try {
      await rerender(props('dark'));
      await vi.waitFor(() => expect(lwcCharts[0].series[0].options.color).toBe('#a093ff'));
      expect(lwcCharts[0].series[1].options.color).toBe('#868b94');
      expect(lwcCharts[0].options.layout).toMatchObject({ textColor: '#868b94' });
      // 시리즈를 다시 만들지 않는다
      expect(lwcCharts[0].addSeriesCalls).toBe(4);
    } finally {
      root.removeProperty('--accent');
      root.removeProperty('--t3');
    }
  });

  it('언마운트하면 차트를 정리한다', async () => {
    const { unmount } = render(EquityChart, props());
    await vi.waitFor(() => expect(lwcCharts).toHaveLength(1));
    unmount();
    expect(lwcCharts[0].removed).toBe(true);
  });

  describe('curves mode (선정 기준 검증)', () => {
    const pts = (vs: number[]) => vs.map((v, i) => ({ date: `2026-01-0${i + 1}`, value: v }));
    const curves = () => [
      { id: 'a', name: '① 선정만', color: ['--accent', '#5b47e0'] as [string, string], width: 2, dashed: false, points: pts([10_000_000, 11_000_000]) },
      { id: 'b', name: 'KOSPI', color: ['--t2', '#5b6069'] as [string, string], width: 1.5, dashed: true, points: pts([10_000_000, 10_500_000]) },
    ];

    it('draws one series per curve in return %, with a toggle button per legend entry', async () => {
      render(EquityChart, { initial: 10_000_000, curves: curves(), theme: 'light' });
      await vi.waitFor(() => expect(lwcCharts[0]?.series).toHaveLength(2));
      expect(lwcCharts[0].series[0].data.at(-1)).toEqual({ time: '2026-01-02', value: expect.closeTo(10, 5) });
      expect(document.querySelectorAll('.legend button')).toHaveLength(2);
    });

    it('rebalance ticks follow the time scale and are drawn only when asked for', async () => {
      const { unmount } = render(EquityChart, { initial: 10_000_000, curves: curves(), rebalanceDates: ['2026-01-01', '2026-01-02'] });
      await vi.waitFor(() => expect(lwcCharts[0]?.series).toHaveLength(2));
      lwcCharts[0].timeToX = (t) => ((t as unknown) === '2026-01-01' ? 5 : 40);
      lwcCharts[0].fireVisibleRange();
      await vi.waitFor(() => expect([...document.querySelectorAll<HTMLElement>('[data-rebalance-tick]')].map((e) => e.style.left)).toEqual(['5px', '40px']));
      unmount();
      render(EquityChart, props());
      expect(document.querySelector('[data-rebalance-tick]')).toBeNull();
      expect(document.querySelector('.ticks')).toBeNull();
    });

    it('the default (equity) legend has no toggle buttons', () => {
      render(EquityChart, props());
      expect(document.querySelector('.legend button')).toBeNull();
    });
  });
});

describe('EquityChart screenshot', () => {
  it('위 레이어는 넣고 십자선은 빼고 찍는다', () => {
    const { component } = render(EquityChart, { equity: doneState().result.equity, initial: 10_000_000 });
    const shot = component.screenshot();
    expect(shot).not.toBeNull();
    expect(lwcCharts[0].screenshots).toEqual([[true, false]]);
  });
});

describe('EquityChart 재생(upTo)', () => {
  const days = ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05'];
  // 전략 수익률 0·1·2·3·4%, 보유 0·−1·−2·−3·−4%
  const equity = days.map((date, i) => ({ date, strategy: 10_000_000 * (1 + i / 100), hold: 10_000_000 * (1 - i / 100), index: null, benchmark: null, cash: 5_000_000 }));
  const trades: Trade[] = [
    { date: days[1], symbol: 'A', kind: 'buy', price: 100, qty: 1, fee: 0, tax: 0, reason: 'B 돌파' },
    { date: days[1], symbol: 'A', kind: 'add', price: 97, qty: 1, fee: 0, tax: 0, reason: '추가 매수' },
    { date: days[3], symbol: 'A', kind: 'take', stage: 1, price: 110, qty: 2, fee: 0, tax: 0, reason: '익절', pnlPct: 10 },
  ];
  const props = (upTo?: number) => ({ equity, initial: 10_000_000, trades, upTo });
  const series = (k = 0) => lwcCharts[0].series[k];
  const real = (k = 0) => (series(k).data as { value?: number }[]).filter((p) => p.value !== undefined);
  type Provider = () => { priceRange: { minValue: number; maxValue: number } };
  const autoscale = (k: number) => series(k).options.autoscaleInfoProvider as Provider | undefined;
  const legendDate = () => document.querySelector('.legend .date')?.textContent;

  it('upTo가 없으면 지금과 같다: 전체 점, 마커 없음, 세로축 자동', async () => {
    render(EquityChart, props());
    await vi.waitFor(() => expect(lwcCharts[0]?.series).toHaveLength(2));
    expect(series().data).toHaveLength(5);
    expect(real()).toHaveLength(5);
    expect(series().markers).toEqual([]);
    expect(autoscale(0)).toBeUndefined();
    expect(legendDate()).toBe('2024.01.05');
  });

  it('upTo까지만 실제 값, 뒤는 값 없는 점으로 가로축 고정, 세로축은 전체 기간 최소·최대', async () => {
    render(EquityChart, props(2));
    await vi.waitFor(() => expect(real()).toHaveLength(3));
    expect(series().data).toHaveLength(5);
    expect(series().data[4]).toEqual({ time: days[4] });
    expect(real(1)).toHaveLength(3);
    const s = autoscale(0)!().priceRange;
    expect(s.minValue).toBeCloseTo(0, 6);
    expect(s.maxValue).toBeCloseTo(4, 6);
    const h = autoscale(1)!().priceRange;
    expect(h.minValue).toBeCloseTo(-4, 6);
    expect(h.maxValue).toBeCloseTo(0, 6);
    expect(legendDate()).toBe('2024.01.03');
  });

  it('체결 마커: upTo 날짜까지만, 같은 날·같은 방향은 하나. upTo가 바뀌면 다시 넣는다', async () => {
    const { rerender } = render(EquityChart, props(2));
    await vi.waitFor(() => expect(series().markers).toHaveLength(1));
    expect(series().markers).toEqual([{ time: days[1], position: 'belowBar', shape: 'arrowUp', color: '#5b47e0', text: '매수·추가' }]);
    await rerender(props(3));
    await vi.waitFor(() => expect(real()).toHaveLength(4));
    expect((series().markers as { text: string }[]).map((m) => m.text)).toEqual(['매수·추가', '익절']);
  });

  it('upTo가 숫자에서 undefined로 돌아오면 전체 점·마커 0개·세로축 자동으로 되돌린다', async () => {
    const { rerender } = render(EquityChart, props(1));
    await vi.waitFor(() => expect(real()).toHaveLength(2));
    await rerender(props(undefined));
    await vi.waitFor(() => expect(series().data).toHaveLength(5));
    expect(real()).toHaveLength(5);
    expect(series().markers).toEqual([]);
    expect(autoscale(0)).toBeUndefined();
    expect(autoscale(1)).toBeUndefined();
    expect(legendDate()).toBe('2024.01.05');
  });

  it('범례: 크로스헤어가 upTo 뒤 날짜면 무시하고 upTo 날짜, 앞 날짜면 그 날짜', async () => {
    // 가짜 차트는 setData 때 크로스헤어 구독자를 이 값으로 부른다
    lwcStubHooks.crosshairOnSetData = { time: days[4] as unknown as number };
    try {
      const { rerender } = render(EquityChart, props(2));
      await vi.waitFor(() => expect(real()).toHaveLength(3));
      expect(legendDate()).toBe('2024.01.03');
      lwcStubHooks.crosshairOnSetData = { time: days[1] as unknown as number };
      await rerender(props(3));
      await vi.waitFor(() => expect(legendDate()).toBe('2024.01.02'));
    } finally {
      lwcStubHooks.crosshairOnSetData = null;
    }
  });

  it('curves 모드에는 upTo를 쓰지 않는다', async () => {
    const points = [{ date: days[0], value: 10_000_000 }, { date: days[1], value: 11_000_000 }];
    render(EquityChart, { initial: 10_000_000, curves: [{ id: 'a', name: '① 선정만', color: ['--accent', '#5b47e0'] as [string, string], width: 2, dashed: false, points }], upTo: 0 });
    await vi.waitFor(() => expect(lwcCharts[0]?.series).toHaveLength(1));
    expect(real()).toHaveLength(2);
    expect(autoscale(0)).toBeUndefined();
  });
});
