# 선정 기준 4단계(환율·유가 영향도와 테마) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 선정 기준에 원/달러·WTI 민감도(β)와 흐름 따라가기 조건, KIS 테마와 내 묶음으로 넓히는 후보 범위를 더한다. 1단계와 같은 방식으로, 과거 시점 기준으로 검증할 수 있게 한다.

**Architecture:**
- 수집기가 FRED CSV와 `theme_code.mst`를 함께 받아 데이터 파일 v2를 만든다.
- 앱은 v1·v2를 모두 받는다.
- precompute는 계열별 정렬 배열과 종목별 롤링 β를 더 계산한다. selectAt은 합집합 후보 범위와 macro 조건을 적용한다.
- 내 묶음은 프로필별 새 엔티티다.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest(+fake-indexeddb), Node 22 `node:test`, Playwright + axe.

**Spec:** docs/superpowers/specs/2026-10-16-macro-theme-criteria-design.md (기반 docs/superpowers/specs/2026-10-16-selection-criteria-validation-design.md)

## Global Constraints

**의존성·보안**
- 새 런타임 의존성은 넣지 않는다.
- 프록시 허용 목록은 바꾸지 않는다.
- 키·토큰은 로그·오류·파일·URL 어디에도 넣지 않는다. FRED와 마스터 파일 요청에는 키를 붙이지 않는다.

**미래 정보 차단**
- 재선정일 d의 전 거래일 p까지의 봉만 쓴다.
- FRED 값은 공개 시점 규칙 `macroKnownFrom(series, t) ≤ 봉 날짜`인 값 중 관측일이 가장 늦은 값만 쓴다(스펙 2.3).
  - 원/달러: 관측일이 속한 주 월요일 + 9일.
  - WTI: 관측 다음 날 이후 첫 수요일 + 2일.
- 변화율은 두 값이 모두 0보다 클 때만 계산한다(스펙 3.1·3.2). 0 이하이거나 유한하지 않은 쌍은 뺀다.

**기본값과 범위**

| 항목 | 기본값 | 범위 |
|---|---|---|
| `betaDays` | 120 | 30~250 |
| `beta` | 끔, min 0.3, max 5 | −20~20 |
| `trend` | 끔, lookback 20, thresholdPct 3, minAbsBeta 0.3, whenFlat `'pass'` | lookback 5~120, thresholdPct 0.5~50, minAbsBeta 0~20 |

- β는 쌍이 `betaDays × 0.8`개보다 적으면 계산하지 않는다.
- 내 묶음: 최대 30개, 이름 30자, 종목 1~300.

**파일 형식**
- `version: 2`이고 `macro` `{usdkrw, wti}: {d, v}`와 `themes` `{code, name, symbols}[]`를 더한다.
- v1도 받는다. 3 이상은 `version-newer`다.

**문구**
- 스펙 5장과 7장의 문구를 그대로 쓴다. `다시 수집하면 쓸 수 있어요`, β 설명, 흐름 설명, `themeSnapshot`·`macroGap` 메모 등이다.

**기존 동작 보존**
- 업종만 고른 기존 기준, 매매 규칙 시뮬레이션, 공유 컴포넌트의 기본 동작은 그대로다.

**검증 명령**
- 모든 pnpm 명령 앞에 `export PATH=/opt/homebrew/opt/nvm/versions/node/v22.15.1/bin:$PATH`를 붙인다.
- `corepack pnpm test`, `check`, `check:e2e`, `build`, `e2e`(먼저 4173 포트가 비어 있는지 확인), `test:scripts`.

## Review Focus
1. **FRED 공개 시점 누설.** 두 계열은 주 단위로 공개된다. 관측일이 p보다 앞서도 p까지 공개되지 않은 값(`knownFrom > p`)을 쓰면 미래 정보가 섞인다. 그런 값을 극단값으로 바꿔도 결과가 같아야 한다(Task 4).
2. **β 롤링 정확도.** 누적합 방식은 뺄셈 오차와 창 경계 실수가 나기 쉽다. 직접 계산한 값과 창마다 비교해야 한다(Task 4).
3. **합집합 회귀.** 업종만 고른 기존 기준의 결과가 바뀌면 안 된다(Task 4).
4. **v1 데이터 사용자.** 다시 수집하지 않은 사용자의 기존 검증이 막히면 안 되고, 새 조건만 꺼져야 한다(Task 3, 6).
5. **FRED 실패.** 네트워크 실패로 수집 전체가 멈추면 안 된다. macro는 빈 계열로 두고 요약에 남긴다(Task 2).
6. **0 이하 계열 값.** WTI 2020-04-20(−36.98)처럼 0 이하 값이 끼면 변화율의 방향이 뒤집히거나 무한대가 된다. 그 쌍은 빼고 β는 유한해야 한다(Task 4).

---

### Task 1: 파일 형식 v2와 파서

**Files:**
- Modify: `src/lib/marketData/format.ts`
- Create: `scripts/fetch-fred.mjs`, `scripts/parse-theme.mjs`
- Test:
  - `src/lib/marketData/format.test.ts`
  - `tests/fetch-fred.test.mjs`
  - `tests/parse-theme.test.mjs`
  - fixture `tests/fixtures/theme_code.sample.mst`(실제 파일 2~3행)

**Interfaces:**
- Produces:
  - `MarketDataFile = MarketDataFileV1 | MarketDataFileV2`
  - `isV2(f): f is MarketDataFileV2`
  - `validateMarketData`는 v1과 v2를 모두 받는다. v2 검사는 스펙 2.2를 따른다.
  - `fetchFredSeries(id: string, { fetchImpl, from?: 'YYYY-MM-DD', to?, now?, sleep? }) → Promise<{ d: string[]; v: number[] }>`
    - CSV 헤더는 `observation_date,<ID>`다(2026-10-16 실제 응답 확인). 예전 형식 `DATE,<ID>`도 받는다. 행은 `YYYY-MM-DD,값`이고 `.` 값은 버린다.
    - 20초 시간 제한, 최대 3번 시도.
  - `parseThemes(bytes: Uint8Array) → { code: string; name: string; symbols: string[] }[]`
    - 행 폭은 실제 파일로 확인해 정한다.
    - 종목코드는 6자리로 정규화한다(앞의 `A` 등 접두를 뗀다).
    - 같은 테마의 행은 묶는다.

- [ ] **Step 1:** 실패하는 테스트를 쓴다.
  - v2 정상 파일은 ok다.
  - macro 길이 불일치, 날짜 역순, 환율 ≤ 0, WTI NaN은 corrupt다.
  - WTI 음수는 ok다.
  - version 3은 `version-newer`다.
  - v1은 여전히 ok다.
  - FRED CSV: `observation_date` 헤더와 `DATE` 헤더 둘 다, `.` 값을 버리는지, 기간 필터, 재시도 뒤 성공, 3번 모두 실패하면 throw하는지. fixture는 실제 응답 첫 줄 형식 그대로 쓴다.
  - 테마 fixture 파싱, `A` 접두 정규화.
- [ ] **Step 2:** RED를 확인하고, 구현한 뒤 GREEN을 확인한다. 테마 행 폭은 실제 `theme_code.mst.zip`을 scratchpad에서 받아 확인하고, 그 결과를 스펙 2.1에 적는다.
- [ ] **Step 3:** 커밋한다. `feat(data): market-data v2 format with macro series and themes; FRED and theme parsers`

### Task 2: 수집기 v2

**Files:**
- Modify: `scripts/collect-market-data.mjs`, `scripts/make-demo-market-data.mjs`
- Regenerate: `tests/fixtures/market-data-demo.json.gz`
- Test: `tests/collect-market-data.test.mjs`

**Interfaces:**
- Consumes: Task 1의 함수들.
- Produces:
  - `collect(...)`이 v2 파일을 쓴다.
    - macro 기간은 일봉 수집 범위 시작 1년 전부터 끝까지다. β 워밍업을 위해서다.
    - FRED 실패 시 그 계열은 `{d:[], v:[]}`로 두고 요약에 `환율·유가를 받지 못했어요`를 남긴다. 수집은 계속한다.
    - 테마는 파일에 있는 종목만 남기고, 빈 테마는 버린다.
  - `--update`에 v1 파일을 주면 결과가 v2다.
  - 요약 줄 `환율 n일 · 유가 n일 · 테마 n개`.
  - 데모 생성기는 v2로 만든다.
    - 합성 macro를 넣는다.
    - 종목 5개는 β가 약 +1.5가 되도록 환율과 상관시키고, 3개는 약 −1.0이 되도록 만든다.
    - 테마 3개를 넣는다. 그중 하나는 KOSPI와 KOSDAQ 종목을 섞는다.
    - 출력은 결정적이어야 한다(같은 입력이면 같은 바이트).

- [ ] **Step 1:** 실패하는 테스트를 쓴다(가짜 fetch).
  - v2 출력이 `validateMarketData` 규칙을 통과한다(스크립트 쪽 동일 검사).
  - FRED가 3번 모두 실패하면 빈 계열이고, 요약 문구가 있고, 종목 수집은 정상이다.
  - 테마 필터: 파일에 없는 종목은 빠지고, 빈 테마는 버린다.
  - v1 파일을 `--update`하면 v2가 된다.
  - 키와 토큰이 새 경로의 로그와 파일에도 없다(기존 (d) 검사를 넓힌다).
- [ ] **Step 2:** RED를 확인하고, 구현한 뒤 GREEN을 확인한다. 데모 fixture를 다시 만들고, 두 번 생성해 바이트가 같은지 확인한다.
- [ ] **Step 3:** 커밋한다. `feat(scripts): collect FRED USD/KRW and WTI plus KIS themes into market-data v2`

### Task 3: 앱 저장소와 v1 호환

**Files:**
- Modify: `src/lib/marketData/store.ts`, `src/lib/ui/settings/DataTools.svelte`
- Test: `store.test.ts`, `DataTools.test.ts`

**Interfaces:**
- Produces:
  - `store.themes(): Promise<{ code; name; count }[]>`. `current-themes` 보조 키에서 읽고, 같은 트랜잭션에서 쓴다. 롤백 테스트를 세 키에서 네 키로 늘린다.
  - `info()`에 `version: 1 | 2`와 `hasMacro: boolean`을 더한다.
  - DataTools 요약 줄은 v2일 때 `· 환율·유가·테마 포함`을 붙이고, v1일 때 `· 다시 수집하면 환율·유가·테마도 쓸 수 있어요`를 붙인다.
  - 예전에 가져와서 `current-themes` 키가 없으면 본문에서 읽는다(1단계 `sectors()`와 같은 방식).

- [ ] **Step 1:** 실패하는 테스트를 쓴다. v2 가져오기 후 `themes()`, v1 가져오기 후 `themes()`가 `[]`이고 `hasMacro`가 false, 네 번째 put 실패 시 롤백, 요약 줄 문구.
- [ ] **Step 2:** RED를 확인하고, 구현한 뒤 GREEN을 확인한다.
- [ ] **Step 3:** 커밋한다. `feat(data): store themes and macro availability; v1 files keep working`

### Task 4: 계산 — β, 흐름, 합집합 후보 범위

**Files:**
- Modify: `src/lib/screen/precompute.ts`, `select.ts`, `runValidation.ts`
- Test: `precompute.test.ts`, `select.test.ts`, `runValidation.test.ts`

**Interfaces:**
- Consumes: Task 1의 `MarketDataFile`(v1|v2), Task 5의 `Basket`. 이 Task는 `baskets: Basket[]`를 입력으로만 받는다. 저장과 화면은 Task 5와 6의 일이다.
- Produces:
  - **types** (Task 5에서 이미 바뀌어 있음): `pool.themes`, `pool.baskets`, `conditions.macro`, `rank.by`의 `'macroBeta'`와 `rank.series`
  - **precompute**
    - `precompute(data, criteria, reboundEntry)`가 계열별 공개 시점(`macroKnownFrom`) 정렬 배열과 종목별 `beta: { usdkrw: Float64Array; wti: Float64Array }`를 만든다. NaN은 계산 불가를 뜻한다.
    - `params.betaDays`를 더하고, 기준과 다르면 `PrecomputeMismatchError`다.
    - 롤링은 누적합 방식이다.
    - v1 데이터면 β는 모두 NaN이다.
  - **selectAt**
    - 합집합 후보 범위(스펙 4.1).
    - macro 조건(스펙 3.3).
    - `values`에 `usdkrwBeta`, `usdkrwTrend`, `wtiBeta`, `wtiTrend`를 넣는다(켠 것만).
    - 정렬 `macroBeta`.
  - **runValidation**
    - `ValidationInput`에 `baskets: Basket[]`를 더한다.
    - notes에 `'themeSnapshot'`을 더한다. 테마나 묶음을 쓴 경우다.
    - notes에 `'macroGap'`을 더한다. macro 조건이 켜져 있는데 어느 재선정일에 계열 값이 없었던 경우다.
    - v1 데이터인데 macro 조건이 켜져 있으면 `ValidationError('no-macro')`이고, 문구는 `이 데이터에는 환율·유가가 없어요`다.

- [ ] **Step 1:** 실패하는 테스트를 쓴다.
  - **β 손계산.** 합성 계열에서 환율이 매일 ±1%이고 종목이 정확히 2배로 움직이면 β = 2다. 창 경계에서는 betaDays번째 봉부터 값이 있다. 쌍이 80%보다 적으면 NaN, 분산이 0이면 NaN이다. **임의 데이터 200일에서 롤링 β가 창마다 직접 계산한 값과 1e-9 안에서 같다.**
  - **공개 시점 규칙.** `macroKnownFrom` 표 테스트를 쓴다.
    - 원/달러는 월~금 관측 각각과 일요일 경계.
    - WTI는 수요일 관측과 목요일 관측.
  - **공개 전 값 누설.** `knownFrom > p`인 관측값을 극단값으로 바꿔도 `selectAt(d)` 결과가 같다. 관측일이 p보다 앞선 값도 포함한다. p 이후의 FRED와 봉을 모두 잘라도 같다.
  - **0 이하 값.**
    - WTI 계열에 −36.98 → 8.91 쌍과 0 → 10 쌍을 넣는다. 그 쌍은 β 계산에서 빠지고 결과는 유한하다.
    - 롤링 창이 그 쌍을 지나간 뒤에도 NaN이 남지 않는다.
    - 흐름의 끝값이 음수면 흐름을 계산하지 않고(통과 0) `macroGap`이다.
  - **흐름 따라가기.** 오름이면 + 민감 종목만, 내림이면 − 민감 종목만, 약함이면 `pass`일 때 조건 무시, `none`일 때 통과 0개다.
  - **합집합.**
    - 업종만, 테마만, 묶음만, 섞은 경우.
    - **업종만 고른 기존 기준은 이 Task 전 결과와 `toEqual`이다(회귀 fixture).**
    - 지워진 묶음 id는 빈 묶음으로 본다.
  - **정렬 macroBeta.**
  - **runValidation**: `themeSnapshot`, `macroGap`, `no-macro` 오류.
- [ ] **Step 2:** RED를 확인하고, 구현한 뒤 GREEN을 확인한다. 1단계 테스트는 전부 통과해야 한다.
- [ ] **Step 3:** 커밋한다. `feat(screen): FX and oil sensitivity, trend-following, and theme/basket pools`

### Task 5: 내 묶음 모델과 저장

**Files:**
- Create: `src/lib/screen/baskets.ts`(type `Basket`, `newBasket`, `sanitizeBaskets`, `loadBaskets`, `saveBaskets`, `MAX_BASKETS = 30`, `BASKET_SYMBOLS_MAX = 300`)
- Modify:
  - `src/lib/screen/types.ts`
    - `pool.themes: string[]`, `pool.baskets: string[]`
    - `conditions.macro`(스펙 3.3)
    - `rank.by`에 `'macroBeta'`를 더하고 `rank.series?: 'usdkrw' | 'wti'`를 둔다.
    - 계산 코드는 Task 4에서 바뀐다. 이 Task에서는 타입과 기본값만 바꾸고, 새 필드는 계산에 아직 쓰지 않는다.
  - `src/lib/state/profileStore.ts`: `profileKeys.baskets(id) = p:${id}:baskets`
  - `exportImport.ts`: 포함
  - `app.svelte.ts`: `app.baskets`와 `setBaskets(list)`. 31개면 throw. 프로필을 지우면 키도 지운다.
  - `src/lib/screen/defaults.ts`, `validate.ts`:
    - 새 필드 기본값은 themes `[]`, baskets `[]`, macro 스펙 기본값이다.
    - `sanitizeCriteria`는 새 필드가 없으면 조용히 기본값을 넣고, 범위를 벗어나면 고친 뒤 `repaired`로 표시한다.
    - `criteriaIssues`:
      - v1 데이터에 macro 조건이 켜져 있으면 blocking이다. 이 판단을 하려면 데이터 정보를 받아야 한다. 선택 인자 `dataInfo?: { hasMacro; themeCodes?: string[] }`를 둔다.
      - 지워진 묶음은 경고다.
      - 데이터에 없는 테마는 경고다.
- Test: 각 `*.test.ts`

- [ ] **Step 1:** 실패하는 테스트를 쓴다.
  - 묶음: 저장, 손상 복구, 한도, 이름 30자, 종목 300개, 내보내기·가져오기 왕복, 묶음이 없는 옛 파일, 프로필 삭제 시 키 제거.
  - 기준: 옛 기준(새 필드 없음)은 조용히 기본값을 받고 `repaired`가 false다. 범위를 벗어난 macro 값은 `repaired`다.
  - 이슈: v1 + macro면 blocking, 지워진 묶음과 없는 테마는 경고.
- [ ] **Step 2:** RED를 확인하고, 구현한 뒤 GREEN을 확인한다.
- [ ] **Step 3:** 커밋한다. `feat(screen): baskets per profile and criteria fields for macro and themes`

### Task 6: 화면

**Files:**
- Create:
  - `src/lib/ui/screen/ThemePicker.svelte`
  - `BasketPicker.svelte`
  - `BasketSheet.svelte`(관리: 만들기, 이름, 삭제와 되돌리기, 종목 추가와 빼기, 관심 그룹·테마에서 가져오기)
  - `MacroConditions.svelte`
- Modify:
  - `CriteriaEditor.svelte`(후보 범위·조건 구역)
  - `screenText.ts`(요약 줄 `테마 n·묶음 n`, β와 흐름 문구, 메모 문구)
  - `SelectionHistory.svelte`(β·흐름 값 표시)
  - `ValidationResult.svelte`(메모)
  - `src/routes/Simulate.svelte`(baskets와 dataInfo 전달)
  - 필요하면 `AddStockSheet`에 여러 개 추가 모드를 선택 prop으로 더한다. 기본 동작은 그대로다.
- Test: 각 `*.test.ts`, `Simulate.test.ts`

**Interfaces:**
- Consumes: Task 3의 `store.themes()`와 `info().hasMacro`, Task 5의 `app.baskets`·`setBaskets`·`criteriaIssues(c, strategies, dataInfo)`.
- Produces: 스펙 5장의 화면과 문구. 접근성 기준은 1단계와 같다(44px, 레이블, `role=status`, 시트의 포커스 복귀, 되돌리기).

- [ ] **Step 1:** 실패하는 테스트를 쓴다.
  - 테마 검색·고르기·칩 지우기.
  - v1이면 비활성과 안내 문구.
  - 묶음 만들기와 고르기, 관심 그룹·테마에서 가져오기, 삭제와 되돌리기, 삭제 뒤 포커스.
  - macro 줄: 토글, 숫자 칸 범위, 접어도 틀린 값이 실행을 막는지(1단계 규칙), `whenFlat` 선택, 설명 문구.
  - 요약 줄.
  - 이력에 β·흐름 표시.
  - 메모 `themeSnapshot`·`macroGap`.
  - `no-macro` 실패 문구.
- [ ] **Step 2:** RED를 확인하고, 구현한 뒤 GREEN을 확인한다. `build`도 확인한다.
- [ ] **Step 3:** 커밋한다. `feat(screen): theme and basket pickers, FX/oil conditions, results notes`

### Task 7: e2e, 문서, 실연결 점검

**Files:**
- Modify:
  - `tests/e2e/screen.spec.ts`(v2 데모 흐름 하나 추가)
  - `README.md`(수집이 FRED와 테마도 받는다는 점, 실패 시 동작)
  - `docs/live-check.md`(㉑·㉒)
  - `docs/superpowers/followups/2026-10-12-gazua-followups.md`(4단계 완료 표시, 남은 2·3단계)

- [ ] **Step 1:** e2e를 쓴다(4개 프로젝트).
  - v2 데모 가져오기 → 새 기준 → 테마 1개와 원/달러 민감도 ≥ 1.0 → 미리 보기 → 실행 → 이력 펼침에서 `원/달러 민감도` 값 확인.
  - 테마 메모 확인.
  - axe 검사(serious·critical 0).
  - 대기는 결정적으로 하고, `test.setTimeout(180_000)`을 둔다.
- [ ] **Step 2:** 문서를 고친다.
- [ ] **Step 3:** 전체 검증을 돌린다(Global Constraints의 명령 전부).
- [ ] **Step 4:** 커밋한다. `test(e2e): macro and theme criteria flow; docs`

## 순서
1 → 2 → 3 → 5 → 4 → 6 → 7

5를 4보다 먼저 한다. 4가 `Basket` 타입과 기준의 새 필드 기본값을 쓰기 때문이다.
