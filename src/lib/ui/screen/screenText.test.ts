import { describe, expect, it } from 'vitest';
import { newCriteria } from '../../screen/defaults';
import type { ValidationResult } from '../../screen/runValidation';
import { NOW } from '../../screen/testData';
import { kstEpoch } from '../../time/kst';
import { CONDITION_HELP, criteriaLine, dataAgeDays, lastResultLine, nextCriteriaName, STALE_DAYS, staleText } from './screenText';

const stats = (totalPct: number) => ({ totalPct, cagrPct: 0, mddPct: 0, volPct: 0 });

describe('screenText', () => {
  it('summarizes the default criteria in the spec 7.2 form', () => {
    expect(criteriaLine(newCriteria(NOW, null))).toBe('KOSPI·KOSDAQ 주식 · 거래대금 10억↑ · 반등 10일 · 상위 10 · 매월');
  });

  it('summary follows the pool, the on conditions, the take and the rebalance', () => {
    const c = newCriteria(NOW, null);
    c.pool = { markets: ['KOSDAQ'], types: ['STOCK', 'ETF'], excludeManaged: true, sectors: ['001', '002'] };
    c.conditions.tradingValue.on = false;
    c.conditions.rebound.on = false;
    c.conditions.marketCap.on = true;
    c.conditions.vsMa = { on: true, period: 60, side: 'above' };
    c.rank.take = 5;
    c.rebalance = 'quarterly';
    expect(criteriaLine(c)).toBe('KOSDAQ 주식·ETF · 업종 2개 · 시총 1,000억↑ · 60일선 위 · 상위 5 · 분기');
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

  it('last result line shows ① against the first index; no index stats leaves ① alone', () => {
    const base = { hold: { stats: stats(12.34) }, indices: [{ id: 'KOSPI', curve: [], stats: stats(8.06) }] } as unknown as ValidationResult;
    expect(lastResultLine(base)).toBe('① +12.3% vs KOSPI +8.1%');
    const none = { hold: { stats: stats(-3.2) }, indices: [{ id: 'KOSPI', curve: null, stats: null }] } as unknown as ValidationResult;
    expect(lastResultLine(none)).toBe('① −3.2%');
  });

  it('next name takes the smallest free number', () => {
    expect(nextCriteriaName([])).toBe('새 기준');
    expect(nextCriteriaName([{ name: '새 기준' }, { name: '새 기준 3' }])).toBe('새 기준 2');
  });
});
