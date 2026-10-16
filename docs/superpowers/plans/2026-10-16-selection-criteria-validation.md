# 선정 기준 검증 (1단계) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 정한 종목 선정 기준을 과거 시점마다 적용해 고른 종목들의 성과를 보여 준다. 성과는 ① 동일 비중 보유, ② 기존 매매 규칙 시뮬레이션 두 방식으로 내고, 시장 지수·ETF와 견줘 기준이 괜찮은지 검증한다.

**Architecture:**
- 사용자 컴퓨터의 Node 스크립트가 KIS에서 전 종목 일봉과 마스터 정보를 받아 압축 JSON 파일을 만든다.
- 앱은 그 파일을 IndexedDB로 가져온다.
- 검증 계산은 순수 함수(`src/lib/screen/*`)이고, Web Worker에서 돈다.
- ②는 기존 `simulate()`에 선택 필드 `buyWindows` 하나만 더해 재사용한다.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest + @testing-library/svelte(jsdom) + fake-indexeddb, `idb`, Node 22 내장 `fetch`·`zlib`·`node:test`, Playwright + axe.

**Spec:** docs/superpowers/specs/2026-10-16-selection-criteria-validation-design.md. 기반 스펙은 docs/superpowers/specs/2026-10-12-backtest-simulation-design.md와 docs/superpowers/specs/2026-10-11-stock-compare-design.md다.

## Global Constraints

- **새 런타임 의존성 없음.** 테스트용 devDependency도 가능하면 기존 것(`fake-indexeddb`, `idb`)을 쓴다.
- **키 보호**
  - 키·토큰은 로그·오류·출력·파일·URL·배너 어디에도 넣지 않는다.
  - 수집 스크립트는 키를 환경변수 `KIS_APP_KEY`·`KIS_APP_SECRET`으로만 받는다.
- **프록시 허용 목록은 바꾸지 않는다.** 주문·계좌 경로는 `403 proxy-path-blocked`로 유지한다.
- **수집 파일 형식**은 `format: 'gazua-market-data'`, `version: 1`이다. 저장소에 커밋하지 않는다. `.gitignore`에 `data/`를 넣는다.
- **미래 정보 차단.** 모든 조건은 재선정일 d의 **전 거래일 p까지**의 봉만 쓴다. 매수·매도는 재선정일 시가에 한다.
- **돈 계산 규칙**
  - 금액은 `roundMoney`(0.0001원)로 둔다.
  - 수량은 `maxShares`(정수 주)로 구한다.
  - 매도세는 `sellTaxPct(settlementDate(...))`로 결제일 기준으로 낸다.
  - 수수료 기본값은 0.015%다.
- **기본값과 범위**

  | 항목 | 기본값 | 범위 |
  |---|---|---|
  | 기준 이름 | | 30자 이내 |
  | 고를 개수 `take` | 10 | 1~30 |
  | 비교 종목 | `['069500']` | 최대 3개 |
  | 재선정 | `'monthly'` | |
  | 자본 | 10,000,000 | |
  | 수집 기간 | 5년 | |
  | 데이터 경고 | 30일 | |

  관심 그룹에는 `MAX_ITEMS = 8`개까지만 넣는다.
- **UI**
  - 문구는 ~해요체로 쓰고, 스펙 7.3의 조건 설명과 7.4·8장의 문구를 그대로 쓴다.
  - 기존 토큰과 컴포넌트(`Toggle`, `NumberField`, `Sheet`, `Snackbar`, 차트)를 쓴다.
  - 등락은 ▲▼와 `trendClass`로 표시한다.
  - 터치 대상은 44px 이상이고, axe 검사를 통과해야 한다.
- **환경**
  - 모든 pnpm 명령 앞에 `export PATH=/opt/homebrew/opt/nvm/versions/node/v22.15.1/bin:$PATH`를 붙인다.
  - 검증 명령: `corepack pnpm test`, `check`, `check:e2e`, `build`, `e2e`. 4173 포트가 비었는지 먼저 확인한다.
- **기존 동작 보존.** 기존 시뮬레이션 결과는 바뀌지 않아야 한다. `buyWindows`가 없으면 결과가 지금과 같다.

## Review Focus

1. **당일 봉 누설.** 재선정일 당일 봉의 값만 바꿔도 선별 결과가 같아야 한다(Task 5 테스트).
2. **같은 종목이 다시 뽑힘.** 수량 차이만 거래하고, 수수료도 그 차이에만 붙어야 한다(Task 6 테스트).
3. **구간 중 봉이 끊긴 종목(거래정지).** 마지막 종가로 평가하고, 다음 재선정일에 봉이 없으면 마지막 종가로 판 것으로 기록해야 한다(Task 6 테스트).
4. **이어 받기 중 수정주가 변경.** 겹치는 5거래일이 다르면 그 종목만 전체를 다시 받아야 한다. 다른 종목의 기존 값은 그대로 둔다(Task 2 테스트).
5. **큰 파일 가져오기.** 저장 공간이 모자라면 기존 데이터를 지우지 않고 거부해야 한다. 가져오는 도중 실패해도 이전 데이터가 남아야 한다(Task 3 테스트).

---

### Task 1: 마스터 파서 확장과 시장 데이터 형식

**Files:**
- Modify: `scripts/parse-master.mjs`
- Create: `scripts/parse-idxcode.mjs`
- Create: `src/lib/marketData/format.ts`
- Test: `tests/parse-master.test.mjs`(node:test), `src/lib/marketData/format.test.ts`
- Modify: `package.json`(`test:scripts`: `node --test tests/*.test.mjs`. 기존 `test:universe`·`test:demo`는 그대로 둔다)
- Modify: `.github/workflows/ci.yml`(ci 잡에 `pnpm test:scripts` 단계 추가)

**Interfaces:**
- Produces:
  - `parseMaster(bytes, market, { detail: true })` → 기존 필드 + `sec: [string, string, string]`, `shares: number`(주, 천 주 × 1000), `managed: boolean`, `halted: boolean`. 옵션이 없으면 기존 출력과 같다. `build-universe.mjs`는 바뀌지 않는다.
  - 오프셋(뒷부분 tail 기준): 업종 3:4·7:4·11:4. 상장주수는 KOSPI 113:15, KOSDAQ 108:15. 관리종목은 KOSPI 62:1, KOSDAQ 57:1. 거래정지는 KOSPI 60:1, KOSDAQ 55:1. 값이 `'Y'`이면 true다.
  - `parseIdxcode(bytes) → { code: string; name: string }[]`. `idxcode.mst`는 CP949 고정폭이다. 실제 파일로 자르는 위치를 확인하고 fixture로 고정한다.
  - `format.ts`: `MarketDataFile` 타입(스펙 3.4 그대로), `validateMarketData(x: unknown): { ok: true; data: MarketDataFile } | { ok: false; reason: 'format' | 'version-newer' | 'corrupt' }`.

- [ ] **Step 1:** 실패하는 테스트를 쓴다.
  - `tests/parse-master.test.mjs`에서 KOSPI·KOSDAQ 각 2행의 바이트 fixture를 만든다. 삼성전자처럼 업종 `0013`, 상장주수 `000000005846278`, 관리 `N`인 행과, 관리 `Y`·거래정지 `Y`인 행이다.
  - `detail: true`이면 `shares === 5846278000`, `sec[0] === '0013'`, `managed === false`임을 확인한다.
  - 옵션이 없으면 키가 `s, n, m, t`뿐인지 확인한다.
  - `parseIdxcode` fixture는 2행이다.
- [ ] **Step 2:** `format.test.ts`를 쓴다. 다음을 확인한다.
  - 정상 파일은 ok다.
  - `version: 2`는 `version-newer`다.
  - `o`와 `c`의 길이가 다르면 `corrupt`다.
  - 날짜가 내림차순이면 `corrupt`다.
  - `c`에 0이나 NaN이 있으면 `corrupt`다.
  - `format`이 다르면 `format`이다.
- [ ] **Step 3:** RED를 확인한다. 실행: `node --test tests/parse-master.test.mjs`, `TZ=America/New_York corepack pnpm vitest run src/lib/marketData/format.test.ts`
- [ ] **Step 4:** 구현하고 GREEN을 확인한다. `pnpm test:universe`도 통과해야 한다(기존 출력 불변).
- [ ] **Step 5:** 커밋한다. `feat(data): master parser reads sector, shares and status; market-data file format`

### Task 2: 수집 스크립트

**Files:**
- Create: `scripts/kis-collect.mjs`(토큰·속도·페이징), `scripts/collect-market-data.mjs`(진입점·이어 받기·출력)
- Modify: `package.json`(`"collect": "node scripts/collect-market-data.mjs"`), `.gitignore`(`data/`)
- Test: `tests/collect-market-data.test.mjs`(node:test, 가짜 `fetch` 주입)

**Interfaces:**
- Consumes: Task 1의 `parseMaster(..., { detail: true })`, `parseIdxcode`, 그리고 `MarketDataFile` 형식(스크립트는 JS라 같은 모양을 손으로 맞춘다. 테스트에서 `validateMarketData`를 쓸 수 없으므로 같은 규칙을 `tests/`에서 확인한다).
- Produces:
  - `createKisClient({ appKey, appSecret, paper, fetchImpl, now, sleep }) → { dailyCandles(symbol, from, to), indexDaily(id, from, to) }`
    - 토큰은 첫 호출 때 한 번 발급한다(`POST /oauth2/tokenP`).
    - 초당 18건을 넘지 않는다. 429나 `msg_cd === 'EGW00201'`이면 1초 쉬고 다시 시도하며, 최대 4번 시도한다.
    - 일봉 TR: `/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice`, `tr_id` `FHKST03010100`, `FID_COND_MRKT_DIV_CODE: 'J'`, `FID_PERIOD_DIV_CODE: 'D'`, `FID_ORG_ADJ_PRC: '0'`, `FID_INPUT_DATE_1`·`FID_INPUT_DATE_2`. 응답 `output2`의 `stck_bsop_date`, `stck_oprc`, `stck_hgpr`, `stck_lwpr`, `stck_clpr`, `acml_vol`, `acml_tr_pbmn`을 쓴다.
    - 지수 일봉: `inquire-daily-indexchartprice`, `FHKUP03500100`, `U`, `0001`(KOSPI)·`1001`(KOSDAQ). 응답의 `bstp_nmix_oprc`(시가)·`bstp_nmix_prpr`(종가)를 `indices[].o`·`c`로 저장한다(`kis.ts`의 `mapDailyRow`와 같은 필드).
    - 페이징: 받은 가장 오래된 날짜 전날로 `FID_INPUT_DATE_2`를 옮겨 `from`에 닿을 때까지 받는다.
  - `collect({ years, out, update, client, master, now, log }) → { file: MarketDataFile; summary }`
  - `mergeUpdate(old, fresh5, refetch)`: 이어 받기와 수정주가 변경 감지
  - CLI 옵션: `--years N`(기본 5), `--out DIR`(기본 `~/gazua-data/`), `--update FILE`, `--paper`
  - 저장소 안이면서 `data/` 밖인 출력 경로는 거부한다. 진행분은 `<out>.partial`에 남기고, 완료되면 `rename`한다.
  - 요약 출력: 종목 수, 기간, 다시 받은 종목 수, 실패 코드, 소요 시간, 파일 크기.

- [ ] **Step 1:** 실패하는 테스트를 쓴다. 모두 가짜 fetch로 돈다.
  - (a) 250일을 100행씩 3페이지로 나눠 받는다.
  - (b) 429를 한 번 받은 뒤 성공한다.
  - (c) 토큰 발급은 실행당 1번이다.
  - (d) **키와 토큰이 `log`로 받은 모든 출력, 오류 메시지, 쓴 파일 내용 어디에도 없다.** 문자열을 검색해 확인한다.
  - (e) `--update`: 겹치는 5일이 같으면 새 날짜만 붙인다. 한 종목만 종가가 다르면 그 종목만 전체를 다시 받고, 다른 종목 배열은 같은 참조이거나 같은 값이다.
  - (f) 마스터에서 빠진 종목은 결과에서 빠진다.
  - (g) `.partial`이 있으면 이어서 받는다(끝난 종목은 다시 요청하지 않음).
  - (h) 저장소 안 경로(`src/out`)를 거부한다.
  - (i) 지수 파일에 `o`·`c`가 같은 길이로 들어간다.
- [ ] **Step 2:** RED를 확인한다. 실행: `node --test tests/collect-market-data.test.mjs`
- [ ] **Step 3:** 구현한다. 압축은 `zlib.gzipSync`다. 숫자 배열은 정수 그대로 둔다.
- [ ] **Step 4:** GREEN을 확인한다. `pnpm test:scripts`도 통과해야 한다.
- [ ] **Step 5:** 커밋한다. `feat(scripts): collect all-stock daily data from KIS into a market-data file`

### Task 3: 앱 — 시장 데이터 저장소와 가져오기

**Files:**
- Create: `src/lib/marketData/store.ts`
- Create: `scripts/make-demo-market-data.mjs`, `tests/fixtures/market-data-demo.json.gz`(만든 결과를 커밋. 합성 데이터)
- Modify: `src/lib/ui/settings/DataTools.svelte`(가져오기·표시·지우기)
- Test: `src/lib/marketData/store.test.ts`, `src/lib/ui/settings/DataTools.test.ts`

**Interfaces:**
- Consumes: Task 1의 `validateMarketData`
- Produces:
  - `openMarketData(): MarketDataStore`
    - `info(): Promise<{ collectedAt; stocks: number; range } | null>`
    - `load(): Promise<MarketDataFile | null>`
    - `importFile(file: Blob, deps?: { estimate?: () => Promise<{ quota?: number; usage?: number }> }): Promise<{ ok: true; info } | { ok: false; reason: 'format' | 'version-newer' | 'corrupt' | 'quota'; neededMb?: number }>`
    - `clear(): Promise<void>`
  - DB는 `gazua-market-data`, store는 `files`, 키는 `'current'` 하나다.
  - 저장은 한 트랜잭션에서 새 값으로 바꿔치기한다. 실패하면 이전 값이 남는다.
  - 풀기는 `new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).json()`이다. jsdom에 없으면 주입 가능한 `decompress` 인자로 테스트한다.
  - 필요 크기는 압축을 푼 바이트 × 1.2로 잡는다. `estimate`에서 `quota − usage`가 이보다 작으면 `quota`로 거부한다.
  - 가져온 뒤 `navigator.storage.persist?.()`를 요청한다.
  - 데모 파일: 종목 30개(KOSPI 주식 15, KOSDAQ 주식 10, ETF 5, 그중 `069500` 포함)를 2년치로 만든다. 업종은 3개로 나눈다. 가격은 고정 시드 난수로 만든다.

- [ ] **Step 1:** 실패하는 테스트를 쓴다. 저장소 테스트(fake-indexeddb):
  - 가져오기 → `info`
  - 손상 파일이면 거부하고 이전 데이터를 유지한다.
  - `quota` 부족이면 거부하고 이전 데이터를 유지한다. `neededMb`를 알려 준다.
  - `clear`
- [ ] **Step 2:** DataTools 테스트를 쓴다.
  - 파일 선택 → `수집 2026-10-16 · 30종목 · …` 표시
  - 손상 파일이면 `파일을 읽을 수 없어요. 수집을 다시 해 주세요`
  - 새 버전 파일이면 `새 형식의 파일이에요. 앱을 새로 고친 뒤 다시 가져와 주세요`
  - 공간 부족이면 `저장 공간이 부족해요(필요 약 n MB)`
  - `지우기` 버튼
- [ ] **Step 3:** RED → 구현 → GREEN을 거친다. 데모 파일 생성 스크립트를 돌려 fixture를 커밋한다.
- [ ] **Step 4:** 커밋한다. `feat(data): import a market-data file into the browser`

### Task 4: 선정 기준 모델과 저장

**Files:**
- Create: `src/lib/screen/types.ts`, `defaults.ts`, `validate.ts`, `criteriaStore.ts`
- Modify: `src/lib/state/profileStore.ts`(`profileKeys.criteria(id) = p:${id}:criteria`), `src/lib/state/exportImport.ts`(포함), `src/lib/state/app.svelte.ts`(`app.criteria`, 저장·삭제, 프로필 삭제 시 키 제거)
- Test: 각 `*.test.ts`, `exportImport.test.ts`

**Interfaces:**
- Produces:
  - `SelectionCriteria`(스펙 5장 그대로)
  - `newCriteria(now: number, dataRange: { from; to } | null, name = '새 기준'): SelectionCriteria`. 기간 기본값은 데이터 시작 + 1년 ~ 데이터 끝이다. 데이터가 없으면 최근 3년이다.
  - `sanitizeCriteria(raw: unknown, now): { criteria: SelectionCriteria[]; repaired: boolean }`
    - 시뮬레이션 `sanitizeStrategies`와 같은 규칙을 쓴다. 범위 밖 숫자·빈 배열·잘못된 열거값은 기본값으로 되돌리고 `repaired`를 켠다. 빈 id는 버린다. 정수 필드는 `Number.isInteger`로 검사한다.
  - `MAX_CRITERIA = 20`, `TAKE_MAX = 30`, `BENCH_MAX = 3`
  - `loadCriteria(st, profileId)`, `saveCriteria(st, profileId, list)`
  - `criteriaIssues(c, strategies): Issue[]`. 참조 전략(`rebound.pattern.strategyId`, `trading.strategyId`)이 없으면 `blocking: true`다. 켠 조건이 0개이면 경고로 `조건이 없으면 후보 범위의 모든 종목에서 정렬 순으로 골라요`를 낸다.

- [ ] **Step 1:** 실패하는 테스트를 쓴다.
  - 기본값을 스펙과 대조한다.
  - sanitize: `take: 0`·`take: 31`·`take: 2.5`, `markets: []`, `symbols` 4개, 빈 id
  - 내보내기·가져오기 왕복
  - 프로필 삭제 시 키 제거
  - 참조 전략 삭제 시 `blocking` 이슈
- [ ] **Step 2:** RED → 구현 → GREEN을 거친다.
- [ ] **Step 3:** 커밋한다. `feat(screen): selection criteria model, storage and import/export`

### Task 5: 지표 미리 계산과 선별

**Files:**
- Create: `src/lib/screen/precompute.ts`, `src/lib/screen/select.ts`
- Test: `precompute.test.ts`, `select.test.ts`

**Interfaces:**
- Consumes: `MarketDataFile`, `SelectionCriteria`, `createPatternTracker`(`src/lib/sim/pattern.ts`), `sma`
- Produces:
  - `tradingAxis(data: MarketDataFile): string[]`: 지수 날짜 ∪ 종목 날짜, `YYYY-MM-DD`, 오름차순
  - `rebalanceDates(axis: string[], period, every: 'monthly' | 'quarterly' | 'semiannual'): string[]`. 기간 안의 월·분기(1·4·7·10월)·반기(1·7월) 첫 거래일이다. 기간 시작이 거래일이 아니면 그 뒤 첫 거래일부터다.
  - `resolveReboundEntry(criteria, strategies): Strategy['entry'] | null` — `rebound.on`이 꺼져 있으면 null, `from: 'strategy'`면 그 전략의 `entry`(없으면 `MissingStrategyError`), `'custom'`이면 그 값
  - `precompute(data, criteria, reboundEntry: Strategy['entry'] | null): Precomputed`
    - 종목마다 다음을 날짜 인덱스로 갖는다: `close`, 거래대금 이동평균, `sma(period)`, 250일 롤링 최대(최소 120개), 일간 수익률 표본 표준편차, 반등 신호일 집합.
    - 반등 신호일은 `createPatternTracker`로 종목마다 날짜순 `signal(i)` → `update(i)`를 돌려, 신호가 난 i의 날짜를 모은 것이다. 매수 뒤 reset은 하지 않는다. 신호 발생만 본다.
  - `selectAt(d: string, pre: Precomputed, c: SelectionCriteria, poolOverride?: Pick<SelectionCriteria['pool'], 'markets' | 'types'>): Selection`(스펙 6.1의 타입)
    - 순서: 후보 범위 → 조건 → 정렬 → 상위 `take`
    - 대장주 순위는 후보 범위·조건 적용 **전** 전체 종목에서 같은 업종 레벨로 매긴다.
    - 동률은 종목코드 오름차순이다.
    - 정렬 기본 일수: 수익률은 `returnRange.days`, 꺼져 있으면 60. 변동성은 `volatility.days`, 꺼져 있으면 20.

- [ ] **Step 1:** 실패하는 테스트를 쓴다. 손으로 만든 봉 4~6종목을 쓴다.
  - 각 조건이 손계산 값과 같다(스펙 5.1 표의 식).
  - **누설 방지:** d의 봉 값(o, h, l, c, v, tv)만 극단값으로 바꿔도 `selectAt(d)` 결과가 같다.
  - `p`에 봉이 없는 종목은 탈락한다.
  - 52주 봉이 120개 미만이면 탈락하고, 120~249개면 있는 만큼으로 계산한다.
  - 대장주: 업종 레벨 1·2, 업종 코드 없음, 동률
  - 정렬 4종, 상위 N, 통과 0개
  - `rebalanceDates`: 월 첫 거래일, 1월 2일 휴장, 분기·반기, 비거래일로 시작하는 기간
  - `poolOverride`로 시장만 바꿀 수 있다.
- [ ] **Step 2:** RED → 구현 → GREEN을 거친다.
- [ ] **Step 3:** 커밋한다. `feat(screen): point-in-time indicators and selection`

### Task 6: ① 동일 비중 보유와 성과 지표

**Files:**
- Create: `src/lib/screen/holdSelection.ts`, `src/lib/screen/metrics.ts`
- Test: `holdSelection.test.ts`, `metrics.test.ts`

**Interfaces:**
- Consumes: `Selection[]`, `MarketDataFile`, `maxShares`, `costOf`(position.ts), `roundMoney`, `sellTaxPct`, `settlementDate`(tax.ts). 세금 시장은 종목 `m`이고, `isEtf = t === 'ETF'`다.
- Produces:
  - `holdSelection(input: { axis: string[]; selections: Selection[]; data: MarketDataFile; capital: number; feePct: number; periodEnd: string }): { equity: { date: string; value: number }[]; segments: { from: string; to: string; picked: { symbol: string; retPct: number | null; soldAtLastClose: boolean; notBought: boolean }[] }[] }`
    - 재선정일 시가에 그 시점 자산 ÷ 고른 수로 금액을 나눈다. 수량은 `maxShares`다.
    - 이미 들고 있는 종목은 목표 수량과의 차이만 사고판다.
    - 다음 재선정일에 봉이 없으면 마지막 종가로 판 것으로 계산하고 `soldAtLastClose: true`로 둔다.
    - 재선정일 d에 봉이 없는 선정 종목은 사지 않고, 배정 금액을 그 구간 동안 현금으로 둔다(다른 종목에 다시 나누지 않음). `picked[]`에 `notBought: true`를 둔다.
    - 평가는 매 거래일 종가이고, 봉이 없으면 직전 종가다.
  - `curveStats(curve: number[], days: string[], initial: number): { totalPct; cagrPct; mddPct; volPct }`. CAGR은 달력일 기준 `(end/initial)^(365/일수) − 1`이다. 변동성은 일간 수익률 표준편차 × √252다.
  - `beatCount(segments, indexCurve, axis): { beat: number; total: number }`

- [ ] **Step 1:** 실패하는 테스트를 쓴다. 손계산 시나리오: 2종목, 재선정 3회.
  - 수수료·세금(결제일 기준)을 포함한 자산 값이 손계산과 같다.
  - 다시 뽑힌 종목은 차이만 거래하고, 수수료가 그 차이에만 붙는다.
  - 통과 0개 구간은 현금이다.
  - 재선정일 d에 봉이 없는 선정 종목: 그 몫은 현금으로 남고 나머지 종목 수량은 늘지 않는다, `notBought: true`.
  - 구간 중 봉이 끊기면 직전 종가로 평가한다.
  - 다음 재선정일에 봉이 없으면 `soldAtLastClose`다.
  - `curveStats`·`beatCount` 값을 확인한다.
- [ ] **Step 2:** RED → 구현 → GREEN을 거친다.
- [ ] **Step 3:** 커밋한다. `feat(screen): equal-weight holding of each selection and curve stats`

### Task 7: 엔진 확장 — `buyWindows`

**Files:**
- Modify: `src/lib/sim/types.ts`(`SimInput.stocks[i].buyWindows?: { from: string; to: string }[]`, `Skip.reason`에 `'선정 기간이 아니에요'` 추가), `src/lib/sim/simulate.ts`, `src/lib/ui/simulate/SkipList.svelte`(새 사유 표시. 문구는 그대로)
- Test: `src/lib/sim/simulate.test.ts`

**Interfaces:**
- Produces: `simulate(input)`는 그대로다.
  - `buyWindows`가 있으면 첫 매수와 분할 매수를 창 안의 날짜에만 체결한다. 창 밖 신호는 `Skip { reason: '선정 기간이 아니에요' }`로 남긴다(같은 날·종목·사유는 한 번).
  - 매도(손절·익절·갭)는 창과 상관없다.
  - 패턴 추적기는 창과 무관하게 매일 update한다.

- [ ] **Step 1:** 실패하는 테스트를 쓴다.
  - (a) **기존 테스트 전부 + 대표 시나리오 3개에서 `buyWindows` 없이 결과가 `toEqual`로 같다.** 같은 입력으로 두 번 돌리는 것이 아니라, 기존 기대값 그대로를 확인한다.
  - (b) 창 밖 신호는 건너뛰고 사유를 기록한다.
  - (c) 창이 끝난 뒤에도 손절·익절이 계속된다.
  - (d) 분할 매수도 창 밖에서는 건너뛴다.
- [ ] **Step 2:** RED → 구현 → GREEN을 거친다. 기존 시뮬레이션 화면 테스트도 그대로 통과해야 한다.
- [ ] **Step 3:** 커밋한다. `feat(sim): optional buy windows per symbol`

### Task 8: 검증 실행 묶음과 Worker

**Files:**
- Create: `src/lib/screen/runValidation.ts`, `src/lib/screen/worker.ts`, `src/lib/screen/validationController.svelte.ts`
- Test: `runValidation.test.ts`, `validationController.test.ts`

**Interfaces:**
- Consumes: Task 5·6·7(`resolveReboundEntry`, `precompute(data, criteria, entry)`), `simulate`, `indexCurve`·`singleCurve`(benchmarks.ts), `Strategy`(②와 반등 패턴)
- Produces:
  - `runValidation(input: { data: MarketDataFile; criteria: SelectionCriteria; strategies: Strategy[] }, onProgress?: (done: number, total: number) => void, isCancelled?: () => boolean): ValidationResult | { cancelled: true }`
  - `ValidationResult`의 필드:
    - `axis`
    - `rebalances: Selection[]`
    - `today: Selection`: 데이터 마지막 거래일의 다음 날로 본 선별. 즉 마지막 날까지의 봉을 쓴다.
    - `hold`: Task 6의 결과 + `stats` + `beat`
    - `trading`: `simulate()` 결과 요약 + 곡선, 또는 null
    - `indices`: `{ id; curve; stats }[]`
    - `benchmarks`: `{ symbol; name; curve | null; reason?: '받지 못했어요' | '기간 일부만 받았어요'; stats }[]`
    - `byMarket`: `{ key: 'KOSPI' | 'KOSDAQ' | 'ETF'; inPool: boolean; stats; avgPicked }[]`
    - `notes`: `('survivorship' | 'snapshot' | 'dividend' | 'fewSegments' | 'warmup' | 'allEmpty')[]`
  - ②의 `SimInput`: 참조 전략에서 `entry`·`scaleIn`·`exit`·`capital.perBuyPct`만 쓰고, `period` ← 기준 기간, `capital.initial` ← `criteria.capital`, `costs.feePct` ← `criteria.costs.feePct`, `benchmarks` ← 기준의 첫 지수로 바꾼다(①과 같은 자본·비용). `stocks`는 한 번이라도 뽑힌 종목, 그 `buyWindows`는 뽑힌 구간들이다. 시장 표기는 수집 파일의 `m`, `isEtf`는 `t === 'ETF'`로 만든다.
  - `byMarket`: `poolOverride`를 `{markets:['KOSPI'],types:['STOCK']}`, `{markets:['KOSDAQ'],types:['STOCK']}`, `{markets:['KOSPI','KOSDAQ'],types:['ETF']}`로 바꿔 ①만 돌린다.
  - `notes` 조건
    - `fewSegments`: 재선정 구간이 12개 미만
    - `warmup`: 기간 시작 전 데이터가 1년(250거래일) 미만
    - `allEmpty`: 모든 구간의 통과가 0개
  - 오류
    - 재선정일이 0개면 `throw new ValidationError('no-rebalance')`(문구: `기간 안에 재선정일이 없어요`)
    - 곡선에 NaN·Infinity가 있으면 `ValidationError('invalid-number')`
  - Worker 메시지는 `{ type: 'run', input }` → `{ type: 'progress', done, total }`* → `{ type: 'result', result } | { type: 'error', code }`이다. 취소는 `worker.terminate()`다.
  - `createValidationController({ makeWorker })`: `run(input)`, `cancel()`, `state: 'idle' | 'running' | 'done' | 'error'`, `progress`, `result`, `error`. 테스트는 `makeWorker`에 같은 스레드에서 도는 가짜를 넣는다.
  - `preview(data, criteria, strategies): Selection`: 편집 화면 미리 보기용이다. 같은 Worker의 `{ type: 'preview' }` 메시지로 처리한다.

- [ ] **Step 1:** 실패하는 테스트를 쓴다. 데모 fixture(Task 3)를 풀어 쓴다.
  - 결과 모양이 맞다.
  - 전략의 자본(100만 원)·수수료(0%)가 기준의 자본(1,000만 원)·수수료(0.015%)와 달라도, ②의 첫 자산이 1,000만 원이고 첫 매수에 0.015% 수수료가 붙는다.
  - 지수 곡선이 유한하고 첫 값이 자본과 같다(시가 기준).
  - `rebound.pattern.from: 'strategy'`가 가리키는 전략의 `entry`로 precompute된다(그 전략의 반등 일수를 바꾸면 선별이 바뀐다).
  - ② 없음이면 `trading === null`이다.
  - `byMarket` 3행이 있고, `inPool`이 맞다.
  - 비교 종목이 데이터에 없으면 `reason: '받지 못했어요'`다.
  - 짧은 기간이면 `no-rebalance` 오류다.
  - `isCancelled`이면 `cancelled`다.
  - 진행 콜백이 재선정일 수만큼 불린다.
  - 컨트롤러: 실행 → 진행 → 완료, 취소하면 `idle`로 돌아간다.
- [ ] **Step 2:** RED → 구현 → GREEN을 거친다. Vite에서 `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`로 빌드되는지 `corepack pnpm build`로 확인한다.
- [ ] **Step 3:** 커밋한다. `feat(screen): validation run (hold, trading, benchmarks, by market) in a worker`

### Task 9: 화면 — 탭, 기준 목록, 기준 편집

**Files:**
- Modify: `src/routes/Simulate.svelte`(탭 `매매 규칙`·`선정 기준`, 주소 `#/simulate/criteria…`), 라우팅(`src/lib/state/route.ts` 또는 현재 라우트 파싱 위치)
- Create: `src/lib/ui/screen/CriteriaList.svelte`, `CriteriaEditor.svelte`, `ConditionRow.svelte`, `SectorPicker.svelte`, `PreviewPanel.svelte`, `MarketDataNotice.svelte`, `screenText.ts`(문구·요약)
- Test: 각 `*.test.ts`, `src/routes/Simulate.test.ts`

**Interfaces:**
- Consumes: Task 3 `openMarketData`, Task 4 모델·저장, Task 8 컨트롤러와 `preview`, 기존 `GroupTabs`의 키보드 규칙, 전략 편집의 매수 섹션 컴포넌트(`src/lib/ui/simulate/editor/*`)
- Produces: 탭 컴포넌트와 화면. 목록 행 요약 형식은 `KOSPI·KOSDAQ 주식 · 거래대금 10억↑ · 반등 10일 · 상위 10 · 매월`이다.

- [ ] **Step 1:** 실패하는 테스트를 쓴다.
  - 탭 ←/→로 이동하고, `매매 규칙` 탭에서 기존 화면이 그대로 보인다.
  - 데이터가 없으면 안내 카드가 보이고, 실행 버튼이 비활성이며 이유가 함께 보인다.
  - 30일 지난 데이터면 `데이터가 n일 전 것이에요. 최근 기간은 검증에 빠져요`가 보인다.
  - 목록: 새로 만들기·복제·이름 바꾸기·삭제와 되돌리기가 동작한다. 삭제 뒤 포커스 규칙은 StrategyList와 같다.
  - 편집: 조건 토글과 설명 문구(스펙 7.3 표 그대로)
  - 업종 고르기
  - 반등 패턴의 `전략에서 불러오기`/`직접 정하기`
  - 범위 밖 숫자는 오류를 표시하고 실행을 막는다.
  - 조건 0개면 경고를 보인다.
  - 참조 전략이 지워졌으면 다시 고르게 한다.
  - 미리 보기는 편집 0.3초 뒤 `통과 n개 · 상위 10개`를 보인다(가짜 timer).
- [ ] **Step 2:** RED → 구현 → GREEN을 거친다.
- [ ] **Step 3:** 커밋한다. `feat(screen): criteria tab, list and editor with live preview`

### Task 10: 화면 — 실행과 결과, 관심 그룹 만들기

**Files:**
- Create: `src/lib/ui/screen/ValidationRun.svelte`, `ValidationResult.svelte`, `SelectionHistory.svelte`, `MarketTable.svelte`, `TodayPicks.svelte`
- Modify: `src/lib/ui/simulate/EquityChart.svelte`(필요하면 곡선 여러 개와 재선정 눈금을 받는 선택 prop. 기본 동작은 그대로)
- Test: 각 `*.test.ts`

**Interfaces:**
- Consumes: Task 8 `ValidationResult`·컨트롤러, `app` 그룹 API(새 그룹 만들기, 그룹에 종목 더하기), `MAX_ITEMS`
- Produces: 결과 화면(스펙 7.4의 순서와 문구)

- [ ] **Step 1:** 실패하는 테스트를 쓴다.
  - 진행 `재선정일 계산 중 14/48`(`role=status`)과 취소가 보인다.
  - 요약 카드: ①·②·지수·ETF, `지수보다 나은 구간 m/n`
  - ②가 없으면 `매매 규칙을 고르면 함께 볼 수 있어요`
  - 시장별 표 3행과 원래 범위 표시
  - 선정 이력: 펼치면 조건값이 보이고, `통과 0개 · 현금`, `soldAtLastClose`·`notBought`(`매수 못 함(재선정일 거래 없음)`) 표시
  - 해석 도움말 문구(스펙 7.4 그대로)
  - 오늘 기준 선별 → `관심 그룹으로 만들기`: 10개 중 상위 8개를 넣고 `상위 8개만 넣었어요`를 보인다. 기존 그룹에 더하면 빈자리만큼만 넣는다.
  - NaN이면 실패 화면이 보인다.
- [ ] **Step 2:** RED → 구현 → GREEN을 거친다. 기존 `EquityChart` 테스트도 그대로 통과해야 한다.
- [ ] **Step 3:** 커밋한다. `feat(screen): validation results and picks to a watch group`

### Task 11: e2e, 문서, 실연결 점검

**Files:**
- Create: `tests/e2e/screen.spec.ts`
- Modify:
  - `README.md`: 수집 방법, 예상 시간·크기, 키는 환경변수로만 넣는다는 점, 파일을 커밋하지 말 것
  - `docs/live-check.md`: 스펙 8.3의 ⑯~⑲
  - `docs/superpowers/specs/2026-10-12-backtest-simulation-design.md`: 1.3 범위 밖의 스크리닝 줄에 이 스펙 링크와 `buyWindows`
  - `docs/superpowers/followups/2026-10-12-gazua-followups.md`: 2~4단계를 후속으로 적는다

- [ ] **Step 1:** e2e를 쓴다. 4개 프로젝트에서 돈다.
  - 데모 모드 → 설정에서 `tests/fixtures/market-data-demo.json.gz` 가져오기
  - 시뮬레이션 › 선정 기준 → 새 기준 → 미리 보기 → 검증 실행 → 결과(요약·시장별·이력)
  - 관심 그룹 만들기 → 비교 화면에 그 그룹이 보인다.
  - 탭 키보드 이동, axe 검사(심각·중대 0)
- [ ] **Step 2:** 문서를 고친다.
- [ ] **Step 3:** 전체 검증을 돌린다: `corepack pnpm test`, `check`, `check:e2e`, `build`, `e2e`, `test:scripts`, `test:universe`.
- [ ] **Step 4:** 커밋한다. `test(e2e): selection-criteria validation flow; docs for data collection`

## 순서

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11

- 7은 독립이라 5·6과 순서를 바꿔도 된다.
- 8은 3~7을 모두 쓴다.
