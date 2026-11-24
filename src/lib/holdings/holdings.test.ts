import { describe, expect, it } from 'vitest';
import { cleanLabel, sanitizeManualHoldings, DEFAULT_ACCOUNT_LABEL, type ManualHolding } from './manual';
import { accountLabels, buildRows, summarize } from './rows';

const manual = (over: Partial<ManualHolding> = {}): ManualHolding => ({
  id: 'm1', symbol: '005930', name: '삼성전자', qty: 10, avgPrice: 70000, account: '연금저축', ...over,
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
