# 선정 기준 3단계(투자자 매매동향) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 선정 기준에 외국인·기관·개인의 순매수 규모, 연속 순매수, 수급 순 정렬, 쌍끌이(외국인+기관) 조건을 더한다. 1단계와 같은 방식으로, 과거 시점 기준으로 검증할 수 있게 한다.

**Architecture:**
- 수집기가 종목마다 KIS 투자자 일별(`FHPTJ04160001`)을 받아 데이터 파일 v3의 `stocks[].flow`를 만든다.
- 앱은 v1·v2·v3를 모두 받는다.
- precompute는 쓰는 주체의 누적합·연속 일수 배열만 만든다. selectAt은 날짜 t < p인 수급만 쓴다.
- 화면은 4단계 `MacroConditions`와 같은 구조의 소구역을 더한다.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest(+fake-indexeddb), Node 22 `node:test`, Playwright + axe.

**Spec:** docs/superpowers/specs/2026-10-16-investor-flow-criteria-design.md (기반 docs/superpowers/specs/2026-10-16-selection-criteria-validation-design.md, docs/superpowers/specs/2026-10-16-macro-theme-criteria-design.md)

## Global Constraints

**의존성·보안**
- 새 런타임 의존성은 넣지 않는다.
- 프록시 허용 목록은 바꾸지 않는다. 주문·계좌 경로는 계속 `403 proxy-path-blocked`다.
- 키는 환경변수 `KIS_APP_KEY`·`KIS_APP_SECRET`에서만 읽는다. 키·토큰은 로그·오류·파일·URL 어디에도 넣지 않는다.

**미래 정보 차단 (스펙 2.3)**
- 날짜 t의 수급은 **t < p**일 때만 쓴다. p는 재선정일 d의 전 거래일이다.
- 구현에서는 종목 일봉에서 p의 위치를 `idx(p)`라 할 때 수급 끝 봉 e = `idx(p) − 1`이다.
- 창이 `from`보다 앞으로 나가거나, 분모(거래대금 합)가 0 이하이면 계산 불가다. 조건에서는 탈락이고 정렬에서는 뺀다.

**데이터 (스펙 2.2)**
- `version: 3`이고 `stocks[].flow?: { from, f, i, p }`를 더한다. 금액은 백만 원 정수다.
- 빈 날은 0으로 채우지 않고 `from`을 빈 날 다음으로 옮긴다.
- v1·v2도 받는다. 4 이상은 `version-newer`다.
- KIS 경로·필드 이름·금액 단위는 `scripts/fetch-investor-flow.mjs`의 상수 한 곳에 둔다. 가정값은 금액 단위 백만 원이다.

**기본값과 범위 (스펙 3.3)**

| 항목 | 기본값 | 범위 |
|---|---|---|
| `flow.amount` | 끔, `who` `'foreign'`, `days` 20, `minPct` 1, `maxPct` 100 | `days` 5~120, `minPct`·`maxPct` −100~100 |
| `flow.streak` | 끔, `who` `'inst'`, `minDays` 5 | `minDays` 1~60 |
| `rank.flow` | `who` `'foreign'`, `days` 20 | `days` 5~120 |

- `FlowWho = 'foreign' | 'inst' | 'indiv' | 'both'`이다. `both`는 외국인과 기관이 각각 만족해야 하고, 정렬은 두 비율 중 작은 값으로 한다.

**문구**
- 스펙 3.4·4장의 문구를 그대로 쓴다.
  - `순매수 비율의 최소가 최대보다 커요`
  - `이 데이터에는 투자자 매매동향이 없어요`
  - `다시 수집하면 쓸 수 있어요`
  - 두 줄 설명과 공통 안내
  - `flowLag`·`flowGap` 메모
  - 이력 값 형식 `외국인 순매수 20일 3.2% · 연속 5일`

**기존 동작 보존**
- 수급을 쓰지 않는 기존 기준(업종·테마·묶음·환율·유가)의 결과는 그대로다.
- 매매 규칙 시뮬레이션은 그대로다.
- 공유 컴포넌트의 기본 동작은 그대로다.

**검증 명령**
- 모든 pnpm 명령 앞에 `export PATH=/opt/homebrew/opt/nvm/versions/node/v22.15.1/bin:$PATH`를 붙인다.
- `corepack pnpm test`는 exit 0이어야 하고 Errors 줄이 없어야 한다.
- 그 밖에 `check`, `check:e2e`, `build`, `test:scripts`, `e2e`를 돌린다. e2e 전에는 4173 포트가 비어 있는지 확인한다.

## Review Focus
1. **하루 늦춤 누설.** p 당일 수급을 쓰면 미래 정보다. 날짜가 p 이상인 수급을 극단값으로 바꾸거나 잘라도 모든 재선정일의 선정이 같아야 한다(Task 5).
2. **`from` 경계.** 창의 첫 날이 정확히 `from`이면 계산되고, 하루라도 앞서면 계산 불가다. 연속 일수가 `from`에 닿으면 센 만큼만 인정한다(Task 5).
3. **빈 날 처리.** 수집 응답에 빠진 날이 있을 때 0으로 채우면 순매수 없음으로 잘못 읽힌다. `from`이 옮겨져야 한다. `--update`로 이어 붙일 때도 같다(Task 1·2).
4. **v1·v2 사용자.** 다시 수집하지 않은 사용자의 기존 검증이 막히면 안 되고, 새 조건만 꺼져야 한다(Task 3·4·6).
5. **수집 실패.** 종목 하나의 실패나 API 깊이 한계로 수집 전체가 멈추면 안 된다. 그 종목만 비우고 요약과 경고를 남긴다(Task 2).

---

### Task 1: 파일 형식 v3와 수급 받기

**Files:**
- Modify: `src/lib/marketData/format.ts`
- Create: `scripts/fetch-investor-flow.mjs`
- Test: `src/lib/marketData/format.test.ts`, `tests/fetch-investor-flow.test.mjs`

**Interfaces:**
- Produces:
  - `MarketDataFile = V1 | V2 | V3`
  - `isV3(f)`. `hasMacroFormat(f)`: v2 이상이면 macro와 themes가 있다. 기존 `isV2`를 쓰는 곳은 v3에서도 참이 되도록 고친다.
  - `FlowSeries { from: string; f: number[]; i: number[]; p: number[] }`
  - `validateMarketData`가 v3를 검사한다(스펙 2.2).
    - `from`이 `d` 안에 있어야 한다.
    - 세 배열의 길이가 같고, `d`에서 `from` 이상인 날짜 수와 같아야 한다.
    - 값은 유한한 정수여야 한다.
  - `fetchInvestorFlow(client, symbol, { from: 'YYYYMMDD', to: 'YYYYMMDD' }) → Promise<{ d: string; f: number; i: number; p: number }[]>`
    - 날짜는 오름차순이다.
    - 기준일을 `to`로 두고 과거로 페이지를 넘긴다. 다음 기준일은 받은 가장 오래된 날의 전날이다.
    - 멈추는 경우: `from`에 닿았을 때, 빈 응답일 때, 가장 오래된 날짜가 이전 페이지와 같을 때.
    - 경로·TR·필드 이름·단위는 파일 위의 `FLOW_API` 상수 한 곳에 둔다.
  - `alignFlow(barDates: string[], rows: {d,f,i,p}[]) → FlowSeries | null`
    - 일봉 날짜 기준으로 맞춘다.
    - 빈 날이 있으면 `from`을 마지막 빈 날 다음으로 옮긴다. 일봉에 없는 수급 날짜는 버린다.
    - 남는 날이 없으면 null이다.

- [ ] **Step 1:** 실패하는 테스트를 쓴다.
  - **v3 형식 검사**
    - 정상 파일은 ok다.
    - `from`이 `d`에 없거나, 길이가 맞지 않거나, 값이 소수·NaN이면 corrupt다.
    - `flow`가 없는 종목도 ok다.
    - version 4는 `version-newer`다.
    - v1·v2는 여전히 ok다.
  - **`fetchInvestorFlow`** (가짜 클라이언트)
    - 3페이지를 넘겨 오름차순으로 합친다.
    - `from`에서 멈춘다.
    - 빈 응답이나 같은 날짜가 반복되면 멈춘다.
    - 단위를 정수로 반올림한다.
    - 요청 URL·헤더에 키가 없다(기존 클라이언트를 쓰는지).
  - **`alignFlow`**
    - 빈 날이 없으면 `from`은 첫 날이다.
    - 중간에 빈 날이 있으면 `from`은 그 다음 날이다.
    - 일봉에 없는 수급 날짜는 버린다.
    - 남는 날이 없으면 null이다.
- [ ] **Step 2:** RED를 확인하고, 구현한 뒤 GREEN을 확인한다. 앱 쪽 `isV2` 사용처는 모두 v3에서도 맞게 동작해야 한다(`corepack pnpm test`와 `check`가 GREEN).
- [ ] **Step 3:** 커밋한다. `feat(data): market-data v3 with per-stock investor flow; flow fetch and alignment`

### Task 2: 수집기 v3와 데모

**Files:**
- Modify: `scripts/collect-market-data.mjs`, `scripts/make-demo-market-data.mjs`
- Regenerate: `tests/fixtures/market-data-demo.json.gz`
- Test: `tests/collect-market-data.test.mjs`, `tests/demo.test.mjs`

**Interfaces:**
- Consumes: Task 1의 `fetchInvestorFlow`, `alignFlow`.
- Produces:
  - `collect(...)`이 v3를 쓴다.
    - 일봉 다음에 종목마다 수급을 받는다.
    - 종목 하나가 실패하면 `flow`를 비우고 계속한다.
    - 요약 줄은 `매매동향 N종목 · 최초 YYYY-MM-DD`이고, 실패가 있으면 `수급 받기 실패 N종목`을 덧붙인다.
    - 실패가 절반을 넘으면 경고 줄을 하나 더 남긴다.
  - 옵션
    - `--flows-years N`: 수급 기간을 최근 N년으로 줄인다.
    - `--no-flows`: 수급을 받지 않는다. 파일은 v3이고 `flow`가 없다.
  - `--update`
    - 이전 `flow`의 마지막 날 다음부터만 받아 이어 붙인다. 이어 붙인 결과도 `alignFlow` 규칙(빈 날이면 `from`을 옮김)을 따른다.
    - 받기가 실패하면 이전 `flow`를 그대로 둔다.
    - v1·v2 파일을 넣어도 결과는 v3다.
  - 데모 생성기는 v3를 만들고, 스펙 5장에서 설계한 수급 종목을 넣는다.
    - 외국인 순매수 3종목(비율 약 +5%)
    - 기관 최근 8일 연속 순매수 2종목
    - 외국인+기관 1종목
    - 수급 시작일이 기간 중간인 종목 1개
    - 출력은 결정적이어야 한다.
    - 설계 종목의 코드는 파일 위 상수로 내보내 테스트와 e2e가 쓴다.

- [ ] **Step 1:** 실패하는 테스트를 쓴다(가짜 클라이언트).
  - v3 출력이 검사를 통과한다.
  - 한 종목이 실패해도 나머지는 `flow`가 있고, 요약에 실패 수가 있다.
  - 응답에 빈 날이 있으면 `from`이 옮겨진다.
  - `--flows-years 1`, `--no-flows`.
  - `--update`
    - 이어 붙인다.
    - 실패하면 이전 값을 유지한다.
    - v2 파일을 넣으면 v3가 나온다.
  - 키와 토큰이 새 경로의 로그와 파일에도 없다(기존 검사를 넓힌다).
  - **데모**
    - 설계 종목의 20일 외국인 비율이 ≥ 3%다.
    - 기관 연속 순매수가 ≥ 8일이다.
    - 늦게 시작하는 종목의 `from`이 기간 중간이다.
    - 두 번 생성하면 바이트가 같다.
- [ ] **Step 2:** RED를 확인하고, 구현한 뒤 GREEN을 확인한다. 데모 fixture를 다시 만든다. 4단계 설계 종목(β·테마)은 그대로 유지한다(기존 테스트 GREEN).
- [ ] **Step 3:** 커밋한다. `feat(scripts): collect investor flow per stock into market-data v3; demo flow stocks`

### Task 3: 앱 저장소와 데이터 요약

**Files:**
- Modify: `src/lib/marketData/store.ts`, `src/lib/ui/settings/DataTools.svelte`
- Test: `store.test.ts`, `src/lib/ui/settings/DataTools.test.ts`

**Interfaces:**
- Produces:
  - `MarketDataInfo`에 `hasFlow: boolean`, `flowStocks: number`를 더한다.
    - 키가 생기기 전에 저장된 데이터는 `hasFlow` false, `flowStocks` 0이다.
    - `version`은 3까지다.
  - 데이터 요약은 `hasFlow`일 때 기존 문구 뒤에 ` · 매매동향 포함`을 붙인다.

- [ ] **Step 1:** 실패하는 테스트를 쓴다.
  - v3 가져오기 뒤 `info()`의 `hasFlow`와 `flowStocks`가 맞다.
  - v2를 가져오면 `hasFlow`가 false다.
  - 예전 키만 있는 저장소도 false로 읽는다.
  - 요약 문구는 네 경우를 확인한다: v3 수급 있음, v3 수급 없음(`--no-flows`), v2, v1.
- [ ] **Step 2:** RED를 확인하고, 구현한 뒤 GREEN을 확인한다.
- [ ] **Step 3:** 커밋한다. `feat(data): store investor-flow availability; summary names it`

### Task 4: 기준 모델 — 수급 조건과 정렬

**Files:**
- Modify: `src/lib/screen/types.ts`, `defaults.ts`, `validate.ts`
- Test: `validate.test.ts`, `defaults.test.ts`, 내보내기·가져오기 테스트

**Interfaces:**
- Produces:
  - **types**
    - `FlowWho`
    - `SelectionCriteria.conditions.flow: { amount: {...}; streak: {...} }`
    - `RankBy`에 `'flow'`를 더한다.
    - `rank.flow?: { who: FlowWho; days: number }`
  - **defaults**: 새 기준에 Global Constraints 표의 기본값을 넣는다. `rank.flow`는 늘 채운다.
  - **validate**
    - `sanitizeCriteria`: `flow`·`rank.flow`가 없는 기존 프로필은 기본값으로 채운다(`repaired=false`). 범위를 벗어나거나 형식이 틀린 값은 기존 규칙대로 고친다(`repaired=true`).
    - `flowOn(c)`: 수급 조건 중 하나라도 켜져 있으면 참.
    - `usesFlow(c)`: `flowOn(c)`이거나 `rank.by === 'flow'`이면 참.
  - **`criteriaIssues(c, strategies, dataInfo?, baskets?)`에 막는 경고를 더한다(스펙 3.4).**
    - `minPct > maxPct`이면 `순매수 비율의 최소가 최대보다 커요`
    - `dataInfo`가 있고 `!hasFlow`인데 `usesFlow(c)`이면 `이 데이터에는 투자자 매매동향이 없어요`
    - 각 경고의 `field`는 화면이 포커스할 칸을 가리킨다. 4단계 macro 경고의 `field` 규칙을 따른다.

- [ ] **Step 1:** 실패하는 테스트를 쓴다.
  - 기본값 표를 확인한다.
  - 기존 프로필(필드 없음)을 기본값으로 채우고, `repaired`는 false다.
  - 범위 밖의 `days`·`minDays`·`minPct`와 잘못된 `who`를 고친다.
  - 막는 경고 두 가지를 확인하고, 수급 순 정렬만 고른 경우도 막히는지 본다.
  - 수급이 있는 데이터에서는 경고가 없다.
  - 내보내기·가져오기를 왕복해도 `flow`·`rank.flow`가 보존된다.
- [ ] **Step 2:** RED를 확인하고, 구현한 뒤 GREEN을 확인한다.
- [ ] **Step 3:** 커밋한다. `feat(screen): investor-flow criteria fields, defaults and blocking issues`

### Task 5: 계산 — 비율, 연속 일수, 정렬

**Files:**
- Create: `src/lib/screen/flow.ts`
- Modify: `src/lib/screen/precompute.ts`, `select.ts`, `runValidation.ts`
- Test: `flow.test.ts`, `precompute.test.ts`, `select.test.ts`, `runValidation.test.ts`

**Interfaces:**
- Consumes:
  - Task 1의 `FlowSeries`
  - Task 4의 `flow` 필드와 `usesFlow`
- Produces:
  - **`flow.ts`**
    - `flowPrefix(net: number[]): Float64Array`: 길이 n+1의 누적합.
    - `flowStreak(...nets: number[][]): Int32Array`: 그날까지, 모든 주체가 함께 `> 0`인 날이 이어진 수.
    - `flowEnd(st, pIdx): number`: e = `pIdx − 1`을 수급 배열 위치로 바꾼다. 계산 불가면 −1.
    - `flowRatio(pre, st, who, days, pIdx): number | [number, number]`: `both`이면 `[외국인, 기관]`을 돌려준다. 계산 불가면 NaN.
  - **precompute**
    - `usesFlow`일 때만 쓰는 주체의 종목별 누적합 배열을 만든다. 거래대금 누적합은 수급 구간에 맞춘다.
    - 연속 순매수를 켰을 때만 연속 일수 배열을 만든다.
    - `params.flow`에 `{ whos: FlowWho[]; streakWho: FlowWho | null }`를 더한다. 쓰지 않으면 null이다.
    - 기준과 맞지 않으면 `PrecomputeMismatchError`다.
  - **selectAt**
    - 순매수 규모와 연속 순매수 조건을 적용한다(스펙 3.3).
    - 정렬 `'flow'`를 더한다. `both`는 작은 값으로 정렬한다.
    - `values`에 넣는 값(켠 것만):
      - `flowRatio` (`both`이면 `flowRatioForeign`·`flowRatioInst`)
      - `flowStreak`
      - `rankFlow` (정렬에 쓴 값)
    - `flowMissingAt(d, pre, c, baskets)`: 후보 전체가 수급 계산 불가인가.
  - **runValidation**
    - notes에 `'flowLag'`을 더한다(`usesFlow`일 때 늘).
    - notes에 `'flowGap'`을 더한다(어느 재선정일에 `flowMissingAt`가 참일 때).
    - 수급 없는 데이터인데 `usesFlow`이면 `ValidationError('no-flow')`를 던진다. 문구는 `이 데이터에는 투자자 매매동향이 없어요`다. `WorkerErrorCode`에도 더한다.

- [ ] **Step 1:** 실패하는 테스트를 쓴다.
  - **손계산**
    - 비율: 순매수 합 × 1e6 ÷ 거래대금 합 × 100. 음수도 확인한다.
    - 분모 0이면 NaN이다.
    - 창의 첫 날이 `from`이면 계산되고, `from` 하루 전이면 NaN이다.
    - 연속 일수: 중간에 0 또는 음수가 있으면 끊긴다. `both`는 두 주체가 함께 `> 0`인 날만 센다.
    - `from`에 닿으면 센 만큼만 인정한다.
    - 임의 데이터 200일에서 누적합 비율이 날마다 직접 합계와 1e-9 안에서 같다.
  - **하루 늦춤**
    - p 당일 수급이 극단값이어도 선정이 같다.
    - p−1 당일 값을 바꾸면 선정이 바뀐다. 쓰고 있다는 증거다.
  - **누설 검사**: 데모에서 날짜 ≥ p인 수급을 ×1000, 부호 반전, 잘라내기로 바꿔도 모든 재선정일의 `selectAt`이 같다.
  - **조건**
    - 순매수 규모의 범위 안과 밖을 확인한다.
    - `both`는 두 비율이 모두 범위 안일 때만 통과한다.
    - 연속 순매수 `minDays`의 경계를 확인한다.
  - **정렬 `'flow'`**
    - 큰 순서로 정렬한다.
    - `both`는 작은 값을 기준으로 정렬한다.
    - 계산 불가인 종목은 빠진다.
  - **회귀**: 수급을 쓰지 않는 기준은 `tests/fixtures/select-sector-baseline.json`과 같다. 4단계 macro 테스트도 전부 GREEN이다.
  - **메모리**: 수급을 쓰지 않으면 수급 배열이 없다(null 또는 길이 0).
  - **runValidation**: `flowLag`, `flowGap`(늦게 시작하는 종목만 후보인 기준), `no-flow` 오류.
- [ ] **Step 2:** RED를 확인하고, 구현한 뒤 GREEN을 확인한다.
- [ ] **Step 3:** 커밋한다. `feat(screen): investor-flow ratio, streak and ranking without look-ahead`

### Task 6: 화면

**Files:**
- Create: `src/lib/ui/screen/FlowConditions.svelte`, `src/lib/ui/screen/FlowConditions.test.ts`
- Modify:
  - `CriteriaEditor.svelte` (소구역 배치와 정렬 `수급 순`)
  - `SelectionHistory.svelte`
  - `ValidationResult.svelte`
  - `screenText.ts`
  - 각 테스트

**Interfaces:**
- Consumes:
  - Task 3의 `hasFlow`
  - Task 4의 필드와 경고
  - Task 5의 `values`·notes
- Produces:
  - **`FlowConditions`**: 스펙 4.1. 4단계 `MacroConditions`의 구조와 접근성 처리를 따른다.
    - 수급이 없으면 토글을 `softDisabled`(`aria-disabled`)로 두고 `describedby`로 안내를 잇는다.
    - 켤 때만 막고, 끄기는 허용한다.
    - 안내의 id에는 uid를 붙인다.
  - **정렬 고르기**에 `수급 순`과 그때만 보이는 주체·기간 칸을 더한다. 수급 없는 데이터의 경고는 정렬 구역에 한 번만 보인다.
  - **`screenText`**에 주체 이름, 두 줄 설명, 공통 안내, `flowLag`·`flowGap` 메모, 이력 값 포맷터를 넣는다.
    - 포맷터 예: `외국인 순매수 20일 3.2% · 연속 5일`
    - `both` 예: `외국인 2.1% · 기관 1.4% (20일) · 함께 연속 3일`
    - 소수 한 자리, 음수는 `−`.

- [ ] **Step 1:** 실패하는 테스트를 쓴다.
  - 토글·주체·기간·범위 칸이 기준에 반영된다.
  - 범위 밖 값은 접힌 상태에서도 실행을 막고, 구역을 펼쳐 그 칸으로 포커스한다.
  - v2 데이터
    - 켜기는 막힌다.
    - 이미 켜진 조건은 끌 수 있고, 끈 뒤 포커스가 토글에 남는다.
    - `aria-describedby`로 안내가 이어진다.
  - 정렬 `수급 순`을 고르면 칸이 보이고, v2에서는 정렬 구역에 막는 경고가 보이며 실행이 안 된다.
  - 이력 값 포맷: 단일 주체, `both`, 음수, 연속만 켠 경우.
  - 메모 `flowLag`·`flowGap` 문구가 스펙과 같다.
  - 기존 화면 테스트 전부 GREEN.
- [ ] **Step 2:** RED를 확인하고, 구현한 뒤 GREEN을 확인한다. 스펙에 없는 문구를 새로 썼다면 보고에 적는다.
- [ ] **Step 3:** 커밋한다. `feat(screen): investor-flow conditions, flow ranking, history values and notes`

### Task 7: e2e, 문서, 실연결 점검

**Files:**
- Modify:
  - `tests/e2e/screen.spec.ts` (v3 데모 흐름 하나 추가)
  - `README.md` (수집이 매매동향도 받는다는 점, 새 옵션, 실패 시 동작)
  - `docs/live-check.md` (㉓·㉔, 스펙 7장)
  - `docs/superpowers/followups/2026-10-12-gazua-followups.md` (3단계 완료 표시, 남은 2단계)

- [ ] **Step 1:** e2e를 쓴다(4개 프로젝트).
  - 흐름: v3 데모 가져오기 → 새 기준 → 외국인 순매수 규모 ≥ 1% → 미리 보기 → 실행 → 이력 펼침.
  - 이력 값이 `외국인 순매수 20일 x.x%` 형식인지 확인한다.
  - **고른 종목이 모두 데모의 설계 외국인 순매수 종목에 속하는지 확인한다.** 조건을 빼면 실패해야 한다(RED 증거를 보고에 넣는다).
  - `flowLag` 메모를 확인한다.
  - axe 검사(serious·critical 0)를 한다.
  - 대기는 결정적으로 한다. 미리 보기 갱신은 이전 문구가 바뀐 것을 기다린다. `test.setTimeout(180_000)`을 둔다.
- [ ] **Step 2:** 문서를 고친다. live-check ㉓·㉔는 스펙 7장의 항목을 기존 번호 체계와 문체로 쓴다.
- [ ] **Step 3:** 전체 검증을 돌린다(Global Constraints의 명령 전부).
- [ ] **Step 4:** 커밋한다. `test(e2e): investor-flow criteria flow; docs`

## 순서
1 → 2 → 3 → 4 → 5 → 6 → 7

4를 5보다 먼저 한다. 5가 `flow` 필드와 `usesFlow`를 쓰기 때문이다.
