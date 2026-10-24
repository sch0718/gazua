# 내 투자 성과 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 토스 계좌의 체결된 주문을 받아, 같은 날 같은 금액으로 지수나 지수 ETF를 샀을 때와 비교하는 `내 성과` 화면을 더한다.

**Architecture:**
- 프록시 허용 목록에 `GET /api/v1/orders` 하나만 더한다.
- 공급자에 선택 필드 `account: AccountSource`(계좌 id·종료 주문·보유 수량)를 둔다. 토스와 데모가 구현한다.
- 앱은 프로필별 주문 캐시(IndexedDB `gazua-account`)로 이어 받는다. 키 잠금이 켜져 있으면 메모리에만 둔다.
- 계산은 `src/lib/perf/`의 순수 함수다.
  - `ledger`: 주문 정규화와 종목별 처리
  - `portfolio`: 실제·가상 곡선과 흐름
  - `xirr`
  - `years`: 연도 구간
  - `reconcile`: 수량 대조
- 화면은 `src/routes/Performance.svelte`와 `src/lib/ui/perf/*`다.
- 로딩·상태는 `perfController.svelte.ts`가 맡는다.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest(+fake-indexeddb, jsdom), Playwright + axe, lightweight-charts(기존).

**Spec:** docs/superpowers/specs/2026-10-23-account-performance-design.md

## Global Constraints

**보안**
- 허용 목록에는 `'/api/v1/orders': ['GET']`만 더한다.
- 다음은 계속 막고, 프록시 테스트로 확인한다.
  - 같은 경로의 POST
  - `/orders/{id}`와 그 아래의 `modify`·`cancel`
  - `conditional-orders`, `buying-power`, `sellable-quantity`, `commissions`
- 키, 토큰, accountSeq는 코드, 로그, 테스트에 넣지 않는다. fixture는 지어낸 값만 쓴다.
- 새 런타임 의존성은 넣지 않는다.

**계산 규칙(스펙 3장 그대로)**
- 가상 매수는 그날 종가, 소수 수량이다. ETF는 실제 주문의 수수료율을 쓰고, 없으면 0.015%다. 지수는 비용이 없다.
- 같은 날에는 매수를 먼저, 그다음 매도다. 초과 매도분은 양쪽에서 뺀다.
- 분할 보정: 체결가가 [저가 × 0.97, 고가 × 1.03] 밖이면 k = 체결가 ÷ 수정 종가를 쓴다.
- XIRR은 뉴턴법을 쓰고, 실패하면 이분법을 쓴다. 해가 없으면 null이다.
- 기여도 합은 전체 초과 손익과 같다.

**검증 명령**
- `corepack pnpm test`: 기존 2481개와 새 테스트가 모두 통과해야 한다.
- `corepack pnpm check`: 오류 0
- `corepack pnpm check:e2e`
- `corepack pnpm --filter proxy test`
- `corepack pnpm e2e`: 기존 104개와 새 e2e가 통과해야 한다.

## Task 1: 프록시 허용 목록
**Files:** `proxy/src/allowlist.ts`, 프록시 테스트, `proxy/README.md`, `README.md`
- [ ] 실패하는 테스트를 쓴다. GET `/api/v1/orders`는 허용한다. POST `/api/v1/orders`, `/api/v1/orders/abc`, `/api/v1/orders/abc/modify|cancel`, `/api/v1/conditional-orders`(GET·POST), `/api/v1/buying-power`, `/api/v1/sellable-quantity`, `/api/v1/commissions`는 거절한다.
- [ ] `exact`에 한 줄을 더하고 주석을 고친다. 테스트가 통과하는지 본다.
- [ ] 두 README의 보안 문단에 예외를 적는다.

## Task 2: 공급자 타입과 토스 구현
**Files:** `src/lib/providers/types.ts`, `toss.ts`, `toss.account.test.ts`, `fixtures/toss/orders-*.json`
- [ ] `AccountOrder`와 `AccountSource` 타입을 더하고, `MarketDataProvider.account?`를 더한다.
- [ ] 실패하는 테스트를 쓴다.
  - 두 페이지 이어 받기(cursor)
  - 헤더 `x-tossinvest-account`
  - `status=CLOSED&limit=100`, from/to 전달
  - 같은 커서 반복이면 upstream
  - 행 거르기: 0주, `*_REJECTED`, 가격·금액 보충, 수수료 null → 0
  - 보유 수량
  - accountId
- [ ] `TOSS_QUEUE_RATES.ORDER_HISTORY = 1`
- [ ] 계좌 고르기 함수 `brokerageSeq()`를 `groupImport.holdings`와 같이 쓴다.
- [ ] 기존 toss 테스트(가져오기 포함)가 그대로 통과하는지 본다.

## Task 3: 데모 계좌
**Files:** `src/lib/providers/demo.ts`, `demo.test.ts`
- [ ] 같은 seed·같은 now면 같은 주문이 나오는지 테스트한다. 주문은 2025-02 이후, 오늘 전이고, 가격은 그날 데모 종가 근처다. 보유 수량 하나가 1주 어긋나야 한다.
- [ ] 구현한다. 오늘 전 거래일 중에서 seed로 날짜를 고른다.

## Task 4: XIRR
**Files:** `src/lib/perf/xirr.ts`, `xirr.test.ts`
- [ ] 알려진 값을 테스트한다.
  - 1년 뒤 1.1배면 10%다.
  - 반년 뒤 1.05배면 약 10.25%다.
  - 여러 흐름은 엑셀 XIRR 예제와 비교한다.
  - 부호가 바뀌지 않으면 null이다.
  - 전액 손실(−100%에 가까움)도 다룬다.
- [ ] 구현한다.

## Task 5: 장부와 포트폴리오 계산
**Files:** `src/lib/perf/types.ts`, `ledger.ts`, `portfolio.ts`, 테스트
- [ ] 입력은 `{ orders, metas, candles: Map<symbol, Candle[]>, bench: { kind: 'index'|'etf', id, byStock?: Map<symbol, series> } }`다.
- [ ] 실패하는 테스트를 쓴다.
  - 매수 하나: 지수 가상, ETF 가상
  - 부분 매도 비율
  - 초과 매도
  - 같은 날 매수 → 매도 순서
  - 봉 빠진 날은 직전 종가
  - 벤치마크 봉이 늦게 시작함
  - 비교 못 한 거래
  - 분할 보정
  - 해외 주문 제외 수
  - 기여도 합 = 초과 손익
  - IRR 연결
- [ ] 구현한다. 결과 모양은 다음과 같다.
  - `curve[{date, actual, virtual, invested}]`
  - `flows`(실제·가상)
  - `perSymbol[]`
  - `notices`
  - `summary`

## Task 6: 연도별 보기와 수량 대조
**Files:** `src/lib/perf/years.ts`, `reconcile.ts`, 테스트
- [ ] 연도 구간은 시작 평가금액을 첫 흐름으로 둔다. 회수액은 다시 센다. 종목별 손익도 그 연도 구간만 센다.
- [ ] 대조 결과는 `맞음`, `맞지 않음(보유 더 많음/적음)`, 주문 없는 보유 종목, `확인 못 함`이다.

## Task 7: 주문 캐시와 앱 연결
**Files:** `src/lib/perf/orderCache.ts`, 테스트, `src/lib/state/app.svelte.ts`, `schema.ts`, `validate.ts`, `routes.ts`
- [ ] 캐시 테스트(fake-indexeddb)
  - get/put/remove(profile 단위)
  - IndexedDB가 없으면 메모리
- [ ] 동기화 함수 `syncOrders(source, cache, key, {persist, now, full})` 테스트
  - 처음이면 전체를 받는다.
  - 다음이면 `from = syncedThrough − 7일`이다.
  - orderId로 덮어쓴다.
  - persist false면 저장하지 않는다.
- [ ] 라우트 `#/performance`(parse·hash 테스트)
- [ ] 설정 `perfBenchmark: 'AUTO'|'KOSPI'|'KOSDAQ'|'069500'|'229200'|null`(null이면 설정 benchmark를 따른다)과 검증
- [ ] App에 `orderCache`를 노출한다. 키 잠금을 켤 때, clearSecrets, deleteProfile에서 그 프로필 항목을 지운다.

## Task 8: 로딩 컨트롤러
**Files:** `src/lib/ui/perf/perfController.svelte.ts`, 테스트
- [ ] 상태는 `idle → orders(n) → prices(i/N) → done | error | empty | unsupported`다.
- [ ] 벤치마크·연도를 바꾸면 봉을 다시 받지 않고 다시 계산한다.
- [ ] 다시 시도, 처음부터 다시 받기, 취소(화면을 떠남)

## Task 9: 화면
**Files:** `src/routes/Performance.svelte`, `src/lib/ui/perf/{SummaryCards,PerfChart,ContributionTable,perfText}.svelte|ts`, 테스트, `App.svelte`, `Rail.svelte`
- [ ] 컴포넌트 테스트
  - 빈 화면(KIS)
  - 불러오는 중 문구
  - 오류와 다시 시도
  - 결과: 카드 세 장, 차트 선 세 개, 표 행, 펼치기
  - 맞지 않음 안내
  - 해외 주문 안내
  - 403 `proxy-path-blocked` 문구
- [ ] 상단 바 아이콘과 레일 항목 `내 성과`
- [ ] 반응형(폰 3열·좁으면 세로, PC 2열), `tabular-nums`

## Task 10: e2e와 문서
**Files:** `tests/e2e/performance.spec.ts`, `docs/live-check.md`, `README.md`
- [ ] 데모로 화면을 연다. 벤치마크를 `KODEX 200`으로 바꾸고, 연도를 바꾸고, 행을 펼치고, axe 위반 0을 확인한다. 폰과 PC 둘 다 본다.
- [ ] live-check ㉗ 항목, README 주요 기능과 문서 목록
- [ ] 전체 검증 명령
