# 시뮬레이션 재생 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 시뮬레이션 결과를 거래일 순서대로 다시 틀어 볼 수 있게 해요. 자산 차트가 그날까지 그려지고 체결 마커가 생기며, 재생 막대(▶/⏸·배속·타임라인)와 「그날 상황」 패널(보유·현금·신호·체결)을 결과 화면에 더해요.

**Architecture:**
- 엔진(`simulateCore`)이 옵션 `{ timeline: true }`일 때만 하루 끝 상태(`DayFrame`)를 읽기 전용으로 기록해요. 끈 경로는 바이트 단위로 지금과 같아야 해서, 엔진을 고치기 **전에** 골든 스냅샷을 먼저 커밋해요(Task 1).
- 재생 상태는 DOM 없는 컨트롤러 `createReplay`(`replay.svelte.ts`, Svelte 5 룬, 시계 주입)가 갖고, `ResultView`가 결과마다 하나 만들어 `$effect` 정리에서 없애요.
- 화면은 `EquityChart`(새 prop `upTo`·`trades`), 새 `ReplayBar`·`DayPanel`·`HoldingCard`, 공용 마커 모듈 `markers.ts`로 나눠요. 재생을 건드리지 않으면(`touched === false`) 화면은 지금과 똑같아요.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest 3(jsdom, @testing-library/svelte, axe-core 4.13.0), Playwright(e2e, @axe-core/playwright), lightweight-charts 5.2.

**근거 문서:** `docs/superpowers/specs/2026-11-01-simulation-replay-design.md`(확정 설계, 2회 검토). 절 번호(§)는 이 설계를 가리켜요.

**실행 방식:** 각 Task는 그 본문만 읽고 구현할 수 있게 썼어요(정확한 경로, 타입·함수 시그니처, 테스트 코드, 명령과 기대 결과, 커밋 메시지). 앞 Task의 산출물은 **Interfaces**의 Consumes에 이름과 시그니처를 다시 적었어요. Task는 번호 순서대로 해요.

## 계획에서 정한 것 (설계가 열어 둔 부분)

1. **골든 입력의 위치:** 골든·timeline·성능 테스트가 같은 대표 입력을 쓰도록 테스트 전용 모듈 `src/lib/sim/testInputs.ts`(기존 `testBars.ts`와 같은 성격)에 둬요. 대표 입력 (가)는 1·2단계 익절 뒤 본전 손절로 끝나요(3단계 설정은 있지만 3단계까지 가지 않아요. 본전 손절을 보이려면 그 앞에서 끝나야 해서예요).
2. **움직임 조건:** 설계 §4.5는 「index가 1만큼 바뀌었을 때만(재생 1·2배, step)」이에요. 60fps에서는 4·8·16배도 프레임마다 보통 1씩 바뀌므로 괄호 안 조건까지 지켜 `|delta| === 1 && (멈춤 || 배속 ≤ 2) && 움직임 줄이기 아님`으로 정해요. 이를 위해 컨트롤러에 읽기 전용 `delta`(마지막으로 index가 바뀐 양)와 `length`를 더해요. 판정은 순수 함수 `replayMotion()`이에요.
3. **「그날 상황 보기」:** 컨트롤러에 따로 메서드를 두지 않고 `replay.seek(replay.index)`로 touched를 켜요(움직이지 않으니 delta 0, 효과 없음).
4. **배치:** 재생 막대와 패널은 자산 차트 바로 아래, 「비교 기준」 목록 위에 둬요(설계 §4.1 그림에 비교 기준 목록이 없어서 「자산 차트 자리」에 붙였어요).
5. **차트 마커 입력:** 설계 §4.3의 「`upTo` 날짜까지의 체결」을 그리려면 체결 목록이 필요해서 `EquityChart`에 `trades?: Trade[]` prop을 더해요(없으면 빈 배열).
6. **가격 막대 라벨:** 눈금 라벨을 막대 위에 겹쳐 그리면 좁은 화면에서 서로 겹쳐요. 막대(눈금·점)는 `aria-hidden`으로 두고, 바로 아래에 「라벨 가격」 목록(`가격 눈금`)을 글로 둬요. 익절 눈금이 단계 1 하나뿐이면 라벨은 `익절`, 아니면 `익절 N`이에요.
7. **건너뜀 사유별 표시:** `현금이 모자랐어요 · SK하이닉스, 삼성전자`처럼 사유 문구(`skipReasonLabel`) 뒤에 종목 이름을 모아요.
8. **사유 문구 함수 이름:** `TradeList`의 지역 `why`를 `simText.ts`의 `tradeWhy(t: Trade)`로 옮겨요.
9. **움직임 줄이기 감지:** `svelte/motion`의 `prefersReducedMotion`은 모듈을 불러오는 순간 `window.matchMedia`를 불러 jsdom 테스트가 깨져요. 기존 화면(`Simulate.svelte`)처럼 `typeof matchMedia === 'function' ? new MediaQuery('(prefers-reduced-motion: reduce)') : null`로 감싸요.
10. **e2e 기대값:** 설계 §6.4의 「첫 거래일에는 예약이 있을 수 없어요」는 엔진상 틀려요(첫날 종가 신호는 가능). e2e는 「보유한 종목이 없어요」만 확인하고 예약 유무는 단언하지 않아요.
11. **성능 단언:** 워밍업 1회 뒤 끔/켬을 번갈아 7번씩 재고 중앙값끼리 비교해요(켬 ≤ 끔 × 2). 절대 시간은 `console.info`로만 남겨요.
12. **기존 공유 버튼 테스트:** 핸들러가 `await tick()` 뒤 `onShare`를 부르므로 `ResultView.test.ts`의 「onShare가 있으면 머리줄에 결과 공유 단추」 단언을 `vi.waitFor`로 감싸요.
13. **설계에 없는 화면 문구(이것만 써요):** 재생 막대 그룹 `재생`, 배속 묶음 `배속`, 패널 `그날 상황`, 머리 목록 `그날 자산`·`총자산`·`현금`·`그날까지 수익률`, 목록 이름 `보유 종목`·`예약 매수`·`그날 체결`·`그날 건너뜀`·`가격 눈금`, 보유 카드 항목 `수량`·`평단`·`종가`·`평가액`·`보유 시작`, 눈금 라벨 `손절`·`다음 추가`·`평단`·`익절`/`익절 N`.

## Global Constraints

**범위(설계 §1.2, §2.2)**
- `Strategy` 타입·저장소·동기화 문서·공유 스냅샷 형식은 바꾸지 않아요. `src/lib/sync/`·`src/lib/share/` 파일은 고치지 않아요.
- 엔진의 체결·현금·신호 계산 순서와 값은 바꾸지 않아요. 기록은 읽기만 해요.
- 기록은 옵션이에요: `simulateCore(input, { timeline: true })`, `simulate(input, { timeline: true })`. 기본은 꺼짐이라 선정 기준 검증(`runValidation.ts`, worker)은 지금과 같아요. 결과 화면 실행(`runController.svelte.ts`)만 켜요.
- 옵션을 끄면 `timeline` 키를 아예 넣지 않아요(`toStrictEqual`이 `undefined` 키를 구분하므로).
- 가격은 반올림하지 않아요. 표시할 때 `simText`·`format`의 포맷터로 다듬어요.
- `expandSimResult`(공유 복원)는 `timeline`을 만들지 않아요. 공유 화면(`readonly`, `timeline` 없음)에는 재생 막대를 보이지 않아요.
- 웹 워커로 옮기지 않아요. `curves` 모드(선정 기준 검증)에는 `upTo`를 쓰지 않아요.
- 새 의존성은 없어요.

**재생 규칙(설계 §1.1, §3, §4)**
- 배속: 1배 = 초당 1거래일, `1 | 2 | 4 | 8 | 16`.
- 처음 index = length−1(마지막 날 = 지금 결과 화면과 같음). 마지막 날에서 play하면 0으로 돌아가 시작해요. 마지막 날에 닿으면 멈춰요.
- 프레임당 경과 시간은 최대 1초로 잘라요.
- 차트에 넘기는 `upTo`는 `touched`일 때만 `index`, 아니면 `undefined`예요.
- 재생 막대·패널은 `timeline`이 있음, 길이가 `equity`와 같음, 거래일 2일 이상, 거래가 1건 이상일 때만 보여요. 길이가 다르면 숨기고 `console.error`를 남겨요.
- 「결과 공유」 핸들러는 `async () => { replay?.reset(); await tick(); onShare?.(); }`예요. `capture()`는 그대로 둬요.
- 움직임: 새 체결 줄·새 보유 카드 150ms `transition:fly`, 가격 막대 점 150ms CSS `transition: left`. `prefers-reduced-motion: reduce`면 끄고 값만 바꿔요.

**문구(설계 그대로)**
- 버튼 `aria-label` 「재생」/「일시정지」, 배속 `1×`·`2×`·`4×`·`8×`·`16×`, range `aria-label="거래일"`.
- 날짜 줄: `2024.03.15(금) · 120/245거래일`.
- 「일봉 기준이라 하루 단위로 움직여요」, 「그날 상황 보기」, 「다음 거래일 기준」, 「손절: 분할 매수 끝나면 정해져요」, 「다음 거래일 시가에 사요: 삼성전자 — <신호 이유>」, 「보유한 종목이 없어요」.
- 그 밖의 문구는 위 「계획에서 정한 것」 13번만 써요. 해요체예요.

**검증 명령** (워크트리 루트에서)
- `corepack pnpm test <파일>`: 한 파일만(스크립트가 `TZ=America/New_York vitest run`이라 TZ가 맞춰져요). 전체는 `corepack pnpm test`.
- `corepack pnpm check`: 오류 0.
- `corepack pnpm check:e2e`: 오류 0(e2e 파일을 고친 Task 7에서).
- `corepack pnpm e2e tests/e2e/simulate.spec.ts tests/e2e/a11y.spec.ts`: Task 7에서(빌드 포함이라 몇 분 걸려요).
- 골든 스냅샷은 Task 1에서만 쓰고, 그 뒤에는 **절대 `-u`로 갱신하지 않아요**. 스냅샷이 깨지면 엔진 변경이 잘못된 거예요.

**커밋**
- 한국어 conventional 메시지 + 빈 줄 + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. 각 Task의 커밋 명령은 `-m` 두 개로 이 형식을 만들어요. 푸시하지 않아요.

---

## File Structure

| 파일 | 책임 | Task |
|---|---|---|
| `src/lib/sim/testInputs.ts` (새, 테스트 전용) | 대표 입력 3개·봉 도우미·무작위 일봉 | 1 |
| `src/lib/sim/simulate.golden.test.ts` (새) + `__snapshots__/simulate.golden.test.ts.snap` | 엔진 변경 전 결과 고정, 옵션 불변식 | 1, 2 |
| `src/lib/sim/types.ts` | `HoldingFrame`·`DayFrame`, `SimResult.timeline?` | 2 |
| `src/lib/sim/simulate.ts` | `SimOptions`, 하루 끝 기록 `dayFrame`, `CoreResult.timeline?` | 2 |
| `src/lib/sim/simulate.timeline.test.ts`·`simulate.perf.test.ts` (새) | timeline 단위·성능 | 2 |
| `src/lib/ui/simulate/runController.svelte.ts` (+ test) | `simulate(input, { timeline: true })` | 2 |
| `src/lib/ui/simulate/replay.svelte.ts` (+ `replay.test.ts`) (새) | 재생 컨트롤러·`replayMotion` | 3 |
| `src/lib/ui/simulate/markers.ts` (+ `markers.test.ts`) (새) | 체결 마커 묶기·색·라벨 공용 | 4 |
| `src/lib/ui/simulate/TradeChartSheet.svelte` | `markers.ts` 사용(동작 그대로) | 4 |
| `src/lib/ui/simulate/EquityChart.svelte` (+ test) | `upTo`·`trades`, whitespace·세로축 고정·범례·마커·되돌리기 | 4 |
| `src/lib/ui/simulate/simText.ts` (+ test) | `tradeWhy`·`replayDate`·`priceMarks`·패널 문구 | 5 |
| `src/lib/ui/simulate/TradeList.svelte` | `tradeWhy` 사용 | 5 |
| `src/lib/ui/simulate/HoldingCard.svelte`·`DayPanel.svelte` (+ `DayPanel.test.ts`) (새) | 그날 상황 패널 | 5 |
| `src/lib/ui/simulate/ReplayBar.svelte` (+ test) (새) | 재생 막대 | 6 |
| `src/lib/ui/simulate/ResultView.svelte` (+ test), `resultFixture.ts` | 컨트롤러 생명주기·배치·공유 전 reset | 7 |
| `tests/e2e/simulate.spec.ts`·`a11y.spec.ts` | 재생 흐름·axe | 7 |

---

### Task 1: 골든 스냅샷 (엔진 변경 전)

엔진을 한 줄도 고치지 않은 상태에서 대표 입력 3개의 `simulate()` 결과 전체를 스냅샷으로 고정해요(설계 §2.3-1). 이 Task는 특성(characterization) 테스트라 「실패하는 테스트」 단계가 없어요. 처음 실행이 스냅샷을 쓰고, 두 번째 실행이 같은 값을 확인해요.

**Files:**
- Create: `src/lib/sim/testInputs.ts`
- Create: `src/lib/sim/simulate.golden.test.ts`
- Create(자동 생성): `src/lib/sim/__snapshots__/simulate.golden.test.ts.snap`

**Interfaces:**
- Consumes(기존): `simulate(input: SimInput): SimResult`(`src/lib/sim/simulate.ts`), `newStrategy(now: number, groupId: string | null, name?: string): Strategy`(`src/lib/sim/defaults.ts`), `bar(date, o, h, l, c): Candle`·`tradingDates(start: string, n: number): string[]`(`src/lib/sim/testBars.ts`).
- Produces(`src/lib/sim/testInputs.ts`, 뒤 Task가 씀):
  - `type Ohlc = [number, number, number, number]`
  - `const D: string[]` — 2026-01-05부터 평일 40일. `D[9] === '2026-01-16'`
  - `const BASE: number[]` — 인덱스 8 종가에서 '3일 연속 상승' 신호
  - `candlesFrom(closes: number[], rest?: Ohlc[], skip?: number[]): Candle[]`
  - `flat(xs: number[]): Ohlc[]`
  - `baseStrategy(over?: (s: Strategy) => void): Strategy` — 자금 1,000만·회당 10%·수수료 0.015%·돌파 끔·손절 5% 매번 평단
  - `stockOf(k: number, candles: Candle[]): SimInput['stocks'][number]` — `S{k}`/`종목{k}`/KOSPI
  - `goldenInputs: { '분할 매수 + 3단계 익절 + 본전 손절': () => SimInput; '갭 손절 + 현금 부족 + 봉 없는 날': () => SimInput; '선정 기간 + 지수·지정 종목': () => SimInput }`
  - `rng(seed: number): () => number`, `randomWalk(dates: string[], seed: number, start?: number): Candle[]`

- [ ] **Step 1: 대표 입력 모듈을 만든다**

`src/lib/sim/testInputs.ts`:

```ts
// 테스트 전용: 엔진 골든·timeline·성능 테스트가 같이 쓰는 대표 입력과 봉 생성 도우미.
import type { Candle } from '../data/metrics';
import { newStrategy } from './defaults';
import { bar, tradingDates } from './testBars';
import type { SimInput, Strategy } from './types';

/** [시가, 고가, 저가, 종가] */
export type Ohlc = [number, number, number, number];

/** 2026-01-05부터 평일 40일. D[9] = 2026-01-16 */
export const D = tradingDates('2026-01-05', 40);
/** 인덱스 8 종가에서 '3일 연속 상승' 신호(A=100, L=80) → 인덱스 9 시가 매수 */
export const BASE = [90, 100, 92, 95, 88, 80, 82, 84, 86];

/** 앞부분은 o=h=l=c 종가, 뒤는 [o,h,l,c] 봉. skip 인덱스는 봉을 뺀다(거래 정지일) */
export function candlesFrom(closes: number[], rest: Ohlc[] = [], skip: number[] = []): Candle[] {
  const all: Ohlc[] = [...closes.map((c): Ohlc => [c, c, c, c]), ...rest];
  return all.flatMap(([o, h, l, c], i) => (skip.includes(i) ? [] : [bar(D[i], o, h, l, c)]));
}

export const flat = (xs: number[]): Ohlc[] => xs.map((c): Ohlc => [c, c, c, c]);

/** 자금 1,000만 원, 회당 10%, 수수료 0.015%, 돌파 끔, 손절 5% 매번 평단 */
export function baseStrategy(over: (s: Strategy) => void = () => {}): Strategy {
  const s = newStrategy(0, null);
  s.capital = { initial: 10_000_000, perBuyPct: 10 };
  s.costs.feePct = 0.015;
  s.entry.triggers.breakout.on = false;
  s.exit.stopLoss = { pct: 5, basis: 'avgAlways' };
  over(s);
  return s;
}

export function stockOf(k: number, candles: Candle[]): SimInput['stocks'][number] {
  return { symbol: `S${k}`, name: `종목${k}`, market: 'KOSPI', isEtf: false, candles };
}

/** 엔진 동일성을 고정하는 대표 입력(설계 §2.3). 부를 때마다 새 객체를 만든다 */
export const goldenInputs = {
  /** (가) 분할 매수 2번 → 1·2단계 익절 → 본전 손절 */
  '분할 매수 + 3단계 익절 + 본전 손절': (): SimInput => {
    const strategy = baseStrategy((x) => {
      x.scaleIn = { on: true, stepPct: 3, maxAdds: 2 };
      x.exit.stopLoss = { pct: 5, basis: 'avgAfterScaleIn' };
      x.exit.takeProfit = [{ pct: 5, sellPct: 30 }, { pct: 10, sellPct: 30 }, { pct: 15, sellPct: 100 }];
      x.exit.afterFirstTake = 'breakeven';
    });
    const rest: Ohlc[] = [[100, 100, 96, 97], [97, 98, 94, 95], [95, 103, 95, 102], [102, 108, 101, 107], [107, 110, 96, 98], ...flat([98, 99])];
    return { strategy, days: D.slice(0, 16), stocks: [stockOf(0, candlesFrom(BASE, rest))], index: null, benchmarkStock: null };
  },
  /** (나) 회당 60%: S0 매수 → 거래 정지 2일(인덱스 11·12) → 갭 손절, S1은 현금 부족으로 계속 건너뜀 */
  '갭 손절 + 현금 부족 + 봉 없는 날': (): SimInput => {
    const strategy = baseStrategy((x) => (x.capital.perBuyPct = 60));
    const s0 = candlesFrom(BASE, [[87, 88, 86, 87], [88, 89, 87, 88], [0, 0, 0, 0], [0, 0, 0, 0], [80, 81, 79, 80], [80, 80, 80, 80]], [11, 12]);
    const s1 = candlesFrom(BASE, [[87, 88, 86, 87], [88, 89, 87, 88], [89, 90, 88, 89], [90, 91, 89, 90], ...flat([90, 90])]);
    return { strategy, days: D.slice(0, 15), stocks: [stockOf(0, s0), stockOf(1, s1)], index: null, benchmarkStock: null };
  },
  /** (다) S0은 선정 기간 밖이라 건너뛰고 S1만 사서 익절. 지수·지정 종목 곡선 포함 */
  '선정 기간 + 지수·지정 종목': (): SimInput => {
    const strategy = baseStrategy((x) => (x.exit.takeProfit = [{ pct: 5, sellPct: 100 }]));
    const rest: Ohlc[] = [[87, 88, 86, 87], [88, 95, 88, 94], ...flat([94, 95])];
    const days = D.slice(0, 13);
    const s0 = { ...stockOf(0, candlesFrom(BASE, rest)), buyWindows: [{ from: D[0], to: D[8] }] };
    const s1Candles = candlesFrom(BASE, rest);
    const s1 = { ...stockOf(1, s1Candles), buyWindows: [{ from: D[9], to: D[20] }] };
    return {
      strategy,
      days,
      stocks: [s0, s1],
      index: { id: 'KOSPI', candles: days.map((dt, i) => bar(dt, 1000, 1000, 1000, 1000 + i * 10)) },
      benchmarkStock: { symbol: 'B', name: '지정', isEtf: true, market: 'KOSPI', candles: s1Candles },
    };
  },
} satisfies Record<string, () => SimInput>;

/** 시드 고정 난수(mulberry32) */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 날짜마다 무작위 일봉(하루 ±4% 안팎) */
export function randomWalk(dates: string[], seed: number, start = 10_000): Candle[] {
  const r = rng(seed);
  let p = start;
  return dates.map((dt) => {
    const o = p * (1 + (r() - 0.5) * 0.04);
    const c = o * (1 + (r() - 0.5) * 0.08);
    const h = Math.max(o, c) * (1 + r() * 0.02);
    const l = Math.min(o, c) * (1 - r() * 0.02);
    p = c;
    return bar(dt, o, h, l, c);
  });
}
```

- [ ] **Step 2: 골든 테스트를 쓴다**

`src/lib/sim/simulate.golden.test.ts`:

```ts
// 엔진 동일성 고정(설계 §2.3). 스냅샷은 엔진을 고치기 전에 썼다. 깨지면 엔진 변경이 결과를 바꾼 것이니 -u로 갱신하지 않는다.
import { describe, expect, it } from 'vitest';
import { simulate } from './simulate';
import { goldenInputs } from './testInputs';

const A = '분할 매수 + 3단계 익절 + 본전 손절';
const B = '갭 손절 + 현금 부족 + 봉 없는 날';
const C = '선정 기간 + 지수·지정 종목';

describe('simulate 골든', () => {
  it.each(Object.entries(goldenInputs))('%s: 결과 전체가 스냅샷과 같다', (_name, make) => {
    expect(simulate(make())).toMatchSnapshot();
  });

  it('대표 입력이 고정하려는 경로를 실제로 지난다', () => {
    const a = simulate(goldenInputs[A]());
    expect(a.trades.map((t) => `${t.kind}${t.stage ?? ''}`)).toEqual(['buy', 'add', 'add', 'take1', 'take2', 'stop']);

    const b = simulate(goldenInputs[B]());
    expect(b.trades.map((t) => `${t.symbol}:${t.kind}`)).toEqual(['S0:buy', 'S0:gapStop']);
    expect(b.skipped.length).toBeGreaterThan(0);
    expect(b.skipped.every((k) => k.symbol === 'S1' && k.reason === '현금 부족')).toBe(true);

    const c = simulate(goldenInputs[C]());
    expect(c.trades.map((t) => `${t.symbol}:${t.kind}`)).toEqual(['S1:buy', 'S1:take']);
    expect(c.skipped.some((k) => k.symbol === 'S0' && k.reason === '선정 기간이 아니에요')).toBe(true);
    expect(c.equity.every((e) => e.index !== null && e.benchmark !== null)).toBe(true);
  });
});
```

- [ ] **Step 3: 실행해 스냅샷을 쓴다**

Run: `corepack pnpm test src/lib/sim/simulate.golden.test.ts`
Expected: PASS, `Tests 4 passed`, 출력에 `Snapshots 3 written`. `src/lib/sim/__snapshots__/simulate.golden.test.ts.snap`이 생겨요. (`CI` 환경 변수가 켜져 있으면 vitest가 새 스냅샷을 쓰지 않으니 끄고 돌려요.)

- [ ] **Step 4: 다시 실행해 스냅샷과 같은지 확인한다**

Run: `corepack pnpm test src/lib/sim/simulate.golden.test.ts`
Expected: PASS, `Tests 4 passed`, `Snapshots 3 passed`(written 없음).

- [ ] **Step 5: 엔진 파일이 그대로인지 확인한다**

Run: `git status --short src/lib/sim`
Expected: `?? src/lib/sim/__snapshots__/`, `?? src/lib/sim/simulate.golden.test.ts`, `?? src/lib/sim/testInputs.ts`만 보여요. `simulate.ts`·`types.ts`는 바뀌지 않았어요.

- [ ] **Step 6: 타입 검사**

Run: `corepack pnpm check`
Expected: `0 errors`(두 번 모두).

- [ ] **Step 7: 커밋**

```bash
git add src/lib/sim/testInputs.ts src/lib/sim/simulate.golden.test.ts src/lib/sim/__snapshots__/simulate.golden.test.ts.snap
git commit -m "test(sim): 엔진 변경 전 대표 입력 3개의 결과를 골든 스냅샷으로 고정함" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 엔진 일별 기록(timeline 옵션)

`simulateCore`·`simulate`에 옵션 `{ timeline: true }`를 더해 하루 끝(`equity.push` 직후) 상태를 `DayFrame`으로 기록해요(설계 §2). 끈 경로는 골든 스냅샷이 지키고, 켠 경로의 나머지 결과가 끈 결과와 같은지 불변식으로 확인해요. 결과 화면 실행만 옵션을 켜요.

**Files:**
- Modify: `src/lib/sim/types.ts`(끝에 타입 추가, `SimResult`에 필드 추가)
- Modify: `src/lib/sim/simulate.ts:9-18`(import·`CoreResult`), `:135-147`(SymState 뒤 `dayFrame`, 시그니처), `:153-157`(기록 배열), `:260`(push), `:287`(return), `:290-291`·`:329`(`simulate`)
- Modify: `src/lib/ui/simulate/runController.svelte.ts:73`
- Modify: `src/lib/sim/simulate.golden.test.ts`(불변식 추가)
- Create: `src/lib/sim/simulate.timeline.test.ts`
- Create: `src/lib/sim/simulate.perf.test.ts`
- Modify: `src/lib/ui/simulate/runController.test.ts`(테스트 하나 추가)

**Interfaces:**
- Consumes: Task 1의 `goldenInputs`, `D`, `BASE`, `candlesFrom`, `baseStrategy`, `stockOf`, `randomWalk`(`src/lib/sim/testInputs.ts`). 기존 `openPosition(price, qty, scaleIn, exit): Position`(`position.ts`, `stopPrice()`·`nextAddPrice()`·`takeLevels()`·`buy()`·`sell(qty, stage?)`), `roundMoney(n: number): number`(`money.ts`), `tradingDates`(`testBars.ts`).
- Produces:
  - `src/lib/sim/types.ts`: `interface HoldingFrame { symbol; qty; avgPrice; close; value; pnlPct; stop: number | null; nextAdd: number | null; takes: { stage: number; price: number }[]; openDate: string }`, `interface DayFrame { date; cash; value; holdings: HoldingFrame[]; pending: { symbol: string; reason: string }[] }`, `SimResult.timeline?: DayFrame[]`
  - `src/lib/sim/simulate.ts`: `interface SimOptions { timeline?: boolean }`, `simulateCore(input: SimInput, opts?: SimOptions): CoreResult`(`CoreResult.timeline?: DayFrame[]`), `simulate(input: SimInput, opts?: SimOptions): SimResult`
  - 결과 화면 실행 결과(`DoneState.result`)에는 늘 `timeline`이 있어요(길이 = `equity.length`).

- [ ] **Step 1: 불변식을 골든 파일에 더한다**

`src/lib/sim/simulate.golden.test.ts`의 import 줄을 바꿔요:

```ts
import { simulate, simulateCore } from './simulate';
```

파일 끝에 더해요:

```ts
describe('timeline 옵션 불변식(설계 §2.3-2)', () => {
  it.each(Object.entries(goldenInputs))('%s: timeline을 켜도 나머지 결과는 끈 결과와 같다', (_name, make) => {
    const { timeline, ...rest } = simulate(make(), { timeline: true });
    expect(rest).toStrictEqual(simulate(make()));
    expect(timeline).toHaveLength(rest.equity.length);
  });

  it('옵션을 끄면 timeline 키 자체가 없다', () => {
    const make = goldenInputs[A];
    expect('timeline' in simulate(make())).toBe(false);
    expect('timeline' in simulate(make(), {})).toBe(false);
    expect('timeline' in simulateCore(make())).toBe(false);
    expect(simulateCore(make(), { timeline: true }).timeline).toHaveLength(make().days.length);
  });
});
```

- [ ] **Step 2: timeline 단위 테스트를 쓴다**

`src/lib/sim/simulate.timeline.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { roundMoney } from './money';
import { openPosition } from './position';
import { simulate } from './simulate';
import { BASE, baseStrategy, candlesFrom, D, goldenInputs, stockOf } from './testInputs';
import type { DayFrame, SimInput, SimResult } from './types';

const A = '분할 매수 + 3단계 익절 + 본전 손절';
const B = '갭 손절 + 현금 부족 + 봉 없는 날';

const run = (i: SimInput) => simulate(i, { timeline: true }) as SimResult & { timeline: DayFrame[] };
const takesOf = (levels: { stage: number; price: number; qty: number }[]) => levels.filter((t) => t.qty > 0).map(({ stage, price }) => ({ stage, price }));

describe('timeline', () => {
  it.each(Object.entries(goldenInputs))('%s: 날짜·현금·평가액이 equity와 같고, 평가액 = 현금 + 보유 평가액', (_name, make) => {
    const r = run(make());
    expect(r.timeline.map((f) => [f.date, f.cash, f.value])).toEqual(r.equity.map((e) => [e.date, e.cash, e.strategy]));
    for (const f of r.timeline) {
      const held = f.holdings.reduce((a, h) => roundMoney(a + h.value), 0);
      expect(f.value, f.date).toBe(roundMoney(f.cash + held));
    }
  });

  it('매수일 프레임부터 holdings에 있고 전량 매도일 프레임에서 빠진다', () => {
    const r = run(goldenInputs[A]());
    const held = r.timeline.map((f) => f.holdings.map((h) => h.symbol).join());
    // D[9] 매수 → D[13] 본전 손절
    expect(held.slice(8, 15)).toEqual(['', 'S0', 'S0', 'S0', 'S0', '', '']);
    expect(r.timeline.flatMap((f) => f.holdings).every((h) => h.openDate === D[9])).toBe(true);
  });

  it('같은 날 사고 전량 판 종목은 holdings에 없고 그날 체결에만 있다', () => {
    const i: SimInput = { strategy: baseStrategy(), days: D.slice(0, 10), stocks: [stockOf(0, candlesFrom(BASE, [[87, 87, 82, 83]]))], index: null, benchmarkStock: null };
    const r = run(i);
    expect(r.trades.map((t) => `${t.date}:${t.kind}`)).toEqual([`${D[9]}:buy`, `${D[9]}:stop`]);
    expect(r.timeline[9].holdings).toEqual([]);
  });

  it('손절·다음 추가·익절 가격은 같은 시점의 Position 계산과 같다(분할 매수 중 손절 null, 본전 손절 뒤 평단 이상)', () => {
    const input = goldenInputs[A]();
    const s = input.strategy;
    const r = run(input);
    const [buy, add1, add2, take1] = r.trades;
    const at = (i: number) => r.timeline[i].holdings[0];

    // D[9]: 매수 + 추가 1번(아직 분할 매수 중)
    const p = openPosition(buy.price, buy.qty, s.scaleIn, s.exit);
    p.buy(add1.price, add1.qty);
    expect(at(9)).toMatchObject({ qty: p.qty, avgPrice: p.avgPrice, stop: null, nextAdd: p.nextAddPrice(), takes: takesOf(p.takeLevels()), close: 97 });
    expect(at(9).value).toBe(roundMoney(p.qty * 97));
    expect(at(9).pnlPct).toBeCloseTo((97 / p.avgPrice - 1) * 100, 10);

    // D[10]: 추가 2번째로 분할 매수 끝 → 손절가가 생기고 다음 추가는 없다
    expect(add2.date).toBe(D[10]);
    p.buy(add2.price, add2.qty);
    expect(at(10)).toMatchObject({ stop: p.stopPrice(), nextAdd: null, takes: takesOf(p.takeLevels()), close: 95 });
    expect(at(10).stop).not.toBeNull();

    // D[11]: 1단계 익절 뒤 본전 손절(평단 이상), 남은 익절은 2·3단계
    expect(take1.date).toBe(D[11]);
    p.sell(take1.qty, 1);
    expect(at(11)).toMatchObject({ qty: p.qty, stop: p.stopPrice(), takes: takesOf(p.takeLevels()) });
    expect(at(11).stop!).toBeGreaterThanOrEqual(at(11).avgPrice);
    expect(at(11).takes.map((t) => t.stage)).toEqual([2, 3]);
  });

  it('봉 없는 날 종가는 마지막 종가다', () => {
    const r = run(goldenInputs[B]());
    const buy = r.trades[0];
    // S0은 인덱스 11·12에 봉이 없다 → 인덱스 10 종가 88
    for (const i of [11, 12]) {
      const h = r.timeline[i].holdings.find((x) => x.symbol === 'S0')!;
      expect(h.close, D[i]).toBe(88);
      expect(h.value).toBe(roundMoney(buy.qty * 88));
      expect(h.pnlPct).toBeCloseTo((88 / h.avgPrice - 1) * 100, 10);
    }
    expect(r.timeline[13].holdings).toEqual([]); // 갭 손절
  });

  it.each(Object.entries(goldenInputs))('%s: 예약은 신호 난 날에만 있고 다음 거래일 매수나 건너뜀으로 이어진다', (_name, make) => {
    const r = run(make());
    r.timeline.forEach((f, i) => {
      for (const p of f.pending) {
        const next = r.timeline[i + 1];
        expect(next, `${f.date} ${p.symbol}: 마지막 날에는 예약이 없다`).toBeDefined();
        const bought = r.trades.some((t) => t.date === next.date && t.symbol === p.symbol && t.kind === 'buy' && t.reason === p.reason);
        const skipped = r.skipped.some((k) => k.date === next.date && k.symbol === p.symbol);
        expect(bought || skipped, `${f.date} ${p.symbol}`).toBe(true);
      }
    });
    // 모든 매수는 전날 예약에서 왔다
    for (const t of r.trades.filter((x) => x.kind === 'buy')) {
      const i = r.timeline.findIndex((f) => f.date === t.date);
      expect(r.timeline[i - 1].pending).toContainEqual({ symbol: t.symbol, reason: t.reason });
    }
    expect(r.timeline.at(-1)!.pending).toEqual([]);
  });
});
```

- [ ] **Step 3: 성능 테스트를 쓴다**

`src/lib/sim/simulate.perf.test.ts`:

```ts
// 설계 §6.3: 10년·8종목에서 timeline을 켜도 계산 시간이 끈 때의 2배 이하. 절대 시간은 로그로만 남긴다.
import { expect, it } from 'vitest';
import { simulate, type SimOptions } from './simulate';
import { tradingDates } from './testBars';
import { baseStrategy, randomWalk, stockOf } from './testInputs';
import type { SimInput } from './types';

it('10년(2,450거래일)·8종목: timeline 켬 시간이 끔의 2배 이하', () => {
  const WARM = 60;
  const all = tradingDates('2015-01-05', WARM + 2450);
  const days = all.slice(WARM);
  const strategy = baseStrategy((x) => {
    x.scaleIn = { on: true, stepPct: 3, maxAdds: 2 };
    x.exit.takeProfit = [{ pct: 5, sellPct: 50 }, { pct: 10, sellPct: 100 }];
    x.exit.afterFirstTake = 'breakeven';
    x.entry.decline.dropPct.value = 5;
    x.capital.perBuyPct = 12;
  });
  const input: SimInput = { strategy, days, stocks: Array.from({ length: 8 }, (_, k) => stockOf(k, randomWalk(all, 101 * (k + 1)))), index: null, benchmarkStock: null };

  const time = (opts?: SimOptions) => {
    const t0 = performance.now();
    simulate(input, opts);
    return performance.now() - t0;
  };
  // 워밍업(JIT)
  expect(simulate(input).trades.length).toBeGreaterThan(100);
  simulate(input, { timeline: true });

  const off: number[] = [];
  const on: number[] = [];
  for (let k = 0; k < 7; k++) {
    off.push(time());
    on.push(time({ timeline: true }));
  }
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  console.info(`simulate 10년·8종목: timeline 끔 ${median(off).toFixed(1)}ms, 켬 ${median(on).toFixed(1)}ms`);
  expect(median(on)).toBeLessThanOrEqual(median(off) * 2);
}, 60_000);
```

- [ ] **Step 4: runController 테스트를 더한다**

`src/lib/ui/simulate/runController.test.ts`의 `describe('runController', () => {` 블록 안 첫 `it` 앞에 더해요:

```ts
  it('결과 화면 실행은 일별 기록(timeline)을 켠다', async () => {
    const ctl = ctlFor(fakeApp(provider()));
    ctl.run(strat());
    await settled(ctl);
    const st = ctl.state;
    if (st.kind !== 'done') throw new Error(st.kind);
    expect(simulate).toHaveBeenCalledWith(expect.anything(), { timeline: true });
    expect(st.result.timeline).toHaveLength(st.result.equity.length);
  });
```

- [ ] **Step 5: 실패를 확인한다**

Run: `corepack pnpm test src/lib/sim/simulate.golden.test.ts src/lib/sim/simulate.timeline.test.ts src/lib/sim/simulate.perf.test.ts src/lib/ui/simulate/runController.test.ts`
Expected: FAIL. 골든 스냅샷 3개는 통과하고, 불변식(`timeline` undefined → `toHaveLength` 실패), timeline 테스트(`r.timeline` undefined), 성능(`timeline` 없이도 시간은 재지만 앞 테스트가 실패), runController(`toHaveBeenCalledWith` 불일치)가 실패해요.

- [ ] **Step 6: 타입을 더한다**

`src/lib/sim/types.ts`의 `SimResult` 마지막 필드(`nearMiss`) 뒤에 더해요:

```ts
  nearMiss: { maxDropPct: number; declineDays: number } | null; // 거래가 하나도 없을 때만
  /** 재생용 일별 상태. equity와 같은 길이·같은 날짜. 옵션을 켠 실행에만 있고, 공유에서 복원한 결과에는 없음 */
  timeline?: DayFrame[];
}
```

(기존 `nearMiss` 줄과 닫는 `}`를 위처럼 바꿔요.) 파일 끝에 더해요:

```ts
/** 그날 종가 처리를 마친 뒤 보유 한 종목의 상태(재생 패널). 손절·추가·익절 가격은 다음 거래일 장중 경로에 쓰이는 값 */
export interface HoldingFrame {
  symbol: string;
  qty: number;
  avgPrice: number; // Position.avgPrice
  close: number; // 그날 종가, 봉이 없는 날은 마지막 종가
  value: number; // roundMoney(qty × close), equity 계산과 같은 값
  pnlPct: number; // (close / avgPrice − 1) × 100
  stop: number | null; // Position.stopPrice()
  nextAdd: number | null; // Position.nextAddPrice(), 그날 건너뛴 가격이어도 그대로
  takes: { stage: number; price: number }[]; // Position.takeLevels() 중 qty > 0
  openDate: string; // 이번 포지션의 첫 매수일
}

export interface DayFrame {
  date: string;
  cash: number; // equity[i].cash와 같음
  value: number; // equity[i].strategy와 같음
  holdings: HoldingFrame[]; // 그룹 순서, 보유 중인 종목만
  pending: { symbol: string; reason: string }[]; // 그날 종가 신호 → 다음 거래일 시가 매수 예약
}
```

- [ ] **Step 7: 엔진에 기록을 더한다**

`src/lib/sim/simulate.ts`를 아래처럼 바꿔요.

(a) 9행 import:

```ts
import type { DayFrame, HoldingFrame, PatternSnapshot, SimInput, SimResult, Skip, Strategy, Trade } from './types';
```

(b) `CoreResult`(11-18행)에 필드를 더하고 바로 뒤에 `SimOptions`를 둬요:

```ts
export interface CoreResult {
  equity: { date: string; value: number; cash: number }[];
  trades: Trade[];
  skipped: Skip[];
  roundTrips: { symbol: string; open: string; close: string | null; cost: number; pnl: number; holdDays: number }[];
  perSymbolFirstDate: Record<string, string | null>;
  patternStats: { maxDropPct: number; declineDays: number };
  /** 옵션 timeline을 켰을 때만 있다 */
  timeline?: DayFrame[];
}

export interface SimOptions {
  /** 결과 화면 재생용 일별 상태(DayFrame)를 기록한다. 기본은 끔(선정 기준 검증은 지금과 같다) */
  timeline?: boolean;
}
```

(c) `interface SymState { ... }`(135-145행) 바로 뒤, `export function simulateCore` 앞에 더해요:

```ts
/** 하루 끝 상태(설계 §2.1). 엔진 상태를 읽기만 하고, 가격은 반올림하지 않는다 */
function dayFrame(date: string, cash: number, value: number, syms: SymState[]): DayFrame {
  const holdings: HoldingFrame[] = [];
  const pending: DayFrame['pending'] = [];
  for (const st of syms) {
    // 예약은 시가에 비우므로 하루 끝에 남은 것은 그날 종가 신호뿐이다
    if (st.pending) pending.push({ symbol: st.stock.symbol, reason: st.pending.reason });
    const pos = st.pos;
    if (!pos || !st.rt) continue;
    const close = st.lastClose!;
    holdings.push({
      symbol: st.stock.symbol,
      qty: pos.qty,
      avgPrice: pos.avgPrice,
      close,
      value: roundMoney(pos.qty * close),
      pnlPct: (close / pos.avgPrice - 1) * 100,
      stop: pos.stopPrice(),
      nextAdd: pos.nextAddPrice(),
      takes: pos
        .takeLevels()
        .filter((t) => t.qty > 0)
        .map(({ stage, price }) => ({ stage, price })),
      openDate: st.rt.open,
    });
  }
  return { date, cash, value, holdings, pending };
}
```

(d) 147행 시그니처:

```ts
export function simulateCore(input: SimInput, opts: SimOptions = {}): CoreResult {
```

(e) 157행 `const skipKeys = new Set<string>();` 바로 뒤에 더해요:

```ts
  const timeline: DayFrame[] | null = opts.timeline ? [] : null;
```

(f) 260행 `equity.push({ date, value: roundMoney(wallet.cash + held), cash: wallet.cash });`를 바꿔요:

```ts
    const value = roundMoney(wallet.cash + held);
    equity.push({ date, value, cash: wallet.cash });
    // 재생 기록: 그날 종가 처리를 마친 뒤의 상태를 읽기만 한다
    if (timeline) timeline.push(dayFrame(date, wallet.cash, value, syms));
```

(g) 287행 return:

```ts
  return { equity, trades, skipped, roundTrips, perSymbolFirstDate, patternStats: { maxDropPct, declineDays }, ...(timeline && { timeline }) };
```

(h) `simulate`의 머리(290-291행):

```ts
export function simulate(input: SimInput, opts: SimOptions = {}): SimResult {
  const core = simulateCore(input, opts);
```

(i) 반환 객체의 `nearMiss: nearMiss(core),` 줄 바로 뒤에 더해요:

```ts
    ...(core.timeline && { timeline: core.timeline }),
```

- [ ] **Step 8: 결과 화면 실행에서 옵션을 켠다**

`src/lib/ui/simulate/runController.svelte.ts` 73행:

```ts
      result = simulate(input, { timeline: true });
```

- [ ] **Step 9: 통과를 확인한다**

Run: `corepack pnpm test src/lib/sim/simulate.golden.test.ts src/lib/sim/simulate.timeline.test.ts src/lib/sim/simulate.perf.test.ts src/lib/ui/simulate/runController.test.ts src/lib/sim/simulate.test.ts`
Expected: PASS 전부. 골든은 `Snapshots 3 passed`(written·updated·obsolete 없음). 성능 테스트 출력에 `simulate 10년·8종목: timeline 끔 …ms, 켬 …ms`. 스냅샷이 깨지면 `-u`로 고치지 말고 (f)·(g)·(i) 변경을 다시 봐요.

- [ ] **Step 10: 전체 테스트·타입 검사**

Run: `corepack pnpm test && corepack pnpm check`
Expected: 전체 PASS, `0 errors`.

- [ ] **Step 11: 커밋**

```bash
git add src/lib/sim/types.ts src/lib/sim/simulate.ts src/lib/sim/simulate.golden.test.ts src/lib/sim/simulate.timeline.test.ts src/lib/sim/simulate.perf.test.ts src/lib/ui/simulate/runController.svelte.ts src/lib/ui/simulate/runController.test.ts
git commit -m "feat(sim): 결과 화면 실행에서 하루 끝 보유·현금·예약 상태를 timeline으로 기록함" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 재생 컨트롤러 (`replay.svelte.ts`)

DOM 없는 재생 상태 컨트롤러예요(설계 §3). Svelte 5 룬으로 상태를 갖고 시계(`now`·`raf`·`caf`)는 주입해요. 테스트는 가짜 시계로 돌려요.

**Files:**
- Create: `src/lib/ui/simulate/replay.svelte.ts`
- Test: `src/lib/ui/simulate/replay.test.ts`

**Interfaces:**
- Consumes: 없음.
- Produces(`src/lib/ui/simulate/replay.svelte.ts`):
  - `type ReplaySpeed = 1 | 2 | 4 | 8 | 16`, `const REPLAY_SPEEDS: readonly ReplaySpeed[]`
  - `interface Replay { readonly length: number; readonly index: number; readonly playing: boolean; readonly speed: ReplaySpeed; readonly touched: boolean; readonly delta: number; play(): void; pause(): void; toggle(): void; seek(i: number): void; step(d: 1 | -1): void; setSpeed(s: ReplaySpeed): void; reset(): void; destroy(): void }`
  - `interface ReplayOptions { length: number; now?: () => number; raf?: (cb: (t: number) => void) => number; caf?: (id: number) => void }`
  - `createReplay(opts: ReplayOptions): Replay`
  - `replayMotion(r: Pick<Replay, 'delta' | 'playing' | 'speed'>, reduced: boolean): boolean` — 움직임 효과를 켤지

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/ui/simulate/replay.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createReplay, replayMotion } from './replay.svelte';

/** 가짜 시계: frame(ms)는 시간을 ms만큼 보내고 대기 중인 raf 콜백을 한 번 부른다 */
function clock() {
  let t = 0;
  let id = 0;
  const cbs = new Map<number, (t: number) => void>();
  return {
    now: () => t,
    raf: (cb: (t: number) => void) => {
      cbs.set(++id, cb);
      return id;
    },
    caf: (i: number) => void cbs.delete(i),
    frame(ms: number) {
      t += ms;
      const due = [...cbs.values()];
      cbs.clear();
      for (const cb of due) cb(t);
    },
    get waiting() {
      return cbs.size;
    },
  };
}

function make(length = 10) {
  const c = clock();
  return { c, r: createReplay({ length, now: c.now, raf: c.raf, caf: c.caf }) };
}

describe('createReplay', () => {
  it('처음: 마지막 날, 멈춤, 1배, touched 아님, delta 0', () => {
    const { r } = make();
    expect([r.length, r.index, r.playing, r.speed, r.touched, r.delta]).toEqual([10, 9, false, 1, false, 0]);
  });

  it('마지막 날에서 play하면 0으로 돌아가 시작하고 touched', () => {
    const { r, c } = make();
    r.play();
    expect([r.index, r.playing, r.touched, r.delta]).toEqual([0, true, true, -9]);
    expect(c.waiting).toBe(1);
    r.play(); // 재생 중에 또 눌러도 프레임을 겹쳐 걸지 않는다
    expect(c.waiting).toBe(1);
  });

  it('1배: 초당 하루, 소수는 누적한다', () => {
    const { r, c } = make();
    r.play();
    c.frame(400);
    expect(r.index).toBe(0);
    c.frame(400);
    expect(r.index).toBe(0);
    c.frame(400);
    expect([r.index, r.delta]).toEqual([1, 1]);
  });

  it('16배: 한 프레임에 여러 날을 건너뛸 수 있다', () => {
    const { r, c } = make(100);
    r.setSpeed(16);
    r.play();
    c.frame(250);
    expect([r.index, r.delta]).toEqual([4, 4]);
  });

  it('프레임 사이 경과 시간은 1초로 자른다(다른 탭에서 돌아온 경우)', () => {
    const { r, c } = make();
    r.play();
    c.frame(5000);
    expect(r.index).toBe(1);
  });

  it('마지막 날에 닿으면 멈추고 프레임을 더 걸지 않는다', () => {
    const { r, c } = make(5);
    r.setSpeed(16);
    r.play();
    c.frame(1000);
    expect([r.index, r.playing]).toEqual([4, false]);
    expect(c.waiting).toBe(0);
  });

  it('재생 중 배속을 바꾸면 다음 프레임부터 그 배속', () => {
    const { r, c } = make();
    r.play();
    c.frame(500);
    r.setSpeed(4);
    c.frame(500); // 0.5 + 2 = 2.5일
    expect(r.index).toBe(2);
  });

  it('seek: 범위로 자르고 반올림하며 일시정지, touched', () => {
    const { r, c } = make();
    r.play();
    r.seek(-3);
    expect([r.index, r.playing]).toEqual([0, false]);
    expect(c.waiting).toBe(0);
    r.seek(99);
    expect(r.index).toBe(9);
    r.seek(2.6);
    expect([r.index, r.delta]).toEqual([3, -6]);
    const fresh = make().r;
    fresh.seek(fresh.index); // 제자리 seek: 움직이지 않고 touched만 켠다
    expect([fresh.index, fresh.touched, fresh.delta]).toEqual([9, true, 0]);
  });

  it('step: 일시정지하고 하루 이동, 끝에서는 그대로', () => {
    const { r, c } = make();
    r.step(1);
    expect([r.index, r.delta, r.touched]).toEqual([9, 0, true]);
    r.step(-1);
    expect([r.index, r.delta]).toEqual([8, -1]);
    r.play();
    r.step(1);
    expect([r.index, r.playing]).toEqual([9, false]);
    expect(c.waiting).toBe(0);
  });

  it('toggle: 재생 ↔ 일시정지', () => {
    const { r } = make();
    r.toggle();
    expect(r.playing).toBe(true);
    r.toggle();
    expect(r.playing).toBe(false);
  });

  it('reset: 일시정지, 마지막 날, touched 끔', () => {
    const { r, c } = make();
    r.play();
    c.frame(1000);
    r.reset();
    expect([r.index, r.playing, r.touched]).toEqual([9, false, false]);
    expect(c.waiting).toBe(0);
  });

  it('destroy 뒤에는 raf가 멈추고 play·seek도 하지 않는다', () => {
    const { r, c } = make();
    r.play();
    r.destroy();
    expect(c.waiting).toBe(0);
    expect(r.playing).toBe(false);
    r.play();
    r.seek(5);
    expect(c.waiting).toBe(0);
    expect(r.index).toBe(0);
  });
});

describe('replayMotion', () => {
  it('하루만 움직였고(멈춤 또는 1·2배) 움직임 줄이기가 아닐 때만 켠다', () => {
    expect(replayMotion({ delta: 1, playing: false, speed: 16 }, false)).toBe(true); // step
    expect(replayMotion({ delta: -1, playing: false, speed: 1 }, false)).toBe(true);
    expect(replayMotion({ delta: 1, playing: true, speed: 2 }, false)).toBe(true);
    expect(replayMotion({ delta: 1, playing: true, speed: 4 }, false)).toBe(false);
    expect(replayMotion({ delta: 3, playing: true, speed: 1 }, false)).toBe(false);
    expect(replayMotion({ delta: 0, playing: false, speed: 1 }, false)).toBe(false);
    expect(replayMotion({ delta: 1, playing: false, speed: 1 }, true)).toBe(false);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `corepack pnpm test src/lib/ui/simulate/replay.test.ts`
Expected: FAIL, `Failed to resolve import "./replay.svelte"`.

- [ ] **Step 3: 컨트롤러를 만든다**

`src/lib/ui/simulate/replay.svelte.ts`:

```ts
// 시뮬레이션 재생(설계 §3): DOM 없는 컨트롤러. 상태는 룬으로 갖고 시계(now·raf·caf)는 주입한다(테스트는 가짜 시계).
export type ReplaySpeed = 1 | 2 | 4 | 8 | 16;
/** 1배 = 초당 1거래일 */
export const REPLAY_SPEEDS: readonly ReplaySpeed[] = [1, 2, 4, 8, 16];
/** 프레임 사이 경과 시간 상한(ms). 다른 탭에 갔다 오면 raf가 멈췄다가 큰 경과로 돌아온다 */
const MAX_FRAME_MS = 1000;

export interface Replay {
  readonly length: number;
  /** 0..length−1. 처음 값은 마지막 날(지금 결과 화면과 같음) */
  readonly index: number;
  readonly playing: boolean;
  readonly speed: ReplaySpeed;
  /** play·seek·step 중 하나라도 하면 true, reset()이 false로 */
  readonly touched: boolean;
  /** 마지막으로 index가 바뀐 양(부호 있음). 처음과 제자리 이동은 0 */
  readonly delta: number;
  /** 마지막 날에서 누르면 0으로 돌아가 시작 */
  play(): void;
  pause(): void;
  toggle(): void;
  /** 범위로 자르고 일시정지 */
  seek(i: number): void;
  /** 일시정지하고 하루 이동 */
  step(d: 1 | -1): void;
  setSpeed(s: ReplaySpeed): void;
  /** 일시정지, index = length−1, touched = false */
  reset(): void;
  destroy(): void;
}

export interface ReplayOptions {
  length: number;
  now?: () => number;
  raf?: (cb: (t: number) => void) => number;
  caf?: (id: number) => void;
}

export function createReplay(opts: ReplayOptions): Replay {
  const n = Math.max(1, opts.length);
  const last = n - 1;
  const now = opts.now ?? (() => performance.now());
  const raf = opts.raf ?? ((cb: (t: number) => void) => requestAnimationFrame(cb));
  const caf = opts.caf ?? ((id: number) => cancelAnimationFrame(id));

  let index = $state(last);
  let delta = $state(0);
  let playing = $state(false);
  let speed = $state<ReplaySpeed>(1);
  let touched = $state(false);
  let frame: number | null = null;
  let prev = 0;
  let acc = 0; // 아직 넘기지 않은 소수 거래일
  let dead = false;

  const clamp = (i: number) => Math.min(last, Math.max(0, Math.round(i)));
  function moveTo(i: number) {
    const next = clamp(i);
    delta = next - index;
    index = next;
  }
  function stopLoop() {
    if (frame !== null) caf(frame);
    frame = null;
  }
  function loop() {
    frame = null;
    if (!playing) return;
    const t = now();
    const dt = Math.min(MAX_FRAME_MS, Math.max(0, t - prev));
    prev = t;
    acc += (dt / 1000) * speed;
    const whole = Math.floor(acc);
    if (whole > 0) {
      acc -= whole;
      moveTo(index + whole);
    }
    if (index >= last) {
      pause();
      return;
    }
    frame = raf(loop);
  }
  function play() {
    if (dead || playing) return;
    touched = true;
    if (index >= last) moveTo(0);
    playing = true;
    acc = 0;
    prev = now();
    frame = raf(loop);
  }
  function pause() {
    playing = false;
    acc = 0;
    stopLoop();
  }

  return {
    get length() {
      return n;
    },
    get index() {
      return index;
    },
    get playing() {
      return playing;
    },
    get speed() {
      return speed;
    },
    get touched() {
      return touched;
    },
    get delta() {
      return delta;
    },
    play,
    pause,
    toggle() {
      if (playing) pause();
      else play();
    },
    seek(i) {
      if (dead) return;
      pause();
      touched = true;
      moveTo(i);
    },
    step(d) {
      if (dead) return;
      pause();
      touched = true;
      moveTo(index + d);
    },
    setSpeed(s) {
      speed = s;
    },
    reset() {
      pause();
      touched = false;
      moveTo(last);
    },
    destroy() {
      dead = true;
      pause();
    },
  };
}

/** 움직임 효과(설계 §4.5): 하루만 움직였고(멈춘 채 이동이거나 1·2배 재생) 움직임 줄이기가 아닐 때만 */
export function replayMotion(r: Pick<Replay, 'delta' | 'playing' | 'speed'>, reduced: boolean): boolean {
  return !reduced && Math.abs(r.delta) === 1 && (!r.playing || r.speed <= 2);
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `corepack pnpm test src/lib/ui/simulate/replay.test.ts`
Expected: PASS(13 tests).

- [ ] **Step 5: 타입 검사**

Run: `corepack pnpm check`
Expected: `0 errors`.

- [ ] **Step 6: 커밋**

```bash
git add src/lib/ui/simulate/replay.svelte.ts src/lib/ui/simulate/replay.test.ts
git commit -m "feat(simulate): 시계를 주입받는 재생 컨트롤러와 움직임 판정을 더함" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 체결 마커 공용화 + 자산 차트 `upTo`

`TradeChartSheet`의 지역 마커 코드를 `markers.ts`로 옮기고 묶기 간격을 인자로 받게 해요(설계 §4.3). `EquityChart`에 `upTo`·`trades` prop을 더해 그날까지만 실제 값을 그리고(뒤는 whitespace), 세로축을 전체 기간으로 고정하고, 범례 날짜를 맞추고, 그날까지의 체결 마커를 그려요. `upTo`가 `undefined`로 돌아오면 지금 화면으로 되돌려요.

**Files:**
- Create: `src/lib/ui/simulate/markers.ts`
- Test: `src/lib/ui/simulate/markers.test.ts`
- Modify: `src/lib/ui/simulate/TradeChartSheet.svelte:4-12`(import), `:43-60`(상수), `:87`(LABEL), `:97-116`(삭제), `:141-157`(마커)
- Modify: `src/lib/ui/simulate/EquityChart.svelte`(instance script, props, 범례 날짜, effect, onMount)
- Test: `src/lib/ui/simulate/EquityChart.test.ts`(describe 추가)

**Interfaces:**
- Consumes(기존): `Trade`(`src/lib/sim/types.ts`), lwc 가짜 `lwcCharts`·`resetLwcStub`·`ResizeObserverStub`·`lwcStubHooks`(`src/lib/chart/lwcStub.ts`; `StubSeries.markers`는 마지막 `setMarkers` 값, `options`는 `applyOptions`를 얕게 합친 값, `lwcStubHooks.crosshairOnSetData`가 있으면 `setData` 때 크로스헤어 구독자를 그 값으로 부름).
- Produces:
  - `src/lib/ui/simulate/markers.ts`: `type ColorToken = [string, string]`, `TRADE_LABEL: Record<Trade['kind'], string>`, `MARKER_COLOR: Record<Trade['kind'], ColorToken>`, `MIXED_COLOR: ColorToken`, `isBuying(t: Trade): boolean`, `interface MarkerGroup { time: string; bar: number; buying: boolean; kinds: Trade['kind'][] }`, `mergedMarkers(list: Trade[], barOf: (date: string) => number, mergeBars: number): MarkerGroup[]`, `tradeMarkers(list: Trade[], barOf: (date: string) => number, mergeBars: number, color: (token: ColorToken) => string): SeriesMarker<Time>[]`
  - `EquityChart` props 추가: `upTo?: number`(equity 인덱스, 없으면 지금과 같음), `trades?: Trade[]`(기본 `[]`).

- [ ] **Step 1: 마커 모듈의 실패하는 테스트를 쓴다**

`src/lib/ui/simulate/markers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Trade } from '../../sim/types';
import { mergedMarkers, tradeMarkers, type ColorToken } from './markers';

const bars = ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05'];
const barOf = (d: string) => bars.indexOf(d);
const t = (date: string, kind: Trade['kind']): Trade => ({ date, symbol: 'X', kind, price: 100, qty: 1, fee: 0, tax: 0, reason: '' });
const fallback = (token: ColorToken) => token[1];

describe('mergedMarkers', () => {
  it('간격 0: 같은 날·같은 방향만 하나로, 다음 날은 따로', () => {
    const g = mergedMarkers([t(bars[0], 'buy'), t(bars[0], 'add'), t(bars[1], 'add'), t(bars[1], 'take'), t(bars[1], 'stop')], barOf, 0);
    expect(g.map((x) => [x.time, x.buying, x.kinds])).toEqual([
      [bars[0], true, ['buy', 'add']],
      [bars[1], true, ['add']],
      [bars[1], false, ['take', 'stop']],
    ]);
  });

  it('간격 3: 3봉 안의 같은 방향은 합치고 4봉 뒤는 따로', () => {
    expect(mergedMarkers([t(bars[0], 'buy'), t(bars[3], 'add')], barOf, 3)).toHaveLength(1);
    expect(mergedMarkers([t(bars[0], 'buy'), t(bars[4], 'add')], barOf, 3)).toHaveLength(2);
  });
});

describe('tradeMarkers', () => {
  it('매수는 아래 ▲ 강조색, 매도는 위 ▼, 색이 섞이면 중립색, 라벨은 겹치지 않게 ·로 잇는다', () => {
    const m = tradeMarkers([t(bars[0], 'buy'), t(bars[0], 'add'), t(bars[2], 'take'), t(bars[2], 'gapStop'), t(bars[3], 'gapTake')], barOf, 0, fallback);
    expect(m).toEqual([
      { time: bars[0], position: 'belowBar', shape: 'arrowUp', color: '#5b47e0', text: '매수·추가' },
      { time: bars[2], position: 'aboveBar', shape: 'arrowDown', color: '#5b6069', text: '익절·손절' },
      { time: bars[3], position: 'aboveBar', shape: 'arrowDown', color: '#d4202f', text: '익절' },
    ]);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `corepack pnpm test src/lib/ui/simulate/markers.test.ts`
Expected: FAIL, `Failed to resolve import "./markers"`.

- [ ] **Step 3: 마커 모듈을 만든다**

`src/lib/ui/simulate/markers.ts`(`TradeChartSheet.svelte`의 `LABEL`·`MARKER_COLOR`·`mergedMarkers`를 그대로 옮기고 간격만 인자로 받아요):

```ts
// 체결 마커(거래 차트 시트·재생 자산 차트 공용): 같은 방향 체결을 묶고 매수는 아래 ▲, 매도는 위 ▼로 그린다.
import type { SeriesMarker, Time } from 'lightweight-charts';
import type { Trade } from '../../sim/types';

/** [CSS 변수, 대체 색(라이트 토큰 값)] */
export type ColorToken = [string, string];

export const TRADE_LABEL: Record<Trade['kind'], string> = { buy: '매수', add: '추가', take: '익절', gapTake: '익절', stop: '손절', gapStop: '손절' };

const ACCENT: ColorToken = ['--accent', '#5b47e0'];
const UP: ColorToken = ['--up', '#d4202f'];
const DOWN: ColorToken = ['--down', '#1d5fd6'];
/** 익절·손절처럼 색이 섞인 마커 */
export const MIXED_COLOR: ColorToken = ['--t2', '#5b6069'];
// 매수 = 강조색, 익절 = 상승색, 손절 = 하락색
export const MARKER_COLOR: Record<Trade['kind'], ColorToken> = {
  buy: ACCENT,
  add: ACCENT,
  take: UP,
  gapTake: UP,
  stop: DOWN,
  gapStop: DOWN,
};

export const isBuying = (t: Trade): boolean => t.kind === 'buy' || t.kind === 'add';

export interface MarkerGroup {
  time: string;
  bar: number;
  buying: boolean;
  kinds: Trade['kind'][];
}

/** 같은 방향 거래가 mergeBars봉 안에 몰리면 마커 하나로(라벨 `매수·추가`·`익절·손절`). 0이면 같은 날만. 시간 순으로 돌려준다. */
export function mergedMarkers(list: Trade[], barOf: (date: string) => number, mergeBars: number): MarkerGroup[] {
  const groups: MarkerGroup[] = [];
  const lastOf = new Map<boolean, MarkerGroup>();
  for (const t of list) {
    const bar = barOf(t.date);
    const last = lastOf.get(isBuying(t));
    if (last && bar - last.bar <= mergeBars) {
      last.kinds.push(t.kind);
      continue;
    }
    const g = { time: t.date, bar, buying: isBuying(t), kinds: [t.kind] };
    groups.push(g);
    lastOf.set(g.buying, g);
  }
  return groups.sort((a, b) => a.bar - b.bar);
}

/** lightweight-charts 마커. color는 토큰을 실제 색으로 바꾼다 */
export function tradeMarkers(list: Trade[], barOf: (date: string) => number, mergeBars: number, color: (token: ColorToken) => string): SeriesMarker<Time>[] {
  return mergedMarkers(list, barOf, mergeBars).map((g) => {
    const colors = [...new Set(g.kinds.map((k) => color(MARKER_COLOR[k])))];
    return {
      time: g.time as Time,
      position: g.buying ? 'belowBar' : 'aboveBar',
      shape: g.buying ? 'arrowUp' : 'arrowDown',
      color: colors.length === 1 ? colors[0] : color(MIXED_COLOR),
      text: [...new Set(g.kinds.map((k) => TRADE_LABEL[k]))].join('·'),
    };
  });
}
```

- [ ] **Step 4: TradeChartSheet가 공용 모듈을 쓰게 바꾼다**

`src/lib/ui/simulate/TradeChartSheet.svelte`:

(a) 4-12행 import에서 `type SeriesMarker,` 줄을 지우고, `import { returnClass, shortDate, trendReturn } from './simText';` 아래에 더해요:

```ts
  import { TRADE_LABEL, tradeMarkers } from './markers';
```

(b) 43-60행(`const MERGE_BARS = 3;`부터 `MARKER_COLOR` 끝 `};`까지)을 아래로 바꿔요(`UP`·`DOWN`·`LABEL`·`MARKER_COLOR`는 `markers.ts`로 갔어요):

```ts
  /** 같은 방향 마커가 이 봉 수 안이면 하나로 합친다(라벨 겹침 방지) */
  const MERGE_BARS = 3;
  // 토큰을 못 읽을 때의 폴백은 라이트 토큰 값(tokens.css)과 같게, 토큰마다 하나
  const ACCENT: [string, string] = ['--accent', '#5b47e0'];
  const T2: [string, string] = ['--t2', '#5b6069'];
  const T3: [string, string] = ['--t3', '#676d77'];
```

(c) `steps`의 `` `${LABEL[t.kind]} ${when(t.date)} ${fmtWon(t.price)}원` ``을 `` `${TRADE_LABEL[t.kind]} ${when(t.date)} ${fmtWon(t.price)}원` ``로 바꿔요.

(d) `const buying = (t: Trade) => ...`부터 `mergedMarkers` 함수 끝(97-116행)을 지워요.

(e) effect 안의 마커 만들기(141-157행, `// 마커는 시간 순이어야 한다`부터 `createSeriesMarkers(line, markers);`까지)를 바꿔요:

```ts
    // 마커는 시간 순이어야 한다
    const barOf = (date: string) => {
      const i = dates.findIndex((d) => d >= date);
      return i < 0 ? dates.length : i;
    };
    createSeriesMarkers(line, tradeMarkers(position.trades, barOf, MERGE_BARS, v));
```

- [ ] **Step 5: 마커·시트 테스트 통과를 확인한다**

Run: `corepack pnpm test src/lib/ui/simulate/markers.test.ts src/lib/ui/simulate/TradeChartSheet.test.ts`
Expected: PASS(시트 테스트는 고치지 않았고 그대로 통과).

- [ ] **Step 6: EquityChart의 실패하는 테스트를 쓴다**

`src/lib/ui/simulate/EquityChart.test.ts` 맨 위 import를 바꿔요:

```ts
import { lwcCharts, lwcStubHooks, resetLwcStub, ResizeObserverStub } from '../../chart/lwcStub';
import type { Trade } from '../../sim/types';
```

파일 끝에 더해요:

```ts
describe('EquityChart 재생(upTo)', () => {
  const days = ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05'];
  // 전략 수익률 0·1·2·3·4%, 보유 0·−1·−2·−3·−4%
  const equity = days.map((date, i) => ({ date, strategy: 10_000_000 * (1 + i / 100), hold: 10_000_000 * (1 - i / 100), index: null, benchmark: null, cash: 5_000_000 }));
  const trades: Trade[] = [
    { date: days[1], symbol: 'A', kind: 'buy', price: 100, qty: 1, fee: 0, tax: 0, reason: 'B 돌파' },
    { date: days[1], symbol: 'A', kind: 'add', price: 97, qty: 1, fee: 0, tax: 0, reason: '추가 매수' },
    { date: days[3], symbol: 'A', kind: 'take', stage: 1, price: 110, qty: 2, fee: 0, tax: 0, reason: '익절', pnlPct: 10 },
  ];
  const props = (upTo?: number) => ({ equity, initial: 10_000_000, trades, upTo });
  const series = (k = 0) => lwcCharts[0].series[k];
  const real = (k = 0) => (series(k).data as { value?: number }[]).filter((p) => p.value !== undefined);
  type Provider = () => { priceRange: { minValue: number; maxValue: number } };
  const autoscale = (k: number) => series(k).options.autoscaleInfoProvider as Provider | undefined;
  const legendDate = () => document.querySelector('.legend .date')?.textContent;

  it('upTo가 없으면 지금과 같다: 전체 점, 마커 없음, 세로축 자동', async () => {
    render(EquityChart, props());
    await vi.waitFor(() => expect(lwcCharts[0]?.series).toHaveLength(2));
    expect(series().data).toHaveLength(5);
    expect(real()).toHaveLength(5);
    expect(series().markers).toEqual([]);
    expect(autoscale(0)).toBeUndefined();
    expect(legendDate()).toBe('2024.01.05');
  });

  it('upTo까지만 실제 값, 뒤는 값 없는 점으로 가로축 고정, 세로축은 전체 기간 최소·최대', async () => {
    render(EquityChart, props(2));
    await vi.waitFor(() => expect(real()).toHaveLength(3));
    expect(series().data).toHaveLength(5);
    expect(series().data[4]).toEqual({ time: days[4] });
    expect(real(1)).toHaveLength(3);
    const s = autoscale(0)!().priceRange;
    expect(s.minValue).toBeCloseTo(0, 6);
    expect(s.maxValue).toBeCloseTo(4, 6);
    const h = autoscale(1)!().priceRange;
    expect(h.minValue).toBeCloseTo(-4, 6);
    expect(h.maxValue).toBeCloseTo(0, 6);
    expect(legendDate()).toBe('2024.01.03');
  });

  it('체결 마커: upTo 날짜까지만, 같은 날·같은 방향은 하나. upTo가 바뀌면 다시 넣는다', async () => {
    const { rerender } = render(EquityChart, props(2));
    await vi.waitFor(() => expect(series().markers).toHaveLength(1));
    expect(series().markers).toEqual([{ time: days[1], position: 'belowBar', shape: 'arrowUp', color: '#5b47e0', text: '매수·추가' }]);
    await rerender(props(3));
    await vi.waitFor(() => expect(real()).toHaveLength(4));
    expect((series().markers as { text: string }[]).map((m) => m.text)).toEqual(['매수·추가', '익절']);
  });

  it('upTo가 숫자에서 undefined로 돌아오면 전체 점·마커 0개·세로축 자동으로 되돌린다', async () => {
    const { rerender } = render(EquityChart, props(1));
    await vi.waitFor(() => expect(real()).toHaveLength(2));
    await rerender(props(undefined));
    await vi.waitFor(() => expect(series().data).toHaveLength(5));
    expect(real()).toHaveLength(5);
    expect(series().markers).toEqual([]);
    expect(autoscale(0)).toBeUndefined();
    expect(autoscale(1)).toBeUndefined();
    expect(legendDate()).toBe('2024.01.05');
  });

  it('범례: 크로스헤어가 upTo 뒤 날짜면 무시하고 upTo 날짜, 앞 날짜면 그 날짜', async () => {
    // 가짜 차트는 setData 때 크로스헤어 구독자를 이 값으로 부른다
    lwcStubHooks.crosshairOnSetData = { time: days[4] as unknown as number };
    try {
      const { rerender } = render(EquityChart, props(2));
      await vi.waitFor(() => expect(real()).toHaveLength(3));
      expect(legendDate()).toBe('2024.01.03');
      lwcStubHooks.crosshairOnSetData = { time: days[1] as unknown as number };
      await rerender(props(3));
      await vi.waitFor(() => expect(legendDate()).toBe('2024.01.02'));
    } finally {
      lwcStubHooks.crosshairOnSetData = null;
    }
  });

  it('curves 모드에는 upTo를 쓰지 않는다', async () => {
    const points = [{ date: days[0], value: 10_000_000 }, { date: days[1], value: 11_000_000 }];
    render(EquityChart, { initial: 10_000_000, curves: [{ id: 'a', name: '① 선정만', color: ['--accent', '#5b47e0'] as [string, string], width: 2, dashed: false, points }], upTo: 0 });
    await vi.waitFor(() => expect(lwcCharts[0]?.series).toHaveLength(1));
    expect(real()).toHaveLength(2);
    expect(autoscale(0)).toBeUndefined();
  });
});
```

- [ ] **Step 7: 실패를 확인한다**

Run: `corepack pnpm test src/lib/ui/simulate/EquityChart.test.ts`
Expected: FAIL. 기존 테스트는 통과하고, 새 describe에서 `upTo` 무시(실제 점 5개, 마커 없음, 범례 `2024.01.05`)로 4개가 실패해요(「upTo가 없으면」·「curves 모드」는 통과할 수 있어요).

- [ ] **Step 8: EquityChart를 고친다**

`src/lib/ui/simulate/EquityChart.svelte` instance script(`<script lang="ts">` 두 번째 블록)를 아래처럼 바꿔요.

(a) import 블록(34-49행)을 바꿔요:

```ts
  import { onMount, untrack } from 'svelte';
  import {
    ColorType,
    createChart,
    createSeriesMarkers,
    CrosshairMode,
    LineSeries,
    LineStyle,
    type IChartApi,
    type ISeriesApi,
    type ISeriesMarkersPluginApi,
    type LineWidth,
    type MouseEventParams,
    type Time,
  } from 'lightweight-charts';
  import type { SimResult, Trade } from '../../sim/types';
  import LineSwatch from './LineSwatch.svelte';
  import { tradeMarkers } from './markers';
  import { fmtReturnPct } from './simText';
```

(b) props(53-73행)에 두 개를 더해요:

```ts
  let {
    equity = [],
    initial,
    labels = { benchmark: null, index: '' },
    theme,
    curves,
    rebalanceDates,
    sampledNote,
    upTo,
    trades = [],
  }: {
    equity?: Row[];
    initial: number;
    labels?: { benchmark: string | null; index: string };
    /** 바뀌면 CSS 변수에서 색을 다시 읽는다(CompareChart와 같은 방식) */
    theme?: string;
    /** 주면 equity 대신 이 곡선들을 그리고, 범례가 켜고 끄는 버튼이 된다 */
    curves?: CurveLine[];
    /** 재선정일: 세로 눈금으로 표시한다 */
    rebalanceDates?: string[];
    /** 곡선을 솎은 공유의 안내 */
    sampledNote?: string;
    /** 재생(설계 §4.3): equity 인덱스. 이 날까지만 그리고 그날까지의 체결 마커를 단다. 없으면 지금과 같다(curves 모드에는 쓰지 않는다) */
    upTo?: number;
    /** 재생 마커에 쓸 체결 */
    trades?: Trade[];
  } = $props();
```

(c) 100행 `const date = $derived(...)`를 바꿔요:

```ts
  // 재생 중(upTo)이면 범례 기본 날짜는 그날, 크로스헤어가 그보다 뒤를 가리키면 무시한다
  const capDate = $derived(curves || upTo === undefined ? null : (equity[upTo]?.date ?? null));
  const date = $derived.by(() => {
    if (curves) return hover && items.some((i) => i.points.some((p) => p.date === hover)) ? hover : lastDate;
    const h = equity.find((e) => e.date === hover)?.date;
    if (capDate !== null) return h !== undefined && h <= capDate ? h : capDate;
    return h ?? lastDate;
  });
```

(d) 108행 `let lines: ... = [];` 바로 뒤에 더해요:

```ts
  // 전략 선에 한 번 붙이는 체결 마커(curves 모드에는 없음)
  let markers: ISeriesMarkersPluginApi<Time> | null = null;
  // 지금 차트에 들어간 upTo. onMount의 전체 데이터는 undefined와 같다
  let applied: number | undefined = undefined;

  /** upTo까지 실제 값, 뒤는 값 없는 점(가로축 고정). 세로축은 전체 기간 최소·최대로 고정. undefined면 지금 화면으로 되돌린다 */
  function applyCut(cut: number | undefined) {
    if (cut === undefined) {
      for (const l of lines) {
        const it = items.find((i) => i.id === l.id)!;
        l.series.setData(it.points.map((p) => ({ time: p.date as Time, value: p.value })));
        l.series.applyOptions({ autoscaleInfoProvider: undefined });
      }
      markers?.setMarkers([]);
      return;
    }
    const until = equity[Math.min(cut, equity.length - 1)]?.date ?? '';
    for (const l of lines) {
      const it = items.find((i) => i.id === l.id)!;
      const byDate = new Map(it.points.map((p) => [p.date, p.value]));
      const values = it.points.map((p) => p.value);
      const lo = Math.min(...values);
      const hi = Math.max(...values);
      l.series.setData(
        equity.map((e) => {
          const v = byDate.get(e.date);
          return e.date <= until && v !== undefined ? { time: e.date as Time, value: v } : { time: e.date as Time };
        }),
      );
      l.series.applyOptions({ autoscaleInfoProvider: () => ({ priceRange: { minValue: lo, maxValue: hi } }) });
    }
    const barOf = new Map(equity.map((e, i) => [e.date, i]));
    markers?.setMarkers(tradeMarkers(trades.filter((t) => t.date <= until), (d) => barOf.get(d) ?? equity.length, 0, (t) => token(t[0], t[1])));
  }

  // 차트가 준비된 뒤 upTo를 늘 읽는다. 바뀔 때만 다시 넣는다
  $effect(() => {
    const cut = curves ? undefined : upTo;
    const c = chart;
    if (!c || cut === applied) return;
    applied = cut;
    untrack(() => applyCut(cut));
  });
```

(e) onMount 안에서 `lines = items.map(...)` 문 바로 뒤(`c.timeScale().fitContent();` 앞)에 더해요:

```ts
    // 마커는 한 번만 붙이고 이후에는 setMarkers만 부른다(재생 그날 체결, 같은 날·같은 방향만 하나로)
    if (!curves && lines[0]) markers = createSeriesMarkers(lines[0].series, []);
```

(f) onMount cleanup의 `lines = [];` 바로 뒤에 더해요:

```ts
      markers = null;
      applied = undefined;
```

`token` 함수는 이미 같은 script에 있어요(`function token(name: string, fallback: string)`). `applyCut`이 그보다 위에 있어도 함수 선언이라 괜찮아요.

- [ ] **Step 9: 통과를 확인한다**

Run: `corepack pnpm test src/lib/ui/simulate/EquityChart.test.ts src/lib/ui/simulate/markers.test.ts src/lib/ui/simulate/TradeChartSheet.test.ts src/lib/ui/simulate/ResultView.test.ts`
Expected: PASS 전부(ResultView는 아직 `upTo`를 넘기지 않으니 그대로).

- [ ] **Step 10: 타입 검사**

Run: `corepack pnpm check`
Expected: `0 errors`.

- [ ] **Step 11: 커밋**

```bash
git add src/lib/ui/simulate/markers.ts src/lib/ui/simulate/markers.test.ts src/lib/ui/simulate/TradeChartSheet.svelte src/lib/ui/simulate/EquityChart.svelte src/lib/ui/simulate/EquityChart.test.ts
git commit -m "feat(simulate): 체결 마커를 공용 모듈로 옮기고 자산 차트가 재생 날짜까지 그리게 함" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 체결 사유 공용화 + 그날 상황 패널 (`DayPanel`·`HoldingCard`)

`TradeList`의 지역 함수 `why`를 `simText.ts`의 `tradeWhy`로 옮기고, 재생 날짜·가격 막대·패널 문구를 `simText.ts`에 더해요. 그날 상황 패널(`DayPanel`)과 보유 카드(`HoldingCard`)를 만들어요(설계 §4.4, §4.5).

**Files:**
- Modify: `src/lib/ui/simulate/simText.ts`(import, 결과 화면 구역에 함수 추가)
- Test: `src/lib/ui/simulate/simText.test.ts`(import, describe 추가)
- Modify: `src/lib/ui/simulate/TradeList.svelte:6`, `:22-25`
- Create: `src/lib/ui/simulate/HoldingCard.svelte`
- Create: `src/lib/ui/simulate/DayPanel.svelte`
- Test: `src/lib/ui/simulate/DayPanel.test.ts`

**Interfaces:**
- Consumes: Task 2의 `HoldingFrame`·`DayFrame`(`src/lib/sim/types.ts`, 필드는 Task 2 Interfaces 참고). 기존 `Trade`·`Skip`, `fmtWon(n: number): string`(`../format`), `kstWeekday(date: string): 0..6`(`../../time/kst`), `dotDate`·`returnClass`·`trendReturn`·`skipReasonLabel`(`simText.ts`), `expectNoAxeViolations(container: Element)`(`src/lib/share/testAxe.ts`).
- Produces:
  - `simText.ts`: `replayDate(date: string): string`(`2024.03.15(금)`), `tradeWhy(t: Trade): string`, `pendingText(name: string, reason: string): string`, 상수 `PRICE_BASIS_NOTE = '다음 거래일 기준'`, `STOP_PENDING_NOTE = '손절: 분할 매수 끝나면 정해져요'`, `NO_HOLDINGS = '보유한 종목이 없어요'`, `interface PriceMark { key: string; kind: 'stop' | 'add' | 'avg' | 'take'; label: string; price: number; left: number }`, `priceMarks(h: Pick<HoldingFrame, 'stop' | 'nextAdd' | 'avgPrice' | 'takes' | 'close'>): { marks: PriceMark[]; dot: number }`(left·dot은 0~100 %)
  - `HoldingCard.svelte` props: `{ h: HoldingFrame; name: string; motion?: boolean }` — `<article aria-label={name}>`
  - `DayPanel.svelte` props: `{ frame: DayFrame; trades: Trade[]; skipped: Skip[]; names: Record<string, string>; initial: number; motion?: boolean }` — `<section aria-label="그날 상황">`. `trades`·`skipped`는 그날 것만 넘겨요.

- [ ] **Step 1: simText의 실패하는 테스트를 쓴다**

`src/lib/ui/simulate/simText.test.ts`의 `./simText` import에 `priceMarks, replayDate, tradeWhy`를 더해요:

```ts
import { fmtReturnPct, money, nearMissText, priceMarks, replayDate, resultHeadline, returnClass, sectionSummary, skipReasonLabel, startsLate, strategyLine, tradeWhy, trendReturn } from './simText';
```

파일 끝에 더해요:

```ts
describe('재생 문구', () => {
  it('replayDate: 점 날짜 + 요일', () => {
    expect(replayDate('2024-03-15')).toBe('2024.03.15(금)');
    expect(replayDate('2023-10-12')).toBe('2023.10.12(목)');
  });

  it('tradeWhy: 매수는 신호 + 매수, 추가는 추가 매수, 단계 익절은 (N% 매도)', () => {
    const t = { date: '2024-03-14', symbol: 'X', price: 1, qty: 1, fee: 0, tax: 0 };
    expect(tradeWhy({ ...t, kind: 'buy', reason: 'B 돌파' })).toBe('B 돌파 매수');
    expect(tradeWhy({ ...t, kind: 'add', reason: '추가 매수' })).toBe('추가 매수');
    expect(tradeWhy({ ...t, kind: 'take', stage: 1, reason: '1단계 익절 80%' })).toBe('1단계 익절(80% 매도)');
    expect(tradeWhy({ ...t, kind: 'take', stage: 1, reason: '익절' })).toBe('익절');
    expect(tradeWhy({ ...t, kind: 'gapStop', reason: '손절' })).toBe('손절');
  });

  it('priceMarks: 손절·다음 추가·평단·익절 순서, 범위는 표시 가격 최소·최대에 5% 여유, 점은 종가', () => {
    const r = priceMarks({ stop: 95, nextAdd: 97, avgPrice: 100, takes: [{ stage: 1, price: 105 }, { stage: 2, price: 110 }], close: 102 });
    expect(r.marks.map((m) => [m.kind, m.label, m.price])).toEqual([
      ['stop', '손절', 95],
      ['add', '다음 추가', 97],
      ['avg', '평단', 100],
      ['take', '익절 1', 105],
      ['take', '익절 2', 110],
    ]);
    // 95~110에 여유 0.75씩 → 94.25~110.75
    expect(r.marks[0].left).toBeCloseTo((0.75 / 16.5) * 100, 9);
    expect(r.marks[4].left).toBeCloseTo((15.75 / 16.5) * 100, 9);
    expect(r.dot).toBeCloseTo((7.75 / 16.5) * 100, 9);
  });

  it('priceMarks: 손절·다음 추가가 없으면 빼고, 익절 단계가 1 하나면 라벨은 익절', () => {
    const r = priceMarks({ stop: null, nextAdd: null, avgPrice: 100, takes: [{ stage: 1, price: 115 }], close: 100 });
    expect(r.marks.map((m) => m.label)).toEqual(['평단', '익절']);
    const late = priceMarks({ stop: 100, nextAdd: null, avgPrice: 100, takes: [{ stage: 3, price: 115 }], close: 100 });
    expect(late.marks.map((m) => m.label)).toEqual(['손절', '평단', '익절 3']);
  });
});
```

- [ ] **Step 2: DayPanel·HoldingCard의 실패하는 테스트를 쓴다**

`src/lib/ui/simulate/DayPanel.test.ts`:

```ts
// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { DayFrame, HoldingFrame, Skip, Trade } from '../../sim/types';
import { expectNoAxeViolations } from '../../share/testAxe';
import DayPanel from './DayPanel.svelte';
import HoldingCard from './HoldingCard.svelte';

const names = { '005930': '삼성전자', '000660': 'SK하이닉스' };
const holding = (over: Partial<HoldingFrame> = {}): HoldingFrame => ({
  symbol: '005930',
  qty: 14,
  avgPrice: 70_000,
  close: 71_000,
  value: 994_000,
  pnlPct: (71_000 / 70_000 - 1) * 100,
  stop: 66_500,
  nextAdd: 67_900,
  takes: [{ stage: 1, price: 73_500 }, { stage: 2, price: 77_000 }],
  openDate: '2023-10-12',
  ...over,
});
const frame = (over: Partial<DayFrame> = {}): DayFrame => ({ date: '2023-10-12', cash: 9_000_000, value: 10_100_000, holdings: [], pending: [], ...over });
const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim();
const panel = (over: { frame?: DayFrame; trades?: Trade[]; skipped?: Skip[] } = {}) =>
  render(DayPanel, { frame: frame(), trades: [], skipped: [], names, initial: 10_000_000, ...over });

describe('DayPanel', () => {
  it('머리: 날짜(요일) · 총자산 · 현금(비중) · 그날까지 수익률', () => {
    panel();
    const region = screen.getByRole('region', { name: '그날 상황' });
    expect(within(region).getByText('2023.10.12(목)')).toBeTruthy();
    const totals = within(region).getByRole('list', { name: '그날 자산' });
    expect(within(totals).getAllByRole('listitem').map(text)).toEqual(['총자산 10,100,000원', '현금 9,000,000원 (89%)', '그날까지 수익률 ▲ +1.0%']);
  });

  it('보유가 없으면 「보유한 종목이 없어요」', () => {
    panel();
    expect(screen.getByText('보유한 종목이 없어요')).toBeTruthy();
    expect(screen.queryByRole('list', { name: '보유 종목' })).toBeNull();
  });

  it('보유 카드: 종목명·수익률·수량·평단·종가·평가액·보유 시작, 가격 눈금과 「다음 거래일 기준」', () => {
    panel({ frame: frame({ holdings: [holding()] }) });
    expect(screen.queryByText('보유한 종목이 없어요')).toBeNull();
    const card = screen.getByRole('article', { name: '삼성전자' });
    expect(text(card.querySelector('.top'))).toBe('삼성전자 ▲ +1.4%');
    expect([...card.querySelectorAll('.facts > div')].map(text)).toEqual(['수량 14주', '평단 70,000원', '종가 71,000원', '평가액 994,000원', '보유 시작 2023.10.12']);
    expect(within(card).getAllByRole('listitem').map(text)).toEqual(['손절 66,500원', '다음 추가 67,900원', '평단 70,000원', '익절 1 73,500원', '익절 2 77,000원']);
    expect(within(card).getByText('다음 거래일 기준')).toBeTruthy();
    expect(within(card).queryByText('손절: 분할 매수 끝나면 정해져요')).toBeNull();
  });

  it('손절이 null이면 안내 문구, 다음 추가가 null이면 그 눈금만 뺀다', () => {
    panel({ frame: frame({ holdings: [holding({ stop: null, nextAdd: null })] }) });
    const card = screen.getByRole('article', { name: '삼성전자' });
    expect(within(card).getByText('손절: 분할 매수 끝나면 정해져요')).toBeTruthy();
    expect(within(card).getAllByRole('listitem').map(text)).toEqual(['평단 70,000원', '익절 1 73,500원', '익절 2 77,000원']);
  });

  it('예약 매수 · 그날 체결 · 그날 건너뜀(사유별)', () => {
    const trades: Trade[] = [
      { date: '2023-10-12', symbol: '005930', kind: 'buy', price: 70_000, qty: 14, fee: 147, tax: 0, reason: 'B 돌파' },
      { date: '2023-10-12', symbol: '000660', kind: 'take', stage: 1, price: 80_500, qty: 12, fee: 1, tax: 0, reason: '1단계 익절 80%', pnlPct: 15 },
    ];
    const skipped: Skip[] = [
      { date: '2023-10-12', symbol: '000660', reason: '현금 부족' },
      { date: '2023-10-12', symbol: '005930', reason: '현금 부족' },
    ];
    panel({ frame: frame({ pending: [{ symbol: '005930', reason: '3일 연속 상승' }] }), trades, skipped });
    expect(within(screen.getByRole('list', { name: '예약 매수' })).getAllByRole('listitem').map(text)).toEqual(['다음 거래일 시가에 사요: 삼성전자 — 3일 연속 상승']);
    expect(within(screen.getByRole('list', { name: '그날 체결' })).getAllByRole('listitem').map(text)).toEqual([
      '삼성전자 · B 돌파 매수 · 14주 · 70,000원',
      'SK하이닉스 · 1단계 익절(80% 매도) · 12주 · 80,500원',
    ]);
    expect(within(screen.getByRole('list', { name: '그날 건너뜀' })).getAllByRole('listitem').map(text)).toEqual(['현금이 모자랐어요 · SK하이닉스, 삼성전자']);
  });

  it('체결·건너뜀·예약이 없으면 그 목록을 그리지 않는다', () => {
    panel();
    for (const name of ['예약 매수', '그날 체결', '그날 건너뜀']) expect(screen.queryByRole('list', { name })).toBeNull();
  });

  it('axe 위반이 없다', async () => {
    const { container } = panel({
      frame: frame({ holdings: [holding(), holding({ symbol: '000660', stop: null })], pending: [{ symbol: '005930', reason: 'B 돌파' }] }),
      trades: [{ date: '2023-10-12', symbol: '005930', kind: 'add', price: 68_000, qty: 3, fee: 1, tax: 0, reason: '추가 매수' }],
      skipped: [{ date: '2023-10-12', symbol: '000660', reason: '거래 없음' }],
    });
    await expectNoAxeViolations(container);
  });
});

describe('HoldingCard 가격 막대', () => {
  it('눈금·점 위치는 %로, 막대는 화면 낭독기에서 숨긴다', () => {
    const { container } = render(HoldingCard, { h: holding({ stop: 95, nextAdd: null, avgPrice: 100, takes: [{ stage: 1, price: 105 }, { stage: 2, price: 110 }], close: 102 }), name: '삼성전자' });
    const bar = container.querySelector('.bar')!;
    expect(bar.getAttribute('aria-hidden')).toBe('true');
    const left = (sel: string) => parseFloat((bar.querySelector(sel) as HTMLElement).style.left);
    expect(left('.tick.stop')).toBeCloseTo((0.75 / 16.5) * 100, 6);
    expect(left('.dot')).toBeCloseTo((7.75 / 16.5) * 100, 6);
    expect(bar.querySelectorAll('.tick')).toHaveLength(4);
    expect(bar.classList.contains('slide')).toBe(false);
  });

  it('motion이면 점이 미끄러지는 클래스를 단다', () => {
    const { container } = render(HoldingCard, { h: holding(), name: '삼성전자', motion: true });
    expect(container.querySelector('.bar')!.classList.contains('slide')).toBe(true);
  });
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `corepack pnpm test src/lib/ui/simulate/simText.test.ts src/lib/ui/simulate/DayPanel.test.ts`
Expected: FAIL. simText는 `priceMarks is not a function` 등, DayPanel은 `Failed to resolve import "./DayPanel.svelte"`.

- [ ] **Step 4: simText에 함수를 더한다**

`src/lib/ui/simulate/simText.ts` import 두 줄을 바꿔요:

```ts
import type { HoldingFrame, Skip, Strategy, Trade } from '../../sim/types';
import { addDays, kstDate, kstWeekday } from '../../time/kst';
```

`export const shortDate = ...` 줄 바로 뒤에 더해요:

```ts
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'] as const;
/** 재생 날짜: `2024-03-15` → `2024.03.15(금)` */
export const replayDate = (d: string): string => `${dots(d)}(${WEEKDAY[kstWeekday(d)]})`;

/**
 * 체결 사유(거래 내역·그날 상황): `B 돌파 매수`·`추가 매수`·`1단계 익절(80% 매도)`·`손절`.
 * 엔진의 `1단계 익절 80%`는 판 비율이라 `(80% 매도)`로 보인다.
 */
export function tradeWhy(t: Trade): string {
  if (t.kind === 'buy') return `${t.reason} 매수`;
  if (t.kind === 'add') return '추가 매수';
  return t.reason.replace(/^(\d+단계 익절) (\d+)%$/, '$1($2% 매도)');
}

// ── 그날 상황(재생) ──────────────────────────────────────

/** 손절·추가·익절 가격은 그날 종가 처리 뒤의 값이라 다음 거래일 장중 경로에 쓰인다 */
export const PRICE_BASIS_NOTE = '다음 거래일 기준';
/** 분할 매수 끝나기 전(avgAfterScaleIn)이라 손절가가 없을 때 */
export const STOP_PENDING_NOTE = '손절: 분할 매수 끝나면 정해져요';
export const NO_HOLDINGS = '보유한 종목이 없어요';
/** 그날 종가 신호 → 다음 거래일 시가 매수 예약 */
export const pendingText = (name: string, reason: string): string => `다음 거래일 시가에 사요: ${name} — ${reason}`;

export interface PriceMark {
  key: string;
  kind: 'stop' | 'add' | 'avg' | 'take';
  label: string;
  price: number;
  /** 막대 왼쪽에서의 위치(%) */
  left: number;
}

/** 가격 막대: 손절 · 다음 추가 · 평단 · 익절 눈금과 종가 점. 범위는 표시 가격(종가 포함)의 최소·최대에 여유 5% */
export function priceMarks(h: Pick<HoldingFrame, 'stop' | 'nextAdd' | 'avgPrice' | 'takes' | 'close'>): { marks: PriceMark[]; dot: number } {
  const single = h.takes.length === 1 && h.takes[0].stage === 1;
  const raw: Omit<PriceMark, 'left'>[] = [
    ...(h.stop === null ? [] : [{ key: 'stop', kind: 'stop' as const, label: '손절', price: h.stop }]),
    ...(h.nextAdd === null ? [] : [{ key: 'add', kind: 'add' as const, label: '다음 추가', price: h.nextAdd }]),
    { key: 'avg', kind: 'avg' as const, label: '평단', price: h.avgPrice },
    ...h.takes.map((t) => ({ key: `take${t.stage}`, kind: 'take' as const, label: single ? '익절' : `익절 ${t.stage}`, price: t.price })),
  ];
  const all = [...raw.map((m) => m.price), h.close];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const pad = (max - min || Math.abs(max) || 1) * 0.05;
  const lo = min - pad;
  const span = max + pad - lo;
  const at = (p: number) => ((p - lo) / span) * 100;
  return { marks: raw.map((m) => ({ ...m, left: at(m.price) })), dot: at(h.close) };
}
```

- [ ] **Step 5: TradeList가 공용 함수를 쓰게 바꾼다**

`src/lib/ui/simulate/TradeList.svelte`:
- 6행 import: `import { returnClass, shortDate, tradeWhy, trendReturn } from './simText';`
- 23-25행(`// 엔진의 ...` 주석, `const reason = ...`, `const why = ...`)을 지워요.
- 37행 `` `${shortDate(t.date)} · ${why(t)}${...}` ``의 `why(t)`를 `tradeWhy(t)`로 바꿔요.

- [ ] **Step 6: HoldingCard를 만든다**

`src/lib/ui/simulate/HoldingCard.svelte`:

```svelte
<script lang="ts">
  // 그날 보유 한 종목(설계 §4.4): 수량·평단·종가·평가액·수익률·보유 시작일, 손절·다음 추가·평단·익절 눈금과 종가 점.
  // 막대는 그림이라 화면 낭독기에서 숨기고, 같은 눈금을 아래 목록에 글로 둔다.
  import type { HoldingFrame } from '../../sim/types';
  import { fmtWon } from '../format';
  import { dotDate, PRICE_BASIS_NOTE, priceMarks, returnClass, STOP_PENDING_NOTE, trendReturn } from './simText';

  let { h, name, motion = false }: { h: HoldingFrame; name: string; motion?: boolean } = $props();

  const bar = $derived(priceMarks(h));
  const won = (n: number) => `${fmtWon(n)}원`;
</script>

<article class="holding" aria-label={name}>
  <p class="top"><b class="nm">{name}</b> <b class="num {returnClass(h.pnlPct)}">{trendReturn(h.pnlPct)}</b></p>
  <dl class="facts num">
    <div><dt>수량</dt> <dd>{fmtWon(h.qty)}주</dd></div>
    <div><dt>평단</dt> <dd>{won(h.avgPrice)}</dd></div>
    <div><dt>종가</dt> <dd>{won(h.close)}</dd></div>
    <div><dt>평가액</dt> <dd>{won(h.value)}</dd></div>
    <div><dt>보유 시작</dt> <dd>{dotDate(h.openDate)}</dd></div>
  </dl>
  <div class="bar" class:slide={motion} aria-hidden="true">
    {#each bar.marks as m (m.key)}<i class="tick {m.kind}" style:left="{m.left}%"></i>{/each}
    <span class="dot" style:left="{bar.dot}%"></span>
  </div>
  <ul class="levels num" aria-label="가격 눈금">
    {#each bar.marks as m (m.key)}<li>{m.label} {won(m.price)}</li>{/each}
  </ul>
  {#if h.stop === null}<p class="hint">{STOP_PENDING_NOTE}</p>{/if}
  <p class="hint">{PRICE_BASIS_NOTE}</p>
</article>

<style>
  .holding {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px;
    border-radius: var(--r-card);
    background: var(--surface);
  }
  .top {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    margin: 0;
  }
  .nm {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .facts {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 2px 12px;
    margin: 0;
    font-size: var(--fs-sub);
  }
  .facts div {
    display: flex;
    justify-content: space-between;
    gap: 6px;
  }
  dt {
    color: var(--t3);
  }
  dd {
    margin: 0;
  }
  .bar {
    position: relative;
    height: 16px;
    margin: 4px 5px;
  }
  .bar::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 7px;
    height: 2px;
    border-radius: 1px;
    background: var(--line);
  }
  .tick {
    position: absolute;
    top: 2px;
    width: 2px;
    height: 12px;
    margin-left: -1px;
    background: var(--t3);
  }
  .tick.stop {
    background: var(--down);
  }
  .tick.add {
    background: var(--accent);
  }
  .tick.avg {
    background: var(--t1);
  }
  .tick.take {
    background: var(--up);
  }
  .dot {
    position: absolute;
    top: 3px;
    width: 10px;
    height: 10px;
    margin-left: -5px;
    border-radius: 50%;
    background: var(--accent);
  }
  /* 하루만 움직일 때만(부모가 motion으로 판정) 점이 미끄러진다 */
  .slide .dot {
    transition: left 150ms ease;
  }
  @media (prefers-reduced-motion: reduce) {
    .slide .dot {
      transition: none;
    }
  }
  .levels {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 2px 12px;
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  .hint {
    margin: 0;
    font-size: var(--fs-sub);
    color: var(--t3);
  }
</style>
```

- [ ] **Step 7: DayPanel을 만든다**

`src/lib/ui/simulate/DayPanel.svelte`:

```svelte
<script lang="ts">
  // 그날 상황(설계 §4.4): 머리(날짜·총자산·현금·수익률) · 보유 카드 · 예약 매수 · 그날 체결 · 그날 건너뜀.
  // motion이면(하루만 움직였을 때) 새 보유 카드·새 체결 줄이 150ms 떠오른다. 아니면 duration 0이라 효과 없이 값만 바뀐다.
  import { fly } from 'svelte/transition';
  import type { DayFrame, Skip, Trade } from '../../sim/types';
  import { fmtWon } from '../format';
  import HoldingCard from './HoldingCard.svelte';
  import { NO_HOLDINGS, pendingText, replayDate, returnClass, skipReasonLabel, tradeWhy, trendReturn } from './simText';

  let {
    frame,
    trades,
    skipped,
    names,
    initial,
    motion = false,
  }: {
    frame: DayFrame;
    /** 그날 체결만 */
    trades: Trade[];
    /** 그날 건너뜀만 */
    skipped: Skip[];
    names: Record<string, string>;
    initial: number;
    motion?: boolean;
  } = $props();

  const nameOf = (s: string) => names[s] ?? s;
  const ret = $derived((frame.value / initial - 1) * 100);
  const cashPct = $derived(frame.value > 0 ? Math.round((frame.cash / frame.value) * 100) : 0);
  const rise = $derived({ y: 8, duration: motion ? 150 : 0 });
  // 사유별로 종목 이름을 모은다: `현금이 모자랐어요 · SK하이닉스, 삼성전자`
  const skipGroups = $derived.by(() => {
    const by = new Map<Skip['reason'], string[]>();
    for (const k of skipped) {
      const list = by.get(k.reason) ?? [];
      const n = nameOf(k.symbol);
      if (!list.includes(n)) list.push(n);
      by.set(k.reason, list);
    }
    return [...by].map(([reason, list]) => ({ reason, text: `${skipReasonLabel(reason)} · ${list.join(', ')}` }));
  });
</script>

<section class="day" aria-label="그날 상황">
  <p class="when num">{replayDate(frame.date)}</p>
  <ul class="totals" aria-label="그날 자산">
    <li><span class="label">총자산</span> <b class="num">{fmtWon(frame.value)}원</b></li>
    <li><span class="label">현금</span> <b class="num">{fmtWon(frame.cash)}원 ({cashPct}%)</b></li>
    <li><span class="label">그날까지 수익률</span> <b class="num {returnClass(ret)}">{trendReturn(ret)}</b></li>
  </ul>

  {#if frame.holdings.length === 0}
    <p class="empty">{NO_HOLDINGS}</p>
  {:else}
    <ul class="cards" aria-label="보유 종목">
      {#each frame.holdings as h (h.symbol)}
        <li in:fly={rise}><HoldingCard {h} name={nameOf(h.symbol)} {motion} /></li>
      {/each}
    </ul>
  {/if}

  {#if frame.pending.length > 0}
    <ul class="lines" aria-label="예약 매수">
      {#each frame.pending as p (p.symbol)}<li>{pendingText(nameOf(p.symbol), p.reason)}</li>{/each}
    </ul>
  {/if}
  {#if trades.length > 0}
    <ul class="lines" aria-label="그날 체결">
      {#each trades as t (t)}
        <li in:fly={rise}><b>{nameOf(t.symbol)}</b> · {tradeWhy(t)} · <span class="num">{fmtWon(t.qty)}주 · {fmtWon(t.price)}원</span></li>
      {/each}
    </ul>
  {/if}
  {#if skipGroups.length > 0}
    <ul class="lines" aria-label="그날 건너뜀">
      {#each skipGroups as g (g.reason)}<li>{g.text}</li>{/each}
    </ul>
  {/if}
</section>

<style>
  .day {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .when {
    margin: 0;
    font-weight: 700;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .totals {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    font-size: var(--fs-sub);
  }
  .label {
    color: var(--t3);
  }
  /* 보유 카드는 한 줄에 하나 */
  .cards {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .lines {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  .lines b {
    color: var(--t1);
  }
  .empty {
    margin: 0;
    color: var(--t2);
  }
</style>
```

- [ ] **Step 8: 통과를 확인한다**

Run: `corepack pnpm test src/lib/ui/simulate/simText.test.ts src/lib/ui/simulate/DayPanel.test.ts src/lib/ui/simulate/TradeList.test.ts`
Expected: PASS 전부(TradeList 테스트는 고치지 않았고 그대로 통과).

- [ ] **Step 9: 타입 검사**

Run: `corepack pnpm check`
Expected: `0 errors`.

- [ ] **Step 10: 커밋**

```bash
git add src/lib/ui/simulate/simText.ts src/lib/ui/simulate/simText.test.ts src/lib/ui/simulate/TradeList.svelte src/lib/ui/simulate/HoldingCard.svelte src/lib/ui/simulate/DayPanel.svelte src/lib/ui/simulate/DayPanel.test.ts
git commit -m "feat(simulate): 그날 상황 패널과 보유 카드를 만들고 체결 사유 문구를 공용으로 옮김" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 재생 막대 (`ReplayBar`)

▶/⏸ 버튼, 배속(`Segmented`), 날짜 줄, 네이티브 range 타임라인, 안내 문구, 멈췄을 때만 날짜를 알리는 live 영역을 그려요(설계 §4.2). 단축키는 range에만 걸어요.

**Files:**
- Create: `src/lib/ui/simulate/ReplayBar.svelte`
- Test: `src/lib/ui/simulate/ReplayBar.test.ts`

**Interfaces:**
- Consumes: Task 3의 `createReplay(opts: { length; now?; raf?; caf? }): Replay`, `type Replay`(`index`·`playing`·`speed`·`length`·`toggle()`·`seek(i)`·`setSpeed(s)`), `type ReplaySpeed`, `REPLAY_SPEEDS`(`./replay.svelte`). Task 5의 `replayDate(date: string): string`(`./simText`). 기존 `Segmented`(`@sch0718/ui-svelte`; props `options: { value: string; label: string }[]`, `value: string`, `onchange(value: string)`, `label?: string`; `role="radiogroup"`과 `role="radio"` 버튼을 그림).
- Produces: `ReplayBar.svelte` props `{ replay: Replay; dates: string[] }`(`dates.length === replay.length`). 루트는 `role="group" aria-label="재생"`, 날짜 줄은 `.when`, range는 `aria-label="거래일"`(role `slider`).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/ui/simulate/ReplayBar.test.ts`:

```ts
// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../share/testAxe';
import { createReplay } from './replay.svelte';
import ReplayBar from './ReplayBar.svelte';

const dates = ['2024-03-11', '2024-03-12', '2024-03-13', '2024-03-14', '2024-03-15'];
// 프레임을 부르지 않는 시계: 재생 상태만 바뀌고 날짜는 움직이지 않는다
const setup = () => {
  const replay = createReplay({ length: dates.length, now: () => 0, raf: () => 1, caf: () => {} });
  const r = render(ReplayBar, { replay, dates });
  return { replay, ...r };
};
const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim();

describe('ReplayBar', () => {
  it('처음: 재생 버튼, 마지막 날 날짜 줄, 안내 문구, range는 마지막 날', () => {
    const { container } = setup();
    const bar = screen.getByRole('group', { name: '재생' });
    expect(within(bar).getByRole('button', { name: '재생' })).toBeTruthy();
    expect(text(container.querySelector('.when'))).toBe('2024.03.15(금) · 5/5거래일');
    expect(within(bar).getByText('일봉 기준이라 하루 단위로 움직여요')).toBeTruthy();
    const range = within(bar).getByRole('slider', { name: '거래일' }) as HTMLInputElement;
    expect([range.min, range.max, range.step, range.value]).toEqual(['0', '4', '1', '4']);
    expect(range.getAttribute('aria-valuetext')).toBe('2024.03.15(금)');
  });

  it('▶을 누르면 처음으로 돌아가 재생, 버튼이 일시정지로 바뀌고 다시 누르면 멈춘다', async () => {
    const { replay, container } = setup();
    await fireEvent.click(screen.getByRole('button', { name: '재생' }));
    expect([replay.playing, replay.index]).toEqual([true, 0]);
    expect(text(container.querySelector('.when'))).toBe('2024.03.11(월) · 1/5거래일');
    await fireEvent.click(screen.getByRole('button', { name: '일시정지' }));
    expect(replay.playing).toBe(false);
    expect(screen.getByRole('button', { name: '재생' })).toBeTruthy();
  });

  it('배속: 1×·2×·4×·8×·16×, 누르면 바뀐다', async () => {
    const { replay } = setup();
    const speed = screen.getByRole('radiogroup', { name: '배속' });
    expect(within(speed).getAllByRole('radio').map((b) => b.textContent?.trim())).toEqual(['1×', '2×', '4×', '8×', '16×']);
    expect(within(speed).getByRole('radio', { name: '1×' }).getAttribute('aria-checked')).toBe('true');
    await fireEvent.click(within(speed).getByRole('radio', { name: '8×' }));
    expect(replay.speed).toBe(8);
    expect(within(speed).getByRole('radio', { name: '8×' }).getAttribute('aria-checked')).toBe('true');
  });

  it('range를 옮기면 그날로 이동하고 일시정지', async () => {
    const { replay, container } = setup();
    replay.play();
    await fireEvent.input(screen.getByRole('slider', { name: '거래일' }), { target: { value: '2' } });
    expect([replay.index, replay.playing, replay.touched]).toEqual([2, false, true]);
    expect(text(container.querySelector('.when'))).toBe('2024.03.13(수) · 3/5거래일');
    expect(screen.getByRole('slider', { name: '거래일' }).getAttribute('aria-valuetext')).toBe('2024.03.13(수)');
  });

  it('range에서 Space는 재생/일시정지를 한 번만 바꾸고 기본 동작을 막는다', async () => {
    const { replay } = setup();
    const range = screen.getByRole('slider', { name: '거래일' });
    const notPrevented = await fireEvent.keyDown(range, { key: ' ' });
    expect(notPrevented).toBe(false);
    expect(replay.playing).toBe(true);
    await fireEvent.keyDown(range, { key: ' ' });
    expect(replay.playing).toBe(false);
  });

  it('멈췄을 때만 날짜를 live 영역으로 알린다', async () => {
    const { container } = setup();
    const live = container.querySelector('[aria-live="polite"]')!;
    expect(text(live)).toBe('2024.03.15(금)');
    await fireEvent.click(screen.getByRole('button', { name: '재생' }));
    expect(text(live)).toBe('');
  });

  it('axe 위반이 없다', async () => {
    const { container } = setup();
    await expectNoAxeViolations(container);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `corepack pnpm test src/lib/ui/simulate/ReplayBar.test.ts`
Expected: FAIL, `Failed to resolve import "./ReplayBar.svelte"`.

- [ ] **Step 3: 재생 막대를 만든다**

`src/lib/ui/simulate/ReplayBar.svelte`:

```svelte
<script lang="ts">
  // 재생 막대(설계 §4.2): ▶/⏸ · 배속 · 날짜 · 타임라인(range).
  // 단축키는 range에만 건다: Space = 재생/일시정지, ←/→·Home/End는 range 기본 동작 → oninput → seek.
  // 버튼과 Segmented에는 따로 키 핸들러를 달지 않는다(이벤트가 겹치지 않게).
  import { Segmented } from '@sch0718/ui-svelte';
  import { REPLAY_SPEEDS, type Replay, type ReplaySpeed } from './replay.svelte';
  import { replayDate } from './simText';

  let { replay, dates }: { replay: Replay; dates: string[] } = $props();

  const day = $derived(replayDate(dates[replay.index] ?? dates.at(-1) ?? ''));
  const speedOptions = REPLAY_SPEEDS.map((s) => ({ value: String(s), label: `${s}×` }));

  function onkeydown(e: KeyboardEvent) {
    if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      replay.toggle();
    }
  }
</script>

<div class="replay" role="group" aria-label="재생">
  <div class="top">
    <button type="button" class="play" aria-label={replay.playing ? '일시정지' : '재생'} onclick={() => replay.toggle()}>
      <span aria-hidden="true">{replay.playing ? '⏸' : '▶'}</span>
    </button>
    <p class="when num">{day} · {replay.index + 1}/{replay.length}거래일</p>
    <div class="speed">
      <Segmented label="배속" value={String(replay.speed)} options={speedOptions} onchange={(v) => replay.setSpeed(Number(v) as ReplaySpeed)} />
    </div>
  </div>
  <input
    class="range"
    type="range"
    min="0"
    max={replay.length - 1}
    step="1"
    value={replay.index}
    aria-label="거래일"
    aria-valuetext={day}
    oninput={(e) => replay.seek(Number(e.currentTarget.value))}
    {onkeydown}
  />
  <p class="note">일봉 기준이라 하루 단위로 움직여요</p>
  <!-- 재생 중에는 매일 알리지 않고, 멈췄을 때 날짜만 알린다 -->
  <p class="sr-only" aria-live="polite">{replay.playing ? '' : day}</p>
</div>

<style>
  .replay {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .top {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
  .play {
    min-width: var(--touch);
    min-height: var(--touch);
    border-radius: 12px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: var(--fs-title);
  }
  .when {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  .speed {
    margin-left: auto;
  }
  /* 좁은 화면(< 480px): 배속은 재생 버튼·날짜 아래 별도 줄 */
  @media (max-width: 479px) {
    .speed {
      flex-basis: 100%;
      margin-left: 0;
    }
  }
  .range {
    width: 100%;
    min-height: var(--touch);
    margin: 0;
    accent-color: var(--accent);
  }
  .note {
    margin: 0;
    font-size: var(--fs-sub);
    color: var(--t3);
  }
</style>
```

- [ ] **Step 4: 통과를 확인한다**

Run: `corepack pnpm test src/lib/ui/simulate/ReplayBar.test.ts`
Expected: PASS(7 tests).

- [ ] **Step 5: 타입 검사**

Run: `corepack pnpm check`
Expected: `0 errors`.

- [ ] **Step 6: 커밋**

```bash
git add src/lib/ui/simulate/ReplayBar.svelte src/lib/ui/simulate/ReplayBar.test.ts
git commit -m "feat(simulate): 재생 버튼·배속·거래일 타임라인이 있는 재생 막대를 만듦" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 결과 화면 통합 + e2e·a11y

`ResultView`가 결과마다 재생 컨트롤러를 만들고 정리하며, 보일 조건을 만족할 때 자산 차트 아래에 재생 막대와 「그날 상황」(접힘/펼침)을 둬요. 「결과 공유」는 재생을 처음 상태로 되돌리고 `tick()` 뒤에 대화상자를 열어요. 하루만 움직였을 때만 효과를 켜고 움직임 줄이기를 따라요(설계 §3, §4.1, §4.5, §5). e2e·a11y로 실제 브라우저 흐름을 확인해요.

**Files:**
- Modify: `src/lib/ui/simulate/resultFixture.ts`(함수 추가)
- Modify: `src/lib/ui/simulate/ResultView.svelte`(import, script 추가, 공유 버튼, 차트 props, 재생 블록, style)
- Test: `src/lib/ui/simulate/ResultView.test.ts`(import, 기존 공유 테스트 한 줄, describe 추가)
- Modify: `tests/e2e/simulate.spec.ts`(테스트 추가)
- Modify: `tests/e2e/a11y.spec.ts`(시뮬레이션 결과 테스트 끝에 단계 추가)

**Interfaces:**
- Consumes:
  - Task 2: `SimResult.timeline?: DayFrame[]`, `DayFrame`·`HoldingFrame`(`src/lib/sim/types.ts`).
  - Task 3: `createReplay({ length }): Replay`, `type Replay`(`index`·`touched`·`playing`·`speed`·`delta`·`seek(i)`·`reset()`·`destroy()`), `replayMotion(r, reduced: boolean): boolean`(`./replay.svelte`).
  - Task 4: `EquityChart` props `upTo?: number`, `trades?: Trade[]`.
  - Task 5: `DayPanel` props `{ frame: DayFrame; trades: Trade[]; skipped: Skip[]; names: Record<string, string>; initial: number; motion?: boolean }`, 루트 `<section aria-label="그날 상황">`, 보유 카드 `<article aria-label={종목명}>`, 「보유한 종목이 없어요」.
  - Task 6: `ReplayBar` props `{ replay: Replay; dates: string[] }`, 루트 `role="group" aria-label="재생"`, 날짜 줄 `.when`(`YYYY.MM.DD(요일) · i/n거래일`), range `aria-label="거래일"`, 버튼 `재생`/`일시정지`.
  - 기존: `doneState(patch?)`·`noTrades(s, skipped?)`(`resultFixture.ts`; equity 3일 `2023-10-11`·`2023-10-12`·`2026-10-08`, 거래 4건), lwc 가짜(`lwcCharts`, `StubSeries.data`·`markers`).
- Produces: `withTimeline(s: DoneState): void`(`resultFixture.ts`) — equity와 같은 날짜의 timeline을 붙여요(둘째 날에만 삼성전자 보유, 첫날에 SK하이닉스 예약).

- [ ] **Step 1: 테스트 고정 데이터에 timeline 도우미를 더한다**

`src/lib/ui/simulate/resultFixture.ts` 끝에 더해요:

```ts
/** 재생 기록(timeline)을 붙인다: equity와 같은 날짜, 둘째 날에만 삼성전자 보유, 첫날에 SK하이닉스 예약 */
export function withTimeline(s: DoneState): void {
  s.result.timeline = s.result.equity.map((e, i) => ({
    date: e.date,
    cash: e.cash,
    value: e.strategy,
    holdings:
      i === 1
        ? [{ symbol: '005930', qty: 14, avgPrice: 70_000, close: 71_000, value: 994_000, pnlPct: (71_000 / 70_000 - 1) * 100, stop: 66_500, nextAdd: null, takes: [{ stage: 1, price: 80_500 }], openDate: '2023-10-12' }]
        : [],
    pending: i === 0 ? [{ symbol: '000660', reason: 'B 돌파' }] : [],
  }));
}
```

- [ ] **Step 2: 실패하는 ResultView 테스트를 쓴다**

`src/lib/ui/simulate/ResultView.test.ts`:

(a) import 줄을 바꿔요:

```ts
import { doneState, noTrades, withTimeline } from './resultFixture';
```

(b) 「ResultView 결과 공유」의 「onShare가 있으면 머리줄에 결과 공유 단추」 안 `expect(onShare).toHaveBeenCalledTimes(1);`을 바꿔요(핸들러가 `await tick()` 뒤에 부름):

```ts
    await vi.waitFor(() => expect(onShare).toHaveBeenCalledTimes(1));
```

(c) 파일 끝에 더해요:

```ts
describe('ResultView 재생', () => {
  // jsdom에는 matchMedia가 없다. 움직임 줄이기를 켠 것처럼 두어 fly 효과(element.animate, jsdom에 없음)를 부르지 않는다
  const reducedMotion = (query: string) => ({
    matches: query.includes('reduce'),
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  });
  beforeEach(() => vi.stubGlobal('matchMedia', reducedMotion));

  const withReplay = () => {
    const s = doneState();
    withTimeline(s);
    return s;
  };
  const strategySeries = () => lwcCharts.at(-1)!.series[0];
  const realPoints = () => (strategySeries().data as { value?: number }[]).filter((p) => p.value !== undefined).length;

  it('timeline이 있으면 재생 막대와 「그날 상황 보기」가 보이고, 건드리기 전 차트는 지금과 같다', async () => {
    setup(withReplay());
    expect(screen.getByRole('group', { name: '재생' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '그날 상황 보기' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: '그날 상황' })).toBeNull();
    await vi.waitFor(() => expect(lwcCharts.at(-1)?.series).toHaveLength(4));
    expect(strategySeries().data).toHaveLength(3);
    expect(realPoints()).toBe(3);
    expect(strategySeries().markers).toEqual([]);
  });

  it('timeline이 없으면(공유에서 복원한 결과) 재생 막대가 없다', () => {
    setup();
    expect(screen.queryByRole('group', { name: '재생' })).toBeNull();
    expect(screen.queryByRole('button', { name: '그날 상황 보기' })).toBeNull();
  });

  it('timeline 길이가 equity와 다르면 숨기고 console.error를 남긴다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const s = withReplay();
      s.result.timeline!.pop();
      setup(s);
      expect(screen.queryByRole('group', { name: '재생' })).toBeNull();
      await vi.waitFor(() => expect(err).toHaveBeenCalled());
    } finally {
      err.mockRestore();
    }
  });

  it('거래일이 1일이거나 거래가 0건이면 숨긴다', () => {
    const one = doneState((s) => (s.result.equity = s.result.equity.slice(0, 1)));
    withTimeline(one);
    const a = setup(one);
    expect(screen.queryByRole('group', { name: '재생' })).toBeNull();
    a.unmount();
    const none = doneState();
    noTrades(none);
    withTimeline(none);
    setup(none);
    expect(screen.queryByRole('group', { name: '재생' })).toBeNull();
  });

  it('「그날 상황 보기」를 누르면 마지막 날 패널이 펼쳐지고, 타임라인으로 옮기면 패널과 차트가 따라간다', async () => {
    setup(withReplay());
    await fireEvent.click(screen.getByRole('button', { name: '그날 상황 보기' }));
    const panel = () => screen.getByRole('region', { name: '그날 상황' });
    expect(within(panel()).getByText('보유한 종목이 없어요')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '그날 상황 보기' })).toBeNull();
    await vi.waitFor(() => expect(realPoints()).toBe(3)); // upTo = 마지막 날
    expect(strategySeries().data).toHaveLength(3);

    await fireEvent.input(screen.getByRole('slider', { name: '거래일' }), { target: { value: '1' } });
    expect(within(panel()).getByRole('article', { name: '삼성전자' })).toBeTruthy();
    await vi.waitFor(() => expect(realPoints()).toBe(2));

    await fireEvent.input(screen.getByRole('slider', { name: '거래일' }), { target: { value: '0' } });
    expect(within(panel()).getByText('다음 거래일 시가에 사요: SK하이닉스 — B 돌파')).toBeTruthy();
  });

  it('결과 공유: 재생을 처음 상태로 되돌리고(패널 접힘·전체 곡선) 그 뒤에 onShare를 부른다', async () => {
    let seen: { panel: boolean; points: number } | null = null;
    const onShare = vi.fn(() => {
      seen = { panel: document.querySelector('[aria-label="그날 상황"]') !== null, points: realPoints() };
    });
    render(ResultView, { state: withReplay(), colorConvention: 'kr', onEdit: vi.fn(), onShare });
    await fireEvent.click(screen.getByRole('button', { name: '그날 상황 보기' }));
    await fireEvent.input(screen.getByRole('slider', { name: '거래일' }), { target: { value: '0' } });
    await vi.waitFor(() => expect(realPoints()).toBe(1));
    await fireEvent.click(screen.getByRole('button', { name: '결과 공유' }));
    await vi.waitFor(() => expect(onShare).toHaveBeenCalledTimes(1));
    expect(seen).toEqual({ panel: false, points: 3 });
    expect(screen.getByRole('button', { name: '그날 상황 보기' })).toBeTruthy();
  });

  it('결과가 바뀌면 이전 컨트롤러를 정리하고 새로 만든다(재생 상태가 처음으로)', async () => {
    const { rerender } = setup(withReplay());
    await fireEvent.click(screen.getByRole('button', { name: '그날 상황 보기' }));
    expect(screen.getByRole('region', { name: '그날 상황' })).toBeTruthy();
    await rerender({ state: withReplay(), colorConvention: 'kr', theme: 'system', onEdit: vi.fn() });
    await vi.waitFor(() => expect(screen.getByRole('button', { name: '그날 상황 보기' })).toBeTruthy());
    expect(screen.queryByRole('region', { name: '그날 상황' })).toBeNull();
  });
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `corepack pnpm test src/lib/ui/simulate/ResultView.test.ts`
Expected: FAIL. 기존 테스트는 통과하고, 「ResultView 재생」에서 재생 막대·「그날 상황 보기」를 찾지 못해 실패해요(「timeline이 없으면」·「거래일이 1일이거나」는 통과).

- [ ] **Step 4: ResultView를 고친다**

`src/lib/ui/simulate/ResultView.svelte`:

(a) `<script lang="ts">`의 import 끝(`import { cardAlt, composeCard, readCardColors, simResultCardText } from '../../share/cardImage';` 뒤)에 더해요:

```ts
  import { tick, untrack } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import DayPanel from './DayPanel.svelte';
  import ReplayBar from './ReplayBar.svelte';
  import { createReplay, replayMotion, type Replay } from './replay.svelte';
```

(b) `const noTrades = $derived(result.trades.length === 0);` 줄 바로 뒤에 더해요:

```ts
  // 재생(설계 §3·§4.1): 결과마다 컨트롤러를 하나 만들고, 결과가 바뀌거나 화면을 떠나면 정리한다.
  // createReplay가 자기 $state를 읽어도 이 effect의 의존성이 되지 않게 untrack으로 감싼다. 첫 렌더에서는 undefined다.
  let replay = $state.raw<Replay>();
  $effect(() => {
    const n = result.equity.length;
    const r = untrack(() => createReplay({ length: n }));
    replay = r;
    return () => r.destroy();
  });
  const timeline = $derived(result.timeline);
  const dates = $derived(result.equity.map((e) => e.date));
  // 엔진 버그 방어: 길이가 다르면 재생을 숨긴다
  const timelineBroken = $derived(timeline !== undefined && timeline.length !== result.equity.length);
  $effect(() => {
    if (timelineBroken) console.error('재생 기록 길이가 자산 곡선과 달라 재생을 숨겨요', timeline?.length, result.equity.length);
  });
  // 재생 막대·패널: 기록이 있고 길이가 맞고, 거래일 2일 이상, 거래 1건 이상(거래 0건이면 자산 곡선이 없다)
  const canReplay = $derived(timeline !== undefined && !timelineBroken && result.equity.length >= 2 && !noTrades);
  // 재생을 건드리기 전에는 차트를 지금 그대로(upTo 없음) 둔다
  const upTo = $derived(canReplay && replay?.touched ? replay.index : undefined);
  const frame = $derived(canReplay && replay && timeline ? (timeline[replay.index] ?? null) : null);
  const dayTrades = $derived(frame ? result.trades.filter((t) => t.date === frame.date) : []);
  const daySkipped = $derived(frame ? result.skipped.filter((k) => k.date === frame.date) : []);
  // 움직임 줄이기면 효과 없이 값만 바꾼다. svelte/motion의 prefersReducedMotion은 불러오는 순간 matchMedia를 불러 jsdom에서 깨진다
  const reducedQuery = typeof matchMedia === 'function' ? new MediaQuery('(prefers-reduced-motion: reduce)') : null;
  const motion = $derived(replay ? replayMotion(replay, reducedQuery?.current ?? false) : false);

  /** 「그날 상황 보기」: 움직이지 않고 touched만 켠다 */
  function openDay() {
    if (replay) replay.seek(replay.index);
  }
  /** 공유 카드는 늘 최종 곡선·마커 없음으로 찍히게, 대화상자를 열기 전에 재생을 처음 상태로 되돌린다 */
  async function share() {
    replay?.reset();
    await tick();
    onShare?.();
  }
```

(c) 머리줄의 공유 버튼(137행)을 바꿔요:

```svelte
    {#if onShare}<button type="button" class="share" onclick={share}>결과 공유</button>{/if}
```

(d) `{#key result}` 블록(175-183행)을 바꾸고 바로 뒤에 재생 블록을 더해요:

```svelte
    {#key result}
      <EquityChart bind:this={equityChart}
        equity={result.equity}
        initial={meta.strategy.capital.initial}
        labels={{ benchmark: benchName, index: meta.strategy.benchmarks.index }}
        {theme}
        {sampledNote}
        {upTo}
        trades={result.trades}
      />
    {/key}

    {#if canReplay && replay}
      <ReplayBar {replay} {dates} />
      {#if replay.touched && frame}
        <DayPanel {frame} trades={dayTrades} skipped={daySkipped} names={meta.names} initial={meta.strategy.capital.initial} {motion} />
      {:else}
        <button type="button" class="open-day" onclick={openDay}>그날 상황 보기</button>
      {/if}
    {/if}
```

(e) `<style>`의 `.share { ... }` 규칙 바로 뒤에 더해요:

```css
  .open-day {
    align-self: flex-start;
    min-height: var(--touch);
    padding: 0 12px;
    border-radius: 12px;
    background: var(--surface2);
    font-weight: 700;
  }
```

- [ ] **Step 5: 통과를 확인한다**

Run: `corepack pnpm test src/lib/ui/simulate/ResultView.test.ts src/routes/Simulate.test.ts`
Expected: PASS 전부(`Simulate.test.ts`는 실제 실행 결과에 timeline이 있어 재생 막대가 그려져도 그대로 통과). `Simulate.test.ts`가 깨지면 결과 화면의 버튼·radiogroup 개수를 세는 단언인지 먼저 봐요. 그렇다면 그 단언만 `within(...)`으로 범위를 좁히고, 동작 기대값은 바꾸지 않아요.

- [ ] **Step 6: 전체 단위 테스트·타입 검사**

Run: `corepack pnpm test && corepack pnpm check`
Expected: 전체 PASS(골든 `Snapshots 3 passed`), `0 errors`.

- [ ] **Step 7: e2e 재생 흐름을 더한다**

`tests/e2e/simulate.spec.ts`의 첫 번째 `test('시뮬레이션: 새 전략 → 실행 → ...')` 블록이 끝난 바로 뒤에 더해요:

```ts
test('시뮬레이션 재생: ▶ → 날짜가 바뀜 → ⏸ → 타임라인 처음 → 그날 상황', async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await openApp(page);
  await enterDemo(page);
  await loadExampleGroup(page);
  await page.getByRole('banner').getByRole('button', { name: '시뮬레이션', exact: true }).click();
  await page.getByRole('button', { name: '＋ 새 전략' }).click();
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();

  const result = page.getByRole('region', { name: '시뮬레이션 결과' }).last();
  await expect(result.getByText('총수익률', { exact: true })).toBeVisible({ timeout: 30_000 });
  const bar = result.getByRole('group', { name: '재생' });
  await expect(bar).toBeVisible();
  const when = bar.locator('.when');
  const last = (await when.textContent())!.trim();
  expect(last).toMatch(/^\d{4}\.\d{2}\.\d{2}\([일월화수목금토]\) · (\d+)\/\1거래일$/);

  // ▶: 마지막 날에서 누르면 처음으로 돌아가 재생
  await bar.getByRole('button', { name: '재생' }).click();
  await expect(bar.getByRole('button', { name: '일시정지' })).toBeVisible();
  await expect(when).not.toHaveText(last);
  await expect(result.getByRole('region', { name: '그날 상황' })).toBeVisible();
  await bar.getByRole('button', { name: '일시정지' }).click();
  await expect(bar.getByRole('button', { name: '재생' })).toBeVisible();

  // 타임라인 처음(Home): 첫 거래일에는 아직 산 종목이 없다
  const range = bar.getByRole('slider', { name: '거래일' });
  await range.focus();
  await page.keyboard.press('Home');
  await expect(range).toHaveValue('0');
  await expect(when).toContainText(/ · 1\/\d+거래일$/);
  await expect(result.getByRole('region', { name: '그날 상황' })).toContainText('보유한 종목이 없어요');

  await expectNoHorizontalScroll(page);
  await shot(page, testInfo, 'sim-4-replay');
  expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
});
```

- [ ] **Step 8: a11y에 재생 막대·펼친 패널을 더한다**

`tests/e2e/a11y.spec.ts`의 `test('시뮬레이션 목록·편집·결과 화면에 심각한 접근성 위반이 없다', ...)` 안 마지막 줄 `await expectNoHorizontalScroll(page);` 뒤(테스트 블록 닫기 전)에 더해요:

```ts

  // 재생 막대와 펼친 「그날 상황」(마지막 날: 보유 카드가 있을 수 있다)
  await expect(result.getByRole('group', { name: '재생' })).toBeVisible();
  await result.getByRole('button', { name: '그날 상황 보기' }).click();
  await expect(result.getByRole('region', { name: '그날 상황' })).toBeVisible();
  await expectNoSeriousViolations(page, '시뮬레이션 결과(재생 막대·그날 상황)');
  await expectNoHorizontalScroll(page);
```

- [ ] **Step 9: e2e 타입 검사와 실행**

Run: `corepack pnpm check:e2e`
Expected: 오류 0.

Run: `corepack pnpm e2e tests/e2e/simulate.spec.ts tests/e2e/a11y.spec.ts`
Expected: 모든 프로젝트(phone·tablet-portrait·tablet-landscape·desktop)에서 PASS. 새 테스트 「시뮬레이션 재생: …」과 a11y 시뮬레이션 결과 테스트 포함. 실패하면 `test-results/`의 trace로 원인을 봐요(재생 막대가 안 보이면 데모 실행 결과에 `timeline`이 있는지, Task 2 Step 8을 확인).

- [ ] **Step 10: 커밋**

```bash
git add src/lib/ui/simulate/resultFixture.ts src/lib/ui/simulate/ResultView.svelte src/lib/ui/simulate/ResultView.test.ts tests/e2e/simulate.spec.ts tests/e2e/a11y.spec.ts
git commit -m "feat(simulate): 결과 화면에 재생 막대와 그날 상황을 붙이고 공유 전에 재생을 되돌림" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## 마무리 검증 (모든 Task 뒤)

- [ ] `corepack pnpm test` — 전체 PASS, 골든 `Snapshots 3 passed`(written·updated 없음).
- [ ] `corepack pnpm check` · `corepack pnpm check:e2e` — 오류 0.
- [ ] `corepack pnpm build` — 성공.
- [ ] `corepack pnpm e2e` — 전체 e2e PASS(빌드 포함, 몇 분).
- [ ] sync-worker는 바꾸지 않았지만 공유 검사(`checkShareSnapshot`)를 같이 쓰니 회귀만 확인해요: `corepack pnpm --filter sync-worker check`(오류 0), `corepack pnpm --filter sync-worker test`(PASS).
- [ ] `git diff main --stat -- src/lib/sync src/lib/share sync-worker` — 출력 없음(동기화·공유 형식 그대로).

---

## Self-Review

**1. 설계 대비 범위**

| 설계 | Task |
|---|---|
| §2.1 `HoldingFrame`·`DayFrame`·`SimResult.timeline?` | 2 (Step 6) |
| §2.2 하루 끝 기록·옵션·기본 꺼짐·runController만 켬·반올림 안 함·expandSimResult 그대로 | 2 (Step 7·8), 공유 파일 손대지 않음 |
| §2.3-1 골든 먼저 커밋 | 1 |
| §2.3-2 불변식·끈 경로 키 없음 | 2 (Step 1) |
| §3 컨트롤러 상태·동작·raf 진행·1초 자르기·끝에서 멈춤·생명주기(`untrack`, `$state.raw`) | 3, 7 (Step 4b) |
| §4.1 배치·보일 조건·`upTo`·공유 전 reset+tick·모바일 순서·배속 줄바꿈 | 7, 6 (CSS) |
| §4.2 재생 막대(버튼·배속·날짜·range·valuetext·안내·Space·live) | 6 |
| §4.3 `upTo`·setData effect·whitespace·autoscaleInfoProvider·범례·마커(간격 0)·`undefined` 되돌림·curves 제외·`markers.ts` | 4 |
| §4.4 패널·보유 카드·가격 막대·손절 null 안내·예약·`why` 이동·건너뜀·보유 없음 | 5 |
| §4.5 움직임(하루일 때만, 150ms fly·left), 움직임 줄이기 | 3 (`replayMotion`), 5 (`rise`·`.slide`), 7 (`motion`) |
| §5 길이 불일치 console.error·1일/0건 숨김·stale 재생 가능·raf 멈춤·destroy | 7, 3 |
| §6.1 단위(골든·timeline·replay) | 1, 2, 3 |
| §6.2 컴포넌트(ReplayBar·EquityChart·markers·DayPanel·HoldingCard·ResultView) | 4, 5, 6, 7 |
| §6.3 성능 | 2 (Step 3) |
| §6.4 e2e·a11y | 7 (Step 7·8) |

`stale` 결과도 재생돼요: 보일 조건에 `stale`을 넣지 않았어요.

**2. 자리표시자 검사:** TBD·TODO·「적절히 처리」·「Task N과 같이」 없음. 모든 코드 단계에 코드가 있어요.

**3. 이름·타입 일관성:** `createReplay`·`Replay`(`length`·`index`·`playing`·`speed`·`touched`·`delta`)·`replayMotion`·`REPLAY_SPEEDS`·`ReplaySpeed`(Task 3) ↔ Task 6·7. `tradeMarkers(list, barOf, mergeBars, color)`·`TRADE_LABEL`·`ColorToken`(Task 4) ↔ `TradeChartSheet`·`EquityChart`. `tradeWhy`·`replayDate`·`priceMarks`·`pendingText`·`NO_HOLDINGS`·`PRICE_BASIS_NOTE`·`STOP_PENDING_NOTE`(Task 5) ↔ `DayPanel`·`HoldingCard`·`ReplayBar`·`TradeList`. `SimOptions`·`simulate(input, opts?)`·`simulateCore(input, opts?)`(Task 2) ↔ 성능 테스트·runController. `withTimeline`(Task 7) ↔ ResultView 테스트. 골든 입력 키 3개는 Task 1 정의와 Task 2 테스트의 상수 `A`·`B`가 같은 문자열이에요.
