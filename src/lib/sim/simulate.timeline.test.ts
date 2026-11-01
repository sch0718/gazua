import { describe, expect, it } from 'vitest';
import { roundMoney } from './money';
import { openPosition } from './position';
import { simulate } from './simulate';
import { BASE, baseStrategy, candlesFrom, D, goldenInputs, stockOf } from './testInputs';
import type { DayFrame, SimInput, SimResult } from './types';

const A = '분할 매수 + 3단계 익절 + 본전 손절';
const B = '갭 손절 + 현금 부족 + 봉 없는 날';

const run = (i: SimInput) => simulate(i, { timeline: true }) as SimResult & { timeline: DayFrame[] };
const takesOf = (levels: { stage: number; price: number; qty: number }[]) => levels.filter((t) => t.qty > 0).map(({ stage, price }) => ({ stage, price }));

describe('timeline', () => {
  it.each(Object.entries(goldenInputs))('%s: 날짜·현금·평가액이 equity와 같고, 평가액 = 현금 + 보유 평가액', (_name, make) => {
    const r = run(make());
    expect(r.timeline.map((f) => [f.date, f.cash, f.value])).toEqual(r.equity.map((e) => [e.date, e.cash, e.strategy]));
    for (const f of r.timeline) {
      const held = f.holdings.reduce((a, h) => roundMoney(a + h.value), 0);
      expect(f.value, f.date).toBe(roundMoney(f.cash + held));
    }
  });

  it('매수일 프레임부터 holdings에 있고 전량 매도일 프레임에서 빠진다', () => {
    const r = run(goldenInputs[A]());
    const held = r.timeline.map((f) => f.holdings.map((h) => h.symbol).join());
    // D[9] 매수 → D[13] 본전 손절
    expect(held.slice(8, 15)).toEqual(['', 'S0', 'S0', 'S0', 'S0', '', '']);
    expect(r.timeline.flatMap((f) => f.holdings).every((h) => h.openDate === D[9])).toBe(true);
  });

  it('같은 날 사고 전량 판 종목은 holdings에 없고 그날 체결에만 있다', () => {
    const i: SimInput = { strategy: baseStrategy(), days: D.slice(0, 10), stocks: [stockOf(0, candlesFrom(BASE, [[87, 87, 82, 83]]))], index: null, benchmarkStock: null };
    const r = run(i);
    expect(r.trades.map((t) => `${t.date}:${t.kind}`)).toEqual([`${D[9]}:buy`, `${D[9]}:stop`]);
    expect(r.timeline[9].holdings).toEqual([]);
  });

  it('손절·다음 추가·익절 가격은 같은 시점의 Position 계산과 같다(분할 매수 중 손절 null, 본전 손절 뒤 평단 이상)', () => {
    const input = goldenInputs[A]();
    const s = input.strategy;
    const r = run(input);
    const [buy, add1, add2, take1] = r.trades;
    const at = (i: number) => r.timeline[i].holdings[0];

    // D[9]: 매수 + 추가 1번(아직 분할 매수 중)
    const p = openPosition(buy.price, buy.qty, s.scaleIn, s.rules.sell);
    p.buy(add1.price, add1.qty);
    expect(at(9)).toMatchObject({ qty: p.qty, avgPrice: p.avgPrice, stop: null, nextAdd: p.nextAddPrice(), takes: takesOf(p.takeLevels()), close: 97 });
    expect(at(9).value).toBe(roundMoney(p.qty * 97));
    expect(at(9).pnlPct).toBeCloseTo((97 / p.avgPrice - 1) * 100, 10);

    // D[10]: 추가 2번째로 분할 매수 끝 → 손절가가 생기고 다음 추가는 없다
    expect(add2.date).toBe(D[10]);
    p.buy(add2.price, add2.qty);
    expect(at(10)).toMatchObject({ stop: p.stopPrice(), nextAdd: null, takes: takesOf(p.takeLevels()), close: 95 });
    expect(at(10).stop).not.toBeNull();

    // D[11]: 1단계 익절 뒤 본전 손절(평단 이상), 남은 익절은 2·3단계
    expect(take1.date).toBe(D[11]);
    p.sell(take1.qty, 1);
    expect(at(11)).toMatchObject({ qty: p.qty, stop: p.stopPrice(), takes: takesOf(p.takeLevels()) });
    expect(at(11).stop!).toBeGreaterThanOrEqual(at(11).avgPrice);
    expect(at(11).takes.map((t) => t.stage)).toEqual([2, 3]);
  });

  it('봉 없는 날 종가는 마지막 종가다', () => {
    const r = run(goldenInputs[B]());
    const buy = r.trades[0];
    // S0은 인덱스 11·12에 봉이 없다 → 인덱스 10 종가 88
    for (const i of [11, 12]) {
      const h = r.timeline[i].holdings.find((x) => x.symbol === 'S0')!;
      expect(h.close, D[i]).toBe(88);
      expect(h.value).toBe(roundMoney(buy.qty * 88));
      expect(h.pnlPct).toBeCloseTo((88 / h.avgPrice - 1) * 100, 10);
    }
    expect(r.timeline[13].holdings).toEqual([]); // 갭 손절
  });

  it.each(Object.entries(goldenInputs))('%s: 예약은 신호 난 날에만 있고 다음 거래일 매수나 건너뜀으로 이어진다', (_name, make) => {
    const r = run(make());
    r.timeline.forEach((f, i) => {
      for (const p of f.pending) {
        const next = r.timeline[i + 1];
        expect(next, `${f.date} ${p.symbol}: 마지막 날에는 예약이 없다`).toBeDefined();
        const bought = r.trades.some((t) => t.date === next.date && t.symbol === p.symbol && t.kind === 'buy' && t.reason === p.reason);
        const skipped = r.skipped.some((k) => k.date === next.date && k.symbol === p.symbol);
        expect(bought || skipped, `${f.date} ${p.symbol}`).toBe(true);
      }
    });
    // 모든 매수는 전날 예약에서 왔다
    for (const t of r.trades.filter((x) => x.kind === 'buy')) {
      const i = r.timeline.findIndex((f) => f.date === t.date);
      expect(r.timeline[i - 1].pending).toContainEqual({ symbol: t.symbol, reason: t.reason });
    }
    expect(r.timeline.at(-1)!.pending).toEqual([]);
  });
});
