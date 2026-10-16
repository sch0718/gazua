import type { MarketDataFile } from '../marketData/format';
import { roundMoney } from '../sim/money';
import { costOf, maxShares } from '../sim/position';
import { sellTaxPct, settlementDate } from '../sim/tax';
import type { Selection } from './select';

/** 못 산 이유: 재선정일에 봉이 없음 · 1주 값이 배정 금액보다 큼 · 매도 비용으로 현금이 모자람 */
export type NotBoughtReason = 'noBar' | 'tooExpensive' | 'cash';

export interface HoldSegment {
  from: string;
  to: string;
  picked: { symbol: string; retPct: number | null; soldAtLastClose: boolean; notBought: boolean; notBoughtReason?: NotBoughtReason }[];
}

export interface HoldInput {
  axis: string[];
  selections: Selection[];
  data: MarketDataFile;
  capital: number;
  feePct: number;
  periodEnd: string;
}

type Stock = MarketDataFile['stocks'][number];

const ymd = (d: string): string => d.replaceAll('-', '');

/** ① 재선정일 시가에 자산을 고른 종목 수로 나눠 동일 비중으로 보유한다 */
export function holdSelection(input: HoldInput): { equity: { date: string; value: number }[]; segments: HoldSegment[] } {
  const { axis, selections, data, feePct } = input;
  if (!selections.length) return { equity: [], segments: [] };
  const start = selections[0].date;
  const days = axis.filter((d) => d >= start && d <= input.periodEnd);

  const stocks = new Map<string, { st: Stock; at: Map<string, number> }>();
  for (const st of data.stocks) stocks.set(st.s, { st, at: new Map(st.d.map((d, i) => [d, i])) });

  const selByDate = new Map(selections.map((s, i) => [s.date, i]));
  let cash = roundMoney(input.capital);
  const qty = new Map<string, number>();
  const lastClose = new Map<string, number>();
  const equity: { date: string; value: number }[] = [];
  const segments: HoldSegment[] = [];
  // 구간 중 종목별 진입 시가와 마지막 종가 기준 매도 여부
  let open: { from: string; entries: Map<string, number | null>; reasons: Map<string, NotBoughtReason>; order: string[] } | null = null;

  const barAt = (symbol: string, d: string): number | null => stocks.get(symbol)?.at.get(ymd(d)) ?? null;

  // 구간을 닫는다: 종목별 (청산가 / 진입 시가 − 1)
  const closeSegment = (to: string, exitPrice: (symbol: string) => { price: number; last: boolean }) => {
    if (!open) return;
    const picked = open.order.map((symbol) => {
      const entry = open!.entries.get(symbol) ?? null;
      if (entry === null) return { symbol, retPct: null, soldAtLastClose: false, notBought: true, notBoughtReason: open!.reasons.get(symbol) ?? 'noBar' };
      const { price, last } = exitPrice(symbol);
      return { symbol, retPct: (price / entry - 1) * 100, soldAtLastClose: last, notBought: false };
    });
    segments.push({ from: open.from, to, picked });
  };

  days.forEach((d) => {
    // 오늘 봉이 있으면 종가를 갱신하기 전에 시가 거래부터 한다
    const si = selByDate.get(d);
    if (si !== undefined) {
      const sel = selections[si];
      const openPx = (symbol: string): number | null => {
        const e = stocks.get(symbol);
        const i = barAt(symbol, d);
        return e && i !== null ? e.st.o[i] : null;
      };
      // 이전 구간 마감: 시가 매도 가격(봉이 없으면 마지막 종가)
      closeSegment(d, (symbol) => {
        const p = openPx(symbol);
        return p !== null ? { price: p, last: false } : { price: lastClose.get(symbol)!, last: true };
      });

      // 그 시점 자산 = 현금 + 보유분(시가, 봉 없으면 마지막 종가)
      let total = cash;
      for (const [symbol, q] of qty) total += q * (openPx(symbol) ?? lastClose.get(symbol)!);
      total = roundMoney(total);

      const picks = sel.picked.map((p) => p.symbol);
      const target = picks.length ? roundMoney(total / picks.length) : 0;
      const targetQty = new Map<string, number>();
      const entries = new Map<string, number | null>();
      const reasons = new Map<string, NotBoughtReason>();
      for (const symbol of picks) {
        const p = openPx(symbol);
        entries.set(symbol, p);
        if (p === null) reasons.set(symbol, 'noBar');
        const q = p === null ? 0 : maxShares(target, p, feePct);
        // 배정 금액으로 1주도 못 사면 봉이 없는 것과 같이 못 산 것으로 둔다
        if (q === 0) {
          entries.set(symbol, null);
          if (p !== null) reasons.set(symbol, 'tooExpensive');
        } else targetQty.set(symbol, q);
      }

      // 매도 먼저: 고르지 않았거나 봉이 없는 종목은 전부, 다시 뽑힌 종목은 초과분만
      for (const [symbol, held] of [...qty]) {
        const e = stocks.get(symbol)!;
        const p = openPx(symbol);
        const want = p === null ? 0 : (targetQty.get(symbol) ?? 0);
        const sellQ = held - want;
        if (sellQ <= 0) continue;
        const price = p ?? lastClose.get(symbol)!;
        const gross = roundMoney(sellQ * price);
        const fee = roundMoney((gross * feePct) / 100);
        const tax = roundMoney((gross * sellTaxPct(settlementDate(d, axis), e.st.m, e.st.t === 'ETF')) / 100);
        cash = roundMoney(cash + roundMoney(gross - fee - tax));
        if (want === 0) qty.delete(symbol);
        else qty.set(symbol, want);
      }
      // 부족분 매수. 매도 수수료·세금으로 현금이 모자라면 살 수 있는 만큼만 산다
      for (const symbol of picks) {
        const p = entries.get(symbol);
        if (p == null) continue;
        let need = (targetQty.get(symbol) ?? 0) - (qty.get(symbol) ?? 0);
        while (need > 0 && costOf(need, p, feePct) > cash) need--;
        if (need <= 0) {
          if (!qty.has(symbol)) {
            entries.set(symbol, null);
            reasons.set(symbol, 'cash');
          }
          continue;
        }
        cash = roundMoney(cash - costOf(need, p, feePct));
        qty.set(symbol, (qty.get(symbol) ?? 0) + need);
      }
      open = { from: d, entries, reasons, order: picks };
    }

    // 종가 평가: 봉이 없으면 직전 종가
    let held = 0;
    for (const symbol of new Set([...qty.keys(), ...(open?.order ?? [])])) {
      const i = barAt(symbol, d);
      if (i !== null) lastClose.set(symbol, stocks.get(symbol)!.st.c[i]);
    }
    for (const [symbol, q] of qty) held = roundMoney(held + roundMoney(q * lastClose.get(symbol)!));
    equity.push({ date: d, value: roundMoney(cash + held) });
  });

  // 마지막 구간은 기간 마지막 종가까지. 팔지 않는다
  closeSegment(days[days.length - 1], (symbol) => ({ price: lastClose.get(symbol)!, last: false }));
  return { equity, segments };
}
