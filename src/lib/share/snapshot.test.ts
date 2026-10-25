import { describe, expect, it } from 'vitest';
import { newCriteria } from '../screen/defaults';
import { newStrategy } from '../sim/defaults';
import type { Watchlists } from '../state/schema';
import { checkShareSnapshot, criteriaSnapshot, groupSnapshot, SHARE_MAX_BYTES, strategySnapshot } from './snapshot';

const NOW = Date.UTC(2026, 9, 25, 3);
const PROFILE_NAME = '비밀 프로필 이름';
const w: Watchlists = {
  groups: [
    {
      id: crypto.randomUUID(),
      name: '반도체',
      items: [
        { symbol: '005930', colorSlot: 1, hidden: false, addedAt: 11 },
        { symbol: '000660', colorSlot: 2, hidden: true, addedAt: 12 },
      ],
    },
  ],
};

function allIds() {
  const strategy = newStrategy(NOW, w.groups[0].id, '눌림목');
  const basket = { id: crypto.randomUUID(), name: '관찰', updatedAt: NOW, symbols: ['035420', '035720'] };
  const criteria = newCriteria(NOW, null, '저평가');
  criteria.pool.baskets = [basket.id];
  criteria.conditions.rebound.pattern = { from: 'strategy', strategyId: strategy.id };
  criteria.trading = { strategyId: strategy.id };
  return { strategy, basket, criteria, ids: [w.groups[0].id, strategy.id, basket.id, criteria.id] };
}

describe('공유 스냅샷', () => {
  it('그룹: 숨긴 종목·색·추가 시각·ID를 넣지 않는다', () => {
    const s = groupSnapshot(w.groups[0]);
    expect(s).toEqual({ kind: 'group', v: 1, title: '반도체', symbols: ['005930'] });
    expect(checkShareSnapshot(s, 'group', NOW)).toEqual({ ok: true, snapshot: s });
  });

  it('전략: 그룹 참조를 종목으로 풀고 원본 ID를 남기지 않는다', () => {
    const { strategy, ids } = allIds();
    const s = strategySnapshot(strategy, w, { hideCapital: false, now: NOW });
    expect(s.strategy.universe).toEqual({ kind: 'symbols', symbols: ['005930', '000660'] });
    expect(s.strategy.capital).toEqual(strategy.capital);
    const json = JSON.stringify(s);
    for (const id of ids) expect(json).not.toContain(id);
    expect(json).not.toContain(PROFILE_NAME);
    expect(checkShareSnapshot(s, 'strategy', NOW)).toEqual({ ok: true, snapshot: s });
  });

  it('전략: 가상 자금을 빼면 기본값으로 바꾸고 표시한다', () => {
    const { strategy } = allIds();
    strategy.capital.initial = 777_000_000;
    const s = strategySnapshot(strategy, w, { hideCapital: true, now: NOW });
    expect(s.capitalHidden).toBe(true);
    expect(JSON.stringify(s)).not.toContain('777000000');
    expect(checkShareSnapshot(s, 'strategy', NOW).ok).toBe(true);
  });

  it('선정 기준: 바구니·반등 전략·실행 전략 참조를 스냅샷 안에서 끝낸다', () => {
    const { strategy, basket, criteria, ids } = allIds();
    strategy.entry.decline.dropPct.value = 33;
    criteria.capital = 555_000_000;
    const s = criteriaSnapshot(criteria, { baskets: [basket], strategies: [strategy] }, { hideCapital: true, now: NOW });
    expect(s.baskets).toEqual([{ id: 'b0', name: '관찰', symbols: ['035420', '035720'] }]);
    expect(s.criteria.pool.baskets).toEqual(['b0']);
    expect(s.criteria.conditions.rebound.pattern).toEqual({ from: 'custom', entry: strategy.entry });
    expect(s.criteria.trading).toEqual({ strategyId: null });
    const json = JSON.stringify(s);
    for (const id of ids) expect(json).not.toContain(id);
    expect(json).not.toContain('555000000');
    expect(checkShareSnapshot(s, 'criteria', NOW)).toEqual({ ok: true, snapshot: s });
  });

  it('지워진 바구니 참조는 뺀다', () => {
    const { criteria } = allIds();
    const s = criteriaSnapshot(criteria, { baskets: [], strategies: [] }, { hideCapital: false, now: NOW });
    expect(s.criteria.pool.baskets).toEqual([]);
    expect(checkShareSnapshot(s, 'criteria', NOW).ok).toBe(true);
  });

  it('스냅샷 밖을 가리키는 참조는 거절한다', () => {
    const { criteria, basket, strategy } = allIds();
    const s = criteriaSnapshot(criteria, { baskets: [basket], strategies: [strategy] }, { hideCapital: false, now: NOW });
    expect(checkShareSnapshot({ ...s, criteria: { ...s.criteria, pool: { ...s.criteria.pool, baskets: ['b7'] } } }, 'criteria', NOW)).toMatchObject({
      ok: false,
      code: 'reference',
    });
    expect(checkShareSnapshot({ ...s, criteria: { ...s.criteria, trading: { strategyId: 'x' } } }, 'criteria', NOW)).toMatchObject({ code: 'reference' });
    const st = strategySnapshot(strategy, w, { hideCapital: false, now: NOW });
    expect(checkShareSnapshot({ ...st, strategy: { ...st.strategy, universe: { kind: 'group', groupId: 'g' } } }, 'strategy', NOW)).toMatchObject({ code: 'reference' });
    expect(checkShareSnapshot({ ...st, strategy: { ...st.strategy, id: strategy.id } }, 'strategy', NOW)).toMatchObject({ code: 'reference' });
  });

  it('100 KiB를 넘으면 거절한다', () => {
    const s = groupSnapshot(w.groups[0]);
    expect(checkShareSnapshot({ ...s, title: 'x'.repeat(SHARE_MAX_BYTES) }, 'group', NOW)).toMatchObject({ code: 'too-large' });
  });

  it('틀린 종목·제목은 거절한다', () => {
    const s = groupSnapshot(w.groups[0]);
    expect(checkShareSnapshot({ ...s, symbols: ['bad'] }, 'group', NOW)).toMatchObject({ code: 'invalid', path: 'symbols' });
    expect(checkShareSnapshot({ ...s, symbols: ['005930', '005930'] }, 'group', NOW)).toMatchObject({ code: 'invalid' });
    expect(checkShareSnapshot({ ...s, title: ' 앞' }, 'group', NOW)).toMatchObject({ code: 'invalid', path: 'title' });
    expect(checkShareSnapshot({ ...s, v: 2 }, 'group', NOW)).toMatchObject({ code: 'invalid', path: 'v' });
  });
});
