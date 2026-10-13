# 매매 규칙 시뮬레이션 다듬기 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 시뮬레이션 화면을 휴리스틱 10원칙·기존 화면과의 일관성·사용 편의성·시인성 기준으로 다듬고, 첫 구현에서 남은 버그·정확도·테스트 항목을 모두 처리한다.

**Architecture:** 엔진·로더·저장(`src/lib/sim/`)의 정확도 수정과, 화면(`src/routes/Simulate.svelte`, `src/lib/ui/simulate/**`)의 레이아웃·문구·상태 표시 수정을 나눠 진행한다. 새 기능은 만들지 않고, 기존 토큰(`src/lib/ui/tokens.css`)과 공용 컴포넌트(`src/lib/ui/components/`)를 재사용한다.

**Tech Stack:** Svelte 5(runes), TypeScript 5, Vitest 3 + @testing-library/svelte, Lightweight Charts 5, Playwright + @axe-core/playwright. 새 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-10-12-backtest-simulation-design.md` (기반: `docs/superpowers/specs/2026-10-11-stock-compare-design.md` 8장 디자인 시스템·9장 휴리스틱)
**입력:** UI 리뷰 `docs/design/2026-10-13-simulation-ui-review.md`(U1–U29, 문구 검토). 각 Task는 거기 적힌 근거(스크린샷·측정값·file:line)와 수정 방향을 따른다. 아래 Task가 리뷰와 다르게 정한 곳은 Task가 우선한다.

## Global Constraints

- 모든 명령 앞에 `export PATH=/opt/homebrew/opt/nvm/versions/node/v22.15.1/bin:$PATH` (기본 Node 18은 테스트가 깨진다). 단위 테스트는 `corepack pnpm test`(TZ=America/New_York), 타입은 `corepack pnpm check`.
- 날짜는 KST `YYYY-MM-DD`, 계산은 `src/lib/time/kst.ts`만.
- 상승·하락은 ▲▼ + `trendClass(v, colorConvention)`. 삭제·오류는 `--err`. 하락색(`--down`)을 상승·하락 외 의미로 쓰지 않는다.
- 글자 크기는 토큰(`--fs-headline` `--fs-title` `--fs-body` `--fs-sub` 등)만, 카드 모서리 `--r-card`, 좌우 여백 `--gutter`, 숫자는 `num` 클래스(tabular-nums).
- 터치 대상 최소 44×44px(기반 스펙 8.2).
- 375px 폭에서 가로 스크롤 0.
- UI 문구는 `~해요`체. 이 계획에 적힌 문구는 그대로 쓴다.
- 엔진은 미래 봉을 쓰지 않는다(기존 속성 테스트 유지).
- 새 npm 의존성 금지. 키·토큰을 로그·오류 메시지에 넣지 않는다.
- 스펙 문서와 코드가 어긋나게 바뀌면 같은 커밋에서 스펙도 고친다.

## Review Focus

1. **요청 시작일이 주말·연휴** — `(요청 …부터)`·`…부터 참여`가 거짓으로 붙으면 안 된다. → Task 4 `startsLate is false across a weekend or a 5-day holiday`.
2. **연말을 걸친 매도** — 세율은 결제일(체결일+2거래일)로 고른다. 2025-12-29 체결 매도는 2026 세율. → Task 1 `sell on 2025-12-29 uses the 2026 rate via settlement date`.
3. **375px에서 결과·로딩 화면 앱 바** — 가로 스크롤이 생기면 안 된다. e2e가 실제로 잡아야 한다. → Task 3 `no horizontal scroll at 375 in result and loading`, helper는 `viewportSize().width` 비교.
4. **넓은 화면에서 실행 뒤 규칙 변경** — 이전 결과가 최신처럼 보이면 안 된다. → Task 5 `stale result shows the rules-changed banner and reruns with the current draft`.
5. **모든 종목 요청이 네트워크 실패** — "데이터 없음"이 아니라 연결 문제와 다시 시도. → Task 5 `all stocks 받지 못했어요 shows the connection message`.

---

### Task 1: 세율 결제일 기준과 엔진 정확도

**Files:**
- Modify: `src/lib/sim/tax.ts`, `src/lib/sim/simulate.ts`, `src/lib/sim/position.ts`, `src/lib/sim/summary.ts`
- Modify: `docs/superpowers/specs/2026-10-12-backtest-simulation-design.md` 5.4, `docs/live-check.md` ⑮
- Test: `src/lib/sim/tax.test.ts`, `simulate.test.ts`, `position.test.ts`, `summary.test.ts`, `benchmarks.test.ts`

**Interfaces:**
- Produces: `function settlementDate(tradeDate: string, days: string[]): string` (tax.ts) — `days`에서 tradeDate 다음 2번째 거래일. 축 끝을 넘으면 토·일을 건너뛴 평일 +2로 근사. tradeDate가 days에 없으면 그 날짜 이후 첫 거래일을 기준으로 센다.
- `sellTaxPct(date, market, isEtf)`는 그대로(인자는 이제 결제일). 표 주석: `양도일(결제일) 기준. 증권거래세법 시행령 제5조·농어촌특별세법 제5조 연혁으로 2026-10-13 확인`.

- [ ] **Step 1: 실패하는 테스트**
  - `settlementDate('2025-12-29', ['2025-12-26','2025-12-29','2025-12-30','2026-01-02'])` → `'2026-01-02'`; 축 끝: `settlementDate('2026-10-09', ['2026-10-08','2026-10-09'])` → `'2026-10-13'`(토·일 건너뜀).
  - `sell on 2025-12-29 uses the 2026 rate via settlement date`: KOSPI 종목 매도가 2025-12-29 체결 → `tax = 매도대금 × 0.002`(0.15%가 아님).
  - tax 경계: `sellTaxPct('2023-12-31','KOSPI',false)` 0.2, `sellTaxPct('2024-12-31','KOSDAQ',false)` 0.18.
  - `Position.sell` 단계는 뒤로 가지 않음: `sell(q,2)` 뒤 `sell(q,1)` → `stagesDone === 2`.
  - 매수 비용 한 번 계산: 현금 = 정확히 비용과 같을 때 매수 뒤 `cash === 0`(음수 아님, `toBe(0)`).
  - 시가 == 손절선이면 `kind: 'stop'`(gapStop 아님), 시가 < 손절선이면 `gapStop`.
  - look-ahead 속성 테스트에 워밍업 봉 20개와 한 종목의 기간 중 빠진 날 3일을 넣는다(기존 테스트 확장).
  - `holdCurve` 테스트에 첫날 값(= 초기 자금 − 수수료 − 나머지 현금 아님: 주식 수 50,000·25,000에서 나오는 값) 단언, MDD가 초기 자금에서 시작한다는 테스트(첫날 자산 < 초기 자금 → mdd 음수).
- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현** — simulate.ts의 매도 세금 조회를 `sellTaxPct(settlementDate(date, input.days), …)`로. simulate.ts 지역 `ret`는 summary의 `retPct`를 export해 재사용. Position.sell은 `stagesDone = Math.max(stagesDone, stage)`. 매수 비용은 `sizeBuy`가 cost를 돌려주고 그 값을 차감. 갭 라벨은 엄격 비교. 스펙 5.4 표 제목 `매도일` → `결제일(체결일+2거래일)`, 표 아래 문장을 결제일 기준으로 고치고 "확인 필요" 표기를 "2026-10-13 법령 연혁으로 확인"으로. live-check ⑮ `결과:` 줄에 확인 결과(값 7행 모두 법령 확인, 기준은 결제일, 출처 law.go.kr 시행령 제5조 연혁 lsiSeq 191570·208731·225167·247529·282431, 농어촌특별세법 제5조·시행령 제5조)를 적는다.
- [ ] **Step 4: 통과 확인** — `corepack pnpm vitest run src/lib/sim` PASS, `corepack pnpm check` 0
- [ ] **Step 5: Commit** — `fix(sim): sell tax by settlement date, exact buy cost, stage and gap edge cases`

---

### Task 2: 검증·로더·저장 정리

**Files:**
- Modify: `src/lib/sim/validate.ts`, `src/lib/sim/loadSimData.ts`, `src/lib/sim/strategyStore.ts`, `src/lib/state/app.svelte.ts`(setStrategies 한도 헬퍼), `src/lib/state/exportImport.test.ts`, `src/lib/providers/kis.test.ts`, `src/lib/providers/toss.test.ts`, spec 3.1
- Test: `validate.test.ts`, `loadSimData.test.ts`, `strategyStore.test.ts`

**Interfaces:**
- Produces: `assertStrategyCap(list: Strategy[]): void` (strategyStore.ts, `'전략은 20개까지 저장할 수 있어요'`) — app.svelte.ts와 saveStrategies가 함께 씀.
- `LoadOutcome` 변경: `{ ok: false; noData: true; failed: SimFailure[] }`(failed 추가), `clampedTo` 필드 제거.
- validate의 막는 경고 문구 변경: `사는 신호가 하나도 켜져 있지 않아요. ②에서 하나 이상 켜 주세요` (스펙 3.1도 같이). 새 비차단 경고(section `entry`): `단기선 기간이 장기선보다 짧아야 해요` — goldenCross가 켜져 있고 `short >= long`일 때.

- [ ] **Step 1: 실패하는 테스트**
  - `sanitizeStrategies`가 `period.from: '2026-02-30'`, `'2026-99-99'`를 불가능한 날짜로 보고 기본값 + repaired.
  - goldenCross 5/5 → 위 경고(blocking false). 꺼져 있으면 없음.
  - sanitize가 항목 수와 무관하게 기본값 생성을 한 번만 한다(`vi.spyOn(crypto,'randomUUID')` 호출 수가 항목마다 늘지 않음).
  - loadSimData: `from > 어제`(오늘 이후 시작) → 공급자 호출 0회, `{ok:false,noData:true,failed:[]}`; `capabilities.venues: []` → `venueLabel 'KRX 일봉'`로 KRX 사용; 메타 뒤·메모 적중 시·waiting 중 취소 각각 → 이후 호출 0, `vi.getTimerCount() === 0`; 모든 종목 실패 + 지수 없음 → noData에 failed 목록.
  - strategyStore: `assertStrategyCap`이 21개에서 위 문구로 throw; exportImport "옛 파일" 테스트는 저장값이 정확히 `{ strategies: [] }`; 가져오기 파일에 전략 21개·중복 id → 20개·중복 제거.
  - kis.test 지수 분봉 테스트의 `.catch(() => {})` 제거하고 실제로 성공하도록 fixture 보강; toss: 같은 요청 두 번(우선순위 2, 1)이 데이터 호출 1회.
- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현** — 날짜 검증은 `kstEpoch(date,'00:00:00')`로 만든 날짜를 다시 `kstDate`로 돌렸을 때 같은지. 기본값은 모듈 수준에서 한 번 만든 템플릿을 `structuredClone`. `clampedTo`를 쓰던 테스트는 `meta.to`/호출 `to` 단언으로 바꾼다.
- [ ] **Step 4: 통과 확인** — 단위 전체 PASS, check 0
- [ ] **Step 5: Commit** — `fix(sim): stricter validation, loader edge cases, shared strategy cap`

---

### Task 3: 앱 바·이동 (U1, U3, U25, U28)

**Files:**
- Modify: `src/App.svelte`, `src/routes/Simulate.svelte`, `src/lib/ui/StatusChip.svelte`(필요 시), `tests/e2e/helpers.ts`, `tests/e2e/simulate.spec.ts`, spec 7.1·7.3·7.4
- Test: `src/routes/Simulate.test.ts`, `src/App.test.ts`(없으면 Simulate.test.ts 안에서)

**Interfaces:**
- `barEnd` snippet이 인자 `compact: boolean`을 받는다. `compact`이면 StatusChip을 그리지 않는다. Simulate는 `matchMedia('(max-width: 599px)')`이 맞을 때 `compact = true`로 부른다. Compare·Settings 호출은 그대로(`compact` false).
- 편집 화면 제목은 고정 `시뮬레이션`(이름은 이름 입력 칸에). 목록 화면 제목 `시뮬레이션`. 제목 `.title { flex: 1 1 auto; min-width: 0 }`.
- 좁은 화면: 결과 보기에서 바에 `규칙`, 편집 보기에서 실행 상태가 done 또는 loading이면 바에 `결과`(같은 `.rules` 스타일). `결과`를 누르면 결과 보기로.
- 앱 바 시뮬레이션 아이콘: `#/simulate*`에서 `aria-current="page"` + `.on` 배경(레일과 같은 토큰). 섹션 셰브런은 회전하는 `▾`(EditorSection에서 처리 — Task 6과 겹치면 Task 6이 소유).
- 스펙: 7.3 `복제`는 이름 칸 옆(머리줄 아님)으로, 7.4에 좁은 화면 `결과` 버튼과 compact 바 추가, 7.1에 아이콘 현재 위치 표시.

- [ ] **Step 1: 실패하는 테스트**
  - 컴포넌트: 좁은 화면(matchMedia 모킹)에서 Simulate의 바에 StatusChip이 없고, 넓은 화면에서는 있다.
  - 좁은 화면: 실행 → 결과 → `규칙` → 편집 화면 바에 `결과` 버튼 → 누르면 결과.
  - 앱 바 아이콘 `aria-current="page"`.
  - e2e `no horizontal scroll at 375 in result and loading`: helper `expectNoHorizontalScroll(page)`가 `document.documentElement.scrollWidth <= page.viewportSize()!.width`를 단언하고, 목록·편집·로딩(universe 응답 지연)·결과 4상태에서 호출.
- [ ] **Step 2: 실패 확인** — 단위 FAIL, e2e는 phone 프로젝트에서 FAIL(현재 386px)
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — 단위 PASS, `corepack pnpm e2e tests/e2e/simulate.spec.ts` 4개 프로젝트 PASS
- [ ] **Step 5: Commit** — `fix(simulate): compact app bar on phones and a way back to the result`

---

### Task 4: 결과 기간 표시와 결과 영역 (B1, U27, U16, U29, U20, U21, U23 일부, M15, 문구)

**Files:**
- Modify: `src/lib/ui/simulate/simText.ts`, `ResultView.svelte`, `SymbolTab.svelte`, `SkipList.svelte`, `TradeList.svelte`(0 판정만), spec 7.4
- Test: `simText.test.ts`, `ResultView.test.ts`

**Interfaces:**
- Produces: `function startsLate(actualStart: string, requestedFrom: string): boolean` (simText.ts) — 두 날짜 차이가 **7일 초과**일 때만 true(주말·명절 연휴를 거짓 표시하지 않는 규칙). `resultHeadline`의 `(요청 …부터)`와 SymbolTab의 `…부터 참여` 둘 다 이 함수를 쓴다. SymbolTab은 `startsLate(p.firstDate, meta.from)`(실제 축 시작과 비교 — 축이 통째로 늦은 경우는 머리줄이 이미 알림).
- `trendReturn(v, conv)`는 반올림한 값(소수 1자리)이 0이면 화살표·색 없음. TradeList의 0 판정도 숫자로.
- 결과 카드: `--r-card` 무테, 총수익률 값 `--fs-headline`, 나머지 셋 `--fs-title`, 라벨·부가 줄 `--fs-sub`, 여백 `16px var(--gutter)`, 숫자 `num`.
- 문구(그대로):
  - 카드 부가 `그냥 보유보다 {±x.x}%p`; 거래 카드 부가 `끝난 {n}번 · 아직 보유 {m}종목 · 평균 {d}일`(보유 0이면 `끝난 {n}번 · 평균 {d}일`).
  - 비교 기준 행 `같은 종목 사서 보유`.
  - 건너뛴 신호 0개 탭: `건너뛴 신호가 없어요`.
  - 전부 건너뜀: 제목 `매수 신호가 {n}번 났지만 한 번도 사지 못했어요`; 사유별 개수 목록(사유 표시 매핑: `현금 부족`→`현금이 모자랐어요`, `1주가 1회 금액보다 비쌈`→`1주가 회당 금액보다 비싸요`, `거래 없음`→`그날 거래가 없었어요`); 가장 많은 사유가 현금·금액이면 안내 `기간·자금에서 회당 비중이나 처음 자금을 늘려 보세요`, `규칙 고치기`가 기간·자금 구역을 연다(Simulate → editor에 열 구역 전달: `onEdit(section?: Issue['section'])`).
  - nearMiss: ① `고점 대비 가장 크게 빠진 때도 {x}%라, 하락 조건({y}% 이상)에 닿지 않았어요` ② `충분히 떨어진 날은 {n}일 있었지만, 그 뒤 ②의 사는 신호(연속 상승·돌파 등)가 한 번도 나오지 않았어요` ③ days 조건 때문일 때 `고점 뒤 {n}거래일 넘게 떨어진 적이 없었어요(조건 {n}일 이상)`.
- 스펙 7.4: 위 문구와 7일 규칙 반영.

- [ ] **Step 1: 실패하는 테스트**
  - `startsLate is false across a weekend or a 5-day holiday`: `startsLate('2026-03-02','2026-03-01')` false, `startsLate('2026-09-29','2026-09-24')` false, `startsLate('2025-01-02','2023-10-12')` true.
  - 머리줄: 요청 from이 일요일이면 `(요청` 없음. 종목별: 모든 종목 firstDate == meta.from이면 `부터 참여` 없음, 한 종목만 3개월 늦으면 그 행만.
  - 카드 문구·클래스(`--r-card` 대신 클래스명으로), `trendReturn(0.04)` 화살표 없음, 건너뜀 0개 문구, 전부 건너뜀 사유별 개수와 안내·`규칙 고치기`가 `onEdit('capital')`(또는 기간·자금 섹션 키) 호출, nearMiss 세 문구.
- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — PASS, check 0
- [ ] **Step 5: Commit** — `fix(simulate): honest period notes, result cards on tokens, clearer empty and skipped states`

---

### Task 5: 실행 상태와 진행 표시 (U2/M20, M11, M12, M14, U18, U19)

**Files:**
- Modify: `src/lib/ui/simulate/runController.svelte.ts`, `RunPanel.svelte`, `src/routes/Simulate.svelte`, `src/lib/ui/compare/loadIssue.ts`, `src/lib/ui/compare/compareController.svelte.ts`(META_ERROR 재수출만), spec 7.5
- Test: `runController.test.ts`, `RunPanel.test.ts`, `src/routes/Simulate.test.ts`

**Interfaces:**
- Produces: `function rulesChanged(a: Strategy, b: Strategy): boolean` (strategyActions.svelte.ts 또는 simText.ts) — `id`·`name`·`updatedAt`을 빼고 깊이 비교.
- `META_ERROR`는 `loadIssue.ts`로 옮기고 compareController는 재수출. RunPanel은 loadIssue에서 가져온다.
- RunState에 연결 실패 구분: 모든 실패 사유가 `받지 못했어요`이고 남은 종목이 0이면 `{ kind: 'error', error }` 계열로 연결 문제 문구 + `다시 시도`(현재 draft로 재실행). 그 밖의 noData는 그대로.
- partial 문구는 사유별: 받지 못한 종목만이면 `{names} 일봉을 받지 못했어요. 빼고 계속할까요?`, 기간 안 데이터 없음만이면 `{names}은(는) 이 기간에 데이터가 없어요. 빼고 계속할까요?`, 섞이면 두 줄.
- 진행: total 0이면 `일봉 받는 중`만(숫자 없음); 부가 줄 `종목 {n}개 · 지수 · 비교 기준`(비교 종목 없으면 `종목 {n}개 · 지수`); 트랙 `--line`.
- 넓은 화면 idle: `규칙을 정하고 시뮬레이션 실행을 누르면 여기에 결과가 나와요`.
- 넓은 화면에서 done 결과의 `meta.strategy`와 현재 draft가 `rulesChanged`면 결과 위에 공용 `Banner`(info) `규칙이 바뀌었어요. 다시 실행하면 결과에 반영돼요` + 액션 `다시 실행`(현재 draft), 결과 본문 opacity .5. 오류·crash의 `다시 실행`도 현재 draft로. Simulate가 editor의 draft를 알도록 `StrategyEditor`에 `ondraft(draft)` 콜백 추가.
- 스펙 7.5에 위 상태·문구 추가.

- [ ] **Step 1: 실패하는 테스트** — `stale result shows the rules-changed banner and reruns with the current draft`(넓은 화면, 실행 → 하락폭 수정 → 배너 → `다시 실행` → run 인자가 새 draft); `all stocks 받지 못했어요 shows the connection message`; partial 문구 3가지; 진행 0/0 숨김과 부가 줄; idle 힌트; RunPanel이 compareController를 import하지 않음(모듈 그래프 대신 loadIssue에서 META_ERROR import 확인 — 단순히 import 경로 변경 + 기존 테스트 통과).
- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — PASS, check 0, `src/lib/ui/compare` 테스트 포함
- [ ] **Step 5: Commit** — `fix(simulate): stale-result banner, connection vs no-data, clearer progress`

---

### Task 6: 전략 편집 레이아웃·입력 (U5–U13 편집 부분, U22, U26, M17–M19, 문구)

**Files:**
- Modify: `src/lib/ui/simulate/StrategyEditor.svelte`, `editor/*.svelte`(EditorSection, NumberField, EntrySection, ExitSection, PeriodSection, ScaleInSection, CostSection, BenchmarkSection, UniverseSection, PatternHelp), `src/lib/ui/components/Segmented.svelte`(`onSurface` 변형), `src/lib/ui/simulate/simText.ts`(요약 문구), `src/lib/ui/simulate/strategyActions.svelte.ts`(이중 clone), spec 7.3
- Test: `StrategyEditor.test.ts`, `src/lib/ui/components/Segmented.test.ts`, `simText.test.ts`

**Interfaces / 결정:**
- 행 구조는 설정 화면 `.row` 패턴: `라벨 · 숫자 칸 · 오른쪽 토글`. 라벨 `word-break: keep-all`. 라벨을 누르면 토글이 바뀐다(`<label>`이 토글 입력과 연결).
- NumberField: `.box`를 `<label for>`로 만들어 박스 어디를 눌러도 입력에 포커스, 높이 44px 이상; 입력 폭 `7ch`, `.box min-width: 128px`; 새 prop `muted: boolean`(opacity .5, 입력은 계속 편집 가능); 새 prop `format?: 'won'` — 포커스가 아닐 때 `fmtWon`(천 단위) 표시, 아래 힌트 `= {simText.money(v)}`; 정수 칸에 소수 입력이면 `정수로 적어 주세요`; 범위 오류의 min/max는 `format === 'won'`이면 `fmtWon`.
- 꺼진 조건의 숫자 칸·A/B 세그먼트·골든크로스 칸은 `muted`.
- EditorSection 헤더: 두 줄(제목 / 요약 `--fs-sub` 2줄 clamp, 왼쪽 정렬), 셰브런은 회전하는 `▾`로 `grid-column: -2/-1` 고정; 막는 경고 `!`(`--err`), 비차단 경고 `△`(`--warn` 계열 기존 토큰); 헤더 버튼 안에 sr-only `· 고쳐야 실행돼요` / `· 확인할 점이 있어요`; 접힌 상태에서는 `aria-controls`를 빼거나 패널을 hidden으로 렌더.
- 분할 매수가 켜져 있으면 자금 부족 경고를 기간·자금과 분할 매수 두 구역에 모두 보인다.
- 삭제 버튼 색 `--err`. 익절 단계 삭제는 단계 제목 줄 끝 ✕(UniverseSection `.x` 재사용, aria-label `{k}단계 삭제`).
- PeriodSection 날짜 그리드 `minmax(0,1fr) minmax(0,1fr)`, 입력 `width:100%; min-width:0`.
- Segmented `onSurface` 변형: 트랙 `--bg`, 선택 `--surface2` — 편집 카드 안 세그먼트에 사용.
- 손절 기준 라벨 `분할 후 평단 / 매번 평단 / 첫 매수가`, 힌트 `평단 = 평균 매수가예요. 분할 매수를 끄면 세 기준이 같아요`; 분할 매수가 꺼져 있으면 요약에서 기준 생략.
- 요약·라벨 문구(그대로): `사는 신호 없음`; `고점 대비 {x}% 하락 뒤 → …`; `익절 +15%에 50% → +25%에 25% → +35%에 나머지`(단일 단계는 `익절 +15%에 전량`); `{x}% 내릴 때마다 최대 {n}번 더`; `수수료 {x}% · 팔 때 세금 포함`; 기간·자금 칸 `회당 매수 비중` / 접미 `% (처음 자금 대비)`; PatternHelp `마지막으로 전량 판 뒤(처음이면 기간 시작부터)`.
- pagehide에서 flush. flush가 전략 전체를 덮어쓴다는 불변식 주석(목록과 편집이 동시에 열리지 않음, 실행은 전략을 쓰지 않음).
- strategyActions의 `structuredClone($state.snapshot(s))` → `$state.snapshot(s)`.
- 숫자에 tabular-nums(U23): NumberField 입력, `.sum`, `.why`에 `num` 클래스 또는 `font-variant-numeric: tabular-nums`. (결과 쪽 `.cards small`은 Task 4, 시트 `.summary`는 Task 8)

- [ ] **Step 1: 실패하는 테스트** — 라벨 클릭이 토글을 바꿈; 꺼진 조건 칸 `muted`; `.box` 클릭이 입력에 포커스; 금액 칸 비포커스 표시 `10,000,000`과 힌트 `= 1,000만 원`; 정수 칸 `3.5` → `정수로 적어 주세요`; 헤더 sr-only 문구 두 가지와 경고 글리프 구분; 분할 매수 켜면 자금 경고가 두 구역에; 삭제 버튼에 `--err`를 쓰는 클래스; 손절 라벨·힌트·요약 생략; 요약 문구 전부; pagehide → setStrategies 호출; Segmented onSurface 클래스.
- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — PASS, check 0
- [ ] **Step 5: Commit** — `fix(simulate): editor rows follow settings pattern, bigger targets, readable money and warnings`

---

### Task 7: 전략 목록 (U13 목록, U17, M21, M22, 삭제 문구)

**Files:**
- Modify: `src/lib/ui/simulate/StrategyList.svelte`, `strategyActions.svelte.ts`, `src/routes/Simulate.svelte`(없는 전략 스낵바), `src/lib/ui/Rail.svelte` 테스트
- Test: `src/routes/Simulate.test.ts`, `src/lib/ui/Rail.test.ts`(없으면 Simulate.test.ts)

**Interfaces:**
- Produces: `function nextStrategyName(list: Strategy[], base = '새 전략'): string` — `새 전략`이 없으면 그대로, 있으면 `새 전략 2`, `새 전략 3`…(빈 번호 중 가장 작은 것).
- 삭제 색 `--err`. 삭제 스낵바 `'{name}'을(를) 삭제했어요`(groupActions와 같게). 이름 바꾸기에서 빈 이름 Enter는 `이름을 적어 주세요` 오류를 칸 아래에.

- [ ] **Step 1: 실패하는 테스트** — 연속 생성 이름 `새 전략`, `새 전략 2`; 삭제 스낵바 문구; 빈 이름 Enter 오류; 20개에서 복제 → 한도 스낵바; 20개에서 되돌리기 → 복원되지 않고 한도 스낵바; 레일에서 `시뮬레이션`이 `설정` 바로 앞; 프로필 전환으로 없는 전략 경로가 되면 `전략을 찾을 수 없어요` 스낵바가 보임(필요하면 `tick()` 뒤 표시로 수정).
- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: Commit** — `fix(simulate): numbered new strategies, delete styling and copy, list edge cases`

---

### Task 8: 차트와 거래 내역 (U4, U14, U15, U24, M13, M23, M24, 스펙 7.4 색)

**Files:**
- Modify: `src/lib/ui/simulate/EquityChart.svelte`, `TradeChartSheet.svelte`, `TradeList.svelte`, `ResultView.svelte`(비교 기준 견본), `src/lib/chart/lwcStub.ts`, `tests/e2e/simulate.spec.ts`, spec 7.4
- Test: `EquityChart.test.ts`, `TradeChartSheet.test.ts`, `TradeList.test.ts`

**Interfaces / 결정:**
- 자산 곡선 색: 전략 `--accent`(굵기 2, 실선), 같은 종목 보유 `--t3`(1, 실선), 지정 종목 `--s1`(**굵기 2**, 점선), 지수 `--t2`(1.5, 점선). 범례 견본에 실선/점선 구분. `scaleMargins.top .1`. 비교 기준 행에도 같은 견본. 테마가 바뀌면(`app.settings.theme` prop) 색을 다시 적용(CompareChart와 같은 방식). 스펙 7.4 색 문장 고침.
- 거래 차트 시트: `rightPriceScale.scaleMargins {top:.12,bottom:.22}`; 같은 방향 마커가 3봉 이내면 하나로 합쳐 `매수·추가`(또는 `익절·손절`); 고른 돌파 기준선만 `--accent`, A/B 중 다른 하나는 `--t3`, L은 `SparseDotted` + `axisLabelVisible:false`; 제목 `{종목명} · {YY.MM.DD} 매수`; 요약 날짜는 `MM.DD`, 각 단계는 nowrap span, 끝에 결과 `trendReturn`(보유 중이면 `보유 중`).
- 거래 내역: Leaderboard 행 구조 — 1줄 종목명 + 오른쪽 정렬 `num` 값(매도: `trendReturn(pnlPct)`, 매수·추가: `{qty}주 · {fmtWon(price)}원`), 2줄 `MM.DD · {사유}` `--t3`, 행 끝 `›`; 해가 바뀌면 설정 화면 `h2` 스타일의 연도 구분선(`2025년`). 익절 사유 표시 `1단계 익절(80% 매도)`.
- e2e: 종목명은 행 버튼의 접근 가능한 이름에서 읽는다(`.name` 클래스 대신).
- lwcStub: 테스트 사이 `seriesByApi` 정리 함수 `resetLwcStub()`를 export하고 기존 `lwcCharts.length = 0` 지점에서 함께 호출.

- [ ] **Step 1: 실패하는 테스트** — 시리즈 색·굵기·스타일; 테마 prop 변경 시 applyOptions 호출; 파괴 시 `removed`; 시트 scaleMargins·마커 병합(같은 날 매수+다음날 추가 → 마커 1개 `매수·추가`)·가격선 색과 스타일·제목·요약 형식; 거래 내역 행 이름·값·연도 구분선·`›`.
- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — PASS, e2e simulate 4개 프로젝트 PASS
- [ ] **Step 5: Commit** — `fix(simulate): readable charts and a scannable trade list`

---

### Task 9: 전체 확인·화면 재검토·문서

**Files:**
- Modify: `docs/design/2026-10-13-simulation-ui-review.md`(각 U 항목 처리 결과 표 추가), `README.md`(필요 시), spec 상태 줄

- [ ] **Step 1:** `corepack pnpm test`, `corepack pnpm check`, `corepack pnpm build`, `corepack pnpm e2e` 전부 PASS.
- [ ] **Step 2:** 리뷰와 같은 방식(Playwright 375·1440, 라이트·다크)으로 스크린샷을 다시 찍어(스크래치패드) U1–U29 각각이 해결됐는지 확인하고, 리뷰 문서 끝에 `## 처리 결과` 표(U번호 · 처리 · 확인 스크린샷 이름 또는 테스트 이름)를 붙인다. 해결 못 한 항목은 이유와 함께 남긴다.
- [ ] **Step 3: Commit** — `docs(simulate): UI review resolution record`

---

## 실행 순서

1 → 2 (엔진·데이터) → 3 → 4 → 5 → 6 → 7 → 8 → 9. 화면 Task는 같은 파일(Simulate.svelte, ResultView.svelte, simText.ts)을 건드리므로 순서대로 한다.
