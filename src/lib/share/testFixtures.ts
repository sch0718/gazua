// 테스트 전용: 손으로 만든 작은 결과 스냅샷(검사를 통과하는 모양). 앱·Worker·컴포넌트 테스트가 함께 쓴다.
import { newBasket } from '../screen/baskets';
import { newCriteria } from '../screen/defaults';
import { newStrategy } from '../sim/defaults';
import type { DoneState } from '../ui/simulate/runController.svelte';
import type { Trade } from '../sim/types';
import { SKIP_REASONS } from './resultEnums';
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

/** from부터 주말을 뺀 n일(KST 날짜 문자열) */
export function tradingDays(from: string, n: number): string[] {
  const out: string[] = [];
  let t = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  while (out.length < n) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
    t += 86_400_000;
  }
  return out;
}

export const BIG_SYMBOLS = ['005930', '000660', '035420', '035720', '051910', '006400', '005380', '000270'];

/** 크기 예산(설계 3.5)용 결과: 8종목, 지수·지정 종목 곡선, 소수 자리가 긴 값(반올림 확인용) */
export function bigDone(o: { days: number; trades: number; skips: number }): DoneState {
  const strategy = newStrategy(NOW, null, '큰 전략');
  strategy.universe = { kind: 'symbols', symbols: [...BIG_SYMBOLS] };
  strategy.benchmarks = { index: 'KOSPI', symbol: '069500' };
  const initial = strategy.capital.initial;
  const dates = tradingDays('2016-01-04', o.days);
  const wave = (i: number, a: number, f: number) => Math.round(initial * (1 + a * Math.sin(i / f) + i / (o.days * 5)));
  const spread = (i: number, count: number) => dates[Math.floor((i * (o.days - 1)) / Math.max(1, count))];
  const trades: Trade[] = Array.from({ length: o.trades }, (_, i) => {
    const date = spread(i, o.trades);
    const symbol = BIG_SYMBOLS[i % BIG_SYMBOLS.length];
    return i % 2 === 0
      ? { date, symbol, kind: 'buy', price: 50_000 + i, qty: 10 + (i % 7), fee: 75, tax: 0, reason: 'B 돌파' }
      : { date, symbol, kind: 'take', stage: 1, price: 52_000 + i, qty: 10, fee: 78, tax: 120, reason: '1단계 익절 100%', pnlPct: 3.21 + (i % 13) / 7 };
  });
  return {
    kind: 'done',
    result: {
      equity: dates.map((date, i) => ({
        date,
        strategy: wave(i, 0.2, 37),
        hold: wave(i, 0.15, 53),
        index: wave(i, 0.1, 71),
        benchmark: i % 50 === 7 ? null : wave(i, 0.12, 29),
        cash: initial / 2,
      })),
      summary: {
        totalReturnPct: 12.34567,
        cagrPct: 9.87654,
        mddPct: -23.456789,
        winRatePct: 55.5555,
        wins: 10,
        losses: 8,
        avgWinPct: 8.123,
        avgLossPct: -4.567,
        roundTrips: Math.floor(o.trades / 2),
        openPositions: 1,
        avgHoldDays: 19.256,
        avgCashPct: 62.1234,
        skippedSignals: o.skips,
        vsHoldPp: 16.111,
        vsIndexPp: 21.4,
        vsBenchmarkPp: 17.4444,
      },
      benchmarks: { holdReturnPct: 16.3333, indexReturnPct: 11.1111, benchmarkReturnPct: -2.5 },
      trades,
      skipped: Array.from({ length: o.skips }, (_, i) => ({ date: spread(i, o.skips), symbol: BIG_SYMBOLS[i % 8], reason: SKIP_REASONS[i % 4] })),
      perSymbol: BIG_SYMBOLS.map((symbol, i) => ({ symbol, name: symbol, pnl: (i - 3) * 123_457.6, roundTrips: 3, firstDate: dates[0] })),
      nearMiss: null,
    },
    meta: {
      venueLabel: 'KRX 일봉',
      fetchedAt: NOW,
      from: dates[0],
      to: dates[dates.length - 1],
      demo: false,
      failed: [],
      indexFailed: null,
      benchmarkFailed: false,
      candles: {},
      names: {},
      strategy,
      symbols: [...BIG_SYMBOLS],
    },
  };
}
