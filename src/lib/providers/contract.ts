// 공급자 계약 테스트. 테스트 파일에서만 import한다(vitest 의존).
import { beforeEach, describe, expect, it } from 'vitest';
import type { Candle } from '../data/metrics';
import { addDays, kstMinuteOfDay, kstWeekday } from '../time/kst';
import type { MarketDataProvider } from './types';

function expectAscendingUnique(candles: Candle[]): void {
  for (let i = 1; i < candles.length; i++) {
    expect(candles[i].t, `candles[${i}].t must be > candles[${i - 1}].t`).toBeGreaterThan(candles[i - 1].t);
  }
}

/** 모든 공급자가 지켜야 하는 계약. fixturesDay는 1분봉·일봉 검사에 쓰는 거래일(KST). */
export function runProviderContract(name: string, make: () => MarketDataProvider, fixturesDay: string): void {
  describe(`provider contract: ${name}`, () => {
    let provider: MarketDataProvider;
    beforeEach(() => {
      provider = make();
    });
    // KRX만 지원하지 않는 공급자(토스: UNIFIED 전용)도 있으므로 기본 거래소는 지원 목록에서 고른다.
    const primaryVenue = () =>
      provider.capabilities.venues.includes('KRX') ? 'KRX' : provider.capabilities.venues[0];

    it('declares at least one venue and a positive quote batch size', () => {
      expect(provider.capabilities.venues.length).toBeGreaterThan(0);
      expect(provider.capabilities.quoteBatchSize).toBeGreaterThan(0);
    });

    it('returns 1m candles in strictly ascending order within 08:00-19:59 KST', async () => {
      for (const venue of provider.capabilities.venues) {
        const candles = await provider.getCandles({
          symbol: '005930',
          venue,
          interval: '1m',
          from: fixturesDay,
          to: fixturesDay,
        });
        expectAscendingUnique(candles);
        for (const c of candles) {
          const m = kstMinuteOfDay(c.t);
          expect(m).toBeGreaterThanOrEqual(480);
          expect(m).toBeLessThanOrEqual(1199);
          expect(c.t % 60_000).toBe(0);
          expect(c.h).toBeGreaterThanOrEqual(c.l);
          expect(c.v).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('returns 1m candles for the fixtures day on the primary venue', async () => {
      const candles = await provider.getCandles({
        symbol: '005930',
        venue: primaryVenue(),
        interval: '1m',
        from: fixturesDay,
        to: fixturesDay,
      });
      expect(candles.length).toBeGreaterThan(0);
    });

    it('returns 1d candles in ascending order stamped at KST midnight', async () => {
      const candles = await provider.getCandles({
        symbol: '005930',
        venue: primaryVenue(),
        interval: '1d',
        from: addDays(fixturesDay, -14),
        to: fixturesDay,
      });
      expect(candles.length).toBeGreaterThan(0);
      expectAscendingUnique(candles);
      for (const c of candles) expect(kstMinuteOfDay(c.t)).toBe(0);
    });

    it('preserves symbol order in getStockMeta and reports nxtSupported as boolean', async () => {
      const metas = await provider.getStockMeta(['005930', '069500']);
      expect(metas.map((m) => m.symbol)).toEqual(['005930', '069500']);
      for (const m of metas) expect(typeof m.nxtSupported).toBe('boolean');
    });

    it('getStockMeta returns only requested symbols, in request order, each at most once', async () => {
      const requested = ['069500', '005930', '000660'];
      const got = (await provider.getStockMeta(requested)).map((m) => m.symbol);
      // 받지 못한 종목은 빠질 수 있지만(행 단위 오류), 순서는 요청 순서의 부분열이어야 한다.
      expect(got).toEqual(requested.filter((s) => got.includes(s)));
      expect(new Set(got).size).toBe(got.length);
    });

    it('returns exactly one quote per requested symbol', async () => {
      const symbols = ['005930', '000660', '069500'];
      const quotes = await provider.getQuotes(symbols, primaryVenue());
      expect(quotes).toHaveLength(symbols.length);
    });

    it('marks weekends closed in getTradingDays', async () => {
      const days = await provider.getTradingDays('2026-10-05', '2026-10-11');
      expect(days.length).toBeGreaterThan(0);
      for (const d of days) {
        if (kstWeekday(d.date) === 0 || kstWeekday(d.date) === 6) expect(d.isOpen).toBe(false);
      }
    });

    it('returns index candles in ascending order when supported', async () => {
      if (!provider.capabilities.hasIndexCandles || !provider.getIndexCandles) return;
      const candles = await provider.getIndexCandles('KOSPI', '1d', addDays(fixturesDay, -14), fixturesDay);
      expectAscendingUnique(candles);
    });
  });
}
