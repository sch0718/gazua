import { expect, it } from 'vitest';
import { fullStrategyV2 } from '../../../src/lib/sim/testStrategyV2';
import { kstEpoch } from '../../../src/lib/time/kst';
import { decideBuy, decideSell, restore, toCandles } from './judge';
import type { AutoLedger, AutoPosition } from './ledger';

const pos = (): AutoPosition => ({ symbol: '005930', boughtAt: '2026-11-12', buyPrice: 100, boughtQty: 100, qty: 100, peak: 100, sells: [] });
const strategy = () => {
  const s = fullStrategyV2();
  s.rules.sell.stopLoss = { on: true, basis: 'avgAlways', pct: 10 };
  s.rules.sell.trailing.on = false;
  s.rules.sell.timeExit.on = false;
  return s;
};
it('일봉을 KST 자정 봉으로 바꾸고 빠진 고가·저가·거래량을 보완한다', () => {
  expect(toCandles([{ date: '2026-11-13', open: 100, close: 110 }])).toEqual([{ t: kstEpoch('2026-11-13', '00:00:00'), o: 100, h: 110, l: 100, c: 110, v: 0 }]);
});
it('손절을 매도 신호보다 먼저 판정하고 본전 손절을 복원한다', () => {
  expect(decideSell(pos(), strategy(), 90, 1, true)).toEqual({ qty: 100, reason: '손절' });
  const p = { ...pos(), qty: 50, sells: [{ qty: 50, stage: 1 }] };
  expect(restore(p, strategy()).stopPrice()).toBe(100);
  expect(decideSell(p, strategy(), 100, 1, false)).toEqual({ qty: 50, reason: '손절' });
});
it('최고 현재가에서 추적 손절한다', () => {
  const s = strategy();
  s.rules.sell.trailing = { on: true, pct: 10 };
  expect(decideSell({ ...pos(), peak: 150 }, s, 130, 1, false)).toEqual({ qty: 100, reason: '추적 손절' });
});
it('동시에 넘은 익절 단계 수량을 합치고 가장 높은 단계를 기록한다', () => {
  const s = strategy();
  s.rules.sell.takeProfit.stages = [{ pct: 10, sellPct: 30 }, { pct: 20, sellPct: 30 }, { pct: 30, sellPct: 100 }];
  expect(decideSell(pos(), s, 121, 1, false)).toEqual({ qty: 60, stage: 2, reason: '2단계 익절' });
  const p = { ...pos(), qty: 40, sells: [{ qty: 60, stage: 2 }] };
  expect(decideSell(p, s, 121, 1, false)).toBeNull();
  expect(decideSell(p, s, 131, 1, false)).toEqual({ qty: 40, stage: 3, reason: '3단계 익절' });
});
it('거래일 수로 기간 청산하고 매도 신호를 마지막에 판정한다', () => {
  const s = strategy();
  s.rules.sell.timeExit = { on: true, days: 3 };
  expect(decideSell(pos(), s, 105, 3, true)).toEqual({ qty: 100, reason: '기간 청산' });
  expect(decideSell(pos(), s, 105, 2, true)).toEqual({ qty: 100, reason: '매도 조건' });
});
it('매수는 지정가 기준 수량과 하루·보유·마감 제한을 지킨다', () => {
  const s = strategy();
  s.capital.initial = 1000;
  s.sizing.mode = 'equal';
  const ledger: AutoLedger = { version: 1, strategyId: s.id, today: { date: '2026-11-13', bought: [], sold: [] }, positions: [], notified: [] };
  const input = { strategy: s, symbolCount: 2, symbol: '005930', price: 100, minute: 900, match: true, ledger, held: false, buySlipPct: 1 };
  expect(decideBuy(input)).toEqual({ qty: 4, price: 101, reason: '매수 조건' });
  expect(decideBuy({ ...input, minute: 915 })).toBeNull();
  expect(decideBuy({ ...input, held: true })).toEqual({ skip: '이미 보유 중이에요' });
  ledger.today.sold.push('005930');
  expect(decideBuy(input)).toEqual({ skip: '오늘 이미 매수·매도를 시도했어요' });
});
