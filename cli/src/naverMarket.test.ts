import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { kstEpoch } from '../../src/lib/time/kst';
import { fakeFetch } from './testing';
import { NAVER, NAVER_UA, naverGet, parseDayBars, parseDomesticWeek, parseFuturesWeek, parseIndexQuote, parseMarketStatus } from './naverMarket';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/naver/${name}.json`, import.meta.url), 'utf8'));

describe('네이버 응답 정규화', () => {
  it('국내 봉은 KST 표기 시각에 10분을 더하고 정렬한다', () => {
    const bars = parseDomesticWeek(fixture('item-week'));
    expect(bars[0]).toEqual({ end: kstEpoch('2026-11-05', '09:10:00'), close: 1315000 });
    expect(bars.every((b, i) => !i || b.end > bars[i - 1].end)).toBe(true);
  });
  it('CST6CDT를 서머타임이 있는 중부 시간대로 읽는다', () => {
    const bars = parseFuturesWeek(fixture('es-week'));
    expect(bars.find((b) => b.end === kstEpoch('2026-11-10', '10:10:00'))?.close).toBe(7576.75);
    const summer = { zoneId: 'CST6CDT', priceInfos: { '20260701': [{ localDateTime: '20260701190000', currentPrice: 100 }] } };
    expect(parseFuturesWeek(summer)[0].end).toBe(kstEpoch('2026-07-02', '09:10:00'));
  });
  it.each(['es-day', 'item-day'])('일봉 %s의 날짜와 시가를 읽는다', (name) => {
    const bars = parseDayBars(fixture(name));
    expect(bars.length).toBeGreaterThan(500);
    expect(bars[0].date).toBe('2024-09-02');
    expect(bars[0].open).toBeGreaterThan(0);
    expect(bars.every((b, i) => !i || b.date > bars[i - 1].date)).toBe(true);
  });
  it('달러 응답의 fluctuations를 우선하고 쉼표 숫자와 ISO 시각을 읽는다', () => {
    expect(parseIndexQuote(fixture('dxy'))).toEqual({ changePct: 0.03, changeAbs: 0.03, tradedAt: Date.parse('2026-11-10T21:50:45-05:00') });
    expect(parseIndexQuote({ fluctuationsRatio: '1,234.5', fluctuations: 2, compareToPreviousClosePrice: 9 })).toEqual({ changePct: 1234.5, changeAbs: 2, tradedAt: null });
    expect(parseIndexQuote({ compareToPreviousClosePrice: '-1,234.5' }).changeAbs).toBe(-1234.5);
    expect(parseMarketStatus(fixture('kospi-polling'))).toBe('OPEN');
  });
  it.each([null, {}, [], { priceInfos: [] }])('모양이 다른 입력은 던지지 않는다: %j', (raw) => {
    expect(parseDomesticWeek(raw)).toEqual([]);
    expect(parseFuturesWeek(raw)).toEqual([]);
    expect(parseDayBars(raw)).toEqual([]);
    expect(parseMarketStatus(raw)).toBeNull();
    expect(parseIndexQuote(raw)).toEqual({ changePct: null, changeAbs: null, tradedAt: null });
  });
  it('UA를 붙이고 요청 전에 100ms를 쉰다. HTTP 오류에는 상태만 남긴다', async () => {
    const events: string[] = [];
    const fetch = fakeFetch((c) => { events.push('요청'); expect(c.headers.get('user-agent')).toBe(NAVER_UA); return { body: { a: 1 } }; });
    const ctx = { fetch, sleep: async (ms: number) => { events.push(`대기 ${ms}`); } };
    expect(await naverGet(ctx, NAVER.futuresWeek('ES'))).toEqual({ a: 1 });
    expect(events).toEqual(['대기 100', '요청']);
    await expect(naverGet({ ...ctx, fetch: fakeFetch(() => ({ status: 503 })) }, NAVER.kospiStatus)).rejects.toThrow('naver 503');
  });
});
