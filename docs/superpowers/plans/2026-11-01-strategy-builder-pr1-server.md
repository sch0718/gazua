# 전략 빌더 PR① 서버 호환 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 앱이 아직 v1 전략만 쓰는 상태에서, 서버(Worker)와 공용 검사 코드가 v2 프로필 문서·v2 전략 공유를 받아 원본 그대로 저장하게 해요. 동시에 옛 앱이 v2 문서를 받아 기본값으로 덮어쓰는 길(다운그레이드)을 막아요. 앱 동작은 바뀌지 않아요.

**Architecture:**
- 새 파일 `src/lib/sim/strategyV2.ts`에 `StrategyV2` 타입과 `sanitizeStrategiesV2`를 둬요. 앱의 `Strategy`(v1)·`sanitizeStrategies` 호출은 손대지 않아요.
- 공용 검사 `checkProfileDoc`(`src/lib/sync/dto.ts`)과 `checkShareSnapshot`(`src/lib/share/snapshot.ts`)이 문서·스냅샷의 `v`로 v1·v2를 갈라 검사하고 **입력 원본**을 돌려줘요. 공유 read 모드는 v1만 받아요.
- Worker는 `profile_index.doc_v` 열로 저장 버전을 알고, 요청 쿼리 `docVersion`(없으면 1)보다 높은 문서는 돌려주지 않아요. v2 위에 v1을 올리면 조건부 `UPDATE`로 원자적으로 거절해요.
- 새 체결 종류 3종(`trail`·`time`·`signalSell`)을 타입·결과 검사·마커에 먼저 넣어요. 엔진은 아직 내지 않아요.

**Tech Stack:** TypeScript, Vitest 3, Svelte 5(svelte-check), Cloudflare Workers + D1(테스트는 `node:sqlite` 흉내, `sync-worker/test/d1.ts`), wrangler 4.

**근거 문서:** `docs/superpowers/specs/2026-11-01-strategy-builder-design.md`. 절 번호(§)는 이 설계를 가리켜요. PR① 범위는 §8.7, 공용 경로 계약은 §8.7 「Worker 공용 경로 계약」이에요.

## Global Constraints

모든 Task가 지켜야 하는 값이에요. 스펙 값을 그대로 옮겼어요.

- **앱 동작 불변.** 앱이 만드는 프로필 문서는 계속 `v: 1`, 공유는 계속 `v: 1`이에요. `PROFILE_DOC_VERSION`(`dto.ts`)은 **1 그대로**, `SHARE_VERSION`(`snapshot.ts`)도 **1 그대로**예요. `src/lib/sync/api.ts`는 `docVersion`을 보내지 않아요.
- **앱 호출 불변.** `sanitizeStrategies`(`src/lib/sim/validate.ts`)의 이름·동작·호출처를 바꾸지 않아요. `Strategy` 타입(`src/lib/sim/types.ts`)은 `Trade['kind']` 3종 추가 말고 바꾸지 않아요.
- 받는 버전: 프로필 문서 `v` ∈ {1, 2}(`PROFILE_DOC_MAX_VERSION = 2`). 공유 `strategy`·`simResult`는 create 모드에서 {1, 2}, read 모드에서 {1}. 나머지 공유 종류(`group`·`criteria`·`compare`·`validation`)는 {1}.
- 버전 판정: `v`가 1 이상의 정수가 아니면 `invalid`(path `v`). 받는 최대보다 크면 `unsupported`(path `v`).
- 검사는 고치지 않아요. 정리 결과가 입력과 정확히 같아야 통과하고, 통과하면 **입력 원본**을 돌려줘요. Worker는 그 원본을 저장해요.
- 422 코드 상수: `export const APP_OUTDATED_CODE = '앱을 새로 고쳐 주세요';`(`src/lib/sync/dto.ts`). 옛 앱 `SyncPanel.svelte`가 거절 코드를 괄호에 그대로 보여서 한국어 문장으로 정했어요(§8.3).
- 요청 버전 쿼리 이름: `docVersion`. 없으면 1. 값이 `/^[1-9]\d{0,2}$/`가 아니면 422 `invalid`(path `docVersion`).
- 저장 버전 열: `profile_index.doc_v INTEGER NOT NULL DEFAULT 1`. 마이그레이션 파일 `sync-worker/migrations/0004_doc_version.sql`.
- PUT 순서: `checkProfileDoc` → `replayed()` → 조건부 갱신. 새로 만들기 SQL은 `ON CONFLICT (user_id, profile_id) DO NOTHING`을 유지해요. 갱신 SQL 끝에 `AND doc_v <= ?`(들어온 문서의 `v`).
- `rejected()` 순서: 머리 없음 → 410 `gone` / 삭제됨 → 410 `gone` / (들어온 문서가 있는 PUT만) 저장 `doc_v` > 들어온 `v` → 422 `APP_OUTDATED_CODE` / 그 밖 → 409 `conflict`(저장 `doc_v` > 요청 버전이면 `doc: null`). `deleteProfile`은 들어온 문서가 없어 422 단계 없이 409로 가요.
- 본문을 돌려주는 응답(`getProfile`·`getRevision`·`restoreProfile`)은 저장 버전이 요청 버전보다 크면 422 `APP_OUTDATED_CODE`. `restoreProfile`은 **바꾸기 전에** 검사해요. 삭제 판정(410)은 버전 검사보다 먼저예요.
- 금지 키(`src/lib/sync/forbidden.ts`의 `FORBIDDEN_KEYS`, 대소문자 무시)에 v2 새 키가 걸리지 않아요. v2 새 키: `v`·`sizing`·`mode`·`pct`·`rules`·`buy`·`sell`·`conds`·`kind`·`period`·`side`·`short`·`long`·`dir`·`level`·`op`·`days`·`ratio`·`entry`·`takeProfit`·`stages`·`afterFirstTake`·`stopLoss`·`basis`·`trailing`·`timeExit`·`signal`·`groups`·`on`. 깊이는 `JSON_DEPTH_MAX = 32` 안이에요(가장 깊은 길 11).
- v2 값 범위(§3.2): `sizing.pct` 1~100 · 묶음 0~4개(`MAX_GROUPS = 4`) · 묶음마다 조건 0~5개(`MAX_CONDS = 5`) · `maPrice.period`·`maCross.short/long` 정수 2~250 · `rsi.period` 정수 2~50 · `rsi.level` 1~99 · `volume.days` 정수 2~120 · `volume.ratio` 1~20 · `change.days` 정수 1~250 · `change.pct` −90~500 · `fromHigh.days`·`newHigh.days` 정수 2~250 · `fromHigh.pct` 1~90 · `trailing.pct` 1~50 · `timeExit.days` 정수 1~250. 익절 단계·손절·분할 매수·종목·기간·자금·비교·비용은 v1 규칙 그대로예요. 매도 묶음의 `pattern`과 모르는 `kind`는 버리고 `repaired`. 빈 묶음은 버리지 않아요. 패턴 블록 개수는 고치지 않아요.
- `strategyV2.ts`·`dto.ts`·`snapshot.ts`·`checkResult.ts`·`resultEnums.ts`는 Worker 번들에 들어가요. DOM·저장소·`import.meta.env`를 쓰지 않아요.
- 문체: 코드 주석은 한국어 해요체가 아닌 지금 코드의 짧은 서술체(「…한다」)를 따라요.
- 검증 명령
  - 루트: `corepack pnpm test`(= `TZ=America/New_York vitest run`), `corepack pnpm check`(svelte-check 두 번).
  - 한 파일: `TZ=America/New_York corepack pnpm vitest run <경로>`.
  - Worker: `cd sync-worker && npx vitest run`(= `corepack pnpm test`)과 `npx tsc -p tsconfig.json --noEmit`(= `corepack pnpm check`).

## File Structure

| 파일 | 만들기/고치기 | 책임 |
|---|---|---|
| `src/lib/sim/types.ts` | 고치기(:60) | `Trade['kind']`에 `trail`·`time`·`signalSell` |
| `src/lib/share/resultEnums.ts` | 고치기(:4-5) | `TRADE_KINDS`·`SELL_KINDS`에 3종 |
| `src/lib/share/checkResult.test.ts` | 고치기 | 새 종류 통과·단계 거절 |
| `src/lib/ui/simulate/markers.ts` | 고치기(:8, :16-23) | 라벨·색 |
| `src/lib/ui/simulate/markers.test.ts` | 고치기 | 새 종류 라벨 |
| `src/lib/sim/strategyV2.ts` | 만들기 | `StrategyV2` 타입, `sanitizeStrategiesV2` |
| `src/lib/sim/testStrategyV2.ts` | 만들기 | 테스트 전용 v2 고정 입력(묶음·조건 다 채움) |
| `src/lib/sim/strategyV2.test.ts` | 만들기 | 정리 규칙·금지 키·깊이 |
| `src/lib/sync/dto.ts` | 고치기(:14-34, :85, :99-103) | v1·v2 판정, `unsupported`, `APP_OUTDATED_CODE`, `ProfileDocV2` |
| `src/lib/sync/dto.test.ts` | 고치기(:129) | v2 통과·v3 거절 |
| `src/lib/share/snapshot.ts` | 고치기(:13, :23, :319-331, :376, :386-392, :413-423) | 종류별 버전 판정, create 원본, read v1만 |
| `src/lib/share/snapshot.test.ts` | 고치기(:121) | 버전 판정 |
| `sync-worker/migrations/0004_doc_version.sql` | 만들기 | `doc_v` 열 |
| `sync-worker/src/profiles.ts` | 고치기 | `doc_v` 기록, 다운그레이드 거절, 본문 가리기, `requestDocVersion` |
| `sync-worker/src/handler.ts` | 고치기(:62-64, :69, :72) | 쿼리 전달 |
| `sync-worker/test/docs.ts` | 고치기 | `docV2()` |
| `sync-worker/src/profiles.test.ts` | 고치기 | 버전 동작·옛 앱 경로 무변화 |
| `sync-worker/src/shares.test.ts` | 고치기 | v1·v2 공유 원본 저장 |
| `sync-worker/README.md` | 고치기 | 배포 순서 |

---

### Task 1: 새 체결 종류 3종 (타입·결과 검사·마커)

엔진은 아직 이 종류를 내지 않아요. 타입과 검사·표시만 먼저 넓혀 PR②에서 공용 경로를 바꾸지 않게 해요(§8.7 W1-a).

**Files:**
- Modify: `src/lib/sim/types.ts:60`
- Modify: `src/lib/share/resultEnums.ts:4-5`
- Modify: `src/lib/ui/simulate/markers.ts:8`, `:16-23`
- Test: `src/lib/share/checkResult.test.ts`, `src/lib/ui/simulate/markers.test.ts`, `src/lib/share/resultEnums.test.ts`(이미 있는 타입 대조)

**Interfaces:**
- Produces: `Trade['kind'] = 'buy' | 'add' | 'take' | 'stop' | 'gapStop' | 'gapTake' | 'trail' | 'time' | 'signalSell'`
- Produces: `TRADE_KINDS`·`SELL_KINDS`에 같은 3종(끝에 덧붙임), `TRADE_LABEL.trail = '트레일'`, `TRADE_LABEL.time = '기간'`, `TRADE_LABEL.signalSell = '조건'`, `MARKER_COLOR`의 3종 = `MIXED_COLOR`

- [ ] **Step 1: 실패 테스트 쓰기** — `src/lib/share/checkResult.test.ts` 맨 끝에 붙여요.

```ts
describe('새 매도 종류(전략 빌더 §4.7)', () => {
  it.each(['trail', 'time', 'signalSell'])('%s: 단계 없음·손익 있음이면 통과', (kind) => {
    expect(sim((s) => (s.result.trades[2][2] = kind))).toMatchObject({ ok: true });
  });
  it.each(['trail', 'time', 'signalSell'])('%s: 단계가 있으면 invalid', (kind) => {
    expect(sim((s) => ((s.result.trades[2][2] = kind), (s.result.trades[2][3] = 1)))).toMatchObject({ ok: false, code: 'invalid', path: 'result.trades[2]' });
  });
  it.each(['trail', 'time', 'signalSell'])('%s: 손익이 없으면 invalid', (kind) => {
    expect(sim((s) => ((s.result.trades[2][2] = kind), (s.result.trades[2][7] = null)))).toMatchObject({ ok: false, code: 'invalid', path: 'result.trades[2]' });
  });
});
```

`src/lib/ui/simulate/markers.test.ts` 맨 끝에 붙여요(파일 위 import에 `TRADE_LABEL`, `MARKER_COLOR`가 없으면 `./markers`에서 더 가져와요).

```ts
describe('새 매도 종류 표시', () => {
  it('라벨과 섞인 색을 쓴다', () => {
    expect(TRADE_LABEL.trail).toBe('트레일');
    expect(TRADE_LABEL.time).toBe('기간');
    expect(TRADE_LABEL.signalSell).toBe('조건');
    expect(MARKER_COLOR.trail).toEqual(['--t2', '#5b6069']);
    expect(MARKER_COLOR.time).toEqual(['--t2', '#5b6069']);
    expect(MARKER_COLOR.signalSell).toEqual(['--t2', '#5b6069']);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `TZ=America/New_York corepack pnpm vitest run src/lib/share/checkResult.test.ts src/lib/ui/simulate/markers.test.ts`
Expected: FAIL — 「단계 없음·손익 있음이면 통과」가 `code: 'invalid'`로 실패하고, 라벨 테스트가 `undefined`로 실패해요.

- [ ] **Step 3: 최소 구현**

`src/lib/sim/types.ts:60`:

```ts
  kind: 'buy' | 'add' | 'take' | 'stop' | 'gapStop' | 'gapTake' | 'trail' | 'time' | 'signalSell'; // 뒤 3종은 전략 빌더(트레일링·기간 청산·조건 매도)
```

`src/lib/share/resultEnums.ts:4-5`:

```ts
export const TRADE_KINDS = ['buy', 'add', 'take', 'stop', 'gapStop', 'gapTake', 'trail', 'time', 'signalSell'] as const;
export const SELL_KINDS = ['take', 'stop', 'gapStop', 'gapTake', 'trail', 'time', 'signalSell'] as const;
```

`src/lib/ui/simulate/markers.ts:8`:

```ts
export const TRADE_LABEL: Record<Trade['kind'], string> = {
  buy: '매수',
  add: '추가',
  take: '익절',
  gapTake: '익절',
  stop: '손절',
  gapStop: '손절',
  trail: '트레일',
  time: '기간',
  signalSell: '조건',
};
```

`src/lib/ui/simulate/markers.ts:16-23`의 `MARKER_COLOR`에 세 줄을 더하고 주석을 고쳐요.

```ts
// 매수 = 강조색, 익절 = 상승색, 손절 = 하락색, 트레일링·기간 청산·조건 매도 = 손익 방향이 정해지지 않아 섞인 색
export const MARKER_COLOR: Record<Trade['kind'], ColorToken> = {
  buy: ACCENT,
  add: ACCENT,
  take: UP,
  gapTake: UP,
  stop: DOWN,
  gapStop: DOWN,
  trail: MIXED_COLOR,
  time: MIXED_COLOR,
  signalSell: MIXED_COLOR,
};
```

`checkResult.ts`는 고치지 않아요. `SELL_KINDS`에 들면 손익 필수, `take`·`gapTake`만 단계 필수라는 지금 규칙이 그대로 맞아요.

- [ ] **Step 4: 통과 확인**

Run: `TZ=America/New_York corepack pnpm vitest run src/lib/share/checkResult.test.ts src/lib/ui/simulate/markers.test.ts src/lib/share/resultEnums.test.ts && corepack pnpm check`
Expected: PASS. `resultEnums.test.ts`의 `Same<(typeof TRADE_KINDS)[number], Trade['kind']>`·`SELL_KINDS` 대조가 통과하고, svelte-check 오류 0이에요.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/sim/types.ts src/lib/share/resultEnums.ts src/lib/ui/simulate/markers.ts src/lib/share/checkResult.test.ts src/lib/ui/simulate/markers.test.ts
git commit -m "feat(simulate): 새 매도 체결 종류 3종을 타입·결과 검사·마커에 더함"
```

---

### Task 2: `StrategyV2` 타입과 `sanitizeStrategiesV2`

**Files:**
- Create: `src/lib/sim/strategyV2.ts`
- Create: `src/lib/sim/testStrategyV2.ts`
- Test: `src/lib/sim/strategyV2.test.ts`

**Interfaces:**
- Consumes: `sanitizeStrategies(raw: unknown, now?: number): { strategies: Strategy[]; repaired: boolean }`, `sanitizeEntry(raw: unknown, now: number): { entry: Strategy['entry']; repaired: boolean }` (`src/lib/sim/validate.ts`), `MAX_STRATEGIES`(`src/lib/sim/defaults.ts`), `StopBasis`·`Strategy`(`src/lib/sim/types.ts`)
- Produces:
  - `export type PatternEntry = Strategy['entry']`
  - `export type Cond`, `export interface CondGroup { conds: Cond[] }`, `export type SizingMode`, `export interface StrategyV2`
  - `export const MAX_GROUPS = 4`, `export const MAX_CONDS = 5`
  - `export function defaultCond<K extends Cond['kind']>(kind: K, now?: number): Extract<Cond, { kind: K }>`
  - `export function sanitizeStrategiesV2(raw: unknown, now?: number): { strategies: StrategyV2[]; repaired: boolean }`
  - 테스트 전용 `export function fullStrategyV2(): StrategyV2`(`testStrategyV2.ts`)

- [ ] **Step 1: 테스트 고정 입력 쓰기** — `src/lib/sim/testStrategyV2.ts`

```ts
// 테스트 전용: 묶음·조건을 한도까지 채운 v2 전략(전략 빌더 스펙 §3). 정리(sanitizeStrategiesV2)를 거쳐도 그대로여야 한다.
import { sanitizeEntry } from './validate';
import type { Cond, StrategyV2 } from './strategyV2';

const BUY_FIRST: Cond[] = [
  { kind: 'pattern', entry: sanitizeEntry(undefined, 0).entry },
  { kind: 'maPrice', period: 120, side: 'above' },
  { kind: 'rsi', period: 14, level: 30, op: 'crossUp' },
  { kind: 'volume', days: 20, ratio: 1.5 },
  { kind: 'change', days: 5, pct: -10, op: 'below' },
];
const OTHERS: Cond[] = [
  { kind: 'maCross', short: 20, long: 60, dir: 'golden' },
  { kind: 'fromHigh', days: 60, pct: 20 },
  { kind: 'newHigh', days: 60 },
  { kind: 'rsi', period: 14, level: 70, op: 'below' },
  { kind: 'maPrice', period: 20, side: 'below' },
];
const group = (conds: Cond[]) => ({ conds: structuredClone(conds) });

export function fullStrategyV2(): StrategyV2 {
  return {
    v: 2,
    id: 's2',
    name: '골든크로스 추세',
    updatedAt: 1,
    universe: { kind: 'group', groupId: 'g0' },
    period: { from: '2023-10-31', to: '2026-10-31' },
    capital: { initial: 10_000_000 },
    sizing: { mode: 'equityPct', pct: 10 },
    rules: {
      buy: [group(BUY_FIRST), group(OTHERS), group(OTHERS), group(OTHERS)],
      sell: {
        takeProfit: { on: true, stages: [{ pct: 10, sellPct: 50 }, { pct: 20, sellPct: 100 }], afterFirstTake: 'breakeven' },
        stopLoss: { on: true, pct: 7, basis: 'avgAlways' },
        trailing: { on: true, pct: 10 },
        timeExit: { on: true, days: 20 },
        signal: { on: true, groups: [group(OTHERS), group(OTHERS), group(OTHERS), group(OTHERS)] },
      },
    },
    scaleIn: { on: true, stepPct: 3, maxAdds: 2 },
    benchmarks: { index: 'KOSPI', symbol: '069500' },
    costs: { feePct: 0.015 },
  };
}
```

- [ ] **Step 2: 실패 테스트 쓰기** — `src/lib/sim/strategyV2.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { exceedsDepth, findForbidden } from '../sync/forbidden';
import { defaultCond, MAX_CONDS, MAX_GROUPS, sanitizeStrategiesV2 } from './strategyV2';
import { fullStrategyV2 } from './testStrategyV2';

const NOW = Date.UTC(2026, 10, 1);
const one = (s: unknown) => sanitizeStrategiesV2({ strategies: [s] }, NOW);

describe('sanitizeStrategiesV2', () => {
  it('한도까지 채운 전략은 그대로 통과한다(고침 없음)', () => {
    const s = fullStrategyV2();
    expect(one(s)).toEqual({ strategies: [s], repaired: false });
  });

  it('범위를 넘는 값은 기본값으로 바꾸고 repaired', () => {
    const s = fullStrategyV2() as any;
    s.rules.sell.trailing.pct = 80;
    s.rules.buy[1].conds[0].short = 1;
    s.sizing.mode = 'all';
    const r = one(s);
    expect(r.repaired).toBe(true);
    expect(r.strategies[0].rules.sell.trailing.pct).toBe(10);
    expect((r.strategies[0].rules.buy[1].conds[0] as { short: number }).short).toBe(20);
    expect(r.strategies[0].sizing.mode).toBe('fixed');
  });

  it('모르는 kind와 매도 묶음의 pattern은 버리고 repaired, 빈 묶음은 남긴다', () => {
    const s = fullStrategyV2() as any;
    s.rules.buy[1].conds = [{ kind: 'sell' }];
    s.rules.sell.signal.groups[0].conds = [{ kind: 'pattern', entry: {} }];
    const r = one(s);
    expect(r.repaired).toBe(true);
    expect(r.strategies[0].rules.buy[1].conds).toEqual([]);
    expect(r.strategies[0].rules.sell.signal.groups[0].conds).toEqual([]);
    expect(r.strategies[0].rules.buy).toHaveLength(4);
  });

  it('묶음·조건 한도를 넘으면 잘라내고 repaired', () => {
    const s = fullStrategyV2() as any;
    s.rules.buy.push({ conds: [] });
    s.rules.buy[0].conds.push({ kind: 'newHigh', days: 20 });
    const r = one(s);
    expect(r.repaired).toBe(true);
    expect(r.strategies[0].rules.buy).toHaveLength(MAX_GROUPS);
    expect(r.strategies[0].rules.buy[0].conds).toHaveLength(MAX_CONDS);
  });

  it('패턴 블록 개수는 고치지 않는다(실행 조건은 경고가 본다)', () => {
    const s = fullStrategyV2();
    s.rules.buy[1].conds[0] = structuredClone(s.rules.buy[0].conds[0]);
    expect(one(s)).toEqual({ strategies: [s], repaired: false });
  });

  it('v1 규칙을 그대로 쓴다: 마지막 익절 sellPct는 100으로 맞추고 repaired', () => {
    const s = fullStrategyV2();
    s.rules.sell.takeProfit.stages[1].sellPct = 60;
    const r = one(s);
    expect(r.repaired).toBe(true);
    expect(r.strategies[0].rules.sell.takeProfit.stages[1].sellPct).toBe(100);
  });

  it('id가 없으면 버리고, 같은 id는 하나만 남긴다', () => {
    const s = fullStrategyV2();
    expect(sanitizeStrategiesV2({ strategies: [{ ...s, id: '' }, s, s] }, NOW)).toMatchObject({ repaired: true, strategies: [s] });
  });

  it('v가 2가 아니면 repaired(v 값은 2로)', () => {
    const r = one({ ...fullStrategyV2(), v: 1 });
    expect(r.repaired).toBe(true);
    expect(r.strategies[0].v).toBe(2);
  });

  it('defaultCond가 정리 기본값과 같다', () => {
    const s = fullStrategyV2() as any;
    s.rules.buy[1].conds = [{ kind: 'rsi', period: 0, level: 0, op: 'x' }];
    expect(one(s).strategies[0].rules.buy[1].conds[0]).toEqual(defaultCond('rsi'));
  });

  it('새 키는 금지 키에 걸리지 않고 깊이 한도 안이다', () => {
    const doc = { strategies: [fullStrategyV2()] };
    expect(findForbidden(doc)).toBeNull();
    expect(exceedsDepth(doc)).toBe(false);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `TZ=America/New_York corepack pnpm vitest run src/lib/sim/strategyV2.test.ts`
Expected: FAIL — `Failed to resolve import "./strategyV2"`.

- [ ] **Step 4: 구현** — `src/lib/sim/strategyV2.ts`

```ts
// 전략 v2 형식과 읽기 검증(전략 빌더 스펙 §3). PR①에서는 서버 검사(dto·snapshot)만 쓴다. 앱은 아직 v1(types.ts의 Strategy)을 쓴다.
// Worker 번들에 들어가니 DOM·저장소·import.meta.env를 쓰지 않는다.
// 종목·기간·자금·분할 매수·익절 단계·손절·비교·비용은 v1 검증(sanitizeStrategies)을 그대로 빌려 규칙이 갈라지지 않게 한다.
import { MAX_STRATEGIES } from './defaults';
import type { StopBasis, Strategy } from './types';
import { sanitizeEntry, sanitizeStrategies } from './validate';

export type PatternEntry = Strategy['entry'];

export type Cond =
  | { kind: 'maPrice'; period: number; side: 'above' | 'below' }
  | { kind: 'maCross'; short: number; long: number; dir: 'golden' | 'dead' }
  | { kind: 'rsi'; period: number; level: number; op: 'above' | 'below' | 'crossUp' | 'crossDown' }
  | { kind: 'volume'; days: number; ratio: number }
  | { kind: 'change'; days: number; pct: number; op: 'above' | 'below' }
  | { kind: 'fromHigh'; days: number; pct: number }
  | { kind: 'newHigh'; days: number }
  | { kind: 'pattern'; entry: PatternEntry };

export interface CondGroup {
  conds: Cond[];
}

export type SizingMode = 'fixed' | 'equityPct' | 'cashPct' | 'equal';

export interface StrategyV2 {
  v: 2;
  id: string;
  name: string;
  updatedAt: number;
  universe: Strategy['universe'];
  period: Strategy['period'];
  capital: { initial: number };
  sizing: { mode: SizingMode; pct: number };
  rules: {
    buy: CondGroup[];
    sell: {
      takeProfit: { on: boolean; stages: { pct: number; sellPct: number }[]; afterFirstTake: 'keep' | 'breakeven' };
      stopLoss: { on: boolean; pct: number; basis: StopBasis };
      trailing: { on: boolean; pct: number };
      timeExit: { on: boolean; days: number };
      signal: { on: boolean; groups: CondGroup[] };
    };
  };
  scaleIn: Strategy['scaleIn'];
  benchmarks: Strategy['benchmarks'];
  costs: Strategy['costs'];
}

export const MAX_GROUPS = 4;
export const MAX_CONDS = 5;
const SIZING_MODES: readonly SizingMode[] = ['fixed', 'equityPct', 'cashPct', 'equal'];
const SIDES = ['above', 'below'] as const;
const DIRS = ['golden', 'dead'] as const;
const RSI_OPS = ['above', 'below', 'crossUp', 'crossDown'] as const;

type Row = Record<string, unknown>;
const isRecord = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 한 전략을 고치는 동안의 상태. 없는 필드는 조용히 기본값, 있는데 틀린 것만 repaired로 센다(v1과 같은 규칙). */
interface Ctx {
  repaired: boolean;
  now: number;
}

function pick<T>(ctx: Ctx, v: unknown, def: T, ok: (x: unknown) => boolean): T {
  if (ok(v)) return v as T;
  if (v !== undefined) ctx.repaired = true;
  return def;
}
const rec = (ctx: Ctx, v: unknown): Row => {
  if (isRecord(v)) return v;
  if (v !== undefined) ctx.repaired = true;
  return {};
};
const int = (ctx: Ctx, v: unknown, def: number, min: number, max: number) =>
  pick(ctx, v, def, (x) => Number.isInteger(x) && (x as number) >= min && (x as number) <= max);
const num = (ctx: Ctx, v: unknown, def: number, min: number, max: number) =>
  pick(ctx, v, def, (x) => typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max);
const bool = (ctx: Ctx, v: unknown, def: boolean) => pick(ctx, v, def, (x) => typeof x === 'boolean');
const oneOf = <T extends string>(ctx: Ctx, v: unknown, def: T, list: readonly T[]) => pick(ctx, v, def, (x) => list.includes(x as T));

/** 종류별 기본 조건. 편집 화면(PR②)이 종류를 바꿀 때와 정리의 기본값이 같은 값을 쓴다. pattern의 entry는 기본 반등 패턴 */
export function defaultCond<K extends Cond['kind']>(kind: K, now = 0): Extract<Cond, { kind: K }> {
  const all: { [P in Cond['kind']]: Extract<Cond, { kind: P }> } = {
    maPrice: { kind: 'maPrice', period: 20, side: 'above' },
    maCross: { kind: 'maCross', short: 20, long: 60, dir: 'golden' },
    rsi: { kind: 'rsi', period: 14, level: 30, op: 'crossUp' },
    volume: { kind: 'volume', days: 20, ratio: 1.5 },
    change: { kind: 'change', days: 5, pct: 10, op: 'above' },
    fromHigh: { kind: 'fromHigh', days: 60, pct: 20 },
    newHigh: { kind: 'newHigh', days: 60 },
    pattern: { kind: 'pattern', entry: sanitizeEntry(undefined, now).entry },
  };
  return all[kind];
}

/** 조건 하나. 모르는 kind, 매도 쪽 pattern은 null(버림, repaired). 기본값은 defaultCond */
function sanitizeCond(ctx: Ctx, raw: unknown, allowPattern: boolean): Cond | null {
  if (!isRecord(raw)) {
    ctx.repaired = true;
    return null;
  }
  switch (raw.kind) {
    case 'maPrice': {
      const d = defaultCond('maPrice');
      return { kind: 'maPrice', period: int(ctx, raw.period, d.period, 2, 250), side: oneOf(ctx, raw.side, d.side, SIDES) };
    }
    case 'maCross': {
      const d = defaultCond('maCross');
      return { kind: 'maCross', short: int(ctx, raw.short, d.short, 2, 250), long: int(ctx, raw.long, d.long, 2, 250), dir: oneOf(ctx, raw.dir, d.dir, DIRS) };
    }
    case 'rsi': {
      const d = defaultCond('rsi');
      return { kind: 'rsi', period: int(ctx, raw.period, d.period, 2, 50), level: num(ctx, raw.level, d.level, 1, 99), op: oneOf(ctx, raw.op, d.op, RSI_OPS) };
    }
    case 'volume': {
      const d = defaultCond('volume');
      return { kind: 'volume', days: int(ctx, raw.days, d.days, 2, 120), ratio: num(ctx, raw.ratio, d.ratio, 1, 20) };
    }
    case 'change': {
      const d = defaultCond('change');
      return { kind: 'change', days: int(ctx, raw.days, d.days, 1, 250), pct: num(ctx, raw.pct, d.pct, -90, 500), op: oneOf(ctx, raw.op, d.op, SIDES) };
    }
    case 'fromHigh': {
      const d = defaultCond('fromHigh');
      return { kind: 'fromHigh', days: int(ctx, raw.days, d.days, 2, 250), pct: num(ctx, raw.pct, d.pct, 1, 90) };
    }
    case 'newHigh':
      return { kind: 'newHigh', days: int(ctx, raw.days, defaultCond('newHigh').days, 2, 250) };
    case 'pattern': {
      if (!allowPattern) {
        ctx.repaired = true;
        return null;
      }
      const r = sanitizeEntry(raw.entry, ctx.now);
      if (r.repaired) ctx.repaired = true;
      return { kind: 'pattern', entry: r.entry };
    }
    default:
      ctx.repaired = true;
      return null;
  }
}

/** 묶음 목록. 한도를 넘으면 자르고, 모양이 틀린 묶음은 버린다. 빈 묶음은 남긴다(편집 중 정상 상태, 실행은 경고가 막는다). */
function sanitizeGroups(ctx: Ctx, raw: unknown, allowPattern: boolean, def: () => CondGroup[]): CondGroup[] {
  if (raw === undefined) return def();
  if (!Array.isArray(raw)) {
    ctx.repaired = true;
    return def();
  }
  if (raw.length > MAX_GROUPS) ctx.repaired = true;
  const out: CondGroup[] = [];
  for (const g of raw.slice(0, MAX_GROUPS)) {
    if (!isRecord(g) || !Array.isArray(g.conds)) {
      ctx.repaired = true;
      continue;
    }
    if (g.conds.length > MAX_CONDS) ctx.repaired = true;
    const conds: Cond[] = [];
    for (const c of g.conds.slice(0, MAX_CONDS)) {
      const cond = sanitizeCond(ctx, c, allowPattern);
      if (cond) conds.push(cond);
    }
    out.push({ conds });
  }
  return out;
}

function sanitizeOneV2(raw: Row, now: number): { strategy: StrategyV2; repaired: boolean } | null {
  const ctx: Ctx = { repaired: false, now };
  const rules = rec(ctx, raw.rules);
  const sell = rec(ctx, rules.sell);
  const tp = rec(ctx, sell.takeProfit);
  const sl = rec(ctx, sell.stopLoss);
  const tr = rec(ctx, sell.trailing);
  const te = rec(ctx, sell.timeExit);
  const sg = rec(ctx, sell.signal);
  const sizing = rec(ctx, raw.sizing);
  const cap = rec(ctx, raw.capital);

  // 공통 필드는 v1 모양으로 옮겨 v1 검증을 그대로 쓴다. undefined는 v1에서도 「없는 필드」(조용히 기본값)다
  const v1 = sanitizeStrategies(
    {
      strategies: [
        {
          id: raw.id,
          name: raw.name,
          updatedAt: raw.updatedAt,
          universe: raw.universe,
          period: raw.period,
          capital: { initial: cap.initial, perBuyPct: sizing.pct },
          scaleIn: raw.scaleIn,
          exit: { takeProfit: tp.stages, stopLoss: { pct: sl.pct, basis: sl.basis }, afterFirstTake: tp.afterFirstTake },
          benchmarks: raw.benchmarks,
          costs: raw.costs,
        },
      ],
    },
    now,
  );
  const b = v1.strategies[0];
  if (!b) return null;
  if (v1.repaired) ctx.repaired = true;
  if (raw.v !== 2) ctx.repaired = true;

  const defaultBuy = (): CondGroup[] => [{ conds: [defaultCond('pattern', now)] }];
  const strategy: StrategyV2 = {
    v: 2,
    id: b.id,
    name: b.name,
    updatedAt: b.updatedAt,
    universe: b.universe,
    period: b.period,
    capital: { initial: b.capital.initial },
    sizing: { mode: oneOf(ctx, sizing.mode, 'fixed', SIZING_MODES), pct: b.capital.perBuyPct },
    rules: {
      buy: sanitizeGroups(ctx, rules.buy, true, defaultBuy),
      sell: {
        takeProfit: { on: bool(ctx, tp.on, true), stages: b.exit.takeProfit, afterFirstTake: b.exit.afterFirstTake },
        stopLoss: { on: bool(ctx, sl.on, true), pct: b.exit.stopLoss.pct, basis: b.exit.stopLoss.basis },
        trailing: { on: bool(ctx, tr.on, false), pct: num(ctx, tr.pct, 10, 1, 50) },
        timeExit: { on: bool(ctx, te.on, false), days: int(ctx, te.days, 20, 1, 250) },
        signal: { on: bool(ctx, sg.on, false), groups: sanitizeGroups(ctx, sg.groups, false, () => []) },
      },
    },
    scaleIn: b.scaleIn,
    benchmarks: b.benchmarks,
    costs: b.costs,
  };
  return { strategy, repaired: ctx.repaired };
}

/**
 * `{ strategies: [...] }`의 v2 전략 목록을 고친다. 규칙은 sanitizeStrategies(v1)와 같다:
 * 필수 필드(id·name)가 틀린 항목과 id가 겹치는 항목은 버리고, MAX_STRATEGIES개까지만 남긴다.
 */
export function sanitizeStrategiesV2(raw: unknown, now = Date.now()): { strategies: StrategyV2[]; repaired: boolean } {
  if (!isRecord(raw) || !Array.isArray(raw.strategies))
    return { strategies: [], repaired: isRecord(raw) ? raw.strategies !== undefined : raw !== undefined && raw !== null };
  const strategies: StrategyV2[] = [];
  const ids = new Set<string>();
  let repaired = false;
  for (const item of raw.strategies) {
    const r = isRecord(item) ? sanitizeOneV2(item, now) : null;
    if (!r || ids.has(r.strategy.id) || strategies.length >= MAX_STRATEGIES) {
      repaired = true;
      continue;
    }
    ids.add(r.strategy.id);
    strategies.push(r.strategy);
    if (r.repaired) repaired = true;
  }
  return { strategies, repaired };
}
```

- [ ] **Step 5: 통과 확인**

Run: `TZ=America/New_York corepack pnpm vitest run src/lib/sim/strategyV2.test.ts && corepack pnpm check`
Expected: PASS(10개). svelte-check 오류 0.

- [ ] **Step 6: 커밋**

```bash
git add src/lib/sim/strategyV2.ts src/lib/sim/testStrategyV2.ts src/lib/sim/strategyV2.test.ts
git commit -m "feat(simulate): 전략 v2 타입과 읽기 검증을 더함(앱은 아직 v1)"
```

---

### Task 3: `checkProfileDoc`이 v1·v2를 판정

**Files:**
- Modify: `src/lib/sync/dto.ts:1-34`, `:78-109`
- Test: `src/lib/sync/dto.test.ts:129`와 새 `describe`

**Interfaces:**
- Consumes: `sanitizeStrategiesV2`, `StrategyV2`(Task 2)
- Produces:
  - `export const PROFILE_DOC_VERSION = 1`(그대로), `export const PROFILE_DOC_MAX_VERSION = 2`, `export const APP_OUTDATED_CODE = '앱을 새로 고쳐 주세요'`
  - `export interface ProfileDocV2 extends Omit<ProfileDocV1, 'v' | 'strategies'> { v: 2; strategies: StrategyV2[] }`, `export type ProfileDoc = ProfileDocV1 | ProfileDocV2`
  - `export type DocError = 'invalid' | 'unknown-field' | 'forbidden-field' | 'too-large' | 'unsupported'`
  - `export type DocCheck = { ok: true; doc: ProfileDoc } | { ok: false; code: DocError; path?: string }`
  - `checkProfileDoc(raw: unknown, now?: number): DocCheck` — 통과하면 `doc`은 입력과 같은 객체(`toBe(raw)`)

- [ ] **Step 1: 실패 테스트 쓰기** — `src/lib/sync/dto.test.ts`

`:129` 줄을 아래로 바꿔요(v2는 이제 받는 버전이라 v1 전략을 담은 v2는 전략 검사에서 거절돼요).

```ts
    expect(checkProfileDoc({ ...validDoc(), v: 3 }, NOW)).toMatchObject({ code: 'unsupported', path: 'v' });
    expect(checkProfileDoc({ ...validDoc(), v: '1' }, NOW)).toMatchObject({ code: 'invalid', path: 'v' });
    expect(checkProfileDoc({ ...validDoc(), v: 0 }, NOW)).toMatchObject({ code: 'invalid', path: 'v' });
```

`:7`의 dto import를 합쳐 바꾸고, 고정 입력 import를 더해요.

```ts
import { APP_OUTDATED_CODE, checkProfileDoc, PROFILE_DOC_MAX_BYTES, PROFILE_DOC_MAX_VERSION, PROFILE_DOC_VERSION, type ProfileDocV1 } from './dto';
import { fullStrategyV2 } from '../sim/testStrategyV2';
```

파일 끝에 붙여요.

```ts
describe('checkProfileDoc v1·v2(전략 빌더 §8.3)', () => {
  const v2Doc = () => ({ ...validDoc(), v: 2 as const, strategies: [fullStrategyV2()] });

  it('앱이 만드는 버전은 1 그대로, 받는 최대는 2', () => {
    expect(PROFILE_DOC_VERSION).toBe(1);
    expect(PROFILE_DOC_MAX_VERSION).toBe(2);
    expect(APP_OUTDATED_CODE).toBe('앱을 새로 고쳐 주세요');
  });

  it('v1 문서는 지금처럼 통과하고 원본을 돌려준다', () => {
    const d = validDoc();
    const r = checkProfileDoc(d, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc).toBe(d);
  });

  it('v2 문서는 v2 검증으로 통과하고 원본을 돌려준다', () => {
    const d = v2Doc();
    const r = checkProfileDoc(d, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc).toBe(d);
  });

  it('v2 문서에 v1 전략이 섞이면 거절한다', () => {
    const d = { ...v2Doc(), strategies: validDoc().strategies };
    expect(checkProfileDoc(d, NOW)).toMatchObject({ ok: false, code: 'unknown-field' });
  });

  it('v1 문서에 v2 전략이 섞이면 거절한다', () => {
    const d = { ...validDoc(), strategies: [fullStrategyV2()] };
    expect(checkProfileDoc(d, NOW)).toMatchObject({ ok: false });
  });

  it('v2 전략의 고칠 값·모르는 필드를 거절한다', () => {
    const bad = v2Doc();
    bad.strategies[0].rules.sell.trailing.pct = 80;
    expect(checkProfileDoc(bad, NOW)).toMatchObject({ code: 'invalid', path: 'strategies[0].rules.sell.trailing.pct' });
    const extra = v2Doc();
    (extra.strategies[0].rules.buy[0].conds[1] as unknown as Record<string, unknown>).note = 'x';
    expect(checkProfileDoc(extra, NOW)).toMatchObject({ code: 'unknown-field', path: 'strategies[0].rules.buy[0].conds[1].note' });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `TZ=America/New_York corepack pnpm vitest run src/lib/sync/dto.test.ts`
Expected: FAIL — `APP_OUTDATED_CODE`·`PROFILE_DOC_MAX_VERSION`이 `undefined`, v3가 `invalid`로 나와 `unsupported` 기대가 실패, v2 문서가 `invalid`(`v`)로 실패해요.

- [ ] **Step 3: 구현** — `src/lib/sync/dto.ts`

import에 더해요(`:7` 아래).

```ts
import { sanitizeStrategiesV2, type StrategyV2 } from '../sim/strategyV2';
```

`:14`를 아래로 바꿔요.

```ts
/** 앱이 만드는 문서 버전. 전략 빌더 PR②에서 2로 올린다 */
export const PROFILE_DOC_VERSION = 1;
/** 받는 문서의 가장 높은 버전(전략 빌더 §8.3). 이보다 높으면 unsupported */
export const PROFILE_DOC_MAX_VERSION = 2;
/** 옛 앱에 v2 문서를 주거나 받지 않을 때의 422 코드. 옛 앱 SyncPanel이 코드를 괄호에 그대로 보여서 문장으로 둔다 */
export const APP_OUTDATED_CODE = '앱을 새로 고쳐 주세요';
```

`:31` 뒤(`ProfileDocV1` 바로 아래)에 더하고 `:33-34`를 바꿔요.

```ts
/** 전략 v2(전략 빌더)를 담은 문서. 나머지 필드는 v1과 같다 */
export interface ProfileDocV2 extends Omit<ProfileDocV1, 'v' | 'strategies'> {
  v: 2;
  strategies: StrategyV2[];
}
export type ProfileDoc = ProfileDocV1 | ProfileDocV2;

export type DocError = 'invalid' | 'unknown-field' | 'forbidden-field' | 'too-large' | 'unsupported';
export type DocCheck = { ok: true; doc: ProfileDoc } | { ok: false; code: DocError; path?: string };
```

`:85` 한 줄을 아래로 바꿔요.

```ts
  const v = raw.v;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) return fail('invalid', 'v');
  if (v > PROFILE_DOC_MAX_VERSION) return fail('unsupported', 'v');
```

`:99-103`의 전략 줄을 바꿔요.

```ts
  for (const [key, cleaned] of [
    ['strategies', v === 1 ? sanitizeStrategies({ strategies: raw.strategies }, now).strategies : sanitizeStrategiesV2({ strategies: raw.strategies }, now).strategies],
    ['criteria', sanitizeCriteria({ criteria: raw.criteria }, now).criteria],
    ['baskets', sanitizeBaskets({ baskets: raw.baskets }).baskets],
  ] as const) {
```

`:108`을 바꿔요.

```ts
  return { ok: true, doc: raw as unknown as ProfileDoc }; // 입력 원본을 돌려준다(Worker는 이것을 저장한다)
```

`:74-77`의 함수 주석 끝에 한 줄을 더해요: `* v가 1이면 v1 전략, 2면 v2 전략으로 검사한다. 앱은 아직 v1만 만든다.`

- [ ] **Step 4: 통과 확인**

Run: `TZ=America/New_York corepack pnpm vitest run src/lib/sync && corepack pnpm check && (cd sync-worker && npx tsc -p tsconfig.json --noEmit)`
Expected: PASS. Worker 타입 검사도 통과해요(`checked.doc`은 `JSON.stringify`에만 쓰여요).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/sync/dto.ts src/lib/sync/dto.test.ts
git commit -m "feat(sync): 프로필 문서 검사가 v1·v2 전략을 판정함"
```

---

### Task 4: `checkShareSnapshot` 종류별 버전 판정

**Files:**
- Modify: `src/lib/share/snapshot.ts:13`, `:23`, `:319-331`, `:367-377`, `:386-392`, `:413-423`
- Test: `src/lib/share/snapshot.test.ts:121`와 새 `describe`

**Interfaces:**
- Consumes: `sanitizeStrategiesV2`(Task 2), `fullStrategyV2`(테스트), `simResultFixture`·`NOW`(`src/lib/share/testFixtures.ts`)
- Produces:
  - `export const SHARE_VERSION = 1`(그대로, 만드는 버전)
  - `export const STRATEGY_SHARE_MAX_VERSION = 2`
  - `checkStrategyPart(s: unknown, title: string, now: number, mode: CheckMode, v?: 1 | 2): { ok: true; strategy: Strategy | StrategyV2 } | PartFail` — `v = 2`면 `sanitizeStrategiesV2`로 검사해요. 이 파일 밖 호출처는 없어요(`grep -rn checkStrategyPart src sync-worker/src`로 확인).
  - 공개 스냅샷 타입(`StrategySnapshot` 등)은 바꾸지 않아요. 결과를 담는 자리는 지금처럼 `as unknown as StrategySnapshot` 한 번뿐이에요(create는 원본 `raw`, read는 v1만). Worker는 JSON으로만 저장해요.

- [ ] **Step 1: 실패 테스트 쓰기** — `src/lib/share/snapshot.test.ts`

`:121`을 바꿔요.

```ts
    expect(checkShareSnapshot({ ...s, v: 2 }, 'group', NOW)).toMatchObject({ code: 'unsupported', path: 'v' });
    expect(checkShareSnapshot({ ...s, v: '1' }, 'group', NOW)).toMatchObject({ code: 'invalid', path: 'v' });
```

파일 위 import에 더해요.

```ts
import { fullStrategyV2 } from '../sim/testStrategyV2';
import { simResultFixture, NOW as FIX_NOW } from './testFixtures';
```

파일 끝에 붙여요.

```ts
describe('전략 공유 v2(전략 빌더 §8.4, PR①)', () => {
  const v2Strategy = (title: string, symbols: string[]) => ({
    ...fullStrategyV2(),
    id: 'shared',
    name: title,
    updatedAt: 0,
    universe: { kind: 'symbols' as const, symbols },
  });
  const strategyV2Snap = () => ({ kind: 'strategy', v: 2, title: '골든크로스', strategy: v2Strategy('골든크로스', ['005930', '000660']), capitalHidden: false });
  const simResultV2Snap = () => {
    const f = simResultFixture();
    return { ...f, v: 2, strategy: { ...v2Strategy(f.title, (f.strategy.universe as { symbols: string[] }).symbols), benchmarks: f.strategy.benchmarks } };
  };

  it('create: v2 전략 공유를 받고 원본을 돌려준다', () => {
    const raw = strategyV2Snap();
    const r = checkShareSnapshot(raw, 'strategy', NOW, 'create');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.snapshot).toEqual(raw);
  });

  it('create: v2 시뮬레이션 결과 공유를 받고 원본을 돌려준다', () => {
    const raw = simResultV2Snap();
    const r = checkShareSnapshot(raw, 'simResult', FIX_NOW, 'create');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.snapshot).toEqual(raw);
  });

  it('create: v1 전략 공유는 지금처럼 받는다', () => {
    const raw = strategySnapshot(newStrategy(NOW, null, '눌림목'), w, { hideCapital: false, now: NOW });
    expect(checkShareSnapshot(raw, 'strategy', NOW, 'create')).toMatchObject({ ok: true });
  });

  it('read: v2는 unsupported(PR① 앱은 v1만 그린다), v1은 v1 그대로', () => {
    expect(checkShareSnapshot(strategyV2Snap(), 'strategy', NOW, 'read')).toMatchObject({ ok: false, code: 'unsupported', path: 'v' });
    expect(checkShareSnapshot(simResultV2Snap(), 'simResult', FIX_NOW, 'read')).toMatchObject({ ok: false, code: 'unsupported', path: 'v' });
    const v1 = strategySnapshot(newStrategy(NOW, null, '눌림목'), w, { hideCapital: false, now: NOW });
    const r = checkShareSnapshot(v1, 'strategy', NOW, 'read');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.snapshot.v).toBe(1);
  });

  it('create: v3는 unsupported, v2 전략에 고칠 값이 있으면 invalid', () => {
    expect(checkShareSnapshot({ ...strategyV2Snap(), v: 3 }, 'strategy', NOW, 'create')).toMatchObject({ code: 'unsupported', path: 'v' });
    const bad = strategyV2Snap();
    bad.strategy.rules.sell.timeExit.days = 0;
    expect(checkShareSnapshot(bad, 'strategy', NOW, 'create')).toMatchObject({ code: 'invalid', path: 'strategy.rules.sell.timeExit.days' });
  });

  it('create: 기준 공유는 v1만 받는다', () => {
    const c = criteriaSnapshot(newCriteria(NOW, null), { baskets: [], strategies: [] }, { hideCapital: false, now: NOW });
    expect(checkShareSnapshot({ ...c, v: 2 }, 'criteria', NOW, 'create')).toMatchObject({ code: 'unsupported', path: 'v' });
  });
});
```

`w`는 이 파일에 이미 있는 `Watchlists` 고정값(파일 위 `const w`)이에요. 없으면 `const w: Watchlists = { groups: [] };`를 이 `describe` 안에 둬요.

- [ ] **Step 2: 실패 확인**

Run: `TZ=America/New_York corepack pnpm vitest run src/lib/share/snapshot.test.ts`
Expected: FAIL — v2 create가 `invalid`(`v`)로, group v2가 `invalid`로 나와 `unsupported` 기대가 실패해요.

- [ ] **Step 3: 구현** — `src/lib/share/snapshot.ts`

`:13` import 아래에 더해요.

```ts
import { sanitizeStrategiesV2, type StrategyV2 } from '../sim/strategyV2';
```

`:23`을 바꿔요.

```ts
/** 만드는 공유 버전. 앱은 아직 1만 만든다(전략 빌더 PR②에서 strategy·simResult를 2로) */
export const SHARE_VERSION = 1;
/** strategy·simResult가 받는 가장 높은 버전. create 모드(서버 저장)만 2를 받고 read 모드는 1만 받는다(전략 빌더 §8.4) */
export const STRATEGY_SHARE_MAX_VERSION = 2;
```

`:319-331`의 `checkStrategyPart`를 바꿔요.

```ts
/** 전략 부분(strategy·simResult). 돌려주는 strategy는 정리 결과(read면 빠진 필드를 채운 값)다. v = 2면 v2 전략으로 검사한다(create 모드만 불린다). */
export function checkStrategyPart(s: unknown, title: string, now: number, mode: CheckMode, v: 1 | 2 = 1): { ok: true; strategy: Strategy | StrategyV2 } | PartFail {
  if (!isRecord(s) || s.id !== SHARED_ID || s.name !== title || s.updatedAt !== 0) return fail('invalid', 'strategy');
  if (!isRecord(s.universe) || s.universe.kind !== 'symbols') return fail('reference', 'strategy.universe');
  // v2는 PR①에서 서버 저장용(create)으로만 받는다. universe·benchmarks는 두 형식이 같은 모양이다
  const cleaned: Strategy | StrategyV2 | undefined =
    v === 2 ? sanitizeStrategiesV2({ strategies: [s] }, now).strategies[0] : sanitizeStrategies({ strategies: [s] }, now).strategies[0];
  if (!cleaned) return fail('invalid', 'strategy');
  const diff = sameAs(s, cleaned, 'strategy', mode);
  if (diff) return diff;
  // 가져오면 받은 사람 키로 보내는 시세 요청에 들어가는 값이라 공유 경로에서만 코드 모양을 본다(정리 함수는 바꾸지 않는다)
  const u = cleaned.universe;
  if (u.kind !== 'symbols' || !symbolsOk(u.symbols, 0, Infinity)) return fail('invalid', 'strategy.universe.symbols');
  if (cleaned.benchmarks.symbol !== null && !isShareSymbol(cleaned.benchmarks.symbol)) return fail('invalid', 'strategy.benchmarks.symbol');
  return { ok: true, strategy: cleaned };
}
```

`:376` 한 줄(`if (raw.v !== SHARE_VERSION) return fail('invalid', 'v');`)을 아래로 바꿔요.

```ts
  // 버전: 1 이상의 정수. strategy·simResult는 create에서만 2까지, 나머지 종류와 read는 1까지(전략 빌더 §8.4)
  if (typeof raw.v !== 'number' || !Number.isInteger(raw.v) || raw.v < 1) return fail('invalid', 'v');
  const strategyKind = raw.kind === 'strategy' || raw.kind === 'simResult';
  const maxV = strategyKind && mode === 'create' ? STRATEGY_SHARE_MAX_VERSION : SHARE_VERSION;
  if (raw.v > maxV) return fail('unsupported', 'v');
  const sv = raw.v as 1 | 2;
```

`:386-392`의 `case 'strategy'`를 바꿔요.

```ts
    case 'strategy': {
      const k = exactKeys(raw, ['kind', 'v', 'title', 'strategy', 'capitalHidden'], '');
      if (k) return k;
      if (typeof raw.capitalHidden !== 'boolean') return fail('invalid', 'capitalHidden');
      const st = checkStrategyPart(raw.strategy, raw.title, now, mode, sv);
      if (!st.ok) return st;
      // create는 원본을 그대로 돌려준다(서버가 저장). read는 빠진 필드를 채운 값
      return { ok: true, snapshot: (mode === 'create' ? raw : { ...raw, strategy: st.strategy }) as unknown as StrategySnapshot };
    }
```

`:413-423`의 `case 'simResult'`에서 `checkStrategyPart` 호출과 마지막 `return`을 바꿔요.

```ts
      const st = checkStrategyPart(raw.strategy, raw.title, now, mode, sv);
```

```ts
      return { ok: true, snapshot: (mode === 'create' ? raw : { ...raw, strategy: st.strategy }) as unknown as SimResultSnapshot };
```

`:362-366`의 함수 주석에 한 줄을 더해요: `* create는 입력 원본을 돌려준다(Worker가 저장). strategy·simResult의 v2는 create에서만 받는다.`

- [ ] **Step 4: 통과 확인**

Run: `TZ=America/New_York corepack pnpm vitest run src/lib/share && corepack pnpm check`
Expected: PASS. 기존 공유 테스트(`compact.test.ts`·`pendingImport.test.ts` 등)도 통과해요. create에서 원본과 정리 결과는 `sameAs`로 같음을 이미 확인했으니 돌려주는 값이 바뀌지 않아요.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/share/snapshot.ts src/lib/share/snapshot.test.ts
git commit -m "feat(share): 전략 공유 검사가 create에서 v2를 받고 원본을 돌려줌"
```

---

### Task 5: `doc_v` 열과 PUT 다운그레이드 거절

**Files:**
- Create: `sync-worker/migrations/0004_doc_version.sql`
- Modify: `sync-worker/src/profiles.ts:1-8`(import), `:21`(`Head`), `:36-41`(`head`), `:60-66`(`rejected`), `:117-155`(`putProfile`), `:158-187`(`deleteProfile`의 `rejected` 호출)
- Modify: `sync-worker/test/docs.ts`
- Test: `sync-worker/src/profiles.test.ts`

**Interfaces:**
- Consumes: `APP_OUTDATED_CODE`, `ProfileDocV2`(Task 3), `fullStrategyV2`(Task 2)
- Produces:
  - `type Head = IndexRow & { lastOpId: string; docV: number }`(`listProfiles` 응답 모양 `IndexRow`는 그대로)
  - `rejected(env: SyncEnv, userId: string, profileId: string, incomingV: number | null, reqV: number): Promise<never>`
  - `putProfile(env, ctx, profileId, body, now, reqV = 1): Promise<{ revision: number }>`
  - `deleteProfile(env, ctx, profileId, body, now, reqV = 1)`
  - 테스트용 `docV2(name?: string): ProfileDocV2`(`sync-worker/test/docs.ts`)

- [ ] **Step 1: 테스트 도우미 더하기** — `sync-worker/test/docs.ts` 끝에

```ts
import type { ProfileDocV2 } from '../../src/lib/sync/dto';
import { fullStrategyV2 } from '../../src/lib/sim/testStrategyV2';

/** 전략 v2를 담은 문서(전략 빌더 PR①). 나머지는 doc()과 같다 */
export function docV2(name = '내 프로필'): ProfileDocV2 {
  const d = doc(name);
  return { ...d, v: 2, strategies: [{ ...fullStrategyV2(), id: 's1' }] };
}
```

(파일 위쪽 import 묶음에 두 import를 합쳐요.)

- [ ] **Step 2: 실패 테스트 쓰기** — `sync-worker/src/profiles.test.ts` 끝에

파일 위 import를 바꿔요: `import { doc, docV2 } from '../test/docs';`, `import { APP_OUTDATED_CODE } from '../../src/lib/sync/dto';`

```ts
describe('문서 버전(전략 빌더 §8.3, PR①)', () => {
  const docV = (h: ReturnType<typeof harness>) => (h.env.DB.raw.prepare("SELECT doc_v AS n FROM profile_index WHERE profile_id = 'p1'").get() as { n: number }).n;

  it('새로 만들기·갱신이 doc_v를 기록한다', async () => {
    const h = harness();
    const me = await h.login();
    await me.as('PUT', '/v1/profiles/p1', { opId: 'op-1', expectedRevision: 0, doc: doc() });
    expect(docV(h)).toBe(1);
    expect((await me.as('PUT', '/v1/profiles/p1', { opId: 'op-2', expectedRevision: 1, doc: docV2() })).status).toBe(200);
    expect(docV(h)).toBe(2);
  });

  it('마이그레이션 뒤 doc_v 없이 들어간 기존 행은 doc_v = 1이다', async () => {
    const h = harness();
    await h.login();
    const uid = (h.env.DB.raw.prepare('SELECT id FROM users LIMIT 1').get() as { id: string }).id;
    h.env.DB.raw
      .prepare('INSERT INTO profile_index (user_id, profile_id, revision, last_op_id, updated_at) VALUES (?, ?, 1, ?, ?)')
      .run(uid, 'old', 'op-old', 0);
    expect((h.env.DB.raw.prepare("SELECT doc_v AS n FROM profile_index WHERE profile_id = 'old'").get() as { n: number }).n).toBe(1);
  });

  it('v2 위에 v1을 올리면 422로 거절하고 서버는 그대로다', async () => {
    const h = harness();
    const me = await h.login();
    await me.as('PUT', '/v1/profiles/p1', { opId: 'op-1', expectedRevision: 0, doc: docV2() });
    expect(await j(await me.as('PUT', '/v1/profiles/p1', { opId: 'op-2', expectedRevision: 1, doc: doc('옛') }))).toEqual({
      status: 422,
      body: { error: APP_OUTDATED_CODE },
    });
    expect(docV(h)).toBe(2);
    expect(count(h, 'SELECT count(*) AS n FROM revisions')).toBe(1);
  });

  it('이미 있는 v2 프로필에 v1 새로 만들기도 422', async () => {
    const h = harness();
    const me = await h.login();
    await me.as('PUT', '/v1/profiles/p1', { opId: 'op-1', expectedRevision: 0, doc: docV2() });
    expect((await j(await me.as('PUT', '/v1/profiles/p1', { opId: 'op-2', expectedRevision: 0, doc: doc() }))).status).toBe(422);
  });

  it('검사와 갱신 사이에 다른 기기가 v2를 올려도 조건부 UPDATE가 막는다', async () => {
    // 아래 startsWith 문자열은 Step 5 putProfile의 UPDATE SQL 첫 줄과 글자까지 같아야 한다(구현 SQL을 계획 문자열과 같게 쓴다)
    const h = harness();
    const me = await h.login();
    await me.as('PUT', '/v1/profiles/p1', { opId: 'op-1', expectedRevision: 0, doc: doc() });
    const prepare = h.env.DB.prepare.bind(h.env.DB);
    h.env.DB.prepare = ((sql: string) => {
      if (sql.startsWith('UPDATE profile_index SET revision = ?, last_op_id = ?, updated_at = ?, doc_v')) h.env.DB.raw.prepare("UPDATE profile_index SET doc_v = 2 WHERE profile_id = 'p1'").run();
      return prepare(sql);
    }) as typeof h.env.DB.prepare;
    const r = await j(await me.as('PUT', '/v1/profiles/p1', { opId: 'op-2', expectedRevision: 1, doc: doc('A') }));
    h.env.DB.prepare = prepare;
    expect(r).toEqual({ status: 422, body: { error: APP_OUTDATED_CODE } });
  });

  it('반영된 같은 opId를 다시 보내면 버전 검사 전에 처음 결과를 돌려준다', async () => {
    const h = harness();
    const me = await h.login();
    const put = { opId: 'op-1', expectedRevision: 0, doc: doc() };
    await me.as('PUT', '/v1/profiles/p1', put);
    h.env.DB.raw.prepare("UPDATE profile_index SET doc_v = 2 WHERE profile_id = 'p1'").run();
    expect(await j(await me.as('PUT', '/v1/profiles/p1', put))).toEqual({ status: 200, body: { revision: 1 } });
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `cd sync-worker && npx vitest run src/profiles.test.ts`
Expected: FAIL — `no such column: doc_v`.

- [ ] **Step 4: 마이그레이션 쓰기** — `sync-worker/migrations/0004_doc_version.sql`

```sql
-- 전략 빌더 PR①: 저장된 프로필 문서의 버전(v). 지금 행은 모두 v1 문서라 기본값 1이 맞다.
-- Worker가 본문을 파싱하지 않고 옛 앱(버전 1)에 v2 문서를 주지 않거나, v2 위에 v1이 올라오는 것을 막는 데 쓴다.
ALTER TABLE profile_index ADD COLUMN doc_v INTEGER NOT NULL DEFAULT 1;
```

- [ ] **Step 5: 구현** — `sync-worker/src/profiles.ts`

`:3` import를 바꿔요.

```ts
import { APP_OUTDATED_CODE, checkProfileDoc } from '../../src/lib/sync/dto';
```

`:21`을 바꿔요.

```ts
type Head = IndexRow & { lastOpId: string; docV: number };
```

`:36-41`의 `head` SQL에 열을 더해요.

```ts
async function head(env: SyncEnv, userId: string, profileId: string): Promise<Head | null> {
  return env.DB.prepare(
    `SELECT profile_id AS profileId, revision, updated_at AS updatedAt, deleted_at AS deletedAt, purge_at AS purgeAt, last_op_id AS lastOpId, doc_v AS docV
     FROM profile_index WHERE user_id = ? AND profile_id = ?`,
  )
    .bind(userId, profileId)
    .first<Head>();
}
```

`:60-66`의 `rejected`를 바꿔요.

```ts
/**
 * 작업이 반영되지 않았을 때의 응답(전략 빌더 §8.3). 순서:
 * 머리 없음 410 → 삭제됨 410 → (들어온 문서가 있는 PUT만) 저장 버전 > 들어온 버전이면 422 → 409.
 * 409 본문의 doc은 저장 버전이 요청 버전보다 높으면 null(옛 앱에 v2를 주지 않는다).
 */
async function rejected(env: SyncEnv, userId: string, profileId: string, incomingV: number | null, reqV: number): Promise<never> {
  const h = await head(env, userId, profileId);
  if (!h) throw new HttpError(410, 'gone', { deletedAt: null, purgeAt: null });
  if (h.deletedAt !== null) throw new HttpError(410, 'gone', { deletedAt: h.deletedAt, purgeAt: h.purgeAt, revision: h.revision });
  if (incomingV !== null && h.docV > incomingV) throw new HttpError(422, APP_OUTDATED_CODE);
  throw new HttpError(409, 'conflict', { revision: h.revision, doc: h.docV > reqV ? null : await currentDoc(env, userId, profileId) });
}
```

`:117-155`의 `putProfile`을 바꿔요(순서: 검사 → `replayed()` → 조건부 갱신).

```ts
/** PUT: 새로 만들기(expectedRevision 0) 또는 조건부 갱신. 저장 버전보다 낮은 문서는 같은 문장 안에서 막는다(전략 빌더 §8.3). */
export async function putProfile(env: SyncEnv, ctx: AuthContext, profileId: string, body: unknown, now: number, reqV = 1): Promise<{ revision: number }> {
  checkId(profileId);
  const { opId, expectedRevision, doc } = opArgs(body);
  const checked = checkProfileDoc(doc, now);
  if (!checked.ok) throw new HttpError(422, checked.code, checked.path ? { path: checked.path } : {});
  const again = await replayed(env, ctx.userId, profileId, opId);
  if (again) return again;

  const docV = checked.doc.v;
  const text = JSON.stringify(checked.doc);
  const size = new TextEncoder().encode(text).length;
  const revision = expectedRevision + 1;
  const first =
    expectedRevision === 0
      ? env.DB.prepare(
          `INSERT INTO profile_index (user_id, profile_id, revision, last_op_id, updated_at, doc_v) VALUES (?, ?, 1, ?, ?, ?)
           ON CONFLICT (user_id, profile_id) DO NOTHING`,
        ).bind(ctx.userId, profileId, opId, now, docV)
      : env.DB.prepare(
          `UPDATE profile_index SET revision = ?, last_op_id = ?, updated_at = ?, doc_v = ?
           WHERE user_id = ? AND profile_id = ? AND revision = ? AND deleted_at IS NULL AND doc_v <= ?`,
        ).bind(revision, opId, now, docV, ctx.userId, profileId, expectedRevision, docV);
  await env.DB.batch([
    first,
    env.DB.prepare(`INSERT OR REPLACE INTO profiles (user_id, profile_id, body, size) SELECT ?, ?, ?, ? WHERE ${APPLIED}`).bind(
      ctx.userId,
      profileId,
      text,
      size,
      ctx.userId,
      profileId,
      opId,
    ),
    ...historyStatements(env, ctx, profileId, opId, revision, text, now),
  ]);
  const h = await head(env, ctx.userId, profileId);
  if (h?.lastOpId === opId) return { revision: h.revision };
  return rejected(env, ctx.userId, profileId, docV, reqV);
}
```

`deleteProfile`(`:158-187`) 시그니처와 두 곳을 바꿔요.

```ts
export async function deleteProfile(
  env: SyncEnv,
  ctx: AuthContext,
  profileId: string,
  body: unknown,
  now: number,
  reqV = 1,
): Promise<{ revision: number; deletedAt: number; purgeAt: number }> {
```

`:184`:

```ts
  if (h?.lastOpId === opId)
    throw new HttpError(409, 'conflict', { revision: h.revision, doc: h.docV > reqV ? null : await currentDoc(env, ctx.userId, profileId) });
```

`:186`:

```ts
  return rejected(env, ctx.userId, profileId, null, reqV);
```

- [ ] **Step 6: 통과 확인**

Run: `cd sync-worker && npx vitest run && npx tsc -p tsconfig.json --noEmit`
Expected: PASS. 기존 테스트(409 본문에 `doc` 포함, 같은 opId 재시도 등)도 그대로 통과해요.

- [ ] **Step 7: 커밋**

```bash
git add sync-worker/migrations/0004_doc_version.sql sync-worker/src/profiles.ts sync-worker/src/profiles.test.ts sync-worker/test/docs.ts
git commit -m "feat(sync-worker): 문서 버전 열을 두고 v2 위에 v1 올리기를 원자적으로 거절함"
```

---

### Task 6: `docVersion` 쿼리와 본문 응답 가리기

**Files:**
- Modify: `sync-worker/src/profiles.ts`(새 `requestDocVersion`·`docVersionOf`, `:103-115` `getProfile`, `:190-220` `restoreProfile`, `:234-242` `getRevision`)
- Modify: `sync-worker/src/handler.ts:17-25`(import), `:62-64`, `:69`, `:72`
- Test: `sync-worker/src/profiles.test.ts`

**Interfaces:**
- Produces:
  - `export function requestDocVersion(url: URL): number` — 없으면 1, `/^[1-9]\d{0,2}$/` 아니면 `HttpError(422, 'invalid', { path: 'docVersion' })`
  - `getProfile(env, ctx, profileId, reqV = 1)`, `restoreProfile(env, ctx, profileId, body, now, reqV = 1)`, `getRevision(env, ctx, profileId, rev, reqV = 1)`

- [ ] **Step 1: 실패 테스트 쓰기** — `sync-worker/src/profiles.test.ts`의 `describe('문서 버전 …')` 안에 더해요.

```ts
  it('옛 앱(쿼리 없음)은 v2 문서를 받지 못한다: GET·리비전 422', async () => {
    const h = harness();
    const me = await h.login();
    await me.as('PUT', '/v1/profiles/p1', { opId: 'op-1', expectedRevision: 0, doc: docV2() });
    expect(await j(await me.as('GET', '/v1/profiles/p1'))).toEqual({ status: 422, body: { error: APP_OUTDATED_CODE } });
    expect((await me.as('GET', '/v1/profiles/p1/revisions/1')).status).toBe(422);
    expect(await j(await me.as('GET', '/v1/profiles/p1?docVersion=2'))).toEqual({ status: 200, body: { revision: 1, doc: docV2() } });
    expect((await j(await me.as('GET', '/v1/profiles/p1/revisions/1?docVersion=2'))).body).toEqual({ revision: 1, doc: docV2() });
  });

  it('409 충돌 응답은 요청 버전보다 높은 문서를 빼고(null) 보낸다', async () => {
    const h = harness();
    const me = await h.login();
    await me.as('PUT', '/v1/profiles/p1', { opId: 'op-1', expectedRevision: 0, doc: docV2() });
    await me.as('PUT', '/v1/profiles/p1?docVersion=2', { opId: 'op-2', expectedRevision: 1, doc: docV2('A') });
    const stale = await j(await me.as('PUT', '/v1/profiles/p1', { opId: 'op-3', expectedRevision: 1, doc: docV2('B') }));
    expect(stale).toEqual({ status: 409, body: { error: 'conflict', revision: 2, doc: null } });
    const fresh = await j(await me.as('PUT', '/v1/profiles/p1?docVersion=2', { opId: 'op-4', expectedRevision: 1, doc: docV2('B') }));
    expect(fresh).toEqual({ status: 409, body: { error: 'conflict', revision: 2, doc: docV2('A') } });
  });

  it('deleteProfile의 409도 doc을 뺀다', async () => {
    const h = harness();
    const me = await h.login();
    await me.as('PUT', '/v1/profiles/p1', { opId: 'op-1', expectedRevision: 0, doc: docV2() });
    // 같은 opId가 이미 PUT으로 반영된 경우(h.lastOpId === opId, 삭제 아님) → 409
    const r = await j(await me.as('DELETE', '/v1/profiles/p1', { opId: 'op-1', expectedRevision: 1 }));
    expect(r.status).toBe(409);
    expect(r.body.doc).toBeNull();
  });

  it('삭제된 v2 프로필: GET은 410(버전 검사 전), 옛 앱의 복원은 바꾸기 전에 422', async () => {
    const h = harness();
    const me = await h.login();
    await me.as('PUT', '/v1/profiles/p1', { opId: 'op-1', expectedRevision: 0, doc: docV2() });
    await me.as('DELETE', '/v1/profiles/p1', { opId: 'op-2', expectedRevision: 1 });
    expect((await me.as('GET', '/v1/profiles/p1')).status).toBe(410);
    expect(await j(await me.as('POST', '/v1/profiles/p1/restore', { opId: 'op-3' }))).toEqual({ status: 422, body: { error: APP_OUTDATED_CODE } });
    expect((h.env.DB.raw.prepare("SELECT deleted_at AS d FROM profile_index WHERE profile_id = 'p1'").get() as { d: number | null }).d).not.toBeNull();
    const ok = await j(await me.as('POST', '/v1/profiles/p1/restore?docVersion=2', { opId: 'op-3' }));
    expect(ok).toEqual({ status: 200, body: { revision: 3, doc: docV2() } });
  });

  it('docVersion 형식이 틀리면 422 invalid', async () => {
    const h = harness();
    const me = await h.login();
    expect(await j(await me.as('GET', '/v1/profiles/p1?docVersion=two'))).toEqual({ status: 422, body: { error: 'invalid', path: 'docVersion' } });
  });
```

- [ ] **Step 2: 실패 확인**

Run: `cd sync-worker && npx vitest run src/profiles.test.ts`
Expected: FAIL — 쿼리 없는 GET이 200으로 v2를 돌려주고, 409 본문에 `doc`이 있어요.

- [ ] **Step 3: 구현** — `sync-worker/src/profiles.ts`

`checkId` 아래에 더해요.

```ts
/** 요청이 다룰 수 있는 문서 버전(쿼리 docVersion). 없으면 1(옛 앱). 전략 빌더 §8.3 */
export function requestDocVersion(url: URL): number {
  const raw = url.searchParams.get('docVersion');
  if (raw === null) return 1;
  if (!/^[1-9]\d{0,2}$/.test(raw)) throw new HttpError(422, 'invalid', { path: 'docVersion' });
  return Number(raw);
}

/** 저장된 본문의 버전. v가 없으면 1 */
const docVersionOf = (doc: unknown): number => {
  const v = typeof doc === 'object' && doc !== null ? (doc as { v?: unknown }).v : undefined;
  return typeof v === 'number' ? v : 1;
};
```

`getProfile`(`:103-115`)을 바꿔요.

```ts
export async function getProfile(env: SyncEnv, ctx: AuthContext, profileId: string, reqV = 1): Promise<{ revision: number; doc: unknown }> {
  // 리비전과 본문을 한 문장으로 읽는다. 따로 읽으면 사이에 다른 기기가 바꿔 리비전 N과 N+1의 본문이 짝지어질 수 있다.
  const row = await env.DB.prepare(
    `SELECT i.revision AS revision, i.deleted_at AS deletedAt, i.purge_at AS purgeAt, i.doc_v AS docV, p.body AS body
     FROM profile_index i LEFT JOIN profiles p ON p.user_id = i.user_id AND p.profile_id = i.profile_id
     WHERE i.user_id = ? AND i.profile_id = ?`,
  )
    .bind(ctx.userId, checkId(profileId))
    .first<{ revision: number; deletedAt: number | null; purgeAt: number | null; docV: number; body: string | null }>();
  if (!row) throw new HttpError(404, 'not-found');
  if (row.deletedAt !== null) throw new HttpError(410, 'gone', { deletedAt: row.deletedAt, purgeAt: row.purgeAt, revision: row.revision });
  // 삭제 판정(본문 없음) 다음에 본다. 요청 버전보다 높은 문서는 주지 않는다(옛 앱이 받아 기본값으로 덮지 않게)
  if (row.docV > reqV) throw new HttpError(422, APP_OUTDATED_CODE);
  return { revision: row.revision, doc: row.body === null ? null : JSON.parse(row.body) };
}
```

`restoreProfile`(`:190-220`)을 바꿔요. 바꾸기 전 검사와, 재시도 경로의 마지막 검사를 둬요.

```ts
export async function restoreProfile(env: SyncEnv, ctx: AuthContext, profileId: string, body: unknown, now: number, reqV = 1): Promise<{ revision: number; doc: unknown }> {
  checkId(profileId);
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  if (typeof b.opId !== 'string' || !ID_RE.test(b.opId)) throw new HttpError(422, 'invalid', { path: 'opId' });
  const opId = b.opId;
  const again = await replayed(env, ctx.userId, profileId, opId);
  if (!again) {
    const h = await head(env, ctx.userId, profileId);
    if (!h) throw new HttpError(404, 'not-found');
    if (h.deletedAt === null) throw new HttpError(409, 'not-deleted', { revision: h.revision });
    if (h.purgeAt! <= now) throw new HttpError(410, 'gone', { deletedAt: h.deletedAt, purgeAt: h.purgeAt });
    // 되살리면 본문을 돌려주니 바꾸기 전에 본다. 옛 앱이 v2 프로필을 되살려 v1으로 덮는 길을 막는다
    if (h.docV > reqV) throw new HttpError(422, APP_OUTDATED_CODE);
    const revision = h.revision + 1;
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE profile_index SET revision = ?, last_op_id = ?, updated_at = ?, deleted_at = NULL, purge_at = NULL
         WHERE user_id = ? AND profile_id = ? AND revision = ? AND deleted_at IS NOT NULL`,
      ).bind(revision, opId, now, ctx.userId, profileId, h.revision),
      env.DB.prepare(
        `INSERT INTO revisions (user_id, profile_id, revision, op_id, body, created_at)
         SELECT user_id, profile_id, ?, ?, body, ? FROM profiles WHERE user_id = ? AND profile_id = ? AND ${APPLIED}`,
      ).bind(revision, opId, now, ctx.userId, profileId, ctx.userId, profileId, opId),
      historyStatements(env, ctx, profileId, opId, revision, null, now)[1],
      // 되살린 프로필에 살아 있는 키 행이 남아 있으면(되돌린 Worker 기간의 고아) 삭제 표시로. 블롭은 되살아나지 않는다
      env.DB.prepare(`${KEY_TOMBSTONE_SQL} AND ${APPLIED}`).bind(now, ctx.userId, profileId, ctx.userId, profileId, opId),
    ]);
    const after = await head(env, ctx.userId, profileId);
    if (after?.lastOpId !== opId) throw new HttpError(409, 'conflict', { revision: after?.revision ?? null });
  }
  const h = await head(env, ctx.userId, profileId);
  // 재시도(again)로 온 경우에도 본문을 주기 전에 본다
  if (h!.docV > reqV) throw new HttpError(422, APP_OUTDATED_CODE);
  return { revision: h!.revision, doc: await currentDoc(env, ctx.userId, profileId) };
}
```

`getRevision`(`:234-242`)을 바꿔요.

```ts
export async function getRevision(env: SyncEnv, ctx: AuthContext, profileId: string, rev: string, reqV = 1) {
  checkId(profileId);
  if (!/^\d{1,9}$/.test(rev)) throw new HttpError(404, 'not-found');
  const row = await env.DB.prepare('SELECT body FROM revisions WHERE user_id = ? AND profile_id = ? AND revision = ? AND body IS NOT NULL')
    .bind(ctx.userId, profileId, Number(rev))
    .first<{ body: string }>();
  if (!row) throw new HttpError(404, 'not-found');
  const doc: unknown = JSON.parse(row.body);
  // 리비전마다 버전이 다를 수 있어 그 본문의 v를 본다
  if (docVersionOf(doc) > reqV) throw new HttpError(422, APP_OUTDATED_CODE);
  return { revision: Number(rev), doc };
}
```

`sync-worker/src/handler.ts` — import(`:17-25`)에 `requestDocVersion`을 더하고 다섯 경로를 바꿔요.

```ts
import {
  deleteProfile,
  getProfile,
  getRevision,
  listProfiles,
  listRevisions,
  putProfile,
  requestDocVersion,
  restoreProfile,
} from './profiles';
```

```ts
  ['GET', /^\/v1\/profiles\/([^/]+)$/, '/v1/profiles/:id', authed(async ({ env, ctx, params, url }) => ok(await getProfile(env, ctx, params[0], requestDocVersion(url))))],
  [
    'PUT',
    /^\/v1\/profiles\/([^/]+)$/,
    '/v1/profiles/:id',
    authed(async ({ req, env, deps, ctx, params, url }) => ok(await putProfile(env, ctx, params[0], await readJson(req), deps.now(), requestDocVersion(url)))),
  ],
  [
    'DELETE',
    /^\/v1\/profiles\/([^/]+)$/,
    '/v1/profiles/:id',
    authed(async ({ req, env, deps, ctx, params, url }) => ok(await deleteProfile(env, ctx, params[0], await readJson(req), deps.now(), requestDocVersion(url)))),
  ],
  [
    'POST',
    /^\/v1\/profiles\/([^/]+)\/restore$/,
    '/v1/profiles/:id/restore',
    authed(async ({ req, env, deps, ctx, params, url }) => ok(await restoreProfile(env, ctx, params[0], await readJson(req), deps.now(), requestDocVersion(url)))),
  ],
```

```ts
  [
    'GET',
    /^\/v1\/profiles\/([^/]+)\/revisions\/([^/]+)$/,
    '/v1/profiles/:id/revisions/:rev',
    authed(async ({ env, ctx, params, url }) => ok(await getRevision(env, ctx, params[0], params[1], requestDocVersion(url)))),
  ],
```

라우터는 `url.pathname`으로 경로를 맞추니(`handle`의 `route(req.method, url.pathname)`) 쿼리가 붙어도 경로 매칭은 그대로예요.

- [ ] **Step 4: 통과 확인**

Run: `cd sync-worker && npx vitest run && npx tsc -p tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add sync-worker/src/profiles.ts sync-worker/src/handler.ts sync-worker/src/profiles.test.ts
git commit -m "feat(sync-worker): 요청 버전보다 높은 문서는 돌려주지 않음(docVersion)"
```

---

### Task 7: 계약 테스트 — 옛 앱 경로 무변화·공유 원본 저장

PR①만 배포된 상태에서 옛 앱이 전과 똑같이 도는지와, Worker가 공유를 원본 그대로 저장하는지 고정해요. 코드 변경은 없어요(`shares.ts`는 `checked.snapshot`을 저장하고, Task 4로 create는 원본을 돌려줘요).

**Files:**
- Test: `sync-worker/src/profiles.test.ts`, `sync-worker/src/shares.test.ts`

**Interfaces:**
- Consumes: `doc`·`docV2`(`sync-worker/test/docs.ts`), `fullStrategyV2`, `simResultFixture`, `strategySnapshot`, `newStrategy`

- [ ] **Step 1: 테스트 쓰기** — `sync-worker/src/profiles.test.ts` 끝에

```ts
describe('PR①만 배포: 옛 앱(쿼리 없음 + v1 문서) 경로 무변화(§8.7)', () => {
  it('만들기·읽기·갱신·충돌·삭제·복원 응답 모양이 지금과 같다', async () => {
    const h = harness();
    const me = await h.login();
    expect(await j(await me.as('PUT', '/v1/profiles/p1', { opId: 'op-1', expectedRevision: 0, doc: doc() }))).toEqual({ status: 200, body: { revision: 1 } });
    expect(await j(await me.as('GET', '/v1/profiles/p1'))).toEqual({ status: 200, body: { revision: 1, doc: doc() } });
    expect((await j(await me.as('PUT', '/v1/profiles/p1', { opId: 'op-2', expectedRevision: 1, doc: doc('A') }))).body).toEqual({ revision: 2 });
    expect(await j(await me.as('PUT', '/v1/profiles/p1', { opId: 'op-3', expectedRevision: 1, doc: doc('B') }))).toEqual({
      status: 409,
      body: { error: 'conflict', revision: 2, doc: doc('A') },
    });
    expect((await j(await me.as('GET', '/v1/profiles/p1/revisions/2'))).body).toEqual({ revision: 2, doc: doc('A') });
    expect((await me.as('DELETE', '/v1/profiles/p1', { opId: 'op-4', expectedRevision: 2 })).status).toBe(200);
    expect(await j(await me.as('POST', '/v1/profiles/p1/restore', { opId: 'op-5' }))).toEqual({ status: 200, body: { revision: 4, doc: doc('A') } });
  });

  it('저장소에는 받은 원본 그대로 들어간다', async () => {
    const h = harness();
    const me = await h.login();
    await me.as('PUT', '/v1/profiles/p1', { opId: 'op-1', expectedRevision: 0, doc: docV2() });
    const body = (h.env.DB.raw.prepare("SELECT body FROM profiles WHERE profile_id = 'p1'").get() as { body: string }).body;
    expect(JSON.parse(body)).toEqual(docV2());
  });
});
```

`sync-worker/src/shares.test.ts` 끝에 붙여요(파일 위 import에 `newStrategy`·`fullStrategyV2`를 더해요: `import { newStrategy } from '../../src/lib/sim/defaults';`, `import { fullStrategyV2 } from '../../src/lib/sim/testStrategyV2';`).

```ts
describe('전략 공유 버전(전략 빌더 §8.4, PR①)', () => {
  const v2Snap = () => ({
    kind: 'strategy',
    v: 2,
    title: '골든크로스',
    strategy: { ...fullStrategyV2(), id: 'shared', name: '골든크로스', updatedAt: 0, universe: { kind: 'symbols', symbols: ['005930'] } },
    capitalHidden: false,
  });

  it('v2 전략 공유를 받고 원본 그대로 저장한다', async () => {
    const { create, read } = await setup();
    const made = await create({ kind: 'strategy', snapshot: v2Snap() });
    expect(made.status).toBe(200);
    const got = await j(await read(made.body.capability as string));
    expect(got.body.snapshot).toEqual(v2Snap());
  });

  it('v1 전략·시뮬레이션 공유(옛 앱)는 지금처럼 받고 원본 그대로 저장한다', async () => {
    const { create, read } = await setup();
    const v1 = strategySnapshot({ ...newStrategy(0, null, '눌림목'), universe: { kind: 'symbols', symbols: ['005930'] } }, { groups: [] }, { hideCapital: false, now: 0 });
    const a = await create({ kind: 'strategy', snapshot: v1 });
    expect(a.status).toBe(200);
    expect((await j(await read(a.body.capability as string))).body.snapshot).toEqual(v1);
    const sim = simResultFixture();
    const b = await create({ kind: 'simResult', snapshot: sim });
    expect(b.status).toBe(200);
    expect((await j(await read(b.body.capability as string))).body.snapshot).toEqual(sim);
  });

  it('v3 전략 공유는 422 unsupported', async () => {
    const { create } = await setup();
    expect(await create({ kind: 'strategy', snapshot: { ...v2Snap(), v: 3 } })).toMatchObject({ status: 422, body: { error: 'unsupported', path: 'v' } });
  });
});
```


- [ ] **Step 2: 실행**

Run: `cd sync-worker && npx vitest run src/profiles.test.ts src/shares.test.ts`
Expected: PASS. 실패하면 Task 4·5·6 구현을 고쳐요(이 테스트는 고정 계약이에요). 단, 기대 응답 모양이 틀린 것이면 지금 코드의 기존 테스트(`profiles.test.ts` 위쪽)와 같은 모양으로 맞춰요.

- [ ] **Step 3: 전체 확인**

Run: `corepack pnpm test && corepack pnpm check && (cd sync-worker && npx vitest run && npx tsc -p tsconfig.json --noEmit)`
Expected: 모두 PASS.

- [ ] **Step 4: 커밋**

```bash
git add sync-worker/src/profiles.test.ts sync-worker/src/shares.test.ts
git commit -m "test(sync-worker): 옛 앱 경로 무변화와 공유 원본 저장을 계약 테스트로 고정함"
```

---

### Task 8: 배포 순서 문서화

실제 배포는 이 계획에 넣지 않아요. 순서만 적어요.

**Files:**
- Modify: `sync-worker/README.md`(배포 절. 없으면 끝에 새 절)

- [ ] **Step 1: README에 절 더하기** — `sync-worker/README.md` 끝에

```markdown
## 전략 빌더 PR① 배포 (문서 버전 `doc_v`)

전략 빌더(전략 v2) 앱보다 **먼저** 배포해요. 설계: `docs/superpowers/specs/2026-11-01-strategy-builder-design.md` §8.7.

1. 마이그레이션: `corepack pnpm --filter sync-worker migrate:remote` (= `wrangler d1 migrations apply gazua-sync --remote`). `0004_doc_version.sql`이 `profile_index.doc_v`(기본 1)를 더해요.
2. Worker 배포: `corepack pnpm --filter sync-worker run deploy` (= `wrangler deploy`). `run`을 빼면 pnpm 내장 `deploy` 명령이 돌아요. 마이그레이션을 먼저 해야 새 코드의 `doc_v` 쿼리가 실패하지 않아요.
3. 앱 배포(PR① 앱은 여전히 v1 문서만 만들어요). 병합하면 앱이 자동으로 먼저 배포될 수 있어요. PR① 앱은 `docVersion`을 보내지 않는 v1 클라이언트라 옛 Worker와도 그대로 돌아 순서가 바뀌어도 무해해요.

PR①만 배포된 동안 옛 앱은 전과 똑같이 돌아요. 모든 문서가 v1(`doc_v = 1`)이고 옛 앱의 요청 버전도 1이라 가리기·거절이 걸리지 않아요. 전략 빌더 PR② 앱은 이 배포를 확인한 뒤 내보내요. 순서를 어기면 PR② 앱의 v2 PUT이 옛 Worker에서 422(`v`)로 거절되고, 그 문서가 바뀔 때까지 다시 보내지 않아요.

| 응답 | 언제 |
|---|---|
| 422 `앱을 새로 고쳐 주세요` | 저장 문서 버전이 요청 `docVersion`(없으면 1)보다 높은 GET·리비전·복원, v2 위에 v1 PUT |
| 409 `doc: null` | 충돌인데 저장 문서 버전이 요청 버전보다 높음 |
```

- [ ] **Step 2: 확인**

Run: `grep -n "0004_doc_version" sync-worker/README.md`
Expected: 한 줄 이상 나와요.

- [ ] **Step 3: 커밋**

```bash
git add sync-worker/README.md
git commit -m "docs(sync-worker): 전략 빌더 PR① 배포 순서를 적음"
```

---

## Self-Review (작성 시 점검)

- 스펙 §8.7 PR① 범위 대응: `strategyV2.ts`(Task 2), `checkProfileDoc` v1·v2·`unsupported`·원본 반환·`APP_OUTDATED_CODE`(Task 3), 공유 create v1·v2 원본·read v1만·v2 `unsupported`(Task 4), 새 체결 종류·`markers.ts`(Task 1), `doc_v`·조건부 갱신·`ON CONFLICT`·`replayed()` 순서·`rejected()` 순서(Task 5), `docVersion`·GET/리비전/복원 422·409 `doc: null`·`deleteProfile` 409·삭제 410 우선(Task 6), `shares.ts` 원본 저장·옛 앱 경로 무변화·v1 문서·v1 공유 계속 통과(Task 7), 금지 키·깊이(Task 2), 배포 순서(Task 8).
- 앱 쪽 호출(`sanitizeStrategies` 사용처, `api.ts`, `PROFILE_DOC_VERSION`, `SHARE_VERSION`)은 어느 Task도 바꾸지 않아요.
- 이름 일관성: `StrategyV2`·`sanitizeStrategiesV2`·`defaultCond`·`fullStrategyV2`·`docV2`·`APP_OUTDATED_CODE`·`PROFILE_DOC_MAX_VERSION`·`STRATEGY_SHARE_MAX_VERSION`·`requestDocVersion`·`docVersionOf`·`doc_v`/`docV`가 모든 Task에서 같아요.
