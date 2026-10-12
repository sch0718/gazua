# 매매 규칙 시뮬레이션 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 정한 매수·매도 규칙을 관심종목의 과거 일봉에 적용해, 보유·시장 지수·지정 종목과 비교한 결과를 보여 주는 시뮬레이션 화면을 가즈아에 더한다.

**Architecture:** 순수 함수 엔진(`src/lib/sim/`)이 "전략 + 종목별 일봉 + 거래일 축"을 받아 거래·자산 곡선·요약을 낸다. 데이터는 기존 `MarketDataProvider`로 실행 때마다 받고(우선순위 2, 메모리 재사용만), 전략은 프로필 localStorage에 저장한다. 화면은 `#/simulate` 경로 하나에 목록·편집·결과를 둔다.

**Tech Stack:** 기존 그대로 — Svelte 5(runes), TypeScript 5, Vitest 3 + @testing-library/svelte + jsdom, Lightweight Charts 5, Playwright + @axe-core/playwright. 새 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-10-12-backtest-simulation-design.md` (기반: `docs/superpowers/specs/2026-10-11-stock-compare-design.md`)

## Global Constraints

- 시각·날짜는 **KST 고정**, 날짜 문자열은 `YYYY-MM-DD`. 테스트는 `TZ=America/New_York`(`corepack pnpm test`)으로 돈다. 날짜 계산은 `src/lib/time/kst.ts`(`kstDate`, `addDays`, `kstWeekday`)만 쓴다.
- 엔진은 **미래 봉을 쓰지 않는다**: t일 판단은 t일 종가까지의 정보만.
- 패턴 고점·저점은 **종가 기준**. 하루 가격 경로는 **시가 → 저가 → 고가 → 종가**.
- 매수 신호는 **다음 거래일 시가** 체결. 전량 매도 뒤 패턴 리셋(새 A 필요).
- 한 전략 최대 **8종목**, 프로필당 전략 최대 **20개**, 익절 최대 **3단계**.
- 저장 키 `gazua:v1:p:<profileId>:strategies` → `{ strategies: Strategy[] }`. 종목 일봉은 IndexedDB에 **저장하지 않는다**.
- 시뮬레이션의 공급자 호출은 우선순위 **2**.
- 매도 세율표는 `src/lib/sim/tax.ts` 한 곳에만(스펙 5.4 표 그대로). ETF·`KR_ETC`는 0.
- UI 문구는 존댓말 `~해요`체, 스펙에 나온 문구는 그대로. 상승·하락은 ▲▼ 기호와 사용자의 색 관례(`colorConvention`)를 따른다.
- 런타임 외부 스크립트 금지, 새 npm 의존성 금지.
- 키·토큰은 로그·오류 메시지에 넣지 않는다.

## Review Focus

1. **기간 전체에 봉이 하나도 없는 종목**(기간 뒤 상장, 상장폐지) — 실행이 죽지 않고 그 종목만 `제외`로 빠져야 한다. → Task 8 `a symbol with no candles in range is reported as failed, not thrown`, Task 5 `a stock with no bars in days never trades`.
2. **보유 중 며칠 거래정지**(봉 없음) — 포지션은 유지되고 마지막 종가로 평가, 정지 동안 손절·익절 없음, 재개 첫날 갭 규칙 적용. → Task 5 `halted days keep the position at last close and resume with gap rules`.
3. **`to`가 오늘(장중)** — 미완성 오늘 봉으로 신호를 내면 안 된다. → Task 8 `to at or after today is clamped to yesterday`.
4. **신호는 났지만 모두 건너뜀**(1회 금액이 비싼 종목 1주보다 작음) — "신호가 안 났다"가 아니라 건너뛴 이유를 보여야 한다. → Task 6 `nearMiss is null when signals were all skipped`, Task 11 `all-skipped result shows the dominant skip reason`.
5. **지워진 그룹을 가리키는 저장 전략** — 편집은 열리고 실행은 `종목을 하나 이상 골라 주세요`로 막혀야 한다. → Task 1 `strategyIssues blocks a strategy whose group no longer exists`.

---

## 파일 구조

```
src/lib/sim/
  types.ts            Strategy · SimInput · SimResult · Trade · Skip · PatternSnapshot
  defaults.ts         newStrategy · DEFAULT_* 상수
  validate.ts         sanitizeStrategies · strategyIssues · resolveSymbols
  strategyStore.ts    loadStrategies · saveStrategies (profileKeys.strategies)
  testBars.ts         테스트 전용 봉 생성기
  indicators.ts       sma
  pattern.ts          PatternTracker (A·B·L 갱신, 신호 판단)
  tax.ts              sellTaxPct
  position.ts         Position 회계
  simulate.ts         simulate()
  benchmarks.ts       holdCurve · indexCurve · singleCurve
  summary.ts          summarize · nearMiss
  loadSimData.ts      loadSimData() · createSimMemo()
src/lib/ui/simulate/
  simText.ts          요약 한 줄·사유·숫자 포맷
  StrategyList.svelte · StrategyEditor.svelte · editor/*.svelte(구역별)
  RunPanel.svelte · ResultView.svelte · EquityChart.svelte · TradeList.svelte · TradeChartSheet.svelte
src/routes/Simulate.svelte
수정: src/lib/state/{routes.ts, profileStore.ts, app.svelte.ts, exportImport.ts}
      src/lib/providers/{types.ts, kis.ts, toss.ts, demo.ts}
      src/App.svelte · src/lib/ui/Rail.svelte
      tests/e2e/simulate.spec.ts · docs/live-check.md · README.md
```

---

### Task 1: 전략 타입·기본값·검증

**Files:**
- Create: `src/lib/sim/types.ts`, `src/lib/sim/defaults.ts`, `src/lib/sim/validate.ts`
- Test: `src/lib/sim/validate.test.ts`

**Interfaces:**
- Consumes: `Watchlists` (`src/lib/state/schema.ts`), `addDays` (`src/lib/time/kst.ts`), `Candle` (`src/lib/data/metrics.ts`)
- Produces:
  ```ts
  // types.ts — Strategy, SimInput, SimResult, Trade, Skip 는 스펙 3장·5.1·5.6의 정의 그대로
  type StopBasis = 'avgAfterScaleIn' | 'avgAlways' | 'firstBuy';
  interface PatternSnapshot { a: number; aDate: string; b: number; l: number; lDate: string }
  // defaults.ts
  const MAX_SYMBOLS = 8, MAX_STRATEGIES = 20, MAX_TAKE_STAGES = 3, NAME_MAX = 30;
  function newStrategy(now: number, groupId: string | null, name?: string): Strategy; // id = crypto.randomUUID(), 기간 = 어제 기준 3년, 그 밖은 스펙 괄호 기본값
  // validate.ts
  type Issue = { section: 'universe'|'period'|'capital'|'entry'|'scaleIn'|'exit'|'benchmarks'|'costs'; text: string; blocking: boolean };
  function sanitizeStrategies(raw: unknown): { strategies: Strategy[]; repaired: boolean };
  function resolveSymbols(s: Strategy, w: Watchlists): string[];   // 그룹이면 그 그룹 종목 순서, 없으면 []
  function strategyIssues(s: Strategy, w: Watchlists): Issue[];    // 스펙 3.1 표의 문구 그대로
  ```

- [ ] **Step 1: 실패하는 테스트**

```ts
const now = Date.parse('2026-10-12T03:00:00Z'); // KST 12:00
const w = { groups: [{ id: 'g1', name: '반도체', items: itemsOf(['005930', '000660']) }] };
const s = newStrategy(now, 'g1');
expect(s.period).toEqual({ from: '2023-10-11', to: '2026-10-11' });
expect(s.exit.takeProfit).toEqual([{ pct: 15, sellPct: 100 }]);
expect(strategyIssues(s, w)).toEqual([]);
expect(resolveSymbols(s, w)).toEqual(['005930', '000660']);

// strategyIssues blocks a strategy whose group no longer exists
expect(strategyIssues(s, { groups: [] })).toContainEqual({ section: 'universe', text: '종목을 하나 이상 골라 주세요', blocking: true });

const noTrig = structuredClone(s);
noTrig.entry.triggers.reboundDays.on = false; noTrig.entry.triggers.breakout.on = false;
expect(strategyIssues(noTrig, w)).toContainEqual(expect.objectContaining({ text: '매수 신호가 나지 않아요. 트리거를 하나 이상 켜 주세요', blocking: true }));

const avg = structuredClone(s);
avg.scaleIn = { on: true, stepPct: 5, maxAdds: 2 }; avg.exit.stopLoss = { pct: 5, basis: 'avgAlways' };
expect(strategyIssues(avg, w)).toContainEqual(expect.objectContaining({ section: 'exit', blocking: false }));

const order = structuredClone(s);
order.exit.takeProfit = [{ pct: 15, sellPct: 50 }, { pct: 10, sellPct: 100 }];
expect(strategyIssues(order, w)).toContainEqual(expect.objectContaining({ text: '익절 단계는 낮은 %부터 차례로 적어 주세요', blocking: true }));

// sanitize: 깨진 항목 하나만 빠지고 repaired, 빠진 필드는 기본값
const { strategies, repaired } = sanitizeStrategies({ strategies: [s, { id: 3 }, { ...s, id: 'x', costs: undefined }] });
expect(strategies.map((x) => x.id)).toEqual([s.id, 'x']);
expect(strategies[1].costs.feePct).toBe(0.015);
expect(repaired).toBe(true);
expect(sanitizeStrategies(null)).toEqual({ strategies: [], repaired: false });
```
그 밖의 경고(`from ≥ to`, 30거래일 미만 = 달력 42일 미만으로 근사, 현금 부족 가능)도 스펙 3.1 문구로 한 줄씩 단언한다.

- [ ] **Step 2: 실패 확인** — `corepack pnpm vitest run src/lib/sim/validate.test.ts` → FAIL (모듈 없음)
- [ ] **Step 3: 구현** — `sanitizeStrategies`는 `src/lib/state/validate.ts`처럼 아는 필드만 타입 검사하고 틀린 필드는 기본값(필수 `id`·`name`이 문자열이 아니면 항목 버림). 숫자 범위: `perBuyPct` 1~100, `dropPct` 1~90, `days`·`reboundDays` 1~60, MA 기간 2~250, `stepPct` 0.5~50, `maxAdds` 1~5, `stopLoss.pct` 0.5~50, `takeProfit.pct` 0.5~500, `feePct` 0~1. 범위 밖이면 기본값으로 + repaired. 종목 9개 이상이면 앞 8개.
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: Commit** — `feat(sim): strategy model, defaults and validation`

---

### Task 2: 전략 저장·앱 상태·내보내기

**Files:**
- Create: `src/lib/sim/strategyStore.ts`
- Modify: `src/lib/state/profileStore.ts` (`profileKeys.strategies`), `src/lib/state/app.svelte.ts` (`strategies`, `setStrategies`, 프로필 전환·삭제), `src/lib/state/exportImport.ts` (`strategies` 선택 필드)
- Test: `src/lib/sim/strategyStore.test.ts`, `src/lib/state/app.test.ts`, `src/lib/state/exportImport.test.ts`

**Interfaces:**
- Consumes: `sanitizeStrategies`, `MAX_STRATEGIES` (Task 1), `SafeStorage`
- Produces:
  ```ts
  profileKeys.strategies = (id: string) => `p:${id}:strategies`;
  function loadStrategies(st: SafeStorage, profileId: string): Strategy[];        // repaired면 st.reportCorrupt(key)
  function saveStrategies(st: SafeStorage, profileId: string, list: Strategy[]): void; // MAX_STRATEGIES 넘으면 Error('전략은 20개까지 저장할 수 있어요')
  // App 에 추가
  readonly strategies: Strategy[];
  setStrategies(list: Strategy[]): void;
  // ExportFile 에 추가
  strategies?: Strategy[];
  ```

- [ ] **Step 1: 실패하는 테스트**
  - `strategyStore.test.ts`: 저장 후 다시 읽으면 같음; 깨진 JSON → `[]` + 배너 키 보고; 21개 저장 → 위 문구로 throw.
  - `app.test.ts`: `setStrategies` 뒤 `p:p1:strategies`에 저장됨; `switchProfile`하면 그 프로필 목록으로 바뀜; `deleteProfile`하면 `p:<id>:strategies`도 지워짐.
  - `exportImport.test.ts`: 내보낸 JSON에 `strategies`가 있고, 가져온 새 프로필의 `p:<새 id>:strategies`에 같은 전략이 저장됨(`importData`는 그룹 id를 그대로 쓰므로 `universe.groupId`도 그대로 맞음); `strategies`가 없는 옛 파일도 가져와지고 목록은 `[]`; `strategies`가 배열이 아니면 `IMPORT_BAD_FORMAT`.
- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현** — `importData`는 `sanitizeStrategies(file)` 결과를 `profileKeys.strategies(id)`에 쓴다(색인 쓰기 전에). `deleteProfile`은 기존 키 삭제 목록에 `profileKeys.strategies`를 더한다.
- [ ] **Step 4: 통과 확인** — `corepack pnpm test` 전체 PASS
- [ ] **Step 5: Commit** — `feat(sim): persist strategies per profile and in export files`

---

### Task 3: 이동평균과 패턴 인식

**Files:**
- Create: `src/lib/sim/testBars.ts`, `src/lib/sim/indicators.ts`, `src/lib/sim/pattern.ts`
- Test: `src/lib/sim/pattern.test.ts`

**Interfaces:**
- Consumes: `Candle`, `Strategy['entry']`, `PatternSnapshot` (Task 1)
- Produces:
  ```ts
  // testBars.ts (테스트 전용)
  function tradingDates(start: string, n: number): string[];           // 주말 건너뛴 n일
  function barsFromCloses(closes: number[], start?: string): Candle[]; // o=h=l=c, t = KST 자정, 기본 start '2026-01-05'
  function bar(date: string, o: number, h: number, l: number, c: number): Candle;
  // indicators.ts
  function sma(closes: number[], period: number): (number | null)[];   // 앞 period-1개는 null
  // pattern.ts
  interface PatternTracker {
    /** i번째 봉(그 종목 배열 기준)의 종가로 신호를 판단한다. 상태는 바꾸지 않는다. 어제까지의 상태를 쓴다. */
    signal(i: number): { reason: string; snapshot: PatternSnapshot } | null;
    /** i번째 봉 종가로 상태를 갱신한다. signal(i) 다음에 부른다. */
    update(i: number): void;
    /** 전량 매도한 날 i에 부른다. A = c[i], L·B 없음. */
    reset(i: number): void;
    /** nearMiss용: 지금까지 본 가장 큰 (A−L)/A %, 하락 조건을 만족한 날 수 */
    stats(): { maxDropPct: number; declineDays: number };
  }
  function createPatternTracker(candles: Candle[], entry: Strategy['entry']): PatternTracker;
  ```
  `reason` 문구: `'3일 연속 상승'`(N 반영), `'A 돌파'`, `'B 돌파'`, `'20일선 돌파'`, `'골든크로스 5/20'`. 여러 트리거가 동시에 맞으면 이 순서로 첫 번째.

- [ ] **Step 1: 실패하는 테스트** — 기본 entry(10% 하락, 3일 반등, B 돌파)에서 `i = 0..n-1` 동안 `signal(i)` 후 `update(i)`를 부르는 헬퍼 `signalsOf(closes, entry)`로 신호가 난 인덱스와 reason을 모은다.

```ts
// A=100, 하락 중 반등 고점 B=95(인덱스 3), 저점 L=80(인덱스 5)
const closes = [90, 100, 92, 95, 88, 80, 82, 84, 86, 96];
// 트래커는 보유 여부를 모르므로 조건이 맞는 날마다 신호를 낸다. 9는 B 돌파도 맞지만 reason 우선순위상 연속 상승
expect(signalsOf(closes, entry)).toEqual([{ i: 8, reason: '3일 연속 상승' }, { i: 9, reason: '3일 연속 상승' }]);
// 신호 스냅샷
expect(snapAt(closes, entry, 8)).toEqual({ a: 100, aDate: d(1), b: 95, l: 80, lDate: d(5) });
// B 돌파만 켬
expect(signalsOf(closes, { ...entry, triggers: { ...off, breakout: { on: true, level: 'B' } } })).toEqual([{ i: 9, reason: 'B 돌파' }]);
// 하락이 9%면 신호 없음
expect(signalsOf([100, 95, 91, 93, 95, 97, 99], entry)).toEqual([]);
// 반등이 저점 다음 날부터가 아니면 연속 상승 아님: 80 다음 79(새 저점) 다음 81,83 → 저점이 79로 바뀌어 2일뿐
expect(signalsOf([100, 85, 80, 79, 81, 83], entry)).toEqual([]);
// B가 없으면 B=A
expect(snapAt([100, 95, 90, 85, 87, 89, 91], entry, 6).b).toBe(100);
// 하락 조건 둘 다 끄면 L만 있으면 됨, days 조건만 켬(10일) → A 이후 10거래일 전에는 신호 없음
// A 돌파: 새 최고 종가가 나온 날 신호, 그날 update 뒤 A는 그 종가
// maCross·goldenCross·aboveMa 필터: 봉 수가 기간보다 적으면 null, 경계 조건(어제 ≤, 오늘 >) 각각 한 줄
// reset(i) 뒤에는 이전 하락으로 신호가 나지 않음
// sma([1,2,3,4], 3) → [null, null, 2, 3]
```

- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현** — 상태는 `aIdx, lIdx`와 "aIdx 이후 국소 고점 인덱스 목록 중 lIdx보다 앞선 마지막 것"으로 둔다. 국소 고점은 `update(i)`에서 `i−1`이 `c[i−2] < c[i−1] > c[i]`인지로 확정한다(미래 봉 없이). 이동평균은 생성 시 한 번 계산해 둔다.
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: Commit** — `feat(sim): rebound pattern tracker and moving averages`

---

### Task 4: 세율표와 포지션 회계

**Files:**
- Create: `src/lib/sim/tax.ts`, `src/lib/sim/position.ts`
- Test: `src/lib/sim/tax.test.ts`, `src/lib/sim/position.test.ts`

**Interfaces:**
- Consumes: `Strategy['scaleIn'|'exit']` (Task 1)
- Produces:
  ```ts
  function sellTaxPct(date: string, market: 'KOSPI'|'KOSDAQ'|'KR_ETC', isEtf: boolean): number;
  interface Position {
    readonly qty: number; readonly initialQty: number; readonly avgPrice: number; readonly firstPrice: number;
    readonly lastBuyPrice: number; readonly adds: number; readonly soldAny: boolean; readonly stagesDone: number;
    buy(price: number, qty: number): void;          // 평균 단가 갱신(수수료 제외)
    sell(qty: number, stage?: number): void;        // stage 있으면 stagesDone = stage
    stopPrice(): number | null;                     // 스펙 5.3 손절선(기준 3종 + breakeven), 없으면 null
    nextAddPrice(): number | null;                  // 분할 꺼짐·maxAdds 도달·soldAny면 null
    takeLevels(): { stage: number; price: number; qty: number }[]; // 남은 단계만, 낮은 가격부터, 마지막 단계 qty = 호출 시점의 남은 수량(매도마다 다시 부른다)
  }
  function openPosition(price: number, qty: number, scaleIn: Strategy['scaleIn'], exit: Strategy['exit']): Position;
  ```

- [ ] **Step 1: 실패하는 테스트**

```ts
expect(sellTaxPct('2026-03-02', 'KOSPI', false)).toBe(0.2);
expect(sellTaxPct('2025-12-31', 'KOSDAQ', false)).toBe(0.15);
expect(sellTaxPct('2021-01-01', 'KOSPI', false)).toBe(0.23);
expect(sellTaxPct('2019-06-02', 'KOSPI', false)).toBe(0.3);
expect(sellTaxPct('2019-06-03', 'KOSPI', false)).toBe(0.25);
expect(sellTaxPct('2026-03-02', 'KOSPI', true)).toBe(0);
expect(sellTaxPct('2026-03-02', 'KR_ETC', false)).toBe(0);

const exit = { takeProfit: [{ pct: 10, sellPct: 50 }, { pct: 15, sellPct: 100 }], stopLoss: { pct: 5, basis: 'avgAfterScaleIn' }, afterFirstTake: 'keep' } as const;
const p = openPosition(100, 10, { on: true, stepPct: 3, maxAdds: 2 }, exit);
expect(p.stopPrice()).toBeNull();             // 분할 전에는 손절 없음
expect(p.nextAddPrice()).toBe(97);
p.buy(97, 10); p.buy(94.09, 10);
expect(p.avgPrice).toBeCloseTo(97.03, 2);
expect(p.stopPrice()).toBeCloseTo(92.1785, 3);
expect(p.nextAddPrice()).toBeNull();
expect(p.takeLevels()).toEqual([{ stage: 1, price: expect.closeTo(106.733, 3), qty: 15 }, { stage: 2, price: expect.closeTo(111.5845, 3), qty: 30 }]);
p.sell(15, 1);
expect(p.takeLevels()).toEqual([{ stage: 2, price: expect.closeTo(111.5845, 3), qty: 15 }]);
expect(p.nextAddPrice()).toBeNull();          // 일부 매도 뒤 추가 매수 없음
// breakeven: 1단계 뒤 손절선 = max(손절선, 평균 단가)
// firstBuy: 추가 매수해도 100 × 0.95
// avgAlways: 첫 매수 직후부터 평균 단가 × 0.95
// sellPct 50인데 initialQty 3 → floor(1.5)=1주
```

- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현** — 세율표는 `[시작일, KOSPI, KOSDAQ]` 배열을 위에서부터 찾는다(스펙 5.4 표, 주석에 "2025년 이전 값은 live-check ⑮로 확인").
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: Commit** — `feat(sim): sell tax schedule and position accounting`

---

### Task 5: 엔진 하루 루프

**Files:**
- Create: `src/lib/sim/simulate.ts`
- Test: `src/lib/sim/simulate.test.ts`

**Interfaces:**
- Consumes: `createPatternTracker` (Task 3), `openPosition`, `sellTaxPct` (Task 4), `SimInput`, `Trade`, `Skip` (Task 1), `holdCurve`·`summarize` (Task 6 — 이 Task에서는 `simulateCore`만 테스트)
- Produces:
  ```ts
  interface CoreResult {
    equity: { date: string; value: number; cash: number }[];
    trades: Trade[]; skipped: Skip[];
    roundTrips: { symbol: string; open: string; close: string | null; cost: number; pnl: number; holdDays: number }[];
    perSymbolFirstDate: Record<string, string | null>;
    patternStats: { maxDropPct: number; declineDays: number };   // 종목 중 maxDropPct 최대, declineDays 합
  }
  function simulateCore(input: SimInput): CoreResult;
  function simulate(input: SimInput): SimResult;   // Task 6에서 완성: simulateCore + 비교 기준 + summarize
  ```

- [ ] **Step 1: 실패하는 테스트** — 손으로 만든 1~2종목 시나리오. 기본 전략: 초기 1,000만, 회당 10%(100만), 수수료 0, 하락 10%·3일 반등만 켬, 익절 +15% 전량, 손절 −5% `avgAlways`. 거래일 축 = 봉 날짜.

```ts
// next-day open buy: 신호 인덱스 8 → 인덱스 9 시가에 매수
// 시나리오 closes [90,100,92,95,88,80,82,84,86, ...], 인덱스 9 bar(o=87,h=88,l=86,c=87)
expect(core.trades[0]).toMatchObject({ date: d(9), kind: 'buy', price: 87, qty: 11494, reason: '3일 연속 상승' });
// gap stop: 다음 날 시가 80(손절선 82.65 아래) → 'gapStop' @80
// intraday stop and take on the same day → stop wins: bar(o=87,h=101,l=82,c=95) → 'stop' @82.65, take 없음
// two take stages in one day: 1단계 +10% 50%, 2단계 +15% 나머지, bar(o=88,h=101,l=88,c=100) → take@95.7 stage1, take@100.05 stage2, 둘 다 같은 날
// gap take: 시가가 2단계 가격 위 → 남은 단계 모두 'gapTake' @시가
// bought today still trades intraday: 매수 당일 bar(o=87,h=87,l=82,c=83) → 같은 날 'stop'
// scale-in chain in one day: stepPct 3, maxAdds 2, bar(o=100,h=100,l=93,c=94) → add@97, add@94.09 같은 날
// stop basis avgAfterScaleIn: 추가 매수 전 −6% 하락에도 손절 없음
// partial sell stops further adds
// cash shortfall skip recorded once per level: perBuyPct 60, 두 종목 같은 날 신호 → 두 번째 '현금 부족' 1건, 그룹 순서 첫 종목이 삼
// zero shares: 1회 금액 < 1주 가격 → Skip '1주가 1회 금액보다 비쌈'
// a stock with no bars in days never trades and equity stays cash
// halted days keep the position at last close and resume with gap rules: 보유 중 봉 2일 없음 → equity는 마지막 종가로, 재개 첫날 시가가 손절선 아래면 gapStop
// pending buy cancelled when next day has no bar → Skip '거래 없음'
// fees and tax: feePct 0.015, KOSPI 2026 매도 → tax = 매도대금 × 0.2%, fee 양쪽
// reset after full exit: 매도 뒤 같은 하락으로 재매수 없음, 새 고점 → 새 하락 → 새 반등에서만 재매수
// warmup bars before days[0] feed the pattern but never trade
// open position at end: roundTrips 마지막 항목 close null, 매도 비용 없음
// 스펙 5.2 예시 표 세 줄을 그대로 테스트로(PR #4 리뷰):
// add skipped for cash still lets the stop below fire: 10주@100, 현금 0, step 3%, avgAlways 5%, 100/90/105/100 → stop @95, 현금 950
// a stop activated by an add above the cursor fills at the cursor: 초기 1,000·회당 50%, 5주@100, step 50%·max 1, avgAfterScaleIn 5%, 100/40/100/40 → add 10주@50, stop 15주@50, 현금 750
// breakeven stop fires on the high-to-close leg: 10주@100, 익절 +10% 50%, breakeven, 100/98/112/99 → take 5주@110, stop 5주@100, 현금 1,050
```

  **미래 데이터 미사용(속성 테스트)**: 시드 고정 무작위 걷기 일봉 3종목 × 300일, 무작위 t(10개)마다 t+1 이후 봉을 다른 시드로 바꾼 입력을 만들어 `simulateCore` 결과의 `trades`·`equity`를 `date ≤ days[t]`로 자른 것이 원래와 같은지 비교한다. 단 t일 종가 판단으로 t+1에 체결될 예약은 비교 대상이 아니다(t일까지만 자른다).

- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현** — 스펙 5.2 순서 그대로. 종목별로 `date → 봉 인덱스` 맵을 만들고 `days`를 돈다. 장중 처리는 가격 커서 하나로 세 구간을 지나는 함수 `walkBar(pos, bar)`로 만든다. 구간은 `[o→l 내려감, l→h 올라감, h→c 내려감]`이다. 이벤트 하나를 처리할 때마다 `stopPrice()`·`nextAddPrice()`·`takeLevels()`를 다시 부른다. 스펙 5.2의 규칙 1~5 순서를 지킨다.
  - 이미 지나친 가격은 커서 가격에 체결한다.
  - 내려가는 구간은 가장 높은 손절·추가 매수 가격, 올라가는 구간은 가장 낮은 익절 가격으로 커서를 옮긴다.
  - 현금 부족으로 건너뛴 추가 매수 가격은 그날 제외 집합에 넣는다.
  - 전량 매도되면 종료한다.
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: Commit** — `feat(sim): daily simulation loop with conservative intraday path`

---

### Task 6: 비교 기준과 요약

**Files:**
- Create: `src/lib/sim/benchmarks.ts`, `src/lib/sim/summary.ts`
- Modify: `src/lib/sim/simulate.ts` (`simulate` 완성)
- Test: `src/lib/sim/benchmarks.test.ts`, `src/lib/sim/summary.test.ts`

**Interfaces:**
- Consumes: `CoreResult` (Task 5), `sellTaxPct` 불필요(보유는 팔지 않음)
- Produces:
  ```ts
  function holdCurve(days: string[], stocks: SimInput['stocks'], initial: number, feePct: number): number[];
  function indexCurve(days: string[], candles: Candle[], initial: number): number[] | null;   // 첫날·마지막 날 봉이 없으면 null(스펙 6.1), 중간에 빠진 날은 직전 값
  function singleCurve(days: string[], candles: Candle[], initial: number, feePct: number): number[];
  function summarize(core: CoreResult, curves: { hold: number[]; index: number[] | null; benchmark: number[] | null }, days: string[], initial: number): SimResult['summary'];
  function nearMiss(core: CoreResult): SimResult['nearMiss'];  // trades 0이고 skipped 0일 때만, 아니면 null
  ```

- [ ] **Step 1: 실패하는 테스트**
  - `holdCurve`: 2종목, 1,000만, 첫날 시가 100·200, 수수료 0 → 각 500만으로 50,000주·25,000주, 마지막 종가 110·180 → 1,000만 × (0.5×1.1 + 0.5×0.9) = 1,000만. 기간 중 상장 종목은 첫 봉 전까지 그 몫이 현금.
  - `indexCurve`: 첫날 시가 2,500, 마지막 종가 2,750 → 1,100만. 첫날 봉이 없으면 null, 중간 하루 빠지면 직전 값.
  - `summarize`: 자산 [1000, 1100, 990, 1210]만 → totalReturnPct 21, mddPct −10, round trip 손익 [+10, −5, +20]% → winRatePct 66.67, avgWinPct 15, avgLossPct −5; `vsHoldPp` = 전략 − 보유 총수익률.
  - `cagrPct`: 2023-10-11 → 2026-10-11, 총 +33.1% → 약 10.0%(소수 1자리).
  - `nearMiss is null when signals were all skipped`: trades 0, skipped 3 → null.
  - 지수를 못 받으면 `vsIndexPp` null.
- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현** — `simulate()` = `simulateCore` + 세 곡선 + `summarize` + `perSymbol`(이름은 input에서, pnl은 roundTrips 합 + 보유분 평가손익) + `benchmarks` 총수익률.
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: Commit** — `feat(sim): benchmarks and result summary`

---

### Task 7: 공급자 호출 우선순위

**Files:**
- Modify: `src/lib/providers/types.ts`, `src/lib/providers/kis.ts`, `src/lib/providers/toss.ts`, `src/lib/providers/demo.ts`
- Test: `src/lib/providers/kis.test.ts`, `src/lib/providers/toss.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface CandleQuery { /* 기존 필드 */ priority?: Priority }   // 기본 1
  getIndexCandles?(index, interval, from, to, priority?: Priority): Promise<Candle[]>;
  ```

- [ ] **Step 1: 실패하는 테스트** — 가짜 큐(`run(group, key, priority, task)`의 priority 기록)를 넣어 `getCandles({..., interval: '1d', priority: 2})`와 `getIndexCandles('KOSPI','1d',from,to,2)`가 모든 페이지 요청을 우선순위 2로 보내는지, 생략하면 1인지 KIS·토스 각각 단언.
- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현** — 지금 하드코딩된 `priority: 1`을 `q.priority ?? 1`로. 데모는 인자를 받기만 한다. 같은 요청의 dedupe 키에 우선순위를 넣지 않는다(같은 요청이면 먼저 들어온 쪽을 공유).
- [ ] **Step 4: 통과 확인** — 공급자 계약 테스트 포함 `corepack pnpm test` PASS
- [ ] **Step 5: Commit** — `feat(providers): optional request priority for daily and index candles`

---

### Task 8: 데이터 수집

**Files:**
- Create: `src/lib/sim/loadSimData.ts`
- Test: `src/lib/sim/loadSimData.test.ts`

**Interfaces:**
- Consumes: `MarketDataProvider` (priority 포함, Task 7), `resolveSymbols` (Task 1), `SimInput` (Task 1), `kstDate`·`addDays`
- Produces:
  ```ts
  interface SimMemo { get(key: string): Candle[] | undefined; set(key: string, v: Candle[]): void; clear(): void }
  function createSimMemo(): SimMemo;
  type LoadProgress = { done: number; total: number; waiting: boolean };
  type LoadOutcome =
    | { ok: true; input: SimInput; failed: { symbol: string; reason: string }[]; venueLabel: 'KRX 일봉' | '통합 일봉'; fetchedAt: number; clampedTo: string | null; indexFailed: null | '받지 못했어요' | '기간 일부만 받았어요'; benchmarkFailed: boolean }
    | { ok: false; error: unknown }          // 첫 요청(메타)부터 실패 = 연결 문제
    | { ok: false; cancelled: true };
  function loadSimData(args: {
    provider: MarketDataProvider; strategy: Strategy; symbols: string[]; now: number; memo: SimMemo;
    onProgress: (p: LoadProgress) => void; isCancelled: () => boolean;
  }): Promise<LoadOutcome>;
  ```

- [ ] **Step 1: 실패하는 테스트** (데모 공급자 + 실패를 끼워 넣는 래퍼)
  - 워밍업: 가장 긴 MA 60 → `from − 400일`, MA 250 → `from − 400일`(ceil(250×1.6)=400), MA 300 허용 안 됨(Task 1 범위) — 호출된 `from` 단언.
  - `to at or after today is clamped to yesterday`: now = 2026-10-12, to = '2026-10-12' → 호출 `to` '2026-10-11', `clampedTo` '2026-10-11'.
  - 거래일 축 = from..to 안의 (지수 날짜 ∪ 종목 날짜). 아래 세 경우 모두 종목 날짜로 축이 채워진다.
    - 지수가 실패하면 `indexFailed: '받지 못했어요'`이고 `input.index`는 null.
    - `index returns [] → axis still comes from stocks`: 지수가 `[]`로 성공하면 `indexFailed: '기간 일부만 받았어요'`.
    - `index covering only the tail is not used as a benchmark`: 지수가 기간 뒤쪽만 오면 축은 전체 기간이고 `indexFailed: '기간 일부만 받았어요'`.
  - 지수·종목 모두 기간 안에 봉이 없으면 `{ ok: false, error: new Error('기간 안에 받은 데이터가 없어요') }`이고 엔진을 부르지 않는다.
  - `a symbol with no candles in range is reported as failed, not thrown`: 빈 배열 → `failed: [{symbol, reason: '기간 안에 데이터가 없어요'}]`, 나머지 종목으로 계속.
  - 메타가 throw → `{ ok: false, error }`.
  - 진행: 메타·지수·지정 종목·종목 n개 → total = 3 + n, 순서대로 done 증가.
  - 취소: 두 번째 종목 요청 중 `isCancelled()`가 true가 되면 이후 요청 없음, `{ ok:false, cancelled:true }`.
  - 메모: 같은 키 두 번째 실행에 `getCandles` 호출 없음.
  - 우선순위: 모든 호출에 2.
  - venue: 데모(KRX 있음) → 'KRX 일봉'; venues ['UNIFIED'] 가짜 → '통합 일봉'.
- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현** — 메모 키 `${provider.id}|${symbol}|${venue}|${warmFrom}|${to}`. `waiting`은 요청 하나가 3초 넘게 걸리면 true(요청 큐의 재시도 대기를 밖에서 볼 수 없어서 시간으로 근사).
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: Commit** — `feat(sim): load daily candles for a strategy run`

---

### Task 9: 경로·진입점·전략 목록

**Files:**
- Modify: `src/lib/state/routes.ts`, `src/lib/state/app.svelte.ts` (`normalize`), `src/App.svelte`, `src/lib/ui/Rail.svelte`
- Create: `src/routes/Simulate.svelte`, `src/lib/ui/simulate/StrategyList.svelte`, `src/lib/ui/simulate/simText.ts`
- Test: `src/lib/state/routes.test.ts`(있으면 추가, 없으면 생성), `src/routes/Simulate.test.ts`, `src/lib/ui/simulate/simText.test.ts`

**Interfaces:**
- Consumes: `App.strategies`·`setStrategies` (Task 2), `newStrategy` (Task 1)
- Produces:
  ```ts
  type RouteName = ... | 'simulate';
  interface Route { /* 기존 */ strategyId?: string }
  // parseHash('#/simulate') → { name: 'simulate' }, '#/simulate/abc' → { name: 'simulate', strategyId: 'abc' }
  // simText.ts
  function strategyLine(s: Strategy, w: Watchlists): string;   // '반도체 · 2023.10.11~2026.10.11'
  function sectionSummary(s: Strategy, section: Issue['section'], w: Watchlists, benchName: string | null): string; // 목업 요약 문구
  function fmtPct(v: number, signed?: boolean): string;        // '+38.2%', '−12.4%'(U+2212)
  ```
  `Simulate.svelte` props: `{ app: App; barEnd: Snippet }`. `strategyId`가 없으면 `StrategyList`, 있으면 편집·결과(Task 10·11이 채움, 이 Task에서는 이름만 보이는 자리).

- [ ] **Step 1: 실패하는 테스트**
  - routes: 위 parseHash/hashFor 왕복, 잘못된 퍼센트 인코딩은 `{ name: 'simulate' }`.
  - Simulate(목록): 빈 상태 문구 `내 매매 규칙을 과거 데이터로 시험해 보세요`와 `＋ 새 전략`; 누르면 전략 1개 저장 + 해시 `#/simulate/<id>`; 행 메뉴 복제(이름 `… 사본`), 이름 바꾸기, 삭제 + 스낵바 `되돌리기`로 복원; 20개면 `＋ 새 전략` 누를 때 스낵바 `전략은 20개까지 저장할 수 있어요`.
  - `app.test.ts` `navigate keeps strategyId for simulate`: 전략 `abc`가 있을 때 `navigate({ name: 'simulate', strategyId: 'abc' })` → `route`·해시가 `#/simulate/abc`. `location.hash = '#/simulate/abc'` + hashchange → 같은 결과(PR #4 리뷰: 지금 `normalize`가 `{ name }`으로 줄임).
  - 없는 strategyId(또는 프로필 전환 뒤) → `normalize`가 `{ name: 'simulate' }`로 바꾸고 해시도 `#/simulate`, 화면에 스낵바 `전략을 찾을 수 없어요`.
  - App: 앱 바에 aria-label `시뮬레이션` 버튼이 설정 버튼 앞에 있고 누르면 `#/simulate`; Rail에 `시뮬레이션` 항목(설정 위), 지금 경로면 `.on`.
- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현** — 아이콘은 `App.svelte`의 설정 아이콘처럼 인라인 SVG(선 그래프 모양). 목록 행 메뉴는 기존 `Sheet`로.
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: Commit** — `feat(simulate): route, entry points and strategy list`

---

### Task 10: 전략 편집

**Files:**
- Create: `src/lib/ui/simulate/StrategyEditor.svelte`, `src/lib/ui/simulate/editor/{UniverseSection,PeriodSection,EntrySection,ScaleInSection,ExitSection,BenchmarkSection,CostSection,NumberField,PatternHelp}.svelte`
- Modify: `src/routes/Simulate.svelte`
- Test: `src/lib/ui/simulate/StrategyEditor.test.ts`

**Interfaces:**
- Consumes: `strategyIssues`, `resolveSymbols` (Task 1), `sectionSummary` (Task 9), 기존 `Toggle`, `Segmented`, `Banner`, `Sheet`, `AddStockSheet`
- Produces: `StrategyEditor` props `{ app: App; strategy: Strategy; onRun: () => void }`. 편집은 `app.setStrategies`로 500ms 디바운스 저장.
  `NumberField` props `{ label: string; value: number; min: number; max: number; step?: number; suffix?: string; onchange: (v: number) => void }` — 범위 밖이면 칸 아래 `{min}~{max} 사이로 적어 주세요`, 값은 바꾸지 않음.

- [ ] **Step 1: 실패하는 테스트**
  - 기본 전략: 구역 7개가 접힌 채 스펙 순서대로, 요약 줄 `반도체 · 2종목`, `고점 대비 10%↓ 뒤 → 3일 연속 상승 또는 B 돌파`, `끔`(분할 매수), `익절 +15% 전량 · 손절 −5% 분할 완료 후 평단`.
  - 매수 구역 열고 B 돌파를 A로 바꾸면 500ms 뒤 저장된 전략의 `breakout.level === 'A'`(가짜 타이머).
  - 익절 `＋ 단계 추가` 세 번째 뒤 버튼이 사라짐; 단계 삭제 시 마지막 단계 sellPct가 100으로.
  - `avgAlways` + 분할 매수 간격 ≥ 손절폭 → 매도 구역 안 Banner 경고, 실행 버튼은 활성.
  - 트리거 모두 끔 → Banner + 실행 버튼 누르면 실행 안 되고 첫 막는 경고로 포커스.
  - NumberField 범위 밖 입력 → 오류 문구, 저장값 그대로.
  - 종목: 그룹 고르기 / 직접 고르기(AddStockSheet 재사용, 8개 넘으면 추가 버튼 비활성 대신 스낵바 `8종목까지 넣을 수 있어요`).
  - 머리줄 `복제`: 이름 `… 사본`인 전략이 저장되고 해시가 새 id로 바뀜.
  - `PatternHelp`: `전 고점이 뭔가요?`를 누르면 A·B·L 그림(`role="img"`, `aria-label` 문구 포함)이 펼쳐짐.
- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현** — 비교 기준 지정 종목은 기존 유니버스 검색(AddStockSheet의 단일 선택 모드가 없으면 `mode: 'single'` prop을 추가해 재사용). 날짜 입력은 `<input type="date">`.
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: Commit** — `feat(simulate): strategy editor`

---

### Task 11: 실행·결과 화면

**Files:**
- Create: `src/lib/ui/simulate/RunPanel.svelte`, `src/lib/ui/simulate/ResultView.svelte`, `src/lib/ui/simulate/EquityChart.svelte`, `src/lib/ui/simulate/runController.svelte.ts`
- Modify: `src/routes/Simulate.svelte`, `src/lib/ui/simulate/simText.ts`
- Test: `src/lib/ui/simulate/runController.test.ts`, `src/lib/ui/simulate/ResultView.test.ts`, `src/lib/ui/simulate/EquityChart.test.ts`

**Interfaces:**
- Consumes: `loadSimData`, `createSimMemo` (Task 8), `simulate` (Task 6), 기존 `loadIssue.ts`의 연결 오류 문구·`연결 진단 열기` 동작, `lwcStub`
- Produces:
  ```ts
  type RunState =
    | { kind: 'idle' }
    | { kind: 'loading'; progress: LoadProgress }
    | { kind: 'partial'; failed: { symbol: string; reason: string }[]; proceed: () => void; cancel: () => void }
    | { kind: 'done'; result: SimResult; meta: { venueLabel: string; fetchedAt: number; from: string; to: string; demo: boolean; failed: { symbol: string; reason: string }[]; indexFailed: null | '받지 못했어요' | '기간 일부만 받았어요'; benchmarkFailed: boolean } }
    | { kind: 'error'; error: unknown }      // 연결 오류
    | { kind: 'crash' };                     // 엔진 예외
  interface RunController { readonly state: RunState; run(strategy: Strategy): void; cancel(): void }
  function createRunController(app: App): RunController;   // 메모는 공급자가 바뀌면 새로 만든다
  ```
  `ResultView` props `{ state: Extract<RunState, {kind:'done'}>; colorConvention: 'kr'|'global'; onEdit: () => void; onTrade: (t: Trade) => void }`.

- [ ] **Step 1: 실패하는 테스트**
  - runController: 데모 공급자로 run → loading(progress 증가) → done; 종목 하나 실패 → partial, `proceed()` 하면 그 종목 빼고 done(meta.failed에 남음), `cancel()` 하면 idle; 메타 실패 → error; `simulate`가 throw하도록 모킹 → crash(콘솔 error 1회); 진행 중 `cancel()` → idle.
  - ResultView: 머리줄 `2023.10.11 ~ 2026.10.11 · KRX 일봉 · 10/12 14:05 받음`, 데모면 `데모 데이터` 배지; 카드 4개 값과 `보유 대비 +16.1%p`; 비교 목록 4줄, `indexFailed`면 지수 줄에 그 사유 문구; 세그먼트 `거래 내역 │ 종목별 │ 건너뛴 신호 3`; 매도 행은 ▲▼ + 색 관례; 종목별 탭 `제외: ○○ (기간 안에 데이터가 없어요)`·`2024.03.02부터 참여`; 한계 안내 3줄 문구 그대로.
  - 거래 0건·skipped 0 → `기간 동안 매수 신호가 한 번도 나지 않았어요` + `가장 크게 빠진 때도 8.2%였어요(조건 10%)` + `규칙 고치기`.
  - `all-skipped result shows the dominant skip reason`: 거래 0건·skipped 3(비쌈 2, 현금 1) → `매수 신호 3번이 모두 건너뛰어졌어요` + `가장 많은 이유: 1주가 1회 금액보다 비쌈`.
  - EquityChart(lwcStub): 시리즈 4개(지수 실패면 3개), 첫 시리즈가 전략이고 굵기 2.
  - Simulate 화면: 실행 → 결과로 바뀌고 `규칙` 버튼으로 편집; PC 폭(≥1024)에서는 둘 다 보임(matchMedia 모킹).
- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현** — 결과는 컨트롤러 메모리에만 둔다(경로를 떠나면 버림). 차트 색: 전략 = 시리즈 슬롯 7, 보유 = 회색 토큰, 지정 종목 = 슬롯 1 점선, 지수 = 슬롯 2 점선.
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: Commit** — `feat(simulate): run flow and result view`

---

### Task 12: 거래 내역과 거래 차트 시트

**Files:**
- Create: `src/lib/ui/simulate/TradeList.svelte`, `src/lib/ui/simulate/TradeChartSheet.svelte`
- Modify: `src/lib/ui/simulate/ResultView.svelte`
- Test: `src/lib/ui/simulate/TradeChartSheet.test.ts`, `src/lib/ui/simulate/TradeList.test.ts`

**Interfaces:**
- Consumes: `Trade`, `SimInput['stocks']`(봉은 runController의 done 상태에 함께 보관 — `meta`에 `candles: Record<string, Candle[]>` 추가), 기존 `Sheet`, `lwcStub`
- Produces: `TradeChartSheet` props `{ open: boolean; trade: Trade | null; trades: Trade[]; candles: Candle[]; name: string; onclose: () => void }`.

- [ ] **Step 1: 실패하는 테스트**
  - TradeList 행 문구: 매수 `03.14 SK하이닉스 · B 돌파 매수 · 12주 @ 132,400`, 익절 `04.02 SK하이닉스 · 1단계 익절 50% · ▲10.0%`, 손절 `▼5.0%`; 행은 버튼이고 누르면 `onTrade(trade)`.
  - 시트: 그 포지션(같은 종목의 매수부터 전량 매도까지)의 마커 수 = 그 포지션 거래 수; 가격선 3개 제목 `A`·`B`·`L`, 값은 매수 줄 `pattern`; 표시 범위 = aDate 20거래일 전 ~ 전량 매도 20거래일 뒤(봉 배열 경계에서 자름); 보유 중 포지션이면 끝은 마지막 봉.
  - 매도 행을 눌러도 그 포지션의 매수 줄 `pattern`을 찾아 같은 시트.
- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현** — 종가 선 시리즈 + `createSeriesMarkers` + `createPriceLine`(lightweight-charts 5 API). lwcStub에 markers·priceLine 기록이 없으면 stub에 추가한다.
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: Commit** — `feat(simulate): trade list and trade chart sheet`

---

### Task 13: e2e·접근성·문서

**Files:**
- Create: `tests/e2e/simulate.spec.ts`
- Modify: `tests/e2e/a11y.spec.ts`, `docs/live-check.md`, `README.md`, `docs/superpowers/specs/2026-10-12-backtest-simulation-design.md`(상태)

- [ ] **Step 1: 실패하는 e2e** — 데모 공급자, 온보딩 끝난 상태(`tests/e2e/helpers.ts` 재사용): 앱 바 `시뮬레이션` → `＋ 새 전략` → 실행 → `총수익률` 카드 보임 → 거래 내역 첫 행 → 시트 제목에 종목명, `A`·`B`·`L` 라벨 → 닫기 → `규칙` → 편집 화면. a11y: `#/simulate`와 결과 화면에 axe 위반 0.
- [ ] **Step 2: 실행** — `corepack pnpm e2e tests/e2e/simulate.spec.ts`. 앞 Task가 모두 끝났으면 PASS가 기대값이다. FAIL이면 원인이 된 Task의 코드를 고치고, 그 Task의 단위 테스트에도 재현 테스트를 더한다.
- [ ] **Step 3: 문서**
  - `docs/live-check.md`에 ⑭(일봉·지수 일봉을 몇 년 전까지 주는가: KIS·토스 각각 2010-01-04부터 요청해 첫 봉 날짜 기록, 바꿀 곳 `loadSimData.ts` 안내 문구·기본 기간), ⑮(매도 세율표 2025년 이전 값과 적용 시작일: 증권거래세법 시행령 제5조·농어촌특별세법 제5조 원문, 바꿀 곳 `src/lib/sim/tax.ts`)를 기존 항목 형식(무엇을/어떻게/바꿀 곳/결과)으로.
  - README `주요 기능`에 `매매 규칙 시뮬레이션: 관심종목에 내 매수·매도 규칙을 적용해 과거 성과를 보유·지수·ETF와 비교` 한 줄, `문서`에 스펙·계획 링크.
  - 스펙 상태를 `구현됨 (YYYY-MM-DD)`로.
- [ ] **Step 4: 전체 확인** — `corepack pnpm test`, `corepack pnpm check`, `corepack pnpm build`, `corepack pnpm e2e` 모두 통과
- [ ] **Step 5: Commit** — `test(simulate): e2e and a11y; docs: live-check and README`

---

## 실행 순서와 의존

```
1 → 2 ─────────────────────────────┐
1 → 3 → 4 → 5 → 6 ─────────────────┼→ 9 → 10 → 11 → 12 → 13
7 → 8 (8은 1 필요) ─────────────────┘
```
엔진(3~6)과 공급자·수집(7~8)은 서로 독립이라 나란히 진행할 수 있다. 화면(9~12)은 둘 다 끝난 뒤.
