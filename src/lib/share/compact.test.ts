import { describe, expect, it } from 'vitest';
import { jsonBytes } from '../sync/forbidden';
import { resultHeadline, skipCounts } from '../ui/simulate/simText';
import { doneState } from '../ui/simulate/resultFixture';
import { compareSnapshot, drawdownPoints, expandSimResult, extremes, perSymbolPct, simResultSnapshot, thinIndices } from './compact';
import { checkShareSnapshot, SHARE_MAX_BYTES } from './snapshot';
import { bigDone, NOW } from './testFixtures';

// 만들기와 같은 식(부동소수 차이가 없게 * 100을 두 번)
const pctOf = (v: number, initial: number) => Math.round((v / initial - 1) * 100 * 100) / 100;

describe('thinIndices', () => {
  it('n ≤ m이면 그대로', () => {
    expect(thinIndices(5, 5, [])).toEqual([0, 1, 2, 3, 4]);
    expect(thinIndices(3, 120, [7])).toEqual([0, 1, 2]);
  });

  it('같은 입력이면 같은 결과, 첫·끝·keep을 남기고 m + keep 이하', () => {
    const a = thinIndices(1000, 120, [3, 517, 999, -1, 1000, 2.5]);
    expect(thinIndices(1000, 120, [3, 517, 999, -1, 1000, 2.5])).toEqual(a);
    expect(a[0]).toBe(0);
    expect(a.at(-1)).toBe(999);
    expect(a).toContain(3);
    expect(a).toContain(517);
    expect(a.length).toBeLessThanOrEqual(120 + 3);
    expect([...a].sort((x, y) => x - y)).toEqual(a);
    expect(new Set(a).size).toBe(a.length);
  });

  it('최고·최저(null 건너뜀, 같으면 처음)와 최대 낙폭 점', () => {
    expect(extremes([1, 5, null, 5, -2, -2])).toEqual([1, 4]);
    expect(extremes([null, null])).toEqual([]);
    expect(drawdownPoints([0, 10, 4, 12, 11, 2, 8])).toEqual([3, 5]);
    expect(drawdownPoints([1, 2, 3])).toEqual([0, 0]);
  });
});

describe('simResultSnapshot', () => {
  it('3년 일봉 · 8종목 · 거래 300 · 건너뜀 300은 줄이지 않고 들어간다(설계 3.5)', () => {
    const b = simResultSnapshot(bigDone({ days: 735, trades: 300, skips: 300 }), { hideCapital: false, now: NOW });
    if (!b.ok) throw new Error(JSON.stringify(b));
    expect(b.reduced).toEqual([]);
    expect(b.snapshot.result.sampled).toBeNull();
    expect(b.snapshot.result.axis.offsets).toHaveLength(735);
    expect(b.snapshot.result.trades).toHaveLength(300);
    expect(jsonBytes(b.snapshot)).toBeLessThanOrEqual(SHARE_MAX_BYTES);
  });

  it('반올림: 곡선·요약은 둘째 자리, 금액은 정수, 횟수는 그대로', () => {
    const done = bigDone({ days: 30, trades: 6, skips: 2 });
    const b = simResultSnapshot(done, { hideCapital: false, now: NOW });
    if (!b.ok) throw new Error(JSON.stringify(b));
    const r = b.snapshot.result;
    expect(r.summary.cagrPct).toBe(9.88);
    expect(r.summary.mddPct).toBe(-23.46);
    expect(r.summary.avgHoldDays).toBe(19.26);
    expect(r.summary.wins).toBe(10);
    expect(r.benchmarks.holdReturnPct).toBe(16.33);
    expect(r.perSymbol[0]).toEqual([0, -370373, -3.7, 3, 0]);
    expect(r.trades[1][7]).toBe(Math.round((3.21 + 1 / 7) * 100) / 100);
    expect(r.curves.strategy[0]).toBe(0);
    expect(r.curves.benchmark?.[7]).toBeNull();
    expect(r.skipped.counts).toEqual([
      ['현금 부족', 1],
      ['1주가 1회 금액보다 비쌈', 1],
    ]);
  });

  it('건너뜀 목록이 너무 크면 이유별 개수만 남긴다', () => {
    const b = simResultSnapshot(bigDone({ days: 735, trades: 300, skips: 9000 }), { hideCapital: false, now: NOW });
    if (!b.ok) throw new Error(JSON.stringify(b));
    expect(b.reduced).toEqual(['skipped-counts']);
    expect(b.snapshot.result.skipped.rows).toBeNull();
    expect(b.snapshot.result.skipped.counts.reduce((s, [, n]) => s + n, 0)).toBe(9000);
  });

  it('곡선이 크면 원래 축에서 솎고, 최고·최저·첫·끝 값은 남는다', () => {
    const done = bigDone({ days: 3000, trades: 600, skips: 0 });
    const b = simResultSnapshot(done, { hideCapital: false, now: NOW });
    if (!b.ok) throw new Error(JSON.stringify(b));
    expect(b.reduced).toEqual(['thinned']);
    const r = b.snapshot.result;
    expect(r.sampled).toEqual({ from: 3000 });
    expect(r.axis.offsets.length).toBeLessThanOrEqual(500 + 10);
    const initial = done.meta.strategy.capital.initial;
    const full = done.result.equity.map((e) => pctOf(e.strategy, initial));
    expect(Math.max(...r.curves.strategy)).toBe(Math.max(...full));
    expect(Math.min(...r.curves.strategy)).toBe(Math.min(...full));
    expect(r.curves.strategy[0]).toBe(full[0]);
    expect(r.curves.strategy.at(-1)).toBe(full.at(-1));
    expect(r.trades).toHaveLength(600);
  });

  it('축이 3,700점을 넘으면 크기와 상관없이 먼저 솎는다', () => {
    const b = simResultSnapshot(bigDone({ days: 4000, trades: 10, skips: 0 }), { hideCapital: false, now: NOW });
    if (!b.ok) throw new Error(JSON.stringify(b));
    expect(b.reduced).toContain('thinned');
    expect(b.snapshot.result.sampled).toEqual({ from: 4000 });
    expect(b.snapshot.result.axis.offsets.length).toBeLessThanOrEqual(3000 + 10);
  });

  it('거래 3,000건은 줄여도 넘으므로 거절한다(거래는 빼지 않는다)', () => {
    const b = simResultSnapshot(bigDone({ days: 735, trades: 3000, skips: 10 }), { hideCapital: false, now: NOW });
    expect(b).toMatchObject({ ok: false, code: 'too-large' });
    if (!b.ok && b.code === 'too-large') expect(b.bytes).toBeGreaterThan(SHARE_MAX_BYTES);
  });

  it('자금 숨김: 수량·종목별 원 손익은 null, JSON에 원래 초기 자금이 없다', () => {
    const done = bigDone({ days: 30, trades: 6, skips: 0 });
    done.meta.strategy.capital.initial = 777_000_000;
    const b = simResultSnapshot(done, { hideCapital: true, now: NOW });
    if (!b.ok) throw new Error(JSON.stringify(b));
    expect(b.snapshot.capitalHidden).toBe(true);
    expect(b.snapshot.result.trades.every((t) => t[5] === null)).toBe(true);
    expect(b.snapshot.result.perSymbol.every((p) => p[1] === null)).toBe(true);
    expect(JSON.stringify(b.snapshot)).not.toContain('777000000');
    expect(JSON.stringify(b.snapshot)).not.toContain('"fee"');
  });

  it('만든 쪽 왕복: JSON 왕복 뒤 create 검사를 통과한다', () => {
    const b = simResultSnapshot(doneState(), { hideCapital: false, now: NOW });
    if (!b.ok) throw new Error(JSON.stringify(b));
    expect(checkShareSnapshot(JSON.parse(JSON.stringify(b.snapshot)), 'simResult', NOW, 'create').ok).toBe(true);
    expect(b.snapshot.result.symbols).toEqual(['005930', '000660', '035720']);
    expect(b.snapshot.strategy.universe).toEqual({ kind: 'symbols', symbols: ['005930', '000660', '035720'] });
    expect(b.snapshot.run).toMatchObject({ from: '2023-10-11', to: '2026-10-08', source: 'KRX 일봉', demo: true });
  });

  it('NaN: null을 허용하지 않는 자리면 invalid, 허용하는 자리면 null', () => {
    const a = doneState((s) => (s.result.summary.totalReturnPct = Number.NaN));
    expect(simResultSnapshot(a, { hideCapital: false, now: NOW })).toMatchObject({ ok: false, code: 'invalid', path: 'result.summary.totalReturnPct' });
    const c = doneState((s) => (s.result.equity[1].strategy = Number.NaN));
    expect(simResultSnapshot(c, { hideCapital: false, now: NOW })).toMatchObject({ ok: false, code: 'invalid', path: 'result.curves.strategy[1]' });
    const d = doneState((s) => (s.result.equity[1].index = Number.NaN));
    const ok = simResultSnapshot(d, { hideCapital: false, now: NOW });
    if (!ok.ok) throw new Error(JSON.stringify(ok));
    expect(ok.snapshot.result.curves.index?.[1]).toBeNull();
  });

  it('펼치면 결과 화면 계산이 원래 값과 반올림 오차 안에서 같다', () => {
    const done = bigDone({ days: 60, trades: 10, skips: 6 });
    const b = simResultSnapshot(done, { hideCapital: false, now: NOW });
    if (!b.ok) throw new Error(JSON.stringify(b));
    const back = expandSimResult(b.snapshot, new Map([['005930', '삼성전자']]));
    const initial = done.meta.strategy.capital.initial;
    expect(back.result.equity.map((e) => e.date)).toEqual(done.result.equity.map((e) => e.date));
    back.result.equity.forEach((e, i) => expect(Math.abs(e.strategy - done.result.equity[i].strategy)).toBeLessThan(initial * 0.0001));
    expect(skipCounts(back.result.skipped)).toEqual(skipCounts(done.result.skipped));
    expect(back.result.trades.map((t) => [t.date, t.symbol, t.kind, t.stage, t.qty])).toEqual(done.result.trades.map((t) => [t.date, t.symbol, t.kind, t.stage, t.qty]));
    expect(back.result.summary.totalReturnPct).toBeCloseTo(done.result.summary.totalReturnPct, 2);
    expect(back.meta.names).toMatchObject({ '005930': '삼성전자', '000660': '000660', '069500': '069500' });
    expect(back.meta.candles).toEqual({});
    expect(back.meta.symbols).toEqual(done.meta.symbols);
    expect(resultHeadline(back.meta.from, back.meta.to, back.meta.venueLabel, back.meta.fetchedAt, back.meta.strategy.period.from)).toBe(
      resultHeadline(done.meta.from, done.meta.to, done.meta.venueLabel, done.meta.fetchedAt, done.meta.strategy.period.from),
    );
    expect(perSymbolPct(b.snapshot)['005930']).toBe(Math.round(((-3 * 123_457.6) / initial) * 100 * 100) / 100);
  });
});

describe('compareSnapshot', () => {
  it('숨긴 종목만 있으면 빈 종목 목록이 된다(화면은 이때 공유 단추를 숨긴다)', () => {
    const g = { id: 'g', name: '빈 그룹', items: [{ symbol: '005930', colorSlot: 1 as const, hidden: true, addedAt: 1 }] };
    expect(compareSnapshot(g, { period: { unit: 'D', n: 1 }, metric: 'change', benchmark: 'KOSPI', boardOrder: 'mine' }).symbols).toEqual([]);
  });
});
