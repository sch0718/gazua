import { describe, expect, it } from 'vitest';
import type { StockMeta } from '../providers/types';
import { benchIdsFor, benchOfFor, benchShell } from './compose';
import type { BenchSeries } from './types';

const meta = (symbol: string, market: StockMeta['market']): StockMeta => ({
  symbol,
  name: symbol,
  market,
  securityType: 'STOCK',
  nxtSupported: false,
  krxSuspended: false,
  nxtSuspended: null,
  liquidationTrading: false,
});

describe('compose', () => {
  const series = new Map<string, BenchSeries>(
    ['KOSPI', 'KOSDAQ', '069500'].map((id) => [id, { ...benchShell(id), candles: [] }]),
  );
  const metas = new Map([
    ['A', meta('A', 'KOSPI')],
    ['B', meta('B', 'KOSDAQ')],
    ['C', meta('C', 'KR_ETC')],
  ]);

  it('auto uses the market index of each stock (KOSPI for the rest)', () => {
    const of = benchOfFor('AUTO', metas, series);
    expect(['A', 'B', 'C', 'X'].map((s) => of(s)?.id)).toEqual(['KOSPI', 'KOSDAQ', 'KOSPI', 'KOSPI']);
    expect(benchIdsFor('AUTO')).toEqual(['KOSPI', 'KOSDAQ']);
  });

  it('a fixed choice applies to every stock, and is null when not loaded', () => {
    expect(benchOfFor('069500', metas, series)('B')?.name).toBe('KODEX 200');
    expect(benchOfFor('229200', metas, series)('A')).toBeNull();
    expect(benchIdsFor('229200')).toEqual(['229200']);
  });

  it('shells: indexes are indexes, ETFs carry their market', () => {
    expect(benchShell('KOSDAQ')).toEqual({ id: 'KOSDAQ', name: 'KOSDAQ', kind: 'index', market: 'KOSDAQ' });
    expect(benchShell('229200')).toEqual({ id: '229200', name: 'KODEX 코스닥150', kind: 'etf', market: 'KOSDAQ' });
  });
});
