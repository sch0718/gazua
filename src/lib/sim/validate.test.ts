import { describe, expect, it } from 'vitest';
import { itemsOf } from '../../sheets/testApp';
import { newStrategy } from './defaults';
import { resolveSymbols, sanitizeStrategies, strategyIssues } from './validate';

const now = Date.parse('2026-10-12T03:00:00Z'); // KST 12:00
const w = { groups: [{ id: 'g1', name: '반도체', items: itemsOf(['005930', '000660']) }] };

describe('newStrategy', () => {
  it('기본값은 어제 기준 3년, 그 밖은 스펙 기본값', () => {
    const s = newStrategy(now, 'g1');
    expect(s.period).toEqual({ from: '2023-10-11', to: '2026-10-11' });
    expect(s.exit.takeProfit).toEqual([{ pct: 15, sellPct: 100 }]);
    expect(s.universe).toEqual({ kind: 'group', groupId: 'g1' });
    expect(s.costs.feePct).toBe(0.015);
    expect(newStrategy(now, null).universe).toEqual({ kind: 'symbols', symbols: [] });
  });

  it('어제가 윤일이면 3년 전은 2월 28일', () => {
    const leap = Date.parse('2028-03-01T03:00:00Z');
    expect(newStrategy(leap, 'g1').period).toEqual({ from: '2025-02-28', to: '2028-02-29' });
  });
});

describe('strategyIssues', () => {
  const s = newStrategy(now, 'g1');

  it('기본 전략은 경고가 없다', () => {
    expect(strategyIssues(s, w)).toEqual([]);
    expect(resolveSymbols(s, w)).toEqual(['005930', '000660']);
  });

  it('그룹이 없어졌거나 비면 막는다', () => {
    const issue = { section: 'universe', text: '종목을 하나 이상 골라 주세요', blocking: true };
    expect(strategyIssues(s, { groups: [] })).toContainEqual(issue);
    expect(resolveSymbols(s, { groups: [] })).toEqual([]);
    expect(strategyIssues(s, { groups: [{ id: 'g1', name: '빈', items: [] }] })).toContainEqual(issue);
  });

  it('트리거가 없으면 막는다', () => {
    const t = structuredClone(s);
    t.entry.triggers.reboundDays.on = false;
    t.entry.triggers.breakout.on = false;
    expect(strategyIssues(t, w)).toContainEqual({
      section: 'entry',
      text: '매수 신호가 나지 않아요. 트리거를 하나 이상 켜 주세요',
      blocking: true,
    });
  });

  it('avgAlways + 분할 매수에서 간격이 손절폭 이상이면 경고만', () => {
    const t = structuredClone(s);
    t.scaleIn = { on: true, stepPct: 5, maxAdds: 2 };
    t.exit.stopLoss = { pct: 5, basis: 'avgAlways' };
    expect(strategyIssues(t, w)).toContainEqual({
      section: 'exit',
      text: '추가 매수보다 손절이 먼저 일어나요. 추가 매수 간격을 손절폭보다 작게 해 주세요',
      blocking: false,
    });
    t.scaleIn.stepPct = 4;
    expect(strategyIssues(t, w)).toEqual([]);
  });

  it('익절 단계가 오름차순이 아니면 막는다', () => {
    const t = structuredClone(s);
    t.exit.takeProfit = [{ pct: 15, sellPct: 50 }, { pct: 10, sellPct: 100 }];
    expect(strategyIssues(t, w)).toContainEqual({
      section: 'exit',
      text: '익절 단계는 낮은 %부터 차례로 적어 주세요',
      blocking: true,
    });
  });

  it('from ≥ to 이면 막는다', () => {
    const t = structuredClone(s);
    t.period = { from: '2026-01-02', to: '2026-01-02' };
    const issues = strategyIssues(t, w);
    expect(issues).toContainEqual({ section: 'period', text: '시작일이 종료일보다 앞이어야 해요', blocking: true });
    expect(issues.map((i) => i.text)).not.toContain('기간이 짧아 결과를 믿기 어려워요');
  });

  it('달력 42일 미만이면 짧다는 경고', () => {
    const t = structuredClone(s);
    const short = { section: 'period', text: '기간이 짧아 결과를 믿기 어려워요', blocking: false };
    t.period = { from: '2026-01-01', to: '2026-02-11' }; // 41일
    expect(strategyIssues(t, w)).toContainEqual(short);
    t.period = { from: '2026-01-01', to: '2026-02-12' }; // 42일
    expect(strategyIssues(t, w)).not.toContainEqual(short);
  });

  it('현금이 모자랄 수 있으면 경고', () => {
    const t = structuredClone(s);
    t.capital.perBuyPct = 60; // 60 × 1 × 2 = 120
    expect(strategyIssues(t, w)).toContainEqual({
      section: 'capital',
      text: '모든 종목이 한꺼번에 사면 현금이 모자라요. 신호 일부를 건너뛸 수 있어요',
      blocking: false,
    });
    t.capital.perBuyPct = 20; // 20 × 1 × 2 = 40
    expect(strategyIssues(t, w).map((i) => i.section)).not.toContain('capital');
    t.scaleIn = { on: true, stepPct: 3, maxAdds: 2 }; // 20 × 3 × 2 = 120
    expect(strategyIssues(t, w).map((i) => i.section)).toContain('capital');
  });
});

describe('sanitizeStrategies', () => {
  const s = newStrategy(now, 'g1');

  it('깨진 항목만 빠지고 빠진 필드는 기본값', () => {
    const { strategies, repaired } = sanitizeStrategies({ strategies: [s, { id: 3 }, { ...s, id: 'x', costs: undefined }] });
    expect(strategies.map((x) => x.id)).toEqual([s.id, 'x']);
    expect(strategies[1].costs.feePct).toBe(0.015);
    expect(repaired).toBe(true);
  });

  it('온전하면 그대로, repaired 아님', () => {
    const r = sanitizeStrategies({ strategies: [s] });
    expect(r.strategies).toEqual([s]);
    expect(r.repaired).toBe(false);
    expect(sanitizeStrategies(null)).toEqual({ strategies: [], repaired: false });
  });

  it('범위 밖 숫자는 기본값, 종목은 8개까지', () => {
    const bad = structuredClone(s) as any;
    bad.capital.perBuyPct = 500;
    bad.entry.triggers.maCross.period = 1;
    bad.exit.takeProfit = [];
    bad.costs.feePct = 2;
    bad.universe = { kind: 'symbols', symbols: Array.from({ length: 10 }, (_, i) => `00000${i}`) };
    const { strategies, repaired } = sanitizeStrategies({ strategies: [bad] });
    const [r] = strategies;
    expect(r.capital.perBuyPct).toBe(10);
    expect(r.entry.triggers.maCross.period).toBe(20);
    expect(r.exit.takeProfit).toEqual([{ pct: 15, sellPct: 100 }]);
    expect(r.costs.feePct).toBe(0.015);
    expect(r.universe).toEqual({ kind: 'symbols', symbols: bad.universe.symbols.slice(0, 8) });
    expect(repaired).toBe(true);
  });

  it('마지막 익절 단계는 100으로 저장, 단계는 3개까지', () => {
    const t = structuredClone(s);
    t.exit.takeProfit = [
      { pct: 5, sellPct: 30 }, { pct: 10, sellPct: 30 }, { pct: 20, sellPct: 30 }, { pct: 30, sellPct: 100 },
    ];
    const [r] = sanitizeStrategies({ strategies: [t] }).strategies;
    expect(r.exit.takeProfit).toEqual([{ pct: 5, sellPct: 30 }, { pct: 10, sellPct: 30 }, { pct: 20, sellPct: 100 }]);
  });
});
