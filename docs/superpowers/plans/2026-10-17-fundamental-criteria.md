# 선정 기준 2단계(재무·가치) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 선정 기준에 PER·PBR, ROE·영업이익률, 매출·영업이익 증가율, 부채비율·흑자 조건과 재무 순 정렬을 더한다. 이 조건들은 과거 시점 기준으로 검증할 수 있어야 한다.

**Architecture:**
- 수집기가 종목마다 KIS 재무 TR(손익·대차, 연간·분기)을 받는다. 누적 손익은 분기 값으로 차분해, 데이터 파일 v4의 `stocks[].fin`에 담는다.
- 앱은 v1~v4를 받는다.
- precompute는 재무를 쓸 때만 분기별 `finKnownFrom` 배열과 누적합을 만든다.
- selectAt은 `finKnownFrom < p`인 분기만 써서 TTM 지표를 계산한다.
- 화면은 3단계 `FlowConditions`와 같은 구조의 소구역을 더한다.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest(+fake-indexeddb), Node 22 `node:test`, Playwright + axe.

**Spec:** docs/superpowers/specs/2026-10-17-fundamental-criteria-design.md. 기반 스펙은 1단계·4단계·3단계 설계 문서다.

## Global Constraints

**의존성·보안**
- 새 런타임 의존성은 넣지 않는다.
- 프록시 허용 목록은 바꾸지 않는다. 주문·계좌 경로는 계속 `403 proxy-path-blocked`다.
- 키는 환경변수 `KIS_APP_KEY`·`KIS_APP_SECRET`에서만 읽는다. 요청 URL·로그·오류·partial·출력 파일에 넣지 않는다. 인증 헤더는 기존 클라이언트 규칙 그대로다.

**미래 정보 차단 (스펙 2.3)**
- `finKnownFrom(q, fy)` = 분기말 날짜(그 달 말일) + 100일(결산월 분기) 또는 + 60일(그 밖의 분기). 날짜 계산은 `Date.UTC`로 한다.
- p에서는 `finKnownFrom < p`인 분기만 쓴다. p는 재선정일 d의 전 거래일이다.
- TTM은 마지막으로 쓸 수 있는 분기 L에서 [L−3, L]이 모두 있어야 계산한다. 1년 전 TTM은 [L−7, L−4]다. 모자라면 계산 불가다.
- 계산 불가는 조건에서 탈락이고, 정렬과 통과 수에서 뺀다.

**데이터 (스펙 2.2)**
- 파일은 `version: 4`이고 `stocks[].fin?: { q, fy, rev, op, ni, eq, debt }`를 담는다. 단위는 억 원이고 소수 둘째 자리까지다.
- `q`는 엄격히 오름차순이고 3개월 간격으로 연속이다. 빠진 분기는 0으로 채우지 않고 그 앞을 버린다.
- v1~v3도 받는다. 5 이상은 `version-newer`다.
- 경로·TR·필드·단위·누적 여부는 `scripts/fetch-fundamentals.mjs`의 `FIN_API` 한 곳에 둔다. 가정값: 단위는 억 원, 분기 손익은 누적.

**기본값과 범위 (스펙 3.2 표를 그대로)**
- `per` 0~15 (범위 0~1000), `pbr` 0~1.5 (0~100)
- `roe` ≥10, `opMargin` ≥5 (둘 다 −100~100)
- `revGrowth` ≥10, `opGrowth` ≥20 (둘 다 −100~1000)
- `debtRatio` ≤100 (0~10000), `profitable`
- `rank.fin.metric` 기본 `'per'`
- 모두 기본으로 꺼져 있다.

**문구**: 스펙 3.3·4장의 문구를 그대로 쓴다.
- 막는 경고 두 가지
- 공통 안내, PER 설명, 증가율 설명
- `다시 수집하면 쓸 수 있어요`
- 지표 이름 6개
- `finLag`·`finShares`·`finGap`
- 이력 형식 `PER 8.3 · ROE 14.2% · 부채비율 62% (2026년 2분기까지)`

**기존 동작 보존**
- 재무를 쓰지 않는 기준(업종·테마·묶음·환율·유가·수급)의 결과는 그대로다.
- 3단계 수급 수집의 동작은 바뀌지 않는다.
- 공유 컴포넌트의 기본 동작은 그대로다.

**검증 명령**
- 모든 pnpm 명령 앞에 `export PATH=/opt/homebrew/opt/nvm/versions/node/v22.15.1/bin:$PATH`를 붙인다.
- `corepack pnpm test`는 exit 0이고 Errors 줄이 없어야 한다.
- 그 밖에 `check`, `check:e2e`, `build`, `test:scripts`, `e2e`를 돌린다. e2e 전에는 4173 포트가 비어 있는지 본다.
- gzip 바이트는 플랫폼마다 다르다. 저장된 fixture와는 압축을 푼 내용으로 비교한다.

## Review Focus
1. **공시 시점 누설.** `finKnownFrom ≥ p`인 분기를 극단값으로 바꾸거나 잘라내도 선정이 같아야 한다. 연간 실적(+100일)이 분기(+60일)보다 늦게 열리는 경계도 맞아야 한다(Task 5).
2. **누적 차분.** 12월 결산과 3월 결산 모두에서 분기 값과 4분기(= 연간 − 3분기 누적)가 맞아야 한다. 회계연도가 바뀔 때 직전 누적값을 빼면 안 된다(Task 1).
3. **연속 분기.** 빠진 분기 뒤 TTM이 0을 섞어 계산되면 안 된다. 1년 전 TTM이 모자라면 성장률은 계산 불가다(Task 1·5).
4. **v1~v3 사용자.** 다시 수집하지 않아도 기존 검증이 막히지 않고, 새 조건만 꺼져야 한다(Task 3·4·6).
5. **목록 요약 누락.** 재무 조건만 켠 기준이 목록에서 `조건 없음`으로 보이면 안 된다(Task 6. 3단계에서 실제로 났던 결함).

---

### Task 1: 파일 형식 v4와 재무 받기·변환

**Files:**
- Modify: `src/lib/marketData/format.ts`
- Create: `scripts/fetch-fundamentals.mjs`
- Test: `src/lib/marketData/format.test.ts`, `tests/fetch-fundamentals.test.mjs`

**Interfaces:**
- Produces:
  - `MarketDataFile = V1 | V2 | V3 | V4`
  - `isV4(f)`
  - `hasFlowFormat(f)`: version ≥ 3이면 참. v3 전용 검사를 v4에도 적용할 때 쓴다. 기존 `isV3` 사용처는 v4에서도 맞게 고친다.
  - `FinSeries { q: string[]; fy: number; rev; op; ni; eq; debt: number[] }`
  - `validateMarketData`가 v4를 검사한다(스펙 2.2).
  - `fetchFundamentals(client, symbol) → Promise<{ annualIS, quarterIS, quarterBS }>`
    - 기존 클라이언트의 `client.get`을 쓴다.
    - `FIN_API` 상수: 경로, TR, 필드, `unit`(억 원), `cumulative`(true)
  - `buildFin({ annualIS, quarterIS, quarterBS }) → FinSeries | null`
    - 결산월 `fy`를 정한다.
    - `cumulative`이면 같은 회계연도 안에서 차분한다. 결산월 분기는 연간 값에서 같은 회계연도 직전 누적값을 뺀다.
    - 손익과 대차를 분기말로 맞춘다.
    - 연속 구간만 남긴다(마지막 빈 분기 다음부터).
    - 소수 둘째 자리로 반올림한다.

- [ ] **Step 1:** 실패하는 테스트를 쓴다.
  - **v4 검증**
    - 정상 파일은 ok다.
    - 다음은 corrupt다: `q` 형식 오류, 역순, 6개월 간격, `fy` 0·13, 길이 불일치, NaN.
    - `fin`이 없는 종목은 ok다.
    - version 5는 `version-newer`다.
    - v1~v3는 여전히 ok다. 특히 v3 수급 검사가 v4에도 적용되는지 확인한다.
  - **`buildFin`**
    - 12월 결산: 누적 [100, 250, 420]과 연간 600이면 분기는 [100, 150, 170, 180]이다.
    - 3월 결산(`fy` 3)도 같은 규칙으로 계산한다.
    - 회계연도 경계에서는 이전 해 누적값을 빼지 않는다.
    - 대차는 차분하지 않는다.
    - 중간 분기가 빠지면 그 앞은 버린다.
    - `cumulative:false` 경로도 확인한다.
    - 반올림을 확인한다.
    - 남는 분기가 없으면 null이다.
  - **`fetchFundamentals`** (가짜 클라이언트)
    - 4번 호출하고, 요청 URL에 키가 없다.
    - 실패 시 오류에 키가 없다.
- [ ] **Step 2:** RED를 확인하고, 구현한 뒤 GREEN을 확인한다.
- [ ] **Step 3:** 커밋한다. `feat(data): market-data v4 with per-stock fundamentals; fetch and quarterly build`

### Task 2: 수집기 v4와 데모

**Files:**
- Modify: `scripts/collect-market-data.mjs`, `scripts/make-demo-market-data.mjs`(+ `.d.mts`)
- Regenerate: `tests/fixtures/market-data-demo.json.gz`
- Test: `tests/collect-market-data.test.mjs`, `tests/demo.test.mjs`

**Interfaces:**
- Consumes: Task 1의 `fetchFundamentals`·`buildFin`.
- Produces:
  - `collect(...)`이 v4를 쓴다. 수급 다음에 재무를 받는다. 실패 처리는 수급과 같다(스펙 5장).
  - 요약 줄: `재무 N종목 · 최초 YYYY년 N분기`. 실패가 있으면 `재무 받기 실패 N종목`을 붙인다.
  - `--no-fins` 옵션.
  - `--update`
    - 다시 받아 덮어쓴다.
    - 받은 이력이 짧으면 이전 분기를 앞에 이어 붙인다(연속일 때만).
    - 실패하면 이전 `fin`을 유지한다.
  - partial 파일에 `kind:'fin'` 줄을 쓴다.
  - 데모는 v4로 만든다. 설계 재무 종목(스펙 5장)을 넣고, 코드를 상수로 내보낸다.
    - `FIN_VALUE_CODES`(3)
    - `FIN_QUALITY_CODES`(2)
    - `FIN_GROWTH_CODES`(2)
    - `FIN_LOSS_CODE`
    - `FIN_LATE_CODE`
  - 1~3단계 데모 데이터는 바꾸지 않는다.

- [ ] **Step 1:** 실패하는 테스트를 쓴다(가짜 클라이언트).
  - v4 출력이 검사를 통과한다.
  - 종목 하나가 실패해도 계속한다.
  - 연속 20번 실패하면 멈추고 파일을 쓴다(21종목 이상).
  - 치명 오류(401)면 중단하고 partial을 남긴다.
  - 절반이 넘으면 경고한다. 분모는 전체 종목이다.
  - `--no-fins`
  - `--update`: 덮어쓰기, 앞 이어 붙이기, 실패 시 유지. v3를 넣으면 v4가 된다.
  - 이어받기
  - 키 노출이 없다.
  - 데모
    - 설계 종목이 데모 마지막 재선정일에 스펙 값 근처다(PER ≤ 7, ROE ≥ 20, 매출 증가율 ≥ 30 등).
    - 적자 종목은 TTM 순이익이 0 이하다.
    - 늦게 시작하는 종목은 첫 분기가 기간 중간이다.
    - 두 번 생성하면 바이트가 같고, 저장된 fixture와 내용이 같다.
- [ ] **Step 2:** RED를 확인하고, 구현한 뒤 GREEN을 확인한다. fixture를 다시 만든다. 1~3단계 테스트는 GREEN이어야 한다.
- [ ] **Step 3:** 커밋한다. `feat(scripts): collect fundamentals per stock into market-data v4; demo fundamental stocks`

### Task 3: 앱 저장소와 데이터 요약

**Files:** `src/lib/marketData/store.ts`, `src/lib/ui/settings/DataTools.svelte`, 각 테스트

**Interfaces:**
- Produces:
  - `MarketDataInfo`에 `hasFin: boolean`, `finStocks: number`를 더한다.
    - 키가 생기기 전 데이터는 false와 0으로 읽는다.
    - `version`은 4까지다.
  - 요약 문구: `hasFin`일 때 기존 문구 끝에 ` · 재무 포함`을 붙인다.

- [ ] **Step 1:** 실패하는 테스트를 쓴다.
  - v4를 가져오면 `info()`가 맞다.
  - 재무 없는 v4, v3, 예전 키의 경우를 확인한다.
  - 요약 문구는 수급과 재무의 조합 네 가지를 확인한다.
- [ ] **Step 2:** RED를 확인하고, 구현한 뒤 GREEN을 확인한다.
- [ ] **Step 3:** 커밋한다. `feat(data): store fundamentals availability; summary names it`

### Task 4: 기준 모델 — 재무 조건과 정렬

**Files:** `src/lib/screen/types.ts`, `defaults.ts`, `validate.ts`, 각 테스트, 내보내기·가져오기 테스트

**Interfaces:**
- Produces:
  - types: `FinMetric`, `conditions.fin`, `RankBy`에 `'fin'`, `rank.fin?: { metric: FinMetric }`
  - defaults: Global Constraints의 값. `rank.fin`은 늘 채운다.
  - `sanitizeCriteria`
    - 필드가 없으면 기본값으로 채운다(`repaired=false`).
    - 범위 밖 값과 잘못된 metric은 고친다(`repaired=true`).
    - min > max 범위는 고치지 않는다.
  - `finOn(c)`, `usesFin(c)`를 `macroOn`·`flowOn` 옆에 둔다.
  - `criteriaIssues`
    - 스펙 3.3의 막는 경고를 낸다. `dataInfo.hasFin`은 필수다.
    - 같은 문구는 한 번만 낸다. 구역 규칙은 3단계와 같다.
    - "조건 없음" 경고는 `finOn`을 센다.
  - `conditions`를 일반적으로 훑는 코드(`{ macro, flow, ...simple }`, `ConditionKey`, 편집기 요약 개수 등)가 `fin`에서 깨지지 않게 한다.
  - `select.ts`에는 `case 'fin'` 자리만 두고, Task 5에서 채운다.

- [ ] **Step 1:** 실패하는 테스트를 쓴다.
  - 기본값 표
  - 기존 프로필 채우기
  - 범위 밖 값 고치기(지표마다)
  - 뒤집힌 PER·PBR 범위는 고치지 않고 막는다.
  - 재무 없는 데이터: 조건이면 `conditions`, 정렬만이면 `rank`, 둘 다면 한 번만.
  - 재무 조건만 켠 기준에는 "조건 없음"이 나오지 않는다.
  - 내보내기·가져오기 왕복
- [ ] **Step 2:** RED를 확인하고, 구현한 뒤 GREEN을 확인한다.
- [ ] **Step 3:** 커밋한다. `feat(screen): fundamental criteria fields, defaults and blocking issues`

### Task 5: 계산 — 공시 시점, TTM 지표, 정렬

**Files:**
- Create: `src/lib/screen/fin.ts`
- Modify: `precompute.ts`, `select.ts`, `runValidation.ts`
- Test: `fin.test.ts`, `precompute.test.ts`, `select.test.ts`, `runValidation.test.ts`

**Interfaces:**
- Consumes: Task 1의 `FinSeries`, Task 4의 필드와 `usesFin`.
- Produces:
  - `fin.ts`
    - `finKnownFrom(q: string, fy: number): string` (YYYYMMDD)
    - `lastKnownQuarter(known: string[], p: string): number` (이진 탐색, 없으면 −1)
    - `finMetricsAt(pre, st, pIdx, p): FinValues | null`: TTM·1년 전 TTM·L 자본·부채·시가총액으로 스펙 3.1의 지표를 계산한다. 계산 불가인 항목은 NaN이고, 쓴 분기 `L`의 `q`를 함께 돌려준다.
  - precompute
    - `usesFin`일 때만 종목별 `known` 배열과 rev·op·ni 누적합을 만든다.
    - `params.fin`을 더하고, 기준과 맞지 않으면 `PrecomputeMismatchError`다.
  - selectAt
    - 스펙 3.2 조건을 적용한다.
    - 정렬 `'fin'`: per·pbr은 낮은 순, 나머지는 높은 순이다. 계산 불가 종목은 정렬과 통과 수에서 뺀다.
    - `values`에 켠 지표 값을 넣는다: `finPer`·`finPbr`·`finRoe`·`finOpMargin`·`finRevGrowth`·`finOpGrowth`·`finDebtRatio`, 정렬 값 `rankFin`, 쓴 분기 `finQuarter`. 문자열 키를 따로 둘지, 숫자로 넣을지는 기존 `values` 타입에 맞춰 정한다.
    - `finMissingAt(d, pre, c, baskets)`: 후보 전체가 재무 계산 불가인가. 가장 먼저 `usesFin`을 확인한다.
  - runValidation
    - notes에 `'finLag'`(늘), `'finShares'`(PER·PBR 조건이나 정렬을 쓸 때), `'finGap'`을 더한다.
    - 재무 없는 데이터면 `ValidationError('no-fin')`이고, `WorkerErrorCode`에도 넣는다.

- [ ] **Step 1:** 실패하는 테스트를 쓴다.
  - `finKnownFrom` 표
    - 12월 결산 분기 4개(3·6·9월은 +60일, 12월은 +100일)
    - 3월 결산
    - 2월 말일과 윤년
  - 지표 손계산
    - 3.1 표의 각 지표와 계산 불가 경우 전부
    - 연속 4분기·8분기 경계
    - L−4 자본이 없을 때의 ROE
  - 공시 시점
    - 연간 실적은 +100일 전까지 쓰지 않고, 그 사이 TTM은 3분기까지의 4개 분기로 계산한다.
    - p 당일이 `finKnownFrom`이면 아직 쓰지 않는다(`<` 규칙).
  - 누설 검사
    - 데모의 모든 재선정일에서 `finKnownFrom ≥ p`인 분기를 ×1000, 부호 반전, 잘라내기로 바꿔도 `selectAt`이 같다.
    - 알려진 마지막 분기를 바꾸면 결과가 달라진다.
  - 조건과 정렬: 지표마다 경계, `profitable`, 정렬 방향, 계산 불가 제외
  - 회귀: 재무를 쓰지 않으면 기준선 파일과 같고, 1·3·4단계 테스트가 GREEN이다.
  - 메모리: 재무를 쓰지 않으면 재무 배열이 없다.
  - runValidation: 메모 세 가지, `no-fin`
  - `finMissingAt`: 조건만 쓸 때와 정렬만 쓸 때 두 분기를 모두 확인한다.
- [ ] **Step 2:** RED를 확인하고, 구현한 뒤 GREEN을 확인한다.
- [ ] **Step 3:** 커밋한다. `feat(screen): fundamental metrics from known quarters, ranking without look-ahead`

### Task 6: 화면

**Files:**
- Create: `src/lib/ui/screen/FinConditions.svelte`, `FinConditions.test.ts`
- Modify: `CriteriaEditor.svelte`, `SelectionHistory.svelte`, `ValidationResult.svelte`, `screenText.ts`(+ `criteriaLine`), `src/routes/Simulate.svelte`, 각 테스트

**Interfaces:**
- Consumes: Task 3의 `hasFin`, Task 4의 필드와 경고, Task 5의 `values`와 notes.
- Produces:
  - **`FinConditions`**: 스펙 4.1. 네 묶음으로 나눈다. `FlowConditions`와 같은 `softDisabled`·`describedby`·uid·켜기만 막기 규칙을 따른다.
  - **정렬**: `재무 순`과 지표 고르기(스펙 4.2의 이름 6개). 정렬 요약 라벨은 기존 `… 순` 패턴을 따른다.
  - **`criteriaLine`**: 재무 조건을 넣는다(스펙 4.3).
  - **`screenText`**
    - 문구와 이력 포맷터를 둔다. 포맷터는 `PER 8.3 · ROE 14.2% · 부채비율 62% (2026년 2분기까지)` 형식이다. 분기는 달력 분기이고, 소수는 한 자리, 음수는 `−`다.
    - 실행 시점 스냅샷에 재무 정렬 지표를 담는다(`flowRunSnap`처럼).
  - **결과 메모**: `finLag`·`finShares`·`finGap`

- [ ] **Step 1:** 실패하는 테스트를 쓴다.
  - 토글과 칸이 기준에 반영된다.
  - 접힌 구역에 범위 밖 값이 있으면 실행을 막고 포커스를 옮긴다.
  - v3 데이터
    - 켜기는 막힌다.
    - 이미 켜진 조건은 끌 수 있고, 끈 뒤 포커스와 `disabled=false`가 유지된다.
    - `describedby`가 안내를 가리킨다.
  - `재무 순`을 고르면 지표 고르기가 나오고, v3에서는 정렬 구역에 경고가 나며 실행이 막힌다.
  - `criteriaLine`: 재무만 켠 경우, 다른 조건과 섞인 경우.
  - 이력 포맷: 여러 지표, 음수, 계산 불가 `—`, 분기 표기.
  - 메모 세 가지의 문구가 스펙과 같다.
  - 기존 화면 테스트가 전부 GREEN이다.
- [ ] **Step 2:** RED를 확인하고, 구현한 뒤 GREEN을 확인한다. 스펙에 없는 문구를 새로 썼으면 보고서에 나열한다.
- [ ] **Step 3:** 커밋한다. `feat(screen): fundamental conditions, fin ranking, history values and notes`

### Task 7: e2e, 문서, 실연결 점검

**Files:** `tests/e2e/screen.spec.ts`, `README.md`, `docs/live-check.md`(㉕·㉖), `docs/superpowers/followups/2026-10-12-gazua-followups.md`

- [ ] **Step 1:** e2e를 쓴다(4개 프로젝트).
  - 흐름: v4 데모 → 새 기준 → 반등 신호 끄기 → PER 0~10 → 미리 보기가 바뀌기를 기다림 → 실행 → 이력 펼침.
  - 이력 값이 `PER x.x` 형식인지(음수 기호는 `[−-]`) 확인한다.
  - 고른 종목이 모두 데모의 `FIN_VALUE_CODES`에 속하는지 확인한다(import해서 쓴다). 조건을 빼면 실패해야 하며, 그 RED 증거를 보고서에 넣는다.
  - `finLag` 메모를 확인한다.
  - axe 검사(serious·critical 0)를 한다.
  - `test.setTimeout(180_000)`을 두고, 대기는 결정적으로 한다.
- [ ] **Step 2:** 문서를 고친다.
  - README: 재무 수집, `--no-fins`, 실패 동작, `--update`
  - live-check ㉕·㉖
  - followups: 2단계 완료를 표시하고 "2단계에서 미룬 것"을 적는다.
- [ ] **Step 3:** 전체 검증을 돌린다(Global Constraints의 명령 전부).
- [ ] **Step 4:** 커밋한다. `test(e2e): fundamental criteria flow; docs`

## 순서
1 → 2 → 3 → 4 → 5 → 6 → 7
