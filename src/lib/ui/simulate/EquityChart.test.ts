// @vitest-environment jsdom
import { render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lwcCharts, resetLwcStub, ResizeObserverStub } from '../../chart/lwcStub';
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
