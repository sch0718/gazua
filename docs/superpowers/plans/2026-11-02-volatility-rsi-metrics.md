# 변동성·RSI(14) 비교 지표 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 비교 화면에서 변동성과 RSI(14)를 1개월 이상 기간에 고를 수 있게 하고, 차트·리더보드·표·도움말·로드맵을 맞춘다.

**Architecture:** 계산은 순수 함수다. 변동성은 선정 기준의 `rollingVol`을 `src/lib/sim/indicators.ts`로 옮긴 `rollingStdPct`에 `√252`를 곱하고, RSI는 같은 파일의 기존 `rsi`를 부른다. `metricPoints`가 기간 앞 일봉 종가를 워밍업으로 붙여 계산하고 기간 봉 시각의 점만 낸다. 화면은 단위(`MetricUnit`)로 표기·색·기준선을 정한다.

**Tech Stack:** Svelte 5, TypeScript, Vite, vitest(+jsdom, @testing-library/svelte), Playwright, pnpm 10(`corepack pnpm`).

**설계 문서:** `docs/superpowers/specs/2026-11-02-volatility-rsi-metrics-design.md`

## Global Constraints

- 사용자에게 보이는 문구와 주석·커밋 메시지는 한국어로 쓴다. 주변 코드의 주석 밀도·말투(「~다」체 주석, 「~요」체 화면 문구)를 따른다.
- 변동성 = 최근 20개 일간 단순수익률(`c[k]/c[k-1]−1`)의 표본 표준편차(n−1) × √252 × 100. 창(종가 21개)에 0 이하·유한하지 않은 종가가 있거나 종가가 모자라면 null.
- RSI = `rsi(closes, 14)`(`src/lib/sim/indicators.ts`, Wilder). 새로 구현하지 않는다. 입력 종가(워밍업 포함)에 0 이하·유한하지 않은 값이 처음 나온 봉부터 그 뒤는 모두 null(Wilder 평활은 한 번 섞인 값의 영향이 뒤로 계속 남는다).
- 두 지표는 기간 길이 30일 이상(1개월~)에서만 고를 수 있다. 모자라면 이유 문구는 `1개월 이상에서 볼 수 있어요`.
- 단위: 변동성 `'%abs'`(예 `32.10%`, 부호·색·기준선 없음), RSI `''`(예 `62.4`, 부호·색 없음, 차트 기준선 50).
- 테스트: `corepack pnpm test`(TZ 고정 포함), 타입: `corepack pnpm check`, e2e: `corepack pnpm e2e`. 개별 실행은 `corepack pnpm test <파일>`.
- 커밋 메시지 형식: `<type>(metrics): <한국어 요약>` + 빈 줄 + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `src/lib/help/content.ts`·`docs/help/*.md`·`public/help/img/*`는 생성물이다. `scripts/motion/help-pages.mjs`를 고치고 `corepack pnpm build:motion`으로 만든다.

## 파일 구조

| 파일 | 책임 | 작업 |
|---|---|---|
| `src/lib/sim/indicators.ts` | 순수 지표 함수(sma·rsi·rollingMax…) — `rollingStdPct` 추가 | 1 |
| `src/lib/screen/precompute.ts` | 선정 기준 사전 계산 — 비공개 `rollingVol` 제거, `rollingStdPct` 사용 | 1 |
| `src/lib/data/metrics.ts` | 비교 지표 순수 계산 — `annualizedVolPct` 추가 | 2 |
| `src/lib/data/seriesMetrics.ts` | 시리즈 → 지표 점 — `volatility`·`rsi` 분기 | 3 |
| `src/lib/data/metricRegistry.ts` | 지표 목록·사용 가능 판정·`MetricUnit` 정의 | 4 |
| `src/lib/ui/compare/compareText.ts` | 값 표기 — `MetricUnit` 재내보내기, `%abs`·`''` 표기 | 5 |
| `src/lib/chart/CompareChart.svelte`, `src/lib/chart/CompareChartFixture.svelte`, `src/lib/ui/compare/ChartPanel.svelte` | 차트 축 표기·기준선·단위 타입 | 5 |
| `src/routes/Compare.svelte` | `''→'%'` 변환 제거 | 5 |
| `scripts/motion/help-pages.mjs`(→ 생성물), `docs/roadmap.md`, `docs/superpowers/specs/2026-10-11-stock-compare-design.md`, `tests/e2e/compare.spec.ts` | 도움말·문서·e2e | 6 |

---

### Task 1: `rollingVol`을 `rollingStdPct`로 옮기기

**Files:**
- Modify: `src/lib/sim/indicators.ts`(파일 끝에 추가)
- Modify: `src/lib/screen/precompute.ts:3`(import), `:186-198`(함수 삭제), `:275`(호출)
- Test: `src/lib/sim/indicators.test.ts`

**Interfaces:**
- Produces: `export function rollingStdPct(c: number[], days: number): (number | null)[]` — 봉 i의 값은 `r[i-days+1..i]`(`r[k] = c[k]/c[k-1]−1`)의 표본 표준편차 × 100. `days < 2` 또는 `i < days`면 null. 종가를 검사하지 않는다(지금 동작 그대로).

- [ ] **Step 1: 실패하는 테스트 쓰기** — `src/lib/sim/indicators.test.ts`의 import에 `rollingStdPct`를 더하고 파일 끝에 붙인다.

```ts
describe('rollingStdPct', () => {
  it('최근 days개 일간 수익률의 표본 표준편차(%)', () => {
    // 수익률 +10%, −10%: 평균 0, 표본분산 (0.01+0.01)/1 → 표준편차 0.1414…
    const out = rollingStdPct([100, 110, 99], 2);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBeCloseTo(Math.sqrt(0.02) * 100, 10);
  });
  it('수익률이 일정하면 0', () => {
    expect(rollingStdPct([100, 101, 102.01, 103.0301], 3)[3]).toBeCloseTo(0, 10);
  });
  it('days가 2 미만이면 모두 null', () => {
    expect(rollingStdPct([1, 2, 3], 1)).toEqual([null, null, null]);
  });
});
```

- [ ] **Step 2: 실패 확인** — `corepack pnpm test src/lib/sim/indicators.test.ts` → FAIL(`rollingStdPct` 없음).

- [ ] **Step 3: 옮기기** — `src/lib/screen/precompute.ts`의 `rollingVol` 함수(주석 포함 186–198행)를 잘라 `src/lib/sim/indicators.ts` 끝에 아래처럼 붙인다. 본문은 바꾸지 않는다.

```ts
/**
 * 최근 days개 일간 수익률(c[k]/c[k-1]−1)의 표본 표준편차(%). 창마다 새로 계산해 오차가 쌓이지 않게 한다.
 * 종가는 검사하지 않는다. 선정 기준(precompute)과 비교 지표(annualizedVolPct)가 같이 쓴다
 */
export function rollingStdPct(c: number[], days: number): (number | null)[] {
  const r = c.map((x, k) => (k === 0 ? 0 : x / c[k - 1] - 1));
  return c.map((_, i) => {
    if (days < 2 || i < days) return null;
    let mean = 0;
    for (let k = i - days + 1; k <= i; k++) mean += r[k];
    mean /= days;
    let ss = 0;
    for (let k = i - days + 1; k <= i; k++) ss += (r[k] - mean) ** 2;
    return Math.sqrt(ss / (days - 1)) * 100;
  });
}
```

`precompute.ts` 3행을 `import { rollingMax, rollingStdPct, sma } from '../sim/indicators';`로, 275행을 `vol: rollingStdPct(close, params.volDays),`로 바꾼다.

- [ ] **Step 4: 통과 확인** — `corepack pnpm test src/lib/sim/indicators.test.ts src/lib/screen` → PASS(선정 기준 테스트도 그대로 통과해야 한다).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/sim/indicators.ts src/lib/sim/indicators.test.ts src/lib/screen/precompute.ts
git commit -m "refactor(metrics): 선정 기준의 이동 표준편차를 indicators의 rollingStdPct로 옮김

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `annualizedVolPct`

**Files:**
- Modify: `src/lib/data/metrics.ts`(맨 위 import, 파일 끝에 함수)
- Test: `src/lib/data/metrics.test.ts`

**Interfaces:**
- Consumes: `rollingStdPct`(Task 1)
- Produces: `export function annualizedVolPct(closes: number[], window: number): (number | null)[]` — 입력과 같은 길이.

- [ ] **Step 1: 실패하는 테스트 쓰기** — `metrics.test.ts` import 목록에 `annualizedVolPct`를 더하고 `describe('metricAvailability'` 앞에 붙인다.

```ts
describe('annualizedVolPct', () => {
  it('일간 수익률 표본 표준편차 × √252 (%)', () => {
    const out = annualizedVolPct([100, 110, 99], 2);
    expect(out.slice(0, 2)).toEqual([null, null]);
    expect(out[2]).toBeCloseTo(Math.sqrt(0.02) * Math.sqrt(252) * 100, 8);
  });
  it('수익률이 일정하면 0, 종가가 window+1개보다 적으면 null', () => {
    const closes = Array.from({ length: 21 }, (_, i) => 100 * 1.01 ** i);
    const out = annualizedVolPct(closes, 20);
    expect(out.slice(0, 20).every((v) => v === null)).toBe(true);
    expect(out[20]).toBeCloseTo(0, 8);
  });
  it('창 안에 0 이하·유한하지 않은 종가가 있으면 그 창의 봉만 null', () => {
    const out = annualizedVolPct([100, 0, 100, 101, 102, 103], 2);
    // 봉 2·3은 창(i−2..i)에 0이 있다. 봉 4·5는 창이 0을 벗어났다.
    expect(out[2]).toBeNull();
    expect(out[3]).toBeNull();
    expect(out[4]).not.toBeNull();
    expect(Number.isFinite(out[5]!)).toBe(true);
    expect(annualizedVolPct([100, 101, Number.NaN, 102], 2)[3]).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인** — `corepack pnpm test src/lib/data/metrics.test.ts` → FAIL(`annualizedVolPct` 없음).

- [ ] **Step 3: 구현** — `metrics.ts` 맨 위에 `import { rollingStdPct } from '../sim/indicators';`를 더하고 파일 끝에 붙인다.

```ts
const TRADING_DAYS_PER_YEAR = 252;

/**
 * 변동성(연환산 %): 최근 window개 일간 수익률의 표본 표준편차 × √252. 선정 기준·시뮬레이션 결과의 변동성과 같은 식이다.
 * 봉 i의 창(i−window..i 종가)에 0 이하·유한하지 않은 종가가 있거나 종가가 모자라면 null.
 */
export function annualizedVolPct(closes: number[], window: number): (number | null)[] {
  const std = rollingStdPct(closes, window);
  return closes.map((_, i) => {
    const s = std[i];
    if (s === null) return null;
    for (let k = i - window; k <= i; k++) {
      const c = closes[k];
      if (!Number.isFinite(c) || c <= 0) return null;
    }
    return s * Math.sqrt(TRADING_DAYS_PER_YEAR);
  });
}
```

- [ ] **Step 4: 통과 확인** — `corepack pnpm test src/lib/data/metrics.test.ts` → `annualizedVolPct` PASS. (`metricAvailability`의 v1.1 테스트는 Task 4 전까지 그대로 통과한다.)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/data/metrics.ts src/lib/data/metrics.test.ts
git commit -m "feat(metrics): 연환산 변동성 계산 annualizedVolPct를 더함

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `metricPoints`의 변동성·RSI

**Files:**
- Modify: `src/lib/data/seriesMetrics.ts`
- Test: `src/lib/data/seriesMetrics.test.ts:143-146`(「v1.1 metrics give all null」 교체)

**Interfaces:**
- Consumes: `annualizedVolPct`(Task 2), `rsi(closes: number[], period: number, start = 0): (number | null)[]`(`src/lib/sim/indicators.ts`, 기존)
- Produces: `metricPoints(series, 'volatility' | 'rsi', { period })` — `series.candles`와 같은 길이·시각의 `Point[]`. 1일(`period.unit === 'D'`)이면 모두 null.

- [ ] **Step 1: 실패하는 테스트 쓰기** — `seriesMetrics.test.ts` 상단 import에 `import { rsi } from '../sim/indicators';`, `import { annualizedVolPct } from './metrics';`를 더한다. 「v1.1 metrics give all null」 테스트를 지우고 그 자리에 붙인다.

```ts
  // 1개월 일봉: 기간 앞 일봉 25개(워밍업) + 기간 봉 5개. 종가는 매일 조금씩 오르내린다.
  const M1 = { unit: 'M', n: 1 } as const;
  const dailyAt = (i: number) => day('2026-09-01') + i * 86_400_000;
  const closeAt = (i: number) => 100 + 5 * Math.sin(i / 2) + i * 0.3;
  const warm = Array.from({ length: 25 }, (_, i) => bar(dailyAt(i), closeAt(i)));
  const inPeriod = Array.from({ length: 5 }, (_, i) => bar(dailyAt(25 + i), closeAt(25 + i)));
  const monthly = (over: Partial<LoadedSeries> = {}) => series({ candles: inPeriod, daily: [...warm, ...inPeriod], ...over });
  const allCloses = [...warm, ...inPeriod].map((c) => c.c);

  it('volatility: 기간 앞 일봉을 워밍업으로 써서 기간 첫 봉부터 연환산 변동성을 낸다', () => {
    const ps = metricPoints(monthly(), 'volatility', { period: M1 });
    expect(ps.map((p) => p.t)).toEqual(inPeriod.map((c) => c.t));
    const expected = annualizedVolPct(allCloses, 20).slice(25);
    ps.forEach((p, i) => expect(p.v).toBeCloseTo(expected[i]!, 10));
  });

  it('rsi: 기존 rsi(전체 종가, 14)의 기간 구간과 같다', () => {
    const ps = metricPoints(monthly(), 'rsi', { period: M1 });
    const expected = rsi(allCloses, 14).slice(25);
    expect(ps.map((p) => p.v)).toEqual(expected);
    expect(ps.every((p) => p.v !== null && p.v >= 0 && p.v <= 100)).toBe(true);
  });

  it('volatility·rsi: 기간 봉(candles)의 마지막 종가를 쓴다(시세 반영), daily의 같은 봉은 쓰지 않는다', () => {
    const quoted = [...inPeriod.slice(0, -1), { ...inPeriod[4], c: inPeriod[4].c * 1.1 }];
    for (const metric of ['volatility', 'rsi'] as const) {
      const before = metricPoints(monthly(), metric, { period: M1 }).at(-1)!.v;
      const after = metricPoints(monthly({ candles: quoted }), metric, { period: M1 }).at(-1)!.v;
      expect(after).not.toBe(before);
    }
  });

  it('volatility·rsi: 워밍업이 모자라면 앞쪽 봉은 null, 1일이면 모두 null', () => {
    const short = series({ candles: inPeriod, daily: [...warm.slice(-3), ...inPeriod] });
    expect(metricPoints(short, 'volatility', { period: M1 }).every((p) => p.v === null)).toBe(true);
    expect(metricPoints(short, 'rsi', { period: M1 }).every((p) => p.v === null)).toBe(true);
    expect(values(metricPoints(series(), 'volatility', { period: D1 }))).toEqual([null, null, null]);
    expect(values(metricPoints(series(), 'rsi', { period: D1 }))).toEqual([null, null, null]);
  });

  it('rsi: 0 이하·유한하지 않은 종가가 나온 봉부터 null', () => {
    const bad = [...inPeriod.slice(0, 2), { ...inPeriod[2], c: Number.NaN }, ...inPeriod.slice(3)];
    const ps = metricPoints(monthly({ candles: bad }), 'rsi', { period: M1 });
    expect(ps.slice(0, 2).every((p) => p.v !== null)).toBe(true);
    expect(ps.slice(2).every((p) => p.v === null)).toBe(true);
    const zero = [...inPeriod.slice(0, 3), { ...inPeriod[3], c: 0 }, inPeriod[4]];
    expect(metricPoints(monthly({ candles: zero }), 'rsi', { period: M1 }).map((p) => p.v === null)).toEqual([false, false, false, true, true]);
  });
```

- [ ] **Step 2: 실패 확인** — `corepack pnpm test src/lib/data/seriesMetrics.test.ts` → 새 테스트 FAIL(지금은 모두 null).

- [ ] **Step 3: 구현** — `seriesMetrics.ts`.

import에 `import { rsi } from '../sim/indicators';`를 더하고 `./metrics` import 목록에 `annualizedVolPct`를 더한다. `RVOL_LOOKBACK` 아래에 붙인다.

```ts
const VOL_WINDOW = 20;
const RSI_PERIOD = 14;

/**
 * 변동성·RSI 입력: 기간 첫 봉보다 앞선 일봉 종가(워밍업) + 기간 봉 종가. 기간 봉은 candles에서 가져와
 * 리더보드 값에 시세 반영(withQuote)이 들어간다. offset은 기간 첫 봉의 위치.
 */
function closesWithWarmup(series: LoadedSeries): { closes: number[]; offset: number } {
  const first = series.candles[0]?.t ?? Number.POSITIVE_INFINITY;
  const warmup = series.daily.filter((c) => c.t < first).map((c) => c.c);
  return { closes: [...warmup, ...series.candles.map((c) => c.c)], offset: warmup.length };
}

/**
 * RSI(14). 0 이하·유한하지 않은 종가가 처음 나온 봉부터는 null. rsi()는 그런 변화를 0으로 넘겨 값을 내지만,
 * Wilder 평활은 그 영향이 뒤로 계속 남아 믿을 수 없다.
 */
function rsiFromValidCloses(closes: number[]): (number | null)[] {
  const bad = closes.findIndex((c) => !Number.isFinite(c) || c <= 0);
  const values = rsi(closes, RSI_PERIOD);
  return bad < 0 ? values : values.map((v, i) => (i >= bad ? null : v));
}

/** 워밍업을 붙여 계산한 값에서 기간 봉 몫만 점으로 낸다. 유한하지 않은 값은 null. */
function periodPoints(series: LoadedSeries, values: (number | null)[], offset: number): Point[] {
  return series.candles.map((c, i) => {
    const v = values[offset + i] ?? null;
    return { t: c.t, v: v !== null && Number.isFinite(v) ? v : null };
  });
}
```

`switch`의 `mcap` 분기 뒤, `default` 앞에 붙인다.

```ts
    case 'volatility':
    case 'rsi': {
      // 1개월 이상에서만 고를 수 있다(metricAvailability). 1일 분봉에는 일봉 워밍업을 붙일 수 없어 계산하지 않는다.
      if (opts.period.unit === 'D') return allNull(series);
      const { closes, offset } = closesWithWarmup(series);
      const values = metric === 'volatility' ? annualizedVolPct(closes, VOL_WINDOW) : rsiFromValidCloses(closes);
      return periodPoints(series, values, offset);
    }
```

- [ ] **Step 4: 통과 확인** — `corepack pnpm test src/lib/data/seriesMetrics.test.ts` → PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/data/seriesMetrics.ts src/lib/data/seriesMetrics.test.ts
git commit -m "feat(metrics): 비교 지표 점에 변동성·RSI(14) 계산을 붙임

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 레지스트리 — 두 지표 켜기와 기간 판정

**Files:**
- Modify: `src/lib/data/metricRegistry.ts`
- Modify: `src/lib/ui/compare/compareText.ts:7`(`MetricUnit` 정의 → 재내보내기)
- Test: `src/lib/data/metrics.test.ts`(「v1.1 metrics: short periods vs longer」), `src/sheets/MetricSheet.test.ts:45-52`

**Interfaces:**
- Produces: `export type MetricUnit = '%' | '%abs' | 'x' | '조' | ''`(`metricRegistry.ts`). `compareText.ts`는 `export type { MetricUnit } from '../../data/metricRegistry';`로 같은 이름을 계속 내보낸다(Leaderboard·DataTable import는 그대로 둔다). `MetricDef`에서 `v1` 필드가 사라진다.

- [ ] **Step 1: 테스트 고치기(실패하게)**

`metrics.test.ts`의 「v1.1 metrics: short periods vs longer」를 아래로 바꾼다.

```ts
  it('변동성·RSI는 1개월 이상에서 고를 수 있다', () => {
    for (const id of ['volatility', 'rsi'] as const) {
      for (const period of [{ unit: 'D', n: 1 }, { unit: 'W', n: 1 }, { unit: 'W', n: 4 }] as const) {
        expect(metricAvailability(id, { ...base, period })).toEqual({ ok: false, reason: '1개월 이상에서 볼 수 있어요' });
      }
      for (const period of [{ unit: 'M', n: 1 }, { unit: 'M', n: 3 }, { unit: 'Y', n: 1 }] as const) {
        expect(metricAvailability(id, { ...base, period })).toEqual({ ok: true });
      }
    }
  });
  it('모르는 지표는 고를 수 없다', () => {
    expect(metricAvailability('nope' as MetricId, base)).toEqual({ ok: false, reason: '곧 추가될 예정이에요' });
  });
```

같은 파일 import에 `import type { MetricId } from '../state/schema';`를 더한다. 그리고 같은 파일 `describe('METRICS registry'`의 「lists the seven metrics in order with exact copy」를 `v1` 열 없이, 변동성 단위 `'%abs'`로 바꾼다.

```ts
  it('lists the seven metrics in order with exact copy', () => {
    expect(METRICS.map((m) => [m.id, m.label, m.description, m.unit])).toEqual([
      ['change', '등락률', '기간 시작 직전 종가 대비 몇 % 올랐나', '%'],
      ['drawdown', '고점 대비 하락률', '기간 중 최고가에서 얼마나 내려왔나', '%'],
      ['excess', '시장 대비 초과수익', 'KOSPI·KOSDAQ보다 얼마나 더 올랐나', '%'],
      ['rvol', '상대 거래량', '평소(20일 평균) 대비 거래량 배수', 'x'],
      ['mcap', '시가총액', '발행주식수 × 가격 (조 원)', '조'],
      ['volatility', '변동성', '20일 수익률 표준편차(연율)', '%abs'],
      ['rsi', 'RSI(14)', '과열·침체 비교 (0–100)', ''],
    ]);
  });
```

`MetricSheet.test.ts`의 「explains why 시장 대비 초과수익 and 시가총액 are unavailable」 마지막 줄을 바꾼다.

```ts
    expect(row('변동성').getAttribute('aria-disabled')).toBeNull();
    expect(row('변동성').textContent).toContain('20일 수익률 표준편차(연율)');
```

그리고 이 describe 끝에 붙인다.

```ts
  it('1개월 이상이면 변동성·RSI(14)를 고를 수 있다', async () => {
    const { onselect, onclose } = setup({ period: { unit: 'M', n: 1 }, index: 'ok', hasShares: true });
    await fireEvent.click(row('RSI(14)'));
    expect(onselect).toHaveBeenCalledWith('rsi');
    expect(onclose).toHaveBeenCalled();
  });
```

- [ ] **Step 2: 실패 확인** — `corepack pnpm test src/lib/data/metrics.test.ts src/sheets/MetricSheet.test.ts` → FAIL(지금은 「곧 추가될 예정이에요」).

- [ ] **Step 3: 구현** — `metricRegistry.ts`.

```ts
import type { MetricId, Period, PeriodUnit } from '../state/schema';

/** '%': 부호·등락 색이 있는 변화율, '%abs': 부호 없는 퍼센트(변동성), 'x': 배수, '조': 조 원, '': 단위 없는 수(RSI) */
export type MetricUnit = '%' | '%abs' | 'x' | '조' | '';

export interface MetricDef {
  id: MetricId;
  label: string;
  description: string;
  unit: MetricUnit;
  needs: { minPeriodDays?: number; indexCandles?: boolean; shares?: boolean };
}
```

`METRICS`의 모든 항목에서 `v1: …` 줄을 지운다. 변동성 항목의 `unit: '%'`를 `unit: '%abs'`로 바꾼다(RSI는 `''` 그대로).

`metricAvailability` 위에 붙이고 함수 앞부분을 바꾼다.

```ts
/** 기간 길이(일). 1개월=30일로 보고 minPeriodDays와 비교한다. */
const PERIOD_DAYS: Record<PeriodUnit, number> = { D: 1, W: 7, M: 30, Y: 365 };

export function metricAvailability(
  id: MetricId,
  ctx: { period: Period; index: IndexAvailability; hasShares: boolean },
): MetricAvailability {
  const def = METRICS.find((m) => m.id === id);
  if (!def) return { ok: false, reason: '곧 추가될 예정이에요' };
  const min = def.needs.minPeriodDays;
  // 지금 minPeriodDays는 30(1개월)뿐이라 문구를 고정한다.
  if (min !== undefined && PERIOD_DAYS[ctx.period.unit] * ctx.period.n < min) {
    return { ok: false, reason: '1개월 이상에서 볼 수 있어요' };
  }
```

(이후 `excess`·`mcap` 분기와 `return { ok: true }`는 그대로.) `PeriodUnit`이 `../state/schema`에서 내보내지는지 확인한다(`src/lib/market/periods.ts`가 같은 곳에서 가져온다).

`compareText.ts` 7행 `export type MetricUnit = '%' | 'x' | '조' | '';`를 `export type { MetricUnit } from '../../data/metricRegistry';`로 바꾼다. 같은 파일 안에서 `MetricUnit`을 쓰므로 `import type { MetricUnit } from '../../data/metricRegistry';`도 함께 둔다.

- [ ] **Step 4: 통과·타입 확인** — `corepack pnpm test src/lib/data src/sheets/MetricSheet.test.ts` → PASS. `corepack pnpm check` → `Compare.svelte`·`ChartPanel.svelte` 등에서 `'%abs'`가 `'%' | 'x' | '조'`에 맞지 않는다는 오류가 나면 Task 5에서 고친다. 그 밖의 오류(`v1` 참조 등)는 여기서 고친다(`grep -rn "\.v1\b" src`).

- [ ] **Step 5: 커밋** — 타입 오류가 Task 5 몫만 남았으면 Task 5와 함께 커밋해도 된다. 따로 커밋한다면:

```bash
git add src/lib/data/metricRegistry.ts src/lib/data/metrics.test.ts src/lib/ui/compare/compareText.ts src/sheets/MetricSheet.test.ts
git commit -m "feat(metrics): 변동성·RSI(14)를 1개월 이상에서 고를 수 있게 켬

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 화면 표기 — 리더보드·표·차트

**Files:**
- Modify: `src/lib/ui/compare/compareText.ts:143-155`(`formatMetricValue`)
- Modify: `src/lib/chart/CompareChart.svelte:47`(`Unit` 타입), `:173-177`(`formatValue`), `:368`(기준선)
- Modify: `src/lib/chart/CompareChartFixture.svelte:11`, `src/lib/ui/compare/ChartPanel.svelte:22`(단위 prop 타입)
- Modify: `src/routes/Compare.svelte:150`
- Test: `src/lib/ui/compare/compareText.test.ts:91-98`, `src/routes/Compare.test.ts`(색 없음 테스트 근처, 1080행대)

**Interfaces:**
- Consumes: `MetricUnit`(Task 4, `src/lib/data/metricRegistry.ts`)
- Produces: `formatMetricValue(v, '%abs') === '32.10%'`, `formatMetricValue(v, '') === '62.4'`

- [ ] **Step 1: 실패하는 테스트 쓰기**

`compareText.test.ts`의 `formats by unit`에 더한다.

```ts
    expect(formatMetricValue(32.104, '%abs')).toBe('32.10%');
    expect(formatMetricValue(62.44, '')).toBe('62.4');
```

`Compare.test.ts`의 `it.each(['rvol', 'mcap'] as const)('%s 값에는 등락 색을 쓰지 않는다'` 바로 뒤(같은 describe 안, `texts`·`share`·`loaded`를 쓰는 곳)에 붙인다.

```ts
  it.each([
    ['volatility', /^\d+\.\d{2}%$/],
    ['rsi', /^\d{1,3}\.\d$/],
  ] as const)('1개월 %s 값은 부호·등락 색 없이 보인다', async (metric, pattern) => {
    const app = makeApp(EXAMPLE, { metric, period: { unit: 'M', n: 1 } });
    render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd });
    await loaded();
    expect(screen.queryByText(/대신 등락률을 보여 줘요/)).toBeNull();
    const req = await share();
    req.capture!();
    const cells = texts.slice(3, -1).filter((_, i) => i % 2 === 1);
    expect(cells.map((t) => t.text).every((t) => pattern.test(t))).toBe(true);
    expect(cells.map((t) => t.color)).toEqual(Array(4).fill('#111111'));
  });
```

이 테스트에서 값이 `—`로 나오면(테스트 공급자가 기간 앞 일봉을 주지 않음) 공급자 설정을 확인하고 원인을 고친다. 패턴을 느슨하게 바꾸지 않는다.

- [ ] **Step 2: 실패 확인** — `corepack pnpm test src/lib/ui/compare/compareText.test.ts src/routes/Compare.test.ts` → 새 테스트 FAIL.

- [ ] **Step 3: 구현**

`compareText.ts` `formatMetricValue`:

```ts
/** 리더보드 지표 값. %는 ▲▼ 기호와 함께, %abs(변동성)는 부호 없이, 단위 없는 수(RSI)는 소수 첫째 자리. */
export function formatMetricValue(v: number, unit: MetricUnit): string {
  switch (unit) {
    case '%':
      return fmtPct(v);
    case '%abs':
      return `${v.toFixed(2)}%`;
    case 'x':
      return `${v.toFixed(2)}x`;
    case '조':
      return fmtTrillion(v);
    default:
      return v.toFixed(1);
  }
}
```

`CompareChart.svelte`: 47행 `type Unit = '%' | 'x' | '조';`를 지우고 스크립트 import에 `import type { MetricUnit as Unit } from '../data/metricRegistry';`를 더한다. `formatValue`:

```ts
  function formatValue(u: Unit, v: number): string {
    if (u === '%') return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
    if (u === '%abs') return `${v.toFixed(2)}%`;
    if (u === 'x') return `${v.toFixed(2)}x`;
    if (u === '') return v.toFixed(1);
    return `${v.toFixed(Math.abs(v) < 10 ? 2 : 1)}조`;
  }
```

368–369행:

```ts
    // 단위 없는 지표는 지금 RSI(0–100)뿐이라 중립값 50을 기준선으로 둔다.
    const effectiveBaseline = baseline !== undefined ? baseline : unit === '%' ? 0 : unit === 'x' ? 1 : unit === '' ? 50 : null;
    // 첫 값 전 점선은 기준선에 둔다(% → 0, x → 1, RSI → 50, %abs·조 → 비움).
```

`CompareChartFixture.svelte` 11행과 `ChartPanel.svelte` 22행의 `'%' | 'x' | '조'`를 `MetricUnit`으로 바꾸고 각 파일에 `import type { MetricUnit } from '<상대 경로>/data/metricRegistry';`를 더한다(`src/lib/chart/` → `'../data/metricRegistry'`, `src/lib/ui/compare/` → `'../../data/metricRegistry'`).

`Compare.svelte` 150행:

```ts
  const unit = $derived(metricDef.unit);
```

(`tone = unit === '%' ? …`는 그대로 두면 `%abs`·`''`에는 색이 붙지 않는다. `Leaderboard.svelte:235`·`DataTable.svelte:55`도 같다.)

- [ ] **Step 4: 통과·타입 확인** — `corepack pnpm test` → 전체 PASS. `corepack pnpm check` → 오류 0.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/ui/compare src/lib/chart src/routes/Compare.svelte src/routes/Compare.test.ts
git commit -m "feat(metrics): 변동성은 부호 없는 %, RSI는 0–100 수로 보이고 차트 기준선을 50에 둠

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 도움말·문서·e2e

**Files:**
- Modify: `scripts/motion/help-pages.mjs:177`(3단계 부제), `:146-152`(compare `tips`)
- Generated: `src/lib/help/content.ts`, `docs/help/compare.md`, `public/help/img/compare-*.svg`(build:motion)
- Modify: `docs/roadmap.md:90`, `:110`
- Modify: `docs/superpowers/specs/2026-10-11-stock-compare-design.md:292-293`
- Test: `tests/e2e/compare.spec.ts`

- [ ] **Step 1: e2e 테스트 쓰기** — `tests/e2e/compare.spec.ts`의 첫 테스트 뒤(120행 `test('delete in detail sheet …` 앞)에 붙인다.

```ts
test('v1.1 지표: 월 기간에서 RSI(14)·변동성을 고르면 값이 보인다', async ({ page }) => {
  await openApp(page);
  await enterDemo(page);
  await loadExampleGroup(page);

  // 주 기간에서는 고를 수 없다
  await page.getByRole('radio', { name: '주', exact: true }).click();
  await page.getByRole('button', { name: /^등락률/ }).click();
  const metricSheet = page.getByRole('dialog', { name: '비교 지표' });
  await expect(metricSheet.getByRole('button', { name: /^RSI\(14\)/ })).toHaveAttribute('aria-disabled', 'true');
  await expect(metricSheet.getByRole('button', { name: /^RSI\(14\)/ })).toContainText('1개월 이상에서 볼 수 있어요');
  await page.keyboard.press('Escape');
  await expect(metricSheet).toBeHidden();

  // 월 기간에서 RSI(14)
  await page.getByRole('radio', { name: '월', exact: true }).click();
  await page.getByRole('button', { name: /^등락률/ }).click();
  await metricSheet.getByRole('button', { name: /^RSI\(14\)/ }).click();
  await expect(metricSheet).toBeHidden();
  await expect(leaderboard(page)).toContainText('RSI(14) 순');
  await expect(leaderboardRows(page).first()).toContainText(/\b\d{1,3}\.\d\b/);

  // 변동성
  await page.getByRole('button', { name: /^RSI\(14\)/ }).click();
  await metricSheet.getByRole('button', { name: /^변동성/ }).click();
  await expect(leaderboard(page)).toContainText('변동성 순');
  await expect(leaderboardRows(page).first()).toContainText(/\b\d+\.\d{2}%/);
});
```

시트를 닫는 방법(Escape)이 앱에서 다르면 첫 테스트가 쓰는 방식을 따른다. 리더보드 행 텍스트에 가격 등 다른 숫자가 있어 패턴이 우연히 맞을 수 있으면, 행 안 값 요소를 좁혀 고른다(`Leaderboard.svelte`의 값 클래스 확인).

- [ ] **Step 2: e2e 실행** — `corepack pnpm e2e tests/e2e/compare.spec.ts` → 새 테스트 PASS(Task 5까지 끝났으므로 바로 통과해야 한다. 실패하면 원인을 고친다).

- [ ] **Step 3: 도움말 원본 고치기** — `scripts/motion/help-pages.mjs`

177행:

```js
        sub: '`등락률`을 눌러 고점 대비 하락률·변동성·RSI 등으로',
```

compare 페이지 `tips` 배열에서 `'`표 보기`를 누르면 …'` 줄 바로 앞에 한 줄을 더한다.

```js
      '`변동성`·`RSI(14)`는 `1개월` 이상 기간에서 골라요. 변동성은 20거래일 수익률이 얼마나 출렁였는지를 1년 기준으로 늘린 값이고, RSI는 70 위면 과열, 30 아래면 침체로 읽어요.',
```

- [ ] **Step 4: 생성** — `corepack pnpm build:motion`. `git status`로 `src/lib/help/content.ts`, `docs/help/compare.md`, `public/help/img/compare-*.svg`(바뀌었다면)가 바뀐 것을 확인한다. 다른 도움말 그림이 대량으로 바뀌면(생성기 비결정성) 이번 변경과 무관한 파일은 되돌린다. `corepack pnpm test src/lib/help` → PASS.

- [ ] **Step 5: 문서 고치기**

`docs/roadmap.md` 90행(「v1.1 지표: 변동성·RSI(14) — 목록에 비활성으로만 있어요…」)을 지운다. 「구현 현황 요약」의 조사일 줄(「2026-10-31에 조사했어요.」)과 표의 첫 행을 아래처럼 바꾼다.

```markdown
2026-10-31에 조사했어요. v1.1 지표(변동성·RSI(14))는 2026-11-02에 켰어요.

| 묶음 | 구현 | 남은 것 |
|---|---|---|
| 최초 로드맵(2026-10-11) | 24개 중 24개 | 없음 |
```

`docs/superpowers/specs/2026-10-11-stock-compare-design.md` 6절 표의 6·7번 행 마지막 칸 `v1.1`을 `✅ (v1.1, 2026-11-02)`로 바꾸고, 표 아래 첫 글머리를 아래로 바꾼다.

```markdown
- 지표 6·7과 RVOL 일봉은 앞쪽 20일치 데이터가 더 필요하다. 이건 앱이 알아서 더 받는다(기간 시작 40일 전부터). 지표 6·7의 계산·표기는 `2026-11-02-volatility-rsi-metrics-design.md`를 따른다.
```

- [ ] **Step 6: 전체 확인** — `corepack pnpm test`, `corepack pnpm check`, `corepack pnpm check:e2e`, `corepack pnpm e2e tests/e2e/compare.spec.ts tests/e2e/help.spec.ts` → 모두 통과.

- [ ] **Step 7: 커밋**

```bash
git add scripts/motion/help-pages.mjs src/lib/help/content.ts docs/help public/help docs/roadmap.md docs/superpowers/specs/2026-10-11-stock-compare-design.md tests/e2e/compare.spec.ts
git commit -m "docs(metrics): 변동성·RSI(14) 도움말·로드맵·e2e를 맞춤

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
