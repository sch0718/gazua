import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { MacroSeriesKey, SelectionCriteria } from './types';
import type { MarketDataFileV2 } from '../marketData/format';
import { rebalanceDates, precompute, tradingAxis } from './precompute';
import { macroKnownFrom } from './macro';
import { selectAt } from './select';
import { betaOn, offCriteria, offCriteriaLike, ymd } from './testData';

describe('selectAt: 환율·유가 공개 전 값 누설 방지(데모 데이터)', () => {
  const fixture = JSON.parse(gunzipSync(readFileSync('tests/fixtures/market-data-demo.json.gz')).toString()) as MarketDataFileV2;
  const axis = tradingAxis(fixture);
  const dates = rebalanceDates(axis, { from: '2025-10-16', to: '2026-10-15' }, 'monthly');
  const KEYS: MacroSeriesKey[] = ['usdkrw', 'wti'];
  const iso = (o: string) => `${o.slice(0, 4)}-${o.slice(4, 6)}-${o.slice(6, 8)}`;

  /** knownFrom > p인 관측값만 바꾼다. 바꾼 값 가운데 관측일이 p 이전인 것의 수를 돌려준다 */
  const mutateUnknown = (p: string, f: (v: number) => number): { file: MarketDataFileV2; earlier: number } => {
    const g = structuredClone(fixture);
    let earlier = 0;
    for (const key of KEYS) {
      const s = g.macro[key];
      s.d.forEach((o, i) => {
        if (macroKnownFrom(key, o) <= p) return;
        s.v[i] = f(s.v[i]);
        if (iso(o) <= p) earlier++;
      });
    }
    return { file: g, earlier };
  };
  /** p 이후의 관측값과 봉을 모두 자른다 */
  const truncate = (p: string): MarketDataFileV2 => {
    const g = structuredClone(fixture);
    const cut = ymd(p);
    for (const key of KEYS) {
      const s = g.macro[key];
      const n = s.d.filter((o) => o <= cut).length;
      g.macro[key] = { d: s.d.slice(0, n), v: s.v.slice(0, n) };
    }
    for (const st of g.stocks) {
      const n = st.d.filter((x) => x <= cut).length;
      for (const k of ['d', 'o', 'h', 'l', 'c', 'v', 'tv'] as const) (st[k] as unknown[]).splice(n);
    }
    for (const ix of g.indices) {
      const n = ix.d.filter((x) => x <= cut).length;
      for (const k of ['d', 'o', 'c'] as const) (ix[k] as unknown[]).splice(n);
    }
    return g;
  };

  /** p 이후 봉을 자르고, 계열은 p까지 공개된 관측값(knownFrom ≤ p)만 남긴다. 그날 실제로 알 수 있던 것 전부다 */
  const truncatePublished = (p: string): MarketDataFileV2 => {
    const g = truncate(p);
    for (const key of KEYS) {
      const s = fixture.macro[key];
      const n = s.d.filter((o) => macroKnownFrom(key, o) <= p).length;
      g.macro[key] = { d: s.d.slice(0, n), v: s.v.slice(0, n) };
    }
    return g;
  };

  const variants: [string, (c: SelectionCriteria) => void][] = [
    ['원/달러 β 수혜', (c) => betaOn(c, 'usdkrw', 0.3, 5)],
    ['원/달러 β 피해', (c) => betaOn(c, 'usdkrw', -5, -0.3)],
    ['원/달러 흐름', (c) => (c.conditions.macro.usdkrw.trend = { on: true, lookback: 20, thresholdPct: 0.5, minAbsBeta: 0.3, whenFlat: 'none' })],
    ['WTI β', (c) => betaOn(c, 'wti', -0.2, 0.2)],
    ['WTI 흐름', (c) => (c.conditions.macro.wti.trend = { on: true, lookback: 10, thresholdPct: 1, minAbsBeta: 0, whenFlat: 'pass' })],
    ['정렬 원/달러 β', (c) => (c.rank = { by: 'macroBeta', take: 5, series: 'usdkrw' })],
    ['정렬 WTI β', (c) => (c.rank = { by: 'macroBeta', take: 5, series: 'wti' })],
  ];

  it.each(variants)('%s: knownFrom > p인 관측값을 극단값으로 바꾸거나, p 이후를 자르거나, 공개된 관측값만 남겨도 결과가 같다', (name, patch) => {
    const c = offCriteria();
    c.pool.types = ['STOCK', 'ETF'];
    patch(c);
    const pre = precompute(fixture, c, null);
    let passed = 0;
    let poolSize = 0;
    let earlier = 0;
    for (const d of dates) {
      const p = axis[axis.indexOf(d) - 1];
      const base = selectAt(d, pre, c);
      passed += base.passed;
      poolSize += selectAt(d, pre, offCriteriaLike(c)).passed;
      for (const f of [(v: number) => v * 1000, (v: number) => -v, (v: number) => v / 1000]) {
        const m = mutateUnknown(p, f);
        earlier += m.earlier;
        expect(selectAt(d, precompute(m.file, c, null), c), `${d}`).toEqual(base);
      }
      expect(selectAt(d, precompute(truncate(p), c, null), c), `${d} 자름`).toEqual(base);
      expect(selectAt(d, precompute(truncatePublished(p), c, null), c), `${d} 공개분만`).toEqual(base);
    }
    // 관측일은 p보다 앞서지만 아직 공개되지 않은 값도 바꿨다
    expect(earlier).toBeGreaterThan(dates.length);
    expect(passed).toBeGreaterThan(0);
    if (!name.startsWith('정렬')) expect(passed).toBeLessThan(poolSize);
  });

  it('설계한 종목의 원/달러 β: +1.5 종목과 −1.0 종목', () => {
    const c = offCriteria();
    c.pool.markets = ['KOSPI', 'KOSDAQ'];
    c.rank = { by: 'macroBeta', take: 30, series: 'usdkrw' };
    const sel = selectAt(dates[dates.length - 1], precompute(fixture, c, null), c);
    const beta = Object.fromEntries(sel.picked.map((x) => [x.symbol, x.values.usdkrwBeta as number]));
    for (const s of ['100000', '101111', '102222', '200000', '202222']) expect(Math.abs(beta[s] - 1.5), s).toBeLessThan(0.25);
    for (const s of ['104444', '105555', '204444']) expect(Math.abs(beta[s] + 1), s).toBeLessThan(0.25);
  });
});
