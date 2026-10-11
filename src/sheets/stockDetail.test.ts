import { describe, expect, it } from 'vitest';
import type { Candle } from '../lib/data/metrics';
import { sessionsForDay } from '../lib/market/sessions';
import type { Quote, StockMeta } from '../lib/providers/types';
import { kstEpoch } from '../lib/time/kst';
import type { SnapshotSeries } from '../lib/ui/compare/compareController.svelte';
import { detailView, quoteVenuesFor, type DetailInput } from './stockDetail';

const DAY = '2026-10-12';
const at = (hhmm: string) => kstEpoch(DAY, `${hhmm}:00`);
const sessions = sessionsForDay({ date: DAY, isOpen: true });

const meta = (p: Partial<StockMeta> = {}): StockMeta => ({
  symbol: '005930',
  name: '삼성전자',
  market: 'KOSPI',
  securityType: 'STOCK',
  nxtSupported: true,
  krxSuspended: false,
  nxtSuspended: null,
  liquidationTrading: false,
  ...p,
});
const candle = (t: number, c: number): Candle => ({ t, o: c, h: c, l: c, c, v: 1 });
const series = (p: Partial<SnapshotSeries> = {}): SnapshotSeries => ({
  symbol: '005930',
  tradingDate: DAY,
  base: 70_000,
  avgDailyVolume: null,
  candles: [candle(at('09:00'), 70_500), candle(at('10:00'), 71_400)],
  daily: [candle(kstEpoch('2026-10-08', '00:00:00'), 69_000), candle(kstEpoch(DAY, '00:00:00'), 71_200)],
  segments: [],
  intervals: [],
  computedAt: at('10:00'),
  stale: false,
  ...p,
});
const quote = (venue: Quote['venue'], price: number): Quote => ({ symbol: '005930', venue, price, ts: null });

const input = (p: Partial<DetailInput> = {}): DetailInput => ({
  meta: meta(),
  series: series(),
  quotes: { KRX: quote('KRX', 71_200), NXT: quote('NXT', 71_350) },
  venues: ['KRX', 'NXT', 'UNIFIED'],
  venueMode: 'AUTO',
  sessions,
  isOpenToday: true,
  now: at('10:00'),
  ...p,
});

describe('detailView — timetable', () => {
  it('lists the AUTO intervals of an NXT stock with labels and marks the current one', () => {
    const v = detailView(input());
    expect(v.timetable.map((r) => `${r.label} ${r.range}`)).toEqual([
      'NXT 프리 08:00–08:50',
      'KRX 시가 단일가 08:50–09:00',
      'KRX 정규 09:00–15:20',
      'KRX 종가 단일가 15:20–15:30',
      'NXT 종가 단일가 15:30–15:40',
      'NXT 애프터 15:40–16:00',
      'KRX 애프터 16:00–20:00',
    ]);
    expect(v.timetable.filter((r) => r.now).map((r) => r.label)).toEqual(['KRX 정규']);
  });

  it('an ETF without NXT has neither NXT rows nor the KRX after-market', () => {
    const v = detailView(input({ meta: meta({ securityType: 'ETF', nxtSupported: false }), now: at('17:00') }));
    expect(v.timetable.map((r) => r.label)).toEqual(['KRX 시가 단일가', 'KRX 정규', 'KRX 종가 단일가']);
    expect(v.timetable.some((r) => r.now)).toBe(false);
  });

  it('a closed day has no rows', () => {
    expect(detailView(input({ isOpenToday: false, sessions: [] })).timetable).toEqual([]);
  });
});

describe('detailView — prices', () => {
  it('during the regular session: big price from the auto venue, KRX close says 장중', () => {
    const v = detailView(input());
    expect(v.sub).toBe('KRX 정규 · 지금 KRX 가격 · 자동(KRX 우선)');
    expect(v.price).toBe(71_200);
    expect(v.change).toBeCloseTo((71_200 / 70_000 - 1) * 100);
    expect(v.cells.map((c) => [c.label, c.value, c.current])).toEqual([
      ['KRX 정규 종가', '장중', false],
      ['KRX 현재', '71,200', true],
      ['NXT', '71,350', false],
    ]);
  });

  it('in the NXT after-market the NXT price leads and the KRX cell is the after-market after 16:00', () => {
    expect(detailView(input({ now: at('15:45') })).sub).toBe('NXT 애프터 · 지금 NXT 가격 · 자동(KRX 우선)');
    expect(detailView(input({ now: at('15:45') })).price).toBe(71_350);
    const v = detailView(input({ now: at('17:00') }));
    expect(v.cells.map((c) => [c.label, c.value])).toEqual([
      ['KRX 정규 종가', '71,200'],
      ['KRX 애프터', '71,200'],
      ['NXT', '71,350'],
    ]);
  });

  it('before the open the KRX close is the previous day close; in a gap the sub has no venue', () => {
    expect(detailView(input({ now: at('07:00') })).cells[0].value).toBe('69,000');
    expect(detailView(input({ now: at('07:00') })).sub).toBe('장 시작 전 · 자동(KRX 우선)');
    expect(detailView(input({ now: at('15:35') })).sub).toBe('NXT 종가 단일가 · 자동(KRX 우선)');
    expect(detailView(input({ now: at('21:00') })).sub).toBe('장 마감 · 자동(KRX 우선)');
    expect(detailView(input({ isOpenToday: false, sessions: [] })).sub).toBe('휴장 · 자동(KRX 우선)');
  });

  it('an NXT-unsupported stock shows 미지원 in the NXT cell', () => {
    const v = detailView(input({ meta: meta({ nxtSupported: false }), quotes: { KRX: quote('KRX', 1) } }));
    expect(v.cells[2]).toMatchObject({ label: 'NXT', value: '미지원' });
  });

  it('a unified-only provider (Toss) shows one 통합 cell and no AUTO note', () => {
    const v = detailView(input({ venues: ['UNIFIED'], quotes: { UNIFIED: quote('UNIFIED', 71_300) } }));
    expect(v.cells.map((c) => [c.label, c.value])).toEqual([['통합', '71,300']]);
    expect(v.price).toBe(71_300);
    expect(v.sub).toBe('KRX 정규 · 지금 통합 가격');
  });

  it('without a quote the big price falls back to the last candle', () => {
    expect(detailView(input({ quotes: {} })).price).toBe(71_400);
  });

  it('a stale snapshot shows its badge and the snapshot price, not the live quote', () => {
    const v = detailView(input({ series: series({ stale: true, computedAt: at('17:20') }), now: at('17:40') }));
    expect(v.stale?.text).toBe('17:20 기준');
    expect(v.price).toBe(71_400);
    expect(detailView(input()).stale).toBeNull();
  });
});

describe('detailView — status', () => {
  it('names suspensions and liquidation trading', () => {
    expect(detailView(input()).status).toBe('정상 거래');
    expect(detailView(input({ meta: meta({ krxSuspended: true }) })).status).toBe('KRX 거래정지');
    expect(detailView(input({ meta: meta({ nxtSuspended: true }) })).status).toBe('NXT 거래정지');
    expect(detailView(input({ meta: meta({ liquidationTrading: true }) })).status).toBe('정리매매');
  });
});

describe('quoteVenuesFor', () => {
  it('KRX and NXT for split providers (NXT only if supported), else UNIFIED', () => {
    expect(quoteVenuesFor(['KRX', 'NXT', 'UNIFIED'], true)).toEqual(['KRX', 'NXT']);
    expect(quoteVenuesFor(['KRX', 'NXT', 'UNIFIED'], false)).toEqual(['KRX']);
    expect(quoteVenuesFor(['UNIFIED'], true)).toEqual(['UNIFIED']);
  });
});
