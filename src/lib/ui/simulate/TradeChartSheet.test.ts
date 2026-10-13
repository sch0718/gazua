// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Candle } from '../../data/metrics';
import { lwcCharts, ResizeObserverStub } from '../../chart/lwcStub';
import type { Trade } from '../../sim/types';
import TradeChartSheet from './TradeChartSheet.svelte';

vi.mock('lightweight-charts', async () => (await import('../../chart/lwcStub')).lwcModule());

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  lwcCharts.length = 0;
});
afterEach(() => vi.unstubAllGlobals());

// 2024-01-01부터 하루 간격 120봉. 날짜 = day(i)
const day = (i: number) => new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
const candles: Candle[] = Array.from({ length: 120 }, (_, i) => ({ t: Date.UTC(2024, 0, 1 + i), o: 100, h: 110, l: 90, c: 100 + i, v: 1 }));
const pattern = { a: 150, aDate: day(25), b: 120, l: 110, lDate: day(28) };

const buy = (i: number, extra: Partial<Trade> = {}): Trade => ({ date: day(i), symbol: 'X', kind: 'buy', price: 132_400, qty: 12, fee: 1, tax: 0, reason: 'B 돌파', pattern, ...extra });
const sell = (i: number, kind: Trade['kind'] = 'stop', extra: Partial<Trade> = {}): Trade => ({ date: day(i), symbol: 'X', kind, price: 125_780, qty: 12, fee: 1, tax: 0, reason: '손절', pnlPct: -5, ...extra });

function open(trade: Trade, trades: Trade[], c = candles) {
  const onclose = vi.fn();
  const r = render(TradeChartSheet, { open: true, trade, trades, candles: c, name: 'SK하이닉스', onclose });
  return { onclose, ...r };
}
const series = () => lwcCharts[0].series[0];

describe('TradeChartSheet', () => {
  it('마커 수 = 포지션 거래 수, 다른 포지션·종목은 제외', async () => {
    const trades = [buy(30), buy(32, { kind: 'add', reason: '추가', pattern: undefined, qty: 6 }), sell(40, 'take', { qty: 18 }), buy(60), { ...buy(35), symbol: 'Y' }];
    open(trades[0], trades);
    await vi.waitFor(() => expect(series()?.markers).toHaveLength(3));
    expect(series().markers).toEqual([
      expect.objectContaining({ position: 'belowBar', shape: 'arrowUp', text: '매수' }),
      expect.objectContaining({ position: 'belowBar', shape: 'arrowUp', text: '추가' }),
      expect.objectContaining({ position: 'aboveBar', shape: 'arrowDown', text: '익절' }),
    ]);
  });

  it('A·B·L 점선 가격선은 매수 줄 pattern 값', async () => {
    const trades = [buy(30), sell(50)];
    open(trades[1], trades); // 매도 행을 눌러도 같은 시트
    await vi.waitFor(() => expect(series()?.priceLines).toHaveLength(3));
    expect(series().priceLines.map((p) => [p.title, p.price, p.lineStyle])).toEqual([
      ['A', 150, 2],
      ['B', 120, 2],
      ['L', 110, 2],
    ]);
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

  it('제목은 종목명, 스크린리더용 요약 문장', async () => {
    const trades = [buy(30), sell(50)];
    open(trades[0], trades);
    expect(screen.getByRole('dialog', { name: 'SK하이닉스' })).toBeTruthy();
    expect(screen.getByText('매수 1.31 132,400원 → 손절 2.20 125,780원')).toBeTruthy();
    expect(document.querySelector('.plot')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('img')).toBeNull();
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
    await rerender({ open: false, trade: null, trades, candles, name: 'SK하이닉스', onclose });
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
