// 기준 검증 전체 경로(선별 → ① 보유 → ② 매매 규칙, 지수·비교 종목)의 미래 정보 누출 검사(점검표 4절, 설계 T3).
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import type { MarketDataFile } from '../marketData/format';
import { newStrategy } from '../sim/defaults';
import { newCriteria } from './defaults';
import { rebalanceDates, tradingAxis } from './precompute';
import { runValidation, type ValidationResult } from './runValidation';
import { NOW } from './testData';

// 데모 데이터 전체로 검증을 여러 번 돌리는 동기 계산이라 기본 5초를 넘긴다
vi.setConfig({ testTimeout: 120_000 });

const fixture = JSON.parse(gunzipSync(readFileSync('tests/fixtures/market-data-demo.json.gz')).toString()) as MarketDataFile;
const ymd = (d: string) => d.replaceAll('-', '');

const strategy = newStrategy(NOW, null);
const criteria = (() => {
  const c = newCriteria(NOW, fixture.range);
  c.conditions.rebound.on = false; // runValidation.test.ts의 crit()와 같다
  c.trading.strategyId = strategy.id;
  return c;
})();

function run(data: MarketDataFile): ValidationResult {
  const r = runValidation({ data, criteria, strategies: [strategy] });
  if ('cancelled' in r) throw new Error('cancelled');
  return r;
}

/** t 뒤의 봉만 종목·지수마다 다른 배율로 바꾼다. 날짜 배열은 그대로 둔다 */
function mutateAfter(f: MarketDataFile, t: string): MarketDataFile {
  const g = structuredClone(f);
  const key = ymd(t);
  g.stocks.forEach((s, k) => {
    const p = 1.3 + (k % 7) * 0.11;
    const q = 0.4 + (k % 5) * 0.3;
    s.d.forEach((d, i) => {
      if (d <= key) return;
      for (const x of ['o', 'h', 'l', 'c'] as const) s[x][i] *= p;
      s.v[i] *= q;
      s.tv[i] *= p * q;
    });
  });
  g.indices.forEach((x, k) => {
    const p = 0.7 + k * 0.2;
    x.d.forEach((d, i) => {
      if (d <= key) return;
      x.o[i] *= p;
      x.c[i] *= p;
    });
  });
  return g;
}

const axis = tradingAxis(fixture);
const dates = rebalanceDates(axis, criteria.period, criteria.rebalance);
const at = (d: string) => axis.indexOf(d);
const CASES: [string, string][] = [
  ['재선정일 사이', axis[(at(dates[3]) + at(dates[4])) >> 1]],
  ['재선정일 바로 전날', axis[at(dates[6]) - 1]],
];

describe('runValidation: 미래 정보 누출(데모 데이터)', () => {
  const base = run(fixture);
  const upTo = <T extends { date: string }>(xs: T[] | null | undefined, t: string) => (xs ?? []).filter((x) => x.date <= t);

  it('헛돌지 않는다: 지수·비교 종목 곡선, 고른 종목, ② 체결', () => {
    expect(base.indices[0].curve).not.toBeNull();
    expect(base.benchmarks[0].curve).not.toBeNull();
    const firstT = CASES[0][1];
    expect(base.rebalances.some((s) => s.date <= firstT && s.picked.length > 0)).toBe(true);
    expect(base.trading!.trades).toBeGreaterThan(0);
    expect(upTo(base.trading!.curve, firstT).some((p) => p.value !== criteria.capital)).toBe(true);
  });

  for (const [label, t] of CASES) {
    it(`${label}(${t}) 뒤 봉을 바꿔도 t까지 곡선과 t 다음 거래일까지 재선정이 같다`, () => {
      const got = run(mutateAfter(fixture, t));
      expect(upTo(got.hold.equity, t)).toEqual(upTo(base.hold.equity, t));
      expect(upTo(got.trading!.curve, t)).toEqual(upTo(base.trading!.curve, t));
      got.indices.forEach((x, i) => expect(upTo(x.curve, t)).toEqual(upTo(base.indices[i].curve, t)));
      got.benchmarks.forEach((x, i) => expect(upTo(x.curve, t)).toEqual(upTo(base.benchmarks[i].curve, t)));
      // 재선정일 d의 선별은 전 거래일까지 봉만 쓴다. t = d의 전날이면 d의 선별도 같아야 한다
      const next = axis[at(t) + 1];
      expect(got.rebalances.filter((s) => s.date <= next)).toEqual(base.rebalances.filter((s) => s.date <= next));
      // 바꾸기가 먹었다
      expect(got.hold.equity.filter((p) => p.date > t)).not.toEqual(base.hold.equity.filter((p) => p.date > t));
    });
  }
});
