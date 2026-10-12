export type TaxMarket = 'KOSPI' | 'KOSDAQ' | 'KR_ETC';

// [시작일(KST), KOSPI, KOSDAQ] — 위에서부터 첫 일치. 2026년 값만 웹 검색으로 확인했고
// 2025년 이전 값은 기억에 의존한 값이라 live-check ⑮에서 법령 원문으로 확인해야 한다.
const TAX_TABLE: readonly (readonly [string, number, number])[] = [
  ['2026-01-01', 0.2, 0.2],
  ['2025-01-01', 0.15, 0.15],
  ['2024-01-01', 0.18, 0.18],
  ['2023-01-01', 0.2, 0.2],
  ['2021-01-01', 0.23, 0.23],
  ['2019-06-03', 0.25, 0.25],
  ['0000-01-01', 0.3, 0.3],
];

export function sellTaxPct(date: string, market: TaxMarket, isEtf: boolean): number {
  if (isEtf || market === 'KR_ETC') return 0;
  const row = TAX_TABLE.find(([start]) => date >= start) ?? TAX_TABLE[TAX_TABLE.length - 1];
  return market === 'KOSPI' ? row[1] : row[2];
}
