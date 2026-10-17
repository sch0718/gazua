import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { FinMetric, SelectionCriteria } from './types';
import type { MarketDataFileV4 } from '../marketData/format';
import { addDays } from '../time/kst';
import { precompute, rebalanceDates, tradingAxis } from './precompute';
import { finMissingAt, selectAt } from './select';
import { offCriteria, offCriteriaLike, symbols, ymd } from './testData';

// 설계 종목 코드는 scripts/make-demo-market-data.mjs의 FIN_* 상수와 같다
const FIN_VALUE_CODES = ['114443', '115554', '213332'];
const FIN_QUALITY_CODES = ['215554', '217776'];
const FIN_GROWTH_CODES = ['219998', '107777'];
const FIN_LOSS_CODE = '211110';
const FIN_LATE_CODE = '103333';

describe('selectAt: 재무 미래 정보 누설 방지(데모 데이터)', () => {
  const fixture = JSON.parse(gunzipSync(readFileSync('tests/fixtures/market-data-demo.json.gz')).toString()) as MarketDataFileV4;
  const axis = tradingAxis(fixture);
  const dates = rebalanceDates(axis, { from: '2025-10-16', to: '2026-10-15' }, 'monthly');
  const all = [...dates, addDays(axis[axis.length - 1], 1)];
  const prevOf = (d: string) => axis[axis.indexOf(d) - 1] ?? axis[axis.length - 1];
  // 검사 쪽 공시일: 분기말(다음 달 1일 − 1일) + 100일(a = 1) 또는 60일. 구현(fin.ts)과 따로 계산한다
  const known = (q: string, a: number): string => {
    const y = +q.slice(0, 4);
    const m = +q.slice(4, 6);
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    return addDays(addDays(next, -1), a ? 100 : 60);
  };
  const KEYS = ['rev', 'op', 'ni', 'eq', 'debt'] as const;

  /** 공시일 ≥ p인 분기 값만 바꾼다. 바꾼 분기 수를 돌려준다 */
  const mutateFrom = (p: string, f: (v: number) => number): { file: MarketDataFileV4; changed: number } => {
    const g = structuredClone(fixture);
    let changed = 0;
    for (const st of g.stocks) {
      const fin = st.fin;
      if (!fin) continue;
      fin.q.forEach((q, k) => {
        if (known(q, fin.a[k]) < p) return;
        for (const key of KEYS) fin[key][k] = f(fin[key][k]);
        changed++;
      });
    }
    return { file: g, changed };
  };
  /** 공시일 ≥ p인 분기를 잘라낸다. bars가 참이면 p 뒤 봉도 자른다 */
  const truncateFin = (p: string, bars: boolean): MarketDataFileV4 => {
    const g = structuredClone(fixture);
    const cut = ymd(p);
    for (const st of g.stocks) {
      if (bars) {
        const n = st.d.filter((x) => x <= cut).length;
        for (const k of ['d', 'o', 'h', 'l', 'c', 'v', 'tv'] as const) (st[k] as unknown[]).splice(n);
      }
      const fin = st.fin;
      if (!fin) continue;
      const keep = fin.q.filter((q, k) => known(q, fin.a[k]) < p).length;
      if (keep === 0) delete st.fin;
      else for (const k of ['q', 'a', ...KEYS] as const) (fin[k] as unknown[]).splice(keep);
    }
    if (bars)
      for (const ix of g.indices) {
        const n = ix.d.filter((x) => x <= cut).length;
        for (const k of ['d', 'o', 'c'] as const) (ix[k] as unknown[]).splice(n);
      }
    return g;
  };
  /** 공시일 < p인 마지막 분기만 f로 바꾼다 */
  const mutateLastKnown = (p: string, keys: readonly (typeof KEYS)[number][], f: (v: number) => number): MarketDataFileV4 => {
    const g = structuredClone(fixture);
    for (const st of g.stocks) {
      const fin = st.fin;
      if (!fin) continue;
      const k = fin.q.filter((q, j) => known(q, fin.a[j]) < p).length - 1;
      if (k >= 0) for (const key of keys) fin[key][k] = f(fin[key][k]);
    }
    return g;
  };

  const cond = (patch: (f: SelectionCriteria['conditions']['fin']) => void) => (c: SelectionCriteria) => patch(c.conditions.fin);
  const rankBy = (metric: FinMetric) => (c: SelectionCriteria) => (c.rank = { by: 'fin', take: 5, fin: { metric } });
  const variants: [string, (c: SelectionCriteria) => void][] = [
    ['PER 0~10', cond((f) => (f.per = { on: true, min: 0, max: 10 }))],
    ['PBR 0~1', cond((f) => (f.pbr = { on: true, min: 0, max: 1 }))],
    ['ROE ≥ 20', cond((f) => (f.roe = { on: true, min: 20 }))],
    ['영업이익률 ≥ 15', cond((f) => (f.opMargin = { on: true, min: 15 }))],
    ['매출 증가율 ≥ 30', cond((f) => (f.revGrowth = { on: true, min: 30 }))],
    ['영업이익 증가율 ≥ 40', cond((f) => (f.opGrowth = { on: true, min: 40 }))],
    ['부채비율 ≤ 60', cond((f) => (f.debtRatio = { on: true, max: 60 }))],
    ['흑자', cond((f) => (f.profitable.on = true))],
    ['정렬 PER', rankBy('per')],
    ['정렬 PBR', rankBy('pbr')],
    ['정렬 ROE', rankBy('roe')],
    ['정렬 영업이익 증가율', rankBy('opGrowth')],
  ];

  it.each(variants)('%s: 공시일 ≥ p인 분기를 ×1000·부호 반전·잘라내기로 바꿔도 모든 재선정일의 선정이 같다', (name, patch) => {
    const c = offCriteria();
    c.pool.excludeManaged = false; // 적자·늦은 종목은 관리종목이다
    patch(c);
    const pre = precompute(fixture, c, null);
    let passed = 0;
    let poolSize = 0;
    let changed = 0;
    for (const d of all) {
      const p = prevOf(d);
      const base = selectAt(d, pre, c);
      passed += base.passed;
      poolSize += selectAt(d, pre, offCriteriaLike(c)).passed;
      for (const f of [(v: number) => v * 1000, (v: number) => -v]) {
        const m = mutateFrom(p, f);
        changed += m.changed;
        expect(selectAt(d, precompute(m.file, c, null), c), `${d}`).toEqual(base);
      }
      expect(selectAt(d, precompute(truncateFin(p, false), c, null), c), `${d} 재무 자름`).toEqual(base);
      expect(selectAt(d, precompute(truncateFin(p, true), c, null), c), `${d} 봉·재무 자름`).toEqual(base);
    }
    expect(changed).toBeGreaterThan(dates.length * 100);
    expect(passed).toBeGreaterThan(0);
    if (!name.startsWith('정렬')) expect(passed).toBeLessThan(poolSize);
  });

  it('알려진 마지막 분기를 바꾸면 선정이 바뀐다(쓰고 있다는 증거): PER 조건과 ROE 정렬', () => {
    const per = offCriteria();
    per.conditions.fin.per = { on: true, min: 0, max: 10 };
    const roe = offCriteria();
    rankBy('roe')(roe);
    for (const c of [per, roe]) {
      const pre = precompute(fixture, c, null);
      for (const d of all) {
        const p = prevOf(d);
        const base = selectAt(d, pre, c);
        expect(base.passed, d).toBeGreaterThan(0);
        const g = c === per ? mutateLastKnown(p, ['ni'], (v) => -Math.abs(v) * 1000) : mutateLastKnown(p, ['eq'], (v) => v * 1000);
        expect(selectAt(d, precompute(g, c, null), c), d).not.toEqual(base);
      }
    }
  });

  it('설계 종목: PER 0~10은 모든 재선정일에 저PER 3종목만, values.finPer는 설계값(약 5) 근처', () => {
    const c = offCriteria();
    c.pool.excludeManaged = false;
    c.rank.take = 30;
    c.conditions.fin.per = { on: true, min: 0, max: 10 };
    const pre = precompute(fixture, c, null);
    for (const d of all) {
      const r = selectAt(d, pre, c);
      expect(symbols(r).sort(), d).toEqual([...FIN_VALUE_CODES].sort());
      for (const x of r.picked) expect(x.values.finPer as number, `${d} ${x.symbol}`).toBeLessThan(10);
    }
  });

  // 고ROE 종목의 ROE는 19.9~31.3, 나머지는 13.1 이하다
  it('설계 종목: ROE ≥ 18은 고ROE 종목, 영업이익 증가율 ≥ 40은 고성장 종목, 흑자는 적자 종목을 뺀다', () => {
    const run = (patch: (f: SelectionCriteria['conditions']['fin']) => void) => {
      const c = offCriteria();
      c.pool.excludeManaged = false;
      c.rank.take = 30;
      patch(c.conditions.fin);
      const pre = precompute(fixture, c, null);
      return all.map((d) => symbols(selectAt(d, pre, c)).sort());
    };
    for (const got of run((f) => (f.roe = { on: true, min: 18 }))) expect(got).toEqual([...FIN_QUALITY_CODES].sort());
    for (const got of run((f) => (f.opGrowth = { on: true, min: 40 }))) expect(got).toEqual([...FIN_GROWTH_CODES].sort());
    for (const got of run((f) => (f.profitable.on = true))) expect(got).not.toContain(FIN_LOSS_CODE);
  });

  it('설계 종목: 재무가 늦게 시작한 종목만 후보면 앞 재선정일에 finGap, 4개 분기가 알려진 뒤에는 아니다', () => {
    const c = offCriteria();
    c.pool.excludeManaged = false;
    c.pool.baskets = ['late'];
    c.conditions.fin.per = { on: true, min: 0, max: 1000 };
    const pre = precompute(fixture, c, null);
    const late = [{ id: 'late', symbols: [FIN_LATE_CODE] }];
    expect(finMissingAt(dates[0], pre, c, late)).toBe(true);
    // 202509 ~ 202606 네 분기: 202606 + 60일 = 2026-08-29 뒤 재선정일부터 계산된다
    expect(finMissingAt(dates[dates.length - 1], pre, c, late)).toBe(false);
  });
});
