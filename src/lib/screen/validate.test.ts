import { describe, expect, it } from 'vitest';
import { newStrategy } from '../sim/defaults';
import { kstEpoch } from '../time/kst';
import { newCriteria } from './defaults';
import type { SelectionCriteria } from './types';
import { criteriaIssues, sanitizeCriteria } from './validate';

const NOW = kstEpoch('2026-10-16', '12:00:00');
const RANGE = { from: '2021-03-02', to: '2026-10-15' };
const base = (id = 'c1'): SelectionCriteria => ({ ...newCriteria(NOW, RANGE), id });
const run = (patch: (c: Record<string, any>) => void) => {
  const c: Record<string, any> = structuredClone(base());
  patch(c);
  return sanitizeCriteria({ criteria: [c] }, NOW);
};

describe('sanitizeCriteria', () => {
  it('정상 값은 그대로이고 repaired false', () => {
    const c = base();
    expect(sanitizeCriteria({ criteria: [c] }, NOW)).toEqual({ criteria: [c], repaired: false });
  });

  it('루트가 없으면 조용히 빈 목록, 모양이 틀리면 repaired', () => {
    expect(sanitizeCriteria(null, NOW)).toEqual({ criteria: [], repaired: false });
    expect(sanitizeCriteria({}, NOW)).toEqual({ criteria: [], repaired: false });
    expect(sanitizeCriteria({ criteria: 'x' }, NOW)).toEqual({ criteria: [], repaired: true });
    expect(sanitizeCriteria([], NOW)).toEqual({ criteria: [], repaired: true });
  });

  it.each([0, 31, 2.5, NaN, '5'])('take: %s는 기본값 10으로 되돌린다', (take) => {
    const r = run((c) => (c.rank.take = take));
    expect(r.criteria[0].rank.take).toBe(10);
    expect(r.repaired).toBe(true);
  });

  it.each([1, 30])('take: %s는 그대로 둔다', (take) => {
    const r = run((c) => (c.rank.take = take));
    expect(r.criteria[0].rank.take).toBe(take);
    expect(r.repaired).toBe(false);
  });

  it('markets: []는 기본값(둘 다)으로 되돌린다', () => {
    const r = run((c) => (c.pool.markets = []));
    expect(r.criteria[0].pool.markets).toEqual(['KOSPI', 'KOSDAQ']);
    expect(r.repaired).toBe(true);
  });

  it('types: []와 잘못된 열거값은 기본값', () => {
    const r = run((c) => (c.pool.types = []));
    expect(r.criteria[0].pool.types).toEqual(['STOCK']);
    expect(r.repaired).toBe(true);
    const r2 = run((c) => (c.pool.types = ['ETN']));
    expect(r2.criteria[0].pool.types).toEqual(['STOCK']);
    expect(r2.repaired).toBe(true);
  });

  it('잘못된 열거값(rank.by, rebalance, vsMa.side, leader.level)은 기본값', () => {
    const r = run((c) => {
      c.rank.by = 'x';
      c.rebalance = 'daily';
      c.conditions.vsMa.side = 'up';
      c.conditions.leader.level = 3;
    });
    const k = r.criteria[0];
    expect([k.rank.by, k.rebalance, k.conditions.vsMa.side, k.conditions.leader.level]).toEqual(['marketCap', 'monthly', 'above', 1]);
    expect(r.repaired).toBe(true);
  });

  it('benchmarks.symbols 4개는 3개로 자르고 repaired', () => {
    const r = run((c) => (c.benchmarks.symbols = ['1', '2', '3', '4']));
    expect(r.criteria[0].benchmarks.symbols).toEqual(['1', '2', '3']);
    expect(r.repaired).toBe(true);
  });

  it('benchmarks.symbols 3개는 그대로, indices는 빈 배열도 허용', () => {
    const r = run((c) => {
      c.benchmarks.symbols = ['1', '2', '3'];
      c.benchmarks.indices = [];
    });
    expect(r.criteria[0].benchmarks).toEqual({ indices: [], symbols: ['1', '2', '3'] });
    expect(r.repaired).toBe(false);
  });

  it('빈 id·id 없음·이름 없음 항목은 버린다', () => {
    const ok = base('ok');
    const r = sanitizeCriteria({ criteria: [{ ...ok, id: '' }, { ...ok, id: '  ' }, { ...ok, id: undefined }, { ...ok, name: 3 }, ok, 'x'] }, NOW);
    expect(r.criteria.map((c) => c.id)).toEqual(['ok']);
    expect(r.repaired).toBe(true);
  });

  it('id가 겹치면 뒤 항목을 버리고, 20개까지만 남긴다', () => {
    const dup = sanitizeCriteria({ criteria: [base('a'), base('a')] }, NOW);
    expect(dup.criteria).toHaveLength(1);
    expect(dup.repaired).toBe(true);
    const many = Array.from({ length: 21 }, (_, i) => base(`c${i}`));
    const r = sanitizeCriteria({ criteria: many }, NOW);
    expect(r.criteria).toHaveLength(20);
    expect(r.repaired).toBe(true);
  });

  it('정수 필드는 소수를 받지 않는다', () => {
    const r = run((c) => {
      c.conditions.tradingValue.days = 2.5;
      c.conditions.vsMa.period = 60.5;
      c.conditions.rebound.withinDays = 1.5;
      c.capital = 1000.5;
    });
    const k = r.criteria[0];
    expect([k.conditions.tradingValue.days, k.conditions.vsMa.period, k.conditions.rebound.withinDays, k.capital]).toEqual([20, 60, 10, 10_000_000]);
    expect(r.repaired).toBe(true);
  });

  it('범위 밖 숫자는 기본값', () => {
    const r = run((c) => {
      c.conditions.marketCap.minEok = -1;
      c.conditions.volatility.maxPct = 101;
      c.costs.feePct = 2;
      c.conditions.fromHigh.minPct = Infinity;
    });
    const k = r.criteria[0];
    expect([k.conditions.marketCap.minEok, k.conditions.volatility.maxPct, k.costs.feePct, k.conditions.fromHigh.minPct]).toEqual([1000, 3, 0.015, 20]);
    expect(r.repaired).toBe(true);
  });

  it('이름은 30자로 자르고 repaired', () => {
    const r = run((c) => (c.name = '가'.repeat(31)));
    expect(r.criteria[0].name).toHaveLength(30);
    expect(r.repaired).toBe(true);
  });

  it('없는 필드는 조용히 기본값(repaired false)', () => {
    const r = sanitizeCriteria({ criteria: [{ id: 'a', name: '최소' }] }, NOW);
    expect(r.repaired).toBe(false);
    expect(r.criteria[0]).toMatchObject({ id: 'a', name: '최소', rank: { by: 'marketCap', take: 10 }, trading: { strategyId: null } });
  });

  it('잘못된 날짜 기간은 기본 기간(최근 3년)으로 되돌린다', () => {
    const r = run((c) => (c.period = { from: '2026-02-30', to: 'x' }));
    expect(r.criteria[0].period).toEqual({ from: '2023-10-15', to: '2026-10-15' });
    expect(r.repaired).toBe(true);
  });

  it('반등 패턴: strategy·custom은 유지하고, custom의 소수 기간은 고친다', () => {
    const s = run((c) => (c.conditions.rebound.pattern = { from: 'strategy', strategyId: 's1' }));
    expect(s.criteria[0].conditions.rebound.pattern).toEqual({ from: 'strategy', strategyId: 's1' });
    expect(s.repaired).toBe(false);
    const bad = run((c) => (c.conditions.rebound.pattern.entry.filter.aboveMa = { on: true, period: 2.5 }));
    const p = bad.criteria[0].conditions.rebound.pattern;
    expect(p.from === 'custom' && p.entry.filter.aboveMa.period).toBe(60);
    expect(bad.repaired).toBe(true);
    const wrong = run((c) => (c.conditions.rebound.pattern = { from: 'strategy' }));
    expect(wrong.criteria[0].conditions.rebound.pattern.from).toBe('custom');
    expect(wrong.repaired).toBe(true);
  });

  it('trading.strategyId는 null 또는 비어 있지 않은 문자열만', () => {
    expect(run((c) => (c.trading.strategyId = 's9')).criteria[0].trading.strategyId).toBe('s9');
    const r = run((c) => (c.trading.strategyId = 5));
    expect(r.criteria[0].trading.strategyId).toBeNull();
    expect(r.repaired).toBe(true);
  });
});

describe('criteriaIssues', () => {
  const strat = { ...newStrategy(NOW, null), id: 's1' };
  const withRef = (patch: (c: SelectionCriteria) => void) => {
    const c = base();
    patch(c);
    return c;
  };

  it('기본 기준은 이슈가 없다', () => {
    expect(criteriaIssues(base(), [])).toEqual([]);
  });

  it('참조 전략이 있으면 이슈 없고, 지워지면 blocking', () => {
    const c = withRef((x) => {
      x.conditions.rebound.pattern = { from: 'strategy', strategyId: 's1' };
      x.trading.strategyId = 's1';
    });
    expect(criteriaIssues(c, [strat])).toEqual([]);
    const gone = criteriaIssues(c, []);
    expect(gone).toHaveLength(2);
    expect(gone.every((i) => i.blocking)).toBe(true);
    expect(gone.map((i) => i.section).sort()).toEqual(['conditions', 'trading']);
  });

  it('반등 조건을 껐으면 지워진 전략을 참조해도 막지 않는다', () => {
    const c = withRef((x) => {
      x.conditions.rebound.on = false;
      x.conditions.rebound.pattern = { from: 'strategy', strategyId: 'gone' };
    });
    expect(criteriaIssues(c, []).filter((i) => i.section === 'conditions' && i.blocking)).toEqual([]);
  });

  it('반등 조건을 켰는데 전략이 지워졌으면 blocking', () => {
    const c = withRef((x) => {
      x.conditions.rebound.on = true;
      x.conditions.rebound.pattern = { from: 'strategy', strategyId: 'gone' };
    });
    expect(criteriaIssues(c, []).filter((i) => i.section === 'conditions' && i.blocking)).toHaveLength(1);
  });

  it('반등만 켜져 있고 전략이 없으면 blocking만 나오고 조건 없음 경고는 없다', () => {
    const c = withRef((x) => {
      x.conditions.tradingValue.on = false;
      x.conditions.rebound.pattern = { from: 'strategy', strategyId: 'gone' };
    });
    const out = criteriaIssues(c, []);
    expect(out).toHaveLength(1);
    expect(out[0].blocking).toBe(true);
  });

  it('매매 규칙 전략만 지워져도 blocking', () => {
    const c = withRef((x) => (x.trading.strategyId = 'gone'));
    expect(criteriaIssues(c, [strat]).filter((i) => i.blocking)).toHaveLength(1);
  });

  it('켠 조건이 0개면 경고(막지 않음)', () => {
    const c = withRef((x) => {
      x.conditions.tradingValue.on = false;
      x.conditions.rebound.on = false;
    });
    expect(criteriaIssues(c, [])).toEqual([
      { section: 'conditions', text: '조건이 없으면 후보 범위의 모든 종목에서 정렬 순으로 골라요', blocking: false },
    ]);
  });

  it('시작일이 종료일 이상이면 blocking', () => {
    const c = withRef((x) => (x.period = { from: '2026-01-01', to: '2026-01-01' }));
    expect(criteriaIssues(c, []).some((i) => i.section === 'period' && i.blocking)).toBe(true);
  });

  // PR #11 리뷰 W2: 전략 편집 화면이 실행을 막는 오류 전략은 ②·반등 패턴에서도 막는다
  const noSignals = () => {
    const s = { ...newStrategy(NOW, null), id: 's1' };
    for (const t of Object.values(s.entry.triggers)) t.on = false;
    return s;
  };
  const badTakeProfit = () => ({
    ...newStrategy(NOW, null),
    id: 's1',
    exit: { ...newStrategy(NOW, null).exit, takeProfit: [{ pct: 10, sellPct: 50 }, { pct: 5, sellPct: 100 }] },
  });

  it('② 전략의 매수 신호가 모두 꺼져 있으면 blocking(전략 편집 문구를 붙여서)', () => {
    const c = withRef((x) => (x.trading.strategyId = 's1'));
    const out = criteriaIssues(c, [noSignals()]).filter((i) => i.blocking);
    expect(out).toEqual([
      { section: 'trading', text: '매매 규칙 전략에 고칠 곳이 있어요: 사는 신호가 하나도 켜져 있지 않아요. 전략 편집에서 하나 이상 켜 주세요', blocking: true },
    ]);
  });

  it('② 전략의 익절 단계가 역순이면 blocking', () => {
    const c = withRef((x) => (x.trading.strategyId = 's1'));
    expect(criteriaIssues(c, [badTakeProfit()]).filter((i) => i.blocking)).toEqual([
      { section: 'trading', text: '매매 규칙 전략에 고칠 곳이 있어요: 익절 단계는 낮은 %부터 차례로 적어 주세요', blocking: true },
    ]);
  });

  it('반등 패턴 전략은 매수(entry) 오류만 막는다', () => {
    const c = withRef((x) => (x.conditions.rebound = { on: true, withinDays: 10, pattern: { from: 'strategy', strategyId: 's1' } }));
    expect(criteriaIssues(c, [noSignals()]).filter((i) => i.blocking)).toEqual([
      { section: 'conditions', text: '반등 패턴 전략에 고칠 곳이 있어요: 사는 신호가 하나도 켜져 있지 않아요. 전략 편집에서 하나 이상 켜 주세요', blocking: true },
    ]);
    expect(criteriaIssues(c, [badTakeProfit()]).filter((i) => i.blocking)).toEqual([]);
    // 반등 조건을 끄면 보지 않는다
    c.conditions.rebound.on = false;
    expect(criteriaIssues(c, [noSignals()]).filter((i) => i.blocking)).toEqual([]);
  });

  it('전략의 종목 범위가 비어 있거나 기간이 틀려도 막지 않는다(선정 기준 값으로 대체)', () => {
    const s = { ...newStrategy(NOW, null), id: 's1', period: { from: '2026-01-01', to: '2025-01-01' } };
    expect(s.universe).toEqual({ kind: 'symbols', symbols: [] });
    const c = withRef((x) => (x.trading.strategyId = 's1'));
    expect(criteriaIssues(c, [s]).filter((i) => i.blocking)).toEqual([]);
  });

  it('범위가 뒤집힌 수익률·고점 대비는 blocking', () => {
    const c = withRef((x) => {
      x.conditions.returnRange = { on: true, days: 60, minPct: 10, maxPct: -10 };
      x.conditions.fromHigh = { on: true, minPct: 50, maxPct: 20 };
    });
    expect(criteriaIssues(c, []).filter((i) => i.blocking)).toHaveLength(2);
  });
});
