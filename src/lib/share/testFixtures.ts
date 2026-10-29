// 테스트 전용: 손으로 만든 작은 결과 스냅샷(검사를 통과하는 모양). 앱·Worker·컴포넌트 테스트가 함께 쓴다.
import { newBasket } from '../screen/baskets';
import { newCriteria } from '../screen/defaults';
import { newStrategy } from '../sim/defaults';
import { criteriaSnapshot, strategySnapshot, type SimResultSnapshot, type ValidationSnapshot } from './snapshot';

export const NOW = Date.UTC(2026, 9, 29, 3);

/** 3종목(하나는 ETN, 기간 안 데이터 없음) · 거래 4건 · 건너뜀 3건 · 지수 곡선 하나 · 지정 종목은 받지 못함 */
export function simResultFixture(o: { capitalHidden?: boolean } = {}): SimResultSnapshot {
  const hidden = o.capitalHidden ?? false;
  const base = newStrategy(NOW, null, '눌림목');
  base.universe = { kind: 'symbols', symbols: ['005930', '000660', 'Q500023'] };
  base.benchmarks = { index: 'KOSPI', symbol: '069500' };
  const { title, strategy } = strategySnapshot(base, { groups: [] }, { hideCapital: hidden, now: NOW });
  const q = (n: number) => (hidden ? null : n);
  return {
    kind: 'simResult',
    v: 1,
    title,
    strategy,
    capitalHidden: hidden,
    run: { from: '2024-01-02', to: '2024-01-12', source: 'KRX 일봉', demo: false, fetchedAt: NOW },
    result: {
      axis: { start: '2024-01-02', offsets: [0, 1, 2, 7, 10] },
      sampled: null,
      curves: { strategy: [0, 1.5, -2.25, 3, 4.1], hold: [0, 0.5, 1, 1.5, 2], index: [0, null, 0.3, 0.4, 0.5], benchmark: null },
      summary: {
        totalReturnPct: 4.1,
        cagrPct: 100.12,
        mddPct: -3.69,
        winRatePct: 50,
        wins: 1,
        losses: 1,
        avgWinPct: 15,
        avgLossPct: -5.6,
        roundTrips: 2,
        openPositions: 0,
        avgHoldDays: 12.5,
        avgCashPct: 62.31,
        skippedSignals: 3,
        vsHoldPp: 2.1,
        vsIndexPp: 3.6,
        vsBenchmarkPp: null,
      },
      benchmarks: { holdReturnPct: 2, indexReturnPct: 0.5, benchmarkReturnPct: null },
      indexFailed: null,
      benchmarkFailed: true,
      symbols: ['005930', '000660', 'Q500023'],
      trades: [
        [1, 0, 'buy', null, 70000, q(14), 'B 돌파', null],
        [2, 1, 'buy', null, 132400, q(12), '3일 연속 상승', null],
        [7, 1, 'stop', null, 125000, q(12), '손절', -5.6],
        [10, 0, 'take', 1, 80500, q(14), '1단계 익절 100%', 15],
      ],
      perSymbol: [
        [0, q(141000), 1.41, 1, 0],
        [1, q(-88000), -0.88, 1, 0],
      ],
      skipped: {
        counts: [
          ['현금 부족', 1],
          ['1주가 1회 금액보다 비쌈', 2],
        ],
        rows: [
          [2, 1, 1],
          [7, 1, 1],
          [8, 0, 0],
        ],
      },
      nearMiss: null,
      failed: [{ symbol: 'Q500023', reason: '기간 안에 데이터가 없어요' }],
    },
  };
}

/** 재선정 2번(두 번째는 통과 0개) · 묶음 하나 · 지수 KOSPI · 지정 ETF는 받지 못함 */
export function validationFixture(o: { capitalHidden?: boolean } = {}): ValidationSnapshot {
  const hidden = o.capitalHidden ?? false;
  const c = newCriteria(NOW, null, '대형 우량');
  const basket = newBasket(NOW, '반도체', ['005930', '000660']);
  c.pool.baskets = [basket.id];
  const { title, criteria, baskets } = criteriaSnapshot(c, { baskets: [basket], strategies: [] }, { hideCapital: hidden, now: NOW });
  const stats = (totalPct: number) => ({ totalPct, cagrPct: totalPct / 2, mddPct: -10, volPct: 20 });
  return {
    kind: 'validation',
    v: 1,
    title,
    criteria,
    baskets,
    capitalHidden: hidden,
    run: { from: '2026-01-05', to: '2026-02-03', source: '시장 데이터 파일', demo: false, fetchedAt: NOW },
    result: {
      axis: { start: '2026-01-05', offsets: [0, 1, 28, 29] },
      sampled: null,
      hold: { curve: [0, 1, 3, 12.34], stats: stats(12.34), beat: { beat: 1, total: 2 } },
      trading: null,
      indices: [{ id: 'KOSPI', curve: [0, 0.5, 1, 8.06], reason: null, stats: stats(8.06) }],
      benchmarks: [{ symbol: '069500', name: 'KODEX 200', curve: null, reason: '받지 못했어요', stats: null }],
      byMarket: [
        { key: 'KOSPI', inPool: true, stats: stats(10.04), avgPicked: 4.25 },
        { key: 'KOSDAQ', inPool: true, stats: stats(-2.5), avgPicked: 3 },
        { key: 'ETF', inPool: false, stats: stats(6), avgPicked: 2 },
      ],
      history: 'full',
      valueKeys: ['tradingValue', 'return', 'rebound', 'finQuarter'],
      rebalances: [
        {
          day: 0,
          passed: 25,
          picks: [
            ['005930', 5.5, 0, [0, 25000000000, 1, -12.34, 2, true, 3, 202406]],
            ['000660', null, 'noBar', [0, 31000000000, 2, true]],
          ],
        },
        { day: 28, passed: 0, picks: [] },
      ],
      today: { date: '2026-02-04', passed: 25, picks: [{ symbol: '005930', values: [0, 25000000000, 2, true] }] },
      notes: ['survivorship', 'snapshot'],
    },
  };
}
