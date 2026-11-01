# 전략 빌더 PR② 엔진·화면 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 전략을 조건 블록으로 짜게 해요. 매수는 이동평균·RSI·거래량·가격·반등 패턴 블록을 AND/OR 묶음으로, 매도는 익절·손절에 트레일링 스톱·기간 청산·조건 매도를 더하고, 자금 배분 4방식을 고르게 해요. 앱이 v2 전략을 저장·동기화·공유하고, v1 전략은 읽을 때 옮겨요. 기존 전략의 결과는 골든 스냅샷과 한 원도 다르지 않아요.

**Architecture:**
- 지표(`indicators.ts`)와 조건식 평가기(`rules.ts`, `PatternTracker`와 같은 `signal/update/reset` 계약)를 먼저 독립 모듈로 만들어요. 반등 패턴 블록은 기존 `createPatternTracker`를 그대로 감싸요.
- v1 코드(타입·검증·기본값)를 `strategyV1.ts`로 옮기고 `toV2`를 더한 뒤, 앱 전체의 `Strategy`를 v2로 바꿔요. 저장은 새 키 `p:<id>:strategySet`에 하고 옛 키는 손대지 않아요(옛 키가 곧 백업).
- 엔진은 하루 순서(시가 예약 매도 → 시가 예약 매수 → 장중 `walkBar` → 종가 판정)를 지키며 배분·트레일링·기간 청산·조건 매도를 차례로 더해요. 매 단계 골든 스냅샷이 그대로여야 해요.
- 동기화는 엔진 첫 주기 전에 옮기기 단계(`migrate.ts`)로 `syncedHash`를 H1→H2로 앞당겨 가짜 충돌을 막아요. 요청에 `docVersion=2`를 붙여요.
- 화면은 「매수 조건」 묶음 편집기, 「매도」 토글, 배분 선택, 템플릿 3개, 결과·재생 표시를 더해요.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest 3(jsdom, @testing-library/svelte, axe-core 4.13.0), Playwright(@axe-core/playwright), Cloudflare Worker 공용 검사 코드(`dto.ts`·`snapshot.ts`).

**근거 문서:** `docs/superpowers/specs/2026-11-01-strategy-builder-design.md`(확정 설계, 3회 검토). 절 번호(§)는 이 설계를 가리켜요. PR①(`docs/superpowers/plans/2026-11-01-strategy-builder-pr1-server.md`, main 30fd21a)에서 들어간 것은 다시 만들지 않아요.

## 계획에서 정한 것 (설계가 열어 둔 부분)

| 항목 | 결정 | 이유 |
|---|---|---|
| Task 순서 | 지표 → 평가기 → v1 분리 → **v2 전환(타입·저장·문서·공유·엔진 매수)** → 배분 → 트레일링 → 예약 매도 → 결과·재생 → 동기화 옮기기 → 요약 문구(simText·shareText) → 선정 기준 → 경고 → 편집 화면 둘 → e2e | `Strategy` 타입을 바꾸는 순간 저장·문서·공유·엔진·화면이 함께 컴파일돼야 해서, 이름 교체(꼬리 없는 `sanitizeStrategies` 제거)와 저장 새 키를 Task 4로 묶고, 4a(타입·엔진)·4b(저장·문서)·4c(공유·내보내기)·4d(선정 기준·화면)로 나눠 각각 커밋해요. 4a~4c 동안은 svelte-check가 빨간 것을 허용하고 4d에서 전체 초록이에요. 나머지는 제안 순서 그대로예요 |
| 포지션 금액 | `SymState.posAmount`에 둬요(스펙 §4.4의 `Position.amount` 대신) | `Position` API를 덜 바꾸고 결과는 같아요 |
| `sanitizeEntry` 이름 | 그대로 두고 `strategyV1.ts`로 옮겨요(스펙 §15.1의 `sanitizePatternEntry` 이름 바꾸기는 하지 않아요) | Worker 공용 경로(`sanitizeCriteria`)가 쓰는 함수라 이름까지 바꾸면 계약 확인 범위만 넓어져요 |
| 패턴 블록 도우미 | 새 `src/lib/sim/patternBlock.ts`(`patternEntryOf`·`patternCount`) | 엔진·화면·선정 기준·문구가 같이 써요. `strategyV2.ts`(Worker 경로)에는 더하지 않아요 |
| 조건 판정 오차 | 「이상·이하」 비교에 `EPS = 1e-9`를 둬요 | `(90 / 100 − 1) × 100 = −9.999…`가 「−10% 이하」에서 빠지지 않게 해요 |
| 사유 길이 상한 | `rules.ts`에 `REASON_MAX = 40`을 따로 두고 테스트로 `checkResult.ts`의 값과 같음을 확인해요 | 엔진이 공유 코드를 끌어오지 않게 해요 |
| 계약 고정값 | Task 3에서 지금 코드로 v1 문서·v1 공유를 JSON 파일로 굳혀 두고, 이후 모든 Task가 그 파일이 계속 통과하는지 봐요 | N4: Worker 공용 경로 동작 무변화의 증거 |

### PR①-b 필요 여부

**필요 없어요.** PR②가 고치는 Worker 공용 파일(`dto.ts`·`snapshot.ts`·`strategyV2.ts`·`screen/defaults.ts`·`screen/validate.ts`)은 이름·import 자리만 바뀌거나 read 모드(Worker가 쓰지 않음)만 바뀌어요. create 모드와 `checkProfileDoc`의 판정은 같아요. Task 3의 계약 테스트와 Task 15의 Worker 테스트가 이를 확인해요. 구현 중 계약 테스트가 깨지면 그 변경을 멈추고 「PR①-b 필요」로 보고해요.

## Global Constraints

- **골든 스냅샷 고정.** `src/lib/sim/simulate.golden.test.ts`와 `src/lib/sim/__snapshots__/simulate.golden.test.ts.snap`은 바꾸지 않아요. `-u`로 갱신하지 않아요. 모든 엔진 Task 끝에서 통과해야 해요.
- **Worker 공용 경로 동작 무변화(N4).** `src/lib/sync/dto.ts`의 `checkProfileDoc`, `src/lib/share/snapshot.ts`의 `checkShareSnapshot(…, 'create')`, `sanitizeStrategiesV2`, `src/lib/share/checkResult.ts`, `src/lib/share/resultEnums.ts`, `src/lib/sync/forbidden.ts`, `sanitizeCriteria`의 판정을 바꾸지 않아요. 이름 바꾸기·파일 옮기기는 괜찮아요. Task 3의 `src/lib/sync/contract.test.ts`가 늘 통과해야 해요.
- PR①에서 이미 있는 것(다시 만들지 않음): `src/lib/sim/strategyV2.ts`의 `PatternEntry`·`Cond`·`CondGroup`·`SizingMode`·`StrategyV2`·`MAX_GROUPS = 4`·`MAX_CONDS = 5`·`defaultCond`·`sanitizeStrategiesV2`, `src/lib/sim/testStrategyV2.ts`의 `fullStrategyV2()`, `dto.ts`의 `PROFILE_DOC_MAX_VERSION = 2`·`APP_OUTDATED_CODE = '앱을 새로 고쳐 주세요'`·`ProfileDocV2`·`ProfileDoc`, `snapshot.ts`의 `STRATEGY_SHARE_MAX_VERSION = 2`, `Trade['kind']`의 `trail`·`time`·`signalSell`, `markers.ts`의 라벨·색, Worker `doc_v`·`docVersion`.
- 버전 값: `PROFILE_DOC_VERSION = 2`(Task 4), 공유 `strategy`·`simResult` 생성 `v = 2`(새 상수 `STRATEGY_SHARE_VERSION = 2`), `SHARE_VERSION = 1` 그대로(나머지 종류), `EXPORT_SCHEMA_VERSION = 2`. 요청 쿼리 `docVersion=2`.
- 저장 키: 새 키 `p:<id>:strategySet`(`profileKeys.strategySet`). 옛 키 `p:<id>:strategies`는 앱이 **쓰지 않아요**. 예외는 `applyProfileDoc`이 v1 문서를 받을 때 하나예요(§8.2).
- 옮기기 `toV2`: 매수 = 반등 패턴 블록 하나, 매도 = 익절·손절 `on: true`, 트레일링 `{ on: false, pct: 10 }`, 기간 청산 `{ on: false, days: 20 }`, 조건 매도 `{ on: false, groups: [] }`, `sizing: { mode: 'fixed', pct: perBuyPct }`. 순수 함수(시각·난수 없음).
- 하루 순서(§4.2): ① 시가 예약 매도 → ② 시가 예약 매수 → ③ 장중 `walkBar` → ④ 종가(보유면 매도 판정, 아니면 매수 판정, `update`·`reset`, 트레일 기준가 갱신). 마지막 거래일에는 예약을 만들지 않아요.
- 트레일링 기준가 = 매수 체결가와 보유 중 **종가**의 최댓값. 손절가 = 트레일 가격이면 `stop`. 갭 트레일도 `trail`(사유에 `(갭)`).
- 기간 청산 = 시장 축 `di − rt.openDay + 1 ≥ days`. 거래정지일도 세고 추가 매수로 다시 세지 않아요. 조건 매도와 같은 날이면 조건 매도.
- 배분: `fixed` = `roundMoney(initial × pct / 100)`, `equityPct` = `roundMoney(전 거래일 종가 총자산 × pct / 100)`(첫날 initial), `cashPct` = `roundMoney(그 순간 현금 × pct / 100)`, `equal` = `roundMoney(initial / input.stocks.length)`. 금액은 포지션을 열 때 정하고 추가 매수도 그 금액. 줄여 사지 않아요.
- 지표(§5): `rsi(c, n, start)` Wilder, `start = max(0, firstDayIdx − 250)`, 평균하락 0 → 100, 둘 다 0 → 50. 거래량 `v ≤ 0`·유한하지 않음 = 값 없음. `rollingMax(c, window, min)`은 `precompute.ts`의 것을 `min` 그대로 옮기고 엔진은 `min = window`. 워밍업 L: `rsi` = 251.
- 조건 판정 등호(§5.2): 「위·아래·돌파」 엄격, 「이상·이하·배 이상」 같음 포함(`EPS = 1e-9`).
- 사유: 처음 맞은 묶음의 조건 문구를 ` + `로 잇고 40자(UTF-16 `length`)를 넘으면 39자 + `…`. 패턴 블록 하나뿐인 묶음은 패턴 사유 그대로. 매수 줄의 `pattern` 키는 스냅샷이 있을 때만 넣어요.
- 금지 키(`FORBIDDEN_KEYS`)와 깊이 32: 새 필드 이름은 PR①에서 점검했어요. 새 필드를 더 만들지 않아요(`HoldingFrame.trail`·`heldDays`, `DayFrame.pendingSells`는 공유·동기화에 넣지 않는 재생 값이에요).
- 문체: 화면 문구는 해요체. 코드 주석은 지금 코드처럼 짧은 서술체.
- 검증 명령
  - 루트: `corepack pnpm test`(= `TZ=America/New_York vitest run`), `corepack pnpm check`, `corepack pnpm e2e`.
  - 한 파일: `TZ=America/New_York corepack pnpm vitest run <경로>`.
  - Worker: `cd sync-worker && npx vitest run && npx tsc -p tsconfig.json --noEmit`.

## File Structure

| 파일 | 만들기/고치기 | 책임 | Task |
|---|---|---|---|
| `src/lib/sim/indicators.ts` | 고치기 | `rsi`·`volumeRatio`·`rollingMax` | 1 |
| `src/lib/screen/precompute.ts` | 고치기 | `rollingMax` import(1), `resolveReboundEntry`·`MissingPatternError`(11) | 1, 4, 11 |
| `src/lib/sim/rules.ts` | 만들기 | `createRuleEvaluator`·`condReason`·`rulesLookback`·`RSI_START_BARS`·`REASON_MAX` | 2 |
| `src/lib/sim/strategyV1.ts` | 만들기 | `StrategyV1`·`newStrategyV1`·`sanitizeStrategiesV1`·`sanitizeEntry`·`toV2` | 3 |
| `src/lib/sync/__fixtures__/contract-v1.json` | 만들기 | 지금 코드로 굳힌 v1 문서·공유 | 3 |
| `src/lib/sync/contract.test.ts` | 만들기 | Worker 공용 경로 계약(N4) | 3, 15 |
| `src/lib/sim/strategyV2.ts` | 고치기(import만) | v1 검증을 `strategyV1.ts`에서 가져옴 | 3 |
| `src/lib/sim/types.ts` | 고치기 | `Strategy = StrategyV2`, 프레임 필드 | 4, 8 |
| `src/lib/sim/patternBlock.ts` | 만들기 | `patternEntryOf`·`patternCount` | 4 |
| `src/lib/sim/defaults.ts` | 고치기 | v2 `newStrategy`, `defaultPatternEntry` | 4 |
| `src/lib/sim/validate.ts` | 고치기 | 꼬리 없는 `sanitizeStrategies` 제거, v2 경고 | 4, 12 |
| `src/lib/sim/strategyStore.ts`, `src/lib/state/profileStore.ts`, `src/lib/state/app.svelte.ts` | 고치기 | 새 키 | 4 |
| `src/lib/sync/profileDoc.ts`, `dto.ts`, `engine.ts`, `store.ts`, `local.ts` | 고치기 | v2 문서 | 4 |
| `src/lib/state/exportImport.ts` | 고치기 | 내보내기 v2 | 4 |
| `src/lib/share/snapshot.ts`, `compact.ts`, `importPlan.ts` | 고치기 | 공유 v2 생성·read 옮기기 | 4 |
| `src/lib/sim/simulate.ts`, `position.ts`, `loadSimData.ts`, `summary.ts` | 고치기 | 엔진 | 4~8 |
| `src/lib/sim/testInputs.ts`, `simulate.test.ts`, `position.test.ts` | 고치기 | v1 → `toV2` 도우미 | 4, 6 |
| `src/lib/ui/simulate/editor/PatternFields.svelte` | 만들기(`EntrySection.svelte`를 옮김) | 반등 패턴 칸 | 4 |
| `src/lib/ui/simulate/simText.ts`, `HoldingCard.svelte`, `DayPanel.svelte`, `ResultView.svelte` | 고치기 | 결과·재생 | 8, 12 |
| `src/lib/sync/migrate.ts` | 만들기 | 옮기기 단계·해시 앞당김·옛 거절 기록 정리 | 9 |
| `src/lib/sync/api.ts`, `controller.svelte.ts`, `src/lib/ui/settings/SyncPanel.svelte` | 고치기 | `docVersion`, 문구 | 9 |
| `src/lib/share/pendingImport.ts`, `shareText.ts` | 고치기 | 가져오기·문구 | 10 |
| `src/lib/screen/validate.ts`, `runValidation.ts`, `defaults.ts`, `testData.ts`, `src/lib/ui/screen/CriteriaEditor.svelte` | 고치기 | 선정 기준 | 4, 11 |
| `src/lib/sim/templates.ts` | 만들기 | 템플릿 3개 | 14 |
| `src/lib/ui/simulate/editor/CondRow.svelte`, `CondGroupCard.svelte`, `CondGroupsEditor.svelte`, `BuyRulesSection.svelte` | 만들기 | 조건 묶음 편집 | 13 |
| `src/lib/ui/simulate/editor/ExitSection.svelte`, `PeriodSection.svelte`, `StrategyEditor.svelte`, `StrategyList.svelte` | 고치기 | 매도·배분·템플릿 | 4, 13, 14 |
| `tests/e2e/simulate.spec.ts`, `a11y.spec.ts` | 고치기 | 템플릿 시트·새 조건 실행 | 14, 15 |

---

### Task 1: 지표 (`rsi`·`volumeRatio`·`rollingMax`)

**Files:**
- Modify: `src/lib/sim/indicators.ts`
- Modify: `src/lib/screen/precompute.ts:176-188`(지역 `rollingMax` 삭제, import로)
- Test: `src/lib/sim/indicators.test.ts`(새 파일)

**Interfaces:**
- Produces:
  - `sma(closes: number[], period: number): (number | null)[]`(그대로)
  - `rsi(closes: number[], period: number, start?: number): (number | null)[]`
  - `volumeRatio(volumes: number[], period: number): (number | null)[]`
  - `rollingMax(c: number[], window: number, min: number): (number | null)[]`

- [ ] **Step 1: 실패 테스트 쓰기** — `src/lib/sim/indicators.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { rollingMax, rsi, volumeRatio } from './indicators';

// StockCharts의 14일 RSI 예시표 앞부분(스펙 §12.2) — 원본 표의 소수 넷째 자리 종가. 첫 값 70.533, 다음 66.319(검토에서 확인)
const SC = [44.3389, 44.0902, 44.1497, 43.6124, 44.3278, 44.8264, 45.0955, 45.4245, 45.8433, 46.0826, 45.8931, 46.0328, 45.614, 46.282, 46.282, 46.0028];

describe('rsi', () => {
  it('손으로 계산한 값: 기간 2', () => {
    // 변화 +1,+1,−1. i=2: 상승 평균 1, 하락 0 → 100. i=3: 상승 (1·1+0)/2=0.5, 하락 (0·1+1)/2=0.5 → 50
    expect(rsi([1, 2, 3, 2], 2)).toEqual([null, null, 100, 50]);
  });
  it('StockCharts 예시표 14일: 첫 값 70.53, 다음 66.32', () => {
    const r = rsi(SC, 14);
    expect(r.slice(0, 14).every((x) => x === null)).toBe(true);
    expect(r[14]).toBeCloseTo(70.533, 2);
    expect(r[15]).toBeCloseTo(66.319, 2);
  });
  it('특수값: 계속 오르면 100, 변화가 없으면 50', () => {
    expect(rsi([1, 2, 3, 4, 5], 3)[4]).toBe(100);
    expect(rsi([5, 5, 5, 5, 5], 3)[4]).toBe(50);
  });
  it('start부터 평활을 시작한다: 앞을 잘라도 같은 위치는 같은 값', () => {
    const c = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 5 + i * 0.1);
    const full = rsi(c, 14, 10);
    const cut = rsi(c.slice(10), 14, 0);
    for (let i = 24; i < 60; i++) expect(full[i]).toBeCloseTo(cut[i - 10]!, 10);
    expect(full[23]).toBeNull();
  });
  it('봉이 모자라면 모두 null', () => {
    expect(rsi([1, 2, 3], 3)).toEqual([null, null, null]);
  });
});

describe('volumeRatio', () => {
  it('오늘은 평균에서 빼고 전날까지 n개 평균과 비교한다', () => {
    expect(volumeRatio([10, 20, 30, 60], 3)).toEqual([null, null, null, 3]);
  });
  it('v ≤ 0은 값 없음: 평균에서 빼고, 오늘이 0이면 null', () => {
    expect(volumeRatio([10, 0, 30, 40], 3)[3]).toBe(2);
    expect(volumeRatio([10, 20, 30, 0], 3)[3]).toBeNull();
    expect(volumeRatio([0, 0, 0, 50], 3)[3]).toBeNull();
    expect(volumeRatio([10, Number.NaN, 30, 40], 3)[3]).toBe(2);
  });
});

describe('rollingMax', () => {
  it('오늘 포함 window개 최댓값, 개수가 min 미만이면 null', () => {
    expect(rollingMax([3, 1, 4, 1, 5], 3, 3)).toEqual([null, null, 4, 4, 5]);
    expect(rollingMax([3, 1, 4, 1, 5], 3, 1)).toEqual([3, 3, 4, 4, 5]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `TZ=America/New_York corepack pnpm vitest run src/lib/sim/indicators.test.ts`
Expected: FAIL — `rsi`·`volumeRatio`·`rollingMax`가 `indicators.ts`에 없어요.

- [ ] **Step 3: 구현** — `src/lib/sim/indicators.ts` 끝에 더해요.

```ts
/**
 * Wilder RSI(스펙 §5.1). start부터 평활을 시작해 받은 워밍업 길이와 상관없이 같은 기간이면 같은 값이 나온다.
 * start+period 앞은 null. 평균 하락이 0이면 100, 상승·하락이 모두 0이면 50.
 */
export function rsi(closes: number[], period: number, start = 0): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  const s = Math.max(0, start);
  if (period < 1 || closes.length <= s + period) return out;
  let gain = 0;
  let loss = 0;
  for (let k = s + 1; k <= s + period; k++) {
    const d = closes[k] - closes[k - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  const value = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
  out[s + period] = value();
  for (let i = s + period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + (d > 0 ? d : 0)) / period;
    loss = (loss * (period - 1) + (d < 0 ? -d : 0)) / period;
    out[i] = value();
  }
  return out;
}

/** 거래량이 있는 봉인가. 0 이하·NaN·Infinity는 값 없음(스펙 §5.1) */
const hasVolume = (v: number): boolean => Number.isFinite(v) && v > 0;

/** 오늘 거래량 ÷ 전날까지 period개 봉 중 거래량이 있는 봉의 평균. 오늘 값이 없거나 창에 값이 없으면 null */
export function volumeRatio(volumes: number[], period: number): (number | null)[] {
  return volumes.map((v, i) => {
    if (period < 1 || i < period || !hasVolume(v)) return null;
    let sum = 0;
    let n = 0;
    for (let k = i - period; k < i; k++) {
      if (!hasVolume(volumes[k])) continue;
      sum += volumes[k];
      n++;
    }
    return n === 0 ? null : v / (sum / n);
  });
}

/** 최근 window개 최대(오늘 포함). 개수가 min 미만이면 null. 단조 덱으로 O(n). 선정 기준(precompute)과 엔진이 같이 쓴다 */
export function rollingMax(c: number[], window: number, min: number): (number | null)[] {
  const out: (number | null)[] = new Array(c.length);
  const dq: number[] = [];
  let head = 0;
  for (let i = 0; i < c.length; i++) {
    while (dq.length > head && c[dq[dq.length - 1]] <= c[i]) dq.pop();
    dq.push(i);
    if (dq[head] <= i - window) head++;
    out[i] = Math.min(i + 1, window) < min ? null : c[dq[head]];
  }
  return out;
}
```

`src/lib/screen/precompute.ts`에서 지역 함수 `rollingMax`(주석 `// 최근 window개 최대. …`부터 함수 끝까지)를 지우고, 파일 위 import에 더해요.

```ts
import { rollingMax } from '../sim/indicators';
```

(`precompute.ts`가 이미 `../sim/indicators`에서 무엇을 가져오면 그 줄에 합쳐요.)

- [ ] **Step 4: 통과 확인**

Run: `TZ=America/New_York corepack pnpm vitest run src/lib/sim/indicators.test.ts src/lib/screen && corepack pnpm check`
Expected: PASS. 선정 기준 테스트도 그대로 통과해요(`rollingMax` 동작이 같아요).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/sim/indicators.ts src/lib/sim/indicators.test.ts src/lib/screen/precompute.ts
git commit -m "feat(sim): RSI·거래량 배수·롤링 최고가 지표를 더함"
```

---

### Task 2: 조건식 평가기 (`rules.ts`)

**Files:**
- Create: `src/lib/sim/rules.ts`
- Test: `src/lib/sim/rules.test.ts`

**Interfaces:**
- Consumes: `createPatternTracker`·`PatternTracker`(`src/lib/sim/pattern.ts`), `sma`·`rsi`·`volumeRatio`·`rollingMax`(Task 1), `Cond`·`CondGroup`·`PatternEntry`(`src/lib/sim/strategyV2.ts`), `PatternSnapshot`(`src/lib/sim/types.ts`), `Candle`(`src/lib/data/metrics.ts`)
- Produces:
  - `export const RSI_START_BARS = 250`, `export const REASON_MAX = 40`
  - `export interface RuleEvaluator { signal(i: number): { reason: string; snapshot?: PatternSnapshot } | null; update(i: number): void; reset(i: number): void; stats(): { maxDropPct: number; declineDays: number } | null; resetStats(): void }`
  - `export function createRuleEvaluator(candles: Candle[], groups: CondGroup[], firstDayIdx: number): RuleEvaluator`
  - `export function condReason(c: Cond): string`
  - `export function condLookback(c: Cond): number`, `export function rulesLookback(groups: CondGroup[]): number`

- [ ] **Step 1: 실패 테스트 쓰기** — `src/lib/sim/rules.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import type { Candle } from '../data/metrics';
import { REASON_MAX as SHARE_REASON_MAX } from '../share/checkResult';
import { createPatternTracker } from './pattern';
import { condReason, createRuleEvaluator, REASON_MAX, rulesLookback } from './rules';
import type { Cond, CondGroup } from './strategyV2';
import { defaultCond } from './strategyV2';
import { randomWalk } from './testInputs';
import { bar, tradingDates } from './testBars';

const D = tradingDates('2026-01-05', 80);
const closes = (xs: number[], vols?: number[]): Candle[] => xs.map((c, i) => ({ ...bar(D[i], c, c, c, c), v: vols ? vols[i] : 100 }));
const one = (cond: Cond): CondGroup[] => [{ conds: [cond] }];
const hits = (candles: Candle[], groups: CondGroup[]) => {
  const ev = createRuleEvaluator(candles, groups, 0);
  const out: number[] = [];
  candles.forEach((_, i) => {
    if (ev.signal(i)) out.push(i);
    ev.update(i);
  });
  return out;
};

describe('condReason', () => {
  it('스펙 §4.7 문구', () => {
    expect(condReason({ kind: 'maPrice', period: 20, side: 'above' })).toBe('종가 20일선 위');
    expect(condReason({ kind: 'maCross', short: 20, long: 60, dir: 'golden' })).toBe('골든크로스 20/60');
    expect(condReason({ kind: 'maCross', short: 20, long: 60, dir: 'dead' })).toBe('데드크로스 20/60');
    expect(condReason({ kind: 'rsi', period: 14, level: 30, op: 'crossUp' })).toBe('RSI14 30 상향 돌파');
    expect(condReason({ kind: 'rsi', period: 14, level: 70, op: 'above' })).toBe('RSI14 70 위');
    expect(condReason({ kind: 'volume', days: 20, ratio: 1.5 })).toBe('거래량 20일 평균 1.5배↑');
    expect(condReason({ kind: 'change', days: 5, pct: 10, op: 'above' })).toBe('5일 +10% 이상');
    expect(condReason({ kind: 'change', days: 5, pct: -10, op: 'below' })).toBe('5일 −10% 이하');
    expect(condReason({ kind: 'fromHigh', days: 60, pct: 20 })).toBe('60일 고점 −20%↓');
    expect(condReason({ kind: 'newHigh', days: 60 })).toBe('60일 신고가');
  });
  it('사유 상한이 공유 검사(checkResult)와 같다', () => expect(REASON_MAX).toBe(SHARE_REASON_MAX));
});

describe('조건 판정(§5.2)', () => {
  it('maPrice: 같으면 위·아래 둘 다 불만족', () => {
    const c = closes([10, 10, 10, 12, 8, 10]);
    expect(hits(c, one({ kind: 'maPrice', period: 3, side: 'above' }))).toEqual([3]);
    expect(hits(c, one({ kind: 'maPrice', period: 3, side: 'below' }))).toEqual([4]);
  });
  it('maCross: 전날 이하 → 오늘 초과만 골든', () => {
    const c = closes([5, 5, 5, 5, 9, 9, 1, 1]);
    expect(hits(c, one({ kind: 'maCross', short: 1, long: 3, dir: 'golden' }))).toEqual([4]);
    expect(hits(c, one({ kind: 'maCross', short: 1, long: 3, dir: 'dead' }))).toEqual([6]);
  });
  it('rsi: 상향 돌파는 전날 ≤ 기준 < 오늘(같으면 넘은 것이 아님)', () => {
    // RSI(2): i=2 0, i=3 0, i=4 50, i=5 75. i=4는 50이라 「기준 초과」가 아니고 i=5에서 넘는다
    const c = closes([10, 9, 8, 7, 8, 9, 10, 11]);
    expect(hits(c, one({ kind: 'rsi', period: 2, level: 50, op: 'crossUp' }))).toEqual([5]);
  });
  it('volume: 배 이상은 같음 포함', () => {
    const c = closes([1, 1, 1, 1], [10, 10, 10, 20]);
    expect(hits(c, one({ kind: 'volume', days: 3, ratio: 2 }))).toEqual([3]);
  });
  it('change: 이하는 같음 포함(부동소수 오차 무시)', () => {
    const c = closes([100, 95, 90]);
    expect(hits(c, one({ kind: 'change', days: 2, pct: -10, op: 'below' }))).toEqual([2]);
    expect(hits(c, one({ kind: 'change', days: 2, pct: 10, op: 'above' }))).toEqual([]);
  });
  it('fromHigh: days개 최고 종가 대비', () => {
    const c = closes([100, 90, 80, 85]);
    expect(hits(c, one({ kind: 'fromHigh', days: 3, pct: 20 }))).toEqual([2]);
  });
  it('newHigh: 어제까지 days개 최고 종가를 넘으면(같으면 아님)', () => {
    const c = closes([10, 12, 11, 12, 13]);
    expect(hits(c, one({ kind: 'newHigh', days: 2 }))).toEqual([4]);
  });
  it('값이 모자란 구간은 불만족', () => {
    expect(hits(closes([1, 2]), one({ kind: 'maPrice', period: 5, side: 'above' }))).toEqual([]);
  });
});

describe('묶음', () => {
  const c = closes([10, 10, 10, 12, 13, 14], [1, 1, 1, 5, 1, 1]);
  it('묶음 안 AND: 하나라도 틀리면 불만족', () => {
    const g: CondGroup[] = [{ conds: [{ kind: 'maPrice', period: 3, side: 'above' }, { kind: 'volume', days: 3, ratio: 2 }] }];
    expect(hits(c, g)).toEqual([3]);
  });
  it('묶음끼리 OR: 처음 맞은 묶음의 사유', () => {
    const g: CondGroup[] = [{ conds: [{ kind: 'volume', days: 3, ratio: 2 }] }, { conds: [{ kind: 'maPrice', period: 3, side: 'above' }] }];
    const ev = createRuleEvaluator(c, g, 0);
    expect(ev.signal(3)?.reason).toBe('거래량 3일 평균 2배↑');
    expect(ev.signal(4)?.reason).toBe('종가 3일선 위');
  });
  it('빈 묶음은 맞지 않는다', () => {
    expect(hits(c, [{ conds: [] }])).toEqual([]);
  });
  it('사유가 40자를 넘으면 39자 + …', () => {
    const conds: Cond[] = Array.from({ length: 5 }, () => ({ kind: 'volume', days: 3, ratio: 1 }) as Cond);
    const r = createRuleEvaluator(c, [{ conds }], 0).signal(3)!.reason;
    expect(r).toHaveLength(40);
    expect(r.endsWith('…')).toBe(true);
  });
});

describe('패턴 블록 = 기존 추적기', () => {
  it('신호 날짜·사유·스냅샷·통계가 같다(reset 포함)', () => {
    const candles = randomWalk(tradingDates('2025-01-02', 300), 7);
    const entry = defaultCond('pattern').entry;
    const ev = createRuleEvaluator(candles, one({ kind: 'pattern', entry }), 0);
    const tr = createPatternTracker(candles, entry);
    for (let i = 0; i < candles.length; i++) {
      const a = ev.signal(i);
      const b = tr.signal(i);
      expect(a).toEqual(b ? { reason: b.reason, snapshot: b.snapshot } : null);
      ev.update(i);
      tr.update(i);
      if (i % 37 === 0) {
        ev.reset(i);
        tr.reset(i);
      }
    }
    expect(ev.stats()).toEqual(tr.stats());
  });
  it('패턴 블록이 없으면 stats()는 null이고 스냅샷이 없다', () => {
    const ev = createRuleEvaluator(closes([1, 2, 3, 4]), one({ kind: 'maPrice', period: 2, side: 'above' }), 0);
    expect(ev.stats()).toBeNull();
    expect(ev.signal(3)).toEqual({ reason: '종가 2일선 위' });
  });
});

describe('rulesLookback(§5.4)', () => {
  it('조건별 L의 최댓값', () => {
    expect(rulesLookback([])).toBe(0);
    expect(rulesLookback(one({ kind: 'rsi', period: 14, level: 30, op: 'crossUp' }))).toBe(251);
    expect(rulesLookback([{ conds: [{ kind: 'maCross', short: 20, long: 60, dir: 'golden' }, { kind: 'volume', days: 20, ratio: 1 }] }])).toBe(60);
    expect(rulesLookback(one({ kind: 'newHigh', days: 60 }))).toBe(61);
    const entry = defaultCond('pattern').entry;
    expect(rulesLookback(one({ kind: 'pattern', entry }))).toBe(0); // 기본 패턴은 이평을 쓰지 않는다
    expect(rulesLookback(one({ kind: 'pattern', entry: { ...entry, filter: { aboveMa: { on: true, period: 120 } } } }))).toBe(120);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `TZ=America/New_York corepack pnpm vitest run src/lib/sim/rules.test.ts`
Expected: FAIL — `Failed to resolve import "./rules"`.

- [ ] **Step 3: 구현** — `src/lib/sim/rules.ts`

```ts
// 조건식 평가기(전략 빌더 스펙 §4.1). PatternTracker와 같은 계약(signal/update/reset)이라 엔진이 그 자리에 그대로 넣는다.
// 반등 패턴 블록은 기존 createPatternTracker를 감싸 판정·상태·통계를 바꾸지 않는다.
import type { Candle } from '../data/metrics';
import { rollingMax, rsi, sma, volumeRatio } from './indicators';
import { createPatternTracker, type PatternTracker } from './pattern';
import type { Cond, CondGroup, PatternEntry } from './strategyV2';
import type { PatternSnapshot } from './types';

/** RSI는 기간 첫날 앞 이만큼의 봉에서 평활을 시작한다(스펙 §5.1) */
export const RSI_START_BARS = 250;
/** 체결 사유 상한. 공유 검사(checkResult.REASON_MAX)와 같아야 한다(테스트가 확인) */
export const REASON_MAX = 40;
/** 「이상·이하」 비교의 부동소수 여유 */
const EPS = 1e-9;

export interface RuleEvaluator {
  /** i번째 봉 종가로 묶음을 판정한다. 처음 맞은 묶음의 사유(패턴 블록이 맞았으면 스냅샷도). 상태는 바꾸지 않는다 */
  signal(i: number): { reason: string; snapshot?: PatternSnapshot } | null;
  /** i번째 봉 종가로 상태를 갱신한다. 판정과 상관없이 봉이 있는 날마다 부른다 */
  update(i: number): void;
  /** 전량 매도한 날 i에 부른다 */
  reset(i: number): void;
  /** 패턴 블록 통계(nearMiss). 패턴 블록이 없으면 null */
  stats(): { maxDropPct: number; declineDays: number } | null;
  resetStats(): void;
}

const signed = (x: number): string => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x)}%`;
const RSI_OP: Record<Extract<Cond, { kind: 'rsi' }>['op'], string> = { above: '위', below: '아래', crossUp: '상향 돌파', crossDown: '하향 돌파' };

/** 조건 한 줄의 사유 문구(스펙 §4.7). 패턴 블록은 추적기 사유를 쓰므로 여기서는 이름만 */
export function condReason(c: Cond): string {
  switch (c.kind) {
    case 'maPrice':
      return `종가 ${c.period}일선 ${c.side === 'above' ? '위' : '아래'}`;
    case 'maCross':
      return `${c.dir === 'golden' ? '골든' : '데드'}크로스 ${c.short}/${c.long}`;
    case 'rsi':
      return `RSI${c.period} ${c.level} ${RSI_OP[c.op]}`;
    case 'volume':
      return `거래량 ${c.days}일 평균 ${c.ratio}배↑`;
    case 'change':
      return `${c.days}일 ${signed(c.pct)} ${c.op === 'above' ? '이상' : '이하'}`;
    case 'fromHigh':
      return `${c.days}일 고점 −${c.pct}%↓`;
    case 'newHigh':
      return `${c.days}일 신고가`;
    case 'pattern':
      return '반등 패턴';
  }
}

/** 패턴 블록이 쓰는 켜진 이동평균 기간 중 최댓값(지금 loadSimData.longestMa와 같은 규칙) */
function patternLookback(e: PatternEntry): number {
  const periods = [0];
  if (e.triggers.maCross.on) periods.push(e.triggers.maCross.period);
  if (e.triggers.goldenCross.on) periods.push(e.triggers.goldenCross.short, e.triggers.goldenCross.long);
  if (e.filter.aboveMa.on) periods.push(e.filter.aboveMa.period);
  return Math.max(...periods);
}

/** 조건 하나가 기간 첫날 앞에 필요로 하는 봉 수(스펙 §5.4) */
export function condLookback(c: Cond): number {
  switch (c.kind) {
    case 'maPrice':
      return c.period;
    case 'maCross':
      return Math.max(c.short, c.long);
    case 'rsi':
      return RSI_START_BARS + 1;
    case 'volume':
    case 'change':
    case 'newHigh':
      return c.days + 1;
    case 'fromHigh':
      return c.days;
    case 'pattern':
      return patternLookback(c.entry);
  }
}

export function rulesLookback(groups: CondGroup[]): number {
  let L = 0;
  for (const g of groups) for (const c of g.conds) L = Math.max(L, condLookback(c));
  return L;
}

const cut = (s: string): string => (s.length > REASON_MAX ? `${s.slice(0, REASON_MAX - 1)}…` : s);

interface Compiled {
  cond: Cond;
  check: (t: number) => boolean;
  tracker: PatternTracker | null;
}

/**
 * 종목 하나의 봉 배열에 묶음 목록을 건다. firstDayIdx는 그 배열에서 기간 첫날(이상인 첫 봉)의 인덱스로, RSI 시작점에 쓴다.
 * 지표 배열은 만들 때 한 번 계산하고 같은 기간이면 같이 쓴다.
 */
export function createRuleEvaluator(candles: Candle[], groups: CondGroup[], firstDayIdx: number): RuleEvaluator {
  const c = candles.map((k) => k.c);
  const v = candles.map((k) => k.v);
  const memo = new Map<string, (number | null)[]>();
  const series = (key: string, make: () => (number | null)[]) => {
    let s = memo.get(key);
    if (!s) {
      s = make();
      memo.set(key, s);
    }
    return s;
  };
  const smaOf = (n: number) => series(`sma:${n}`, () => sma(c, n));
  const rsiOf = (n: number) => series(`rsi:${n}`, () => rsi(c, n, Math.max(0, firstDayIdx - RSI_START_BARS)));
  const volOf = (n: number) => series(`vol:${n}`, () => volumeRatio(v, n));
  const maxOf = (n: number) => series(`max:${n}`, () => rollingMax(c, n, n));
  const trackers: PatternTracker[] = [];

  const compile = (cond: Cond): Compiled => {
    const make = (check: (t: number) => boolean): Compiled => ({ cond, check, tracker: null });
    switch (cond.kind) {
      case 'maPrice': {
        const m = smaOf(cond.period);
        return make(cond.side === 'above' ? (t) => m[t] != null && c[t] > m[t]! : (t) => m[t] != null && c[t] < m[t]!);
      }
      case 'maCross': {
        const s = smaOf(cond.short);
        const l = smaOf(cond.long);
        return make((t) => {
          if (t < 1) return false;
          const s0 = s[t - 1];
          const s1 = s[t];
          const l0 = l[t - 1];
          const l1 = l[t];
          if (s0 == null || s1 == null || l0 == null || l1 == null) return false;
          return cond.dir === 'golden' ? s0 <= l0 && s1 > l1 : s0 >= l0 && s1 < l1;
        });
      }
      case 'rsi': {
        const r = rsiOf(cond.period);
        const L = cond.level;
        switch (cond.op) {
          case 'above':
            return make((t) => r[t] != null && r[t]! > L);
          case 'below':
            return make((t) => r[t] != null && r[t]! < L);
          case 'crossUp':
            return make((t) => t >= 1 && r[t - 1] != null && r[t] != null && r[t - 1]! <= L && r[t]! > L);
          case 'crossDown':
            return make((t) => t >= 1 && r[t - 1] != null && r[t] != null && r[t - 1]! >= L && r[t]! < L);
        }
        break;
      }
      case 'volume': {
        const x = volOf(cond.days);
        return make((t) => x[t] != null && x[t]! >= cond.ratio - EPS);
      }
      case 'change':
        return make((t) => {
          if (t < cond.days) return false;
          const p = (c[t] / c[t - cond.days] - 1) * 100;
          return cond.op === 'above' ? p >= cond.pct - EPS : p <= cond.pct + EPS;
        });
      case 'fromHigh': {
        const m = maxOf(cond.days);
        return make((t) => m[t] != null && (1 - c[t] / m[t]!) * 100 >= cond.pct - EPS);
      }
      case 'newHigh': {
        const m = maxOf(cond.days);
        return make((t) => t >= 1 && m[t - 1] != null && c[t] > m[t - 1]!);
      }
      case 'pattern': {
        const tracker = createPatternTracker(candles, cond.entry);
        trackers.push(tracker);
        return { cond, check: (t) => tracker.signal(t) !== null, tracker };
      }
    }
    throw new Error(`알 수 없는 조건: ${(cond as Cond).kind}`);
  };
  const compiled = groups.map((g) => g.conds.map(compile));

  return {
    signal(t) {
      for (const g of compiled) {
        if (g.length === 0) continue; // 빈 묶음은 맞지 않는다(실행은 경고가 막는다)
        const parts: string[] = [];
        let snapshot: PatternSnapshot | undefined;
        let ok = true;
        for (const x of g) {
          if (x.tracker) {
            const s = x.tracker.signal(t);
            if (!s) {
              ok = false;
              break;
            }
            snapshot ??= s.snapshot;
            parts.push(s.reason);
          } else if (x.check(t)) parts.push(condReason(x.cond));
          else {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        const reason = cut(parts.join(' + '));
        return snapshot ? { reason, snapshot } : { reason };
      }
      return null;
    },
    update(i) {
      for (const tr of trackers) tr.update(i);
    },
    reset(i) {
      for (const tr of trackers) tr.reset(i);
    },
    stats() {
      return trackers[0] ? trackers[0].stats() : null;
    },
    resetStats() {
      for (const tr of trackers) tr.resetStats();
    },
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `TZ=America/New_York corepack pnpm vitest run src/lib/sim/rules.test.ts && corepack pnpm check`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/sim/rules.ts src/lib/sim/rules.test.ts
git commit -m "feat(sim): 조건 묶음 평가기를 더함(반등 패턴은 기존 추적기를 감쌈)"
```

---

### Task 3: v1 분리와 `toV2`, Worker 공용 경로 계약

v1 타입·기본값·검증을 `strategyV1.ts`로 옮기고 `toV2`를 더해요. 동작은 바뀌지 않아요. 바꾸기 **전에** 지금 코드로 v1 문서·공유를 JSON으로 굳혀 계약 테스트를 만들어요.

**Files:**
- Create: `src/lib/sync/contract.fixture.test.ts`(굳히기용, 환경 변수가 있을 때만 쓰기)
- Create: `src/lib/sync/__fixtures__/contract-v1.json`
- Create: `src/lib/sync/contract.test.ts`
- Create: `src/lib/sim/strategyV1.ts`
- Modify: `src/lib/sim/types.ts:5-33`(`Strategy` 정의를 옮기고 별칭으로)
- Modify: `src/lib/sim/defaults.ts:20-47`(`newStrategy`가 `newStrategyV1`을 부르게), 새 `defaultPatternEntry`
- Modify: `src/lib/sim/validate.ts:21-185`(`sanitizeOne`·`sanitizeStrategies`·`sanitizeEntry`를 옮기고 다시 내보내기)
- Modify: `src/lib/sim/strategyV2.ts:5-6`, `src/lib/sim/testStrategyV2.ts:2`, `src/lib/screen/validate.ts:3`(import 자리)
- Test: `src/lib/sim/strategyV1.test.ts`

**Interfaces:**
- Produces(`src/lib/sim/strategyV1.ts`):
  - `export interface StrategyV1`(지금 `Strategy`와 같은 모양)
  - `export function newStrategyV1(now: number, groupId: string | null, name?: string): StrategyV1`
  - `export function sanitizeStrategiesV1(raw: unknown, now?: number): { strategies: StrategyV1[]; repaired: boolean }`
  - `export function sanitizeEntry(raw: unknown, now: number): { entry: StrategyV1['entry']; repaired: boolean }`
  - `export function toV2(s: StrategyV1): StrategyV2`
- Produces(`src/lib/sim/defaults.ts`): `export function defaultPatternEntry(): StrategyV1['entry']`
- 이 Task 동안 `types.ts`의 `Strategy`는 `StrategyV1`의 별칭이고, `validate.ts`는 `sanitizeStrategies`(= `sanitizeStrategiesV1`)·`sanitizeEntry`를 다시 내보내요. Task 4에서 없애요.

- [ ] **Step 1: 계약 고정값 굳히기 테스트 쓰기** — `src/lib/sync/contract.fixture.test.ts`

```ts
// 한 번만 실행: WRITE_CONTRACT=1이면 지금 코드로 v1 문서·공유를 만들어 __fixtures__/contract-v1.json에 쓴다(전략 빌더 PR② Task 3).
// 그 뒤로는 건너뛴다. 파일은 이후 코드가 Worker 공용 경로 동작을 바꾸지 않았다는 기준이다(contract.test.ts).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { newCriteria } from '../screen/defaults';
import { simResultFixture } from '../share/testFixtures';
import { strategySnapshot } from '../share/snapshot';
import { newStrategy } from '../sim/defaults';

const T = Date.UTC(2026, 10, 1, 3);

describe.runIf(process.env.WRITE_CONTRACT === '1')('계약 고정값 쓰기', () => {
  it('contract-v1.json', () => {
    const strategy = { ...newStrategy(T, 'g0', '눌림목'), id: 's1' };
    const criteria = { ...newCriteria(T, null), id: 'c1' };
    const doc = {
      v: 1,
      name: '계약',
      settings: { period: { unit: 'D', n: 1 }, metric: 'change', benchmark: 'AUTO', perfBenchmark: null, colorConvention: 'kr', boardOrder: 'value' },
      watchlists: { groups: [{ id: 'g0', name: '관심', items: [{ symbol: '005930', colorSlot: 1, hidden: false, addedAt: 1 }] }] },
      strategies: [strategy],
      criteria: [criteria],
      baskets: [],
    };
    const share = strategySnapshot({ ...strategy, universe: { kind: 'symbols', symbols: ['005930'] } }, { groups: [] }, { hideCapital: false, now: T });
    const sim = simResultFixture();
    writeFileSync(join(import.meta.dirname, '__fixtures__', 'contract-v1.json'), `${JSON.stringify({ now: T, doc, share, sim }, null, 2)}\n`);
  });
});
```

`newCriteria`의 시그니처가 `(now, groupId)`가 아니면 `src/lib/screen/defaults.ts`의 실제 시그니처대로 불러요.

- [ ] **Step 2: 고정값 만들기**

Run: `mkdir -p src/lib/sync/__fixtures__ && WRITE_CONTRACT=1 TZ=America/New_York corepack pnpm vitest run src/lib/sync/contract.fixture.test.ts`
Expected: PASS, `src/lib/sync/__fixtures__/contract-v1.json`이 생겨요. **이 단계는 다른 파일을 고치기 전에 해요.**

- [ ] **Step 3: 계약 테스트 쓰기** — `src/lib/sync/contract.test.ts`

```ts
// Worker 공용 경로 계약(전략 빌더 §8.7 N4). PR②는 이 판정을 바꾸지 않는다. 깨지면 그 변경을 멈추고 「PR①-b 필요」로 알린다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkShareSnapshot } from '../share/snapshot';
import { sanitizeCriteria } from '../screen/validate';
import { fullStrategyV2 } from '../sim/testStrategyV2';
import { checkProfileDoc } from './dto';
import { exceedsDepth, findForbidden } from './forbidden';

const fx = JSON.parse(readFileSync(join(import.meta.dirname, '__fixtures__', 'contract-v1.json'), 'utf8'));

describe('Worker 공용 경로 계약', () => {
  it('v1 문서는 통과하고 원본을 돌려준다', () => {
    const r = checkProfileDoc(fx.doc, fx.now);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc).toBe(fx.doc);
  });
  it('v1 문서의 기준은 정리해도 그대로다(sanitizeCriteria 무변화)', () => {
    expect(sanitizeCriteria({ criteria: fx.doc.criteria }, fx.now)).toEqual({ criteria: fx.doc.criteria, repaired: false });
  });
  it('v2 문서는 통과하고 원본을 돌려준다', () => {
    const d = { ...fx.doc, v: 2, strategies: [fullStrategyV2()] };
    const r = checkProfileDoc(d, fx.now);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc).toBe(d);
  });
  it('v1 전략·시뮬레이션 공유(create)는 통과하고 원본을 돌려준다', () => {
    const a = checkShareSnapshot(fx.share, 'strategy', fx.now, 'create');
    expect(a).toEqual({ ok: true, snapshot: fx.share });
    const b = checkShareSnapshot(fx.sim, 'simResult', fx.now, 'create');
    expect(b).toEqual({ ok: true, snapshot: fx.sim });
  });
  it('v2 전략 공유(create)는 통과하고 원본을 돌려준다', () => {
    const raw = { kind: 'strategy', v: 2, title: '골든', strategy: { ...fullStrategyV2(), id: 'shared', name: '골든', updatedAt: 0, universe: { kind: 'symbols', symbols: ['005930'] } }, capitalHidden: false };
    expect(checkShareSnapshot(raw, 'strategy', fx.now, 'create')).toEqual({ ok: true, snapshot: raw });
  });
  it('v3 문서·공유는 unsupported', () => {
    expect(checkProfileDoc({ ...fx.doc, v: 3 }, fx.now)).toMatchObject({ ok: false, code: 'unsupported' });
    expect(checkShareSnapshot({ ...fx.share, v: 3 }, 'strategy', fx.now, 'create')).toMatchObject({ ok: false, code: 'unsupported' });
  });
  it('거절 사례는 지금과 같은 코드로 거절한다', () => {
    // v2 문서에 v1 전략이 섞이면 unknown-field
    expect(checkProfileDoc({ ...fx.doc, v: 2 }, fx.now)).toMatchObject({ ok: false, code: 'unknown-field' });
    // v1 문서의 전략에 고칠 값이 있으면 invalid
    const bad = structuredClone(fx.doc);
    bad.strategies[0].capital.perBuyPct = 500;
    expect(checkProfileDoc(bad, fx.now)).toMatchObject({ ok: false, code: 'invalid', path: 'strategies[0].capital.perBuyPct' });
    // 금지 키가 있으면 forbidden-field
    expect(checkProfileDoc({ ...fx.doc, appSecret: 'x' }, fx.now)).toMatchObject({ ok: false, code: 'forbidden-field' });
  });
  it('v2 문서는 금지 키·깊이에 걸리지 않는다', () => {
    const d = { ...fx.doc, v: 2, strategies: [fullStrategyV2()] };
    expect(findForbidden(d)).toBeNull();
    expect(exceedsDepth(d)).toBe(false);
  });
});
```

Run: `TZ=America/New_York corepack pnpm vitest run src/lib/sync/contract.test.ts`
Expected: PASS(지금 코드 그대로라 통과해야 해요). 실패하면 Step 1의 고정값 만들기가 틀린 것이라 고정값을 다시 만들어요.

- [ ] **Step 4: 실패 테스트 쓰기** — `src/lib/sim/strategyV1.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { sanitizeStrategiesV2 } from './strategyV2';
import { newStrategyV1, sanitizeStrategiesV1, toV2 } from './strategyV1';

const NOW = Date.UTC(2026, 10, 1);

describe('toV2(§8.1)', () => {
  it('필드 표대로 옮긴다', () => {
    const v1 = { ...newStrategyV1(NOW, 'g0', '눌림목'), id: 's1' };
    v1.capital.perBuyPct = 12;
    v1.exit.afterFirstTake = 'breakeven';
    const v2 = toV2(v1);
    expect(v2).toEqual({
      v: 2,
      id: 's1',
      name: '눌림목',
      updatedAt: NOW,
      universe: v1.universe,
      period: v1.period,
      capital: { initial: v1.capital.initial },
      sizing: { mode: 'fixed', pct: 12 },
      rules: {
        buy: [{ conds: [{ kind: 'pattern', entry: v1.entry }] }],
        sell: {
          takeProfit: { on: true, stages: v1.exit.takeProfit, afterFirstTake: 'breakeven' },
          stopLoss: { on: true, pct: v1.exit.stopLoss.pct, basis: v1.exit.stopLoss.basis },
          trailing: { on: false, pct: 10 },
          timeExit: { on: false, days: 20 },
          signal: { on: false, groups: [] },
        },
      },
      scaleIn: v1.scaleIn,
      benchmarks: v1.benchmarks,
      costs: v1.costs,
    });
  });
  it('결정적이고 원본과 객체를 나누지 않는다', () => {
    const v1 = newStrategyV1(NOW, null);
    const a = toV2(v1);
    expect(toV2(v1)).toEqual(a);
    a.rules.buy[0].conds.length = 0;
    expect(toV2(v1).rules.buy[0].conds).toHaveLength(1);
  });
  it('옮긴 결과는 v2 검증을 고침 없이 통과한다(해시 앞당김의 전제, §8.3)', () => {
    const v1 = { ...newStrategyV1(NOW, 'g0'), id: 's1' };
    expect(sanitizeStrategiesV2({ strategies: [toV2(v1)] }, NOW)).toEqual({ strategies: [toV2(v1)], repaired: false });
  });
  it('sanitizeStrategiesV1은 지금 v1 검증과 같다', () => {
    const v1 = { ...newStrategyV1(NOW, 'g0'), id: 's1' };
    expect(sanitizeStrategiesV1({ strategies: [v1] }, NOW)).toEqual({ strategies: [v1], repaired: false });
  });
});
```

Run: `TZ=America/New_York corepack pnpm vitest run src/lib/sim/strategyV1.test.ts`
Expected: FAIL — `./strategyV1`이 없어요.

- [ ] **Step 5: 구현**

`src/lib/sim/defaults.ts`에 더해요(`newStrategy` 위). `newStrategy`의 `entry:` 값은 `defaultPatternEntry()`로 바꿔요.

```ts
/** 기본 반등 패턴(지금 새 전략의 매수 조건). 선정 기준·전략 v2 기본값이 같이 쓴다 */
export function defaultPatternEntry(): Strategy['entry'] {
  return {
    decline: { dropPct: { on: true, value: 10 }, days: { on: false, value: 10 } },
    triggers: {
      reboundDays: { on: true, value: 3 },
      breakout: { on: true, level: 'B' },
      maCross: { on: false, period: 20 },
      goldenCross: { on: false, short: 5, long: 20 },
    },
    filter: { aboveMa: { on: false, period: 60 } },
  };
}
```

`src/lib/sim/strategyV1.ts`를 만들어요. 내용은 다음 순서예요.

1. 파일 머리 주석과 import:

```ts
// 전략 v1 형식(전략 빌더 이전)과 읽기 검증·옮기기(스펙 §8.1). 앱은 저장소·문서·공유에서 v1을 만나면 toV2로 옮긴다.
// Worker 번들(dto·snapshot)이 sanitizeStrategiesV1·sanitizeEntry를 쓰니 DOM·저장소·import.meta.env를 쓰지 않는다.
import type { Watchlists } from '../state/schema';
import { addDays, kstDate, kstEpoch } from '../time/kst';
import { defaultPatternEntry, defaultPeriod, MAX_INITIAL, MAX_STRATEGIES, MAX_SYMBOLS, MAX_TAKE_STAGES, NAME_MAX } from './defaults';
import type { StrategyV2 } from './strategyV2';
import type { StopBasis } from './types';
```

(`Watchlists`·`addDays`·`MAX_SYMBOLS`를 실제로 쓰지 않으면 import에서 빼요. `sanitizeOne`이 쓰는 것만 남겨요.)

2. `export interface StrategyV1 { … }` — 지금 `src/lib/sim/types.ts:5-33`의 `Strategy` 본문을 그대로 옮기고 이름만 `StrategyV1`로 바꿔요.

3. `newStrategyV1` — 지금 `defaults.ts`의 `newStrategy` 본문을 그대로 옮기고 반환 타입·이름만 바꿔요(`entry: defaultPatternEntry()`).

```ts
export function newStrategyV1(now: number, groupId: string | null, name = '새 전략'): StrategyV1 {
  return {
    id: crypto.randomUUID(),
    name,
    updatedAt: now,
    universe: groupId ? { kind: 'group', groupId } : { kind: 'symbols', symbols: [] },
    period: defaultPeriod(now),
    capital: { initial: 10_000_000, perBuyPct: 10 },
    entry: defaultPatternEntry(),
    scaleIn: { on: false, stepPct: 3, maxAdds: 2 },
    exit: {
      takeProfit: [{ pct: 15, sellPct: 100 }],
      stopLoss: { pct: 5, basis: 'avgAfterScaleIn' },
      afterFirstTake: 'keep',
    },
    benchmarks: { index: 'KOSPI', symbol: '069500' },
    costs: { feePct: 0.015 },
  };
}
```

4. `validate.ts:7-153`의 `Row`·`isRecord`·`DATE_RE`·`realDate`·`BASES`·`sanitizeOne`을 그대로 옮겨요. 타입 `Strategy`는 `StrategyV1`로, `template: Strategy`도 `StrategyV1`로 바꿔요.

5. `validate.ts:155-185`의 `sanitizeStrategies`를 `sanitizeStrategiesV1`로 이름만 바꿔 옮기고, `template = newStrategy(now, null)`을 `newStrategyV1(now, null)`로 바꿔요. `sanitizeEntry`도 옮기고 `newStrategy(now, null)`을 `newStrategyV1(now, null)`로 바꿔요.

6. `toV2`:

```ts
/** v1 → v2(스펙 §8.1). 순수 함수: 시각·난수를 쓰지 않아 같은 v1이면 늘 같은 v2, 원본과 객체를 나누지 않는다 */
export function toV2(s: StrategyV1): StrategyV2 {
  return {
    v: 2,
    id: s.id,
    name: s.name,
    updatedAt: s.updatedAt,
    universe: s.universe.kind === 'group' ? { kind: 'group', groupId: s.universe.groupId } : { kind: 'symbols', symbols: [...s.universe.symbols] },
    period: { from: s.period.from, to: s.period.to },
    capital: { initial: s.capital.initial },
    sizing: { mode: 'fixed', pct: s.capital.perBuyPct },
    rules: {
      buy: [{ conds: [{ kind: 'pattern', entry: structuredClone(s.entry) }] }],
      sell: {
        takeProfit: { on: true, stages: s.exit.takeProfit.map((t) => ({ pct: t.pct, sellPct: t.sellPct })), afterFirstTake: s.exit.afterFirstTake },
        stopLoss: { on: true, pct: s.exit.stopLoss.pct, basis: s.exit.stopLoss.basis },
        trailing: { on: false, pct: 10 },
        timeExit: { on: false, days: 20 },
        signal: { on: false, groups: [] },
      },
    },
    scaleIn: { on: s.scaleIn.on, stepPct: s.scaleIn.stepPct, maxAdds: s.scaleIn.maxAdds },
    benchmarks: { index: s.benchmarks.index, symbol: s.benchmarks.symbol },
    costs: { feePct: s.costs.feePct },
  };
}
```

`src/lib/sim/types.ts:5-33`의 `Strategy` 정의를 지우고 아래로 바꿔요(이 Task 동안만 v1 별칭).

```ts
import type { StrategyV1 } from './strategyV1';
/** 앱 전략. 전략 빌더 PR② Task 4에서 StrategyV2로 바꾼다 */
export type Strategy = StrategyV1;
```

`src/lib/sim/defaults.ts`의 `newStrategy`는 본문을 지우고 `newStrategyV1`을 불러요.

```ts
import { newStrategyV1 } from './strategyV1';
export function newStrategy(now: number, groupId: string | null, name = '새 전략'): Strategy {
  return newStrategyV1(now, groupId, name);
}
```

`defaults.ts`와 `strategyV1.ts`가 서로를 import하게 돼요. 둘 다 함수 안에서만 상대를 쓰니 모듈 초기화 순서 문제는 없어요. Task 4에서 `defaults.ts`의 `newStrategyV1` import는 사라져요.

`src/lib/sim/validate.ts`: 옮긴 코드를 지우고 위쪽에 다시 내보내요(이 Task 동안만).

```ts
export { sanitizeEntry, sanitizeStrategiesV1 as sanitizeStrategies } from './strategyV1';
```

`resolveSymbols`·`ruleIssues`·`strategyIssues`·`Issue`는 `validate.ts`에 남겨요.

import 자리 바꾸기(동작 같음):
- `src/lib/sim/strategyV2.ts:5-6` → `import type { StrategyV1 } from './strategyV1';`, `import { sanitizeEntry, sanitizeStrategiesV1 } from './strategyV1';`. 파일 안 `Strategy['…']`는 `StrategyV1['…']`로, `PatternEntry = Strategy['entry']`는 `StrategyV1['entry']`로, `sanitizeStrategies(` 호출은 `sanitizeStrategiesV1(`로 바꿔요. 머리 주석의 `v1 검증(sanitizeStrategies)`도 `sanitizeStrategiesV1`로.
- `src/lib/sim/testStrategyV2.ts:2` → `import { sanitizeEntry } from './strategyV1';`
- `src/lib/screen/validate.ts:3` → `import { ruleIssues } from '../sim/validate';`와 `import { sanitizeEntry } from '../sim/strategyV1';`

- [ ] **Step 6: 통과 확인**

Run: `corepack pnpm test && corepack pnpm check && (cd sync-worker && npx vitest run && npx tsc -p tsconfig.json --noEmit)`
Expected: 모두 PASS. 골든 스냅샷·계약 테스트·Worker 테스트가 그대로예요.

- [ ] **Step 7: 커밋**

```bash
git add src/lib/sync/contract.fixture.test.ts src/lib/sync/__fixtures__/contract-v1.json src/lib/sync/contract.test.ts src/lib/sim/strategyV1.ts src/lib/sim/strategyV1.test.ts src/lib/sim/types.ts src/lib/sim/defaults.ts src/lib/sim/validate.ts src/lib/sim/strategyV2.ts src/lib/sim/testStrategyV2.ts src/lib/screen/validate.ts
git commit -m "refactor(sim): v1 전략 코드를 strategyV1로 옮기고 toV2와 공용 경로 계약 테스트를 더함"
```

---
### Task 4: v2 전환 (4a~4d)

`Strategy`를 v2로 바꾸는 일을 네 개의 하위 Task로 나눠 각각 커밋해요. 타입이 바뀌는 순간 여러 영역이 같이 깨지므로, **4a~4c에서는 `corepack pnpm check`(svelte-check)가 빨간 것을 허용해요.** 각 하위 Task는 「통과 확인」에 적은 vitest 대상만 초록이어야 하고, 4d 끝에서 `corepack pnpm test`·`corepack pnpm check`가 모두 초록이어야 해요. 골든 스냅샷은 4a 끝에서 이미 그대로여야 해요.

**전체 Files·Interfaces(4a~4d 합계):**

- Modify: `src/lib/sim/types.ts`, `src/lib/sim/defaults.ts`, `src/lib/sim/validate.ts`, `src/lib/sim/pattern.ts:4,19`
- Create: `src/lib/sim/patternBlock.ts`, `src/lib/sim/patternBlock.test.ts`
- Modify: `src/lib/sim/simulate.ts`, `src/lib/sim/position.ts:1-37`, `src/lib/sim/loadSimData.ts:48-56,73`, `src/lib/sim/summary.ts:59-62`
- Modify: `src/lib/sim/strategyStore.ts`, `src/lib/state/profileStore.ts:19`, `src/lib/state/app.svelte.ts:128,637,661,835`
- Modify: `src/lib/sync/dto.ts:7-9,16,29-38,116`, `src/lib/sync/profileDoc.ts`, `src/lib/sync/engine.ts`, `src/lib/sync/store.ts`, `src/lib/sync/api.ts:12,25,52,103-108`, `src/lib/ui/settings/SyncPanel.svelte:5,37`
- Modify: `src/lib/state/exportImport.ts:21,27,35,40,122,133,153`
- Modify: `src/lib/share/snapshot.ts`, `src/lib/share/compact.ts:214`, `src/lib/share/importPlan.ts:11,138`, `src/lib/share/pendingImport.ts:54,56`, `src/lib/share/shareText.ts:52-56,97-99`
- Modify: `src/lib/screen/defaults.ts:47`, `src/lib/screen/testData.ts:71-72`, `src/lib/screen/types.ts:43`, `src/lib/screen/precompute.ts:117,130-174,204,242`, `src/lib/screen/runValidation.ts:330-336`
- Create: `src/lib/ui/simulate/editor/PatternFields.svelte`(= `EntrySection.svelte`를 옮김), Delete: `src/lib/ui/simulate/editor/EntrySection.svelte`
- Modify: `src/lib/ui/simulate/StrategyEditor.svelte:16,232`, `src/lib/ui/simulate/editor/ExitSection.svelte`, `src/lib/ui/simulate/editor/PeriodSection.svelte:38`, `src/lib/ui/simulate/simText.ts:49-102,208-215`, `src/lib/ui/simulate/ResultView.svelte:66`, `src/lib/ui/screen/CriteriaEditor.svelte:27,318-347,500`
- Modify(테스트): `src/lib/sim/testInputs.ts:21-31`, `src/lib/sim/simulate.test.ts:4,24-31`, `src/lib/sim/position.test.ts`, `sync-worker/test/docs.ts`, 그리고 `corepack pnpm check`가 가리키는 테스트·고정값 파일(Step 9)


**Interfaces:**
- Produces:
  - `types.ts`: `export type Strategy = StrategyV2`, `export type { Cond, CondGroup, PatternEntry, SizingMode } from './strategyV2'`, `export type { StrategyV1 } from './strategyV1'`
  - `patternBlock.ts`: `patternEntryOf(s: Pick<Strategy, 'rules'>): PatternEntry | null`, `patternCount(s: Pick<Strategy, 'rules'>): number`
  - `defaults.ts`: `newStrategy(now, groupId, name?): Strategy`(v2), `defaultPatternEntry(): PatternEntry`
  - `validate.ts`: `Issue`에 `pattern?: true`. `sanitizeStrategies`·`sanitizeEntry` 다시 내보내기는 **없어요**(호출처는 `sanitizeStrategiesV1`·`sanitizeStrategiesV2`·`sanitizeEntry`를 각 파일에서 직접 import)
  - `position.ts`: `export interface PositionExit { takeProfit: { pct: number; sellPct: number }[]; stopLoss: { pct: number; basis: StopBasis }; afterFirstTake: 'keep' | 'breakeven' }`, `openPosition(price, qty, scaleIn, exit: PositionExit)`
  - `simulate.ts`: `CoreResult.patternStats: { maxDropPct: number; declineDays: number } | null`
  - `profileStore.ts`: `profileKeys.strategySet(id) = \`p:${id}:strategySet\``
  - `profileDoc.ts`: `profileDocBase(st, profileId, name): Omit<ProfileDocV2, 'v' | 'strategies'>`, `buildProfileDoc(...): ProfileDocV2`, `applyProfileDoc(st, profileId, doc: ProfileDoc)`
  - `dto.ts`: `PROFILE_DOC_VERSION = 2`, `ProfileDocV1.strategies: StrategyV1[]`
  - `snapshot.ts`: `STRATEGY_SHARE_VERSION = 2`, `StrategySnapshot.v: 2`, `SimResultSnapshot.v: 2`
  - `exportImport.ts`: `EXPORT_SCHEMA_VERSION = 2`
  - `precompute.ts`: `export class MissingPatternError extends Error`


---

#### Task 4a: 타입·기본값·엔진 매수 교체 (sim 테스트까지)

엔진은 평가기(Task 2)를 매수 판정에 연결하고, 매도·배분은 지금 동작 그대로(익절·손절 켬, `fixed`) 둬요.

**Files:** `src/lib/sim/types.ts`, `src/lib/sim/defaults.ts`, `src/lib/sim/validate.ts`, `src/lib/sim/pattern.ts:4,19`, `src/lib/sim/patternBlock.ts`(새), `src/lib/sim/simulate.ts`, `src/lib/sim/position.ts:1-37`, `src/lib/sim/loadSimData.ts:48-56,73`, `src/lib/sim/summary.ts:59-62`, 테스트 `src/lib/sim/patternBlock.test.ts`(새)·`testInputs.ts`·`simulate.test.ts`·`position.test.ts`·`validate.test.ts`·`simulate.timeline.test.ts`

- [ ] **Step 1: 실패 테스트 쓰기**

`src/lib/sim/patternBlock.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { defaultPatternEntry, newStrategy } from './defaults';
import { patternCount, patternEntryOf } from './patternBlock';
import { newStrategyV1, toV2 } from './strategyV1';

describe('v2 기본값과 패턴 블록', () => {
  it('newStrategy는 지금 기본값을 옮긴 v2와 같다(id만 다름)', () => {
    const a = newStrategy(0, 'g0', '새 전략');
    const b = toV2(newStrategyV1(0, 'g0', '새 전략'));
    expect({ ...a, id: 'x' }).toEqual({ ...b, id: 'x' });
  });
  it('patternEntryOf: 매수 묶음의 첫 패턴 블록', () => {
    const s = newStrategy(0, null);
    expect(patternEntryOf(s)).toEqual(defaultPatternEntry());
    expect(patternCount(s)).toBe(1);
    s.rules.buy = [{ conds: [{ kind: 'newHigh', days: 20 }] }];
    expect(patternEntryOf(s)).toBeNull();
    expect(patternCount(s)).toBe(0);
  });
});
```


`src/lib/sim/loadSimData.test.ts`의 `strat` 도우미는 `newStrategy`로 만들고 v1 필드(`s.entry…`)를 고쳐요. `newStrategyV1`로 만들어 patch(인자 타입 `StrategyV1`)를 적용한 뒤 `toV2`로 돌려주게 바꾸고, 파일 끝(`describe('loadSimData')` 안)에 더해요.

```ts
  it('워밍업: RSI 조건은 ceil(251 × 1.6) = 402일(고정 시작점 250봉, §5.4)', async () => {
    const sp = spied();
    const s = strat();
    s.rules.buy = [{ conds: [{ kind: 'rsi', period: 14, level: 30, op: 'crossUp' }] }];
    await run(sp.provider, s, ['005930']);
    expect(sp.candles[0].from).toBe(addDays('2026-03-02', -402));
  });
```

(시작일 `2026-03-02`는 같은 파일 「MA가 더 길면 ceil(MA*1.6)일」 테스트가 쓰는 `strat()` 기본 시작일이에요.)

- [ ] **Step 2: 실패 확인**

Run: `TZ=America/New_York corepack pnpm vitest run src/lib/sim/patternBlock.test.ts src/lib/sim/loadSimData.test.ts`
Expected: FAIL — `./patternBlock`이 없고, RSI 워밍업이 400일로 나와요.

- [ ] **Step 3: 타입·기본값·패턴 블록 도우미**

`src/lib/sim/types.ts` — Task 3에서 넣은 별칭 줄을 아래로 바꿔요.

```ts
import type { StrategyV2 } from './strategyV2';
export type { Cond, CondGroup, PatternEntry, SizingMode } from './strategyV2';
export type { StrategyV1 } from './strategyV1';
/** 앱 전략(v2, 전략 빌더 스펙 §3). 옛 형식은 StrategyV1(strategyV1.ts)이고 읽을 때 toV2로 옮긴다 */
export type Strategy = StrategyV2;
```

`src/lib/sim/pattern.ts`: `import type { PatternSnapshot, Strategy } from './types';`를 `import type { PatternEntry, PatternSnapshot } from './types';`로, `entry: Strategy['entry']`를 `entry: PatternEntry`로 바꿔요.

`src/lib/sim/defaults.ts`: `newStrategyV1` import를 지우고, `defaultPatternEntry`의 반환 타입을 `PatternEntry`로(`import type { PatternEntry, Strategy } from './types';`), `newStrategy`를 아래로 바꿔요.

```ts
/** 새 전략(v2). 매수는 기본 반등 패턴 블록 하나, 매도는 익절 +15% 전량·손절 −5%(분할 후 평단), 배분은 처음 자금 10% */
export function newStrategy(now: number, groupId: string | null, name = '새 전략'): Strategy {
  return {
    v: 2,
    id: crypto.randomUUID(),
    name,
    updatedAt: now,
    universe: groupId ? { kind: 'group', groupId } : { kind: 'symbols', symbols: [] },
    period: defaultPeriod(now),
    capital: { initial: 10_000_000 },
    sizing: { mode: 'fixed', pct: 10 },
    rules: {
      buy: [{ conds: [{ kind: 'pattern', entry: defaultPatternEntry() }] }],
      sell: {
        takeProfit: { on: true, stages: [{ pct: 15, sellPct: 100 }], afterFirstTake: 'keep' },
        stopLoss: { on: true, pct: 5, basis: 'avgAfterScaleIn' },
        trailing: { on: false, pct: 10 },
        timeExit: { on: false, days: 20 },
        signal: { on: false, groups: [] },
      },
    },
    scaleIn: { on: false, stepPct: 3, maxAdds: 2 },
    benchmarks: { index: 'KOSPI', symbol: '069500' },
    costs: { feePct: 0.015 },
  };
}
```

`src/lib/sim/patternBlock.ts`:

```ts
// 매수 조건의 반등 패턴 블록 찾기. 엔진·선정 기준·화면 문구가 같이 쓴다(스펙 §7).
import type { Cond, CondGroup, PatternEntry, Strategy } from './types';

type PatternCond = Extract<Cond, { kind: 'pattern' }>;
const patterns = (groups: CondGroup[]): PatternCond[] => groups.flatMap((g) => g.conds.filter((c): c is PatternCond => c.kind === 'pattern'));

/** 매수 묶음에서 처음 나오는 반등 패턴 블록의 entry. 없으면 null */
export function patternEntryOf(s: Pick<Strategy, 'rules'>): PatternEntry | null {
  return patterns(s.rules.buy)[0]?.entry ?? null;
}

/** 매수 묶음 전체의 반등 패턴 블록 수(1개까지만 실행할 수 있다, §11) */
export function patternCount(s: Pick<Strategy, 'rules'>): number {
  return patterns(s.rules.buy).length;
}
```

`src/lib/sim/validate.ts`:
- `export { sanitizeEntry, sanitizeStrategiesV1 as sanitizeStrategies } from './strategyV1';` 줄을 **지워요**.
- `Issue`에 `pattern?: true;`를 더해요(`/** 반등 패턴 블록에서 나온 경고. 선정 기준이 빌려 쓴다(§7) */`).
- `ruleIssues`를 아래로 바꿔요(새 경고 줄은 Task 12에서 더해요).

```ts
/** 매수·분할 매수·매도 규칙(rules·scaleIn)만 본 경고. 종목 범위·기간을 쓰지 않아 선정 기준 ②도 쓴다. */
export function ruleIssues(s: Strategy): Issue[] {
  const out: Issue[] = [];
  const p = patternEntryOf(s);
  if (p) {
    const t = p.triggers;
    if (!t.reboundDays.on && !t.breakout.on && !t.maCross.on && !t.goldenCross.on)
      out.push({ section: 'entry', text: '사는 신호가 하나도 켜져 있지 않아요. 반등 패턴 ②에서 하나 이상 켜 주세요', blocking: true, pattern: true });
    if (t.goldenCross.on && t.goldenCross.short >= t.goldenCross.long)
      out.push({ section: 'entry', text: '짧은 이동평균 기간이 긴 이동평균보다 짧아야 해요', blocking: false, pattern: true });
  }
  const { takeProfit, stopLoss } = s.rules.sell;
  if (stopLoss.on && stopLoss.basis === 'avgAlways' && s.scaleIn.on && s.scaleIn.stepPct >= stopLoss.pct)
    out.push({ section: 'exit', text: '추가 매수보다 손절이 먼저 일어나요. 추가 매수 간격을 손절폭보다 작게 해 주세요', blocking: false });
  if (takeProfit.on) {
    const st = takeProfit.stages;
    if (st.some((x, i) => i > 0 && x.pct <= st[i - 1].pct)) out.push({ section: 'exit', text: '익절 단계는 낮은 %부터 차례로 적어 주세요', blocking: true });
    if (st.slice(0, -1).reduce((a, x) => a + x.sellPct, 0) >= 100)
      out.push({ section: 'exit', text: '마지막 단계 전에 모두 팔려서 뒤 단계가 실행되지 않아요', blocking: false });
  }
  return out;
}
```

- `strategyIssues`의 자금 경고를 바꿔요.

```ts
  const buys = 1 + (s.scaleIn.on ? s.scaleIn.maxAdds : 0); // 분할 매수를 껐으면 추가 매수는 없다
  if ((s.sizing.mode === 'fixed' || s.sizing.mode === 'equityPct') && s.sizing.pct * buys * n > 100)
    out.push({ section: 'capital', text: '모든 종목이 한꺼번에 사면 현금이 모자라요. 신호 일부를 건너뛸 수 있어요', blocking: false });
```

- import에 `import { patternEntryOf } from './patternBlock';`를 더하고, 이제 안 쓰는 import(`defaultPeriod`·`MAX_*`·`newStrategy`·`kstEpoch` 등)를 지워요.

- [ ] **Step 4: 엔진 매수 교체**

`src/lib/sim/position.ts`:

```ts
import type { StopBasis, Strategy } from './types';

/** 포지션이 쓰는 익절·손절(v1 exit 모양). 엔진이 rules.sell에서 만든다(전략 빌더 PR② Task 6에서 SellRules로 바꾼다) */
export interface PositionExit {
  takeProfit: { pct: number; sellPct: number }[];
  stopLoss: { pct: number; basis: StopBasis };
  afterFirstTake: 'keep' | 'breakeven';
}
```

`openPosition`의 네 번째 인자 타입을 `exit: PositionExit`로 바꾸고, 본문은 그대로 둬요(`scaleIn: Strategy['scaleIn']`는 그대로).

`src/lib/sim/simulate.ts`:
- import: `import { createPatternTracker, type PatternTracker } from './pattern';`를 `import { createRuleEvaluator, type RuleEvaluator } from './rules';`로, position import에 `type PositionExit`를 더해요.
- `CoreResult.patternStats`: `patternStats: { maxDropPct: number; declineDays: number } | null; // 매수 조건에 반등 패턴 블록이 없으면 null`
- `WalkCtx.takeProfit`: `takeProfit: Strategy['rules']['sell']['takeProfit']['stages'];`
- `SymState`: `tracker: RuleEvaluator;`, `pending: { reason: string; snapshot?: PatternSnapshot } | null;`
- 파일에 도우미를 더해요(`inWindows` 아래).

```ts
/** rules.sell → 포지션이 쓰는 익절·손절(on 플래그는 Task 6에서 쓴다) */
const exitOf = (sell: Strategy['rules']['sell']): PositionExit => ({
  takeProfit: sell.takeProfit.stages,
  stopLoss: { pct: sell.stopLoss.pct, basis: sell.stopLoss.basis },
  afterFirstTake: sell.takeProfit.afterFirstTake,
});
```

- `simulateCore` 안을 바꿔요.

```ts
  const amount = roundMoney((s.capital.initial * s.sizing.pct) / 100);
```

```ts
  const syms: SymState[] = input.stocks.map((stock) => {
    const dates = stock.candles.map((k) => kstDate(k.t));
    const firstIdx = dates.findIndex((dt) => dt >= days[0]);
    const tracker = createRuleEvaluator(stock.candles, s.rules.buy, firstIdx < 0 ? dates.length : firstIdx);
```

(아래 워밍업 루프·`resetStats`·반환 객체는 그대로예요.)

예약 매수 블록에서:

```ts
      st.pos = openPosition(price, sized.qty, s.scaleIn, exitOf(s.rules.sell));
```

```ts
      record(st, { date, symbol: st.stock.symbol, kind: 'buy', price, qty: sized.qty, fee: sized.fee, tax: 0, reason, ...(snapshot && { pattern: snapshot }) });
```

`walkBar` 호출의 `takeProfit: s.exit.takeProfit,`를 `takeProfit: s.rules.sell.takeProfit.stages,`로 바꿔요.

끝의 통계 합치기를 바꿔요.

```ts
  const perSymbolFirstDate: Record<string, string | null> = {};
  let maxDropPct = 0;
  let declineDays = 0;
  let anyPattern = false;
  for (const st of syms) {
    perSymbolFirstDate[st.stock.symbol] = st.dates.find((dt) => inDays.has(dt)) ?? null;
    const ps = st.tracker.stats();
    if (!ps) continue;
    anyPattern = true;
    maxDropPct = Math.max(maxDropPct, ps.maxDropPct);
    declineDays += ps.declineDays;
  }
  const patternStats = anyPattern ? { maxDropPct, declineDays } : null;
```

그리고 반환의 `patternStats: { maxDropPct, declineDays }`를 `patternStats`로 바꿔요.

`src/lib/sim/summary.ts`의 `nearMiss`:

```ts
export function nearMiss(core: CoreResult): SimResult['nearMiss'] {
  if (core.trades.length > 0 || core.skipped.length > 0 || !core.patternStats) return null; // 패턴 블록이 없으면 줄을 뺀다(§4.8)
  return { ...core.patternStats };
}
```

`src/lib/sim/loadSimData.ts`: `longestMa` 함수를 지우고 `import { rulesLookback } from './rules';`를 더해, `:73`을 바꿔요.

```ts
  const lookback = rulesLookback([...strategy.rules.buy, ...(strategy.rules.sell.signal.on ? strategy.rules.sell.signal.groups : [])]);
  const warmFrom = addDays(from, -Math.max(400, Math.ceil(lookback * 1.6)));
```

- [ ] **Step 5: sim 테스트 옮기기**

`src/lib/sim/testInputs.ts`의 `baseStrategy`를 v1으로 만든 뒤 옮겨요. 골든 입력이 v1 필드를 고치니(`x.exit…`, `x.capital.perBuyPct`) 콜백 인자 타입을 `StrategyV1`로 둬요.

```ts
import { newStrategyV1, toV2, type StrategyV1 } from './strategyV1';

/** 자금 1,000만 원, 회당 10%, 수수료 0.015%, 돌파 끔, 손절 5% 매번 평단. v1으로 고친 뒤 toV2로 옮긴다(골든이 옮기기까지 지킨다) */
export function baseStrategy(over: (s: StrategyV1) => void = () => {}): Strategy {
  const s = newStrategyV1(0, null);
  s.capital = { initial: 10_000_000, perBuyPct: 10 };
  s.costs.feePct = 0.015;
  s.entry.triggers.breakout.on = false;
  s.exit.stopLoss = { pct: 5, basis: 'avgAlways' };
  over(s);
  return toV2(s);
}
```

`src/lib/sim/simulate.test.ts`의 `strat`도 같은 방식이에요.

```ts
import { newStrategyV1, toV2, type StrategyV1 } from './strategyV1';

function strat(over: (s: StrategyV1) => void = () => {}): Strategy {
  const s = newStrategyV1(0, null);
  s.capital = { initial: 10_000_000, perBuyPct: 10 };
  s.costs.feePct = 0;
  s.entry.triggers.breakout.on = false;
  s.exit.stopLoss = { pct: 5, basis: 'avgAlways' };
  over(s);
  return toV2(s);
}
```

`newStrategy` import를 지워요. 이 파일에서 `openPosition(…, s.exit)`처럼 전략의 `exit`를 넘기는 곳은 `{ takeProfit: s.rules.sell.takeProfit.stages, stopLoss: { pct: s.rules.sell.stopLoss.pct, basis: s.rules.sell.stopLoss.basis }, afterFirstTake: s.rules.sell.takeProfit.afterFirstTake }`로 바꿔요. `WalkCtx` 고정값의 `takeProfit`은 배열 그대로예요.

`src/lib/sim/position.test.ts`: `exit` 고정값의 타입 표기가 `Strategy['exit']`면 `PositionExit`로 바꿔요(값은 그대로).

`src/lib/sim/validate.test.ts`의 v1 검증 테스트는 import를 `import { sanitizeStrategiesV1 as sanitizeStrategies } from './strategyV1';`로 바꿔 그대로 둬요. `ruleIssues`·`strategyIssues` 테스트에서 v1 필드를 고치는 줄은 아래 대응표(Task 4d Step 3)로 바꿔요. `simulate.timeline.test.ts`의 v1 필드도 같은 대응표로 바꿔요.

- [ ] **Step 6: 통과 확인(골든)**

Run: `TZ=America/New_York corepack pnpm vitest run src/lib/sim/simulate.golden.test.ts src/lib/sim/simulate.test.ts src/lib/sim/position.test.ts src/lib/sim/simulate.timeline.test.ts src/lib/sim/patternBlock.test.ts src/lib/sim/rules.test.ts src/lib/sim/strategyV1.test.ts src/lib/sim/validate.test.ts src/lib/sim/loadSimData.test.ts`
Expected: PASS. `simulate.golden.test.ts`는 스냅샷 그대로여야 해요. 깨지면 스냅샷을 갱신하지 말고 엔진 변경을 되짚어요(평가기 `update` 호출 위치, `pattern` 키 생략, `amount`). 이 시점에 svelte-check와 다른 영역 테스트는 빨간 것이 정상이에요(`sanitizeStrategies` 다시 내보내기를 지웠기 때문).

- [ ] **Step 7: 커밋**

```bash
git add src/lib/sim
git commit -m "feat(sim): 전략 타입을 v2로 바꾸고 엔진 매수를 조건 평가기로 옮김"
```

---

#### Task 4b: 저장 키·문서·동기화

**Files:** `src/lib/sim/strategyStore.ts`, `src/lib/state/profileStore.ts:19`, `src/lib/state/app.svelte.ts:128,637,661,835`, `src/lib/sync/dto.ts:7-9,16,29-38,116`, `src/lib/sync/profileDoc.ts`, `src/lib/sync/engine.ts`, `src/lib/sync/store.ts`, `src/lib/sync/api.ts:12,25,52,103-108`, `src/lib/sync/local.ts`, `src/lib/ui/settings/SyncPanel.svelte:5,37`, `sync-worker/test/docs.ts`, 테스트 `src/lib/sim/strategyStore.test.ts`·`src/lib/sync/dto.test.ts`

- [ ] **Step 1: 실패 테스트 쓰기**

`src/lib/sim/strategyStore.test.ts` 끝에 붙여요. 파일 **맨 위** import 묶음에 `import { newStrategyV1, toV2 } from './strategyV1';`를 더하고, `profileKeys`·`createSafeStorage`·`memoryBacking`이 아직 없으면 `../state/profileStore`·`../state/storage`·`../state/testStorage`에서 가져와요(이미 있으면 다시 import하지 않아요).

```ts
describe('새 키 strategySet(§8.2)', () => {
  const make = () => createSafeStorage(memoryBacking());
  it('옛 키만 있으면 v2로 옮겨 새 키에 쓰고 옛 키는 그대로 둔다', () => {
    const st = make();
    const v1 = { ...newStrategyV1(0, null, '옛'), id: 's1' };
    st.set(profileKeys.strategies('p'), { strategies: [v1] });
    expect(loadStrategies(st, 'p')).toEqual([toV2(v1)]);
    expect(st.get(profileKeys.strategySet('p'), null)).toEqual({ strategies: [toV2(v1)] });
    expect(st.get(profileKeys.strategies('p'), null)).toEqual({ strategies: [v1] });
  });
  it('새 키가 있으면 옛 키는 읽지 않는다', () => {
    const st = make();
    st.set(profileKeys.strategies('p'), { strategies: [{ ...newStrategyV1(0, null, '옛'), id: 's1' }] });
    const v2 = toV2({ ...newStrategyV1(0, null, '새'), id: 's2' });
    st.set(profileKeys.strategySet('p'), { strategies: [v2] });
    expect(loadStrategies(st, 'p')).toEqual([v2]);
  });
  it('저장은 새 키에만 한다', () => {
    const st = make();
    const v2 = toV2({ ...newStrategyV1(0, null), id: 's2' });
    saveStrategies(st, 'p', [v2]);
    expect(st.get(profileKeys.strategySet('p'), null)).toEqual({ strategies: [v2] });
    expect(st.get(profileKeys.strategies('p'), null)).toBeNull();
  });
});
```


`src/lib/sync/dto.test.ts`에서 PR①의 `it('앱이 만드는 버전은 1 그대로, 받는 최대는 2', …)`의 `expect(PROFILE_DOC_VERSION).toBe(1)`을 `toBe(2)`로 바꾸고 제목을 `'앱이 만드는 버전은 2, 받는 최대는 2'`로 바꿔요. 같은 파일에 붙여요.

```ts
describe('applyProfileDoc v1·v2(§8.2)', () => {
  it('v2 문서는 새 키에만 쓴다', () => {
    const { st } = seeded();
    const d = { ...validDoc(), v: 2 as const, strategies: [fullStrategyV2()] };
    applyProfileDoc(st, PID, d);
    expect(st.get(profileKeys.strategySet(PID), null)).toEqual({ strategies: d.strategies });
  });
  it('v1 문서는 옛 키에 v1, 새 키에 toV2 결과를 바로 쓴다', () => {
    const { st } = seeded();
    const v1 = { ...newStrategyV1(NOW, 'g0', '옛'), id: 'old' };
    const d = { ...validDoc(), v: 1 as const, strategies: [v1] };
    applyProfileDoc(st, PID, d);
    expect(st.get(profileKeys.strategies(PID), null)).toEqual({ strategies: [v1] });
    expect(st.get(profileKeys.strategySet(PID), null)).toEqual({ strategies: [toV2(v1)] });
  });
  it('buildProfileDoc은 v2 문서를 만든다', () => {
    expect(validDoc().v).toBe(2);
  });
});
```

(`seeded`·`PID`·`validDoc`은 이 파일에 이미 있어요. import에 `profileKeys`(`../state/profileStore`), `newStrategyV1`·`toV2`(`../sim/strategyV1`)를 더해요. `validDoc()`의 반환 타입을 `ProfileDocV1`에서 `ProfileDocV2`로 바꾸고, v1 문서가 필요한 기존 테스트는 `{ ...validDoc(), v: 1, strategies: [newStrategyV1(NOW, 'g0')] }`로 만들어요.)


- [ ] **Step 2: 실패 확인**

Run: `TZ=America/New_York corepack pnpm vitest run src/lib/sim/strategyStore.test.ts src/lib/sync/dto.test.ts`
Expected: FAIL — `profileKeys.strategySet`이 `undefined`, `PROFILE_DOC_VERSION`이 1이에요.

- [ ] **Step 3: 저장 키·문서**

`src/lib/state/profileStore.ts:19` 아래에 더해요.

```ts
  /** 전략 v2(전략 빌더 §8.2). 옛 키 strategies는 v1 백업으로 남기고 앱은 쓰지 않는다 */
  strategySet: (id: string) => `p:${id}:strategySet`,
```

`src/lib/sim/strategyStore.ts`를 아래로 바꿔요.

```ts
// 프로필별 전략 목록의 읽기·쓰기. 저장 모양은 { strategies: Strategy[] }(v2, 키 strategySet).
// 옛 키(strategies, v1)만 있으면 옮겨 새 키에 쓰고 옛 키는 그대로 둔다(백업, 스펙 §8.2).
import { profileKeys } from '../state/profileStore';
import type { SafeStorage } from '../state/storage';
import { MAX_STRATEGIES } from './defaults';
import { sanitizeStrategiesV1, toV2 } from './strategyV1';
import { sanitizeStrategiesV2 } from './strategyV2';
import type { Strategy } from './types';

const listShape = (raw: unknown): boolean =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw) && Array.isArray((raw as { strategies?: unknown }).strategies);

/** 읽을 때 검증한다. 모양이 깨졌거나 고친 것이 있으면 저장소 배너로 알린다. 옮기기는 고침이 아니라 알리지 않는다 */
export function loadStrategies(st: SafeStorage, profileId: string): Strategy[] {
  const key = profileKeys.strategySet(profileId);
  const raw = st.get<unknown>(key, null);
  if (raw !== null) {
    const { strategies, repaired } = sanitizeStrategiesV2(raw);
    if (repaired || !listShape(raw)) st.reportCorrupt(key);
    return strategies;
  }
  const oldKey = profileKeys.strategies(profileId);
  const old = st.get<unknown>(oldKey, null);
  if (old === null) return [];
  const { strategies, repaired } = sanitizeStrategiesV1(old);
  if (repaired || !listShape(old)) st.reportCorrupt(oldKey);
  const next = strategies.map(toV2);
  st.trySet(key, { strategies: next }); // 실패하면 메모리로만 쓰고 다음 읽기에서 다시 옮긴다(옛 키가 그대로라 결과가 같다)
  return next;
}

/** 한도 문구. 오류와 화면 스낵바가 같은 문구를 쓴다. */
export const STRATEGY_CAP_MESSAGE = `전략은 ${MAX_STRATEGIES}개까지 저장할 수 있어요`;

/** 저장 한도를 넘으면 던진다. 앱 상태와 저장소가 같은 문구·기준을 쓴다. */
export function assertStrategyCap(list: Strategy[]): void {
  if (list.length > MAX_STRATEGIES) throw new Error(STRATEGY_CAP_MESSAGE);
}

export function saveStrategies(st: SafeStorage, profileId: string, list: Strategy[]): void {
  assertStrategyCap(list);
  st.set(profileKeys.strategySet(profileId), { strategies: list });
}
```

`src/lib/state/app.svelte.ts`:
- `:128` `applySyncedProfile(id: string, doc: ProfileDocV1): void;` → `doc: ProfileDoc`(import도 `ProfileDoc`로).
- `:637` 아래에 `remove(profileKeys.strategySet(id));`
- `:661` 배열에 `profileKeys.strategySet(id)`를 더해요(옛 키는 남겨요).
- `:835` `write(profileKeys.strategies(activeId()), …)` → `write(profileKeys.strategySet(activeId()), { strategies: list });`

`src/lib/sync/dto.ts`:
- `:7` `import { sanitizeStrategies } from '../sim/validate';` → `import { sanitizeStrategiesV1, type StrategyV1 } from '../sim/strategyV1';`
- `:9` `import type { Strategy } from '../sim/types';` 줄을 지워요.
- `ProfileDocV1.strategies: Strategy[]` → `strategies: StrategyV1[];`
- `:16` → `export const PROFILE_DOC_VERSION = 2;`, 주석은 `/** 앱이 만드는 문서 버전(전략 빌더 v2) */`
- `:116`의 `sanitizeStrategies(` → `sanitizeStrategiesV1(`

이 파일의 다른 줄(판정 순서·`TOP_KEYS`·`checkProfileDoc` 반환)은 바꾸지 않아요(N4).

`src/lib/sync/profileDoc.ts`를 바꿔요.

```ts
import { sanitizeStrategiesV1, toV2 } from '../sim/strategyV1';
import { PROFILE_NAME_MAX, pickSyncedSettings, type ProfileDoc, type ProfileDocV2 } from './dto';

/** 전략을 뺀 문서 부분. 옮기기 단계(migrate.ts)가 v1·v2 해시를 같은 바탕으로 계산하는 데도 쓴다 */
export function profileDocBase(st: SafeStorage, profileId: string, name: string): Omit<ProfileDocV2, 'v' | 'strategies'> {
  return {
    name: docName(name),
    settings: pickSyncedSettings(loadSettings(st, profileId)),
    watchlists: loadWatchlists(st, profileId),
    criteria: loadCriteria(st, profileId),
    baskets: loadBaskets(st, profileId),
  };
}

/** 저장된 프로필로 문서(v2)를 만든다. 읽기 검증은 각 load 함수가 한다. */
export function buildProfileDoc(st: SafeStorage, profileId: string, name: string): ProfileDocV2 {
  return { v: 2, ...profileDocBase(st, profileId, name), strategies: loadStrategies(st, profileId) };
}

/**
 * 검증된 문서를 이 프로필 ID에 쓴다. v2는 새 키에만, v1(아직 옮기지 않은 기기의 서버 문서)은 옛 키에 v1을 쓰고
 * 그 자리에서 toV2한 결과를 새 키에도 쓴다(스펙 §8.2). 설정은 동기화 필드만 바꾼다.
 */
export function applyProfileDoc(st: SafeStorage, profileId: string, doc: ProfileDoc): void {
  const settings = loadSettings(st, profileId);
  st.set(profileKeys.settings(profileId), { ...settings, ...doc.settings, period: { ...doc.settings.period } });
  st.set(profileKeys.watchlists(profileId), doc.watchlists);
  if (doc.v === 1) {
    st.set(profileKeys.strategies(profileId), { strategies: doc.strategies });
    st.set(profileKeys.strategySet(profileId), { strategies: sanitizeStrategiesV1({ strategies: doc.strategies }).strategies.map(toV2) });
  } else st.set(profileKeys.strategySet(profileId), { strategies: doc.strategies });
  st.set(profileKeys.criteria(profileId), { criteria: doc.criteria });
  st.set(profileKeys.baskets(profileId), { baskets: doc.baskets });
}
```

(`docName`은 그대로 둬요. 원래 import 중 `ProfileDocV1`은 지워요.)

`src/lib/sync/engine.ts`·`store.ts`·`api.ts`·`src/lib/ui/settings/SyncPanel.svelte`: `ProfileDocV1`을 모두 `ProfileDoc`로 바꿔요(import 포함). 동작은 같아요.

공유 검사가 계약 테스트에서 v1 검증을 부를 수 있게 `src/lib/share/snapshot.ts`의 v1 검증 이름만 먼저 바꿔요(동작 같음, 나머지는 4c): `import { resolveSymbols, sanitizeStrategies } from '../sim/validate';` → `import { resolveSymbols } from '../sim/validate';`와 `import { sanitizeStrategiesV1 } from '../sim/strategyV1';`, `checkStrategyPart` 안의 `sanitizeStrategies(` → `sanitizeStrategiesV1(`.

- [ ] **Step 4: Worker 테스트 고정값**

`sync-worker/test/docs.ts`: `import { newStrategy } from '../../src/lib/sim/defaults';` → `import { newStrategyV1 } from '../../src/lib/sim/strategyV1';`, `doc()`의 `newStrategy(T0, 'g0', '눌림목')` → `newStrategyV1(T0, 'g0', '눌림목')`. Worker 테스트 코드만 바꾸고 Worker 동작은 그대로예요.

`src/lib/sync/dto.test.ts`의 `seeded()`는 `seed(backing, \`p:${PID}:strategies\`, …)`를 `seed(backing, \`p:${PID}:strategySet\`, { strategies: [newStrategy(NOW, 'g-1', '눌림목')] })`로 바꿔요(새 키에 v2).

- [ ] **Step 5: 통과 확인**

Run: `TZ=America/New_York corepack pnpm vitest run src/lib/sim/strategyStore.test.ts src/lib/sync/dto.test.ts src/lib/sync/contract.test.ts src/lib/sync/engine.test.ts src/lib/sync/roundtrip.test.ts && (cd sync-worker && npx vitest run src/profiles.test.ts)`
Expected: PASS. `contract.test.ts`(N4)가 여기서 초록이어야 해요. Worker 공유 테스트(`shares.test.ts`)와 Worker 타입 검사는 4c에서 초록이 돼요(그 테스트가 아직 옛 `sanitizeStrategies`를 불러요).

- [ ] **Step 6: 커밋**

```bash
git add src/lib/sim/strategyStore.ts src/lib/sim/strategyStore.test.ts src/lib/state/profileStore.ts src/lib/state/app.svelte.ts src/lib/sync src/lib/share/snapshot.ts src/lib/ui/settings/SyncPanel.svelte sync-worker/test/docs.ts
git commit -m "feat(sync): 전략을 새 저장 키에 두고 프로필 문서를 v2로 만듦"
```

---

#### Task 4c: 공유·내보내기

**Files:** `src/lib/share/snapshot.ts`, `src/lib/share/compact.ts:214`, `src/lib/share/importPlan.ts:11,138`, `src/lib/share/pendingImport.ts:54,56`, `src/lib/share/shareText.ts:52-56,97-99`, `src/lib/share/testFixtures.ts:26`, `src/lib/state/exportImport.ts:21,27,35,40,122,133,153`, `sync-worker/src/shares.test.ts:217`, 테스트 `src/lib/share/snapshot.test.ts`·`src/lib/state/exportImport.test.ts`

- [ ] **Step 1: 실패 테스트 쓰기**

`src/lib/share/snapshot.test.ts`에서 PR①의 `it('read: v2는 unsupported(PR① 앱은 v1만 그린다), v1은 v1 그대로', …)`를 아래로 바꿔요.

```ts
  it('read: v2는 받고, v1은 v2로 옮겨 v: 2로 돌려준다(§8.4)', () => {
    expect(checkShareSnapshot(strategyV2Snap(), 'strategy', NOW, 'read')).toMatchObject({ ok: true });
    const v1 = { kind: 'strategy', v: 1, title: '눌림목', strategy: { ...newStrategyV1(NOW, null, '눌림목'), id: 'shared', updatedAt: 0, universe: { kind: 'symbols', symbols: ['005930'] } }, capitalHidden: false };
    const r = checkShareSnapshot(v1, 'strategy', NOW, 'read');
    expect(r.ok).toBe(true);
    if (r.ok && r.snapshot.kind === 'strategy') {
      expect(r.snapshot.v).toBe(2);
      expect(r.snapshot.strategy).toEqual(toV2(v1.strategy as never));
    }
  });
  it('strategySnapshot은 v: 2로 만든다', () => {
    expect(strategySnapshot(newStrategy(NOW, null, '눌림목'), w, { hideCapital: false, now: NOW }).v).toBe(2);
  });
```

(import에 `newStrategyV1`·`toV2`(`../sim/strategyV1`)를 더해요. 같은 `describe` 안의 `'create: v1 전략 공유는 지금처럼 받는다'`는 `strategySnapshot(newStrategy(…))` 대신 위 `v1` 객체 모양으로 만들어요(이제 `newStrategy`는 v2예요).)


`src/lib/state/exportImport.test.ts` 끝에 붙여요(파일의 기존 도우미를 써요).

```ts
describe('내보내기 v2(§8.5)', () => {
  it('schemaVersion 2로 내보내고, v1 파일은 전략을 옮겨 새 키에 쓴다', () => {
    const st = createSafeStorage(memoryBacking());
    const v1 = { ...newStrategyV1(0, null, '옛'), id: 's1' };
    const file = { format: EXPORT_FORMAT, schemaVersion: 1, profile: { name: '옛' }, settings: {}, watchlists: { groups: [{ id: 'g0', name: '관심', items: [] }] }, recent: [], strategies: [v1] };
    const r = importData(st, JSON.stringify(file), () => 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(st.get(profileKeys.strategySet(r.profileId), null)).toEqual({ strategies: [toV2(v1)] });
    expect(st.get(profileKeys.strategies(r.profileId), null)).toBeNull();
    expect(JSON.parse(exportData(st, r.profileId, false)).schemaVersion).toBe(2);
  });
  it('알 수 없는 버전은 거절한다', () => {
    const st = createSafeStorage(memoryBacking());
    expect(importData(st, JSON.stringify({ format: EXPORT_FORMAT, schemaVersion: 3, settings: {} }))).toEqual({ ok: false, reason: IMPORT_BAD_VERSION });
  });
});
```

(`watchlists` 고정값이 `validWatchlists`를 통과하지 않으면 이 파일의 기존 성공 테스트가 쓰는 관심종목 모양을 그대로 써요.)


- [ ] **Step 2: 실패 확인**

Run: `TZ=America/New_York corepack pnpm vitest run src/lib/share/snapshot.test.ts src/lib/state/exportImport.test.ts`
Expected: FAIL — read v2가 `unsupported`, 내보내기 `schemaVersion`이 1이에요.

- [ ] **Step 3: 공유**

`src/lib/share/snapshot.ts`:
- import: `import { resolveSymbols, sanitizeStrategies } from '../sim/validate';` → `import { resolveSymbols } from '../sim/validate';`, `import { sanitizeStrategiesV1, toV2, type StrategyV1 } from '../sim/strategyV1';`, `import { defaultPatternEntry, newStrategy } from '../sim/defaults';`(이미 있는 `newStrategy` import에 합쳐요), `import { patternEntryOf } from '../sim/patternBlock';`
- 상수 더하기: `/** strategy·simResult를 만드는 버전(전략 v2) */ export const STRATEGY_SHARE_VERSION = 2;`. `SHARE_VERSION = 1`의 주석은 `/** strategy·simResult 밖 종류를 만드는 버전 */`로.
- `StrategySnapshot`·`SimResultSnapshot`의 `v: 1` → `v: 2`.
- `strategySnapshot`의 반환 `v: 1` → `v: STRATEGY_SHARE_VERSION`.
- `criteriaSnapshot`의 반등 패턴 줄을 바꿔요.

```ts
  if (pattern.from === 'strategy') {
    const ref = refs.strategies.find((x) => x.id === pattern.strategyId);
    const entry = ref ? patternEntryOf(ref) : null;
    criteria.conditions.rebound.pattern = { from: 'custom', entry: structuredClone(entry ?? defaultPatternEntry()) };
  }
```

- `checkStrategyPart`: `Strategy | StrategyV2` 자리를 `StrategyV1 | Strategy`로, `sanitizeStrategies(` → `sanitizeStrategiesV1(`.
- `checkShareSnapshot`의 버전 상한 줄을 바꿔요(read에서도 strategy 종류는 2까지. create 판정은 그대로).

```ts
  const maxV = strategyKind ? STRATEGY_SHARE_MAX_VERSION : SHARE_VERSION;
```

- 파일에 도우미를 더하고 `case 'strategy'`·`case 'simResult'`의 read 반환을 바꿔요.

```ts
/** read 결과는 늘 v2 전략·v: 2로 돌려준다(v1 공유 링크는 옮겨 연다, §8.4) */
const upgrade = (x: StrategyV1 | Strategy): Strategy => ('rules' in x ? x : toV2(x));
```

```ts
      return { ok: true, snapshot: (mode === 'create' ? raw : { ...raw, v: STRATEGY_SHARE_VERSION, strategy: upgrade(st.strategy) }) as unknown as StrategySnapshot };
```

```ts
      return { ok: true, snapshot: (mode === 'create' ? raw : { ...raw, v: STRATEGY_SHARE_VERSION, strategy: upgrade(st.strategy) }) as unknown as SimResultSnapshot };
```

`src/lib/share/compact.ts:214` `v: 1,` → `v: STRATEGY_SHARE_VERSION,`(import 더하기). `:40`(compare)·`:451`(validation)은 그대로예요.

`src/lib/share/importPlan.ts`: `:11` → `import { sanitizeStrategiesV2 } from '../sim/strategyV2';`, `:138`의 `sanitizeStrategies(` → `sanitizeStrategiesV2(`.

`src/lib/share/pendingImport.ts:54` → `return { kind: 'strategy', v: s.v, title: s.title, strategy: s.strategy, capitalHidden: s.capitalHidden };`, `:56` → `v: s.v`.

`src/lib/share/shareText.ts`의 두 전략 문구는 Task 10에서 최종으로 바꿔요. 여기서는 컴파일만 맞춰요: `st.entry.decline.dropPct` 자리는 `patternEntryOf(st)?.decline.dropPct`를 쓰고(없으면 `'끔'`), `st.exit.takeProfit`은 `st.rules.sell.takeProfit.stages`, `st.exit.stopLoss.pct`는 `st.rules.sell.stopLoss.pct`, `st.capital.perBuyPct`는 `st.sizing.pct`로 바꿔요.


테스트 고정값:
- `src/lib/share/testFixtures.ts:26`(`simResultFixture`)의 `v: 1` → `v: STRATEGY_SHARE_VERSION`(import 더하기). `:94`(`validationFixture`)의 `v: 1`은 그대로예요.
- `sync-worker/src/shares.test.ts:217`의 v1 공유 테스트는 v1 스냅샷을 유지해야 해요. `newStrategy(0, null, '눌림목')`을 `newStrategyV1(0, null, '눌림목')`(`../../src/lib/sim/strategyV1`)으로 바꾸고, `strategySnapshot`이 이제 `v: 2`를 붙이니 만든 스냅샷에 `v: 1`을 덮어써요(`const v1 = { ...snapshot, v: 1, strategy: … }`). 같은 테스트의 `sanitizeStrategies(` → `sanitizeStrategiesV1(`. Worker 테스트 코드만 바꾸고 Worker 동작은 그대로예요.

- [ ] **Step 4: 내보내기**

`src/lib/state/exportImport.ts`:
- `:21` → `import { sanitizeStrategiesV1, toV2 } from '../sim/strategyV1';`와 `import { sanitizeStrategiesV2 } from '../sim/strategyV2';`
- `:27` → `export const EXPORT_SCHEMA_VERSION = 2;`
- `:122` → `if (file.schemaVersion !== 1 && file.schemaVersion !== 2) return fail(IMPORT_BAD_VERSION);`
- `:133`을 바꿔요.

```ts
  // v1 파일(전략 빌더 이전)은 전략을 옮긴다(스펙 §8.5)
  const v1 = file.schemaVersion === 1 ? sanitizeStrategiesV1(file, now()) : null;
  const { strategies, repaired: strategiesRepaired } = v1 ? { strategies: v1.strategies.map(toV2), repaired: v1.repaired } : sanitizeStrategiesV2(file, now());
```

- `:153` → `st.set(profileKeys.strategySet(id), { strategies });`

- [ ] **Step 5: 통과 확인**

Run: `TZ=America/New_York corepack pnpm vitest run src/lib/share src/lib/state src/lib/sync/contract.test.ts && (cd sync-worker && npx vitest run && npx tsc -p tsconfig.json --noEmit)`
Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add src/lib/share src/lib/state/exportImport.ts src/lib/state/exportImport.test.ts sync-worker/src/shares.test.ts
git commit -m "feat(share): 전략 공유를 v2로 만들고 v1 공유·내보내기 파일을 옮겨 읽음"
```

---

#### Task 4d: 선정 기준·화면 컴파일 (여기서 전체 초록)

**Files:** `src/lib/screen/defaults.ts:47`, `src/lib/screen/testData.ts:71-72`, `src/lib/screen/types.ts:43`, `src/lib/screen/precompute.ts:117,130-174,204,242`, `src/lib/screen/runValidation.ts:330-336`, `src/lib/ui/simulate/editor/PatternFields.svelte`(= `EntrySection.svelte`를 옮김), `src/lib/ui/simulate/StrategyEditor.svelte:16,232`, `src/lib/ui/simulate/editor/ExitSection.svelte`, `src/lib/ui/simulate/editor/PeriodSection.svelte:38`, `src/lib/ui/simulate/simText.ts:49-102,208-215`, `src/lib/ui/simulate/ResultView.svelte:66`, `src/lib/ui/screen/CriteriaEditor.svelte:27,318-347,500`, 그리고 `corepack pnpm check`가 가리키는 테스트·고정값 파일

- [ ] **Step 1: 선정 기준(컴파일)**


- `src/lib/screen/defaults.ts:47` → `pattern: { from: 'custom', entry: defaultPatternEntry() },`(import `defaultPatternEntry`).
- `src/lib/screen/testData.ts:71-72` → `export function reboundEntry(): PatternEntry { const e = defaultPatternEntry();`(나머지 본문 그대로).
- `src/lib/screen/types.ts:43` → `entry: PatternEntry`(import `type PatternEntry` from `'../sim/types'`).
- `src/lib/screen/precompute.ts`: `Strategy['entry']`를 모두 `PatternEntry`로. `MissingStrategyError` 아래에 더하고 `resolveReboundEntry`를 바꿔요.

```ts
export class MissingPatternError extends Error {
  constructor() {
    super('반등 패턴에 고른 전략에 반등 패턴이 없어요');
    this.name = 'MissingPatternError';
  }
}
```

```ts
/** 반등 조건의 패턴을 실제 entry로 해석한다. 꺼져 있으면 null. 전략이 없거나 그 전략에 패턴 블록이 없으면 던진다 */
export function resolveReboundEntry(criteria: SelectionCriteria, strategies: Strategy[]): PatternEntry | null {
  const rb = criteria.conditions.rebound;
  if (!rb.on) return null;
  if (rb.pattern.from === 'custom') return rb.pattern.entry;
  const id = rb.pattern.strategyId;
  const s = strategies.find((x) => x.id === id);
  if (!s) throw new MissingStrategyError();
  const entry = patternEntryOf(s);
  if (!entry) throw new MissingPatternError();
  return entry;
}
```

- `src/lib/screen/runValidation.ts:330-336`의 `strategy` 만들기를 바꿔요(`equal` 바꾸기는 Task 11).

```ts
  const strategy: Strategy = {
    ...ref,
    period: { ...criteria.period },
    capital: { initial: criteria.capital },
    costs: { feePct: criteria.costs.feePct },
    benchmarks: { index: firstIndex ?? 'KOSPI', symbol: null },
  };
```

- [ ] **Step 2: 화면(컴파일)**

`src/lib/ui/simulate/editor/EntrySection.svelte`를 `PatternFields.svelte`로 옮겨요(`git mv`). 바꿀 것:
- props: `s: Strategy; update: (fn: (s: Strategy) => void) => void;`를 `entry: PatternEntry; update: (fn: (e: PatternEntry) => void) => void;`로(import `type PatternEntry` from `'../../../sim/types'`).
- `$derived(s.entry.decline)` → `$derived(entry.decline)`, `s.entry.triggers` → `entry.triggers`, `s.entry.filter.aboveMa` → `entry.filter.aboveMa`.
- 모든 `update((x) => (x.entry.` → `update((e) => (e.`(예: `update((x) => (x.entry.decline.dropPct.on = v))` → `update((e) => (e.decline.dropPct.on = v))`).
- 머리 주석 `// 매수: …`를 `// 반등 패턴 블록: 하락 조건 2줄, 트리거 4줄, 필터 1줄. 전략 편집(매수 조건)과 선정 기준(직접 정하기)이 같이 쓴다.`로.

`src/lib/ui/simulate/StrategyEditor.svelte`: import를 `PatternFields`로 바꾸고 `:232`의 `<EntrySection s={draft} {update} />`를 아래로 바꿔요(Task 13에서 묶음 편집기로 바뀌어요).

```svelte
        {@const gi = draft.rules.buy.findIndex((g) => g.conds.some((c) => c.kind === 'pattern'))}
        {#if gi >= 0}
          {@const ci = draft.rules.buy[gi].conds.findIndex((c) => c.kind === 'pattern')}
          {@const cond = draft.rules.buy[gi].conds[ci]}
          {#if cond.kind === 'pattern'}
            <PatternFields
              entry={cond.entry}
              update={(fn) =>
                update((x) => {
                  const c = x.rules.buy[gi].conds[ci];
                  if (c.kind === 'pattern') fn(c.entry);
                })}
            />
          {/if}
        {/if}
```

`src/lib/ui/simulate/editor/ExitSection.svelte`: 경로만 바꿔요(토글은 Task 14).
- `s.exit.takeProfit` → `s.rules.sell.takeProfit.stages`, `x.exit.takeProfit` → `x.rules.sell.takeProfit.stages`
- `s.exit.stopLoss` → `s.rules.sell.stopLoss`, `x.exit.stopLoss` → `x.rules.sell.stopLoss`
- `s.exit.afterFirstTake` → `s.rules.sell.takeProfit.afterFirstTake`, `x.exit.afterFirstTake` → `x.rules.sell.takeProfit.afterFirstTake`

`src/lib/ui/simulate/editor/PeriodSection.svelte:38` → `<NumberField label="회당 매수 비중" value={s.sizing.pct} min={1} max={100} suffix="% (처음 자금 대비)" onchange={(v) => update((x) => (x.sizing.pct = v))} />`

`src/lib/ui/simulate/simText.ts`(최종 문구는 Task 12):
- `entrySummary(s)`: 첫 줄을 `const p = patternEntryOf(s); if (!p) return \`조건 묶음 ${s.rules.buy.length}개\`; const { decline, triggers: t, filter } = p;`로.
- `exitSummary(s)`: `s.exit` 자리를 `s.rules.sell` 경로로(`const { stages: takeProfit, afterFirstTake } = s.rules.sell.takeProfit; const { stopLoss } = s.rules.sell;`).
- `'capital'` → `` `${money(s.capital.initial)} · 회당 ${s.sizing.pct}%` ``
- `nearMissText(nm, s)`: `const p = patternEntryOf(s); if (!p) return \`가장 크게 빠진 때는 ${drop}였어요\`; const { dropPct, days } = p.decline;`
- import `patternEntryOf`.

`src/lib/ui/simulate/ResultView.svelte:66` → `const breakout = $derived(patternEntryOf(meta.strategy)?.triggers.breakout ?? { on: false, level: 'B' as const });`(import `patternEntryOf` from `'../../sim/patternBlock'`).

`src/lib/ui/screen/CriteriaEditor.svelte`:
- `:27` → `import PatternFields from '../simulate/editor/PatternFields.svelte';`, import에 `defaultPatternEntry`(`'../../sim/defaults'`), `patternEntryOf`(`'../../sim/patternBlock'`), `type PatternEntry`(`'../../sim/types'`).
- `Strategy['entry']`를 모두 `PatternEntry`로.
- `:335` → `const refEntry = ref ? patternEntryOf(ref) : null; const entry = customMemo ?? (refEntry ? (structuredClone($state.snapshot(refEntry)) as PatternEntry) : defaultPatternEntry());`
- `entryHost`·`updateEntry`를 아래로 바꿔요.

```ts
  const updateEntry = (fn: (e: PatternEntry) => void) =>
    update((c) => {
      const p = c.conditions.rebound.pattern;
      if (p.from === 'custom') fn(p.entry);
    });
```

- `:500` → `{:else if pattern.from === 'custom'}<PatternFields entry={pattern.entry} update={updateEntry} nf={(k) => nf(\`entry-${k}\`)} />`(앞 `{:else if entryHost}` 분기를 이것으로).

- [ ] **Step 3: 남은 테스트·고정값 옮기기**

나머지는 컴파일러가 가리키는 대로 아래 대응표로 고쳐요.

Run: `corepack pnpm check 2>&1 | grep -E "Error|error" | head -80`

| v1 | v2 |
|---|---|
| `s.entry` | `patternEntryOf(s)!`(테스트에서 기본 전략이면 패턴이 있어요) 또는 `s.rules.buy[0].conds[0]`의 `entry` |
| `s.exit.takeProfit` | `s.rules.sell.takeProfit.stages` |
| `s.exit.stopLoss` | `s.rules.sell.stopLoss`(값을 통째로 넣을 때는 `on: true`를 함께) |
| `s.exit.afterFirstTake` | `s.rules.sell.takeProfit.afterFirstTake` |
| `s.capital.perBuyPct` | `s.sizing.pct` |
| `newStrategy(…).entry` | `defaultPatternEntry()` |
| `Strategy['entry']` | `PatternEntry` |
| `sanitizeStrategies(…)`(v1 데이터) | `sanitizeStrategiesV1(…)` |
| `sanitizeStrategies(…)`(앱 데이터) | `sanitizeStrategiesV2(…)` |
| 테스트가 옛 키 `p:<id>:strategies`에 `newStrategy(…)`를 넣음(예: `src/lib/sync/dto.test.ts`의 `seeded()`) | 새 키 `p:<id>:strategySet`에 넣어요. 옛 키 옮기기를 보려는 테스트만 옛 키에 `newStrategyV1(…)`을 넣어요 |

`src/lib/ui/simulate/StrategyEditor.test.ts`의 `import entrySource from './editor/EntrySection.svelte?raw';`는 `import entrySource from './editor/PatternFields.svelte?raw';`로 바꿔요.

대상이 될 파일(검색: `grep -rln "\.entry\.\|\.exit\.\|perBuyPct\|sanitizeStrategies\b\|Strategy\['entry'\]" src tests sync-worker/src sync-worker/test`): `src/lib/share/testFixtures.ts`, `src/lib/ui/simulate/resultFixture.ts`, `src/lib/sim/validate.test.ts`, `src/lib/screen/*.test.ts`, `src/lib/ui/simulate/*.test.ts`, `src/lib/share/*.test.ts` 등. `src/lib/sim/validate.test.ts`의 v1 검증 테스트는 `sanitizeStrategiesV1`(`./strategyV1`)로 import를 바꿔 그대로 둬요.

- [ ] **Step 4: 통과 확인(전체)**

Run: `corepack pnpm test && corepack pnpm check && (cd sync-worker && npx vitest run && npx tsc -p tsconfig.json --noEmit)`
Expected: 모두 PASS. 골든·`contract.test.ts` 포함.

- [ ] **Step 5: 커밋**

```bash
git add -A src
git commit -m "feat(simulate): 선정 기준과 편집 화면을 v2 전략에 맞춤"
```

---

### Task 5: 자금 배분 4방식

**Files:**
- Modify: `src/lib/sim/simulate.ts`(`simulateCore`의 `amount`, `SymState`, 예약 매수, `walkBar` 호출)
- Test: `src/lib/sim/simulate.rules.test.ts`(새 파일)

**Interfaces:**
- Produces: `SymState.posAmount: number`(포지션을 열 때 정한 1회 금액, 추가 매수도 이 금액)

- [ ] **Step 1: 실패 테스트 쓰기** — `src/lib/sim/simulate.rules.test.ts`

```ts
// 전략 빌더 엔진(배분·트레일링·기간 청산·조건 매도) 동작. 대표 입력은 testInputs의 봉 도우미를 쓴다.
import { describe, expect, it } from 'vitest';
import { simulate } from './simulate';
import { baseStrategy, BASE, candlesFrom, D, flat, stockOf, type Ohlc } from './testInputs';
import type { SimInput, Strategy } from './types';

/** BASE 뒤에 봉을 붙인 종목들로 입력을 만든다. 인덱스 8 종가 신호 → 인덱스 9 시가 매수 */
function input(strategy: Strategy, rests: Ohlc[][], n = 16): SimInput {
  return { strategy, days: D.slice(0, n), stocks: rests.map((r, k) => stockOf(k, candlesFrom(BASE, r))), index: null, benchmarkStock: null };
}
const v2 = (edit: (s: Strategy) => void) => {
  const s = baseStrategy();
  edit(s);
  return s;
};
const buys = (r: ReturnType<typeof simulate>) => r.trades.filter((t) => t.kind === 'buy' || t.kind === 'add');

describe('자금 배분(§6)', () => {
  const flatRest = flat([86, 86, 86, 86, 86, 86, 86]);
  it('fixed: 처음 자금 × pct', () => {
    const r = simulate(input(v2((s) => (s.sizing = { mode: 'fixed', pct: 10 })), [flatRest]));
    expect(buys(r)[0].qty).toBe(Math.floor(1_000_000 / (86 * 1.00015)));
  });
  it('equal: 처음 자금 ÷ 받은 종목 수', () => {
    const r = simulate(input(v2((s) => (s.sizing = { mode: 'equal', pct: 10 })), [flatRest, flatRest]));
    expect(buys(r)[0].qty).toBe(Math.floor(5_000_000 / (86 * 1.00015)));
  });
  it('cashPct: 같은 시가에 앞 종목이 산 뒤 남은 현금으로', () => {
    const r = simulate(input(v2((s) => (s.sizing = { mode: 'cashPct', pct: 50 })), [flatRest, flatRest]));
    const [a, b] = buys(r);
    expect(a.symbol).toBe('S0');
    expect(b.symbol).toBe('S1');
    expect(b.qty).toBeLessThan(a.qty);
  });
  it('equityPct: 전 거래일 종가 총자산 기준(첫 매수일 전날 총자산 = 처음 자금)', () => {
    const r = simulate(input(v2((s) => (s.sizing = { mode: 'equityPct', pct: 10 })), [flatRest]));
    expect(buys(r)[0].qty).toBe(Math.floor(1_000_000 / (86 * 1.00015)));
  });
  it('추가 매수는 포지션을 열 때 정한 금액을 쓴다(cashPct)', () => {
    const s = v2((x) => {
      x.sizing = { mode: 'cashPct', pct: 50 };
      x.scaleIn = { on: true, stepPct: 3, maxAdds: 1 };
      x.rules.sell.stopLoss.on = true;
    });
    const r = simulate(input(s, [[[86, 86, 82, 83], ...flat([83, 83, 83, 83])]]));
    const [first, add] = buys(r);
    expect(add.kind).toBe('add');
    expect(add.qty * add.price).toBeLessThanOrEqual(first.qty * first.price * 1.06);
    expect(add.qty * add.price).toBeGreaterThan(first.qty * first.price * 0.9);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `TZ=America/New_York corepack pnpm vitest run src/lib/sim/simulate.rules.test.ts`
Expected: FAIL — `equal`·`cashPct`가 `fixed`와 같은 수량으로 나와요.

- [ ] **Step 3: 구현** — `src/lib/sim/simulate.ts`

`SymState`에 `posAmount: number;`를 더하고 `syms` 만들기의 반환 객체에 `posAmount: 0`을 더해요. `const amount = …` 줄을 지우고 아래 함수를 `simulateCore` 안(`record` 위)에 둬요.

```ts
  const initial = roundMoney(s.capital.initial);
  const { mode, pct } = s.sizing;
  /** 지금 열 포지션의 1회 금액(스펙 §6.1). equityPct는 전 거래일 종가 총자산, cashPct는 그 순간 현금 */
  const amountNow = (): number => {
    switch (mode) {
      case 'fixed':
        return roundMoney((s.capital.initial * pct) / 100);
      case 'equityPct':
        return roundMoney(((equity.length ? equity[equity.length - 1].value : initial) * pct) / 100);
      case 'cashPct':
        return roundMoney((wallet.cash * pct) / 100);
      case 'equal':
        return roundMoney(s.capital.initial / Math.max(1, input.stocks.length));
    }
  };
```

예약 매수 블록의 `const sized = sizeBuy(amount, price, feePct, wallet.cash);`를 바꾸고 포지션을 열 때 금액을 붙여요.

```ts
      const posAmount = amountNow();
      const sized = sizeBuy(posAmount, price, feePct, wallet.cash);
```

```ts
      st.pos = openPosition(price, sized.qty, s.scaleIn, exitOf(s.rules.sell));
      st.posAmount = posAmount;
```

`walkBar` 호출의 `amount,`를 `amount: st.posAmount,`로 바꿔요. `fixed`는 지금과 같은 금액이라 골든이 그대로예요.

- [ ] **Step 4: 통과 확인**

Run: `TZ=America/New_York corepack pnpm vitest run src/lib/sim && corepack pnpm check`
Expected: PASS(골든 포함). 「추가 매수」 테스트의 봉이 추가 매수 가격(83.42)을 지나지 않으면 두 번째 봉의 저가를 82로 둔 지금 값이 맞는지 `simulate` 결과의 `trades`를 출력해 확인하고, 봉만 고쳐요.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/sim/simulate.ts src/lib/sim/simulate.rules.test.ts
git commit -m "feat(simulate): 자금 배분 4방식(처음 자금·총자산·남은 현금·균등)을 더함"
```

---
### Task 6: 손절·익절 끄기와 트레일링 스톱

**Files:**
- Modify: `src/lib/sim/position.ts`(Task 4의 `PositionExit`를 `SellRules`로)
- Modify: `src/lib/sim/simulate.ts`(`sellQty` 꺼내기, `walkBar` floor, `WalkCtx.trailPct`, 종가 `markClose`)
- Modify(테스트): `src/lib/sim/position.test.ts`, `src/lib/sim/simulate.test.ts:276-286`, `src/lib/sim/simulate.timeline.test.ts`(`openPosition` 호출)
- Test: `src/lib/sim/simulate.rules.test.ts`

**Interfaces:**
- Produces(`position.ts`):
  - `export type SellRules = Strategy['rules']['sell']`
  - `openPosition(price: number, qty: number, scaleIn: Strategy['scaleIn'], sell: SellRules): Position`
  - `Position.trailPrice(): number | null`, `Position.markClose(close: number): void`
- Produces(`simulate.ts`):
  - `export interface SellCtx { date: string; symbol: string; wallet: { cash: number }; feePct: number; taxPct: number; trade(t: Trade): void }`
  - `export function sellQty(pos: Position, qty: number, price: number, kind: Trade['kind'], reason: string, ctx: SellCtx, stage?: number): void`
  - `WalkCtx extends SellCtx`에 `trailPct: number`

- [ ] **Step 1: 실패 테스트 쓰기** — `src/lib/sim/simulate.rules.test.ts` 끝에 붙여요.

```ts
const kinds = (r: ReturnType<typeof simulate>) => r.trades.map((t) => `${t.kind}@${+t.price.toFixed(2)}`);

describe('손절·익절 끄기와 트레일링(§4.3·§4.4)', () => {
  // 인덱스 9 시가 86 매수 → 10 종가 100(기준가 100, 트레일 90)
  const up: Ohlc = [86, 100, 86, 100];
  const noTake = (edit: (s: Strategy) => void = () => {}) =>
    v2((s) => {
      s.rules.sell.takeProfit.on = false;
      s.rules.sell.trailing = { on: true, pct: 10 };
      edit(s);
    });

  it('보유 중 최고 종가에서 N% 내려오면 그 가격에 판다', () => {
    const r = simulate(input(noTake(), [[[86, 86, 86, 86], up, [99, 99, 89, 89], ...flat([89, 89])]]));
    expect(kinds(r)).toEqual(['buy@86', 'trail@90']);
    expect(r.trades[1].reason).toBe('트레일링 −10%');
  });
  it('시가가 트레일 아래로 갭이면 시가에 팔고 사유에 (갭)', () => {
    const r = simulate(input(noTake(), [[[86, 86, 86, 86], up, [85, 85, 85, 85], ...flat([85, 85])]]));
    expect(kinds(r)).toEqual(['buy@86', 'trail@85']);
    expect(r.trades[1].reason).toBe('트레일링 −10%(갭)');
  });
  it('손절가 = 트레일 가격이면 손절', () => {
    const s = noTake((x) => (x.rules.sell.stopLoss = { on: true, pct: 10, basis: 'firstBuy' }));
    const r = simulate(input(s, [[[86, 86, 86, 86], [80, 80, 70, 75], ...flat([75, 75])]]));
    expect(r.trades.map((t) => t.kind)).toEqual(['buy', 'stop']);
  });
  it('손절을 끄면 크게 떨어져도 팔지 않는다', () => {
    const s = v2((x) => {
      x.rules.sell.takeProfit.on = false;
      x.rules.sell.stopLoss.on = false;
    });
    const r = simulate(input(s, [[[86, 86, 40, 43], ...flat([43, 43, 43])]]));
    expect(r.trades.map((t) => t.kind)).toEqual(['buy']);
  });
  it('익절을 끄면 크게 올라도 팔지 않는다', () => {
    const s = v2((x) => (x.rules.sell.takeProfit.on = false));
    const r = simulate(input(s, [[[86, 200, 86, 190], ...flat([190, 190, 190])]]));
    expect(r.trades.map((t) => t.kind)).toEqual(['buy']);
  });
  it('손절을 꺼도 1단계 익절 뒤 본전 손절은 산다', () => {
    const s = v2((x) => {
      x.rules.sell.stopLoss.on = false;
      x.rules.sell.takeProfit = { on: true, stages: [{ pct: 5, sellPct: 50 }, { pct: 50, sellPct: 100 }], afterFirstTake: 'breakeven' };
    });
    const r = simulate(input(s, [[[86, 91, 86, 90], [90, 90, 80, 82], ...flat([82, 82])]]));
    expect(r.trades.map((t) => t.kind)).toEqual(['buy', 'take', 'stop']);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `TZ=America/New_York corepack pnpm vitest run src/lib/sim/simulate.rules.test.ts`
Expected: FAIL — 트레일링이 없어 `trail` 체결이 안 나오고, 손절·익절 끄기가 무시돼요.

- [ ] **Step 3: 구현** — `src/lib/sim/position.ts`

`PositionExit`를 지우고 아래로 바꿔요.

```ts
/** 포지션이 쓰는 매도 규칙(rules.sell). 기간 청산·조건 매도는 엔진이 다룬다 */
export type SellRules = Strategy['rules']['sell'];
```

`Position` 인터페이스에 더해요.

```ts
  /** 다음 거래일 장중에 쓰는 트레일 가격(보유 중 최고 종가 × (1 − pct)). 꺼져 있으면 null */
  trailPrice(): number | null;
  /** 그날 종가로 트레일 기준가를 갱신한다 */
  markClose(close: number): void;
```

`openPosition(price, qty, scaleIn, sell: SellRules)`로 바꾸고 본문에서:

```ts
  let peak = price; // 트레일 기준가: 매수가와 보유 중 종가의 최댓값(추가 매수로 바뀌지 않는다)
```

```ts
    stopPrice() {
      const { on, basis, pct } = sell.stopLoss;
      const f = 1 - pct / 100;
      let base: number | null = null;
      if (on) {
        if (basis === 'firstBuy') base = price * f;
        else if (basis === 'avgAlways') base = avg() * f;
        else base = scaleInDone() ? avg() * f : null;
      }
      // 본전 손절은 익절에 딸린 설정이라 손절을 꺼도 1단계 익절 뒤에는 산다(스펙 §4.4)
      if (stages >= 1 && sell.takeProfit.afterFirstTake === 'breakeven') {
        return base === null ? avg() : Math.max(base, avg());
      }
      return base;
    },
```

```ts
    takeLevels() {
      if (!sell.takeProfit.on) return [];
      const tp = sell.takeProfit.stages;
      const n = tp.length;
      const a = avg();
      const out: { stage: number; price: number; qty: number }[] = [];
      tp.forEach((t, i) => {
        const stage = i + 1;
        if (stage <= stages) return;
        const q = stage === n ? held : Math.min(held, Math.floor((bought * t.sellPct) / 100));
        out.push({ stage, price: a * (1 + t.pct / 100), qty: q });
      });
      return out;
    },

    trailPrice() {
      return sell.trailing.on ? peak * (1 - sell.trailing.pct / 100) : null;
    },

    markClose(close) {
      if (close > peak) peak = close;
    },
```

`src/lib/sim/simulate.ts`:
- `exitOf`와 `PositionExit` import를 지우고 `openPosition(price, sized.qty, s.scaleIn, s.rules.sell)`로 바꿔요.
- `sizeBuy` 위에 `SellCtx`·`sellQty`를 더하고 `WalkCtx`를 바꿔요.

```ts
/** 한 종목을 파는 데 필요한 것(장중 경로·시가 예약 매도 공용) */
export interface SellCtx {
  date: string;
  symbol: string;
  wallet: { cash: number };
  feePct: number;
  taxPct: number; // 그날 매도세 %
  trade(t: Trade): void;
}

/** qty주를 price에 판다. 수수료·세금·현금 반영·체결 줄 모양을 한곳에서 정한다 */
export function sellQty(pos: Position, qty: number, price: number, kind: Trade['kind'], reason: string, ctx: SellCtx, stage?: number): void {
  const gross = roundMoney(qty * price);
  const fee = roundMoney((gross * ctx.feePct) / 100);
  const tax = roundMoney((gross * ctx.taxPct) / 100);
  const pnlPct = (price / pos.avgPrice - 1) * 100;
  pos.sell(qty, stage);
  ctx.wallet.cash = roundMoney(ctx.wallet.cash + roundMoney(gross - fee - tax));
  ctx.trade({ date: ctx.date, symbol: ctx.symbol, kind, ...(stage !== undefined && { stage }), price, qty, fee, tax, reason, pnlPct });
}

/** 한 종목의 하루 장중 경로에 필요한 것 */
export interface WalkCtx extends SellCtx {
  amount: number; // 1회 매수 금액(포지션을 열 때 정한 값)
  takeProfit: Strategy['rules']['sell']['takeProfit']['stages'];
  trailPct: number; // 트레일링 사유 문구용
  excluded: Set<number>; // 그날 건너뛴 추가 매수 가격
  canBuy?: boolean; // false면 추가 매수를 하지 않는다(선정 기간 밖). 없으면 true
  skip(reason: Skip['reason'], addPrice: number): void;
}
```

- `walkBar`를 아래로 바꿔요(추가 매수 `add`는 그대로).

```ts
/** 시가 → 저가 → 고가 → 종가를 가격 커서 하나로 지나가며 손절·트레일링·추가 매수·익절을 체결한다(스펙 5.2, 전략 빌더 §4.3). */
export function walkBar(pos: Position, bar: Candle, ctx: WalkCtx): void {
  const { date, symbol, feePct } = ctx;
  const single = ctx.takeProfit.length === 1;
  const trailReason = (gap: boolean) => `트레일링 −${ctx.trailPct}%${gap ? '(갭)' : ''}`;

  const sell = (qty: number, price: number, kind: Trade['kind'], stage?: number, reason?: string) =>
    sellQty(pos, qty, price, kind, reason ?? (stage === undefined ? '손절' : single ? '익절' : `${stage}단계 익절 ${ctx.takeProfit[stage - 1].sellPct}%`), ctx, stage);

  const add = (level: number, price: number) => {
    const sized = sizeBuy(ctx.amount, price, feePct, ctx.wallet.cash);
    if (typeof sized === 'string') {
      ctx.excluded.add(level);
      ctx.skip(sized, level);
      return;
    }
    if (ctx.canBuy === false) {
      ctx.excluded.add(level);
      ctx.skip('선정 기간이 아니에요', level);
      return;
    }
    pos.buy(price, sized.qty);
    ctx.wallet.cash = roundMoney(ctx.wallet.cash - sized.cost);
    ctx.trade({ date, symbol, kind: 'add', price, qty: sized.qty, fee: sized.fee, tax: 0, reason: '추가 매수' });
  };

  let cur = bar.o;
  for (const to of [bar.l, bar.h, bar.c]) {
    while (pos.qty > 0) {
      // 내려갈 때 지키는 선: 손절가와 트레일 가격 중 높은 것. 같으면 손절이다
      const stop = pos.stopPrice();
      const trail = pos.trailPrice();
      const trailWins = trail !== null && (stop === null || trail > stop);
      const floor = trailWins ? trail : stop;
      const next = pos.nextAddPrice();
      const addAt = next !== null && !ctx.excluded.has(next) ? next : null;
      const takes = pos.takeLevels().filter((t) => t.qty > 0);

      // 1. 이미 지나친 가격은 커서에: 손절·트레일 → 추가 매수 → 익절(낮은 단계부터)
      if (floor !== null && floor >= cur) {
        const gap = floor > cur;
        if (trailWins) sell(pos.qty, cur, 'trail', undefined, trailReason(gap));
        else sell(pos.qty, cur, gap ? 'gapStop' : 'stop');
        continue;
      }
      if (addAt !== null && addAt >= cur) {
        add(addAt, cur);
        continue;
      }
      const passed = takes.find((t) => t.price <= cur);
      if (passed) {
        sell(passed.qty, cur, passed.price < cur ? 'gapTake' : 'take', passed.stage);
        continue;
      }

      if (to < cur) {
        // 2. 내려감: 구간 안의 가장 높은 손절·트레일·추가 매수, 같으면 손절·트레일
        const s = floor !== null && floor >= to ? floor : null;
        const a = addAt !== null && addAt >= to ? addAt : null;
        if (s !== null && (a === null || s >= a)) {
          cur = s;
          if (trailWins) sell(pos.qty, s, 'trail', undefined, trailReason(false));
          else sell(pos.qty, s, 'stop');
          continue;
        }
        if (a !== null) {
          cur = a;
          add(a, a);
          continue;
        }
      } else if (to > cur) {
        // 3. 올라감: 구간 안의 가장 낮은 익절
        const hit = takes.filter((t) => t.price <= to).sort((x, y) => x.price - y.price)[0];
        if (hit) {
          cur = hit.price;
          sell(hit.qty, hit.price, 'take', hit.stage);
          continue;
        }
      }
      break;
    }
    if (pos.qty === 0) return;
    cur = to;
  }
}
```

- `simulateCore`의 `walkBar` 호출에 `trailPct: s.rules.sell.trailing.pct,`를 더해요.
- 종가 루프(`st.lastClose = st.stock.candles[i].c;` 줄)에서 그 앞에 기준가 갱신을 더해요.

```ts
        if (st.pos) st.pos.markClose(st.stock.candles[i].c); // 트레일 기준가는 종가로(스펙 §4.3)
        st.lastClose = st.stock.candles[i].c;
```

- [ ] **Step 4: 테스트 고정값 고치기**

- `src/lib/sim/position.test.ts`: `type Exit = Strategy['exit']; const exit: Exit = {…}`를 아래로 바꾸고, 파일 안 `openPosition(…, exit)`과 `{ ...exit, … }` 변형은 `sell`과 `sellWith({...})`로 바꿔요.

```ts
import type { SellRules } from './position';
import type { StopBasis } from './types';
type V1Exit = { takeProfit: { pct: number; sellPct: number }[]; stopLoss: { pct: number; basis: StopBasis }; afterFirstTake: 'keep' | 'breakeven' };
/** v1 모양 익절·손절을 매도 규칙으로(손절·익절 켬, 트레일링·기간 청산·조건 매도 끔) */
const sellWith = (e: V1Exit): SellRules => ({
  takeProfit: { on: true, stages: e.takeProfit, afterFirstTake: e.afterFirstTake },
  stopLoss: { on: true, ...e.stopLoss },
  trailing: { on: false, pct: 10 },
  timeExit: { on: false, days: 20 },
  signal: { on: false, groups: [] },
});
```

기존 `const exit: Exit = { … }`의 값은 `const exit: V1Exit = { … }`로 두고 `const sell = sellWith(exit);`를 더해요. `openPosition(100, 10, scale, exit)` → `openPosition(100, 10, scale, sell)`, `{ ...exit, stopLoss: {…} }`처럼 바꾼 값은 `sellWith({ ...exit, stopLoss: {…} })`로 넘겨요.
- 같은 파일에 트레일 테스트를 더해요.

```ts
describe('trailPrice', () => {
  it('매수가와 종가 중 최고값 × (1 − pct), 추가 매수로 바뀌지 않는다', () => {
    const p = openPosition(100, 10, scale, { ...sellWith(exit), trailing: { on: true, pct: 10 } });
    expect(p.trailPrice()).toBeCloseTo(90);
    p.markClose(120);
    expect(p.trailPrice()).toBeCloseTo(108);
    p.markClose(110);
    p.buy(97, 5);
    expect(p.trailPrice()).toBeCloseTo(108);
  });
  it('꺼져 있으면 null', () => expect(openPosition(100, 10, scale, sellWith(exit)).trailPrice()).toBeNull());
});
```

- `src/lib/sim/simulate.test.ts:276-286`의 `WalkCtx` 고정값에 `trailPct: 10,`을 더하고, `takeProfit: s.exit.takeProfit`(Task 4에서 바꾼 줄)은 `s.rules.sell.takeProfit.stages`예요. 파일 안 `openPosition(…, {takeProfit…})` 인자는 `s.rules.sell`로 바꿔요.
- `src/lib/sim/simulate.timeline.test.ts`의 `openPosition` 호출도 네 번째 인자를 `strategy.rules.sell`로 바꿔요.

- [ ] **Step 5: 통과 확인**

Run: `TZ=America/New_York corepack pnpm vitest run src/lib/sim && corepack pnpm check`
Expected: PASS(골든 포함). 트레일링이 꺼진 전략은 `floor = stop`이라 경로가 같아요.

- [ ] **Step 6: 커밋**

```bash
git add src/lib/sim
git commit -m "feat(simulate): 손절·익절 끄기와 트레일링 스톱을 장중 경로에 더함"
```

---

### Task 7: 기간 청산과 조건 매도 (시가 예약 매도)

**Files:**
- Modify: `src/lib/sim/simulate.ts`(`SymState`, 하루 순서 ①, ④, 청산 정리 함수)
- Test: `src/lib/sim/simulate.rules.test.ts`

**Interfaces:**
- Produces(`SymState`): `pendingSell: { kind: 'time' | 'signalSell'; reason: string } | null`, `sellEval: RuleEvaluator | null`

- [ ] **Step 1: 실패 테스트 쓰기** — `src/lib/sim/simulate.rules.test.ts` 끝에

```ts
describe('기간 청산·조건 매도(§4.2·§4.5·§4.6)', () => {
  const quiet = (edit: (s: Strategy) => void) =>
    v2((s) => {
      s.rules.sell.takeProfit.on = false;
      s.rules.sell.stopLoss.on = false;
      edit(s);
    });
  const hold = flat([86, 87, 88, 89, 90, 91]);

  it('기간 청산: 매수일 = 1일째, N일째 종가 → 다음 날 시가', () => {
    const r = simulate(input(quiet((s) => (s.rules.sell.timeExit = { on: true, days: 2 })), [hold]));
    expect(r.trades.map((t) => [t.kind, t.date])).toEqual([['buy', D[9]], ['time', D[11]]]);
    expect(r.trades[1].reason).toBe('보유 2일 청산');
    expect(r.trades[1].price).toBe(88);
  });
  it('기간 청산: 거래정지일도 세고, 파는 날 봉이 없으면 봉 있는 날로 미룬다', () => {
    const s = quiet((x) => (x.rules.sell.timeExit = { on: true, days: 2 }));
    const stopped = { strategy: s, days: D.slice(0, 16), stocks: [stockOf(0, candlesFrom(BASE, hold, [10]))], index: null, benchmarkStock: null };
    expect(simulate(stopped).trades.map((t) => [t.kind, t.date])).toEqual([['buy', D[9]], ['time', D[11]]]);
    const late = { ...stopped, stocks: [stockOf(0, candlesFrom(BASE, hold, [11]))] };
    expect(simulate(late).trades.map((t) => [t.kind, t.date])).toEqual([['buy', D[9]], ['time', D[12]]]);
  });
  it('조건 매도: 종가가 맞으면 다음 날 시가에 남은 수량 전부', () => {
    const s = quiet((x) => (x.rules.sell.signal = { on: true, groups: [{ conds: [{ kind: 'maPrice', period: 2, side: 'below' }] }] }));
    const r = simulate(input(s, [flat([86, 90, 80, 81, 82, 83])]));
    expect(r.trades.map((t) => [t.kind, t.date])).toEqual([['buy', D[9]], ['signalSell', D[12]]]);
    expect(r.trades[1].reason).toBe('종가 2일선 아래');
  });
  it('예약 매도가 같은 날 갭 손절보다 먼저다', () => {
    const s = v2((x) => {
      x.rules.sell.takeProfit.on = false;
      x.rules.sell.stopLoss = { on: true, pct: 5, basis: 'firstBuy' };
      x.rules.sell.signal = { on: true, groups: [{ conds: [{ kind: 'maPrice', period: 2, side: 'below' }] }] };
    });
    const r = simulate(input(s, [[[86, 90, 86, 90], [90, 90, 84, 84], [70, 70, 70, 70], ...flat([70, 70])]]));
    expect(r.trades.map((t) => t.kind)).toEqual(['buy', 'signalSell']);
    expect(r.trades[1].price).toBe(70);
  });
  it('조건 매도와 기간 청산이 같은 날이면 조건 매도', () => {
    const s = quiet((x) => {
      x.rules.sell.timeExit = { on: true, days: 1 };
      x.rules.sell.signal = { on: true, groups: [{ conds: [{ kind: 'maPrice', period: 2, side: 'below' }] }] };
    });
    const r = simulate(input(s, [flat([80, 80, 80])]));
    expect(r.trades[1].kind).toBe('signalSell');
  });
  it('판 날에는 매수 판정을 하지 않고, 마지막 거래일에는 예약을 만들지 않는다', () => {
    const s = quiet((x) => (x.rules.sell.timeExit = { on: true, days: 1 }));
    const r = simulate(input(s, [hold], 11));
    expect(r.trades.map((t) => t.kind)).toEqual(['buy', 'time']);
    const last = simulate(input(s, [hold], 10));
    expect(last.trades.map((t) => t.kind)).toEqual(['buy']);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `TZ=America/New_York corepack pnpm vitest run src/lib/sim/simulate.rules.test.ts`
Expected: FAIL — `time`·`signalSell` 체결이 없어요.

- [ ] **Step 3: 구현** — `src/lib/sim/simulate.ts`

`SymState`에 더해요.

```ts
  /** 어제 종가에 생긴 매도 예약(조건 매도·기간 청산). 오늘 시가에 남은 수량 전부 판다. 봉이 없으면 다음 봉까지 둔다 */
  pendingSell: { kind: 'time' | 'signalSell'; reason: string } | null;
  /** 조건 매도 평가기. 꺼져 있거나 묶음이 없으면 null */
  sellEval: RuleEvaluator | null;
```

`syms` 만들기에서:

```ts
    const sig = s.rules.sell.signal;
    const sellEval = sig.on && sig.groups.length > 0 ? createRuleEvaluator(stock.candles, sig.groups, firstIdx < 0 ? dates.length : firstIdx) : null;
```

워밍업 루프의 `tracker.update(i);` 옆에 `sellEval?.update(i);`를 더하고, 반환 객체에 `pendingSell: null, sellEval`을 더해요.

`record` 아래에 청산 정리 함수를 둬요(장중 청산 코드를 옮김).

```ts
  /** 전량 매도한 종목을 정리한다(왕복 기록·포지션 비움·그날 청산 표시) */
  const closeRound = (st: SymState, di: number, date: string, closed: Set<SymState>) => {
    const rt = st.rt!;
    roundTrips.push({ symbol: st.stock.symbol, open: rt.open, close: date, cost: rt.cost, pnl: roundMoney(rt.proceeds - rt.cost), holdDays: di - rt.openDay + 1 });
    st.pos = null;
    st.rt = null;
    st.pendingSell = null;
    closed.add(st);
  };
```

하루 루프 맨 앞을 바꿔요. `settle`과 `closed`를 위로 올리고 예약 매도를 예약 매수 앞에 둬요.

```ts
  days.forEach((date, di) => {
    const settle = settlementDate(date, days); // 세율은 양도일(결제일) 기준
    const closed = new Set<SymState>();

    // 1-1. 시가: 예약 매도(조건 매도·기간 청산). 매도 대금이 먼저 들어와 예약 매수에 쓴다
    for (const st of syms) {
      const ps = st.pendingSell;
      if (!ps || !st.pos) continue;
      const i = st.byDate.get(date);
      if (i === undefined) continue; // 봉 없는 날은 예약을 두고 다음 봉에서 판다(건너뜀으로 남기지 않는다)
      const { symbol, market, isEtf } = st.stock;
      sellQty(st.pos, st.pos.qty, st.stock.candles[i].o, ps.kind, ps.reason, {
        date,
        symbol,
        wallet,
        feePct,
        taxPct: sellTaxPct(settle, market, isEtf),
        trade: (t) => record(st, t),
      });
      closeRound(st, di, date, closed);
    }

    // 1-2. 시가: 예약 매수
```

(이어지는 예약 매수 블록은 그대로.) 장중 루프 앞의 `const settle = …;`·`const closed = new Set<SymState>();` 두 줄은 지우고, 장중 루프의 `if (st.pos.qty === 0) { … }` 블록을 `if (st.pos.qty === 0) closeRound(st, di, date, closed);`로 바꿔요.

종가 루프를 바꿔요.

```ts
    let held = 0;
    for (const st of syms) {
      const i = st.byDate.get(date);
      // 4-1. 보유 중이면 매도 판정만(보유 중 재진입 없음). 조건 매도가 기간 청산보다 먼저. 기간은 시장 축이라 봉 없는 날도 센다
      if (st.pos && !st.pendingSell && di < days.length - 1) {
        const sig = i !== undefined && st.sellEval ? st.sellEval.signal(i) : null;
        const te = s.rules.sell.timeExit;
        if (sig) st.pendingSell = { kind: 'signalSell', reason: sig.reason };
        else if (te.on && di - st.rt!.openDay + 1 >= te.days) st.pendingSell = { kind: 'time', reason: `보유 ${te.days}일 청산` };
      }
      if (i !== undefined) {
        // 4-2. 보유하지 않고 그날 청산하지 않았으면 매수 판정(그날 청산한 종목은 리셋 전 상태로 신호를 내지 않는다)
        if (!st.pos && !closed.has(st) && di < days.length - 1) {
          const sig = st.tracker.signal(i);
          if (sig) st.pending = sig;
        }
        st.tracker.update(i);
        st.sellEval?.update(i);
        if (closed.has(st)) st.tracker.reset(i);
        if (st.pos) st.pos.markClose(st.stock.candles[i].c); // 트레일 기준가는 종가로(스펙 §4.3)
        st.lastClose = st.stock.candles[i].c;
      }
      if (st.pos) held = roundMoney(held + roundMoney(st.pos.qty * st.lastClose!)); // 봉 없는 날은 마지막 종가
    }
```

(Task 6에서 넣은 `markClose` 줄은 이 블록으로 합쳐요.)

- [ ] **Step 4: 통과 확인**

Run: `TZ=America/New_York corepack pnpm vitest run src/lib/sim && corepack pnpm check`
Expected: PASS(골든 포함). 예약 매도가 없으면 ①-1은 아무것도 하지 않아 v1 전략 결과가 같아요.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/sim/simulate.ts src/lib/sim/simulate.rules.test.ts
git commit -m "feat(simulate): 기간 청산과 조건 매도를 시가 예약 매도로 더함"
```

---

### Task 8: 결과·재생 프레임과 표시

**Files:**
- Modify: `src/lib/sim/types.ts:106-126`(`HoldingFrame`·`DayFrame`)
- Modify: `src/lib/sim/simulate.ts`(`dayFrame`)
- Modify: `src/lib/ui/simulate/simText.ts`(`tradeWhy`, `priceMarks`, 새 문구), `HoldingCard.svelte`, `DayPanel.svelte`, `ResultView.svelte:234`
- Test: `src/lib/sim/simulate.timeline.test.ts`, `src/lib/ui/simulate/simText.test.ts`, `src/lib/ui/simulate/DayPanel.test.ts`

**Interfaces:**
- Produces:
  - `HoldingFrame.trail: number | null`, `HoldingFrame.heldDays: number`
  - `DayFrame.pendingSells: { symbol: string; reason: string }[]`
  - `simText.ts`: `STOP_OFF_NOTE = '손절 꺼짐'`, `pendingSellText(name: string, reason: string): string`, `timeExitText(heldDays: number, days: number): string`, `PriceMark.kind`에 `'trail'`
  - `HoldingCard` props: `{ h: HoldingFrame; name: string; stopOn: boolean; timeExitDays: number | null; motion?: boolean }`
  - `DayPanel` props에 `strategy: Strategy`

- [ ] **Step 1: 실패 테스트 쓰기**

`src/lib/sim/simulate.timeline.test.ts` 끝에:

```ts
describe('timeline 전략 빌더 필드(§9.2)', () => {
  it('trail·heldDays·pendingSells', () => {
    const s = baseStrategy();
    s.rules.sell.takeProfit.on = false;
    s.rules.sell.stopLoss.on = false;
    s.rules.sell.trailing = { on: true, pct: 10 };
    s.rules.sell.timeExit = { on: true, days: 2 };
    const r = run({ strategy: s, days: D.slice(0, 14), stocks: [stockOf(0, candlesFrom(BASE, [[86, 86, 86, 86], [86, 100, 86, 100], [100, 100, 100, 100], [100, 100, 100, 100]]))], index: null, benchmarkStock: null });
    const f9 = r.timeline[9].holdings[0];
    expect(f9.heldDays).toBe(1);
    expect(f9.trail).toBeCloseTo(86 * 0.9);
    const f10 = r.timeline[10];
    expect(f10.holdings[0].trail).toBeCloseTo(90);
    expect(f10.pendingSells).toEqual([{ symbol: 'S0', reason: '보유 2일 청산' }]);
    expect(r.timeline[9].pendingSells).toEqual([]);
  });
});
```

`src/lib/ui/simulate/simText.test.ts` 끝에:

```ts
describe('전략 빌더 문구', () => {
  it('tradeWhy: 조건 매도는 「… 매도」, 트레일·기간 청산은 사유 그대로', () => {
    const t = { date: '2024-01-02', symbol: 'S0', price: 1, qty: 1, fee: 0, tax: 0 };
    expect(tradeWhy({ ...t, kind: 'signalSell', reason: '데드크로스 20/60' })).toBe('데드크로스 20/60 매도');
    expect(tradeWhy({ ...t, kind: 'trail', reason: '트레일링 −10%' })).toBe('트레일링 −10%');
    expect(tradeWhy({ ...t, kind: 'time', reason: '보유 20일 청산' })).toBe('보유 20일 청산');
  });
  it('priceMarks: 트레일 눈금', () => {
    const m = priceMarks({ stop: null, nextAdd: null, avgPrice: 100, takes: [], close: 105, trail: 99 }).marks;
    expect(m.find((x) => x.kind === 'trail')).toMatchObject({ label: '트레일', price: 99 });
  });
  it('예약 매도·기간 청산 문구', () => {
    expect(pendingSellText('삼성전자', '보유 20일 청산')).toBe('다음 거래일 시가에 팔아요: 삼성전자 — 보유 20일 청산');
    expect(timeExitText(3, 20)).toBe('보유 3거래일째 · 17일 뒤 청산');
    expect(timeExitText(20, 20)).toBe('보유 20거래일째 · 다음 거래일 청산');
  });
});
```

`src/lib/ui/simulate/DayPanel.test.ts` 끝에(이 파일의 렌더 도우미·고정 프레임을 써요. 프레임에 `pendingSells`·`trail`·`heldDays`를 더해야 해요):

```ts
describe('전략 빌더 표시', () => {
  it('예약 매도·손절 꺼짐·기간 청산 남은 날', () => {
    const strategy = newStrategy(0, null);
    strategy.rules.sell.stopLoss.on = false;
    strategy.rules.sell.timeExit = { on: true, days: 20 };
    panel({ frame: frame({ holdings: [holding({ stop: null, trail: null, heldDays: 3 })], pendingSells: [{ symbol: '005930', reason: '보유 20일 청산' }] }), strategy });
    expect(screen.getByText('다음 거래일 시가에 팔아요: 삼성전자 — 보유 20일 청산')).toBeTruthy();
    expect(screen.getByText('손절 꺼짐')).toBeTruthy();
    expect(screen.getByText('보유 3거래일째 · 17일 뒤 청산')).toBeTruthy();
  });
});
```

(`frame`·`holding`·`panel`은 이 파일의 고정값 도우미예요. `frame`의 기본값에 `pendingSells: []`를, `holding`의 기본값에 `trail: null, heldDays: 1`을, `panel`이 넘기는 기본 props에 `strategy: newStrategy(0, null)`을 더해요. `names`의 `005930`이 `삼성전자`가 아니면 기대 문구의 이름을 그 값으로 바꿔요. `newStrategy` import를 더해요.)

- [ ] **Step 2: 실패 확인**

Run: `TZ=America/New_York corepack pnpm vitest run src/lib/sim/simulate.timeline.test.ts src/lib/ui/simulate/simText.test.ts src/lib/ui/simulate/DayPanel.test.ts`
Expected: FAIL — 새 필드·문구가 없어요.

- [ ] **Step 3: 구현**

`src/lib/sim/types.ts`의 `HoldingFrame`에 더해요.

```ts
  trail: number | null; // Position.trailPrice(), 다음 거래일 트레일 가격. 꺼지면 null
  heldDays: number; // 시장 축 보유 거래일, 매수일 = 1(기간 청산과 같은 셈)
```

`DayFrame`에 더해요.

```ts
  pendingSells: { symbol: string; reason: string }[]; // 그날 종가 → 다음 거래일 시가 매도 예약(조건 매도·기간 청산)
```

`src/lib/sim/simulate.ts`의 `dayFrame`을 `dayFrame(date, di, cash, value, syms)`로 바꿔요(호출도 `dayFrame(date, di, wallet.cash, value, syms)`).

```ts
function dayFrame(date: string, di: number, cash: number, value: number, syms: SymState[]): DayFrame {
  const holdings: HoldingFrame[] = [];
  const pending: DayFrame['pending'] = [];
  const pendingSells: DayFrame['pendingSells'] = [];
  for (const st of syms) {
    // 예약은 시가에 비우므로 하루 끝에 남은 것은 그날 종가 신호뿐이다(매도 예약은 봉이 없어 미룬 것도 남는다)
    if (st.pending) pending.push({ symbol: st.stock.symbol, reason: st.pending.reason });
    if (st.pendingSell) pendingSells.push({ symbol: st.stock.symbol, reason: st.pendingSell.reason });
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
      trail: pos.trailPrice(),
      nextAdd: pos.nextAddPrice(),
      takes: pos
        .takeLevels()
        .filter((t) => t.qty > 0)
        .map(({ stage, price }) => ({ stage, price })),
      openDate: st.rt.open,
      heldDays: di - st.rt.openDay + 1,
    });
  }
  return { date, cash, value, holdings, pending, pendingSells };
}
```

`src/lib/ui/simulate/simText.ts`:
- `tradeWhy`를 바꿔요.

```ts
export function tradeWhy(t: Trade): string {
  if (t.kind === 'buy') return `${t.reason} 매수`;
  if (t.kind === 'add') return '추가 매수';
  if (t.kind === 'signalSell') return `${t.reason} 매도`;
  return t.reason.replace(/^(\d+단계 익절) (\d+)%$/, '$1($2% 매도)');
}
```

- 문구 상수를 더해요(`STOP_PENDING_NOTE` 아래).

```ts
/** 손절을 끈 전략이라 손절가가 없을 때 */
export const STOP_OFF_NOTE = '손절 꺼짐';
/** 그날 종가 신호(조건 매도·기간 청산) → 다음 거래일 시가 매도 예약 */
export const pendingSellText = (name: string, reason: string): string => `다음 거래일 시가에 팔아요: ${name} — ${reason}`;
/** 기간 청산까지 남은 날. 다 찼으면 다음 거래일에 판다 */
export const timeExitText = (heldDays: number, days: number): string =>
  `보유 ${heldDays}거래일째 · ${days - heldDays > 0 ? `${days - heldDays}일 뒤 청산` : '다음 거래일 청산'}`;
```

- `PriceMark.kind`를 `'stop' | 'trail' | 'add' | 'avg' | 'take'`로, `priceMarks`의 인자 타입에 `'trail'`을 더하고 손절 다음에 트레일 눈금을 넣어요.

```ts
export function priceMarks(h: Pick<HoldingFrame, 'stop' | 'trail' | 'nextAdd' | 'avgPrice' | 'takes' | 'close'>): { marks: PriceMark[]; dot: number } {
  const single = h.takes.length === 1 && h.takes[0].stage === 1;
  const raw: Omit<PriceMark, 'left'>[] = [
    ...(h.stop === null ? [] : [{ key: 'stop', kind: 'stop' as const, label: '손절', price: h.stop }]),
    ...(h.trail === null ? [] : [{ key: 'trail', kind: 'trail' as const, label: '트레일', price: h.trail }]),
    ...(h.nextAdd === null ? [] : [{ key: 'add', kind: 'add' as const, label: '다음 추가', price: h.nextAdd }]),
    { key: 'avg', kind: 'avg' as const, label: '평단', price: h.avgPrice },
    ...h.takes.map((t) => ({ key: `take${t.stage}`, kind: 'take' as const, label: single ? '익절' : `익절 ${t.stage}`, price: t.price })),
  ];
```

(아래 범위 계산은 그대로.)
- `nearMissText`의 「②의 사는 신호」를 「반등 패턴 ②의 사는 신호」로 바꿔요(§4.8).

`src/lib/ui/simulate/HoldingCard.svelte`:
- props를 `let { h, name, stopOn, timeExitDays, motion = false }: { h: HoldingFrame; name: string; stopOn: boolean; timeExitDays: number | null; motion?: boolean } = $props();`로.
- import에 `STOP_OFF_NOTE`·`timeExitText`를 더해요.
- `{#if h.stop === null}<p class="hint">{STOP_PENDING_NOTE}</p>{/if}`를 아래로 바꿔요.

```svelte
  {#if h.stop === null}<p class="hint">{stopOn ? STOP_PENDING_NOTE : STOP_OFF_NOTE}</p>{/if}
  {#if timeExitDays !== null}<p class="hint">{timeExitText(h.heldDays, timeExitDays)}</p>{/if}
```

- `<style>`의 `.tick.stop { … }` 바로 아래에 트레일 눈금 색을 더해요(손절과 같은 하락색 토큰, 점선으로 구분).

```css
  .tick.trail {
    background: transparent;
    border-left: 2px dashed var(--down);
  }
```

`src/lib/ui/simulate/DayPanel.svelte`:
- props에 `strategy: Strategy`를 더해요(`import type { DayFrame, Skip, Strategy, Trade } from '../../sim/types';`, import에 `pendingSellText`).
- `HoldingCard`에 `stopOn={strategy.rules.sell.stopLoss.on} timeExitDays={strategy.rules.sell.timeExit.on ? strategy.rules.sell.timeExit.days : null}`를 넘겨요.
- 예약 매수 목록 바로 **위**에 예약 매도 목록을 둬요(예약 매수 마크업과 같은 모양·클래스).

```svelte
{#if frame.pendingSells.length}
  <ul class="pending" aria-label="다음 거래일 매도 예약">
    {#each frame.pendingSells as p (p.symbol)}<li>{pendingSellText(nameOf(p.symbol), p.reason)}</li>{/each}
  </ul>
{/if}
```

(예약 매수 목록의 실제 클래스 이름이 `pending`이 아니면 그 이름을 써요.)

`src/lib/ui/simulate/ResultView.svelte:234`의 `<DayPanel … />`에 `strategy={meta.strategy}`를 더해요.

테스트 고정 프레임(`src/lib/ui/simulate/*.test.ts`, `resultFixture.ts`)에 `pendingSells: []`, 보유에 `trail: null, heldDays: 1`을 더해요(검색: `grep -rln "openDate:" src/lib/ui`).

- [ ] **Step 4: 통과 확인**

Run: `corepack pnpm test && corepack pnpm check`
Expected: PASS. 골든 불변식(`timeline`을 켜도 나머지가 같음)도 통과해요.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/sim src/lib/ui/simulate
git commit -m "feat(simulate): 재생 프레임에 트레일·보유일·매도 예약을 더하고 그날 상황에 보임"
```

---

### Task 9: 동기화 옮기기 단계·`docVersion`·앱 갱신 안내

**Files:**
- Create: `src/lib/sync/migrate.ts`, `src/lib/sync/migrate.test.ts`
- Modify: `src/lib/sync/api.ts:150-156`, `src/lib/sync/controller.svelte.ts:156-180,720`, `src/lib/sync/engine.ts`(pull의 높은 버전 거르기), `src/lib/ui/settings/SyncPanel.svelte:138-140`
- Test: `src/lib/sync/api.test.ts`, `src/lib/sync/engine.test.ts`

**Interfaces:**
- Consumes: `docHash`(`src/lib/sync/hash.ts`), `profileDocBase`(Task 4), `sanitizeStrategiesV1`·`toV2`, `loadStrategies`, `SyncStore`(`src/lib/sync/store.ts`), `APP_OUTDATED_CODE`, `PROFILE_DOC_VERSION`
- Produces:
  - `export async function migrateStrategies(deps: { storage: SafeStorage; profiles: { id: string; name: string }[]; store: Pick<SyncStore, 'state' | 'putState'> }): Promise<void>`
  - `engine.ts`: `export const APP_OUTDATED_TEXT = '앱을 새로 고쳐 주세요. 새 버전에서 만든 데이터가 있어요.'`(controller가 engine에서 가져와 써요)

- [ ] **Step 1: 실패 테스트 쓰기** — `src/lib/sync/migrate.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { newStrategyV1, toV2 } from '../sim/strategyV1';
import { loadStrategies, saveStrategies } from '../sim/strategyStore';
import { profileKeys } from '../state/profileStore';
import { createSafeStorage } from '../state/storage';
import { memoryBacking, seed } from '../state/testStorage';
import type { SafeStorage } from '../state/storage';
import { APP_OUTDATED_CODE } from './dto';
import { docHash } from './hash';
import { migrateStrategies } from './migrate';
import { buildProfileDoc, profileDocBase } from './profileDoc';
import { createMemorySyncStore } from './store';

const PID = 'p1';
function setup() {
  const backing = memoryBacking();
  seed(backing, `p:${PID}:watchlists`, { groups: [{ id: 'g0', name: '관심', items: [{ symbol: '005930', colorSlot: 1, hidden: false, addedAt: 1 }] }] });
  const v1 = { ...newStrategyV1(0, 'g0', '옛'), id: 's1' };
  seed(backing, `p:${PID}:strategies`, { strategies: [v1] });
  const st = createSafeStorage(backing);
  const store = createMemorySyncStore();
  return { st, v1, store, profiles: [{ id: PID, name: '내 프로필' }] };
}
const h1Of = async (st: SafeStorage, v1: unknown) => docHash({ v: 1, ...profileDocBase(st, PID, '내 프로필'), strategies: [v1] });

describe('migrateStrategies(§8.3)', () => {
  it('syncedHash가 H1이면 H2로 앞당기고 리비전은 그대로', async () => {
    const { st, v1, store, profiles } = setup();
    await store.putState({ profileId: PID, syncedRevision: 7, syncedHash: await h1Of(st, v1) });
    await migrateStrategies({ storage: st, profiles, store });
    const h2 = await docHash(buildProfileDoc(st, PID, '내 프로필'));
    expect(await store.state(PID)).toEqual({ profileId: PID, syncedRevision: 7, syncedHash: h2 });
    expect(st.get(profileKeys.strategySet(PID), null)).toEqual({ strategies: [toV2(v1)] });
  });
  it('syncedHash가 H1이 아니면(이 기기에 확인 안 된 수정) 앞당기지 않는다', async () => {
    const { st, store, profiles } = setup();
    await store.putState({ profileId: PID, syncedRevision: 7, syncedHash: 'other' });
    await migrateStrategies({ storage: st, profiles, store });
    expect((await store.state(PID))!.syncedHash).toBe('other');
  });
  it('멱등: 두 번 돌려도 같다', async () => {
    const { st, v1, store, profiles } = setup();
    await store.putState({ profileId: PID, syncedRevision: 7, syncedHash: await h1Of(st, v1) });
    await migrateStrategies({ storage: st, profiles, store });
    const once = await store.state(PID);
    await migrateStrategies({ storage: st, profiles, store });
    expect(await store.state(PID)).toEqual(once);
  });
  it('옮김 → 새 키 수정 → 재시작: 수정이 「변경 있음」으로 남는다', async () => {
    const { st, v1, store, profiles } = setup();
    await store.putState({ profileId: PID, syncedRevision: 7, syncedHash: await h1Of(st, v1) });
    await migrateStrategies({ storage: st, profiles, store });
    saveStrategies(st, PID, [{ ...loadStrategies(st, PID)[0], name: '고침' }]);
    await migrateStrategies({ storage: st, profiles, store });
    const local = await docHash(buildProfileDoc(st, PID, '내 프로필'));
    expect((await store.state(PID))!.syncedHash).not.toBe(local);
  });
  it('옛 탭이 남긴 「앱을 새로 고쳐 주세요」 거절 기록을 지운다', async () => {
    const { st, store, profiles } = setup();
    await store.putState({ profileId: PID, syncedRevision: 1, syncedHash: 'x', rejectedHash: 'r', rejectedCode: APP_OUTDATED_CODE });
    await migrateStrategies({ storage: st, profiles, store });
    expect(await store.state(PID)).toEqual({ profileId: PID, syncedRevision: 1, syncedHash: 'x' });
  });
  it('옛 키가 없는 프로필은 해시를 건드리지 않는다', async () => {
    const st = createSafeStorage(memoryBacking());
    const store = createMemorySyncStore();
    await store.putState({ profileId: PID, syncedRevision: 1, syncedHash: 'x' });
    await migrateStrategies({ storage: st, profiles: [{ id: PID, name: 'a' }], store });
    expect((await store.state(PID))!.syncedHash).toBe('x');
  });
});
```

`src/lib/sync/api.test.ts` 끝에(이 파일의 가짜 `fetch` 도우미로 요청 URL을 모아요):

```ts
it('프로필 요청에 docVersion=2를 붙인다(§8.3)', async () => {
  const fetchImpl = vi.fn(async () => new Response('{}'));
  const api = createSyncApi('https://sync.example.test', { idToken: async () => 't', sessionId: async () => 's' }, fetchImpl);
  await Promise.allSettled([
    api.getProfile('p1'),
    api.putProfile('p1', { opId: 'o', expectedRevision: 0, doc: {} as never }),
    api.deleteProfile('p1', { opId: 'o', expectedRevision: 1 }),
    api.restoreProfile('p1', 'o'),
    api.getRevision('p1', 3),
  ]);
  const urls = vi.mocked(fetchImpl as typeof fetch).mock.calls.map(([u]) => String(u));
  expect(urls).toHaveLength(5);
  for (const u of urls) expect(new URL(u).searchParams.get('docVersion')).toBe('2');
});
```

- [ ] **Step 2: 실패 확인**

Run: `TZ=America/New_York corepack pnpm vitest run src/lib/sync/migrate.test.ts src/lib/sync/api.test.ts`
Expected: FAIL — `./migrate`가 없고 URL에 `docVersion`이 없어요.

- [ ] **Step 3: 구현** — `src/lib/sync/migrate.ts`

```ts
// 동기화 첫 주기 전 옮기기 단계(전략 빌더 §8.3). 엔진 주기와 겹치지 않게 engine.exclusive() 안에서 부른다.
// 1) 새 키(strategySet)를 채운다. 2) 옮기기만으로 바뀐 해시를 「확인된 상태」로 앞당긴다(가짜 충돌 막기).
// 3) 같은 출처 옛 탭이 남긴 「앱을 새로 고쳐 주세요」 거절 기록을 지운다.
import { sanitizeStrategiesV1, toV2 } from '../sim/strategyV1';
import { loadStrategies } from '../sim/strategyStore';
import { profileKeys } from '../state/profileStore';
import type { SafeStorage } from '../state/storage';
import { APP_OUTDATED_CODE } from './dto';
import { docHash } from './hash';
import { profileDocBase } from './profileDoc';
import type { SyncStore } from './store';

export async function migrateStrategies(deps: {
  storage: SafeStorage;
  profiles: { id: string; name: string }[];
  store: Pick<SyncStore, 'state' | 'putState'>;
}): Promise<void> {
  const { storage, store } = deps;
  for (const p of deps.profiles) {
    loadStrategies(storage, p.id); // 새 키가 없으면 옛 키를 옮겨 쓴다
    const st = await store.state(p.id);
    if (!st) continue;
    let next = st;
    if (st.rejectedCode === APP_OUTDATED_CODE) {
      const { rejectedHash: _h, rejectedCode: _c, ...rest } = st;
      next = rest;
    }
    const raw = storage.get<unknown>(profileKeys.strategies(p.id), null);
    if (raw !== null) {
      // H1·H2 모두 옛 키 내용으로 계산한다. 새 키를 쓰면 옮긴 뒤 고친 내용이 「확인된 상태」로 잘못 쳐진다
      const v1 = sanitizeStrategiesV1(raw).strategies;
      const base = profileDocBase(storage, p.id, p.name);
      const h1 = await docHash({ v: 1, ...base, strategies: v1 });
      if (next.syncedHash === h1) next = { ...next, syncedHash: await docHash({ v: 2, ...base, strategies: v1.map(toV2) }) };
    }
    if (next !== st) await store.putState(next);
  }
}
```

`src/lib/sync/api.ts:150-156`: 프로필 요청 다섯 개에 쿼리를 붙여요.

```ts
import { PROFILE_DOC_VERSION } from './dto';
const dv = `docVersion=${PROFILE_DOC_VERSION}`; // Worker가 이 버전보다 높은 문서를 주지 않는다(§8.3)
```

```ts
    getProfile: (id) => send('GET', `/v1/profiles/${enc(id)}?${dv}`),
    putProfile: (id, body) => send('PUT', `/v1/profiles/${enc(id)}?${dv}`, { body }),
    deleteProfile: (id, body) => send('DELETE', `/v1/profiles/${enc(id)}?${dv}`, { body }),
    restoreProfile: (id, opId) => send('POST', `/v1/profiles/${enc(id)}/restore?${dv}`, { body: { opId } }),
    listRevisions: (id) => send('GET', `/v1/profiles/${enc(id)}/revisions`),
    getRevision: (id, rev) => send('GET', `/v1/profiles/${enc(id)}/revisions/${rev}?${dv}`),
```

`src/lib/sync/controller.svelte.ts`:
- import에 `APP_OUTDATED_CODE`(`./dto`), `migrateStrategies`(`./migrate`), `APP_OUTDATED_TEXT`(`./engine`, 기존 engine import 줄에 합쳐요).
- `describeFail`의 맨 앞 분기로 `f.kind === 'invalid' && f.code === APP_OUTDATED_CODE ? APP_OUTDATED_TEXT : …`를 더해요.
- `:720` `await engine.init();` 바로 뒤에 더해요.

```ts
        // 첫 주기 전에 옮기기 단계를 돈다(가짜 충돌 막기, §8.3). 주기와 겹치지 않게 exclusive 안에서
        await engine.exclusive(() => migrateStrategies({ storage: deps.storage, profiles: app.meta.profiles.map((p) => ({ id: p.id, name: p.name })), store: syncStore }));
```

(`deps.storage`·`app`은 이 블록(`attach(app)`)에서 이미 쓰는 이름이에요. 동기화 저장소는 바깥 변수 `store`(`let store: SyncStore | null`, `:213`)이고, 같은 블록 `:684`에서 `const syncStore = store;`로 null이 아닌 값을 잡아 두니 그것을 넘겨요. `createSyncEngine({ store, … })`에 넘기는 것과 같은 저장소예요.)

`src/lib/sync/engine.ts`의 `pull()`: `const got = await api.getProfile(id);` 아래 `if (!got.ok) {…}` 블록을 바꾸고 그 다음에 버전 검사를 더해요. Worker가 「요청 버전보다 높은 문서」를 422 `APP_OUTDATED_CODE`로 답하면 실패로 치지 않고 안내만 남긴 채 다음 프로필로 가요(다른 프로필 동기화가 멈추지 않게).

```ts
      if (!got.ok) {
        if (got.kind === 'gone' || got.kind === 'not-found') continue;
        if (got.kind === 'invalid' && got.code === APP_OUTDATED_CODE) {
          if (!status.notices.includes(APP_OUTDATED_TEXT)) emit({ notices: [...status.notices, APP_OUTDATED_TEXT] });
          continue;
        }
        return failed(got);
      }
      // 이 앱보다 높은 버전 문서는 쓰지 않는다(Worker가 막지만 한 번 더, §8.3)
      if (typeof got.data.doc.v !== 'number' || got.data.doc.v > PROFILE_DOC_VERSION) {
        if (!status.notices.includes(APP_OUTDATED_TEXT)) emit({ notices: [...status.notices, APP_OUTDATED_TEXT] });
        continue;
      }
```

engine.ts 위쪽(`MAX_BACKOFF` 근처)에 상수를 두고 import를 더해요.

```ts
import { APP_OUTDATED_CODE, PROFILE_DOC_VERSION } from './dto';
/** 이 앱보다 높은 버전 문서를 만났을 때의 안내 */
export const APP_OUTDATED_TEXT = '앱을 새로 고쳐 주세요. 새 버전에서 만든 데이터가 있어요.';
```

`push()`의 `else if (r.kind === 'invalid') {…}` 블록 끝에, 이 앱의 올리기가 `APP_OUTDATED_CODE`로 거절됐으면 같은 안내를 더해요.

```ts
          if (r.code === APP_OUTDATED_CODE && !status.notices.includes(APP_OUTDATED_TEXT)) emit({ notices: [...status.notices, APP_OUTDATED_TEXT] });
```

`src/lib/ui/settings/SyncPanel.svelte:139`: 거절 줄에서 `APP_OUTDATED_CODE`는 보이지 않게 걸러요. 구분 방법: **이 앱**이 받은 「앱을 새로 고쳐 주세요」는 엔진이 `status.notices`에 `APP_OUTDATED_TEXT`로 남겨 패널의 안내 줄(`status.notices` 목록)로 보여요. 거절 기록(`status.rejected`)의 `APP_OUTDATED_CODE` 줄은 같은 출처의 **옛 탭**이 남긴 것일 수 있어(IndexedDB를 같이 써요) 숨겨요. 옛 탭 기록은 옮기기 단계가 시작할 때 지우기도 해요.

```svelte
    {#each status.rejected.filter((r) => r.code !== APP_OUTDATED_CODE) as r (r.profileId)}
```

(import `APP_OUTDATED_CODE` from `'../../sync/dto'`.)

`src/lib/sync/engine.test.ts`에 두 테스트를 더해요(이 파일의 가짜 api·로컬 도우미를 써요).
- 422 경로: 프로필 두 개 중 첫 번째의 `getProfile`이 `{ ok: false, kind: 'invalid', code: APP_OUTDATED_CODE }`를 돌려주게 해요. 동기화 뒤 `status().phase`가 `'error'`가 아니고, 첫 프로필은 `local.write`가 불리지 않고, **두 번째 프로필은 정상으로 받아 쓰이며**, `status().notices`에 `APP_OUTDATED_TEXT`가 있음을 단언해요.
- 높은 버전 방어: `getProfile`이 `{ ok: true, data: { revision: 2, doc: { ...doc, v: 3 } } }`를 돌려줘도 `local.write`가 불리지 않고 같은 안내가 남음을 단언해요.

- [ ] **Step 4: 통과 확인**

Run: `corepack pnpm test && corepack pnpm check`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/sync src/lib/ui/settings/SyncPanel.svelte
git commit -m "feat(sync): 옮기기 단계로 해시를 앞당기고 docVersion=2와 앱 갱신 안내를 더함"
```

---
### Task 10: 요약 문구 (`simText`·`shareText`)

**Files:**
- Modify: `src/lib/ui/simulate/simText.ts:49-102`
- Modify: `src/lib/share/shareText.ts:49-56,90-101`
- Test: `src/lib/ui/simulate/simText.test.ts`, `src/lib/share/shareText.test.ts:80-90`, `src/lib/share/pendingImport.test.ts`

**Interfaces:**
- Produces(`simText.ts`):
  - `patternSummary(e: PatternEntry): string`(지금 `entrySummary` 본문)
  - `buyRulesSummary(s: Strategy): string`
  - `sellRulesSummary(s: Strategy): string`
  - `sizingText(s: Strategy): string`
  - `cutText(text: string, max?: number): string`(기본 40)

- [ ] **Step 1: 실패 테스트 쓰기** — `src/lib/ui/simulate/simText.test.ts` 끝에

```ts
describe('전략 요약(§10.6)', () => {
  const base = () => newStrategy(0, null);
  it('매수: 패턴 블록만 있으면 지금 문구, 묶음은 「또는」, 조건은 「+」', () => {
    const s = base();
    expect(buyRulesSummary(s)).toBe('고점 대비 10% 하락 뒤 → 3일 연속 상승 또는 B 돌파');
    s.rules.buy = [
      { conds: [{ kind: 'rsi', period: 14, level: 30, op: 'crossUp' }, { kind: 'maPrice', period: 120, side: 'above' }] },
      { conds: [{ kind: 'newHigh', days: 60 }] },
    ];
    expect(buyRulesSummary(s)).toBe('RSI14 30 상향 돌파 + 종가 120일선 위 또는 60일 신고가');
    s.rules.buy = [];
    expect(buyRulesSummary(s)).toBe('사는 조건 없음');
  });
  it('매도: 켜진 것만, 모두 꺼지면 「파는 규칙 없음」', () => {
    const s = base();
    expect(sellRulesSummary(s)).toBe('익절 +15%에 전량 · 손절 −5%');
    s.rules.sell.trailing = { on: true, pct: 10 };
    s.rules.sell.timeExit = { on: true, days: 20 };
    s.rules.sell.signal = { on: true, groups: [{ conds: [{ kind: 'maCross', short: 20, long: 60, dir: 'dead' }] }] };
    expect(sellRulesSummary(s)).toBe('익절 +15%에 전량 · 손절 −5% · 트레일링 −10% · 20일 청산 · 조건 매도 1묶음');
    s.rules.sell = { ...s.rules.sell, takeProfit: { ...s.rules.sell.takeProfit, on: false }, stopLoss: { ...s.rules.sell.stopLoss, on: false }, trailing: { on: false, pct: 10 }, timeExit: { on: false, days: 20 }, signal: { on: false, groups: [] } };
    expect(sellRulesSummary(s)).toBe('파는 규칙 없음');
  });
  it('배분 문구', () => {
    const s = base();
    expect(sizingText(s)).toBe('회당 처음 자금 10%');
    s.sizing = { mode: 'equityPct', pct: 5 };
    expect(sizingText(s)).toBe('회당 총자산 5%');
    s.sizing = { mode: 'cashPct', pct: 20 };
    expect(sizingText(s)).toBe('회당 남은 현금 20%');
    s.sizing = { mode: 'equal', pct: 10 };
    expect(sizingText(s)).toBe('종목마다 같은 금액');
  });
  it('cutText: 40자를 넘으면 39자 + …', () => {
    expect(cutText('가'.repeat(41))).toBe(`${'가'.repeat(39)}…`);
    expect(cutText('가'.repeat(40))).toBe('가'.repeat(40));
  });
});
```

`src/lib/share/shareText.test.ts:86`의 정규식 단언을 바꿔요.

```ts
    expect(b).toBe('고점 대비 10% 하락 뒤 → 3일 연속 상승 또는 B 돌파');
```

(`:83`의 전략 `s`가 기본 전략이 아니면 그 전략의 `buyRulesSummary(s)`를 40자로 자른 값을 기대값으로 써요.)

`src/lib/share/pendingImport.test.ts` 끝에:

```ts
it('importPart: 시뮬레이션 결과는 v2 전략 스냅샷으로 바꾼다(§8.4)', () => {
  const s = simResultFixture();
  const p = importPart(s);
  expect(p).toMatchObject({ kind: 'strategy', v: 2, title: s.title, capitalHidden: s.capitalHidden });
});
```

(import `simResultFixture` from `'./testFixtures'`.)

- [ ] **Step 2: 실패 확인**

Run: `TZ=America/New_York corepack pnpm vitest run src/lib/ui/simulate/simText.test.ts src/lib/share/shareText.test.ts src/lib/share/pendingImport.test.ts`
Expected: FAIL — 새 함수가 없어요.

- [ ] **Step 3: 구현** — `src/lib/ui/simulate/simText.ts`

`entrySummary`를 `patternSummary(e: PatternEntry)`로 이름을 바꾸고 첫 줄을 `const { decline, triggers: t, filter } = e;`로(Task 4의 `patternEntryOf` 분기는 지워요). `exitSummary`는 지우고 아래 함수들을 더해요.

```ts
/** 40자(공유 사유·카드 줄 상한)를 넘으면 39자 + … */
export const cutText = (text: string, max = 40): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** 매수 조건 한 줄: 묶음은 「또는」, 조건은 「+」. 패턴 블록 하나뿐이면 지금 패턴 문구 */
export function buyRulesSummary(s: Strategy): string {
  const g = s.rules.buy;
  if (g.length === 0) return '사는 조건 없음';
  if (g.length === 1 && g[0].conds.length === 1 && g[0].conds[0].kind === 'pattern') return patternSummary(g[0].conds[0].entry);
  return g.map((x) => x.conds.map(condReason).join(' + ') || '빈 묶음').join(' 또는 ');
}

/** 매도 한 줄: 켜진 것만 「·」로 */
export function sellRulesSummary(s: Strategy): string {
  const { takeProfit, stopLoss, trailing, timeExit, signal } = s.rules.sell;
  const parts: string[] = [];
  if (takeProfit.on) {
    const n = takeProfit.stages.length;
    // 마지막 단계는 남은 것 전부: 단계가 하나면 전량, 여럿이면 나머지
    const amount = (sellPct: number, i: number) => (i === n - 1 ? (n === 1 ? '전량' : '나머지') : `${sellPct}%`);
    parts.push('익절 ' + takeProfit.stages.map((t, i) => `+${t.pct}%에 ${amount(t.sellPct, i)}`).join(' → '));
  }
  // 분할 매수를 끄면 세 기준이 같으므로 기준을 뺀다
  if (stopLoss.on) parts.push(`손절 ${MINUS}${stopLoss.pct}%${s.scaleIn.on ? ` ${STOP_BASIS_LABEL[stopLoss.basis]}` : ''}`);
  if (takeProfit.on && takeProfit.afterFirstTake === 'breakeven') parts.push('1단계 뒤 본전 손절');
  if (trailing.on) parts.push(`트레일링 ${MINUS}${trailing.pct}%`);
  if (timeExit.on) parts.push(`${timeExit.days}일 청산`);
  if (signal.on) parts.push(`조건 매도 ${signal.groups.length}묶음`);
  return parts.length ? parts.join(' · ') : '파는 규칙 없음';
}

/** 자금 배분 문구(§10.6) */
export function sizingText(s: Strategy): string {
  const { mode, pct } = s.sizing;
  if (mode === 'equal') return '종목마다 같은 금액';
  return `회당 ${mode === 'fixed' ? '처음 자금' : mode === 'equityPct' ? '총자산' : '남은 현금'} ${pct}%`;
}
```

`sectionSummary`를 바꿔요.

```ts
    case 'capital':
      return `${money(s.capital.initial)} · ${sizingText(s)}`;
    case 'entry':
      return buyRulesSummary(s);
```

```ts
    case 'exit':
      return sellRulesSummary(s);
```

import에 `condReason`(`'../../sim/rules'`), `type PatternEntry`를 더하고, 이제 안 쓰는 `patternEntryOf` import는 `nearMissText`가 쓰니 남겨요.

`src/lib/share/shareText.ts`:
- `:49-56`(`case 'strategy'` 카드 줄):

```ts
    case 'strategy': {
      const st = s.strategy;
      const n = st.universe.kind === 'symbols' ? st.universe.symbols.length : 0;
      return [`종목 ${n}개 · ${dotDate(st.period.from)} ~ ${dotDate(st.period.to)}`, cutText(buyRulesSummary(st))];
    }
```

- `:90-101`(`snapshotLines`의 `case 'strategy'`):

```ts
        `초기 자금: ${s.capitalHidden ? '비공개' : won(st.capital.initial)} · ${sizingText(st)}`,
        `매수: ${cutText(buyRulesSummary(st))} · 분할 매수 ${on(st.scaleIn.on)}`,
        `매도: ${cutText(sellRulesSummary(st))}`,
```

(import: `buyRulesSummary`·`cutText`·`sellRulesSummary`·`sizingText` from `'../ui/simulate/simText'`, 기존 simText import 줄에 합쳐요. Task 4의 임시 `patternEntryOf` 사용은 지워요.)

- [ ] **Step 4: 통과 확인**

Run: `corepack pnpm test && corepack pnpm check`
Expected: PASS. 기존 `sectionSummary` 테스트가 기본 전략 문구(`익절 +15%에 전량 · 손절 −5%` 등)를 그대로 기대하면 그대로 통과해요. `회당 10%`를 기대하던 단언은 `회당 처음 자금 10%`로 고쳐요.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/ui/simulate/simText.ts src/lib/ui/simulate/simText.test.ts src/lib/share
git commit -m "feat(simulate): 매수 조건·매도·배분 요약 문구를 새 형식으로 바꿈"
```

---

### Task 11: 선정 기준 연동

**Files:**
- Modify: `src/lib/screen/validate.ts:292-314`(`borrowed`·`strategyRuleIssues`)
- Modify: `src/lib/screen/runValidation.ts:53-62,326-336,401-406`
- Modify: `src/lib/ui/screen/CriteriaEditor.svelte:318-337,476-498`
- Test: `src/lib/screen/validate.test.ts`, `src/lib/screen/runValidation.test.ts`, `src/lib/screen/precompute.test.ts`, `src/lib/ui/screen/CriteriaEditor.test.ts`

**Interfaces:**
- Consumes: `MissingPatternError`(Task 4), `patternEntryOf`
- Produces: `ValidationErrorCode`에 `'missing-pattern'`, `ERROR_TEXT['missing-pattern'] = '반등 패턴에 고른 전략에 반등 패턴이 없어요'`

- [ ] **Step 1: 실패 테스트 쓰기**

`src/lib/screen/validate.test.ts` 끝에(이 파일의 `newCriteria`·`newStrategy` 도우미를 써요):

```ts
describe('반등 패턴 전략(§7)', () => {
  const crit = (strategyId: string) => {
    const c = newCriteria(0, null);
    c.conditions.rebound = { on: true, withinDays: 10, pattern: { from: 'strategy', strategyId } };
    return c;
  };
  it('패턴 블록이 없는 전략을 고르면 막는 경고', () => {
    const s = { ...newStrategy(0, null), id: 's1' };
    s.rules.buy = [{ conds: [{ kind: 'newHigh', days: 20 }] }];
    expect(strategyRuleIssues(crit('s1'), [s])).toEqual([
      { section: 'conditions', text: '고른 전략에 반등 패턴이 없어요. 반등 패턴이 있는 전략을 고르거나 직접 정해 주세요', blocking: true },
    ]);
  });
  it('패턴 블록의 막는 경고만 빌려 온다(매도 경고는 아님)', () => {
    const s = { ...newStrategy(0, null), id: 's1' };
    const e = s.rules.buy[0].conds[0];
    if (e.kind === 'pattern') e.entry.triggers = { ...e.entry.triggers, reboundDays: { on: false, value: 3 }, breakout: { on: false, level: 'B' } };
    s.rules.sell.takeProfit.stages = [{ pct: 10, sellPct: 50 }, { pct: 5, sellPct: 100 }];
    const out = strategyRuleIssues(crit('s1'), [s]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('반등 패턴 전략에 고칠 곳이 있어요: 사는 신호가 하나도 켜져 있지 않아요. 전략 편집에서 하나 이상 켜 주세요');
  });
});
```

`src/lib/screen/runValidation.test.ts` 끝에:

```ts
it('errorCode: 패턴 블록 없음은 missing-pattern', () => {
  expect(errorCode(new MissingPatternError())).toBe('missing-pattern');
  expect(ERROR_TEXT['missing-pattern']).toBe('반등 패턴에 고른 전략에 반등 패턴이 없어요');
});
```

(import `errorCode`·`ERROR_TEXT` from `./runValidation`, `MissingPatternError` from `./precompute`.) `runTrading`의 `equal` 바꾸기는 이 파일의 매매 규칙(②) 실행 테스트 도우미로 확인해요: 참조 전략 `sizing = { mode: 'equal', pct: 10 }`, 기준 `rank.take = 4`로 돌린 결과가 같은 전략을 `{ mode: 'equityPct', pct: 25 }`로 돌린 결과와 같음을 단언해요.

`src/lib/screen/precompute.test.ts` 끝에:

```ts
it('resolveReboundEntry: 전략의 패턴 블록, 없으면 MissingPatternError', () => {
  const c = newCriteria(0, null);
  c.conditions.rebound = { on: true, withinDays: 10, pattern: { from: 'strategy', strategyId: 's1' } };
  const s = { ...newStrategy(0, null), id: 's1' };
  expect(resolveReboundEntry(c, [s])).toEqual(defaultPatternEntry());
  s.rules.buy = [{ conds: [{ kind: 'newHigh', days: 20 }] }];
  expect(() => resolveReboundEntry(c, [s])).toThrow(MissingPatternError);
  expect(() => resolveReboundEntry(c, [])).toThrow(MissingStrategyError);
});
```

- [ ] **Step 2: 실패 확인**

Run: `TZ=America/New_York corepack pnpm vitest run src/lib/screen`
Expected: FAIL — 새 경고 문구·`missing-pattern`이 없어요.

- [ ] **Step 3: 구현**

`src/lib/screen/validate.ts`:

```ts
// 전략 편집 화면의 구역 번호(②)는 이 화면의 ②와 헷갈리므로 '전략 편집'으로 바꾼다(반등 패턴 ②도)
const borrowed = (text: string): string => text.replace(/(반등 패턴 )?[①-⑨]에서/g, '전략 편집에서');
```

```ts
/**
 * 참조 전략에서 전략 편집 화면이 실행을 막는 매수·매도 규칙 오류(스펙 5장, 전략 빌더 §7).
 * 반등 패턴은 그 전략의 패턴 블록만 본다(블록이 없으면 막는다). 지워진 전략은 criteriaIssues가 알린다.
 */
export function strategyRuleIssues(c: SelectionCriteria, strategies: Strategy[]): Issue[] {
  const out: Issue[] = [];
  const p = c.conditions.rebound;
  if (p.on && p.pattern.from === 'strategy') {
    const id = p.pattern.strategyId;
    const s = strategies.find((x) => x.id === id);
    if (s && !patternEntryOf(s))
      out.push({ section: 'conditions', text: '고른 전략에 반등 패턴이 없어요. 반등 패턴이 있는 전략을 고르거나 직접 정해 주세요', blocking: true });
    else if (s)
      for (const i of ruleIssues(s).filter((x) => x.blocking && x.pattern))
        out.push({ section: 'conditions', text: `반등 패턴 전략에 고칠 곳이 있어요: ${borrowed(i.text)}`, blocking: true });
  }
  if (c.trading.strategyId !== null) {
    const s = strategies.find((x) => x.id === c.trading.strategyId);
    if (s)
      for (const i of ruleIssues(s).filter((x) => x.blocking && RULE_SECTIONS.includes(x.section)))
        out.push({ section: 'trading', text: `매매 규칙 전략에 고칠 곳이 있어요: ${borrowed(i.text)}`, blocking: true });
  }
  return out;
}
```

(지역 도우미 `blocking`은 지워요. import `patternEntryOf` from `'../sim/patternBlock'`.)

`src/lib/screen/runValidation.ts`:
- `ValidationErrorCode`에 `| 'missing-pattern'`, `ERROR_TEXT`에 `'missing-pattern': '반등 패턴에 고른 전략에 반등 패턴이 없어요',`
- `errorCode`에 `if (e instanceof MissingPatternError) return 'missing-pattern';`(import 더하기)
- `runTrading`의 `strategy` 만들기에 배분을 더해요.

```ts
  // 균등 배분은 재선정마다 종목이 바뀌어 누적 종목 수로 나누면 금액이 너무 작아진다. 보유 곡선(holdSelection)과 맞춰 한 번에 뽑는 수로 나눈다(§7)
  const sizing = ref.sizing.mode === 'equal' ? { mode: 'equityPct' as const, pct: 100 / criteria.rank.take } : { ...ref.sizing };
  const strategy: Strategy = {
    ...ref,
    period: { ...criteria.period },
    capital: { initial: criteria.capital },
    sizing,
    costs: { feePct: criteria.costs.feePct },
    benchmarks: { index: firstIndex ?? 'KOSPI', symbol: null },
  };
```

(주석 `// ②: 참조 전략에서 매수·매도 규칙과 1회 매수 비율만 쓰고 …`는 `// ②: 참조 전략에서 매수·매도 규칙과 배분만 쓰고 …`로.)

`src/lib/ui/screen/CriteriaEditor.svelte`:
- `const strategyIds = $derived(app.strategies.map((s) => s.id));` 아래에 `const withPattern = $derived(app.strategies.filter((s) => patternEntryOf(s) !== null));`
- `setPatternFrom('strategy')`의 `const first = app.strategies[0];`을 `const first = withPattern[0];`로.
- 「전략에서 불러오기」 선택지의 `disabled: app.strategies.length === 0 && pattern.from !== 'strategy'`를 `disabled: withPattern.length === 0 && pattern.from !== 'strategy'`로.
- 전략 `<option>`을 바꿔요.

```svelte
              {#each app.strategies as s (s.id)}
                {@const ok = patternEntryOf(s) !== null}
                <option value={s.id} disabled={!ok} selected={known && s.id === pattern.strategyId}>{s.name}{ok ? '' : ' (반등 패턴 없음)'}</option>
              {/each}
```

`src/lib/ui/screen/CriteriaEditor.test.ts`에 패턴 블록이 없는 전략이 `disabled`이고 이름 뒤에 ` (반등 패턴 없음)`이 붙는지 단언을 더해요(이 파일의 기준 편집기 렌더 도우미로 전략 두 개 — 하나는 `rules.buy = [{ conds: [{ kind: 'newHigh', days: 20 }] }]` — 를 넣고 「전략에서 불러오기」를 골라 `getByRole('option', { name: /반등 패턴 없음/ })`의 `disabled`를 봐요).

- [ ] **Step 4: 통과 확인**

Run: `corepack pnpm test && corepack pnpm check`
Expected: PASS. 미리 계산 캐시 키(`workerHandler.ts`의 `stableJson(precomputeParams(…))`)는 해석된 entry로 만들어져 형식이 같아요.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/screen src/lib/ui/screen
git commit -m "feat(screen): 선정 기준이 전략의 반등 패턴 블록을 쓰고 균등 배분을 바꿔 돌림"
```

---

### Task 12: 경고 (`ruleIssues` 새 줄·균등 배분·`patternRefIssues`)

**Files:**
- Modify: `src/lib/sim/validate.ts`(`ruleIssues`·`strategyIssues`)
- Modify: `src/lib/screen/validate.ts`(새 `patternRefIssues`)
- Modify: `src/lib/ui/simulate/StrategyEditor.svelte:122`
- Test: `src/lib/sim/validate.test.ts`, `src/lib/screen/validate.test.ts`

**Interfaces:**
- Produces: `export function patternRefIssues(s: Strategy, criteria: SelectionCriteria[]): SimIssue[]`(`src/lib/screen/validate.ts`, `SimIssue` = `src/lib/sim/validate.ts`의 `Issue`)

- [ ] **Step 1: 실패 테스트 쓰기** — `src/lib/sim/validate.test.ts` 끝에

```ts
describe('전략 빌더 경고(§11)', () => {
  const base = () => newStrategy(0, null);
  const texts = (s: ReturnType<typeof base>) => ruleIssues(s).map((i) => [i.section, i.blocking, i.text]);
  it('매수 묶음 없음·빈 묶음·패턴 2개', () => {
    const a = base();
    a.rules.buy = [];
    expect(texts(a)).toContainEqual(['entry', true, '사는 조건이 없어요. 조건을 하나 이상 넣어 주세요']);
    const b = base();
    b.rules.buy.push({ conds: [] });
    expect(texts(b)).toContainEqual(['entry', true, '빈 묶음이 있어요. 조건을 넣거나 묶음을 지워 주세요']);
    const c = base();
    c.rules.buy.push(structuredClone(c.rules.buy[0]));
    expect(texts(c)).toContainEqual(['entry', true, '반등 패턴은 하나만 넣을 수 있어요']);
  });
  it('이평 교차 짧은 ≥ 긴은 막지 않는 경고(매수·매도 각 구역)', () => {
    const s = base();
    s.rules.buy = [{ conds: [{ kind: 'maCross', short: 60, long: 20, dir: 'golden' }] }];
    s.rules.sell.signal = { on: true, groups: [{ conds: [{ kind: 'maCross', short: 20, long: 20, dir: 'dead' }] }] };
    expect(texts(s)).toContainEqual(['entry', false, '짧은 이동평균 기간이 긴 이동평균보다 짧아야 해요']);
    expect(texts(s)).toContainEqual(['exit', false, '짧은 이동평균 기간이 긴 이동평균보다 짧아야 해요']);
  });
  it('조건 매도 켰는데 묶음 없음·빈 묶음', () => {
    const s = base();
    s.rules.sell.signal = { on: true, groups: [] };
    expect(texts(s)).toContainEqual(['exit', true, '조건 매도에 조건을 넣거나 꺼 주세요']);
    s.rules.sell.signal.groups = [{ conds: [] }];
    expect(texts(s)).toContainEqual(['exit', true, '빈 묶음이 있어요. 조건을 넣거나 묶음을 지워 주세요']);
  });
  it('트레일링 ≤ 추가 간격, 파는 규칙 없음', () => {
    const s = base();
    s.scaleIn = { on: true, stepPct: 10, maxAdds: 2 };
    s.rules.sell.trailing = { on: true, pct: 8 };
    expect(texts(s)).toContainEqual(['exit', false, '추가 매수보다 트레일링이 먼저 일어나요. 추가 매수 간격을 트레일링 폭보다 작게 해 주세요']);
    const n = base();
    n.rules.sell.takeProfit.on = false;
    n.rules.sell.stopLoss.on = false;
    expect(texts(n)).toContainEqual(['exit', false, '파는 규칙이 없어요. 기간 끝까지 들고 있어요']);
  });
  it('균등 배분 + 분할 매수는 자금 경고', () => {
    const s = { ...base(), universe: { kind: 'symbols' as const, symbols: ['005930'] } };
    s.sizing = { mode: 'equal', pct: 10 };
    s.scaleIn = { on: true, stepPct: 3, maxAdds: 2 };
    expect(strategyIssues(s, { groups: [] } as never).map((i) => i.text)).toContain('균등 배분은 첫 매수에 몫을 다 써요. 추가 매수는 현금이 모자라 건너뛸 수 있어요');
  });
});
```

`src/lib/screen/validate.test.ts` 끝에:

```ts
it('patternRefIssues: 반등 패턴으로 참조되는데 패턴 블록이 없으면 막지 않는 경고', () => {
  const s = { ...newStrategy(0, null), id: 's1' };
  const c = newCriteria(0, null);
  c.conditions.rebound = { on: true, withinDays: 10, pattern: { from: 'strategy', strategyId: 's1' } };
  expect(patternRefIssues(s, [c])).toEqual([]);
  s.rules.buy = [{ conds: [{ kind: 'newHigh', days: 20 }] }];
  expect(patternRefIssues(s, [c, c])).toEqual([
    { section: 'entry', text: '이 전략을 반등 패턴으로 쓰는 선정 기준이 2개 있어요. 반등 패턴 블록을 넣어야 그 기준을 실행할 수 있어요', blocking: false },
  ]);
});
```

- [ ] **Step 2: 실패 확인**

Run: `TZ=America/New_York corepack pnpm vitest run src/lib/sim/validate.test.ts src/lib/screen/validate.test.ts`
Expected: FAIL — 새 경고가 없어요.

- [ ] **Step 3: 구현**

`src/lib/sim/validate.ts`의 `ruleIssues`에서 `const p = patternEntryOf(s);` **앞에** 매수 묶음 검사를, `takeProfit.on` 블록 **뒤에** 매도 검사를 더해요.

```ts
  const EMPTY_GROUP = '빈 묶음이 있어요. 조건을 넣거나 묶음을 지워 주세요';
  const MA_ORDER = '짧은 이동평균 기간이 긴 이동평균보다 짧아야 해요';
  const badCross = (groups: CondGroup[]) => groups.some((g) => g.conds.some((c) => c.kind === 'maCross' && c.short >= c.long));
  const buy = s.rules.buy;
  if (buy.length === 0) out.push({ section: 'entry', text: '사는 조건이 없어요. 조건을 하나 이상 넣어 주세요', blocking: true });
  if (buy.some((g) => g.conds.length === 0)) out.push({ section: 'entry', text: EMPTY_GROUP, blocking: true });
  if (patternCount(s) > 1) out.push({ section: 'entry', text: '반등 패턴은 하나만 넣을 수 있어요', blocking: true });
  if (badCross(buy)) out.push({ section: 'entry', text: MA_ORDER, blocking: false });
```

```ts
  const { trailing, timeExit, signal } = s.rules.sell;
  if (signal.on && signal.groups.length === 0) out.push({ section: 'exit', text: '조건 매도에 조건을 넣거나 꺼 주세요', blocking: true });
  if (signal.on && signal.groups.some((g) => g.conds.length === 0)) out.push({ section: 'exit', text: EMPTY_GROUP, blocking: true });
  if (signal.on && badCross(signal.groups)) out.push({ section: 'exit', text: MA_ORDER, blocking: false });
  if (trailing.on && s.scaleIn.on && s.scaleIn.stepPct >= trailing.pct)
    out.push({ section: 'exit', text: '추가 매수보다 트레일링이 먼저 일어나요. 추가 매수 간격을 트레일링 폭보다 작게 해 주세요', blocking: false });
  if (!takeProfit.on && !stopLoss.on && !trailing.on && !timeExit.on && !signal.on)
    out.push({ section: 'exit', text: '파는 규칙이 없어요. 기간 끝까지 들고 있어요', blocking: false });
```

(import `patternCount` from `'./patternBlock'`, `type CondGroup` from `'./types'`.)

`strategyIssues`의 자금 경고 아래에 더해요.

```ts
  if (s.sizing.mode === 'equal' && s.scaleIn.on)
    out.push({ section: 'capital', text: '균등 배분은 첫 매수에 몫을 다 써요. 추가 매수는 현금이 모자라 건너뛸 수 있어요', blocking: false });
```

`src/lib/screen/validate.ts` 끝에 더해요.

```ts
/**
 * 전략 편집 화면의 막지 않는 경고(§7): 이 전략을 반등 패턴으로 쓰는 선정 기준이 있는데 패턴 블록이 없다.
 * ruleIssues는 전략만 받아 기준 목록을 모르므로 편집 화면이 따로 불러 같은 구역 경고에 붙인다.
 */
export function patternRefIssues(s: Strategy, criteria: SelectionCriteria[]): SimIssue[] {
  if (patternEntryOf(s)) return [];
  const n = criteria.filter((c) => c.conditions.rebound.on && c.conditions.rebound.pattern.from === 'strategy' && c.conditions.rebound.pattern.strategyId === s.id).length;
  return n === 0 ? [] : [{ section: 'entry', text: `이 전략을 반등 패턴으로 쓰는 선정 기준이 ${n}개 있어요. 반등 패턴 블록을 넣어야 그 기준을 실행할 수 있어요`, blocking: false }];
}
```

(import `type Issue as SimIssue` from `'../sim/validate'`.)

`src/lib/ui/simulate/StrategyEditor.svelte:122`:

```ts
  const issues = $derived([...strategyIssues(draft, app.watchlists), ...patternRefIssues(draft, app.criteria)]);
```

(import `patternRefIssues` from `'../../screen/validate'`.)

- [ ] **Step 4: 통과 확인**

Run: `corepack pnpm test && corepack pnpm check`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/sim/validate.ts src/lib/sim/validate.test.ts src/lib/screen/validate.ts src/lib/screen/validate.test.ts src/lib/ui/simulate/StrategyEditor.svelte
git commit -m "feat(simulate): 조건 묶음·매도 규칙·균등 배분 경고와 반등 패턴 참조 경고를 더함"
```

---

### Task 13: 편집 화면 — 매수 조건 묶음

**Files:**
- Create: `src/lib/ui/simulate/editor/condKinds.ts`
- Create: `src/lib/ui/simulate/editor/CondRow.svelte`, `CondGroupCard.svelte`, `CondGroupsEditor.svelte`, `BuyRulesSection.svelte`
- Modify: `src/lib/ui/simulate/StrategyEditor.svelte:45-52,232`(Task 4의 임시 `PatternFields` 블록을 바꿈)
- Test: `src/lib/ui/simulate/StrategyEditor.test.ts`

**Interfaces:**
- Consumes: `defaultCond`·`MAX_GROUPS`·`MAX_CONDS`(`src/lib/sim/strategyV2.ts`), `NumberField`, `PatternFields`
- Produces:
  - `condKinds.ts`: `export const COND_KINDS: readonly { kind: Cond['kind']; label: string }[]`
  - `CondGroupsEditor` props: `{ groups: CondGroup[]; prefix: string; allowPattern: boolean; update: (fn: (groups: CondGroup[]) => void) => void }`
  - `BuyRulesSection` props: `{ s: Strategy; update: (fn: (s: Strategy) => void) => void }`

- [ ] **Step 1: 실패 테스트 쓰기** — `src/lib/ui/simulate/StrategyEditor.test.ts`

`:20`의 `TITLES`에서 `'매수'`를 `'매수 조건'`으로 바꿔요. 파일 끝에 붙여요.

```ts
describe('매수 조건 묶음(§10.2)', () => {
  it('조건 더하기·종류 바꾸기·지우기, 묶음 더하기가 저장된다', async () => {
    const { app } = setup();
    await openSection('매수 조건');
    await fireEvent.click(screen.getByRole('button', { name: '＋ 조건' }));
    await tick();
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: '매수 묶음 1의 조건 2 종류' }));
    await fireEvent.change(screen.getByRole('combobox', { name: '매수 묶음 1의 조건 2 종류' }), { target: { value: 'rsi' } });
    await fireEvent.click(screen.getByRole('button', { name: '＋ 또는 묶음' }));
    await settle();
    expect(saved(app).rules.buy).toHaveLength(2);
    expect(saved(app).rules.buy[0].conds[1]).toEqual({ kind: 'rsi', period: 14, level: 30, op: 'crossUp' });
    await fireEvent.click(screen.getByRole('button', { name: '매수 묶음 1의 조건 2 지우기' }));
    await settle();
    expect(saved(app).rules.buy[0].conds).toHaveLength(1);
  });
  it('반등 패턴은 하나만: 다른 줄의 선택지에서 막힌다', async () => {
    setup();
    await openSection('매수 조건');
    await fireEvent.click(screen.getByRole('button', { name: '＋ 조건' }));
    await tick();
    const opt = screen.getByRole('combobox', { name: '매수 묶음 1의 조건 2 종류' }).querySelector('option[value="pattern"]') as HTMLOptionElement;
    expect(opt.disabled).toBe(true);
  });
  it('한도에서는 버튼을 막고 이유를 보인다', async () => {
    setup((s) => (s.rules.buy = Array.from({ length: 4 }, () => ({ conds: [{ kind: 'newHigh', days: 20 }] }))));
    await openSection('매수 조건');
    expect((screen.getByRole('button', { name: '＋ 또는 묶음' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('묶음은 4개까지예요')).toBeTruthy();
  });
  it('묶음 카드는 이름 있는 group이고 axe 위반이 없다', async () => {
    const { view } = setup();
    await openSection('매수 조건');
    expect(screen.getByRole('group', { name: '매수 묶음 1' })).toBeTruthy();
    await expectNoAxeViolations(view.container);
  });
});
```

(import `expectNoAxeViolations` from `'../../share/testAxe'`.)

- [ ] **Step 2: 실패 확인**

Run: `TZ=America/New_York corepack pnpm vitest run src/lib/ui/simulate/StrategyEditor.test.ts`
Expected: FAIL — 「매수 조건」 구역·「＋ 조건」 버튼이 없어요.

- [ ] **Step 3: 구현**

`src/lib/ui/simulate/editor/condKinds.ts`:

```ts
// 조건 줄의 종류 선택지(스펙 §10.2). 순서가 곧 선택지 순서다.
import type { Cond } from '../../../sim/types';

export const COND_KINDS: readonly { kind: Cond['kind']; label: string }[] = [
  { kind: 'maPrice', label: '이동평균 위·아래' },
  { kind: 'maCross', label: '이평 교차' },
  { kind: 'rsi', label: 'RSI' },
  { kind: 'volume', label: '거래량' },
  { kind: 'change', label: 'N일 등락률' },
  { kind: 'fromHigh', label: '고점 대비 하락' },
  { kind: 'newHigh', label: '신고가 돌파' },
  { kind: 'pattern', label: '반등 패턴' },
];
```

`src/lib/ui/simulate/editor/CondRow.svelte`:

```svelte
<script lang="ts">
  // 조건 한 줄(스펙 §10.2): 종류 선택 → 종류별 숫자 칸 → 지우기. 반등 패턴이면 아래에 PatternFields를 펼친다.
  // 종류를 바꾸면 그 종류의 기본값으로 바꾼다(앞 종류 값은 기억하지 않는다).
  import { defaultCond } from '../../../sim/strategyV2';
  import type { Cond } from '../../../sim/types';
  import { COND_KINDS } from './condKinds';
  import NumberField from './NumberField.svelte';
  import PatternFields from './PatternFields.svelte';

  let {
    cond,
    label,
    allowPattern,
    patternTaken,
    update,
    onremove,
  }: {
    cond: Cond;
    /** `매수 묶음 1의 조건 2` — 종류 선택·지우기 버튼 이름의 앞부분(매수·매도 묶음이 한 화면에 있어도 겹치지 않게) */
    label: string;
    allowPattern: boolean;
    /** 다른 줄이 반등 패턴을 쓰고 있으면 true(이 줄 선택지에서 막는다) */
    patternTaken: boolean;
    /** 이 줄을 바꾼다. 반환값이 있으면 그 조건으로 갈아 끼운다 */
    update: (fn: (c: Cond) => Cond | void) => void;
    onremove: () => void;
  } = $props();

  let kindEl: HTMLSelectElement;
  /** 새 줄을 더한 뒤 종류 선택으로 포커스 */
  export function focusKind() {
    kindEl?.focus();
  }
  const set = <K extends Cond['kind']>(kind: K, fn: (c: Extract<Cond, { kind: K }>) => void) =>
    update((c) => {
      if (c.kind === kind) fn(c as Extract<Cond, { kind: K }>);
    });
</script>

<div class="cond" role="group" aria-label={label}>
  <div class="head">
    <select
      class="pick"
      bind:this={kindEl}
      aria-label="{label} 종류"
      value={cond.kind}
      onchange={(e) => {
        const kind = e.currentTarget.value as Cond['kind'];
        update(() => defaultCond(kind, Date.now()));
      }}
    >
      {#each COND_KINDS as k (k.kind)}
        {#if k.kind !== 'pattern' || allowPattern}
          <option value={k.kind} disabled={k.kind === 'pattern' && patternTaken && cond.kind !== 'pattern'}>{k.label}</option>
        {/if}
      {/each}
    </select>
    <button type="button" class="x danger" aria-label="{label} 지우기" onclick={onremove}>✕</button>
  </div>
  {#if cond.kind === 'maPrice'}
    <div class="row"><NumberField label="이동평균" value={cond.period} min={2} max={250} step={1} suffix="일선" onchange={(v) => set('maPrice', (c) => (c.period = v))} /></div>
    <label class="sel"><span>종가가</span>
      <select class="pick" value={cond.side} onchange={(e) => set('maPrice', (c) => (c.side = e.currentTarget.value as 'above' | 'below'))}>
        <option value="above">위</option><option value="below">아래</option>
      </select>
    </label>
  {:else if cond.kind === 'maCross'}
    <div class="row"><NumberField label="짧은 이동평균" value={cond.short} min={2} max={250} step={1} suffix="일" onchange={(v) => set('maCross', (c) => (c.short = v))} /></div>
    <div class="row"><NumberField label="긴 이동평균" value={cond.long} min={2} max={250} step={1} suffix="일" onchange={(v) => set('maCross', (c) => (c.long = v))} /></div>
    <label class="sel"><span>교차</span>
      <select class="pick" value={cond.dir} onchange={(e) => set('maCross', (c) => (c.dir = e.currentTarget.value as 'golden' | 'dead'))}>
        <option value="golden">골든크로스</option><option value="dead">데드크로스</option>
      </select>
    </label>
  {:else if cond.kind === 'rsi'}
    <div class="row"><NumberField label="RSI 기간" value={cond.period} min={2} max={50} step={1} suffix="일" onchange={(v) => set('rsi', (c) => (c.period = v))} /></div>
    <div class="row"><NumberField label="기준" value={cond.level} min={1} max={99} onchange={(v) => set('rsi', (c) => (c.level = v))} /></div>
    <label class="sel"><span>RSI가 기준</span>
      <select class="pick" value={cond.op} onchange={(e) => set('rsi', (c) => (c.op = e.currentTarget.value as typeof c.op))}>
        <option value="above">위</option><option value="below">아래</option><option value="crossUp">상향 돌파</option><option value="crossDown">하향 돌파</option>
      </select>
    </label>
  {:else if cond.kind === 'volume'}
    <div class="row"><NumberField label="평균 기간" value={cond.days} min={2} max={120} step={1} suffix="일" onchange={(v) => set('volume', (c) => (c.days = v))} /></div>
    <div class="row"><NumberField label="거래량" value={cond.ratio} min={1} max={20} suffix="배 이상" onchange={(v) => set('volume', (c) => (c.ratio = v))} /></div>
  {:else if cond.kind === 'change'}
    <div class="row"><NumberField label="기간" value={cond.days} min={1} max={250} step={1} suffix="일" onchange={(v) => set('change', (c) => (c.days = v))} /></div>
    <div class="row"><NumberField label="등락률" value={cond.pct} min={-90} max={500} suffix="%" onchange={(v) => set('change', (c) => (c.pct = v))} /></div>
    <label class="sel"><span>등락률이</span>
      <select class="pick" value={cond.op} onchange={(e) => set('change', (c) => (c.op = e.currentTarget.value as 'above' | 'below'))}>
        <option value="above">이상</option><option value="below">이하</option>
      </select>
    </label>
  {:else if cond.kind === 'fromHigh'}
    <div class="row"><NumberField label="고점 기간" value={cond.days} min={2} max={250} step={1} suffix="일" onchange={(v) => set('fromHigh', (c) => (c.days = v))} /></div>
    <div class="row"><NumberField label="하락폭" value={cond.pct} min={1} max={90} suffix="% 이상" onchange={(v) => set('fromHigh', (c) => (c.pct = v))} /></div>
  {:else if cond.kind === 'newHigh'}
    <div class="row"><NumberField label="신고가 기간" value={cond.days} min={2} max={250} step={1} suffix="일" onchange={(v) => set('newHigh', (c) => (c.days = v))} /></div>
  {:else}
    <PatternFields entry={cond.entry} update={(fn) => set('pattern', (c) => fn(c.entry))} />
  {/if}
</div>

<style>
  .cond {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 0;
    border-top: 1px solid var(--line);
  }
  .head {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .head .pick {
    flex: 1;
    min-width: 0;
  }
  .pick {
    min-height: 44px;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: var(--r-chip);
    background: var(--surface);
    color: var(--t1);
    font: inherit;
  }
  .x {
    min-width: 44px;
    min-height: 44px;
  }
  .sel {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
  }
</style>
```

(CSS 토큰은 이 앱 것을 써요: 모서리 `--r-card`(카드)·`--r-chip`(칩·입력)·`--r-sheet`(시트), 선 `--line`, 면 `--surface`, 글자 `--t1`·`--t2`, 터치 높이 `--touch`. `min-height: 44px` 자리는 `var(--touch)`로 써도 돼요. `.x.danger` 모양은 `ExitSection.svelte`의 `.x`·`.danger` 규칙을 그대로 옮겨요. `.row`는 `PatternFields.svelte`의 `.row` 규칙을 그대로 옮겨요.)

`src/lib/ui/simulate/editor/CondGroupCard.svelte`:

```svelte
<script lang="ts">
  // 묶음 카드(스펙 §10.2): 안의 조건은 모두 맞아야 한다. 조건을 더하면 새 줄의 종류 선택으로, 지우면 앞 줄(없으면 [＋ 조건])로 포커스.
  import { tick } from 'svelte';
  import { defaultCond, MAX_CONDS } from '../../../sim/strategyV2';
  import type { Cond, CondGroup } from '../../../sim/types';
  import CondRow from './CondRow.svelte';

  let {
    group,
    index,
    prefix,
    allowPattern,
    patternTaken,
    update,
    onremove,
  }: {
    group: CondGroup;
    index: number;
    /** `매수 묶음` · `매도 묶음` */
    prefix: string;
    allowPattern: boolean;
    patternTaken: boolean;
    update: (fn: (g: CondGroup) => void) => void;
    onremove: () => void;
  } = $props();

  const rows: CondRow[] = $state([]);
  let addBtn: HTMLButtonElement;
  const full = $derived(group.conds.length >= MAX_CONDS);

  async function addCond() {
    if (full) return;
    update((g) => void g.conds.push(defaultCond('maPrice')));
    await tick();
    rows[group.conds.length - 1]?.focusKind();
  }
  async function removeCond(ci: number) {
    update((g) => void g.conds.splice(ci, 1));
    await tick();
    if (ci > 0) rows[ci - 1]?.focusKind();
    else addBtn?.focus();
  }
  const setCond = (ci: number) => (fn: (c: Cond) => Cond | void) =>
    update((g) => {
      const next = fn(g.conds[ci]);
      if (next) g.conds[ci] = next;
    });
</script>

<section class="group" role="group" aria-label="{prefix} {index + 1}">
  <div class="g-head">
    <span class="g-title">{prefix} {index + 1} · 모두 만족</span>
    <button type="button" class="link" onclick={onremove}>묶음 지우기</button>
  </div>
  {#each group.conds as cond, ci (ci)}
    <CondRow
      bind:this={rows[ci]}
      {cond}
      label="{prefix} {index + 1}의 조건 {ci + 1}"
      {allowPattern}
      patternTaken={patternTaken && cond.kind !== 'pattern'}
      update={setCond(ci)}
      onremove={() => removeCond(ci)}
    />
  {/each}
  <button type="button" class="act" bind:this={addBtn} disabled={full} onclick={addCond}>＋ 조건</button>
  {#if full}<p class="hint">조건은 묶음마다 {MAX_CONDS}개까지예요</p>{/if}
</section>

<style>
  .group {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: var(--r-card);
  }
  .g-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .g-title {
    font-weight: 600;
  }
  .link {
    min-height: 44px;
  }
</style>
```

(`.act`·`.hint` 모양은 `ExitSection.svelte`의 같은 이름 규칙을 그대로 옮겨요.)

`src/lib/ui/simulate/editor/CondGroupsEditor.svelte`:

```svelte
<script lang="ts">
  // 묶음 목록(스펙 §10.2): 묶음끼리는 하나만 맞으면 된다(또는). 매수 조건·조건 매도가 같이 쓴다.
  import { tick } from 'svelte';
  import { defaultCond, MAX_GROUPS } from '../../../sim/strategyV2';
  import type { CondGroup } from '../../../sim/types';
  import CondGroupCard from './CondGroupCard.svelte';

  let {
    groups,
    prefix,
    allowPattern,
    update,
  }: { groups: CondGroup[]; prefix: string; allowPattern: boolean; update: (fn: (groups: CondGroup[]) => void) => void } = $props();

  const full = $derived(groups.length >= MAX_GROUPS);
  const patternTaken = $derived(groups.some((g) => g.conds.some((c) => c.kind === 'pattern')));
  let root: HTMLElement;

  async function addGroup() {
    if (full) return;
    update((gs) => void gs.push({ conds: [defaultCond('maPrice')] }));
    await tick();
    const selects = root.querySelectorAll<HTMLSelectElement>('select[aria-label$=" 종류"]');
    selects[selects.length - 1]?.focus();
  }
</script>

<div class="groups" bind:this={root}>
  {#each groups as group, gi (gi)}
    {#if gi > 0}<p class="or" aria-hidden="true">또는</p>{/if}
    <CondGroupCard
      {group}
      index={gi}
      {prefix}
      {allowPattern}
      {patternTaken}
      update={(fn) => update((gs) => fn(gs[gi]))}
      onremove={() => update((gs) => void gs.splice(gi, 1))}
    />
  {/each}
  <button type="button" class="act" disabled={full} onclick={addGroup}>＋ 또는 묶음</button>
  {#if full}<p class="hint">묶음은 {MAX_GROUPS}개까지예요</p>{/if}
</div>

<style>
  .groups {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .or {
    text-align: center;
    color: var(--t2);
    margin: 0;
  }
</style>
```

`src/lib/ui/simulate/editor/BuyRulesSection.svelte`:

```svelte
<script lang="ts">
  // 매수 조건(스펙 §10.2): 묶음 안 조건은 모두, 묶음끼리는 하나만 맞으면 산다. 휴대폰도 한 열.
  import type { Strategy } from '../../../sim/types';
  import CondGroupsEditor from './CondGroupsEditor.svelte';

  let { s, update }: { s: Strategy; update: (fn: (s: Strategy) => void) => void } = $props();
</script>

<p class="hint">묶음 안 조건은 모두, 묶음끼리는 하나만 맞으면 사요.</p>
<p class="hint">팔고 난 다음 날에도 조건이 맞으면 다시 살 수 있어요. 패턴·교차·돌파는 새로 일어나야 맞아요.</p>
<CondGroupsEditor groups={s.rules.buy} prefix="매수 묶음" allowPattern update={(fn) => update((x) => fn(x.rules.buy))} />
```

(`.hint` 규칙은 `ExitSection.svelte`의 것을 옮겨요.)

`src/lib/ui/simulate/StrategyEditor.svelte`:
- `SECTIONS`의 `{ key: 'entry', title: '매수' }` → `{ key: 'entry', title: '매수 조건' }`.
- Task 4에서 넣은 `{@const gi …}` 블록 전체를 `<BuyRulesSection s={draft} {update} />`로 바꾸고 import를 바꿔요(`PatternFields` import는 지워요).

- [ ] **Step 4: 통과 확인**

Run: `TZ=America/New_York corepack pnpm vitest run src/lib/ui/simulate && corepack pnpm check`
Expected: PASS. 기존 편집기 테스트 중 「매수」 구역에서 반등 패턴 칸을 바로 찾던 것은 이제 묶음 1의 조건 1 아래에 그대로 있어요(같은 라벨).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/ui/simulate
git commit -m "feat(simulate): 매수 조건 묶음 편집기를 더함"
```

---

### Task 14: 편집 화면 — 매도 토글·배분·템플릿

**Files:**
- Modify: `src/lib/ui/simulate/editor/ExitSection.svelte`
- Modify: `src/lib/ui/simulate/editor/PeriodSection.svelte:37-39`
- Create: `src/lib/sim/templates.ts`, `src/lib/sim/templates.test.ts`
- Modify: `src/lib/ui/simulate/StrategyList.svelte:20-27,113,132`
- Modify: `tests/e2e/simulate.spec.ts:52,116,168,212,252`, `tests/e2e/a11y.spec.ts:66,88,108`
- Test: `src/lib/ui/simulate/StrategyEditor.test.ts`, `src/lib/ui/simulate/StrategyList.test.ts`(없으면 새 파일)

**Interfaces:**
- Produces(`templates.ts`):
  - `export interface StrategyTemplate { id: 'rebound' | 'rsi' | 'golden'; name: string; desc: string; apply(s: Strategy): void }`
  - `export const TEMPLATES: readonly StrategyTemplate[]`
  - `export function fromTemplate(t: StrategyTemplate, now: number, groupId: string | null, name: string): Strategy`

- [ ] **Step 1: 실패 테스트 쓰기**

`src/lib/sim/templates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { newStrategy } from './defaults';
import { sanitizeStrategiesV2 } from './strategyV2';
import { fromTemplate, TEMPLATES } from './templates';
import { ruleIssues } from './validate';

describe('템플릿(§3.4)', () => {
  it('세 개, 첫 번째는 지금 새 전략과 같다', () => {
    expect(TEMPLATES.map((t) => t.name)).toEqual(['하락 후 반등', 'RSI 과매도 반등', '골든크로스 추세']);
    const a = fromTemplate(TEMPLATES[0], 0, 'g0', '새 전략');
    expect({ ...a, id: 'x' }).toEqual({ ...newStrategy(0, 'g0', '새 전략'), id: 'x' });
  });
  it('규칙만 바꾸고 종목·기간·비교·비용은 기본값', () => {
    const b = fromTemplate(TEMPLATES[2], 0, 'g0', '새 전략');
    const d = newStrategy(0, 'g0', '새 전략');
    expect([b.universe, b.period, b.benchmarks, b.costs, b.capital]).toEqual([d.universe, d.period, d.benchmarks, d.costs, d.capital]);
    expect(b.rules.buy).toEqual([{ conds: [{ kind: 'maCross', short: 20, long: 60, dir: 'golden' }, { kind: 'volume', days: 20, ratio: 1.5 }] }]);
    expect(b.rules.sell.signal).toEqual({ on: true, groups: [{ conds: [{ kind: 'maCross', short: 20, long: 60, dir: 'dead' }] }] });
  });
  it('모든 템플릿은 저장 검증을 고침 없이 통과하고 막는 경고가 없다', () => {
    for (const t of TEMPLATES) {
      const s = { ...fromTemplate(t, 0, null, t.name), id: t.id };
      expect(sanitizeStrategiesV2({ strategies: [s] }, 0)).toEqual({ strategies: [s], repaired: false });
      expect(ruleIssues(s).filter((i) => i.blocking)).toEqual([]);
    }
  });
});
```

`src/lib/ui/simulate/StrategyEditor.test.ts` 끝에:

```ts
describe('매도 토글·배분(§10.3·§10.4)', () => {
  it('트레일링·기간 청산·조건 매도를 켜고 손절을 끈다', async () => {
    const { app } = setup();
    await openSection('매도');
    await fireEvent.click(screen.getByRole('switch', { name: '손절 사용' }));
    await fireEvent.click(screen.getByRole('switch', { name: '트레일링 스톱 사용' }));
    await fireEvent.click(screen.getByRole('switch', { name: '기간 청산 사용' }));
    await fireEvent.click(screen.getByRole('switch', { name: '조건 매도 사용' }));
    await settle();
    const sell = saved(app).rules.sell;
    expect([sell.stopLoss.on, sell.trailing.on, sell.timeExit.on, sell.signal.on]).toEqual([false, true, true, true]);
    expect(sell.signal.groups).toEqual([{ conds: [{ kind: 'maPrice', period: 20, side: 'below' }] }]);
    expect(screen.getByRole('group', { name: '매도 묶음 1' })).toBeTruthy();
  });
  it('매도·기간·자금 구역을 펼쳐도 axe 위반이 없다', async () => {
    const { view } = setup((s) => (s.rules.sell.signal = { on: true, groups: [{ conds: [{ kind: 'maPrice', period: 20, side: 'below' }] }] }));
    await openSection('매도');
    await openSection('기간·자금');
    await expectNoAxeViolations(view.container);
  });
  it('배분 방식: 균등이면 비율 칸을 숨기고 안내', async () => {
    const { app } = setup();
    await openSection('기간·자금');
    await fireEvent.click(screen.getByRole('radio', { name: '균등' }));
    await settle();
    expect(saved(app).sizing.mode).toBe('equal');
    expect(screen.queryByLabelText('회당 비율')).toBeNull();
    expect(screen.getByText(/처음 자금 ÷ 종목 수/)).toBeTruthy();
  });
});
```

(토글이 `role="switch"`가 아니라 체크박스면 이 파일의 기존 토글 테스트가 쓰는 역할로 바꿔요. `Segmented` 선택지 역할이 `radio`가 아니면 이 파일의 기존 `Segmented` 테스트(손절 기준)가 쓰는 역할로 바꿔요.)

`src/lib/ui/simulate/StrategyList.test.ts`(없으면 새로 만들고 `StrategyEditor.test.ts`의 `makeTestApp` 구성을 따라요):

```ts
it('새 전략: 템플릿을 고르면 그 규칙으로 만들고 편집으로 간다', async () => {
  const app = makeTestApp({ groups: [{ id: 'g1', name: '반도체', items: itemsOf(['005930']) }], now: NOW });
  render(StrategyList, { app });
  await fireEvent.click(screen.getAllByRole('button', { name: '＋ 새 전략' })[0]);
  await fireEvent.click(screen.getByRole('button', { name: /RSI 과매도 반등/ }));
  expect(app.strategies).toHaveLength(1);
  expect(app.strategies[0].rules.buy[0].conds[0]).toEqual({ kind: 'rsi', period: 14, level: 30, op: 'crossUp' });
  app.destroy();
});
```

- [ ] **Step 2: 실패 확인**

Run: `TZ=America/New_York corepack pnpm vitest run src/lib/sim/templates.test.ts src/lib/ui/simulate/StrategyEditor.test.ts src/lib/ui/simulate/StrategyList.test.ts`
Expected: FAIL — 템플릿·토글·배분 선택이 없어요.

- [ ] **Step 3: 구현**

`src/lib/sim/templates.ts`:

```ts
// 새 전략 템플릿(스펙 §3.4). 규칙(rules·scaleIn·sizing)만 정하고 종목·기간·비교·비용은 newStrategy 값을 쓴다.
// 숫자는 시작값이다. 성과를 약속하는 문구는 쓰지 않는다.
import { newStrategy } from './defaults';
import type { Strategy } from './types';

export interface StrategyTemplate {
  id: 'rebound' | 'rsi' | 'golden';
  name: string;
  desc: string;
  apply(s: Strategy): void;
}

export const TEMPLATES: readonly StrategyTemplate[] = [
  { id: 'rebound', name: '하락 후 반등', desc: '고점에서 떨어진 뒤 다시 오를 때 사요', apply: () => {} },
  {
    id: 'rsi',
    name: 'RSI 과매도 반등',
    desc: 'RSI가 30을 위로 넘고 장기 추세 위일 때 사요',
    apply(s) {
      s.rules.buy = [{ conds: [{ kind: 'rsi', period: 14, level: 30, op: 'crossUp' }, { kind: 'maPrice', period: 120, side: 'above' }] }];
      s.rules.sell.takeProfit = { on: true, stages: [{ pct: 10, sellPct: 100 }], afterFirstTake: 'keep' };
      s.rules.sell.stopLoss = { on: true, pct: 5, basis: 'avgAfterScaleIn' };
      s.rules.sell.timeExit = { on: true, days: 20 };
    },
  },
  {
    id: 'golden',
    name: '골든크로스 추세',
    desc: '이평 골든크로스와 거래량이 함께 나올 때 사요',
    apply(s) {
      s.rules.buy = [{ conds: [{ kind: 'maCross', short: 20, long: 60, dir: 'golden' }, { kind: 'volume', days: 20, ratio: 1.5 }] }];
      s.rules.sell.takeProfit = { ...s.rules.sell.takeProfit, on: false };
      s.rules.sell.stopLoss = { on: true, pct: 7, basis: 'avgAfterScaleIn' };
      s.rules.sell.trailing = { on: true, pct: 10 };
      s.rules.sell.signal = { on: true, groups: [{ conds: [{ kind: 'maCross', short: 20, long: 60, dir: 'dead' }] }] };
    },
  },
];

export function fromTemplate(t: StrategyTemplate, now: number, groupId: string | null, name: string): Strategy {
  const s = newStrategy(now, groupId, name);
  t.apply(s);
  return s;
}
```

`src/lib/ui/simulate/editor/ExitSection.svelte`: 익절·손절 블록을 토글 줄 아래로 넣고 나머지를 더해요.
- import에 `Toggle`(`@sch0718/ui-svelte`), `defaultCond`(`'../../../sim/strategyV2'`), `CondGroupsEditor`.
- `<p class="group-title">익절</p>` 바로 아래에 토글을 두고, 기존 익절 단계 마크업(`{#each stages …}`부터 `<p class="hint">파는 양은…</p>`까지)을 `{#if s.rules.sell.takeProfit.on} … {/if}`로 감싸요.

```svelte
<Toggle id="{uid}-tp" label="익절 사용" checked={s.rules.sell.takeProfit.on} onchange={(v) => update((x) => (x.rules.sell.takeProfit.on = v))} />
```

- `<p class="group-title">손절</p>` 아래도 같은 방식이에요(손절폭·기준 마크업을 `{#if s.rules.sell.stopLoss.on}`로 감싸요). 「1단계 익절 뒤 손절선」 `Segmented`는 익절 쪽 `{#if}` 안으로 옮겨요(익절에 딸린 설정, §4.4).

```svelte
<Toggle id="{uid}-sl" label="손절 사용" checked={s.rules.sell.stopLoss.on} onchange={(v) => update((x) => (x.rules.sell.stopLoss.on = v))} />
```

- 파일 끝(마크업, `<style>` 앞)에 더해요.

```svelte
<p class="group-title">트레일링 스톱</p>
<div class="row">
  <NumberField
    label="트레일링 스톱"
    value={s.rules.sell.trailing.pct}
    min={1}
    max={50}
    suffix="% 내려오면"
    muted={!s.rules.sell.trailing.on}
    toggle={{ checked: s.rules.sell.trailing.on, onchange: (v) => update((x) => (x.rules.sell.trailing.on = v)) }}
    onchange={(v) => update((x) => (x.rules.sell.trailing.pct = v))}
  />
</div>
<p class="hint">보유 중 가장 높은 종가에서 N% 내려오면 팔아요.</p>

<p class="group-title">기간 청산</p>
<div class="row">
  <NumberField
    label="기간 청산"
    value={s.rules.sell.timeExit.days}
    min={1}
    max={250}
    step={1}
    suffix="거래일 지나면"
    muted={!s.rules.sell.timeExit.on}
    toggle={{ checked: s.rules.sell.timeExit.on, onchange: (v) => update((x) => (x.rules.sell.timeExit.on = v)) }}
    onchange={(v) => update((x) => (x.rules.sell.timeExit.days = v))}
  />
</div>
<p class="hint">기간 청산은 매수일을 1일째로, 거래정지일도 세요.</p>

<p class="group-title">조건 매도</p>
<Toggle
  id="{uid}-sg"
  label="조건 매도 사용"
  checked={s.rules.sell.signal.on}
  onchange={(v) =>
    update((x) => {
      x.rules.sell.signal.on = v;
      if (v && x.rules.sell.signal.groups.length === 0) x.rules.sell.signal.groups.push({ conds: [{ ...defaultCond('maPrice'), side: 'below' }] });
    })}
/>
{#if s.rules.sell.signal.on}
  <CondGroupsEditor groups={s.rules.sell.signal.groups} prefix="매도 묶음" allowPattern={false} update={(fn) => update((x) => fn(x.rules.sell.signal.groups))} />
{/if}
<p class="hint">조건 매도·기간 청산은 종가에 판정해 다음 거래일 시가에 남은 수량을 모두 팔아요.</p>
```

(`NumberField`의 `toggle` 이름은 `{label} 사용`이라 「트레일링 스톱 사용」·「기간 청산 사용」이 돼요. `Toggle`의 props 이름(`id`·`label`·`checked`·`onchange`)은 `PatternFields.svelte`의 `Toggle` 사용과 같게 써요.)

`src/lib/ui/simulate/editor/PeriodSection.svelte:37-39`의 「회당 매수 비중」 줄을 바꿔요.

```svelte
<span class="seg-label">배분 방식</span>
<Segmented
  wide
  wrap
  onSurface
  label="배분 방식"
  value={s.sizing.mode}
  onchange={(v) => update((x) => (x.sizing.mode = v as SizingMode))}
  options={[
    { value: 'fixed', label: '처음 자금' },
    { value: 'equityPct', label: '총자산' },
    { value: 'cashPct', label: '남은 현금' },
    { value: 'equal', label: '균등' },
  ]}
/>
{#if s.sizing.mode === 'equal'}
  <p class="hint">처음 자금 ÷ 종목 수(지금 {count}종목 → 회당 {money(count ? Math.round(s.capital.initial / count) : 0)})</p>
{:else}
  <div class="row">
    <NumberField label="회당 비율" value={s.sizing.pct} min={1} max={100} suffix={SUFFIX[s.sizing.mode]} onchange={(v) => update((x) => (x.sizing.pct = v))} />
  </div>
{/if}
```

스크립트에 더해요.

```ts
  import { Segmented } from '@sch0718/ui-svelte';
  import type { SizingMode, Strategy } from '../../../sim/types';
  import { money } from '../simText';
  // props에 count 더하기: 고른 종목 수(균등 배분 안내용)
  const SUFFIX: Record<Exclude<SizingMode, 'equal'>, string> = { fixed: '% (처음 자금 대비)', equityPct: '% (그날 총자산 대비)', cashPct: '% (남은 현금 대비)' };
```

props를 `let { s, update, count }: { s: Strategy; update: …; count: number } = $props();`로 바꾸고, `StrategyEditor.svelte`의 `<PeriodSection s={draft} {update} />`를 `<PeriodSection s={draft} {update} count={resolveSymbols(draft, app.watchlists).length} />`로(import `resolveSymbols` from `'../../sim/validate'`). `.seg-label`·`.hint` 규칙은 `ExitSection.svelte`의 것을 옮겨요.

`src/lib/ui/simulate/StrategyList.svelte`:
- import `fromTemplate`·`TEMPLATES`(`'../../sim/templates'`). `newStrategy` import는 지워요.
- 상태 `let picking = $state(false);`를 더하고 `create()`를 둘로 나눠요.

```ts
  function create() {
    if (full()) return showSnackbar(STRATEGY_CAP_MESSAGE);
    picking = true;
  }

  function createFrom(t: (typeof TEMPLATES)[number]) {
    picking = false;
    const ids = app.watchlists.groups.map((g) => g.id);
    const last = app.settings.lastGroupId;
    const groupId = last && ids.includes(last) ? last : (ids[0] ?? null);
    const s = fromTemplate(t, Date.now(), groupId, nextStrategyName(app.strategies));
    app.setStrategies([...app.strategies, s]);
    app.navigate({ name: 'simulate', strategyId: s.id });
  }
```

- 기존 `<Sheet …>` 아래에 템플릿 시트를 더해요.

```svelte
<Sheet open={picking} title="어떤 전략으로 시작할까요?" onclose={() => (picking = false)}>
  <ul class="templates">
    {#each TEMPLATES as t (t.id)}
      <li>
        <button type="button" class="tpl" onclick={() => createFrom(t)}>
          <b>{t.name}</b>
          <span>{t.desc}</span>
        </button>
      </li>
    {/each}
  </ul>
</Sheet>
```

스타일을 더해요.

```css
  .templates {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .tpl {
    width: 100%;
    min-height: 56px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    text-align: left;
  }
```

(`Sheet`가 `returnFocus`를 요구하면 기존 메뉴 시트가 넘기는 값과 같은 방식으로 「＋ 새 전략」 버튼을 넘겨요.)

e2e: `tests/e2e/simulate.spec.ts`·`a11y.spec.ts`에서 `await page.getByRole('button', { name: '＋ 새 전략' }).click();` 바로 다음 줄마다 더해요(목록: `simulate.spec.ts:52,116,168,212,252`, `a11y.spec.ts:66,88,108`).

```ts
  await page.getByRole('button', { name: /하락 후 반등/ }).click();
```

편집 화면 구역 제목 「매수」를 찾던 e2e 단언(`grep -n "'매수'" tests/e2e`)은 「매수 조건」으로 바꿔요.

- [ ] **Step 4: 통과 확인**

Run: `corepack pnpm test && corepack pnpm check`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/sim/templates.ts src/lib/sim/templates.test.ts src/lib/ui/simulate tests/e2e
git commit -m "feat(simulate): 매도 토글·배분 방식·새 전략 템플릿 3개를 더함"
```

---

### Task 15: e2e·axe·계약 최종 확인

**Files:**
- Modify: `tests/e2e/simulate.spec.ts`(새 테스트), `tests/e2e/a11y.spec.ts`(편집 화면 axe에 새 구역)
- Modify: `src/lib/sync/contract.test.ts`(지금 앱이 만든 v2 문서·공유)

**Interfaces:**
- Consumes: `buildProfileDoc`(Task 4), `strategySnapshot`, `TEMPLATES`·`fromTemplate`(Task 14)

- [ ] **Step 1: 계약 테스트 더하기** — `src/lib/sync/contract.test.ts` 끝에

```ts
describe('지금 앱이 만든 v2 문서·공유는 Worker 검사를 통과한다(N4)', () => {
  it('템플릿 3개와 한도까지 채운 전략', () => {
    const strategies = [...TEMPLATES.map((t, i) => ({ ...fromTemplate(t, fx.now, 'g0', t.name), id: `t${i}` })), { ...fullStrategyV2(), id: 'full' }];
    const doc = { ...fx.doc, v: 2, strategies };
    const r = checkProfileDoc(doc, fx.now);
    expect(r.ok).toBe(true);
    for (const s of strategies) {
      const snap = strategySnapshot({ ...s, universe: { kind: 'symbols', symbols: ['005930'] } }, { groups: [] }, { hideCapital: false, now: fx.now });
      expect(snap.v).toBe(2);
      expect(checkShareSnapshot(snap, 'strategy', fx.now, 'create')).toEqual({ ok: true, snapshot: snap });
    }
  });
});
```

(import `fromTemplate`·`TEMPLATES` from `'../sim/templates'`, `strategySnapshot` from `'../share/snapshot'`.)

- [ ] **Step 2: e2e 더하기** — `tests/e2e/simulate.spec.ts` 끝에(이 파일 `:41` 테스트의 데모 데이터 준비 단계를 그대로 따라요)

```ts
test('전략 빌더: 골든크로스 추세 템플릿 → 매수 조건·매도 확인 → 실행 → 결과·재생', async ({ page }, testInfo) => {
  // :41 테스트와 같은 준비(데모 데이터·시뮬레이션 화면 진입)
  await page.getByRole('button', { name: '＋ 새 전략' }).click();
  await page.getByRole('button', { name: /골든크로스 추세/ }).click();
  await page.getByRole('button', { name: /매수 조건/ }).click();
  await expect(page.getByRole('group', { name: '매수 묶음 1' })).toBeVisible();
  await page.getByRole('button', { name: /^매도/ }).click();
  await expect(page.getByRole('group', { name: '매도 묶음 1' })).toBeVisible();
  await page.getByRole('button', { name: '시뮬레이션 실행' }).click();
  await expect(page.getByRole('slider', { name: '거래일' }).or(page.getByText(/매수 조건을 모두 만족한 날이 없|거래가 없/))).toBeVisible({ timeout: 30_000 });
});
```

`tests/e2e/a11y.spec.ts`의 편집 화면 axe 테스트(`:66` 근처)에서 axe를 돌리기 전에 「매수 조건」·「매도」 구역을 펼쳐요(`await page.getByRole('button', { name: /매수 조건/ }).click();`, `await page.getByRole('button', { name: /^매도/ }).click();`).

- [ ] **Step 3: 전체 확인**

Run: `corepack pnpm test && corepack pnpm check && corepack pnpm e2e && (cd sync-worker && npx vitest run && npx tsc -p tsconfig.json --noEmit)`
Expected: 모두 PASS. Worker 테스트는 코드 변경 없이 통과해야 해요(N4). 실패하면 그 원인이 공용 경로 동작 변경인지 보고 「PR①-b 필요」로 알려요.

- [ ] **Step 4: 커밋**

```bash
git add src/lib/sync/contract.test.ts tests/e2e
git commit -m "test(simulate): 전략 빌더 e2e·axe와 v2 문서·공유 계약 테스트를 더함"
```

---

## Self-Review (작성 시 점검)

- 스펙 PR② 범위 대응: §3 형식(Task 3·4), §4 엔진(Task 2·4·6·7, 하루 순서·우선순위), §5 지표(Task 1·2), §6 배분(Task 5), §7 선정 기준(Task 4·11·12), §8.2 새 키(Task 4), §8.3 옮기기·`migrate.ts`·`docVersion`(Task 9), §8.4 read v2·`importPart`(Task 4·10), §8.5 내보내기(Task 4), §9 결과·재생(Task 8), §10 화면(Task 4·13·14), §11 경고(Task 4·12), §12 테스트(각 Task·Task 15), §15 파일(파일 구조 표).
- PR① 코드와의 일치: `StrategyV2`·`sanitizeStrategiesV2`·`defaultCond`·`MAX_GROUPS`·`MAX_CONDS`·`fullStrategyV2`·`PROFILE_DOC_MAX_VERSION`·`APP_OUTDATED_CODE`·`ProfileDocV2`·`STRATEGY_SHARE_MAX_VERSION`·새 체결 종류·마커는 다시 만들지 않고 import해요.
- N4: Worker 공용 파일은 import 자리·이름(`sanitizeStrategiesV1`)과 read 모드만 바뀌어요. `checkProfileDoc` 판정 순서·`TOP_KEYS`·create 모드는 그대로예요. Task 3의 고정값 계약과 Task 15의 Worker 테스트가 확인해요. **PR①-b는 필요 없어요.**
- 이름 일관성: `toV2`·`newStrategyV1`·`sanitizeStrategiesV1`·`sanitizeEntry`·`defaultPatternEntry`·`patternEntryOf`·`patternCount`·`createRuleEvaluator`·`condReason`·`rulesLookback`·`RSI_START_BARS`·`REASON_MAX`·`sellQty`·`SellCtx`·`SellRules`·`posAmount`·`pendingSell`·`sellEval`·`strategySet`·`profileDocBase`·`migrateStrategies`·`APP_OUTDATED_TEXT`·`STRATEGY_SHARE_VERSION`·`MissingPatternError`·`patternRefIssues`·`buyRulesSummary`·`sellRulesSummary`·`sizingText`·`cutText`·`TEMPLATES`·`fromTemplate`가 모든 Task에서 같아요.
- 확인 필요: 없어요. 스펙 §14-1(RSI 예시표 값)은 원본 넷째 자리 종가로 70.533·66.319를 확인해 해소했어요(Task 1).
