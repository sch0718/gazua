// 테스트 전용: 화면용 검증 결과
import type { ValidationResult } from '../../screen/runValidation';

export const stats = (totalPct: number, o: Partial<{ cagrPct: number; mddPct: number; volPct: number }> = {}) => ({
  totalPct,
  cagrPct: totalPct / 2,
  mddPct: -10,
  volPct: 20,
  ...o,
});

const AXIS = ['2026-01-05', '2026-01-06', '2026-02-02', '2026-02-03'];
const curve = (vs: number[]) => AXIS.map((date, i) => ({ date, value: vs[i] }));

/** 재선정 2번(2026-01-05은 10종목, 2026-02-02는 통과 0개), 지수 KOSPI, 비교 ETF 하나 */
export function validationResult(o: Partial<ValidationResult> = {}): ValidationResult {
  const picked = Array.from({ length: 10 }, (_, i) => ({ symbol: `00${String(i).padStart(4, '0')}`, values: { tradingValue: 2.5e10, return: -12.34, rebound: true } }));
  return {
    axis: AXIS,
    rebalances: [
      { date: '2026-01-05', passed: 25, picked },
      { date: '2026-02-02', passed: 0, picked: [] },
    ],
    today: { date: '2026-02-04', passed: 25, picked },
    hold: {
      equity: curve([10_000_000, 10_100_000, 10_300_000, 11_234_000]),
      segments: [
        {
          from: '2026-01-05',
          to: '2026-02-02',
          picked: picked.map((p, i) => ({ symbol: p.symbol, retPct: i === 0 ? 5.5 : i === 1 ? -3.2 : i <= 5 && i >= 3 ? null : 1, soldAtLastClose: i === 2, ...(i >= 3 && i <= 5 ? { notBought: true, notBoughtReason: (['noBar', 'tooExpensive', 'cash'] as const)[i - 3] } : { notBought: false }) })),
        },
        { from: '2026-02-02', to: '2026-02-03', picked: [] },
      ],
      stats: stats(12.34),
      beat: { beat: 1, total: 2 },
    },
    trading: null,
    indices: [{ id: 'KOSPI', curve: curve([10_000_000, 10_050_000, 10_100_000, 10_806_000]), stats: stats(8.06) }],
    benchmarks: [{ symbol: '069500', name: 'KODEX 200', curve: curve([10_000_000, 10_020_000, 10_080_000, 10_500_000]), stats: stats(5) }],
    byMarket: [
      { key: 'KOSPI', inPool: true, stats: stats(10.04), avgPicked: 4.25 },
      { key: 'KOSDAQ', inPool: true, stats: stats(-2.5), avgPicked: 3 },
      { key: 'ETF', inPool: false, stats: stats(6), avgPicked: 2 },
    ],
    notes: ['survivorship', 'snapshot', 'dividend', 'fewSegments'],
    ...o,
  };
}
