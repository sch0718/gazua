import { describe, expect, it } from 'vitest';
import { newCriteria } from '../screen/defaults';
import { jsonBytes } from '../sync/forbidden';
import { validationResult } from '../ui/screen/resultFixture';
import { AXIS_MAX } from './checkResult';
import { expandValidation, validationSnapshot, type ValidationRun } from './compact';
import { checkShareSnapshot, SHARE_MAX_BYTES } from './snapshot';
import { bigValidationRun, NOW } from './testFixtures';

function smallRun(): ValidationRun {
  return { result: validationResult(), criteria: newCriteria(NOW, null, '반등 기준'), baskets: [], strategies: [], collectedAt: '2026-02-04T18:00:00+09:00' };
}

describe('validationSnapshot', () => {
  it('3년 월간 · 상위 10 · 계산값 8개 · 곡선 4개는 줄이지 않고 들어간다(설계 3.5)', () => {
    const b = validationSnapshot(bigValidationRun({ days: 735, every: 21, take: 10 }), { hideCapital: false, now: NOW });
    if (!b.ok) throw new Error(JSON.stringify(b));
    expect(b.reduced).toEqual([]);
    expect(b.snapshot.result.history).toBe('full');
    expect(b.snapshot.result.sampled).toBeNull();
    expect(jsonBytes(b.snapshot)).toBeLessThanOrEqual(SHARE_MAX_BYTES);
  });

  it('10년 월간 · 상위 30이면 계산값 빼기 → 솎기 → 코드만까지 가서 들어간다', () => {
    const b = validationSnapshot(bigValidationRun({ days: 2450, every: 21, take: 30, baskets: 2 }), { hideCapital: false, now: NOW });
    if (!b.ok) throw new Error(JSON.stringify(b));
    expect(b.reduced).toEqual(['thinned', 'codes-only']);
    expect(b.snapshot.result.history).toBe('codes');
    expect(b.snapshot.result.sampled).toEqual({ from: 2450 });
    expect(typeof b.snapshot.result.rebalances[0].picks[0]).toBe('string');
    expect(b.snapshot.result.today.picks[0].values.length).toBeGreaterThan(0); // 오늘 선정은 늘 계산값까지
  });

  it('3년 월간 · 상위 30은 계산값만 빼고 create 검사를 통과한다', () => {
    const b = validationSnapshot(bigValidationRun({ days: 735, every: 21, take: 30 }), { hideCapital: false, now: NOW });
    if (!b.ok) throw new Error(JSON.stringify(b));
    expect(b.reduced).toEqual(['no-values']);
    expect(checkShareSnapshot(JSON.parse(JSON.stringify(b.snapshot)), 'validation', NOW, 'create').ok).toBe(true);
  });

  it('축 상한을 넘는 4000일은 원래 길이를 남기고 상한 안으로 솎는다', () => {
    const b = validationSnapshot(bigValidationRun({ days: 4000, every: 21, take: 10 }), { hideCapital: false, now: NOW });
    if (!b.ok) throw new Error(JSON.stringify(b));
    expect(b.snapshot.result.sampled?.from).toBe(4000);
    expect(b.snapshot.result.axis.offsets.length).toBeLessThanOrEqual(AXIS_MAX);
    expect(b.reduced).toContain('thinned');
  });

  it('4000일에 보유 곡선만 있으면 계산값 이력을 유지하고 축만 솎는다', () => {
    const run = bigValidationRun({ days: 4000, every: 21, take: 1 });
    run.result.trading = null;
    run.result.indices = run.result.indices.map((x) => ({ ...x, curve: null, reason: '받지 못했어요' as const, stats: null }));
    run.result.benchmarks = run.result.benchmarks.map((x) => ({ ...x, curve: null, reason: '받지 못했어요' as const, stats: null }));
    run.result.hold.beat = null;
    const b = validationSnapshot(run, { hideCapital: false, now: NOW });
    expect(b.ok).toBe(true);
    if (!b.ok) throw new Error(JSON.stringify(b));
    expect(b.reduced).toEqual(['thinned']);
    expect(b.snapshot.result.history).toBe('full');
    expect(b.snapshot.result.sampled?.from).toBe(4000);
    expect(b.snapshot.result.axis.offsets.length).toBeLessThanOrEqual(AXIS_MAX);
  });

  it('재선정일은 솎아도 축에 남는다', () => {
    const b = validationSnapshot(bigValidationRun({ days: 2450, every: 21, take: 30, baskets: 2 }), { hideCapital: false, now: NOW });
    if (!b.ok) throw new Error(JSON.stringify(b));
    const days = new Set(b.snapshot.result.axis.offsets);
    for (const r of b.snapshot.result.rebalances) expect(days.has(r.day)).toBe(true);
  });

  it('값 반올림: 정수 키는 그대로, 나머지는 4자리', () => {
    const run = smallRun();
    run.result.rebalances[0].picked[0].values = { finQuarter: 202406, leaderRank: 3, flowStreak: 12, marketCap: 123456789.123, return: -12.3456, rebound: true, usdkrwBeta: Number.NaN };
    const b = validationSnapshot(run, { hideCapital: false, now: NOW });
    if (!b.ok) throw new Error(JSON.stringify(b));
    const r = b.snapshot.result;
    const pick = r.rebalances[0].picks[0] as [string, number | null, unknown, (number | boolean | null)[]];
    const values = Object.fromEntries(Array.from({ length: pick[3].length / 2 }, (_, i) => [r.valueKeys[pick[3][i * 2] as number], pick[3][i * 2 + 1]]));
    expect(values).toEqual({ finQuarter: 202406, leaderRank: 3, flowStreak: 12, marketCap: 123500000, return: -12.35, rebound: true, usdkrwBeta: null });
  });

  it('목록 밖 값 키는 만들기에서 막는다', () => {
    const run = smallRun();
    run.result.today.picked[0].values = { __proto__x: 1 } as Record<string, number>;
    expect(validationSnapshot(run, { hideCapital: false, now: NOW })).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('오늘 선정의 own 키 __proto__는 만들기에서 막는다', () => {
    const run = smallRun();
    run.result.today.picked[0].values = JSON.parse('{"__proto__":1}');
    expect(Object.hasOwn(run.result.today.picked[0].values, '__proto__')).toBe(true);
    expect(validationSnapshot(run, { hideCapital: false, now: NOW })).toEqual({ ok: false, code: 'invalid', path: 'result.today.picks[0]' });
  });

  it('hold 곡선의 NaN은 해당 점의 스냅샷 경로로 거절한다', () => {
    const run = smallRun();
    run.result.hold.equity[2].value = Number.NaN;
    expect(validationSnapshot(run, { hideCapital: false, now: NOW })).toEqual({ ok: false, code: 'invalid', path: 'result.hold.curve[2]' });
  });

  it('hold 통계의 NaN은 해당 통계의 스냅샷 경로로 거절한다', () => {
    const run = smallRun();
    run.result.hold.stats.mddPct = Number.NaN;
    expect(validationSnapshot(run, { hideCapital: false, now: NOW })).toEqual({ ok: false, code: 'invalid', path: 'result.hold.stats.mddPct' });
  });

  it('메타: 시장 파일 출처, 데모 아님, 수집 시각', () => {
    const b = validationSnapshot(smallRun(), { hideCapital: false, now: NOW });
    if (!b.ok) throw new Error(JSON.stringify(b));
    expect(b.snapshot.run).toEqual({ from: '2026-01-05', to: '2026-02-03', source: '시장 데이터 파일', demo: false, fetchedAt: Date.parse('2026-02-04T18:00:00+09:00') });
    expect(validationSnapshot({ ...smallRun(), collectedAt: '언제' }, { hideCapital: false, now: NOW })).toMatchObject({ ok: false, code: 'invalid', path: 'run.fetchedAt' });
  });

  it('자금 숨김: 기준 자본은 기본값, JSON에 원래 자본이 없다. ②의 전략은 넣지 않는다', () => {
    const run = smallRun();
    run.criteria.capital = 555_000_000;
    run.criteria.trading = { strategyId: crypto.randomUUID() };
    run.result.hold.equity = run.result.hold.equity.map((p, i) => ({ ...p, value: 555_000_000 * (1 + i / 100) }));
    const b = validationSnapshot(run, { hideCapital: true, now: NOW });
    if (!b.ok) throw new Error(JSON.stringify(b));
    expect(b.snapshot.capitalHidden).toBe(true);
    expect(b.snapshot.criteria.trading).toEqual({ strategyId: null });
    expect(JSON.stringify(b.snapshot)).not.toContain('555000000');
    expect(b.snapshot.result.hold.curve).toEqual([0, 1, 2, 3]);
  });

  it('만든 쪽 왕복: create 검사를 통과한다', () => {
    const b = validationSnapshot(smallRun(), { hideCapital: false, now: NOW });
    if (!b.ok) throw new Error(JSON.stringify(b));
    expect(checkShareSnapshot(JSON.parse(JSON.stringify(b.snapshot)), 'validation', NOW, 'create').ok).toBe(true);
  });

  it('기준의 전략 ID를 지워도 trading 결과를 남기고 곡선·통계·건너뜀 횟수를 펼친다', () => {
    const run = bigValidationRun({ days: 735, every: 21, take: 10 });
    run.criteria.trading = { strategyId: crypto.randomUUID() };
    const orig = run.result.trading!;
    const b = validationSnapshot(run, { hideCapital: false, now: NOW });
    if (!b.ok) throw new Error(JSON.stringify(b));
    expect(b.snapshot.criteria.trading).toEqual({ strategyId: null });
    const trading = b.snapshot.result.trading!;
    expect(trading.curve).toHaveLength(orig.curve.length);
    expect(trading.stats).toEqual({ totalPct: 12.35, cagrPct: 3.46, mddPct: -23.46, volPct: 18.89 });
    expect(trading.trades).toBe(orig.trades);
    expect(trading.skipCounts).toEqual([['현금 부족', 3], ['거래 없음', 2]]);

    const back = expandValidation(b.snapshot).trading!;
    expect(back.skipCounts).toEqual({ '현금 부족': 3, '거래 없음': 2 });
    expect(Array.isArray(back.skipCounts)).toBe(false);
    expect(back.stats).toEqual(trading.stats);
    expect(back.trades).toBe(orig.trades);
    expect(back.curve).toHaveLength(orig.curve.length);
    back.curve.forEach((p, i) => {
      expect(p.date).toBe(orig.curve[i].date);
      expect(Math.abs(p.value - orig.curve[i].value)).toBeLessThanOrEqual(run.criteria.capital * 0.00005 + 1e-8);
    });
  });

  it('펼치면 선정 이력·구간·오늘 선정·통계가 원래와 같고 곡선은 반올림 오차 안이다', () => {
    const run = smallRun();
    const b = validationSnapshot(run, { hideCapital: false, now: NOW });
    if (!b.ok) throw new Error(JSON.stringify(b));
    const back = expandValidation(b.snapshot);
    const orig = run.result;
    expect(back.axis).toEqual(orig.axis);
    expect(back.rebalances).toEqual(orig.rebalances);
    expect(back.today).toEqual(orig.today);
    expect(back.hold.segments).toEqual(orig.hold.segments);
    expect(back.hold.stats).toEqual(orig.hold.stats);
    expect(back.hold.beat).toEqual(orig.hold.beat);
    expect(back.byMarket).toEqual(orig.byMarket);
    expect(back.notes).toEqual(orig.notes);
    expect(back.indices.map((i) => [i.id, i.stats, i.reason])).toEqual(orig.indices.map((i) => [i.id, i.stats, i.reason]));
    back.hold.equity.forEach((p, i) => expect(Math.abs(p.value - orig.hold.equity[i].value)).toBeLessThan(run.criteria.capital * 0.0001));
  });

  it('구간·종목 순서와 무관하게 날짜별 표시를 찾고 빠진 종목은 기본 표시를 쓴다', () => {
    const run = smallRun();
    const picked = run.result.rebalances[0].picked.slice(0, 3);
    run.result.rebalances.forEach((r) => {
      r.picked = picked;
      r.passed = picked.length;
    });
    run.result.hold.segments[0].picked = run.result.hold.segments[0].picked.slice(0, 3).filter((p) => p.symbol !== picked[1].symbol).reverse();
    run.result.hold.segments[1].picked = [{ symbol: picked[0].symbol, retPct: -2.3456, soldAtLastClose: false, notBought: true, notBoughtReason: 'cash' }];
    run.result.hold.segments.reverse();
    const b = validationSnapshot(run, { hideCapital: false, now: NOW });
    if (!b.ok) throw new Error(JSON.stringify(b));
    expect(b.snapshot.result.rebalances.map((r) => r.picks.map((p) => p.slice(0, 3)))).toEqual([
      [[picked[0].symbol, 5.5, 0], [picked[1].symbol, null, 0], [picked[2].symbol, 1, 1]],
      [[picked[0].symbol, -2.35, 'cash'], [picked[1].symbol, null, 0], [picked[2].symbol, null, 0]],
    ]);
  });

  it('코드만 이력을 펼치면 수익률 없이 종목 줄만 있다', () => {
    const b = validationSnapshot(bigValidationRun({ days: 2450, every: 21, take: 30, baskets: 2 }), { hideCapital: false, now: NOW });
    if (!b.ok) throw new Error(JSON.stringify(b));
    const back = expandValidation(b.snapshot);
    expect(back.rebalances[0].picked[0]).toEqual({ symbol: '200000', values: {} });
    expect(back.hold.segments[0].picked[0]).toEqual({ symbol: '200000', retPct: null, soldAtLastClose: false, notBought: false });
    expect(back.hold.segments.at(-1)!.to).toBe(back.axis.at(-1));
  });
});
