import { describe, expect, it } from 'vitest';
import { finKnownFrom, finMetricsAt, lastKnownQuarter, type FinValues } from './fin';
import { precompute } from './precompute';
import { DATES, FIN_BASE, mkFileV4, mkStock, offCriteria, withFin, type Stock } from './testData';
import type { FinSeries } from '../marketData/format';
import type { SelectionCriteria } from './types';

describe('finKnownFrom: 공시 시점 규칙(스펙 2.3, 결정 D8)', () => {
  it.each([
    // 12월 결산: 1·2·3분기는 +60일, 4분기(연간)는 +100일
    ['202403', false, '20240530'],
    ['202406', false, '20240829'],
    ['202409', false, '20241129'],
    ['202412', true, '20250410'],
    // 3월 결산: 3월 분기가 연간, 12월 분기는 +60일(해를 넘긴다)
    ['202503', true, '20250709'],
    ['202506', false, '20250829'],
    ['202512', false, '20260301'],
    // 결산월 변경 종목의 옛 연간 분기(a = 1): PR #16 리뷰의 반례
    ['201303', true, '20130709'],
    // 2월 말일과 윤년
    ['202402', false, '20240429'],
    ['202302', false, '20230429'],
    ['202402', true, '20240608'], // 2024-02-29 + 100일
    ['202302', true, '20230608'], // 2023-02-28 + 100일
    ['202312', true, '20240409'], // 윤년 2월을 지난다
    ['202311', false, '20240129'],
  ])('%s 연간 %s → %s', (q, annual, want) => {
    expect(finKnownFrom(q, annual)).toBe(want);
  });

  it('어떤 달·어떤 a 조합이든 다음 분기(3개월 뒤)보다 먼저 알려진다(이진 탐색의 전제)', () => {
    let pairs = 0;
    for (let y = 2000; y <= 2031; y++)
      for (let m = 1; m <= 12; m++) {
        const q = `${y}${String(m).padStart(2, '0')}`;
        const n = m + 3 > 12 ? `${y + 1}${String(m - 9).padStart(2, '0')}` : `${y}${String(m + 3).padStart(2, '0')}`;
        for (const a of [false, true])
          for (const b of [false, true]) {
            expect(finKnownFrom(q, a) < finKnownFrom(n, b), `${q}/${a} ${n}/${b}`).toBe(true);
            pairs++;
          }
      }
    expect(pairs).toBe(32 * 12 * 4);
  });
});

describe('lastKnownQuarter: known < p인 마지막 분기(스펙 2.3)', () => {
  const known = ['20240530', '20240829', '20241129', '20250410'];
  it.each([
    ['20240530', -1], // 당일은 아직 쓰지 않는다
    ['20240531', 0],
    ['20241129', 1],
    ['20241130', 2],
    ['20250410', 2],
    ['20250411', 3],
    ['20990101', 3],
    ['20000101', -1],
  ])('p = %s → %i', (p, want) => {
    expect(lastKnownQuarter(known, p)).toBe(want);
  });
  it('빈 배열이면 −1', () => {
    expect(lastKnownQuarter([], '20250101')).toBe(-1);
  });
});

// FIN_BASE(testData): p = DATES[24] = 2025-02-05, 시가총액 10억 원 기준 값
const BASE_VALUES: FinValues = { quarter: '202409', per: 5, pbr: 1.25, roe: 20, opMargin: 10, revGrowth: 25, opGrowth: 50, debtRatio: 50, ttmNi: 2 };

const N = 100;
const P = 24;
const finCrit = (): SelectionCriteria => {
  const c = offCriteria();
  c.conditions.fin.per.on = true;
  return c;
};
const finStock = (patch: Partial<Omit<FinSeries, 'a'>> = {}, meta: Partial<Stock> = {}) =>
  withFin(mkStock('A', Array(N).fill(100), { shares: 1e7, ...meta }), { ...FIN_BASE, ...patch });
/** 소수 오차를 지운 값(NaN은 그대로) */
const round = (v: FinValues | null) =>
  v && Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === 'number' ? Math.round(x * 1e9) / 1e9 : x]));
const metricsOf = (st: ReturnType<typeof finStock>, pIdx = P, p = DATES[P]) => {
  const pre = precompute(mkFileV4([st], N), finCrit(), null);
  return round(finMetricsAt(pre, pre.stocks[0], pIdx, p));
};
const last4 = <T>(a: T[]): T[] => a.slice(-4);

describe('finMetricsAt: 스펙 3.1 지표 손계산', () => {
  it('8분기가 있으면 모든 지표를 계산하고 쓴 분기 L을 돌려준다', () => {
    expect(metricsOf(finStock())).toEqual(BASE_VALUES);
  });

  it.each<[string, ReturnType<typeof finStock>, Partial<FinValues>]>([
    ['상장주식수 0이면 PER·PBR 계산 불가(D9)', finStock({}, { shares: 0 }), { per: NaN, pbr: NaN }],
    ['상장주식수 음수도 같다', finStock({}, { shares: -1 }), { per: NaN, pbr: NaN }],
    ['TTM 순이익 0 이하: PER 계산 불가, ROE는 계산', finStock({ ni: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5] }), { per: NaN, roe: 0, ttmNi: 0 }],
    ['L 자본 0: PBR·부채비율 계산 불가, ROE는 (0 + 12) / 2로 계산', finStock({ eq: [12, 12, 12, 12, 8, 8, 8, 0] }), { pbr: NaN, debtRatio: NaN, roe: 33.333333333 }],
    ['평균 자본 0 이하: ROE 계산 불가', finStock({ eq: [12, 12, 12, 12, 8, 8, 8, -12] }), { pbr: NaN, debtRatio: NaN, roe: NaN }],
    ['TTM 매출 0: 영업이익률 계산 불가, 매출 증가율은 −100%', finStock({ rev: [6, 6, 6, 6, 0, 0, 0, 0] }), { opMargin: NaN, revGrowth: -100 }],
    ['1년 전 TTM 매출 0 이하: 매출 증가율 계산 불가', finStock({ rev: [0, 0, 0, 0, 7.5, 7.5, 7.5, 7.5] }), { revGrowth: NaN }],
    ['1년 전 TTM 영업이익 0 이하(흑자 전환): 영업이익 증가율 계산 불가(D5)', finStock({ op: [-0.5, -0.5, 0.5, 0.5, 0.75, 0.75, 0.75, 0.75] }), { opGrowth: NaN }],
  ])('%s', (_, st, diff) => {
    expect(metricsOf(st)).toEqual({ ...BASE_VALUES, ...diff });
  });

  it('연속 8분기 경계: 7분기면 증가율만 계산 불가(ROE는 L−4가 있어 계산)', () => {
    const seven = Object.fromEntries(Object.entries(FIN_BASE).map(([k, a]) => [k, (a as unknown[]).slice(1)])) as Omit<FinSeries, 'a'>;
    expect(metricsOf(finStock(seven))).toEqual({ ...BASE_VALUES, revGrowth: NaN, opGrowth: NaN });
  });

  it('연속 4분기 경계: 4분기면 TTM은 계산하고 L−4 자본이 없어 ROE는 계산 불가, 3분기면 TTM 지표 모두 불가', () => {
    const four = Object.fromEntries(Object.entries(FIN_BASE).map(([k, a]) => [k, last4(a as unknown[])])) as Omit<FinSeries, 'a'>;
    expect(metricsOf(finStock(four))).toEqual({ ...BASE_VALUES, roe: NaN, revGrowth: NaN, opGrowth: NaN });
    const three = Object.fromEntries(Object.entries(four).map(([k, a]) => [k, (a as unknown[]).slice(1)])) as Omit<FinSeries, 'a'>;
    expect(metricsOf(finStock(three))).toEqual({
      quarter: '202409',
      per: NaN,
      pbr: 1.25,
      roe: NaN,
      opMargin: NaN,
      revGrowth: NaN,
      opGrowth: NaN,
      debtRatio: 50,
      ttmNi: NaN,
    });
  });

  it('p에 종목 봉이 없으면(pIdx −1) PER·PBR만 계산 불가', () => {
    expect(metricsOf(finStock(), -1)).toEqual({ ...BASE_VALUES, per: NaN, pbr: NaN });
  });

  it('알려진 분기가 없거나 재무가 없으면 null', () => {
    expect(metricsOf(finStock(), P, '2023-02-28')).toBeNull(); // 202212 + 100일 = 2023-04-10
    const pre = precompute(mkFileV4([mkStock('N', Array(N).fill(100))], N), finCrit(), null);
    expect(finMetricsAt(pre, pre.stocks[0], P, DATES[P])).toBeNull();
  });

  it('재무 없이 미리 계산했으면 던진다', () => {
    const pre = precompute(mkFileV4([finStock()], N), offCriteria(), null);
    expect(() => finMetricsAt(pre, pre.stocks[0], P, DATES[P])).toThrow();
  });
});

describe('finMetricsAt: 연간 실적은 +100일 뒤에 쓴다(스펙 2.3)', () => {
  // 2024년 4분기(연간, a = 1)를 더한다: 순이익 10억으로 눈에 띄게
  const nine = finStock({
    q: [...FIN_BASE.q, '202412'],
    rev: [...FIN_BASE.rev, 7.5],
    op: [...FIN_BASE.op, 0.75],
    ni: [...FIN_BASE.ni, 10],
    eq: [...FIN_BASE.eq, 8],
    debt: [...FIN_BASE.debt, 4],
  });
  const at = (iso: string) => metricsOf(nine, DATES.indexOf(iso), iso);

  it('202412 + 100일 = 2025-04-10 당일까지는 3분기까지의 4개 분기로 TTM을 계산하고, 다음 날부터 4분기를 쓴다', () => {
    expect(DATES).toContain('2025-04-10');
    expect(at('2025-02-05')).toMatchObject({ quarter: '202409', ttmNi: 2 }); // 60일은 지났지만 연간은 100일
    expect(at('2025-04-10')).toMatchObject({ quarter: '202409', ttmNi: 2 }); // p 당일 = finKnownFrom → 아직(<)
    expect(at('2025-04-11')).toMatchObject({ quarter: '202412', ttmNi: 11.5 });
  });

  it('연간 결산 여부는 종목의 지금 결산월이 아니라 분기의 a로 정한다(D8)', () => {
    // 같은 202412가 a = 0이면 +60일(2025-03-01)부터 쓴다
    const asQuarter = { ...nine, fin: { ...nine.fin!, a: nine.fin!.a.map(() => 0) } };
    expect(metricsOf(asQuarter, DATES.indexOf('2025-03-03'), '2025-03-03')).toMatchObject({ quarter: '202412' });
    expect(metricsOf(nine, DATES.indexOf('2025-03-03'), '2025-03-03')).toMatchObject({ quarter: '202409' });
  });
});
