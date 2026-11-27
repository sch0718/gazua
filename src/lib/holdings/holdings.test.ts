import { describe, expect, it } from 'vitest';
import { cleanLabel, sanitizeManualHoldings, DEFAULT_ACCOUNT_LABEL, type ManualHolding } from './manual';
import { accountLabels, buildRows, sortByMine, summarize, symbolPnl, type Mine } from './rows';

const manual = (over: Partial<ManualHolding> = {}): ManualHolding => ({
  id: 'm1', symbol: '005930', name: '삼성전자', qty: 10, avgPrice: 70000, account: '연금저축', ...over,
});

describe('symbolPnl', () => {
  const sameSymbol = buildRows(
    [{ symbol: '005930', name: '예시 종목', quantity: 2, avgPrice: 100 }],
    '데모',
    [manual({ qty: 1, avgPrice: 200 }), manual({ id: 'm2', qty: 5, avgPrice: null })],
    { prices: { '005930': 150 }, prevClose: {} },
  );

  it('종목별 수익금 합계를 매수금액 합계로 나눠 수익률을 구해요', () => {
    expect(symbolPnl(sameSymbol)).toEqual({ '005930': { state: 'ok', pnl: 50, pct: 12.5 } });
  });

  it('같은 종목에 가격 없는 행이 하나라도 있으면 가격을 기다려요', () => {
    const [first, second] = sameSymbol;
    expect(symbolPnl([first, { ...second, price: null }])['005930']).toEqual({ state: 'pending', pnl: null, pct: null });
  });

  it('유효한 평단과 수량이 있는 행이 없으면 평단 없음으로 표시해요', () => {
    const rows = buildRows([], '데모', [
      manual({ qty: 2, avgPrice: 0 }),
      manual({ id: 'm2', qty: 0, avgPrice: 100 }),
      manual({ id: 'm3', qty: 1, avgPrice: null }),
    ], { prices: { '005930': 150 }, prevClose: {} });
    expect(rows.map((r) => r.pnl)).toEqual([null, null, null]);
    expect(symbolPnl(rows)['005930']).toEqual({
      state: 'noavg', pnl: null, pct: null,
    });
  });
});

describe('sortByMine', () => {
  const items: { symbol: string; mine?: Mine }[] = [
    { symbol: 'A', mine: { state: 'noavg', pnl: null, pct: null } },
    { symbol: 'B', mine: { state: 'ok', pnl: 10, pct: 5 } },
    { symbol: 'C', mine: { state: 'ok', pnl: 20, pct: 2 } },
    { symbol: 'D', mine: { state: 'ok', pnl: 20, pct: 3 } },
    { symbol: 'E', mine: { state: 'pending', pnl: null, pct: null } },
    { symbol: 'F', mine: { state: 'ok', pnl: -1, pct: -1 } },
    { symbol: 'G' },
  ];
  const pick = (item: (typeof items)[number]) => item.mine;
  const symbols = (rows: typeof items) => rows.map((r) => r.symbol);

  it('수익금과 수익률을 각각 내림차순으로 정렬하고 동점과 값이 없는 행의 입력 순서를 지켜요', () => {
    expect(symbols(sortByMine(items, 'pnl', pick))).toEqual(['C', 'D', 'B', 'F', 'A', 'E', 'G']);
    expect(symbols(sortByMine(items, 'pct', pick))).toEqual(['B', 'D', 'C', 'F', 'A', 'E', 'G']);
    expect(symbols(items)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
  });

  it('고정한 종목 순서를 우선하고 나머지는 수익 순으로 붙여요', () => {
    expect(symbols(sortByMine(items, 'pnl', pick, ['E', 'B', 'Z']))).toEqual(['E', 'B', 'C', 'D', 'F', 'A', 'G']);
  });
});

describe('sanitizeManualHoldings', () => {
  it('올바른 항목은 그대로, 틀린 항목은 버리고 repaired로 알린다', () => {
    const r = sanitizeManualHoldings({
      holdings: [manual(), { id: 'x', symbol: 'bad', name: 'n', qty: 1 }, manual({ id: 'm1' }), manual({ id: 'm2', qty: 0 })],
    });
    expect(r.holdings.map((h) => h.id)).toEqual(['m1']);
    expect(r.repaired).toBe(true);
  });
  it('라벨이 비면 기타, 평단이 틀리면 null', () => {
    const r = sanitizeManualHoldings({ holdings: [{ ...manual(), account: '  ', avgPrice: -1 }] });
    expect(r.holdings[0]).toMatchObject({ account: DEFAULT_ACCOUNT_LABEL, avgPrice: null });
  });
  it('저장된 것이 없으면 빈 목록(고친 것으로 치지 않는다)', () => {
    expect(sanitizeManualHoldings(null)).toEqual({ holdings: [], repaired: false });
  });
  it('라벨은 12자까지', () => {
    expect([...cleanLabel('가'.repeat(20))]).toHaveLength(12);
  });
});

describe('buildRows·summarize', () => {
  const market = { prices: { '005930': 80000, '000660': 90000 }, prevClose: { '005930': 78000, '000660': 100000 } };
  const rows = buildRows(
    [{ symbol: '000660', name: 'SK하이닉스', quantity: 2, avgPrice: 100000 }],
    '토스',
    [manual(), manual({ id: 'm2', symbol: '035420', name: 'NAVER', avgPrice: null, account: 'ISA' })],
    market,
  );
  it('계좌 보유를 앞에 두고 라벨을 나눈다', () => {
    expect(rows.map((r) => r.account)).toEqual(['토스', '연금저축', 'ISA']);
    expect(accountLabels(rows)).toEqual(['토스', '연금저축', 'ISA']);
  });
  it('손익·등락률은 평단·시세가 있을 때만 계산한다', () => {
    expect(rows[0]).toMatchObject({ pnl: -20000 });
    expect(rows[0].dayPct).toBeCloseTo(-10);
    expect(rows[1]).toMatchObject({ pnl: 100000, value: 800000 });
    expect(rows[2]).toMatchObject({ price: null, pnl: null, value: null });
  });
  it('합계는 값이 있는 종목만 센다', () => {
    const s = summarize(rows);
    expect(s).toMatchObject({ count: 3, value: 980000, cost: 900000, pnl: 80000 });
    expect(s.pnlPct).toBeCloseTo((80000 / 900000) * 100);
    expect(s.dayPnl).toBe(-20000 + 20000);
  });
});
