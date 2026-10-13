// 결과 화면 테스트용: 손으로 만든 done 상태.
import { newStrategy } from '../../sim/defaults';
import type { SimResult, Trade } from '../../sim/types';
import { kstEpoch } from '../../time/kst';
import type { DoneState } from './runController.svelte';

export function doneState(patch: (s: DoneState) => void = () => {}): DoneState {
  const strategy = newStrategy(kstEpoch('2026-10-12', '14:05:00'), 'g1');
  strategy.period = { from: '2023-10-11', to: '2026-10-11' };
  const trades: Trade[] = [
    { date: '2024-03-14', symbol: '000660', kind: 'buy', price: 132_400, qty: 12, fee: 238, tax: 0, reason: 'B 돌파' },
    { date: '2024-04-02', symbol: '000660', kind: 'stop', price: 125_000, qty: 12, fee: 225, tax: 0, reason: '손절', pnlPct: -5.6 },
    { date: '2024-05-02', symbol: '005930', kind: 'buy', price: 70_000, qty: 14, fee: 147, tax: 0, reason: '3일 연속 상승' },
    { date: '2024-06-03', symbol: '005930', kind: 'take', stage: 1, price: 80_500, qty: 14, fee: 169, tax: 0, reason: '1단계 익절 100%', pnlPct: 15 },
  ];
  const result: SimResult = {
    equity: [
      { date: '2023-10-11', strategy: 10_000_000, hold: 10_000_000, index: 10_000_000, benchmark: 10_000_000, cash: 10_000_000 },
      { date: '2023-10-12', strategy: 10_100_000, hold: 10_050_000, index: 10_020_000, benchmark: 10_030_000, cash: 9_000_000 },
      { date: '2026-10-08', strategy: 13_240_000, hold: 11_630_000, index: 11_100_000, benchmark: 11_500_000, cash: 8_000_000 },
    ],
    summary: {
      totalReturnPct: 32.4,
      cagrPct: 9.8,
      mddPct: -12.3,
      winRatePct: 58.5,
      wins: 24,
      losses: 16,
      avgWinPct: 8.1,
      avgLossPct: -4.2,
      roundTrips: 41,
      openPositions: 1,
      avgHoldDays: 19.2,
      avgCashPct: 62,
      skippedSignals: 3,
      vsHoldPp: 16.1,
      vsIndexPp: 21.4,
      vsBenchmarkPp: 17.4,
    },
    benchmarks: { holdReturnPct: 16.3, indexReturnPct: 11, benchmarkReturnPct: -2.5 },
    trades,
    skipped: [
      { date: '2024-07-01', symbol: '000660', reason: '1주가 1회 금액보다 비쌈' },
      { date: '2024-07-02', symbol: '000660', reason: '1주가 1회 금액보다 비쌈' },
      { date: '2024-08-05', symbol: '005930', reason: '현금 부족' },
    ],
    perSymbol: [
      { symbol: '005930', name: '삼성전자', pnl: 141_000, roundTrips: 1, firstDate: '2023-10-11' },
      { symbol: '000660', name: 'SK하이닉스', pnl: -88_000, roundTrips: 1, firstDate: '2024-03-02' },
    ],
    nearMiss: null,
  };
  const s: DoneState = {
    kind: 'done',
    result,
    meta: {
      venueLabel: 'KRX 일봉',
      fetchedAt: kstEpoch('2026-10-12', '14:05:00'),
      from: '2023-10-11',
      to: '2026-10-11',
      demo: true,
      failed: [{ symbol: '035720', name: '카카오', reason: '기간 안에 데이터가 없어요' }],
      indexFailed: null,
      benchmarkFailed: false,
      candles: { '005930': [], '000660': [] },
      names: { '005930': '삼성전자', '000660': 'SK하이닉스', '069500': 'KODEX 200' },
      strategy,
    },
  };
  patch(s);
  return s;
}

/** 거래가 하나도 없는 결과로 바꾼다. */
export function noTrades(s: DoneState, skipped: SimResult['skipped'] = []): void {
  s.result.trades = [];
  s.result.skipped = skipped;
  s.result.summary = { ...s.result.summary, roundTrips: 0, wins: 0, losses: 0, winRatePct: null, skippedSignals: skipped.length };
  s.result.nearMiss = skipped.length ? null : { maxDropPct: 8.2, declineDays: 0 };
}
