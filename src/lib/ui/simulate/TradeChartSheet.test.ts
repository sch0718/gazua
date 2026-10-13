// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Candle } from '../../data/metrics';
import { lwcCharts, resetLwcStub, ResizeObserverStub } from '../../chart/lwcStub';
import type { Trade } from '../../sim/types';
import TradeChartSheet from './TradeChartSheet.svelte';

vi.mock('lightweight-charts', async () => (await import('../../chart/lwcStub')).lwcModule());

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  resetLwcStub();
});
afterEach(() => vi.unstubAllGlobals());

// 2024-01-01부터 하루 간격 120봉. 날짜 = day(i)
const day = (i: number) => new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
const candles: Candle[] = Array.from({ length: 120 }, (_, i) => ({ t: Date.UTC(2024, 0, 1 + i), o: 100, h: 110, l: 90, c: 100 + i, v: 1 }));
const pattern = { a: 150, aDate: day(25), b: 120, l: 110, lDate: day(28) };

const buy = (i: number, extra: Partial<Trade> = {}): Trade => ({ date: day(i), symbol: 'X', kind: 'buy', price: 132_400, qty: 12, fee: 1, tax: 0, reason: 'B 돌파', pattern, ...extra });
const sell = (i: number, kind: Trade['kind'] = 'stop', extra: Partial<Trade> = {}): Trade => ({ date: day(i), symbol: 'X', kind, price: 125_780, qty: 12, fee: 1, tax: 0, reason: '손절', pnlPct: -5, ...extra });

function open(trade: Trade, trades: Trade[], c = candles, level: 'A' | 'B' | null = 'B') {
  const onclose = vi.fn();
  const r = render(TradeChartSheet, { open: true, trade, trades, candles: c, name: 'SK하이닉스', level, onclose });
  return { onclose, ...r };
}
const add = (i: number, extra: Partial<Trade> = {}) => buy(i, { kind: 'add', reason: '추가 매수', pattern: undefined, qty: 6, ...extra });
const summaryText = () => document.querySelector('.summary')?.textContent?.replace(/\s+/g, ' ').trim();
const series = () => lwcCharts[0].series[0];

describe('TradeChartSheet', () => {
  it('마커: 포지션 거래만, 같은 방향이 3봉 이내면 하나로 합친다(매수·추가)', async () => {
    // 매수 다음 날 추가 → 한 마커. 다른 포지션·종목은 제외
    const trades = [buy(30), add(31), sell(40, 'take', { qty: 18 }), buy(60), { ...buy(35), symbol: 'Y' }];
    open(trades[0], trades);
    await vi.waitFor(() => expect(series()?.markers).toHaveLength(2));
    expect(series().markers).toEqual([
      expect.objectContaining({ time: day(30), position: 'belowBar', shape: 'arrowUp', text: '매수·추가' }),
      expect.objectContaining({ time: day(40), position: 'aboveBar', shape: 'arrowDown', text: '익절' }),
    ]);
  });

  it('마커: 3봉 넘게 떨어지면 따로, 매도끼리도 합친다(익절·손절)', async () => {
    const trades = [buy(30), add(34), sell(40, 'take', { qty: 9 }), sell(42, 'stop', { qty: 9 })];
    open(trades[0], trades);
    await vi.waitFor(() => expect(series()?.markers).toHaveLength(3));
    expect((series().markers as { text: string }[]).map((m) => m.text)).toEqual(['매수', '추가', '익절·손절']);
  });

  it('가격 축 위·아래 여백: 마커·로고와 겹치지 않게', async () => {
    const trades = [buy(30), sell(50)];
    open(trades[0], trades);
    await vi.waitFor(() => expect(lwcCharts).toHaveLength(1));
    expect(lwcCharts[0].options.rightPriceScale).toMatchObject({ scaleMargins: { top: 0.12, bottom: 0.22 } });
  });

  it('가격선: 고른 돌파 기준선만 강조색, 다른 하나는 회색, L은 성긴 점선에 축 라벨 없음', async () => {
    const trades = [buy(30), sell(50)];
    open(trades[1], trades); // 매도 행을 눌러도 같은 시트
    await vi.waitFor(() => expect(series()?.priceLines).toHaveLength(3));
    expect(series().priceLines.map((p) => [p.title, p.price, p.color, p.lineStyle, p.axisLabelVisible])).toEqual([
      ['A', 150, '#676d77', 2, true],
      ['B', 120, '#5b47e0', 2, true],
      ['L', 110, '#676d77', 4, false],
    ]);
  });

  it('가격선: A를 골랐으면 A가 강조색, 돌파를 안 쓰면 둘 다 회색', async () => {
    const trades = [buy(30), sell(50)];
    const { unmount } = open(trades[0], trades, candles, 'A');
    await vi.waitFor(() => expect(series()?.priceLines).toHaveLength(3));
    expect(series().priceLines.map((p) => p.color)).toEqual(['#5b47e0', '#676d77', '#676d77']);
    unmount();
    resetLwcStub();
    open(trades[0], trades, candles, null);
    await vi.waitFor(() => expect(series()?.priceLines).toHaveLength(3));
    expect(series().priceLines.map((p) => p.color)).toEqual(['#676d77', '#676d77', '#676d77']);
  });

  it('범위: aDate 20봉 전 ~ 전량 매도 20봉 뒤', async () => {
    const trades = [buy(30), sell(50)];
    open(trades[0], trades);
    await vi.waitFor(() => expect(series()?.data.length).toBeGreaterThan(0));
    const data = series().data as { time: string; value: number }[];
    expect(data[0]).toEqual({ time: day(5), value: 105 });
    expect(data.at(-1)).toEqual({ time: day(70), value: 170 });
    expect(data).toHaveLength(66);
  });

  it('보유 중이면 끝은 마지막 봉, 앞쪽은 경계에서 자른다', async () => {
    const early = { ...pattern, aDate: day(10) };
    const trades = [buy(12, { pattern: early })];
    open(trades[0], trades);
    await vi.waitFor(() => expect(series()?.data.length).toBeGreaterThan(0));
    const data = series().data as { time: string }[];
    expect(data[0].time).toBe(day(0));
    expect(data.at(-1)?.time).toBe(day(119));
  });

  it('전량 매도 뒤 20봉이 배열 끝을 넘으면 끝에서 자른다', async () => {
    const trades = [buy(30), sell(110)];
    open(trades[0], trades);
    await vi.waitFor(() => expect(series()?.data.length).toBeGreaterThan(0));
    expect((series().data as { time: string }[]).at(-1)?.time).toBe(day(119));
  });

  it('첫 x 라벨이 왼쪽 끝에서 잘리지 않게 앞쪽에 빈 봉 몇 개만큼 여백을 둔다', async () => {
    const trades = [buy(30), sell(50)];
    open(trades[0], trades);
    await vi.waitFor(() => expect(series()?.data.length).toBe(66));
    const r = lwcCharts[0].visibleRange;
    if (r === null || r === 'fit') throw new Error(String(r));
    expect(r.from).toBeLessThanOrEqual(-3);
    expect(r.to).toBeGreaterThanOrEqual(65);
  });

  it('요약: 첫 매수와 해가 다른 단계는 YY.MM.DD', async () => {
    // 2024-12-01부터 60봉
    const c: Candle[] = Array.from({ length: 60 }, (_, i) => ({ t: Date.UTC(2024, 11, 1 + i), o: 100, h: 110, l: 90, c: 100, v: 1 }));
    const d = (i: number) => new Date(Date.UTC(2024, 11, 1 + i)).toISOString().slice(0, 10);
    const trades = [buy(0, { date: d(20), pattern: undefined }), sell(0, 'stop', { date: d(40) })];
    open(trades[0], trades, c);
    expect(summaryText()).toBe('매수 12.21 132,400원 → 손절 25.01.10 125,780원 · ▼ −5.0%');
  });

  it('제목은 종목명 · 매수일, 요약은 MM.DD 단계(줄바꿈 없는 묶음) + 끝에 결과', async () => {
    const trades = [buy(30), sell(50)];
    open(trades[1], trades);
    expect(screen.getByRole('dialog', { name: 'SK하이닉스 · 24.01.31 매수' })).toBeTruthy();
    expect(summaryText()).toBe('매수 01.31 132,400원 → 손절 02.20 125,780원 · ▼ −5.0%');
    const steps = [...document.querySelectorAll('.summary .step')].map((e) => e.textContent?.trim());
    expect(steps).toEqual(['매수 01.31 132,400원', '손절 02.20 125,780원', '▼ −5.0%']);
    expect(document.querySelector('.summary .step:last-child')?.className).toContain('down');
    expect(document.querySelector('.plot')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('결과는 포지션 전체(추가·분할 매도 포함), 보유 중이면 보유 중', async () => {
    // 100주 @100 + 100주 @80 = 18,000 → 100주 @99 + 100주 @108 = 20,700 → +15.0%
    const trades = [
      buy(30, { price: 100, qty: 100 }),
      add(36, { price: 80, qty: 100 }),
      sell(40, 'take', { price: 99, qty: 100 }),
      sell(50, 'take', { price: 108, qty: 100 }),
    ];
    const { unmount } = open(trades[0], trades);
    expect(summaryText()).toMatch(/ · ▲ \+15\.0%$/);
    unmount();
    const holding = [buy(30)];
    open(holding[0], holding);
    expect(summaryText()).toBe('매수 01.31 132,400원 · 보유 중');
  });

  it('요약에 매수 줄 A·B·L 가격, pattern이 없으면 그 줄은 없다', async () => {
    const trades = [buy(30), sell(50)];
    const { unmount } = open(trades[0], trades);
    expect(screen.getByText('A 150원 · B 120원 · L 110원')).toBeTruthy();
    unmount();
    const plain = [buy(30, { pattern: undefined }), sell(50)];
    open(plain[0], plain);
    expect(screen.queryByText(/^A .*원 · B .*원 · L .*원$/)).toBeNull();
  });

  it('닫으면 차트를 정리한다', async () => {
    const trades = [buy(30), sell(50)];
    const { onclose, rerender } = open(trades[0], trades);
    await vi.waitFor(() => expect(lwcCharts).toHaveLength(1));
    expect(lwcCharts[0].removed).toBe(false);
    await fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(onclose).toHaveBeenCalled();
    await rerender({ open: false, trade: null, trades, candles, name: 'SK하이닉스', level: 'B', onclose });
    await vi.waitFor(() => expect(lwcCharts[0].removed).toBe(true));
  });

  it('언마운트해도 정리한다', async () => {
    const trades = [buy(30)];
    const { unmount } = open(trades[0], trades);
    await vi.waitFor(() => expect(lwcCharts).toHaveLength(1));
    unmount();
    expect(lwcCharts[0].removed).toBe(true);
  });
});
