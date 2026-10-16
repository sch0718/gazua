import { describe, expect, it } from 'vitest';
import { newCriteria } from '../../screen/defaults';
import type { ValidationResult } from '../../screen/runValidation';
import { NOW } from '../../screen/testData';
import { kstEpoch } from '../../time/kst';
import {
  CONDITION_HELP,
  criteriaLine,
  dataAgeDays,
  lastResultSummary,
  MACRO_GAP_TEXT,
  MACRO_LAG_TEXT,
  macroBetaHelp,
  macroTrendHelp,
  macroValueLines,
  NEED_RECOLLECT_TEXT,
  nextCriteriaName,
  poolScopeText,
  STALE_DAYS,
  staleText,
  THEME_SNAPSHOT_TEXT,
} from './screenText';

const stats = (totalPct: number) => ({ totalPct, cagrPct: 0, mddPct: 0, volPct: 0 });

describe('screenText', () => {
  it('summarizes the default criteria in the spec 7.2 form', () => {
    expect(criteriaLine(newCriteria(NOW, null))).toBe('KOSPI·KOSDAQ 주식 · 거래대금 10억↑ · 반등 10일 · 상위 10 · 매월');
  });

  it('summary follows the pool, the on conditions, the take and the rebalance', () => {
    const c = newCriteria(NOW, null);
    c.pool = { markets: ['KOSDAQ'], types: ['STOCK', 'ETF'], excludeManaged: true, sectors: ['001', '002'], themes: [], baskets: [] };
    c.conditions.tradingValue.on = false;
    c.conditions.rebound.on = false;
    c.conditions.marketCap.on = true;
    c.conditions.vsMa = { on: true, period: 60, side: 'above' };
    c.rank.take = 5;
    c.rebalance = 'quarterly';
    expect(criteriaLine(c)).toBe('KOSDAQ 주식·ETF · 업종 2개 · 시총 1,000억↑ · 60일선 위 · 상위 5 · 분기');
  });

  it('counts sectors by (level, name) row when the sector list is given (R10)', () => {
    const c = newCriteria(NOW, null);
    c.pool.sectors = ['00013', '11028', '00016'];
    const sectors = [
      { code: '00013', name: '전기·전자', level: 1 as const },
      { code: '11028', name: '전기·전자', level: 1 as const },
      { code: '00016', name: '금융', level: 1 as const },
    ];
    expect(criteriaLine(c, sectors)).toContain('업종 2개');
    expect(criteriaLine(c)).toContain('업종 3개');
  });

  it('no on conditions say so', () => {
    const c = newCriteria(NOW, null);
    c.conditions.tradingValue.on = false;
    c.conditions.rebound.on = false;
    expect(criteriaLine(c)).toBe('KOSPI·KOSDAQ 주식 · 조건 없음 · 상위 10 · 매월');
  });

  it('keeps the condition help copy of spec 7.3 verbatim', () => {
    expect(CONDITION_HELP).toEqual({
      marketCap: '회사 전체의 값어치예요. 클수록 큰 회사예요.',
      tradingValue: '하루에 거래된 금액이에요. 크면 사고팔기 쉬워요.',
      leader: '같은 업종에서 시가총액이 몇 등 안에 드는지예요.',
      returnRange: '최근 며칠 동안 얼마나 오르거나 내렸는지예요.',
      vsMa: '최근 며칠 평균 가격보다 위에 있는지예요. 위면 오르는 흐름이에요.',
      fromHigh: '1년 중 가장 높았던 가격에서 얼마나 내려와 있는지예요.',
      volatility: '하루 가격이 얼마나 출렁이는지예요. 작을수록 잔잔해요.',
      rebound: '하락이 이어지다 저점을 찍고 반등하는 내 매수 패턴이 최근에 나타났는지예요.',
    });
  });

  it('data age counts calendar days from the collection date, and stale text matches the spec', () => {
    const now = kstEpoch('2026-11-20', '10:00:00');
    expect(dataAgeDays('2026-10-16T09:00:00+09:00', now)).toBe(35);
    expect(dataAgeDays('garbage', now)).toBeNull();
    expect(STALE_DAYS).toBe(30);
    expect(staleText(35)).toBe('데이터가 35일 전 것이에요. 최근 기간은 검증에 빠져요');
  });

  it('last result summary carries ① and the first index with stats; no index stats leaves ① alone', () => {
    const base = { hold: { stats: stats(12.34) }, indices: [{ id: 'KOSPI', curve: [], stats: stats(8.06) }] } as unknown as ValidationResult;
    expect(lastResultSummary(base)).toEqual({ hold: 12.34, index: { id: 'KOSPI', pct: 8.06 } });
    const none = { hold: { stats: stats(-3.2) }, indices: [{ id: 'KOSPI', curve: null, stats: null }] } as unknown as ValidationResult;
    expect(lastResultSummary(none)).toEqual({ hold: -3.2, index: { id: 'KOSPI', pct: null, reason: '받지 못했어요' } });
    const later = { hold: { stats: stats(1) }, indices: [{ id: 'KOSPI', curve: null, reason: '기간 일부만 받았어요', stats: null }, { id: 'KOSDAQ', curve: [], stats: stats(5) }] } as unknown as ValidationResult;
    expect(lastResultSummary(later).index).toEqual({ id: 'KOSPI', pct: null, reason: '기간 일부만 받았어요' });
    expect(lastResultSummary({ hold: { stats: stats(1) }, indices: [] } as unknown as ValidationResult).index).toBeNull();
  });

  it('next name takes the smallest free number', () => {
    expect(nextCriteriaName([])).toBe('새 기준');
    expect(nextCriteriaName([{ name: '새 기준' }, { name: '새 기준 3' }])).toBe('새 기준 2');
  });
});

describe('screenText (stage 4)', () => {
  it('pool scope joins sectors, themes and baskets; nothing picked is 전체 업종', () => {
    const c = newCriteria(NOW, null);
    expect(poolScopeText(c.pool)).toBe('전체 업종');
    c.pool.themes = ['T1', 'T2'];
    c.pool.baskets = ['b1'];
    expect(poolScopeText(c.pool)).toBe('테마 2·묶음 1');
    c.pool.sectors = ['00013'];
    expect(poolScopeText(c.pool)).toBe('업종 1개·테마 2·묶음 1');
  });

  it('the list line shows themes and baskets next to the sectors, and the macro conditions that are on', () => {
    const c = newCriteria(NOW, null);
    c.pool.themes = ['T1', 'T2'];
    c.pool.baskets = ['b1'];
    c.conditions.macro.usdkrw.beta = { on: true, min: 0.3, max: 5 };
    c.conditions.macro.wti.trend.on = true;
    expect(criteriaLine(c)).toBe('KOSPI·KOSDAQ 주식 · 테마 2·묶음 1 · 거래대금 10억↑ · 반등 10일 · 원/달러 민감도 0.3~5 · 유가 흐름 20일 · 상위 10 · 매월');
  });

  it('keeps the macro help of spec 5.2 (WTI swaps 환율 for 유가)', () => {
    expect(macroBetaHelp('usdkrw')).toBe('환율이 1% 오를 때 주가가 평균 몇 % 움직였는지예요. +면 같이 오르고, −면 반대로 움직여요.');
    expect(macroBetaHelp('wti')).toBe('유가가 1% 오를 때 주가가 평균 몇 % 움직였는지예요. +면 같이 오르고, −면 반대로 움직여요.');
    expect(macroTrendHelp('usdkrw')).toBe('최근 며칠 동안 환율이 크게 오르면 같이 오르는 종목을, 크게 내리면 반대로 움직이는 종목을 골라요.');
    expect(macroTrendHelp('wti')).toBe('최근 며칠 동안 유가가 크게 오르면 같이 오르는 종목을, 크게 내리면 반대로 움직이는 종목을 골라요.');
  });

  it('keeps the note copy verbatim', () => {
    expect(THEME_SNAPSHOT_TEXT).toBe('테마·내 묶음은 지금 구성을 과거에도 써요. 그때는 없던 종목이 들어 있어 결과가 실제보다 좋게 나올 수 있어요');
    expect(MACRO_LAG_TEXT).toBe('환율·유가는 매주 묶어서 공개돼 최근 1~2주는 반영되지 않아요');
    expect(MACRO_GAP_TEXT).toBe('일부 기간은 환율·유가 값이 없어 그 조건을 통과한 종목이 없어요');
    expect(NEED_RECOLLECT_TEXT).toBe('다시 수집하면 쓸 수 있어요');
  });

  it('macro value lines: beta with 2 decimals, trend with the lookback, — for null', () => {
    expect(macroValueLines({ usdkrwBeta: 0.8234, usdkrwTrend: 3.44 }, { usdkrw: 20 })).toEqual(['원/달러 민감도 0.82 · 최근 20일 +3.4%']);
    expect(macroValueLines({ wtiBeta: -1.5, wtiTrend: -6.04 }, { wti: 10 })).toEqual(['유가 민감도 −1.50 · 최근 10일 −6.0%']);
    expect(macroValueLines({ usdkrwBeta: null, usdkrwTrend: 3 }, { usdkrw: 20 })).toEqual(['원/달러 민감도 — · 최근 20일 +3.0%']);
    expect(macroValueLines({ wtiBeta: 0.5 })).toEqual(['유가 민감도 0.50']);
    expect(macroValueLines({ usdkrwBeta: 1, usdkrwTrend: 2 })).toEqual(['원/달러 민감도 1.00 · 최근 흐름 +2.0%']);
    expect(macroValueLines({ marketCap: 1e12 })).toEqual([]);
  });
});
