// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionsForDay } from '../market/sessions';
import { kstEpoch } from '../time/kst';
import CompareChartFixture from './CompareChartFixture.svelte';
import { toChartTime, type ChartSeriesInput } from './lineData';
import { lwcCharts, lwcStubHooks, ResizeObserverStub } from './lwcStub';

vi.mock('lightweight-charts', async () => (await import('./lwcStub')).lwcModule());

const DAY = '2026-10-12';
const at = (hhmm: string) => kstEpoch(DAY, `${hhmm}:00`);
const sessions = sessionsForDay({ date: DAY, isOpen: true });
const input = (id: string, slot: ChartSeriesInput['slot']): ChartSeriesInput => ({
  id,
  slot,
  label: id,
  points: [
    { t: at('09:00'), v: 1 },
    { t: at('09:01'), v: 2 },
  ],
  intervals: [{ start: at('09:00'), end: at('15:20'), venue: 'KRX', kind: 'continuous' }],
  hidden: false,
});

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  lwcCharts.length = 0;
});
afterEach(() => {
  lwcStubHooks.crosshairOnSetData = null;
  vi.unstubAllGlobals();
});

describe('CompareChart crosshair during a rebuild', () => {
  it('a crosshair event fired inside setData neither loops nor makes the rebuild depend on scrub state', async () => {
    lwcStubHooks.crosshairOnSetData = { time: toChartTime(at('09:01')) };
    const { rerender } = render(CompareChartFixture, { series: [input('A', 1), input('B', 2)], sessions });
    await vi.waitFor(() => expect(lwcCharts[0]?.addSeriesCalls).toBe(4));
    // 콜백은 리빌드가 끝난 뒤 전달된다.
    await vi.waitFor(() => expect(screen.getByTestId('scrub').textContent).toMatch(new RegExp(`^${at('09:01')}\\|A,B\\|`)));
    await new Promise((r) => setTimeout(r, 20));
    expect(lwcCharts[0].addSeriesCalls).toBe(4);

    // 부모의 스크럽 상태가 바뀌어도 시리즈를 다시 만들지 않는다.
    await fireEvent.click(screen.getByRole('button', { name: 'scrub' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(lwcCharts[0].addSeriesCalls).toBe(4);

    // 입력이 바뀌면 한 번만 다시 만든다(이전 시리즈 제거 중의 이벤트도 루프를 만들지 않는다).
    await rerender({ series: [input('A', 1)], sessions });
    await new Promise((r) => setTimeout(r, 20));
    expect(lwcCharts[0].addSeriesCalls).toBe(6);
    expect(lwcCharts[0].series).toHaveLength(2);
  });
});

describe('CompareChart semantics', () => {
  it('labels the plot as a group, not an image, so the library’s focusable attribution link stays valid', () => {
    render(CompareChartFixture, { series: [input('A', 1)], sessions });
    expect(screen.getByRole('group', { name: '종목 비교 차트' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: '종목 비교 차트' })).toBeNull();
  });
});

describe('CompareChart start value', () => {
  it('unit x: the dotted line before the first value sits on the 1.0 baseline, not 0', async () => {
    const late: ChartSeriesInput = { ...input('A', 1), points: [{ t: at('10:00'), v: 1.4 }] };
    render(CompareChartFixture, { series: [late], sessions, unit: 'x' });
    await vi.waitFor(() => expect(lwcCharts[0]?.series.length).toBeGreaterThan(0));
    const dotted = lwcCharts[0].series[0].data as { time: number; value?: number }[];
    expect(dotted.find((d) => d.time === toChartTime(at('09:30')))?.value).toBe(1);
  });
});

describe('CompareChart zoom and pan (spec §7.6: 두 손가락 = 확대, 가로 스와이프 = 이동)', () => {
  const laneRects = (c: HTMLElement) =>
    [...c.querySelectorAll('g[data-lane] rect')].map((r) => ({
      label: r.getAttribute('aria-label'),
      x: Number(r.getAttribute('x')),
      w: Number(r.getAttribute('width')),
    }));

  it('enables pinch zoom and horizontal touch/mouse drag, but not the mouse wheel or vertical touch drag', async () => {
    render(CompareChartFixture, { series: [input('A', 1)], sessions });
    await vi.waitFor(() => expect(lwcCharts[0]?.addSeriesCalls).toBe(2));
    expect(lwcCharts[0].options.handleScroll).toEqual({ horzTouchDrag: true, vertTouchDrag: false, pressedMouseMove: true, mouseWheel: false });
    expect(lwcCharts[0].options.handleScale).toEqual({ pinch: true, mouseWheel: false, axisPressedMouseMove: false, axisDoubleClickReset: true });
  });

  it('session lanes follow a visible-range change and stay inside the plot; the chart unsubscribes on destroy', async () => {
    const { container, unmount } = render(CompareChartFixture, { series: [input('A', 1)], sessions });
    const chart = lwcCharts[0];
    chart.scale = { offset: 0, spacing: 300 / 720 };
    await vi.waitFor(() => expect(laneRects(container).length).toBeGreaterThan(0));
    const krx = () => laneRects(container).find((r) => r.label === 'KRX 09:00–15:20')!;
    const before = krx().x;

    // 두 배 확대하고 오른쪽으로 옮긴 것처럼: 08:00이 왼쪽 밖으로 나간다.
    chart.scale = { offset: -150, spacing: 600 / 720 };
    chart.fireVisibleRange();
    await vi.waitFor(() => expect(krx().x).not.toBe(before));
    for (const r of laneRects(container)) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(300);
    }

    expect(chart.rangeSubscribers).toBe(1);
    expect(chart.sizeSubscribers).toBe(1);
    unmount();
    expect(chart.rangeSubscribers).toBe(0);
    expect(chart.sizeSubscribers).toBe(0);
  });

  it('end labels outside the visible plot are hidden', async () => {
    const { container } = render(CompareChartFixture, { series: [input('A', 1)], sessions });
    const chart = lwcCharts[0];
    chart.priceToY = () => 50;
    chart.timeToX = () => 120;
    chart.fireVisibleRange();
    await vi.waitFor(() => expect(container.querySelector('.end-label')?.textContent).toBe('A'));
    chart.timeToX = () => 420; // 이동해서 마지막 점이 오른쪽 밖으로 나갔다
    chart.fireVisibleRange();
    await vi.waitFor(() => expect(container.querySelector('.end-label')).toBeNull());
  });

  it('a rebuild of the same data set keeps the user’s zoom; a different data set fits again', async () => {
    const { rerender } = render(CompareChartFixture, { series: [input('A', 1)], sessions });
    await vi.waitFor(() => expect(lwcCharts[0]?.addSeriesCalls).toBe(2));
    const chart = lwcCharts[0];
    expect(chart.visibleRange).toEqual({ from: -0.5, to: 719.5 });
    chart.visibleRange = { from: 100, to: 200 }; // 사용자가 확대했다

    await rerender({ series: [input('A', 1)], sessions }); // 주기 갱신: 새 배열, 같은 종목
    await vi.waitFor(() => expect(chart.addSeriesCalls).toBe(4));
    expect(chart.visibleRange).toEqual({ from: 100, to: 200 });

    await rerender({ series: [input('A', 1), input('B', 2)], sessions }); // 종목이 바뀌었다
    await vi.waitFor(() => expect(chart.addSeriesCalls).toBe(8));
    expect(chart.visibleRange).toEqual({ from: -0.5, to: 719.5 });
  });
});
