import { describe, expect, it } from 'vitest';
import { newCriteria } from '../screen/defaults';
import { MAX_SYMBOLS, newStrategy } from '../sim/defaults';
import { sanitizeStrategies } from '../sim/validate';
import type { Watchlists } from '../state/schema';
import { MAX_ITEMS } from '../state/watchlist';
import {
  checkShareSnapshot,
  COMPARE_SYMBOLS_MAX,
  criteriaSnapshot,
  cutUtf16,
  groupSnapshot,
  SHARE_MAX_BYTES,
  shareTitle,
  strategySnapshot,
} from './snapshot';
import { compareSnapshot } from './compact';
import { SIM_SYMBOLS_MAX } from './checkResult';

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
  it('시뮬레이션 결과의 종목 한도는 전략 기본값과 같다', () => {
    expect(SIM_SYMBOLS_MAX).toBe(MAX_SYMBOLS);
  });

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

describe('검사 모드·종목 코드·제목 길이', () => {
  const st = () => strategySnapshot(allIds().strategy, w, { hideCapital: false, now: NOW });

  it('ETN이 든 그룹·전략은 통과한다(지금 6자리 정규식 버그 수정)', () => {
    const g = { kind: 'group', v: 1, title: 'ETN', symbols: ['Q500023', '005930'] };
    expect(checkShareSnapshot(g, 'group', NOW).ok).toBe(true);
    const s = st();
    s.strategy.universe = { kind: 'symbols', symbols: ['Q500023'] };
    expect(checkShareSnapshot(s, 'strategy', NOW).ok).toBe(true);
  });

  it('전략·기준의 틀린 종목 코드와 중복을 거절한다', () => {
    for (const bad of ['../x', 'abcdef']) {
      const s = st();
      s.strategy.universe = { kind: 'symbols', symbols: [bad] };
      expect(checkShareSnapshot(s, 'strategy', NOW)).toMatchObject({ ok: false, code: 'invalid', path: 'strategy.universe.symbols' });
      const b = st();
      b.strategy.benchmarks.symbol = bad;
      expect(checkShareSnapshot(b, 'strategy', NOW)).toMatchObject({ ok: false, code: 'invalid', path: 'strategy.benchmarks.symbol' });
      const c = criteriaSnapshot(newCriteria(NOW, null, '기준'), { baskets: [], strategies: [] }, { hideCapital: false, now: NOW });
      c.criteria.benchmarks.symbols = [bad];
      expect(checkShareSnapshot(c, 'criteria', NOW)).toMatchObject({ ok: false, code: 'invalid', path: 'criteria.benchmarks.symbols' });
    }
    const d = st();
    d.strategy.universe = { kind: 'symbols', symbols: ['005930', '005930'] };
    expect(checkShareSnapshot(d, 'strategy', NOW)).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('정리 함수는 지금처럼 아무 문자열이나 받는다(저장·동기화 경로 회귀 방지)', () => {
    const s = newStrategy(NOW, null, '저장된 전략');
    s.universe = { kind: 'symbols', symbols: ['../x'] };
    s.benchmarks.symbol = 'abcdef';
    expect(sanitizeStrategies({ strategies: [s] }, NOW)).toEqual({ strategies: [s], repaired: false });
  });

  it('ETN이 든 묶음은 거절한다(앱 묶음은 6자리만)', () => {
    const { criteria } = allIds();
    const basket = { id: crypto.randomUUID(), name: 'ETN 묶음', updatedAt: NOW, symbols: ['Q500023'] };
    criteria.pool.baskets = [basket.id];
    const c = criteriaSnapshot(criteria, { baskets: [basket], strategies: [] }, { hideCapital: false, now: NOW });
    expect(checkShareSnapshot(c, 'criteria', NOW)).toMatchObject({ ok: false, code: 'invalid', path: 'baskets[0].symbols' });
  });

  it('read 모드는 빠진 필드를 기본값으로 채워 받고, create는 거절한다', () => {
    const s = st();
    const old = structuredClone(s) as unknown as { strategy: Record<string, unknown> };
    delete old.strategy.costs;
    expect(checkShareSnapshot(old, 'strategy', NOW, 'create')).toMatchObject({ ok: false, code: 'invalid', path: 'strategy.costs' });
    const r = checkShareSnapshot(old, 'strategy', NOW, 'read');
    expect(r.ok).toBe(true);
    if (r.ok && r.snapshot.kind === 'strategy') expect(r.snapshot.strategy.costs).toEqual(s.strategy.costs);
  });

  it('선정 기준도 read 모드는 빠진 비용을 기본값으로 채우고, create는 거절한다', () => {
    const { criteria, basket, strategy } = allIds();
    const s = criteriaSnapshot(criteria, { baskets: [basket], strategies: [strategy] }, { hideCapital: false, now: NOW });
    const old = structuredClone(s) as unknown as { criteria: Record<string, unknown> };
    delete old.criteria.costs;
    const r = checkShareSnapshot(old, 'criteria', NOW, 'read');
    expect(r.ok).toBe(true);
    if (r.ok && r.snapshot.kind === 'criteria') expect(r.snapshot.criteria.costs).toEqual(newCriteria(NOW, null).costs);
    expect(checkShareSnapshot(old, 'criteria', NOW, 'create')).toMatchObject({ ok: false, code: 'invalid', path: 'criteria.costs' });
  });

  it('묶음 이름의 이모지 30개는 read에서 받고, UTF-16 길이를 넘는 create는 거절한다', () => {
    const { criteria, basket, strategy } = allIds();
    const s = criteriaSnapshot(criteria, { baskets: [basket], strategies: [strategy] }, { hideCapital: false, now: NOW });
    s.baskets[0].name = '😀'.repeat(30);
    expect(s.baskets[0].name.length).toBeGreaterThan(30);
    expect([...s.baskets[0].name]).toHaveLength(30);
    expect(checkShareSnapshot(s, 'criteria', NOW, 'read')).toEqual({ ok: true, snapshot: s });
    expect(checkShareSnapshot(s, 'criteria', NOW, 'create')).toMatchObject({ ok: false, code: 'invalid', path: 'baskets[0]' });
  });

  it('모르는 키는 두 모드 모두 unknown-field, 모르는 kind는 unsupported', () => {
    const s = st();
    const extra = { ...s, strategy: { ...s.strategy, surprise: 1 } };
    expect(checkShareSnapshot(extra, 'strategy', NOW, 'create')).toMatchObject({ code: 'unknown-field', path: 'strategy.surprise' });
    expect(checkShareSnapshot(extra, 'strategy', NOW, 'read')).toMatchObject({ code: 'unknown-field', path: 'strategy.surprise' });
    const future = { kind: 'future', v: 1, title: '새 종류' };
    expect(checkShareSnapshot(future, 'future', NOW)).toEqual({ ok: false, code: 'unsupported', path: 'kind' });
    expect(checkShareSnapshot({ ...future, v: 9 }, 'future', NOW, 'read')).toMatchObject({ code: 'unsupported' });
    expect(checkShareSnapshot({ ...future, kind: 3 }, 3, NOW)).toMatchObject({ code: 'invalid', path: 'kind' });
  });

  it('제목은 UTF-16 30에서 서로게이트를 자르지 않는다', () => {
    const emoji = '😀'.repeat(20); // UTF-16 40, code point 20
    const t = shareTitle(emoji);
    expect(t.length).toBe(30);
    expect(t).toBe('😀'.repeat(15));
    expect(cutUtf16('a' + '😀'.repeat(20), 30)).toBe('a' + '😀'.repeat(14));
    expect(cutUtf16('a' + '😀'.repeat(20), 30).length).toBe(29);
    const old = { kind: 'group', v: 1, title: '😀'.repeat(30), symbols: [] }; // 지금 만드는 쪽(code point 30)이 만든 옛 공유
    expect(checkShareSnapshot(old, 'group', NOW, 'create')).toMatchObject({ code: 'invalid', path: 'title' });
    expect(checkShareSnapshot(old, 'group', NOW, 'read').ok).toBe(true);
  });

  it('깊이 1,000의 중첩은 예외 없이 invalid', () => {
    let deep: Record<string, unknown> = {};
    for (let i = 0; i < 1000; i++) deep = { a: deep };
    expect(checkShareSnapshot({ kind: 'group', v: 1, title: 'x', symbols: [], deep }, 'group', NOW)).toEqual({ ok: false, code: 'invalid' });
  });

  it('100 KiB 경계: 정확히 한도면 크기는 통과하고 1바이트 넘으면 too-large', () => {
    const base = { kind: 'group', v: 1, title: 'x', symbols: [], pad: '' };
    const fixed = JSON.stringify(base).length;
    const at = { ...base, pad: 'a'.repeat(SHARE_MAX_BYTES - fixed) };
    expect(new TextEncoder().encode(JSON.stringify(at)).length).toBe(SHARE_MAX_BYTES);
    expect(checkShareSnapshot(at, 'group', NOW)).toMatchObject({ code: 'unknown-field', path: 'pad' });
    expect(checkShareSnapshot({ ...at, pad: at.pad + 'a' }, 'group', NOW)).toMatchObject({ code: 'too-large' });
  });
});

describe('비교 화면 스냅샷', () => {
  const settings = { period: { unit: 'M', n: 1 }, metric: 'change', benchmark: 'AUTO', boardOrder: 'value' } as const;
  const group = { id: crypto.randomUUID(), name: '반도체', items: w.groups[0].items.concat({ symbol: 'Q500023', colorSlot: 3, hidden: false, addedAt: 13 }) };

  it('보이는 종목만 그룹 순서대로, 보기 설정 4개만 넣는다', () => {
    const s = compareSnapshot(group, { ...settings, period: { ...settings.period } });
    expect(s).toEqual({ kind: 'compare', v: 1, title: '반도체', symbols: ['005930', 'Q500023'], view: { period: { unit: 'M', n: 1 }, metric: 'change', benchmark: 'AUTO', boardOrder: 'value' } });
    expect(JSON.stringify(s)).not.toContain(group.id);
    expect(checkShareSnapshot(s, 'compare', NOW)).toEqual({ ok: true, snapshot: s });
  });

  it.each(['view', 'symbols'] as const)('%s가 빠지면 invalid', (key) => {
    const s = compareSnapshot(group, { ...settings, period: { ...settings.period } });
    const missing: Partial<typeof s> = structuredClone(s);
    delete missing[key];
    expect(checkShareSnapshot(missing, 'compare', NOW)).toMatchObject({ ok: false, code: 'invalid', path: key });
  });

  it.each(['period', 'metric', 'benchmark', 'boardOrder'] as const)('view.%s가 빠지면 invalid', (key) => {
    const s = compareSnapshot(group, { ...settings, period: { ...settings.period } });
    const view: Partial<typeof s.view> = { ...s.view };
    delete view[key];
    expect(checkShareSnapshot({ ...s, view }, 'compare', NOW)).toMatchObject({ ok: false, code: 'invalid', path: `view.${key}` });
  });

  it('종목은 1~10개, 보기 값은 동기화 DTO 규칙으로 검사한다', () => {
    expect(COMPARE_SYMBOLS_MAX).toBe(MAX_ITEMS);
    const s = compareSnapshot(group, { ...settings, period: { ...settings.period } });
    expect(checkShareSnapshot({ ...s, symbols: [] }, 'compare', NOW)).toMatchObject({ code: 'invalid', path: 'symbols' });
    const eleven = Array.from({ length: 11 }, (_, i) => `00${String(i).padStart(4, '0')}`);
    expect(checkShareSnapshot({ ...s, symbols: eleven }, 'compare', NOW)).toMatchObject({ code: 'invalid', path: 'symbols' });
    expect(checkShareSnapshot({ ...s, view: { ...s.view, metric: 'magic' } }, 'compare', NOW)).toMatchObject({ code: 'invalid', path: 'view.metric' });
    expect(checkShareSnapshot({ ...s, view: { ...s.view, period: { unit: 'M', n: 7 } } }, 'compare', NOW)).toMatchObject({ code: 'invalid', path: 'view.period' });
    expect(checkShareSnapshot({ ...s, view: { ...s.view, extra: 1 } }, 'compare', NOW)).toMatchObject({ code: 'unknown-field', path: 'view.extra' });
    expect(checkShareSnapshot({ ...s, view: { ...s.view, theme: 'dark' } }, 'compare', NOW)).toMatchObject({ code: 'forbidden-field', path: 'view.theme' });
    expect(checkShareSnapshot({ ...s, colorConvention: 'kr' }, 'compare', NOW)).toMatchObject({ code: 'unknown-field' });
  });
});
