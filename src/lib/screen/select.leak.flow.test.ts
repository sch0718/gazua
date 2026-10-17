import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { FlowWho, SelectionCriteria } from './types';
import type { MarketDataFileV3 } from '../marketData/format';
import { addDays } from '../time/kst';
import { precompute, rebalanceDates, tradingAxis } from './precompute';
import { flowMissingAt, selectAt } from './select';
import { offCriteria, offCriteriaLike, symbols, ymd } from './testData';

// 설계 종목 코드는 scripts/make-demo-market-data.mjs의 FLOW_* 상수와 같다
const FLOW_FOREIGN_CODES = ['106666', '108888', '206666'];
const FLOW_INST_CODES = ['109999', '208888'];
const FLOW_BOTH_CODE = '111110';
const FLOW_LATE_CODE = '113332';
const FLOW_NONE_CODE = '069500';

describe('selectAt: 수급 미래 정보 누설 방지(데모 데이터)', () => {
  const fixture = JSON.parse(gunzipSync(readFileSync('tests/fixtures/market-data-demo.json.gz')).toString()) as MarketDataFileV3;
  const axis = tradingAxis(fixture);
  const dates = rebalanceDates(axis, { from: '2025-10-16', to: '2026-10-15' }, 'monthly');
  const iso = (x: string) => `${x.slice(0, 4)}-${x.slice(4, 6)}-${x.slice(6, 8)}`;

  /** 날짜 ≥ p인 수급 값만 바꾼다. 바꾼 값의 수를 돌려준다 */
  const mutateFrom = (p: string, f: (v: number) => number): { file: MarketDataFileV3; changed: number } => {
    const g = structuredClone(fixture);
    let changed = 0;
    for (const st of g.stocks) {
      const fl = st.flow;
      if (!fl) continue;
      const at = st.d.indexOf(fl.from);
      for (let j = 0; j < fl.f.length; j++) {
        if (iso(st.d[at + j]) < p) continue;
        fl.f[j] = f(fl.f[j]);
        fl.i[j] = f(fl.i[j]);
        fl.p[j] = f(fl.p[j]);
        changed++;
      }
    }
    return { file: g, changed };
  };
  /** 날짜 ≥ p인 수급을 잘라낸다(수급 끝이 p 전 거래일). bars가 참이면 p 뒤 봉도 자른다 */
  const truncateFlow = (p: string, bars: boolean): MarketDataFileV3 => {
    const g = structuredClone(fixture);
    const cut = ymd(p);
    for (const st of g.stocks) {
      if (bars) {
        const n = st.d.filter((x) => x <= cut).length;
        for (const k of ['d', 'o', 'h', 'l', 'c', 'v', 'tv'] as const) (st[k] as unknown[]).splice(n);
      }
      const fl = st.flow;
      if (!fl) continue;
      const at = st.d.indexOf(fl.from);
      const keep = at < 0 ? 0 : st.d.slice(at, at + fl.f.length).filter((x) => x < cut).length;
      if (keep === 0) delete st.flow;
      else st.flow = { from: fl.from, f: fl.f.slice(0, keep), i: fl.i.slice(0, keep), p: fl.p.slice(0, keep) };
    }
    if (bars)
      for (const ix of g.indices) {
        const n = ix.d.filter((x) => x <= cut).length;
        for (const k of ['d', 'o', 'c'] as const) (ix[k] as unknown[]).splice(n);
      }
    return g;
  };

  const flowAmount = (who: FlowWho, days: number, minPct: number, maxPct: number) => (c: SelectionCriteria) =>
    (c.conditions.flow.amount = { on: true, who, days, minPct, maxPct });
  const flowStreakOn = (who: FlowWho, minDays: number) => (c: SelectionCriteria) => (c.conditions.flow.streak = { on: true, who, minDays });
  const rankBy = (who: FlowWho, days: number) => (c: SelectionCriteria) => (c.rank = { by: 'flow', take: 5, flow: { who, days } });

  const variants: [string, (c: SelectionCriteria) => void][] = [
    ['외국인 순매수 ≥ 1%', flowAmount('foreign', 20, 1, 100)],
    ['기관 순매도', flowAmount('inst', 10, -100, -0.2)],
    ['개인 5일', flowAmount('indiv', 5, -100, -1)],
    ['외국인+기관', flowAmount('both', 20, 1, 100)],
    ['기관 연속 3일', flowStreakOn('inst', 3)],
    ['함께 연속 2일', flowStreakOn('both', 2)],
    ['외국인 ≥ 0.5% + 기관 연속 2일', (c) => (flowAmount('foreign', 60, 0.5, 100)(c), flowStreakOn('inst', 2)(c))],
    ['정렬 외국인 20일', rankBy('foreign', 20)],
    ['정렬 외국인+기관', rankBy('both', 10)],
    ['정렬 개인 120일', rankBy('indiv', 120)],
  ];

  it.each(variants)('%s: 날짜 ≥ p인 수급을 ×1000·부호 반전·잘라내기로 바꿔도 모든 재선정일의 선정이 같다', (name, patch) => {
    const c = offCriteria();
    c.pool.types = ['STOCK', 'ETF'];
    patch(c);
    const pre = precompute(fixture, c, null);
    let passed = 0;
    let poolSize = 0;
    let changed = 0;
    for (const d of [...dates, addDays(axis[axis.length - 1], 1)]) {
      const p = axis[axis.indexOf(d) - 1] ?? axis[axis.length - 1];
      const base = selectAt(d, pre, c);
      passed += base.passed;
      poolSize += selectAt(d, pre, offCriteriaLike(c)).passed;
      for (const f of [(v: number) => v * 1000, (v: number) => -v]) {
        const m = mutateFrom(p, f);
        changed += m.changed;
        expect(selectAt(d, precompute(m.file, c, null), c), `${d}`).toEqual(base);
      }
      expect(selectAt(d, precompute(truncateFlow(p, false), c, null), c), `${d} 수급 자름`).toEqual(base);
      expect(selectAt(d, precompute(truncateFlow(p, true), c, null), c), `${d} 봉·수급 자름`).toEqual(base);
    }
    expect(changed).toBeGreaterThan(dates.length * 100);
    expect(passed).toBeGreaterThan(0);
    if (!name.startsWith('정렬')) expect(passed).toBeLessThan(poolSize);
  });

  // 설계하지 않은 종목의 20일 비율은 잡음으로 ±1% 남짓(2025-10-16에 107777이 1.02%)이라 2%로 가른다
  it('설계 종목: 외국인 순매수 ≥ 2%는 외국인 종목과 외국인+기관 종목만, 늦게 시작한 종목은 앞 재선정일에 계산 불가', () => {
    const c = offCriteria();
    c.pool.types = ['STOCK', 'ETF'];
    c.rank.take = 30;
    flowAmount('foreign', 20, 2, 100)(c);
    const pre = precompute(fixture, c, null);
    for (const d of dates) expect(symbols(selectAt(d, pre, c)).sort(), d).toEqual([...FLOW_FOREIGN_CODES, FLOW_BOTH_CODE].sort());
    const lateOnly = { ...c, pool: { ...c.pool, baskets: ['late'] } };
    const late = [{ id: 'late', symbols: [FLOW_LATE_CODE] }];
    expect(flowMissingAt(dates[0], pre, lateOnly, late)).toBe(true);
    expect(flowMissingAt(dates[dates.length - 1], pre, lateOnly, late)).toBe(false);
    const none = [{ id: 'late', symbols: [FLOW_NONE_CODE] }];
    expect(dates.every((d) => flowMissingAt(d, pre, lateOnly, none))).toBe(true);
  });

  it('설계 종목: 마지막 거래일 다음 날 기관 연속 순매수는 9일(마지막 10일 연속, 하루 늦춤)', () => {
    const c = offCriteria();
    c.rank.take = 30;
    flowStreakOn('inst', 9)(c);
    const sel = selectAt(addDays(axis[axis.length - 1], 1), precompute(fixture, c, null), c);
    const got = Object.fromEntries(sel.picked.map((x) => [x.symbol, x.values.flowStreak]));
    for (const s of FLOW_INST_CODES) expect(got[s], s).toBe(9);
    expect(got[FLOW_BOTH_CODE]).toBeGreaterThanOrEqual(9);
  });
});
