# 백테스트 점검표 테스트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 점검표 「일부」 항목의 빠진 검산·누출 테스트(설계 `docs/superpowers/specs/2026-11-03-backtest-checklist-design.md` T1~T3)를 넣고 점검 문서를 실제 결과와 맞춘다.

**Architecture:** 엔진 코드는 바꾸지 않는다. 테스트 파일 3개를 새로 만든다. 지금 엔진이 맞으면 새 테스트는 처음부터 통과하므로, TDD의 「빨강」은 **엔진을 일부러 망가뜨려 테스트가 깨지는 것을 확인하고 되돌리는 단계**로 대신한다. 이 되돌림은 반드시 `git diff --stat -- src/lib/sim src/lib/screen ':!*.test.ts'` 출력이 비어 있는지로 확인한다.

**Tech Stack:** TypeScript, Vitest(`corepack pnpm test` = `TZ=America/New_York vitest run`), svelte-check(`corepack pnpm check`).

## Global Constraints

- 엔진 코드(`src/lib/sim/*.ts`, `src/lib/screen/*.ts` 중 테스트가 아닌 파일)는 바꾸지 않는다. 새 테스트가 지금 엔진에서 실패하면 멈추고 보고한다(엔진 버그인지 상위에서 가린다).
- 테스트 이름·주석·커밋 메시지는 한국어로 쓴다. 저장소의 기존 테스트 문체(짧은 명사형 설명)를 따른다.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`를 붙인다.
- 한 파일 테스트 실행: `corepack pnpm exec vitest run <파일>`(TZ는 package.json `test` 스크립트처럼 `TZ=America/New_York`을 앞에 붙인다).
- 망가뜨리기 확인 뒤에는 `git diff --stat -- src/lib/sim src/lib/screen ':!*.test.ts'`가 비어 있어야 한다.

---

### Task 1: 하락 기준선 손계산 — `src/lib/sim/benchmarks.sign.test.ts`

**Files:**
- Create: `src/lib/sim/benchmarks.sign.test.ts`

**Interfaces:**
- Consumes: `simulate(input: SimInput): SimResult`(`./simulate`), `newStrategy(now, groupId)`(`./defaults`), `bar(date,o,h,l,c)`·`tradingDates(start,n)`(`./testBars`), `SimInput`(`./types`).
- Produces: 없음.

- [ ] **Step 1: 테스트 작성**

```ts
// 하락 기준선에서 보유·지수·비교 종목 수익률과 세 차이(전략 − 기준선)를 정수 산수 손계산으로 고정한다(점검표 2절).
import { describe, expect, it } from 'vitest';
import { newStrategy } from './defaults';
import { simulate } from './simulate';
import { bar, tradingDates } from './testBars';
import type { SimInput } from './types';

const DAYS = tradingDates('2026-01-05', 6);
const flatBars = (closes: number[]) => DAYS.map((d, i) => bar(d, closes[i], closes[i], closes[i], closes[i]));

const INITIAL = 10_000_000;
const FEE = 100_015; // 1 + 0.015%를 10만 배한 정수

/** 엔진 함수를 쓰지 않는 손계산: budget 안에서 price에 살 수 있는 최대 수량과 남은 현금 */
function buy(budget: number, price: number): { qty: number; cash: number } {
  const qty = Math.floor((budget * 100_000) / (price * FEE));
  return { qty, cash: (budget * 100_000 - qty * price * FEE) / 100_000 };
}
const pct = (end: number) => (end / INITIAL - 1) * 100;

function input(): SimInput {
  const s = newStrategy(0, null);
  s.capital = { initial: INITIAL };
  s.sizing = { mode: 'fixed', pct: 10 };
  s.costs = { feePct: 0.015 };
  // A가 0일 → 1일 +1%일 때만 맞는다. 1일 종가 신호 → 2일 시가 매수. B는 오르지 않아 신호가 없다
  s.rules.buy = [{ conds: [{ kind: 'change', days: 1, pct: 0.5, op: 'above' }] }];
  s.rules.sell.takeProfit.on = false;
  s.rules.sell.stopLoss.on = false;
  s.rules.sell.trailing.on = false;
  s.rules.sell.timeExit.on = false;
  s.rules.sell.signal = { on: false, groups: [] };
  s.scaleIn.on = false;
  return {
    strategy: s,
    days: DAYS,
    stocks: [
      { symbol: 'A', name: 'A', market: 'KOSPI', isEtf: false, candles: flatBars([10_000, 10_100, 10_100, 10_100, 10_100, 8_000]) },
      { symbol: 'B', name: 'B', market: 'KOSPI', isEtf: false, candles: flatBars([5_000, 5_000, 5_000, 5_000, 5_000, 4_500]) },
    ],
    index: { id: 'KOSPI', candles: flatBars([2_000, 2_000, 2_000, 2_000, 2_000, 1_800]) },
    benchmarkStock: { symbol: 'C', name: 'C', market: 'KOSPI', isEtf: false, candles: flatBars([20_000, 20_000, 20_000, 20_000, 20_000, 22_000]) },
  };
}

describe('기준선 부호 검산(하락 기준선 둘, 상승 기준선 하나)', () => {
  const r = simulate(input());

  // 전략: 2일 시가 10,100원에 1회 금액 1,000,000원어치 → 98주, 끝날 8,000원
  const st = buy(1_000_000, 10_100);
  const strategyEnd = INITIAL - 1_000_000 + st.cash + st.qty * 8_000;
  // 보유: 몫 5,000,000원씩 첫날 시가에 산다
  const a = buy(5_000_000, 10_000);
  const b = buy(5_000_000, 5_000);
  const holdEnd = a.cash + a.qty * 8_000 + b.cash + b.qty * 4_500;
  // 지수: 첫날 시가 2,000 → 끝날 종가 1,800
  const indexEnd = (INITIAL * 1_800) / 2_000;
  // 비교 종목: 첫날 시가 20,000원에 전액 → 끝날 22,000원
  const c = buy(INITIAL, 20_000);
  const benchEnd = c.cash + c.qty * 22_000;

  it('손계산 수량과 값(산수 고정)', () => {
    expect([st.qty, a.qty, b.qty, c.qty]).toEqual([98, 499, 999, 499]);
    expect(strategyEnd).toBeCloseTo(9_794_051.53, 6);
    expect(holdEnd).toBeCloseTo(8_501_002.25, 6);
    expect(benchEnd).toBeCloseTo(10_996_503, 6);
  });

  it('전략은 한 번 사서 끝까지 든다', () => {
    expect(r.trades.map((t) => [t.kind, t.symbol, t.date, t.price, t.qty])).toEqual([['buy', 'A', DAYS[2], 10_100, 98]]);
  });

  it('부호: 보유 < 0, 지수 < 0, 비교 종목 > 0', () => {
    expect(r.benchmarks.holdReturnPct).toBeLessThan(0);
    expect(r.benchmarks.indexReturnPct!).toBeLessThan(0);
    expect(r.benchmarks.benchmarkReturnPct!).toBeGreaterThan(0);
  });

  it('수익률과 세 차이(전략 − 기준선)가 손계산과 같다', () => {
    expect(r.summary.totalReturnPct).toBeCloseTo(pct(strategyEnd), 6);
    expect(r.benchmarks.holdReturnPct).toBeCloseTo(pct(holdEnd), 6);
    expect(r.benchmarks.indexReturnPct!).toBeCloseTo(-10, 6);
    expect(r.benchmarks.benchmarkReturnPct!).toBeCloseTo(pct(benchEnd), 6);
    expect(r.summary.vsHoldPp).toBeCloseTo(pct(strategyEnd) - pct(holdEnd), 6);
    expect(r.summary.vsIndexPp!).toBeCloseTo(pct(strategyEnd) - -10, 6);
    expect(r.summary.vsBenchmarkPp!).toBeCloseTo(pct(strategyEnd) - pct(benchEnd), 6);
    // 값으로도: 전략 −2.06%, 보유 −14.99%, 비교 종목 +9.97%
    expect(r.summary.vsHoldPp).toBeCloseTo(12.9304928, 6);
    expect(r.summary.vsIndexPp!).toBeCloseTo(7.9405153, 6);
    expect(r.summary.vsBenchmarkPp!).toBeCloseTo(-12.0245147, 6);
  });

  it('마지막 날 곡선 값이 손계산과 같다(곡선 연결)', () => {
    const last = r.equity[r.equity.length - 1];
    expect(last.strategy).toBeCloseTo(strategyEnd, 4);
    expect(last.hold).toBeCloseTo(holdEnd, 4);
    expect(last.index!).toBeCloseTo(indexEnd, 4);
    expect(last.benchmark!).toBeCloseTo(benchEnd, 4);
  });
});
```

- [ ] **Step 2: 실행 — 통과 확인**

Run: `TZ=America/New_York corepack pnpm exec vitest run src/lib/sim/benchmarks.sign.test.ts`
Expected: 5 passed. 실패하면 먼저 손계산 산수(Step 1의 첫 테스트)를 확인하고, 산수가 맞는데 엔진 값이 다르면 멈추고 보고한다.

- [ ] **Step 3: 망가뜨려 빨강 확인**

`src/lib/sim/summary.ts`의 `vsHoldPp: totalReturnPct - holdPct,`를 `vsHoldPp: holdPct - totalReturnPct,`로 바꾸고 같은 명령을 돌린다.
Expected: `수익률과 세 차이` FAIL. 그다음 `git checkout -- src/lib/sim/summary.ts`로 되돌리고 다시 돌려 통과를 확인한다.

- [ ] **Step 4: 커밋**

```bash
git add src/lib/sim/benchmarks.sign.test.ts
git commit -m "test(sim): 하락 기준선의 수익률·차이 부호를 손계산으로 고정함

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: v2 조건 누출·체결가 불변식 — `src/lib/sim/simulate.leak.test.ts`

**Files:**
- Create: `src/lib/sim/simulate.leak.test.ts`

**Interfaces:**
- Consumes: `simulate(input, { timeline: true })`·`simulateCore(input)`(`./simulate`), `newStrategy`(`./defaults`), `condReason(c: Cond): string`(`./rules`), `Cond`(`./strategyV2`), `randomWalk(dates, seed, start?)`·`rng(seed)`·`stockOf(k, candles)`(`./testInputs`), `tradingDates`(`./testBars`), `kstDate`(`../time/kst`), `DayFrame`·`SimInput`·`Strategy`·`Trade`(`./types`), `Candle`(`../data/metrics`).
- Produces: 없음.

- [ ] **Step 1: 테스트 작성**

```ts
// v2 조건·조건 매도·기간 청산·트레일링·분할 매수를 켠 전략의 미래 정보 누출 검사(점검표 4절, 설계 T1).
// 1) t+1 이후 봉을 바꿔도 t까지 같다. 2) 신호 주문은 신호일보다 뒤인 체결일 봉 시가에 체결한다.
import { describe, expect, it } from 'vitest';
import type { Candle } from '../data/metrics';
import { kstDate } from '../time/kst';
import { newStrategy } from './defaults';
import { condReason } from './rules';
import { simulate, simulateCore } from './simulate';
import type { Cond } from './strategyV2';
import { tradingDates } from './testBars';
import { randomWalk, rng, stockOf } from './testInputs';
import type { DayFrame, SimInput, Strategy, Trade } from './types';

// RSI는 기간 첫날 앞 251봉이 필요하다(rules.ts RSI_START_BARS + 1)
const WARM = 260;
const N = 300;
const ALL = tradingDates('2018-01-02', WARM + N);
const DAYS = ALL.slice(WARM);

// 묶음 사이는 OR라 조건 종류마다 묶음을 하나씩 둔다. 묶음 한도 4라서 매수 4개, 조건 매도 3개로 나눈다
const BUY: Cond[] = [
  { kind: 'maPrice', period: 20, side: 'above' },
  { kind: 'rsi', period: 14, level: 50, op: 'crossUp' },
  { kind: 'volume', days: 20, ratio: 1.8 },
  { kind: 'change', days: 5, pct: -6, op: 'below' },
];
const SELL: Cond[] = [
  { kind: 'maCross', short: 5, long: 20, dir: 'dead' },
  { kind: 'fromHigh', days: 20, pct: 8 },
  { kind: 'newHigh', days: 20 },
];

function strategy(): Strategy {
  const s = newStrategy(0, null);
  s.capital = { initial: 10_000_000 };
  s.sizing = { mode: 'fixed', pct: 20 };
  s.costs = { feePct: 0.015 };
  s.rules.buy = BUY.map((c) => ({ conds: [c] }));
  s.rules.sell = {
    takeProfit: { on: true, stages: [{ pct: 8, sellPct: 50 }, { pct: 15, sellPct: 100 }], afterFirstTake: 'keep' },
    stopLoss: { on: true, pct: 7, basis: 'avgAlways' },
    trailing: { on: true, pct: 6 },
    timeExit: { on: true, days: 15 },
    signal: { on: true, groups: SELL.map((c) => ({ conds: [c] })) },
  };
  s.scaleIn = { on: true, stepPct: 3, maxAdds: 2 };
  return s;
}

/** 봉마다 양수 거래량을 채운다(testBars.bar는 v = 0이라 volume 조건이 늘 거짓이 된다). 가끔 큰 값이 나오게 세제곱 */
function withVolume(cs: Candle[], seed: number): Candle[] {
  const r = rng(seed);
  return cs.map((k) => ({ ...k, v: Math.round(100_000 * (0.5 + 3 * r() ** 3)) }));
}

const walks = (dates: string[], seedBase: number, starts?: number[]) =>
  [0, 1, 2].map((k) => withVolume(randomWalk(dates, seedBase + k * 101, starts?.[k]), seedBase + 7 + k));

function input(stocks: Candle[][]): SimInput {
  return { strategy: strategy(), days: DAYS, stocks: stocks.map((c, k) => stockOf(k, c)), index: null, benchmarkStock: null };
}

const FULL = walks(ALL, 1);
// 빠진 봉: 빼지 않은 실행에서 S1의 첫 예약 매도 체결일을 골라 뺀다. 그 예약이 다음 봉까지 미뤄진다
const gapDates = (() => {
  const t = simulateCore(input(FULL)).trades.find((x) => x.symbol === 'S1' && (x.kind === 'signalSell' || x.kind === 'time'));
  if (!t) throw new Error('S1에 예약 매도가 없어요. 전략 값이나 시드를 바꿔 주세요');
  return new Set([t.date]);
})();
const strip = (cs: Candle[], k: number) => (k === 1 ? cs.filter((b) => !gapDates.has(kstDate(b.t))) : cs);

const base = simulate(input(FULL.map(strip)), { timeline: true });
const tl = base.timeline!;
const barDates = FULL.map((cs, k) => new Set(strip(cs, k).map((b) => kstDate(b.t))));
const openOf = (symbol: string, date: string) => {
  const k = Number(symbol.slice(1));
  return strip(FULL[k], k).find((b) => kstDate(b.t) === date)!.o;
};

/** 신호일 인덱스. 매수는 체결 전 거래일, 매도는 체결 전에 이어진 pendingSells 구간의 첫날. 없으면 −1 */
function signalDay(t: Trade): number {
  const di = tl.findIndex((f) => f.date === t.date);
  const list = (f: DayFrame) => (t.kind === 'buy' ? f.pending : f.pendingSells);
  const has = (i: number) => i >= 0 && list(tl[i]).some((p) => p.symbol === t.symbol);
  let s = di - 1;
  if (!has(s)) return -1;
  if (t.kind !== 'buy') while (has(s - 1)) s--;
  return s;
}
const ordered = base.trades.filter((t) => t.kind === 'buy' || t.kind === 'signalSell' || t.kind === 'time');

describe('미래 정보 누출: v2 조건·조건 매도·기간 청산·트레일링', () => {
  it('헛돌지 않는다: 거래 수, 체결 종류, 조건 종류별 사유, 미룬 매도', () => {
    expect(base.trades.length).toBeGreaterThan(10);
    for (const kind of ['buy', 'add', 'trail', 'time', 'signalSell'] as const) expect(base.trades.some((t) => t.kind === kind), kind).toBe(true);
    const reasons = base.trades.filter((t) => t.kind === 'buy' || t.kind === 'signalSell').map((t) => t.reason);
    for (const c of [...BUY, ...SELL]) expect(reasons.some((r) => r.includes(condReason(c))), condReason(c)).toBe(true);
    const deferred = ordered.filter((t) => t.kind !== 'buy' && tl.findIndex((f) => f.date === t.date) - signalDay(t) > 1);
    expect(deferred.length).toBeGreaterThan(0);
  });

  it('신호 주문은 신호일보다 뒤인 체결일 봉 시가에, 사이에 그 종목 봉이 없을 때만 미뤄 체결한다', () => {
    for (const t of ordered) {
      const di = tl.findIndex((f) => f.date === t.date);
      const s = signalDay(t);
      const where = `${t.kind} ${t.symbol} ${t.date}`;
      expect(s, where).toBeGreaterThanOrEqual(0);
      expect(di, where).toBeGreaterThan(s);
      expect(t.price, where).toBe(openOf(t.symbol, t.date));
      const k = Number(t.symbol.slice(1));
      for (let i = s + 1; i < di; i++) expect(barDates[k].has(DAYS[i]), `${where} 사이 ${DAYS[i]}`).toBe(false);
    }
  });

  it('t+1 이후 봉을 바꿔도 t일까지의 trades·equity는 같다', () => {
    const core = simulateCore(input(FULL.map(strip)));
    const r = rng(11);
    for (let n = 0; n < 10; n++) {
      const t = WARM + 5 + Math.floor(r() * (N - 10));
      const tails = walks(ALL.slice(t + 1), 9000 + n * 10, FULL.map((cs) => cs[t].c));
      const alt = FULL.map((cs, k) => strip([...cs.slice(0, t + 1), ...tails[k]], k));
      const got = simulateCore(input(alt));
      const cut = <T extends { date: string }>(xs: T[]) => xs.filter((x) => x.date <= ALL[t]);
      expect(cut(got.trades)).toEqual(cut(core.trades));
      expect(cut(got.equity)).toEqual(cut(core.equity));
    }
  });
});
```

- [ ] **Step 2: 실행 — 통과 확인, 필요하면 값만 조정**

Run: `TZ=America/New_York corepack pnpm exec vitest run src/lib/sim/simulate.leak.test.ts`
Expected: 3 passed.
- 「헛돌지 않는다」만 실패하면(어떤 체결 종류·사유가 0건) **전략 값**(`BUY`·`SELL`의 수치, 익절·손절·트레일·기간 값, `sizing.pct`)이나 `walks`의 시드만 바꾼다. 어떤 조건이 0건이었는지 실패 메시지(두 번째 인자)로 알 수 있다. 엔진 코드는 바꾸지 않는다.
- 나머지 두 테스트가 실패하면 엔진 동작이 설계와 다르다는 뜻이므로 멈추고 실패 메시지를 보고한다.

- [ ] **Step 3: 망가뜨려 빨강 확인**

`src/lib/sim/simulate.ts`의 「1-2. 시가: 예약 매수」에서 `const price = st.stock.candles[i].o;`를 `const price = st.stock.candles[i - 1]?.c ?? st.stock.candles[i].o;`(신호일 종가 체결)로 바꾸고 돌린다.
Expected: `신호 주문은 … 시가에` FAIL. `git checkout -- src/lib/sim/simulate.ts`로 되돌리고 다시 통과를 확인한다.

- [ ] **Step 4: 커밋**

```bash
git add src/lib/sim/simulate.leak.test.ts
git commit -m "test(sim): v2 조건·조건 매도의 미래 정보 누출과 신호 주문 체결가를 고정함

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 기준 검증 전체 누출 — `src/lib/screen/runValidation.leak.test.ts`

**Files:**
- Create: `src/lib/screen/runValidation.leak.test.ts`

**Interfaces:**
- Consumes: `runValidation(input)`·`ValidationResult`(`./runValidation`), `newCriteria(now, range)`(`./defaults`), `rebalanceDates(axis, period, rebalance)`·`tradingAxis(data)`(`./precompute`), `NOW`(`./testData`), `newStrategy`(`../sim/defaults`), `MarketDataFile`(`../marketData/format`), `SelectionCriteria`(`./types`).
- Produces: 없음.

- [ ] **Step 1: 테스트 작성**

```ts
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
```

- [ ] **Step 2: 실행 — 통과 확인**

Run: `TZ=America/New_York corepack pnpm exec vitest run src/lib/screen/runValidation.leak.test.ts`
Expected: 3 passed. 「헛돌지 않는다」만 실패하면 `CASES`의 재선정 순번(3·4·6)만 바꾼다. 나머지가 실패하면 멈추고 보고한다.
- 데모 파일 종목에 `tv` 필드가 없다는 타입 오류가 나면 `select.test.ts`의 `mutateAt`처럼 `for (const k of ['o','h','l','c','v','tv'] as const)` 형태로 바꿔 타입을 맞춘다.

- [ ] **Step 3: 망가뜨려 빨강 확인**

`src/lib/screen/select.ts`의 `barsAt`에서 종목별 인덱스 계산을 d의 봉을 쓰도록 바꾼다(전날 봉이 있는 종목은 d의 봉 인덱스를 돌려준다).

```ts
    const i = lowerBound(st.d, d);
    return i >= 1 && st.d[i - 1] === prevDay && st.d[i] === d ? i : -1;
```

(`prevDay = pre.axis[ai]`로 바꾸는 방법은 쓰지 않는다. 그러면 모든 종목의 인덱스가 −1이 되어 선별이 비고, 누출 단언이 아니라 「헛돌지 않는다」만 깨진다.)
Expected: `재선정일 바로 전날` 테스트가 **`rebalances` 비교(`toEqual`)에서** 실패한다. 실패 메시지가 그 단언인지 확인한다. 「헛돌지 않는다」와 「바꾸기가 먹었다」는 이때도 통과해야 한다. `git checkout -- src/lib/screen/select.ts`로 되돌리고 다시 통과를 확인한다.

- [ ] **Step 4: 커밋**

```bash
git add src/lib/screen/runValidation.leak.test.ts
git commit -m "test(screen): 기준 검증 전체 경로의 미래 정보 누출을 데모 데이터로 고정함

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 점검 문서 맞추기와 전체 검증

**Files:**
- Modify: `docs/proposals/2026-11-03-backtest-checklist.md`(「이번에 추가한 테스트」 절, 2·4절 「이번에 한 일」)

**Interfaces:**
- Consumes: Task 1~3의 파일과 테스트 이름.
- Produces: 없음.

- [ ] **Step 1: 점검 문서 갱신**

「이번에 추가한 테스트」 표의 각 줄을 실제 `describe`·`it` 이름과 맞춘다. 첫 문단에 망가뜨리기 확인 결과를 한 줄씩 더한다(무엇을 망가뜨렸고 어느 테스트가 깨졌는지). Task 2 Step 2에서 전략 값을 조정했으면 그 값을 표에 적을 필요는 없다. 2절·4절 끝의 「이번에 한 일」 문장도 실제 파일명과 테스트 이름에 맞춘다. 판정(일부·없음)은 그대로 둔다.

- [ ] **Step 2: 전체 테스트와 타입 검사**

Run: `corepack pnpm test` → Expected: 모두 통과(실패하면 새 파일 때문인지 기존 flaky인지 가려 보고).
Run: `corepack pnpm check` → Expected: 오류 0.
Run: `git diff --stat main -- src ':!*.test.ts'` → Expected: 출력 없음(엔진 코드 변경 없음).

- [ ] **Step 3: 커밋**

```bash
git add docs/proposals/2026-11-03-backtest-checklist.md
git commit -m "docs: 점검표에 추가한 테스트와 망가뜨리기 확인 결과를 적음

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
