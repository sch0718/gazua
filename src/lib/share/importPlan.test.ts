import { describe, expect, it } from 'vitest';
import { BASKET_CAP_MESSAGE, newBasket } from '../screen/baskets';
import { CRITERIA_CAP_MESSAGE } from '../screen/criteriaStore';
import { newCriteria } from '../screen/defaults';
import { newStrategy } from '../sim/defaults';
import { STRATEGY_CAP_MESSAGE } from '../sim/strategyStore';
import { sanitizeStrategies } from '../sim/validate';
import { applyImport, planImport, uniqueName, type ImportInput, type ImportState } from './importPlan';
import type { ImportSnapshot } from './pendingImport';
import { criteriaSnapshot, strategySnapshot, type CompareSnapshot, type GroupSnapshot } from './snapshot';
import { NOW } from './testFixtures';

const state = (o: Partial<ImportState> = {}): ImportState => ({
  watchlists: { groups: [] },
  strategies: [],
  criteria: [],
  baskets: [],
  universe: null,
  ...o,
});
const input = (snapshot: ImportSnapshot, from: ImportInput['from'] = snapshot.kind): ImportInput => ({ snapshot, from });
const codes = (n: number) => Array.from({ length: n }, (_, i) => String(100000 + i));
const group = (symbols: string[], title = '반도체'): GroupSnapshot => ({ kind: 'group', v: 1, title, symbols });

describe('uniqueName', () => {
  it('충돌이 없으면 그대로, 있으면 2, 3…', () => {
    expect(uniqueName('반도체', new Set())).toBe('반도체');
    expect(uniqueName('반도체', new Set(['반도체']))).toBe('반도체 2');
    expect(uniqueName('반도체', new Set(['반도체', '반도체 2']))).toBe('반도체 3');
  });

  it('30자(UTF-16)를 넘지 않게 끝을 자르고 서로게이트 쌍을 반으로 자르지 않는다', () => {
    const long = 'a'.repeat(30);
    expect(uniqueName(long, new Set([long]))).toBe('a'.repeat(28) + ' 2');
    const emoji = 'a'.repeat(27) + '😀'; // 29
    const n = uniqueName(emoji, new Set([emoji]));
    expect(n).toBe('a'.repeat(27) + ' 2');
    expect(n.length).toBeLessThanOrEqual(30);
    const s = newStrategy(NOW, null, n);
    expect(sanitizeStrategies({ strategies: [s] }, NOW).repaired).toBe(false);
  });
});

describe('planImport / applyImport', () => {
  it('그룹: 50종목이면 앞에서 10개 + 안내, 종목 목록에 없는 코드는 빼고 개수를 알린다', () => {
    const symbols = codes(50);
    const universe = new Set(symbols.filter((_, i) => i !== 1 && i !== 2));
    const p = planImport(input(group(symbols)), state({ universe }));
    expect(p.blocked).toBeNull();
    expect(p.lines).toEqual(['그룹 「반도체」 · 종목 10개']);
    expect(p.notes).toEqual(['종목 목록에 없는 종목 2개는 뺐어요', '상위 10개만 넣었어요']);
    const a = applyImport(input(group(symbols)), state({ universe }), { now: NOW, applyView: true });
    const made = a.watchlists!.groups[0];
    expect(made.items.map((i) => i.symbol)).toEqual([symbols[0], ...symbols.slice(3, 12)]);
    expect(a.route).toEqual({ name: 'compare', groupId: made.id });
    expect(made.id).not.toBe('shared');
  });

  it('그룹: 종목 목록이 null이면 거르지 않고, 남는 종목이 없으면 막는다', () => {
    expect(planImport(input(group(['999999'])), state()).blocked).toBeNull();
    expect(planImport(input(group(['999999'])), state({ universe: new Set(['005930']) })).blocked).toBe('가져올 수 있는 종목이 없어요');
  });

  it('그룹: 같은 이름이 있으면 2를 붙여 안내한다', () => {
    const cur = state({ watchlists: { groups: [{ id: 'g1', name: '반도체', items: [] }] } });
    const p = planImport(input(group(['005930'])), cur);
    expect(p.lines).toEqual(['그룹 「반도체 2」 · 종목 1개']);
    expect(p.notes).toContain('같은 이름이 있어 「반도체 2」로 저장해요');
  });

  it('비교 화면: 보기 설정은 체크했을 때만, 바뀌는 키는 네 개뿐', () => {
    const cmp: CompareSnapshot = { kind: 'compare', v: 1, title: '반도체', symbols: ['005930'], view: { period: { unit: 'M', n: 3 }, metric: 'rsi', benchmark: 'KOSDAQ', boardOrder: 'mine' } };
    expect(planImport(input(cmp), state()).view).toEqual(cmp.view);
    const on = applyImport(input(cmp), state(), { now: NOW, applyView: true });
    expect(on.settings).toEqual({ period: { unit: 'M', n: 3 }, metric: 'rsi', benchmark: 'KOSDAQ', boardOrder: 'mine' });
    expect(Object.keys(on.settings!).sort()).toEqual(['benchmark', 'boardOrder', 'metric', 'period']);
    expect(applyImport(input(cmp), state(), { now: NOW, applyView: false }).settings).toBeUndefined();
  });

  it('전략: 20개면 막고, 새 ID·updatedAt, 자금 숨김 안내, 결과에서 왔으면 결과 안내', () => {
    const snap = strategySnapshot(newStrategy(NOW, null, '눌림목'), { groups: [] }, { hideCapital: true, now: NOW });
    const full = state({ strategies: Array.from({ length: 20 }, (_, i) => newStrategy(NOW, null, `s${i}`)) });
    expect(planImport(input(snap), full).blocked).toBe(STRATEGY_CAP_MESSAGE);
    expect(() => applyImport(input(snap), full, { now: NOW, applyView: true })).toThrow(STRATEGY_CAP_MESSAGE);
    const p = planImport(input(snap, 'simResult'), state());
    expect(p.lines).toEqual(['전략 「눌림목」']);
    expect(p.notes).toEqual(['초기 자금은 기본값으로 저장해요', '결과는 저장하지 않아요. 저장한 뒤 실행하면 내 데이터로 다시 계산해요']);
    const a = applyImport(input(snap, 'simResult'), state(), { now: NOW + 5, applyView: true });
    const made = a.strategies![0];
    expect(made.id).not.toBe('shared');
    expect(made.updatedAt).toBe(NOW + 5);
    expect(made.universe).toEqual(snap.strategy.universe);
    expect(a.route).toEqual({ name: 'simulate', strategyId: made.id });
  });

  it('전략: 정리 함수가 바꾸는 값이 있으면 저장하지 않는다', () => {
    const snap = strategySnapshot(newStrategy(NOW, null, '이상한 전략'), { groups: [] }, { hideCapital: false, now: NOW });
    snap.strategy.capital.perBuyPct = 0;
    expect(planImport(input(snap), state()).blocked).toBe('가져올 수 없는 공유예요');
  });

  it('기준: 묶음 b0·b1을 새 ID로 바꾸고, 같은 이름 묶음끼리도 겹치지 않게 한다', () => {
    const c = newCriteria(NOW, null, '대형');
    const b1 = newBasket(NOW, '반도체', ['005930']);
    const b2 = newBasket(NOW, '반도체', ['000660']);
    c.pool.baskets = [b1.id, b2.id];
    const snap = criteriaSnapshot(c, { baskets: [b1, b2], strategies: [] }, { hideCapital: false, now: NOW });
    const cur = state({ baskets: [newBasket(NOW, '반도체', ['035420'])] });
    const p = planImport(input(snap, 'validation'), cur);
    expect(p.lines).toEqual(['선정 기준 「대형」 · 묶음 2개']);
    expect(p.notes).toEqual([
      '같은 이름이 있어 「반도체 2」로 저장해요',
      '같은 이름이 있어 「반도체 3」로 저장해요',
      '② 매매 규칙은 함께 오지 않아요. 저장한 뒤 매매 규칙을 골라 주세요',
      '결과는 저장하지 않아요. 저장한 뒤 실행하면 내 데이터로 다시 계산해요',
    ]);
    const a = applyImport(input(snap, 'validation'), cur, { now: NOW, applyView: true });
    const added = a.baskets!.slice(1);
    expect(added.map((b) => b.name)).toEqual(['반도체 2', '반도체 3']);
    expect(a.criteria![0].pool.baskets).toEqual(added.map((b) => b.id));
    expect(a.route).toEqual({ name: 'simulate', tab: 'criteria', criteriaId: a.criteria![0].id });
  });

  it('기준: 묶음 29개 + 2개면 묶음 한도로, 기준 20개면 기준 한도로 막는다', () => {
    const c = newCriteria(NOW, null, '대형');
    const bs = [newBasket(NOW, 'a', ['005930']), newBasket(NOW, 'b', ['000660'])];
    c.pool.baskets = bs.map((b) => b.id);
    const snap = criteriaSnapshot(c, { baskets: bs, strategies: [] }, { hideCapital: false, now: NOW });
    const many = Array.from({ length: 29 }, (_, i) => newBasket(NOW, `m${i}`, ['005930']));
    expect(planImport(input(snap), state({ baskets: many })).blocked).toBe(BASKET_CAP_MESSAGE);
    const crit = Array.from({ length: 20 }, (_, i) => newCriteria(NOW, null, `c${i}`));
    expect(planImport(input(snap), state({ criteria: crit })).blocked).toBe(CRITERIA_CAP_MESSAGE);
  });
});
