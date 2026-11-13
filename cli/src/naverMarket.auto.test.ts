import { expect, it } from 'vitest';
import { parseDayBars } from './naverMarket';

it('일봉의 고가·저가·거래량을 읽고 잘못된 선택 값만 뺀다', () => {
  expect(parseDayBars([
    { localDate: '20261113', openPrice: 100, closePrice: 110, highPrice: '120', lowPrice: 90, accumulatedTradingVolume: 0 },
    { localDate: '20261112', openPrice: 100, closePrice: 110, highPrice: 0, lowPrice: -1, accumulatedTradingVolume: -1 },
  ])).toEqual([
    { date: '2026-11-12', open: 100, close: 110 },
    { date: '2026-11-13', open: 100, close: 110, high: 120, low: 90, volume: 0 },
  ]);
});
