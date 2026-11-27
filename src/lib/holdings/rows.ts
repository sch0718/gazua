// 보유 종목 행 만들기와 합계. 토스 계좌의 보유와 직접 넣은 보유를 한 목록으로 합친다. 화면·네트워크와 무관한 순수 함수.
import type { AccountHolding } from '../providers/types';
import type { ManualHolding } from './manual';

export interface HoldingRow {
  key: string;
  symbol: string;
  name: string;
  account: string;
  qty: number;
  avgPrice: number | null;
  price: number | null;
  /** 전 거래일 종가 */
  prevClose: number | null;
  /** 오늘 등락률(%) */
  dayPct: number | null;
  /** 평가금액 */
  value: number | null;
  /** 평가손익(원). 평단이나 현재가를 모르면 null */
  pnl: number | null;
  pnlPct: number | null;
  manualId: string | null;
}

export interface Summary {
  count: number;
  value: number;
  /** 평단과 현재가를 둘 다 아는 종목의 매수금액 */
  cost: number;
  pnl: number;
  pnlPct: number | null;
  /** 오늘 평가손익(전일 종가 기준) */
  dayPnl: number;
  dayPct: number | null;
}

export interface Market {
  prices: Record<string, number>;
  prevClose: Record<string, number>;
}

export type Mine =
  | { state: 'ok'; pnl: number; pct: number }
  | { state: 'pending' | 'noavg'; pnl: null; pct: null };

export type MineSort = 'pnl' | 'pct';

function makeRow(
  base: { key: string; symbol: string; name: string; account: string; qty: number; avgPrice: number | null; manualId: string | null },
  m: Market,
): HoldingRow {
  const price = m.prices[base.symbol] ?? null;
  const prev = m.prevClose[base.symbol] ?? null;
  const value = price === null ? null : price * base.qty;
  const avg = base.avgPrice;
  const hasCost = avg !== null && avg > 0 && base.qty > 0;
  const pnl = price !== null && hasCost ? (price - avg) * base.qty : null;
  const pnlPct = price !== null && hasCost ? (price / avg - 1) * 100 : null;
  const dayPct = price !== null && prev !== null && prev > 0 ? (price / prev - 1) * 100 : null;
  return { ...base, price, prevClose: prev, dayPct, value, pnl, pnlPct };
}

/** 계좌 보유(라벨 `accountLabel`)를 앞에, 직접 넣은 보유를 뒤에 둔다. 같은 종목도 계좌가 다르면 따로 보여 준다. */
export function buildRows(account: readonly AccountHolding[], accountLabel: string, manual: readonly ManualHolding[], m: Market): HoldingRow[] {
  const rows = account.map((h, i) =>
    makeRow({ key: `a:${i}:${h.symbol}`, symbol: h.symbol, name: h.name, account: accountLabel, qty: h.quantity, avgPrice: h.avgPrice ?? null, manualId: null }, m),
  );
  for (const h of manual) {
    rows.push(makeRow({ key: `m:${h.id}`, symbol: h.symbol, name: h.name, account: h.account, qty: h.qty, avgPrice: h.avgPrice, manualId: h.id }, m));
  }
  return rows;
}

export function summarize(rows: readonly HoldingRow[]): Summary {
  let value = 0;
  let cost = 0;
  let pnl = 0;
  let dayPnl = 0;
  let dayBase = 0;
  for (const r of rows) {
    if (r.value !== null) value += r.value;
    if (r.pnl !== null && r.avgPrice !== null) {
      pnl += r.pnl;
      cost += r.avgPrice * r.qty;
    }
    if (r.price !== null && r.prevClose !== null) {
      dayPnl += (r.price - r.prevClose) * r.qty;
      dayBase += r.prevClose * r.qty;
    }
  }
  return {
    count: rows.length,
    value,
    cost,
    pnl,
    pnlPct: cost > 0 ? (pnl / cost) * 100 : null,
    dayPnl,
    dayPct: dayBase > 0 ? (dayPnl / dayBase) * 100 : null,
  };
}

/** 같은 종목의 수익금을 더하고, 매수금액 합계로 수익률을 구해요. */
export function symbolPnl(rows: readonly HoldingRow[]): Record<string, Mine> {
  const totals = new Map<string, { pending: boolean; cost: number; pnl: number }>();
  for (const row of rows) {
    const total = totals.get(row.symbol) ?? { pending: false, cost: 0, pnl: 0 };
    if (row.price === null) total.pending = true;
    if (row.pnl !== null && row.avgPrice !== null && row.avgPrice > 0 && row.qty > 0) {
      total.cost += row.avgPrice * row.qty;
      total.pnl += row.pnl;
    }
    totals.set(row.symbol, total);
  }
  return Object.fromEntries([...totals].map(([symbol, { pending, cost, pnl }]): [string, Mine] => {
    if (pending) return [symbol, { state: 'pending', pnl: null, pct: null }];
    if (cost <= 0) return [symbol, { state: 'noavg', pnl: null, pct: null }];
    return [symbol, { state: 'ok', pnl, pct: (pnl / cost) * 100 }];
  }));
}

/** 고정한 종목이 먼저 와요. 나머지는 수익 내림차순이고, 값이 없거나 같으면 입력 순서를 지켜요. */
export function sortByMine<T extends { symbol: string }>(
  items: readonly T[],
  key: MineSort,
  pick: (item: T) => Mine | undefined,
  frozen?: readonly string[] | null,
): T[] {
  const ranks = new Map(frozen?.map((symbol, index) => [symbol, index]));
  return items
    .map((item) => {
      const mine = pick(item);
      return {
        item,
        rank: ranks.get(item.symbol) ?? ranks.size,
        value: mine?.state === 'ok' ? mine[key] : -Infinity,
      };
    })
    .sort((a, b) => a.rank - b.rank || (a.value === b.value ? 0 : b.value - a.value))
    .map(({ item }) => item);
}

/** 계좌 라벨 목록(등장 순서). 필터 칩에 쓴다. */
export function accountLabels(rows: readonly HoldingRow[]): string[] {
  return [...new Set(rows.map((r) => r.account))];
}
