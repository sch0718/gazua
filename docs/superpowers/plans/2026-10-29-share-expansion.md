# 공유 기능 확장 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 받은 공유 링크를 로그인·키 없이 내 앱에 가져오고, 비교 화면·시뮬레이션 결과·선정 기준 검증 결과를 새 공유 종류로 보내며, 카카오톡 카드에 화면 캡처와 요약 문구를 넣어요.

**Architecture:**
- 공유 종류를 `group·strategy·criteria`에서 `compare·simResult·validation`까지 여섯으로 넓혀요. 종류 목록·표시 이름은 `src/lib/share/kinds.ts` 한 곳에 둬요.
- 결과 스냅샷은 `src/lib/share/compact.ts`가 열 형식(날짜 축 + 값 배열)으로 줄여 만들고, 100 KiB를 넘으면 정해진 순서로 줄이다가 그래도 넘으면 거절해요. 결과 부분 검사는 DOM 없는 `src/lib/share/checkResult.ts`가 맡고, 같은 `checkShareSnapshot`을 sync-worker가 그대로 써요. 검사에는 `create`(엄격)·`read`(빠진 필드를 기본값으로 채움) 두 모드가 있어요.
- 가져오기는 SharedView → 탭 저장소(sessionStorage) 대기 값 → `app.leaveShared()`(관문·온보딩) → App의 `ImportHost` 확인 창 → 저장 순서예요. 계획·적용은 순수 함수 `src/lib/share/importPlan.ts`가 해요.
- 카드 이미지는 lightweight-charts `takeScreenshot()`으로 받은 차트에 글자를 직접 그려 합성하고(`src/lib/share/cardImage.ts`), 카카오 SDK `Share.uploadImage`로 올려요. 실패하면 `public/share/<kind>.png` 고정 이미지를 써요.
- 서버(D1 스키마·한도·엔드포인트)는 바꾸지 않아요. `shares.kind`는 제약 없는 TEXT라 마이그레이션이 필요 없어요.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest(jsdom, @testing-library/svelte), axe-core 4.13.0(새로 명시하는 개발 의존성), Playwright(e2e, @axe-core/playwright), lightweight-charts 5.2, @sch0718/kakao-share 0.1.1(Kakao SDK 2.8.4), Cloudflare Workers(sync-worker), playwright-core(고정 이미지 스크립트).

**근거 문서:** docs/superpowers/specs/2026-10-29-share-expansion-design.md(확정 설계, 4회 검토). 절 번호는 이 설계를 가리켜요. 이전 단계 계획은 docs/superpowers/plans/2026-10-25-sync-phase1.md예요.

**실행 방식:** 각 Task는 그 본문만 읽고 구현할 수 있게 썼어요(정확한 파일 경로, 타입·함수 시그니처, 테스트 코드, 실행 명령과 기대 결과, 커밋 메시지). 다른 Task를 가리키는 곳은 **Interfaces**의 Consumes에 이름과 시그니처를 다시 적었어요. Task는 번호 순서대로 해요(뒤 Task가 앞 Task의 산출물을 써요).

## 사용자 결정 (2026-10-29, 설계 1.3)

| # | 항목 | 결정 |
|---|---|---|
| 1 | 받은 링크 가져오기 | group·strategy·criteria와 새 종류를 내 앱에 저장해요. 로그인·키 없이도 돼요. 이름 충돌·종목 한도 같은 경계를 처리해요 |
| 1-1 | 가져오기 동선 | SharedView의 「내 앱에 가져오기」 → 가져올 내용을 sessionStorage에 잠깐 두고 앱을 열어요 → 평소처럼 관문(프로필 선택·키 잠금 해제·첫 실행이면 데모 포함)을 지나요 → "이 프로필에 저장할까요?" 확인 창 → 저장. 키가 없거나 데모여도 돼요 |
| 2 | 비교(현재 시세) 화면 공유 | Compare.svelte에 공유 진입점을 둬요. 새 종류(그룹 종목 + 기간·지표·벤치마크·정렬)예요. 받은 사람은 가져와 자기 연결이나 데모로 같은 화면을 봐요. 시세가 보이는 화면 캡처를 카카오 카드 이미지로 보내요 |
| 3 | 시뮬레이션 결과 공유 | 곡선·거래까지 전부 보내요. 전략 결과(SimResult)와 선정 기준 검증 결과(ValidationResult). 결과 화면에 공유 진입점을 두고, SharedView에서 읽기 전용으로 보여요 |
| 3-1 | 결과 크기 한도 | 100 KiB를 유지하고 줄여요. 열 형식 + 반올림, 그래도 넘으면 곡선 표본을 결정적으로 솎아요(첫·끝·최고·최저 유지, 하한 점 수). 거래는 빠짐없이 넣고, 그래도 넘으면 '너무 커요'로 거절해요. 서버·D1 변경 없이 `checkShareSnapshot`만 넓혀요 |
| 3-2 | 결과 카드 이미지 | 결과 화면 수익 곡선을 비교 화면과 같은 캡처 경로로 캡처해 카드 이미지로 써요 |
| 4 | 카카오 카드 다듬기 | 아이콘 대신 종류별 대표 이미지(비교·결과는 캡처), 종목 수·기간·수익률 같은 요약 문구 |
| 5 | KIS 약관 | 시세가 담긴 캡처·결과를 링크 소지자에게 보내는 것을 사용자가 제5조 ③ 위반 소지를 안내받고 직접 정했어요. 시장 파일 공개 배포 금지는 그대로예요 |
| 6 | 자금 숨김일 때의 결과 금액 | 거래 수량·수수료·세금을 빼고(가격은 남김) 종목별 손익은 자금 대비 %로만 보내요 |
| 7 | 검증 결과의 ② 매매 규칙 전략 | 넣지 않아요. ② 곡선·통계는 결과로 보이고, 확인 창에서 ②가 없다고 알려요 |
| 8 | 카카오톡 인앱 브라우저 | UA에 `KAKAOTALK`가 있으면 「기본 브라우저로 열기」 단추와 안내, 확인 창에 "지금 이 브라우저에 저장돼요". 인앱에서 가져오기를 막지 않아요. iOS Safari와 홈 화면 PWA 저장소가 다르다는 것도 안내해요 |

## 내가 정한 기본값 (계획 확인 때 바꿀 수 있어요)

설계가 정하지 않았거나, 설계와 지금 코드가 어긋나 계획에서 판단한 것만 적어요.

1. **새 타입의 자리:** `CompareSnapshot`·`SimResultSnapshot`·`ValidationSnapshot`과 `ShareAxis`·`ShareRun`·`SharedSimResult`·`SharedValidation` 등 설계 2.2~2.5의 타입은 모두 `src/lib/share/snapshot.ts`에 둬요. `checkResult.ts`는 이 타입을 `import type`으로만 가져와 런타임 순환 import가 생기지 않아요.
2. **`SHARE_SYMBOL_RE`의 자리:** `snapshot.ts`와 `checkResult.ts`가 함께 쓰므로 의존성 없는 `resultEnums.ts`에 둬요. 묶음 종목용 6자리 정규식은 `snapshot.ts`의 `BASKET_SYMBOL_RE`(지금 `SYMBOL_RE`의 이름만 바꿈)로 남겨요.
3. **깊이 상한(설계 2.7):** 반복문으로 도는 `exceedsDepth(v, 32)`를 `forbidden.ts`에 더해 `checkShareSnapshot` 맨 앞에서 불러요. 넘으면 `invalid`예요. `findForbidden`은 깊이 32를 넘는 곳으로 내려가지 않고(null), `jsonDiff`는 그 자리에서 `value` 차이로 멈춰요. `findForbidden`이 예외를 던지게 하면 같은 함수를 쓰는 프로필 검사(`dto.ts`)까지 500이 될 수 있어서예요.
4. **모르는 종류 판정 위치:** `raw.kind !== kind` 확인 바로 뒤, `v`·`title` 확인 앞에서 해요. 새 버전 앱이 `v`를 올려도 `unsupported`로 보이게요. `kind`가 문자열이 아니면 `invalid`예요.
5. **compare 종목 한도:** `snapshot.ts`에 `COMPARE_SYMBOLS_MAX = 10`을 따로 두고, 테스트가 `MAX_ITEMS`(`state/watchlist.ts`)와 같은지 확인해요. Worker 번들이 `watchlist.ts`를 끌어오지 않게요.
6. **`compareSnapshot`의 둘째 인자**는 `Pick<Settings, 'period' | 'metric' | 'benchmark' | 'boardOrder'>`예요(`Settings`를 그대로 넘겨도 돼요).
7. **요약 반올림:** `SimResult['summary']`에서 정수로 두는 것은 `wins`·`losses`·`roundTrips`·`openPositions`·`skippedSignals`예요. `avgHoldDays`(평균 일수)는 소수 둘째 자리로 반올림해요. `nearMiss.declineDays`는 정수, `maxDropPct`는 둘째 자리예요.
8. **`run.from`·`run.to`:** `DoneMeta.from/to` 대신 시뮬레이션은 `result.equity` 첫날·마지막 날, 검증은 `result.axis` 첫날·마지막 날로 만들어요. 검사 규칙("축의 첫날·마지막 날과 같다")과 정확히 맞추려고요. 실제 실행에서는 두 값이 같아요.
9. **건너뜀 이유별 개수:** 만들 때 `n > 0`인 이유만 `SKIP_REASONS` 순서로 넣어요. 검사는 설계대로 0도 받아요. 건너뛴 신호가 하나도 없으면 「건너뛴 신호 목록 → 개수만」 단계는 건너뛰어요.
10. **줄임 안내 문구:** `skipped-counts`는 설계 문구 `건너뛴 신호는 이유별 개수만 보내요`, 나머지는 `no-values` → `선정 이력의 조건 계산값은 빼고 보내요`, `thinned` → `곡선은 점 수를 줄여 보내요`, `codes-only` → `선정 이력은 종목 코드만 보내요`로 정했어요.
11. **검증의 `reduced` 표기:** 이력이 `codes`면 `codes-only`만 넣고 `no-values`는 같이 넣지 않아요(대화 상자 안내가 겹치지 않게). 순서는 `no-values` → `thinned` → `codes-only`, 시뮬레이션은 `skipped-counts` → `thinned`예요.
12. **`collectedAt`:** 시장 파일의 `collectedAt`은 ISO 문자열(`src/lib/marketData/format.ts`)이라 `Date.parse`로 epoch ms를 만들어 `run.fetchedAt`에 넣어요. 읽지 못하면 만들기가 `invalid`예요.
13. **날짜 도구의 자리:** `isIsoDate`·`axisDate`·`dayOffset`은 `checkResult.ts`에 두고 `compact.ts`가 가져다 써요(Worker가 쓰는 쪽에 두는 게 맞아서요).
14. **테스트 고정 데이터:** `src/lib/share/testFixtures.ts`에 손으로 만든 작은 결과 스냅샷(`simResultFixture`, `validationFixture`)과 크기 예산용 생성기(`bigDone`, `bigValidationRun`)를 둬요. 앱·Worker·컴포넌트 테스트가 함께 써요.
15. **가져오기 완료 기록 함수:** `pendingImport.ts`에 `markImported(id)`·`wasImported(id)`를 둬요(설계 4.8의 `gazua:v1:share-import-done`, 최근 20개).
16. **인앱 판정:** 새 파일 `src/lib/share/inApp.ts`에 `isKakaoInApp(ua)`·`isIos(ua)`·`openExternalHref(href)`를 둬요. SharedView와 ImportHost가 함께 써요.
17. **확인 창 안내의 자리:** `from` 기반 안내(결과는 저장하지 않음, ② 없음)와 자금 숨김 안내도 `planImport`의 `notes`에 넣어요. 저장 전 `sanitize*` 재검사도 `planImport`에서 해서, 바뀌면 `blocked: '가져올 수 없는 공유예요'`로 저장 단추를 꺼요. 확인 창이 순수 함수 결과만 그리면 돼서 테스트가 쉬워요.
18. **그룹 자르기·빼기 안내:** `상위 10개만 넣었어요`(설계 4.8 예시)와 `종목 목록에 없는 종목 N개는 뺐어요`예요.
19. **단위 테스트 axe 도우미:** `src/lib/share/testAxe.ts`의 `expectNoAxeViolations(container)`예요. e2e(`tests/e2e/a11y.spec.ts`)와 같은 태그(`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`)만 돌리고 `color-contrast`는 꺼요.
20. **SelectionHistory는 고치지 않아요.** 지금도 `retPct`가 null이면 `—`를 보이고, `expandValidation`이 구간 끝(`to`)까지 다시 만들어 같은 모양을 넘기므로 코드만 이력도 그대로 그려져요. 설계 4.10 표의 `SelectionHistory.svelte` 변경은 필요 없었어요.
21. **SharedView 가져오기 prop:** `onimport?: (s: ShareSnapshot) => void`(기본값은 `stashImport(s, Date.now())`)를 부른 뒤 `onexit()`을 불러요. App은 `onexit`에 `app.leaveShared()`를 넘겨요.
22. **카드 글 만들기:** `compareCardText`·`simResultCardText`·`validationCardText`를 `cardImage.ts`에 둬요. 비교 카드 출처는 `{ kis: '한국투자증권', toss: '토스증권', demo: '데모 데이터' }`예요.
23. **카카오 설명의 거래 수:** simResult 2줄의 `거래 N번`은 결과 화면 「거래 횟수」 카드와 같은 `summary.roundTrips`예요.
24. **받은 시각 표기:** `시세 출처: {source} · YYYY.MM.DD HH:mm 받음`(KST)예요.
25. **확인 창을 닫은 뒤 포커스:** 저장해 이동하면 `tick()` 뒤 이동한 화면의 첫 `h1`(없으면 `h2`)에 `tabindex="-1"`을 붙여 포커스해요. `Sheet`의 `returnFocus`는 연 요소가 사라졌을 때만 쓰여서 이 경우에 맞지 않아요. 「저장하지 않기」는 Sheet 기본 동작대로 둬요.
26. **업로드 시간 초과:** 15초가 지나면 고정 이미지로 돌아가고, 늦게 온 응답의 이미지는 `deleteCardImage`로 지워요.
27. **결과 원문 크기 표시:** `결과 원문(약 {KB} KB)`의 KB는 스냅샷 전체 `jsonBytes`예요(결과 부분만 따로 문자열로 만들지 않으려고요).
28. **막힌 확인 창의 단추:** 설계 4.8 「이때 단추는 `닫기` 하나」를 따라 막히면 `저장` 단추를 그리지 않고(꺼진 단추로 두지 않고) `닫기`만 둬요. 설계 6.3의 「꺼진 저장 단추」는 저장할 수 없다는 뜻으로 읽었어요.
29. **카드 값 목록의 선 색:** 설계 4.3이 「범례(선 색 + 이름)를 카드 오른쪽 목록에 직접 그린다」고 해서 `CardText.rows`에 선택 필드 `swatch?: string`을 더했어요(설계의 타입에는 없어요). 값이 없으면 색 칸을 그리지 않아요.
30. **`DoneMeta.symbols`가 필수가 되는 영향:** `DoneMeta`를 만드는 테스트 고정 데이터(`src/lib/ui/simulate/resultFixture.ts`)에 실행 순서대로 `symbols`를 더해요(종목별 두 개 + 제외 하나).
31. **단위 테스트에서 쓰는 검증 화면 고정 데이터:** 검증 결과 만들기 테스트는 기존 `src/lib/ui/screen/resultFixture.ts`의 `validationResult()`와 기본 기준(`newCriteria`, 비교 지수 KOSPI·지정 ETF 069500)을 짝지어 써요. 두 쪽의 비교 대상이 이미 같아서예요.
32. **비교 화면 공유 단추 자리:** `Compare.svelte`의 머리줄(`bar` 스니펫)에서 그룹 탭 뒤, 제목 앞에 둬요. 설계 4.1 「그룹 탭 줄 끝」을 이렇게 읽었어요.
33. **e2e 대기 값 모양:** 받는 쪽 검사가 빠진 필드를 채워 받으므로(설계 2.7 read) e2e는 전략·기준을 최소 모양(`id`·`name`·`updatedAt`·`universe`)으로 넣어요. 이름 충돌은 첫 실행이 만드는 기본 그룹 「내 관심」(`DEFAULT_GROUP_NAME`)으로 확인해요.

## Global Constraints

**경계(설계 1.6, 5절)**
- 서버 변경 없음: D1 스키마·한도(100 KiB, 활성 50개, 만료 기본 7일·최대 30일)·엔드포인트를 바꾸지 않아요. `sync-worker/src/shares.ts`는 고치지 않아요(테스트만 더해요).
- 스냅샷에 원본 ID·프로필 이름·키·계좌·프록시 주소·최근 그룹·원시 일봉·시장 파일 내용·캡처 이미지를 넣지 않아요. 새 키 이름은 `FORBIDDEN_KEYS`(`src/lib/sync/forbidden.ts`)와 겹치면 안 돼요. 특히 `orders`·`holdings`·`performance`·`theme`·`provider`·`token`.
- 정리 함수(`sanitizeStrategies`·`sanitizeCriteria`·`sanitizeBaskets`·`sanitizeWatchlists`)는 바꾸지 않아요. 종목 코드 검사는 공유 경로(`checkStrategyPart`·`checkCriteriaPart`)에만 둬요.
- 새 의존성은 `axe-core@4.13.0`(개발 의존성, 이미 `@axe-core/playwright`가 끌어오는 버전) 하나뿐이에요. 캡처·고정 이미지에 새 라이브러리를 쓰지 않아요.
- CSP(`index.html`, `kakao-csp.config.ts`)는 바꾸지 않아요. 주석만 더해요.
- 배포 순서: Worker를 먼저 배포하고 앱을 배포해요(설계 4.9). PR 본문에 적어요.

**값 규칙(설계 2.2)**
- 수익률·%·%p·통계는 `Math.round(x * 100) / 100`, 원 단위 금액·가격은 정수, 횟수·일수는 그대로. 반올림 결과가 `-0`이면 `0`.
- 조건 계산값은 `VALUE_KEYS`의 키별 규칙: `finQuarter`·`leaderRank`·`flowStreak`는 정수 그대로, `rebound`는 boolean, 나머지는 `Number(x.toPrecision(4))`.
- 유한수가 아닌 값은 null을 허용하는 자리면 null, 아니면 만들기 실패(`invalid`).
- 크기는 `jsonBytes(snapshot) <= SHARE_MAX_BYTES`(100 × 1024).
- 이름·제목 길이는 UTF-16 `.length` 30, 서로게이트 쌍을 반으로 자르지 않아요. `read` 모드 검사만 code point 30도 받아요.

**문구**
- 앱 화면 문구는 설계에 적힌 그대로 써요(따옴표 안 문구를 바꾸지 않아요). 설계에 없는 문구는 「내가 정한 기본값」 10번과 각 Task에 적은 것만 써요.

**검증 명령** (저장소 루트에서. 문서가 `corepack pnpm`을 쓰므로 그대로 따라요)
- `corepack pnpm check`: 오류 0
- `corepack pnpm check:e2e`: 오류 0
- `corepack pnpm test`: 기존·새 테스트 모두 통과. 파일 하나만 돌릴 때는 `corepack pnpm test src/lib/share/<파일>.test.ts`
- `corepack pnpm test:scripts`: 그대로 통과
- `corepack pnpm build`: 성공. Task 14에서 변경 전(`main`)·후 `dist/assets/*.js` 크기를 재서 PR 본문에 적어요
- `corepack pnpm --filter sync-worker check`: 오류 0
- `corepack pnpm --filter sync-worker test`: 통과
- `corepack pnpm e2e`: 기존·새 e2e 통과(빌드 포함이라 몇 분 걸려요)

**커밋**
- 메시지는 한국어 conventional 형식이고 끝에 빈 줄 뒤 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`을 붙여요. 각 Task의 커밋 명령은 `-m` 두 개로 이 형식을 만들어요.
- 푸시하지 않아요.

## 파일 지도

| 파일 | 책임 | Task |
|---|---|---|
| `src/lib/share/kinds.ts` (새) | 종류 목록·표시 이름·`kindLabel` | 1 |
| `src/lib/share/resultEnums.ts` (새) | 결과 열거값·`VALUE_KEYS`·`SHARE_SYMBOL_RE`(의존성 없음) | 1 |
| `src/lib/sync/forbidden.ts` | `jsonDiff` `ignoreMissing`, 깊이 상한, `exceedsDepth` | 1 |
| `src/lib/share/snapshot.ts` | 종류·타입 확장, `create`/`read` 모드, 전략·기준 부분 검사, compare 검사, `ShareBuild` | 2, 3 |
| `src/lib/sync/dto.ts` | `SETTING_OK` 내보내기 | 2 |
| `src/lib/share/compact.ts` (새) | `compareSnapshot`, 반올림·축·`thinIndices`, `simResultSnapshot`·`validationSnapshot`, `expandSimResult`·`expandValidation` | 2, 4, 5 |
| `src/lib/share/checkResult.ts` (새) | 결과 부분 검사·날짜 도구(Worker 공용) | 3 |
| `src/lib/share/testFixtures.ts` (새) | 테스트 고정 데이터 | 3, 4, 5 |
| `src/lib/ui/simulate/runController.svelte.ts`, `resultFixture.ts` | `DoneMeta.symbols` | 4 |
| `sync-worker/src/shares.test.ts` | 새 종류·크기·깊이 | 6 |
| `src/lib/share/shareText.ts` | 새 종류 요약 줄, `cardLines`, `compareViewText` | 6 |
| `src/lib/sync/controller.svelte.ts` | `describeFail(f, ctx)` | 6 |
| `ShareDialog.svelte`·`kakao.ts`·`SharedView.svelte`·`SyncManage.svelte` | `kindLabel`로 표시 | 6 |
| `src/lib/share/pendingImport.ts`·`importPlan.ts` (새) | 가져오기 대기 값·계획·적용 | 7 |
| `src/lib/state/app.svelte.ts` | `leaveShared()` | 7 |
| `src/lib/share/ImportHost.svelte`·`inApp.ts`·`testAxe.ts` (새), `src/App.svelte`, `package.json` | 확인 창·인앱 판정·axe | 8 |
| `ResultView`·`TradeList`·`SymbolTab`·`SkipList`·`EquityChart`·`ValidationResult`·`TodayPicks` | 읽기 전용·금액 숨김·건너뜀 개수·솎기 안내 | 9 |
| `src/routes/SharedView.svelte`, `src/lib/share/view/SharedSimResult.svelte`·`SharedValidation.svelte` (새) | 받은 화면 | 10 |
| `shareStore.svelte.ts`·`ShareDialog.svelte`·`GroupSheet`·`StrategyList`·`CriteriaList` | `ShareBuild`·거절·줄임 안내·결과 원문 | 11 |
| `src/lib/share/cardImage.ts` (새), `CompareChart`·`ChartPanel`·`EquityChart`·`lwcStub`, `Compare.svelte`·`Simulate.svelte`·`RunPanel`·`ResultView`·`ValidationResult` | 캡처·공유 진입점 | 12 |
| `kakao.ts`·`ShareDialog.svelte`·`kakao-csp.config.ts` | 업로드·지우기·카드 | 13 |
| `scripts/build-share-images.mjs`·`public/share/*.png`·`pwa.config.ts`·`package.json`·`tests/e2e/share.spec.ts`·`docs/live-check.md` | 고정 이미지·e2e·점검 문서 | 14 |

---

## Task 1: 종류 목록·결과 열거값·금지 키 도구

설계 2.1, 2.7(열거값·깊이 상한·`jsonDiff` 옵션). 다른 모든 Task가 기대는 의존성 없는 바탕이에요.

**Files:**
- Create: `src/lib/share/kinds.ts`, `src/lib/share/kinds.test.ts`
- Create: `src/lib/share/resultEnums.ts`, `src/lib/share/resultEnums.test.ts`
- Modify: `src/lib/sync/forbidden.ts` (`findForbidden`, `jsonDiff`, 새 `exceedsDepth`, `JSON_DEPTH_MAX`)
- Create: `src/lib/sync/forbidden.test.ts`

**Interfaces:**
- Consumes: 없음. 타입 비교용으로 `Trade`, `Skip`(`src/lib/sim/types.ts`), `SimFailureReason`(`src/lib/sim/loadSimData.ts`), `ValidationNote`·`MissingReason`·`ByMarketKey`(`src/lib/screen/runValidation.ts`), `NotBoughtReason`(`src/lib/screen/holdSelection.ts`), `Market`(`src/lib/screen/types.ts`)을 테스트에서만 `import type`해요.
- Produces:
  - `kinds.ts`: `SHARE_KINDS: readonly ['group','strategy','criteria','compare','simResult','validation']`, `type ShareKind`, `SHARE_KIND_LABEL: Record<ShareKind, string>`, `isShareKind(k: unknown): k is ShareKind`, `kindLabel(k: string): string`
  - `resultEnums.ts`: `TRADE_KINDS`, `SELL_KINDS`, `SKIP_REASONS`, `SIM_FAILURE_REASONS`, `MISSING_REASONS`, `NOT_BOUGHT_REASONS`, `BY_MARKET_KEYS`, `MARKETS`, `VALIDATION_NOTES`(모두 `as const` 배열), `type ValueRule = 'int' | 'sig4' | 'bool'`, `VALUE_KEYS: readonly (readonly [string, ValueRule])[]`, `VALUE_KEY_RULE: Readonly<Record<string, ValueRule>>`(null 프로토타입), `SHARE_SYMBOL_RE: RegExp`
  - `forbidden.ts`: `JSON_DEPTH_MAX = 32`, `exceedsDepth(v: unknown, max?: number): boolean`, `findForbidden(v: unknown, path?: string, depth?: number): string | null`, `jsonDiff(a: unknown, b: unknown, path?: string, opts?: { ignoreMissing?: boolean }, depth?: number): { path: string; kind: 'extra' | 'value' } | null`

- [ ] **Step 1: 실패하는 테스트를 써요**

`src/lib/share/kinds.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isShareKind, kindLabel, SHARE_KIND_LABEL, SHARE_KINDS } from './kinds';

describe('공유 종류', () => {
  it('여섯 종류와 표시 이름', () => {
    expect(SHARE_KINDS).toEqual(['group', 'strategy', 'criteria', 'compare', 'simResult', 'validation']);
    expect(SHARE_KINDS.map((k) => SHARE_KIND_LABEL[k])).toEqual(['그룹', '전략', '선정 기준', '비교 화면', '시뮬레이션 결과', '검증 결과']);
  });

  it('모르는 종류는 공유로 보인다', () => {
    expect(kindLabel('simResult')).toBe('시뮬레이션 결과');
    expect(kindLabel('future')).toBe('공유');
    expect(kindLabel('__proto__')).toBe('공유');
    expect(isShareKind('compare')).toBe(true);
    expect(isShareKind('toString')).toBe(false);
    expect(isShareKind(1)).toBe(false);
  });
});
```

`src/lib/share/resultEnums.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SimFailureReason } from '../sim/loadSimData';
import type { Skip, Trade } from '../sim/types';
import type { NotBoughtReason } from '../screen/holdSelection';
import type { ByMarketKey, MissingReason, ValidationNote } from '../screen/runValidation';
import type { Market } from '../screen/types';
import {
  BY_MARKET_KEYS,
  MARKETS,
  MISSING_REASONS,
  NOT_BOUGHT_REASONS,
  SELL_KINDS,
  SHARE_SYMBOL_RE,
  SIM_FAILURE_REASONS,
  SKIP_REASONS,
  TRADE_KINDS,
  VALIDATION_NOTES,
  VALUE_KEY_RULE,
  VALUE_KEYS,
} from './resultEnums';

// 두 타입이 정확히 같아야 true. 원래 타입에 값이 늘거나 줄면 `corepack pnpm check`가 실패한다.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const tradeKinds: Same<(typeof TRADE_KINDS)[number], Trade['kind']> = true;
const sellKinds: Same<(typeof SELL_KINDS)[number], Exclude<Trade['kind'], 'buy' | 'add'>> = true;
const skipReasons: Same<(typeof SKIP_REASONS)[number], Skip['reason']> = true;
const simFailure: Same<(typeof SIM_FAILURE_REASONS)[number], SimFailureReason> = true;
const missing: Same<(typeof MISSING_REASONS)[number], MissingReason> = true;
const notBought: Same<(typeof NOT_BOUGHT_REASONS)[number], NotBoughtReason> = true;
const byMarket: Same<(typeof BY_MARKET_KEYS)[number], ByMarketKey> = true;
const markets: Same<(typeof MARKETS)[number], Market> = true;
const notes: Same<(typeof VALIDATION_NOTES)[number], ValidationNote> = true;

describe('결과 열거값', () => {
  it('원래 타입과 같다(타입 검사) · 배열에 중복이 없다', () => {
    expect([tradeKinds, sellKinds, skipReasons, simFailure, missing, notBought, byMarket, markets, notes].every(Boolean)).toBe(true);
    for (const list of [TRADE_KINDS, SKIP_REASONS, SIM_FAILURE_REASONS, MISSING_REASONS, NOT_BOUGHT_REASONS, BY_MARKET_KEYS, VALIDATION_NOTES])
      expect(new Set(list).size).toBe(list.length);
    expect(BY_MARKET_KEYS).toEqual(['KOSPI', 'KOSDAQ', 'ETF']);
  });

  it('값 키 규칙: 정수 키·boolean 키·4자리 키', () => {
    expect(VALUE_KEY_RULE.finQuarter).toBe('int');
    expect(VALUE_KEY_RULE.leaderRank).toBe('int');
    expect(VALUE_KEY_RULE.flowStreak).toBe('int');
    expect(VALUE_KEY_RULE.rebound).toBe('bool');
    expect(VALUE_KEY_RULE.marketCap).toBe('sig4');
    expect(VALUE_KEY_RULE.return).toBe('sig4');
    expect(Object.hasOwn(VALUE_KEY_RULE, '__proto__')).toBe(false);
    expect(Object.hasOwn(VALUE_KEY_RULE, 'toString')).toBe(false);
    expect(new Set(VALUE_KEYS.map(([k]) => k)).size).toBe(VALUE_KEYS.length);
  });

  it('select.ts가 만드는 값 키는 모두 VALUE_KEYS에 있다', () => {
    const src = readFileSync(new URL('../screen/select.ts', import.meta.url), 'utf8');
    const direct = [...src.matchAll(/values\.(\w+)/g)].map((m) => m[1]);
    const ranged = [...src.matchAll(/'(fin[A-Z]\w*)'\)\) return/g)].map((m) => m[1]);
    const macro = ['usdkrw', 'wti'].flatMap((k) => [`${k}Trend`, `${k}Beta`]);
    const made = new Set([...direct, ...ranged, ...macro]);
    expect(made.size).toBeGreaterThan(20);
    for (const k of made) expect(Object.hasOwn(VALUE_KEY_RULE, k), k).toBe(true);
    // 동적 키(values[...])가 새로 생기면 위 목록 만들기를 고쳐야 한다: 지금은 Trend·Beta 템플릿 3곳과 범위 함수 1곳뿐이다
    expect(src.match(/values\[/g)?.length).toBe(4);
  });

  it('공유 종목 정규식: 6자리와 ETN(Q + 6자리)만', () => {
    for (const ok of ['005930', '0000J0', 'Q500023']) expect(SHARE_SYMBOL_RE.test(ok), ok).toBe(true);
    for (const bad of ['../x', '005930 ', 'q500023', 'Q50002', '12345', '0059301', '']) expect(SHARE_SYMBOL_RE.test(bad), bad).toBe(false);
  });
});
```

`src/lib/sync/forbidden.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { exceedsDepth, findForbidden, JSON_DEPTH_MAX, jsonDiff } from './forbidden';

/** 깊이 n의 중첩 객체: 가장 안쪽 객체가 깊이 n이다(루트 0). */
function nest(n: number): Record<string, unknown> {
  let v: Record<string, unknown> = {};
  for (let i = 0; i < n; i++) v = { a: v };
  return v;
}

describe('jsonDiff ignoreMissing', () => {
  it('기본은 b에만 있는 키를 value 차이로 본다(지금 동작 그대로)', () => {
    expect(jsonDiff({ a: 1 }, { a: 1, b: 2 })).toEqual({ path: 'b', kind: 'value' });
    expect(jsonDiff({ a: 1, c: 3 }, { a: 1 })).toEqual({ path: 'c', kind: 'extra' });
  });

  it('켜면 b에만 있는 키는 건너뛰고 나머지 비교를 이어 간다', () => {
    expect(jsonDiff({ a: 1 }, { a: 1, b: 2 }, '', { ignoreMissing: true })).toBeNull();
    expect(jsonDiff({ x: { a: 1 } }, { x: { a: 1, b: [1] } }, 's', { ignoreMissing: true })).toBeNull();
    expect(jsonDiff({ a: 1, c: 3 }, { a: 1, b: 2 }, '', { ignoreMissing: true })).toEqual({ path: 'c', kind: 'extra' });
    expect(jsonDiff({ x: { a: 2 } }, { x: { a: 1, b: 2 } }, '', { ignoreMissing: true })).toEqual({ path: 'x.a', kind: 'value' });
    expect(jsonDiff([1], [1, 2], '', { ignoreMissing: true })).toEqual({ path: '', kind: 'value' });
  });
});

describe('깊이 상한', () => {
  it(`깊이 ${JSON_DEPTH_MAX}까지는 괜찮고 넘으면 exceedsDepth`, () => {
    expect(JSON_DEPTH_MAX).toBe(32);
    expect(exceedsDepth(nest(32))).toBe(false);
    expect(exceedsDepth(nest(33))).toBe(true);
    expect(exceedsDepth([[[[1]]]], 3)).toBe(false);
    expect(exceedsDepth([[[[[1]]]]], 3)).toBe(true);
    expect(exceedsDepth('x')).toBe(false);
  });

  it('깊이 1,000이어도 예외 없이 끝난다', () => {
    const deep = nest(1000);
    expect(exceedsDepth(deep)).toBe(true);
    expect(() => findForbidden(deep)).not.toThrow();
    expect(findForbidden(deep)).toBeNull();
    expect(() => jsonDiff(deep, nest(1000))).not.toThrow();
    expect(jsonDiff(deep, nest(1000))?.kind).toBe('value');
  });

  it('얕은 곳의 금지 키는 그대로 찾는다', () => {
    expect(findForbidden({ a: [{ b: { token: 1 } }] })).toBe('a[0].b.token');
  });
});
```

- [ ] **Step 2: 실패하는지 확인해요**

Run: `corepack pnpm test src/lib/share/kinds.test.ts src/lib/share/resultEnums.test.ts src/lib/sync/forbidden.test.ts`
Expected: FAIL. `Failed to resolve import "./kinds"`, `"./resultEnums"`, 그리고 `exceedsDepth`·`JSON_DEPTH_MAX`가 없다는 오류.

- [ ] **Step 3: 구현해요**

`src/lib/share/kinds.ts`:

```ts
// 공유 종류와 표시 이름(설계 2.1). ShareDialog·kakao·SharedView·SyncManage·sync-worker가 함께 쓴다(DOM 의존 없음).
export const SHARE_KINDS = ['group', 'strategy', 'criteria', 'compare', 'simResult', 'validation'] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];

export const SHARE_KIND_LABEL: Record<ShareKind, string> = {
  group: '그룹',
  strategy: '전략',
  criteria: '선정 기준',
  compare: '비교 화면',
  simResult: '시뮬레이션 결과',
  validation: '검증 결과',
};

export const isShareKind = (k: unknown): k is ShareKind => typeof k === 'string' && (SHARE_KINDS as readonly string[]).includes(k);

/** 모르는 종류(새 버전 앱이 만든 공유)도 화면이 깨지지 않게 */
export const kindLabel = (k: string): string => (isShareKind(k) ? SHARE_KIND_LABEL[k] : '공유');
```

`src/lib/share/resultEnums.ts`:

```ts
// 결과 스냅샷 검사용 열거값(설계 2.7). 원래 타입이 있는 모듈(sim/types·screen/runValidation 등)을 끌어오지 않으려고
// 값만 따로 둔다. 원래 타입과 같은지는 resultEnums.test.ts가 타입으로 확인한다. 이 파일은 아무것도 import하지 않는다.

export const TRADE_KINDS = ['buy', 'add', 'take', 'stop', 'gapStop', 'gapTake'] as const;
export const SELL_KINDS = ['take', 'stop', 'gapStop', 'gapTake'] as const;
/** 고정 순서. 건너뜀 이유별 개수·목록의 이유 위치가 이 순서다 */
export const SKIP_REASONS = ['현금 부족', '1주가 1회 금액보다 비쌈', '거래 없음', '선정 기간이 아니에요'] as const;
export const SIM_FAILURE_REASONS = ['받지 못했어요', '종목 정보를 받지 못했어요', '기간 안에 데이터가 없어요'] as const;
export const MISSING_REASONS = ['받지 못했어요', '기간 일부만 받았어요'] as const;
export const NOT_BOUGHT_REASONS = ['noBar', 'tooExpensive', 'cash'] as const;
export const BY_MARKET_KEYS = ['KOSPI', 'KOSDAQ', 'ETF'] as const;
export const MARKETS = ['KOSPI', 'KOSDAQ'] as const;
export const VALIDATION_NOTES = [
  'survivorship',
  'snapshot',
  'dividend',
  'fewSegments',
  'warmup',
  'allEmpty',
  'sparseAxis',
  'themeSnapshot',
  'macroGap',
  'flowLag',
  'flowGap',
  'finLag',
  'finShares',
  'finGap',
] as const;

/** 조건 계산값 키의 반올림 규칙: 정수 그대로 · 유효숫자 4자리 · boolean */
export type ValueRule = 'int' | 'sig4' | 'bool';

/** select.ts가 만드는 값 키(설계 2.5). 목록 밖 이름(`__proto__` 포함)은 거절한다 */
export const VALUE_KEYS: readonly (readonly [string, ValueRule])[] = [
  ['marketCap', 'sig4'],
  ['tradingValue', 'sig4'],
  ['leaderRank', 'int'],
  ['return', 'sig4'],
  ['ma', 'sig4'],
  ['fromHigh', 'sig4'],
  ['volatility', 'sig4'],
  ['rebound', 'bool'],
  ['usdkrwTrend', 'sig4'],
  ['wtiTrend', 'sig4'],
  ['usdkrwBeta', 'sig4'],
  ['wtiBeta', 'sig4'],
  ['flowRatio', 'sig4'],
  ['flowRatioForeign', 'sig4'],
  ['flowRatioInst', 'sig4'],
  ['flowStreak', 'int'],
  ['rankFlow', 'sig4'],
  ['rankFlowForeign', 'sig4'],
  ['rankFlowInst', 'sig4'],
  ['finPer', 'sig4'],
  ['finPbr', 'sig4'],
  ['finRoe', 'sig4'],
  ['finOpMargin', 'sig4'],
  ['finRevGrowth', 'sig4'],
  ['finOpGrowth', 'sig4'],
  ['finDebtRatio', 'sig4'],
  ['finQuarter', 'int'],
  ['rankFin', 'sig4'],
];

/** 프로토타입이 없는 표라 `__proto__`·`toString` 같은 이름이 규칙으로 잡히지 않는다 */
export const VALUE_KEY_RULE: Readonly<Record<string, ValueRule>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, ValueRule>, Object.fromEntries(VALUE_KEYS)),
);

/**
 * 공유 경로의 종목 코드(설계 2.7). scripts/parse-master.mjs의 SYMBOL_PATTERN과 같다.
 * 주식·ETF·리츠는 6자리, ETN은 Q + 6자리(src/lib/data/universe.ts 주석).
 */
export const SHARE_SYMBOL_RE = /^(?:[0-9A-Z]{6}|Q[0-9A-Z]{6})$/;
```

`src/lib/sync/forbidden.ts`의 `findForbidden`·`jsonDiff`를 바꾸고, `exceedsDepth`를 더해요(파일 아래쪽 `jsonBytes`는 그대로):

```ts
/** 스냅샷·문서의 실제 깊이는 10 안팎이다. 이보다 깊으면 재귀하지 않고 거절한다(설계 2.7) */
export const JSON_DEPTH_MAX = 32;

/** 어느 객체·배열이 깊이 max를 넘는가(루트 0). 재귀 없이 돈다. */
export function exceedsDepth(v: unknown, max = JSON_DEPTH_MAX): boolean {
  const stack: [unknown, number][] = [[v, 0]];
  while (stack.length) {
    const [x, d] = stack.pop()!;
    if (typeof x !== 'object' || x === null) continue;
    if (d > max) return true;
    for (const child of Array.isArray(x) ? x : Object.values(x)) stack.push([child, d + 1]);
  }
  return false;
}

/** 금지 키가 처음 나온 경로(`a.b[2].c`). 없으면 null. 대소문자는 가리지 않는다. 깊이 상한을 넘는 곳은 보지 않는다(exceedsDepth가 먼저 거절한다). */
export function findForbidden(v: unknown, path = '', depth = 0): string | null {
  if (depth > JSON_DEPTH_MAX) return null;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const hit = findForbidden(v[i], `${path}[${i}]`, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  for (const [k, child] of Object.entries(v)) {
    const p = path ? `${path}.${k}` : k;
    if (FORBIDDEN.has(k.toLowerCase())) return p;
    const hit = findForbidden(child, p, depth + 1);
    if (hit) return hit;
  }
  return null;
}

/**
 * 두 JSON 값이 같은지(객체 키 순서는 무시). 다르면 처음 다른 경로와 종류를 돌려준다.
 * extra: 입력(a)에만 있는 키 — 알 수 없는 필드다.
 * ignoreMissing: 정리 결과(b)에만 있는 키(입력에서 빠진 필드)는 차이로 보지 않고 건너뛴다(공유 받는 쪽 검사, 설계 2.7).
 * 깊이 상한을 넘으면 그 자리에서 value 차이로 멈춘다.
 */
export function jsonDiff(
  a: unknown,
  b: unknown,
  path = '',
  opts: { ignoreMissing?: boolean } = {},
  depth = 0,
): { path: string; kind: 'extra' | 'value' } | null {
  if (depth > JSON_DEPTH_MAX) return { path, kind: 'value' };
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return { path, kind: 'value' };
    for (let i = 0; i < a.length; i++) {
      const d = jsonDiff(a[i], b[i], `${path}[${i}]`, opts, depth + 1);
      if (d) return d;
    }
    return null;
  }
  const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
  if (isObj(a) && isObj(b)) {
    for (const k of Object.keys(a)) {
      const p = path ? `${path}.${k}` : k;
      if (!Object.hasOwn(b, k)) return { path: p, kind: 'extra' };
      const d = jsonDiff(a[k], b[k], p, opts, depth + 1);
      if (d) return d;
    }
    if (!opts.ignoreMissing) for (const k of Object.keys(b)) if (!Object.hasOwn(a, k)) return { path: path ? `${path}.${k}` : k, kind: 'value' };
    return null;
  }
  return Object.is(a, b) ? null : { path, kind: 'value' };
}
```

- [ ] **Step 4: 통과하는지 확인해요**

Run: `corepack pnpm test src/lib/share/kinds.test.ts src/lib/share/resultEnums.test.ts src/lib/sync/forbidden.test.ts src/lib/sync/dto.test.ts src/lib/share/snapshot.test.ts`
Expected: PASS(기존 `dto.test.ts`·`snapshot.test.ts`도 그대로 통과)

Run: `corepack pnpm check`
Expected: 오류 0(`Same<…> = true` 대입이 모두 맞아야 해요)

- [ ] **Step 5: 커밋해요**

```bash
git add src/lib/share/kinds.ts src/lib/share/kinds.test.ts src/lib/share/resultEnums.ts src/lib/share/resultEnums.test.ts src/lib/sync/forbidden.ts src/lib/sync/forbidden.test.ts
git commit -m "feat(share): 공유 종류 목록과 결과 열거값, 금지 키 검사의 깊이 상한을 더함" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 2: 스냅샷 검사 재구성과 비교 화면 종류

설계 2.1, 2.3, 2.7(모드·부분 검사·종목 코드·제목 길이·`unsupported`), 3.1(`ShareBuild` 타입), 4.8의 UTF-16 길이 규칙.

**Files:**
- Modify: `src/lib/share/snapshot.ts`
- Modify: `src/lib/sync/dto.ts:40` (`const SETTING_OK` → `export const SETTING_OK`)
- Create: `src/lib/share/compact.ts` (이 Task에서는 `compareSnapshot`만)
- Test: `src/lib/share/snapshot.test.ts` (기존 파일에 `describe` 추가), Create `src/lib/share/compact.test.ts`

**Interfaces:**
- Consumes: Task 1의 `SHARE_KINDS`·`isShareKind`·`ShareKind`(`./kinds`), `SHARE_SYMBOL_RE`(`./resultEnums`), `exceedsDepth`·`jsonDiff(a, b, path, { ignoreMissing })`(`../sync/forbidden`)
- Produces (모두 `src/lib/share/snapshot.ts`):
  - `export type { ShareKind } from './kinds'`
  - `type CheckMode = 'create' | 'read'`
  - `type ShareError = 'invalid' | 'unknown-field' | 'forbidden-field' | 'too-large' | 'reference' | 'unsupported'`
  - `interface CompareSnapshot { kind: 'compare'; v: 1; title: string; symbols: string[]; view: { period: Settings['period']; metric: Settings['metric']; benchmark: Settings['benchmark']; boardOrder: Settings['boardOrder'] } }`
  - `type ShareSnapshot = GroupSnapshot | StrategySnapshot | CriteriaSnapshot | CompareSnapshot` (Task 3이 두 종류를 더해요)
  - `COMPARE_SYMBOLS_MAX = 10`, `BASKET_SYMBOL_RE`
  - `cutUtf16(s: string, max: number): string`
  - `shareTitle(name: string): string` (UTF-16 30)
  - `checkShareSnapshot(raw: unknown, kind: unknown, now?: number, mode?: CheckMode): ShareCheck`
  - `checkStrategyPart(s: unknown, title: string, now: number, mode: CheckMode): { ok: true; strategy: Strategy } | { ok: false; code: ShareError; path?: string }`
  - `checkCriteriaPart(raw: Record<string, unknown>, now: number, mode: CheckMode): { ok: true; criteria: SelectionCriteria; baskets: CriteriaSnapshot['baskets'] } | { ok: false; code: ShareError; path?: string }`
  - `type ShareReduction = 'skipped-counts' | 'no-values' | 'codes-only' | 'thinned'`
  - `type ShareBuild<S extends ShareSnapshot = ShareSnapshot> = { ok: true; snapshot: S; reduced: ShareReduction[] } | { ok: false; code: 'too-large'; bytes: number } | { ok: false; code: 'invalid'; path?: string }`
  - `built<S extends ShareSnapshot>(snapshot: S): ShareBuild<S>` (`{ ok: true, snapshot, reduced: [] }`)
- Produces (`src/lib/share/compact.ts`): `compareSnapshot(g: Group, s: Pick<Settings, 'period' | 'metric' | 'benchmark' | 'boardOrder'>): CompareSnapshot`
- Produces (`src/lib/sync/dto.ts`): `export const SETTING_OK: Record<(typeof SYNCED_SETTINGS)[number], (v: unknown) => boolean>`

- [ ] **Step 1: 실패하는 테스트를 써요**

`src/lib/share/snapshot.test.ts` 맨 위 import를 아래로 바꾸고, 파일 끝에 `describe` 두 개를 더해요.

```ts
import { describe, expect, it } from 'vitest';
import { newCriteria } from '../screen/defaults';
import { newStrategy } from '../sim/defaults';
import { sanitizeStrategies } from '../sim/validate';
import type { Watchlists } from '../state/schema';
import { MAX_ITEMS } from '../state/watchlist';
import {
  checkShareSnapshot,
  COMPARE_SYMBOLS_MAX,
  criteriaSnapshot,
  cutUtf16,
  groupSnapshot,
  SHARE_MAX_BYTES,
  shareTitle,
  strategySnapshot,
} from './snapshot';
import { compareSnapshot } from './compact';
```

```ts
describe('검사 모드·종목 코드·제목 길이', () => {
  const st = () => strategySnapshot(allIds().strategy, w, { hideCapital: false, now: NOW });

  it('ETN이 든 그룹·전략은 통과한다(지금 6자리 정규식 버그 수정)', () => {
    const g = { kind: 'group', v: 1, title: 'ETN', symbols: ['Q500023', '005930'] };
    expect(checkShareSnapshot(g, 'group', NOW).ok).toBe(true);
    const s = st();
    s.strategy.universe = { kind: 'symbols', symbols: ['Q500023'] };
    expect(checkShareSnapshot(s, 'strategy', NOW).ok).toBe(true);
  });

  it('전략·기준의 틀린 종목 코드와 중복을 거절한다', () => {
    for (const bad of ['../x', 'abcdef']) {
      const s = st();
      s.strategy.universe = { kind: 'symbols', symbols: [bad] };
      expect(checkShareSnapshot(s, 'strategy', NOW)).toMatchObject({ ok: false, code: 'invalid', path: 'strategy.universe.symbols' });
      const b = st();
      b.strategy.benchmarks.symbol = bad;
      expect(checkShareSnapshot(b, 'strategy', NOW)).toMatchObject({ ok: false, code: 'invalid', path: 'strategy.benchmarks.symbol' });
      const c = criteriaSnapshot(newCriteria(NOW, null, '기준'), { baskets: [], strategies: [] }, { hideCapital: false, now: NOW });
      c.criteria.benchmarks.symbols = [bad];
      expect(checkShareSnapshot(c, 'criteria', NOW)).toMatchObject({ ok: false, code: 'invalid', path: 'criteria.benchmarks.symbols' });
    }
    const d = st();
    d.strategy.universe = { kind: 'symbols', symbols: ['005930', '005930'] };
    expect(checkShareSnapshot(d, 'strategy', NOW)).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('정리 함수는 지금처럼 아무 문자열이나 받는다(저장·동기화 경로 회귀 방지)', () => {
    const s = newStrategy(NOW, null, '저장된 전략');
    s.universe = { kind: 'symbols', symbols: ['../x'] };
    s.benchmarks.symbol = 'abcdef';
    expect(sanitizeStrategies({ strategies: [s] }, NOW)).toEqual({ strategies: [s], repaired: false });
  });

  it('ETN이 든 묶음은 거절한다(앱 묶음은 6자리만)', () => {
    const { criteria } = allIds();
    const basket = { id: crypto.randomUUID(), name: 'ETN 묶음', updatedAt: NOW, symbols: ['Q500023'] };
    criteria.pool.baskets = [basket.id];
    const c = criteriaSnapshot(criteria, { baskets: [basket], strategies: [] }, { hideCapital: false, now: NOW });
    expect(checkShareSnapshot(c, 'criteria', NOW)).toMatchObject({ ok: false, code: 'invalid', path: 'baskets[0].symbols' });
  });

  it('read 모드는 빠진 필드를 기본값으로 채워 받고, create는 거절한다', () => {
    const s = st();
    const old = structuredClone(s) as unknown as { strategy: Record<string, unknown> };
    delete old.strategy.costs;
    expect(checkShareSnapshot(old, 'strategy', NOW, 'create')).toMatchObject({ ok: false, code: 'invalid', path: 'strategy.costs' });
    const r = checkShareSnapshot(old, 'strategy', NOW, 'read');
    expect(r.ok).toBe(true);
    if (r.ok && r.snapshot.kind === 'strategy') expect(r.snapshot.strategy.costs).toEqual(s.strategy.costs);
  });

  it('모르는 키는 두 모드 모두 unknown-field, 모르는 kind는 unsupported', () => {
    const s = st();
    const extra = { ...s, strategy: { ...s.strategy, surprise: 1 } };
    expect(checkShareSnapshot(extra, 'strategy', NOW, 'create')).toMatchObject({ code: 'unknown-field', path: 'strategy.surprise' });
    expect(checkShareSnapshot(extra, 'strategy', NOW, 'read')).toMatchObject({ code: 'unknown-field', path: 'strategy.surprise' });
    const future = { kind: 'future', v: 1, title: '새 종류' };
    expect(checkShareSnapshot(future, 'future', NOW)).toEqual({ ok: false, code: 'unsupported', path: 'kind' });
    expect(checkShareSnapshot({ ...future, v: 9 }, 'future', NOW, 'read')).toMatchObject({ code: 'unsupported' });
    expect(checkShareSnapshot({ ...future, kind: 3 }, 3, NOW)).toMatchObject({ code: 'invalid', path: 'kind' });
  });

  it('제목은 UTF-16 30에서 서로게이트를 자르지 않는다', () => {
    const emoji = '😀'.repeat(20); // UTF-16 40, code point 20
    const t = shareTitle(emoji);
    expect(t.length).toBe(30);
    expect(t).toBe('😀'.repeat(15));
    expect(cutUtf16('a' + '😀'.repeat(20), 30)).toBe('a' + '😀'.repeat(14));
    expect(cutUtf16('a' + '😀'.repeat(20), 30).length).toBe(29);
    const old = { kind: 'group', v: 1, title: '😀'.repeat(30), symbols: [] }; // 지금 만드는 쪽(code point 30)이 만든 옛 공유
    expect(checkShareSnapshot(old, 'group', NOW, 'create')).toMatchObject({ code: 'invalid', path: 'title' });
    expect(checkShareSnapshot(old, 'group', NOW, 'read').ok).toBe(true);
  });

  it('깊이 1,000의 중첩은 예외 없이 invalid', () => {
    let deep: Record<string, unknown> = {};
    for (let i = 0; i < 1000; i++) deep = { a: deep };
    expect(checkShareSnapshot({ kind: 'group', v: 1, title: 'x', symbols: [], deep }, 'group', NOW)).toEqual({ ok: false, code: 'invalid' });
  });

  it('100 KiB 경계: 정확히 한도면 크기는 통과하고 1바이트 넘으면 too-large', () => {
    const base = { kind: 'group', v: 1, title: 'x', symbols: [], pad: '' };
    const fixed = JSON.stringify(base).length;
    const at = { ...base, pad: 'a'.repeat(SHARE_MAX_BYTES - fixed) };
    expect(new TextEncoder().encode(JSON.stringify(at)).length).toBe(SHARE_MAX_BYTES);
    expect(checkShareSnapshot(at, 'group', NOW)).toMatchObject({ code: 'unknown-field', path: 'pad' });
    expect(checkShareSnapshot({ ...at, pad: at.pad + 'a' }, 'group', NOW)).toMatchObject({ code: 'too-large' });
  });
});

describe('비교 화면 스냅샷', () => {
  const settings = { period: { unit: 'M', n: 1 }, metric: 'change', benchmark: 'AUTO', boardOrder: 'value' } as const;
  const group = { id: crypto.randomUUID(), name: '반도체', items: w.groups[0].items.concat({ symbol: 'Q500023', colorSlot: 3, hidden: false, addedAt: 13 }) };

  it('보이는 종목만 그룹 순서대로, 보기 설정 4개만 넣는다', () => {
    const s = compareSnapshot(group, { ...settings, period: { ...settings.period } });
    expect(s).toEqual({ kind: 'compare', v: 1, title: '반도체', symbols: ['005930', 'Q500023'], view: { period: { unit: 'M', n: 1 }, metric: 'change', benchmark: 'AUTO', boardOrder: 'value' } });
    expect(JSON.stringify(s)).not.toContain(group.id);
    expect(checkShareSnapshot(s, 'compare', NOW)).toEqual({ ok: true, snapshot: s });
  });

  it('종목은 1~10개, 보기 값은 동기화 DTO 규칙으로 검사한다', () => {
    expect(COMPARE_SYMBOLS_MAX).toBe(MAX_ITEMS);
    const s = compareSnapshot(group, { ...settings, period: { ...settings.period } });
    expect(checkShareSnapshot({ ...s, symbols: [] }, 'compare', NOW)).toMatchObject({ code: 'invalid', path: 'symbols' });
    const eleven = Array.from({ length: 11 }, (_, i) => `00${String(i).padStart(4, '0')}`);
    expect(checkShareSnapshot({ ...s, symbols: eleven }, 'compare', NOW)).toMatchObject({ code: 'invalid', path: 'symbols' });
    expect(checkShareSnapshot({ ...s, view: { ...s.view, metric: 'magic' } }, 'compare', NOW)).toMatchObject({ code: 'invalid', path: 'view.metric' });
    expect(checkShareSnapshot({ ...s, view: { ...s.view, period: { unit: 'M', n: 7 } } }, 'compare', NOW)).toMatchObject({ code: 'invalid', path: 'view.period' });
    expect(checkShareSnapshot({ ...s, view: { ...s.view, extra: 1 } }, 'compare', NOW)).toMatchObject({ code: 'unknown-field', path: 'view.extra' });
    expect(checkShareSnapshot({ ...s, view: { ...s.view, theme: 'dark' } }, 'compare', NOW)).toMatchObject({ code: 'forbidden-field', path: 'view.theme' });
    expect(checkShareSnapshot({ ...s, colorConvention: 'kr' }, 'compare', NOW)).toMatchObject({ code: 'unknown-field' });
  });
});
```

`src/lib/share/compact.test.ts`(이 Task에서는 파일만 만들어 두고, 비교 화면 테스트는 위 `snapshot.test.ts`가 맡아요. Task 4가 이 파일을 채워요):

```ts
import { describe, expect, it } from 'vitest';
import { compareSnapshot } from './compact';

describe('compareSnapshot', () => {
  it('숨긴 종목만 있으면 빈 종목 목록이 된다(화면은 이때 공유 단추를 숨긴다)', () => {
    const g = { id: 'g', name: '빈 그룹', items: [{ symbol: '005930', colorSlot: 1 as const, hidden: true, addedAt: 1 }] };
    expect(compareSnapshot(g, { period: { unit: 'D', n: 1 }, metric: 'change', benchmark: 'KOSPI', boardOrder: 'mine' }).symbols).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패하는지 확인해요**

Run: `corepack pnpm test src/lib/share/snapshot.test.ts src/lib/share/compact.test.ts`
Expected: FAIL. `"./compact"`를 찾지 못하고, `COMPARE_SYMBOLS_MAX`·`cutUtf16`이 없다는 오류.

- [ ] **Step 3: 구현해요**

`src/lib/sync/dto.ts` 40행의 `const SETTING_OK`를 `export const SETTING_OK`로 바꿔요(본문은 그대로).

`src/lib/share/snapshot.ts`를 아래처럼 바꿔요. 만들기 함수 `groupSnapshot`·`strategySnapshot`·`criteriaSnapshot`과 상수는 그대로 두고, 표시한 곳만 바꿔요.

```ts
// 읽기 전용 공유 스냅샷(제안서 6절, 확장 설계 2절). exportData()를 재사용하지 않고 필요한 필드만 새로 만든다.
// 원본 객체 ID·프로필 이름·키·계좌·프록시·최근 종목은 넣지 않는다. 다른 객체 참조(그룹·전략·바구니)는 스냅샷 안에서 풀어 넣는다.
// sync-worker가 같은 검사 함수를 쓴다(DOM·저장소 의존 금지).
import { newCriteria } from '../screen/defaults';
import type { SelectionCriteria } from '../screen/types';
import { sanitizeCriteria } from '../screen/validate';
import type { Basket } from '../screen/baskets';
import { newStrategy } from '../sim/defaults';
import type { Strategy } from '../sim/types';
import { resolveSymbols, sanitizeStrategies } from '../sim/validate';
import type { Group, Settings, Watchlists } from '../state/schema';
import { SETTING_OK } from '../sync/dto';
import { exceedsDepth, findForbidden, jsonBytes, jsonDiff } from '../sync/forbidden';
import { isShareKind } from './kinds';
import { SHARE_SYMBOL_RE } from './resultEnums';

export type { ShareKind } from './kinds';

export const SHARE_VERSION = 1;
/** 제안서 7절: 공유 스냅샷 100 KiB. */
export const SHARE_MAX_BYTES = 100 * 1024;
export const SHARE_TITLE_MAX = 30;
export const SHARE_GROUP_MAX = 50;
/** 그룹 한 개의 종목 한도(MAX_ITEMS)와 같다. watchlist.ts를 Worker 번들에 끌어오지 않으려고 따로 둔다(테스트가 같은지 확인한다). */
export const COMPARE_SYMBOLS_MAX = 10;
export const SHARE_TTL_DEFAULT_DAYS = 7;
export const SHARE_TTL_MAX_DAYS = 30;
/** 공유 안에서 쓰는 고정 ID. 원본 ID를 옮기지 않는다. */
export const SHARED_ID = 'shared';
/** 앱 묶음 규칙(src/lib/screen/baskets.ts)과 같은 6자리. 묶음에는 ETN을 받지 않는다(설계 2.7). */
export const BASKET_SYMBOL_RE = /^[0-9A-Z]{6}$/;

/** create: 서버 저장·만든 쪽 보내기 전(엄격). read: 받은 화면·가져오기 대기 값(전략·기준의 빠진 필드를 기본값으로 채움). */
export type CheckMode = 'create' | 'read';

// GroupSnapshot·StrategySnapshot·CriteriaSnapshot 인터페이스는 지금 그대로 둔다.

export interface CompareSnapshot {
  kind: 'compare';
  v: 1;
  title: string;
  /** 보이는 종목만, 그룹 순서. 1~10개(MAX_ITEMS) */
  symbols: string[];
  view: {
    period: Settings['period'];
    metric: Settings['metric'];
    benchmark: Settings['benchmark'];
    boardOrder: Settings['boardOrder'];
  };
}

export type ShareSnapshot = GroupSnapshot | StrategySnapshot | CriteriaSnapshot | CompareSnapshot;

export type ShareError = 'invalid' | 'unknown-field' | 'forbidden-field' | 'too-large' | 'reference' | 'unsupported';
export type ShareCheck = { ok: true; snapshot: ShareSnapshot } | { ok: false; code: ShareError; path?: string };
type PartFail = { ok: false; code: ShareError; path?: string };

/** 결과 스냅샷을 줄인 단계(설계 3.4) */
export type ShareReduction = 'skipped-counts' | 'no-values' | 'codes-only' | 'thinned';
export type ShareBuild<S extends ShareSnapshot = ShareSnapshot> =
  | { ok: true; snapshot: S; reduced: ShareReduction[] }
  | { ok: false; code: 'too-large'; bytes: number }
  | { ok: false; code: 'invalid'; path?: string };
/** 줄일 일이 없는 종류(group·strategy·criteria·compare)의 만들기 결과 */
export const built = <S extends ShareSnapshot>(snapshot: S): ShareBuild<S> => ({ ok: true, snapshot, reduced: [] });

type Row = Record<string, unknown>;
const isRecord = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);
const isShareSymbol = (x: unknown): x is string => typeof x === 'string' && SHARE_SYMBOL_RE.test(x);
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const basketId = (i: number) => `b${i}`;

/** UTF-16 길이 max로 자른다. 끝이 서로게이트 쌍의 앞쪽이면 그것도 뺀다(쌍을 반으로 자르지 않는다). */
export function cutUtf16(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/** 저장 검사(raw.name.length > NAME_MAX)와 같은 UTF-16 기준(설계 4.8) */
export function shareTitle(name: string): string {
  return cutUtf16(name.trim(), SHARE_TITLE_MAX).trim() || '공유';
}
```

검사 부분(`// ── 검사` 아래)을 통째로 아래로 바꿔요.

```ts
// ── 검사(클라이언트·서버 공용) ──────────────────────────────

const fail = (code: ShareError, path?: string): PartFail => (path === undefined ? { ok: false, code } : { ok: false, code, path });

function exactKeys(v: Row, keys: string[], path: string): PartFail | null {
  for (const k of Object.keys(v)) if (!keys.includes(k)) return fail('unknown-field', path ? `${path}.${k}` : k);
  for (const k of keys) if (!Object.hasOwn(v, k)) return fail('invalid', path ? `${path}.${k}` : k);
  return null;
}

/** create는 UTF-16 30 이내. read는 code point 30 이내도 받는다(지금 만드는 쪽이 code point로 잰 옛 공유, 설계 2.7). */
const validTitle = (t: unknown, mode: CheckMode): t is string =>
  typeof t === 'string' && t !== '' && t === t.trim() && (t.length <= SHARE_TITLE_MAX || (mode === 'read' && [...t].length <= SHARE_TITLE_MAX));

function sameAs(input: unknown, cleaned: unknown, path: string, mode: CheckMode): PartFail | null {
  const d = jsonDiff(input, cleaned, path, { ignoreMissing: mode === 'read' });
  return d ? fail(d.kind === 'extra' ? 'unknown-field' : 'invalid', d.path) : null;
}

const symbolsOk = (s: unknown, min: number, max: number, re: (x: unknown) => boolean = isShareSymbol): s is string[] =>
  Array.isArray(s) && s.length >= min && s.length <= max && s.every(re) && new Set(s).size === s.length;

/** 전략 부분(strategy·simResult). 돌려주는 strategy는 정리 결과(read면 빠진 필드를 채운 값)다. */
export function checkStrategyPart(s: unknown, title: string, now: number, mode: CheckMode): { ok: true; strategy: Strategy } | PartFail {
  if (!isRecord(s) || s.id !== SHARED_ID || s.name !== title || s.updatedAt !== 0) return fail('invalid', 'strategy');
  if (!isRecord(s.universe) || s.universe.kind !== 'symbols') return fail('reference', 'strategy.universe');
  const cleaned = sanitizeStrategies({ strategies: [s] }, now).strategies[0];
  if (!cleaned) return fail('invalid', 'strategy');
  const diff = sameAs(s, cleaned, 'strategy', mode);
  if (diff) return diff;
  // 가져오면 받은 사람 키로 보내는 시세 요청에 들어가는 값이라 공유 경로에서만 코드 모양을 본다(정리 함수는 바꾸지 않는다)
  const u = cleaned.universe;
  if (u.kind !== 'symbols' || !symbolsOk(u.symbols, 0, Infinity)) return fail('invalid', 'strategy.universe.symbols');
  if (cleaned.benchmarks.symbol !== null && !isShareSymbol(cleaned.benchmarks.symbol)) return fail('invalid', 'strategy.benchmarks.symbol');
  return { ok: true, strategy: cleaned };
}

/** 기준 부분(criteria·validation): raw의 criteria·baskets·title을 본다. */
export function checkCriteriaPart(
  raw: Row,
  now: number,
  mode: CheckMode,
): { ok: true; criteria: SelectionCriteria; baskets: CriteriaSnapshot['baskets'] } | PartFail {
  if (!Array.isArray(raw.baskets) || raw.baskets.length > 30) return fail('invalid', 'baskets');
  const ids: string[] = [];
  for (const [i, b] of raw.baskets.entries()) {
    const path = `baskets[${i}]`;
    if (!isRecord(b)) return fail('invalid', path);
    const bk = exactKeys(b, ['id', 'name', 'symbols'], path);
    if (bk) return bk;
    if (b.id !== basketId(i) || !validTitle(b.name, mode)) return fail('invalid', path);
    if (!symbolsOk(b.symbols, 1, 300, (x) => typeof x === 'string' && BASKET_SYMBOL_RE.test(x))) return fail('invalid', `${path}.symbols`);
    ids.push(b.id);
  }
  const c = raw.criteria;
  if (!isRecord(c) || c.id !== SHARED_ID || c.name !== raw.title || c.updatedAt !== 0) return fail('invalid', 'criteria');
  const cleaned = sanitizeCriteria({ criteria: [c] }, now).criteria[0];
  if (!cleaned) return fail('invalid', 'criteria');
  const diff = sameAs(c, cleaned, 'criteria', mode);
  if (diff) return diff;
  if (cleaned.pool.baskets.some((id) => !ids.includes(id))) return fail('reference', 'criteria.pool.baskets');
  if (cleaned.conditions.rebound.pattern.from !== 'custom') return fail('reference', 'criteria.conditions.rebound.pattern');
  if (cleaned.trading.strategyId !== null) return fail('reference', 'criteria.trading.strategyId');
  if (!symbolsOk(cleaned.benchmarks.symbols, 0, Infinity)) return fail('invalid', 'criteria.benchmarks.symbols');
  return { ok: true, criteria: cleaned, baskets: raw.baskets as CriteriaSnapshot['baskets'] };
}

/**
 * 스냅샷을 검사한다. 깊이 → 금지 키 → 크기 → 원본 ID 모양(UUID) → kind·v·title → 종류별 필드 순서. 고칠 것이 있으면 거절한다.
 * kind는 요청의 kind와 같아야 한다. read 모드는 전략·기준의 빠진 필드만 기본값으로 채워 받고, 돌려주는 snapshot은 채운 값이다.
 */
export function checkShareSnapshot(raw: unknown, kind: unknown, now = Date.now(), mode: CheckMode = 'create'): ShareCheck {
  if (!isRecord(raw)) return fail('invalid');
  if (exceedsDepth(raw)) return fail('invalid');
  const forbidden = findForbidden(raw);
  if (forbidden) return fail('forbidden-field', forbidden);
  if (jsonBytes(raw) > SHARE_MAX_BYTES) return fail('too-large');
  if (UUID_RE.test(JSON.stringify(raw))) return fail('reference');
  if (raw.kind !== kind) return fail('invalid', 'kind');
  if (!isShareKind(raw.kind)) return typeof raw.kind === 'string' ? fail('unsupported', 'kind') : fail('invalid', 'kind');
  if (raw.v !== SHARE_VERSION) return fail('invalid', 'v');
  if (!validTitle(raw.title, mode)) return fail('invalid', 'title');

  switch (raw.kind) {
    case 'group': {
      const k = exactKeys(raw, ['kind', 'v', 'title', 'symbols'], '');
      if (k) return k;
      if (!symbolsOk(raw.symbols, 0, SHARE_GROUP_MAX)) return fail('invalid', 'symbols');
      return { ok: true, snapshot: raw as unknown as GroupSnapshot };
    }
    case 'strategy': {
      const k = exactKeys(raw, ['kind', 'v', 'title', 'strategy', 'capitalHidden'], '');
      if (k) return k;
      if (typeof raw.capitalHidden !== 'boolean') return fail('invalid', 'capitalHidden');
      const st = checkStrategyPart(raw.strategy, raw.title, now, mode);
      if (!st.ok) return st;
      return { ok: true, snapshot: { ...raw, strategy: st.strategy } as unknown as StrategySnapshot };
    }
    case 'criteria': {
      const k = exactKeys(raw, ['kind', 'v', 'title', 'criteria', 'baskets', 'capitalHidden'], '');
      if (k) return k;
      if (typeof raw.capitalHidden !== 'boolean') return fail('invalid', 'capitalHidden');
      const cr = checkCriteriaPart(raw, now, mode);
      if (!cr.ok) return cr;
      return { ok: true, snapshot: { ...raw, criteria: cr.criteria } as unknown as CriteriaSnapshot };
    }
    case 'compare': {
      const k = exactKeys(raw, ['kind', 'v', 'title', 'symbols', 'view'], '');
      if (k) return k;
      if (!symbolsOk(raw.symbols, 1, COMPARE_SYMBOLS_MAX)) return fail('invalid', 'symbols');
      if (!isRecord(raw.view)) return fail('invalid', 'view');
      const vk = exactKeys(raw.view, ['period', 'metric', 'benchmark', 'boardOrder'], 'view');
      if (vk) return vk;
      for (const key of ['period', 'metric', 'benchmark', 'boardOrder'] as const) if (!SETTING_OK[key](raw.view[key])) return fail('invalid', `view.${key}`);
      return { ok: true, snapshot: raw as unknown as CompareSnapshot };
    }
    default:
      // simResult·validation은 Task 3에서 더한다. 그 전에는 모르는 종류와 같게 거절한다.
      return fail('unsupported', 'kind');
  }
}
```

`src/lib/share/compact.ts`(새 파일, 이 Task 분량):

```ts
// 공유 스냅샷 만들기 중 열 형식·축약이 필요한 것(설계 2.3~2.5, 3절). 검사는 snapshot.ts·checkResult.ts가 한다.
import type { Group, Settings } from '../state/schema';
import { shareTitle, type CompareSnapshot } from './snapshot';

/** 시세 값은 넣지 않는다. 받은 사람이 자기 연결이나 데모로 다시 받는다. 지표는 사용자가 고른 값(app.settings.metric)이다. */
export function compareSnapshot(g: Group, s: Pick<Settings, 'period' | 'metric' | 'benchmark' | 'boardOrder'>): CompareSnapshot {
  return {
    kind: 'compare',
    v: 1,
    title: shareTitle(g.name),
    symbols: g.items.filter((i) => !i.hidden).map((i) => i.symbol),
    view: { period: { unit: s.period.unit, n: s.period.n }, metric: s.metric, benchmark: s.benchmark, boardOrder: s.boardOrder },
  };
}
```

- [ ] **Step 4: 통과하는지 확인해요**

Run: `corepack pnpm test src/lib/share src/lib/sync`
Expected: PASS(기존 `snapshot.test.ts`·`ShareDialog.test.ts`·`dto.test.ts`·`roundtrip.test.ts` 포함)

Run: `corepack pnpm check && corepack pnpm --filter sync-worker check && corepack pnpm --filter sync-worker test`
Expected: 오류 0, Worker 테스트 통과(Worker가 `checkShareSnapshot`을 기본 모드로 그대로 불러요)

- [ ] **Step 5: 커밋해요**

```bash
git add src/lib/share/snapshot.ts src/lib/share/snapshot.test.ts src/lib/share/compact.ts src/lib/share/compact.test.ts src/lib/sync/dto.ts
git commit -m "feat(share): 공유 검사에 받는 쪽 모드와 비교 화면 종류를 더하고 ETN 그룹 공유를 고침" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Task 3: 결과 스냅샷 타입과 결과 부분 검사

설계 2.2, 2.4, 2.5, 2.7(결과 부분 검사 전부), 6.1(대응 검사·금지 키·반올림·값 키).

**Files:**
- Modify: `src/lib/share/snapshot.ts` (타입 추가, `switch`에 `simResult`·`validation`)
- Create: `src/lib/share/checkResult.ts`
- Create: `src/lib/share/testFixtures.ts` (`simResultFixture`, `validationFixture`, `NOW`)
- Create: `src/lib/share/checkResult.test.ts`

**Interfaces:**
- Consumes: Task 1의 `resultEnums.ts` 상수·`VALUE_KEY_RULE`·`SHARE_SYMBOL_RE`, Task 2의 `checkStrategyPart`·`checkCriteriaPart`·`CheckMode`·`strategySnapshot`·`criteriaSnapshot`
- Produces (`src/lib/share/snapshot.ts`, 설계 그대로):

```ts
export interface ShareAxis { start: string; offsets: number[] }
export type ShareSampled = { from: number } | null;
export interface ShareRun { from: string; to: string; source: string; demo: boolean; fetchedAt: number }
export interface SimResultSnapshot { kind: 'simResult'; v: 1; title: string; strategy: Strategy; capitalHidden: boolean; run: ShareRun; result: SharedSimResult }
export interface SharedSimResult {
  axis: ShareAxis;
  sampled: ShareSampled;
  curves: { strategy: number[]; hold: number[]; index: (number | null)[] | null; benchmark: (number | null)[] | null };
  summary: SimResult['summary'];
  benchmarks: SimResult['benchmarks'];
  indexFailed: null | '받지 못했어요' | '기간 일부만 받았어요';
  benchmarkFailed: boolean;
  symbols: string[];
  trades: SharedTrade[];
  perSymbol: SharedPerSymbol[];
  skipped: { counts: [reason: Skip['reason'], n: number][]; rows: [day: number, symbol: number, reason: number][] | null };
  nearMiss: SimResult['nearMiss'];
  failed: { symbol: string; reason: SimFailureReason }[];
}
export type SharedTrade = [day: number, symbol: number, kind: Trade['kind'], stage: number | null, price: number, qty: number | null, reason: string, pnlPct: number | null];
export type SharedPerSymbol = [symbol: number, pnl: number | null, pnlPct: number, roundTrips: number, firstDay: number | null];
export interface ValidationSnapshot { kind: 'validation'; v: 1; title: string; criteria: SelectionCriteria; baskets: { id: string; name: string; symbols: string[] }[]; capitalHidden: boolean; run: ShareRun; result: SharedValidation }
export interface SharedStats { totalPct: number; cagrPct: number; mddPct: number; volPct: number }
export interface SharedValidation {
  axis: ShareAxis;
  sampled: ShareSampled;
  hold: { curve: number[]; stats: SharedStats; beat: { beat: number; total: number } | null };
  trading: { curve: number[]; stats: SharedStats; trades: number; skipCounts: [reason: Skip['reason'], n: number][] } | null;
  indices: { id: Market; curve: number[] | null; reason: MissingReason | null; stats: SharedStats | null }[];
  benchmarks: { symbol: string; name: string; curve: number[] | null; reason: MissingReason | null; stats: SharedStats | null }[];
  byMarket: { key: ByMarketKey; inPool: boolean; stats: SharedStats; avgPicked: number }[];
  history: 'full' | 'noValues' | 'codes';
  valueKeys: string[];
  rebalances: SharedRebalance[];
  today: { date: string; passed: number; picks: { symbol: string; values: ValuePairs }[] };
  notes: ValidationNote[];
}
export type ValuePairs = (number | boolean | null)[];
export interface SharedRebalance { day: number; passed: number; picks: SharedPick[] | string[] }
export type SharedPick = [symbol: string, retPct: number | null, mark: 0 | 1 | NotBoughtReason, values: ValuePairs | null];
export type ShareSnapshot = GroupSnapshot | StrategySnapshot | CriteriaSnapshot | CompareSnapshot | SimResultSnapshot | ValidationSnapshot;
```

- Produces (`src/lib/share/checkResult.ts`):
  - `AXIS_MAX = 3700`, `REASON_MAX = 40`, `SOURCE_MAX = 30`, `PICKS_MAX = 30`
  - `isIsoDate(s: unknown): s is string`, `axisDate(start: string, offset: number): string`, `dayOffset(start: string, date: string): number`
  - `type ResultFail = { code: 'invalid' | 'unknown-field' | 'reference'; path: string }`
  - `checkSimResult(v: unknown, ctx: { universe: readonly string[]; capitalHidden: boolean }, path?: string): ResultFail | null` (기본 path `'result'`)
  - `checkValidation(v: unknown, ctx: { indices: readonly string[]; benchSymbols: readonly string[] }, path?: string): ResultFail | null`
  - `checkRun(v: unknown, axis: ShareAxis, path?: string): ResultFail | null` (기본 path `'run'`)
- Produces (`src/lib/share/testFixtures.ts`): `NOW: number`, `simResultFixture(o?: { capitalHidden?: boolean }): SimResultSnapshot`, `validationFixture(o?: { capitalHidden?: boolean }): ValidationSnapshot`

- [ ] **Step 1: 고정 데이터와 실패하는 테스트를 써요**

`src/lib/share/testFixtures.ts`:

```ts
// 테스트 전용: 손으로 만든 작은 결과 스냅샷(검사를 통과하는 모양). 앱·Worker·컴포넌트 테스트가 함께 쓴다.
import { newBasket } from '../screen/baskets';
import { newCriteria } from '../screen/defaults';
import { newStrategy } from '../sim/defaults';
import { criteriaSnapshot, strategySnapshot, type SimResultSnapshot, type ValidationSnapshot } from './snapshot';

export const NOW = Date.UTC(2026, 9, 29, 3);

/** 3종목(하나는 ETN, 기간 안 데이터 없음) · 거래 4건 · 건너뜀 3건 · 지수 곡선 하나 · 지정 종목은 받지 못함 */
export function simResultFixture(o: { capitalHidden?: boolean } = {}): SimResultSnapshot {
  const hidden = o.capitalHidden ?? false;
  const base = newStrategy(NOW, null, '눌림목');
  base.universe = { kind: 'symbols', symbols: ['005930', '000660', 'Q500023'] };
  base.benchmarks = { index: 'KOSPI', symbol: '069500' };
  const { title, strategy } = strategySnapshot(base, { groups: [] }, { hideCapital: hidden, now: NOW });
  const q = (n: number) => (hidden ? null : n);
  return {
    kind: 'simResult',
    v: 1,
    title,
    strategy,
    capitalHidden: hidden,
    run: { from: '2024-01-02', to: '2024-01-12', source: 'KRX 일봉', demo: false, fetchedAt: NOW },
    result: {
      axis: { start: '2024-01-02', offsets: [0, 1, 2, 7, 10] },
      sampled: null,
      curves: { strategy: [0, 1.5, -2.25, 3, 4.1], hold: [0, 0.5, 1, 1.5, 2], index: [0, null, 0.3, 0.4, 0.5], benchmark: null },
      summary: {
        totalReturnPct: 4.1,
        cagrPct: 100.12,
        mddPct: -3.69,
        winRatePct: 50,
        wins: 1,
        losses: 1,
        avgWinPct: 15,
        avgLossPct: -5.6,
        roundTrips: 2,
        openPositions: 0,
        avgHoldDays: 12.5,
        avgCashPct: 62.31,
        skippedSignals: 3,
        vsHoldPp: 2.1,
        vsIndexPp: 3.6,
        vsBenchmarkPp: null,
      },
      benchmarks: { holdReturnPct: 2, indexReturnPct: 0.5, benchmarkReturnPct: null },
      indexFailed: null,
      benchmarkFailed: true,
      symbols: ['005930', '000660', 'Q500023'],
      trades: [
        [1, 0, 'buy', null, 70000, q(14), 'B 돌파', null],
        [2, 1, 'buy', null, 132400, q(12), '3일 연속 상승', null],
        [7, 1, 'stop', null, 125000, q(12), '손절', -5.6],
        [10, 0, 'take', 1, 80500, q(14), '1단계 익절 100%', 15],
      ],
      perSymbol: [
        [0, q(141000), 1.41, 1, 0],
        [1, q(-88000), -0.88, 1, 0],
      ],
      skipped: {
        counts: [
          ['현금 부족', 1],
          ['1주가 1회 금액보다 비쌈', 2],
        ],
        rows: [
          [2, 1, 1],
          [7, 1, 1],
          [8, 0, 0],
        ],
      },
      nearMiss: null,
      failed: [{ symbol: 'Q500023', reason: '기간 안에 데이터가 없어요' }],
    },
  };
}

/** 재선정 2번(두 번째는 통과 0개) · 묶음 하나 · 지수 KOSPI · 지정 ETF는 받지 못함 */
export function validationFixture(o: { capitalHidden?: boolean } = {}): ValidationSnapshot {
  const hidden = o.capitalHidden ?? false;
  const c = newCriteria(NOW, null, '대형 우량');
  const basket = newBasket(NOW, '반도체', ['005930', '000660']);
  c.pool.baskets = [basket.id];
  const { title, criteria, baskets } = criteriaSnapshot(c, { baskets: [basket], strategies: [] }, { hideCapital: hidden, now: NOW });
  const stats = (totalPct: number) => ({ totalPct, cagrPct: totalPct / 2, mddPct: -10, volPct: 20 });
  return {
    kind: 'validation',
    v: 1,
    title,
    criteria,
    baskets,
    capitalHidden: hidden,
    run: { from: '2026-01-05', to: '2026-02-03', source: '시장 데이터 파일', demo: false, fetchedAt: NOW },
    result: {
      axis: { start: '2026-01-05', offsets: [0, 1, 28, 29] },
      sampled: null,
      hold: { curve: [0, 1, 3, 12.34], stats: stats(12.34), beat: { beat: 1, total: 2 } },
      trading: null,
      indices: [{ id: 'KOSPI', curve: [0, 0.5, 1, 8.06], reason: null, stats: stats(8.06) }],
      benchmarks: [{ symbol: '069500', name: 'KODEX 200', curve: null, reason: '받지 못했어요', stats: null }],
      byMarket: [
        { key: 'KOSPI', inPool: true, stats: stats(10.04), avgPicked: 4.25 },
        { key: 'KOSDAQ', inPool: true, stats: stats(-2.5), avgPicked: 3 },
        { key: 'ETF', inPool: false, stats: stats(6), avgPicked: 2 },
      ],
      history: 'full',
      valueKeys: ['tradingValue', 'return', 'rebound', 'finQuarter'],
      rebalances: [
        {
          day: 0,
          passed: 25,
          picks: [
            ['005930', 5.5, 0, [0, 25000000000, 1, -12.34, 2, true, 3, 202406]],
            ['000660', null, 'noBar', [0, 31000000000, 2, true]],
          ],
        },
        { day: 28, passed: 0, picks: [] },
      ],
      today: { date: '2026-02-04', passed: 25, picks: [{ symbol: '005930', values: [0, 25000000000, 2, true] }] },
      notes: ['survivorship', 'snapshot'],
    },
  };
}
```

`src/lib/share/checkResult.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FORBIDDEN_KEYS } from '../sync/forbidden';
import { axisDate, dayOffset, isIsoDate } from './checkResult';
import { checkShareSnapshot } from './snapshot';
import { NOW, simResultFixture, validationFixture } from './testFixtures';

type Edit = (s: any) => void; // 고정 데이터 한 곳을 고친다
const sim = (edit: Edit, hidden = false) => {
  const s = simResultFixture({ capitalHidden: hidden });
  edit(s);
  return checkShareSnapshot(s, 'simResult', NOW);
};
const val = (edit: Edit) => {
  const s = validationFixture();
  edit(s);
  return checkShareSnapshot(s, 'validation', NOW);
};

/** 값 안의 모든 객체 키 */
function allKeys(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => allKeys(x, out));
  else if (typeof v === 'object' && v !== null) for (const [k, x] of Object.entries(v)) (out.add(k), allKeys(x, out));
  return out;
}

describe('날짜 도구', () => {
  it('ISO 날짜·일수 변환', () => {
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2023-02-29')).toBe(false);
    expect(isIsoDate('2024-1-02')).toBe(false);
    expect(axisDate('2024-01-30', 3)).toBe('2024-02-02');
    expect(dayOffset('2024-01-30', '2024-02-02')).toBe(3);
    expect(dayOffset('2023-12-31', '2026-12-31')).toBe(1096);
  });
});

describe('결과 스냅샷 검사', () => {
  it('고정 데이터는 통과한다(자금 숨김 포함)', () => {
    expect(checkShareSnapshot(simResultFixture(), 'simResult', NOW).ok).toBe(true);
    expect(checkShareSnapshot(simResultFixture({ capitalHidden: true }), 'simResult', NOW).ok).toBe(true);
    expect(checkShareSnapshot(validationFixture(), 'validation', NOW).ok).toBe(true);
  });

  it('새 타입의 키는 금지 키와 겹치지 않고, 결과 안 아무 곳의 token은 forbidden-field', () => {
    const keys = new Set([...allKeys(simResultFixture()), ...allKeys(validationFixture())]);
    const forbidden = new Set(FORBIDDEN_KEYS.map((k) => k.toLowerCase()));
    for (const k of keys) expect(forbidden.has(k.toLowerCase()), k).toBe(false);
    expect(sim((s) => (s.result.nearMiss = { token: 'x' }))).toMatchObject({ code: 'forbidden-field', path: 'result.nearMiss.token' });
  });

  it('거래 이유에 UUID가 있으면 reference', () => {
    expect(sim((s) => (s.result.trades[0][6] = crypto.randomUUID()))).toMatchObject({ code: 'reference' });
  });

  it('필드를 더하면 unknown-field, 빼면 invalid', () => {
    expect(sim((s) => (s.result.extra = 1))).toMatchObject({ code: 'unknown-field', path: 'result.extra' });
    expect(sim((s) => delete s.result.nearMiss)).toMatchObject({ code: 'invalid', path: 'result.nearMiss' });
    expect(sim((s) => (s.run.x = 1))).toMatchObject({ code: 'unknown-field', path: 'run.x' });
    expect(val((s) => (s.result.hold.extra = 1))).toMatchObject({ code: 'unknown-field', path: 'result.hold.extra' });
  });

  it.each<[string, Edit, string]>([
    ['축 첫 점이 0이 아님', (s) => (s.result.axis.offsets[0] = 1), 'result.axis'],
    ['축이 오름차순이 아님', (s) => (s.result.axis.offsets[2] = 1), 'result.axis'],
    ['축 시작 날짜가 틀림', (s) => (s.result.axis.start = '2024-13-01'), 'result.axis'],
    ['곡선 길이가 축과 다름', (s) => s.result.curves.strategy.pop(), 'result.curves.strategy'],
    ['곡선 소수 셋째 자리', (s) => (s.result.curves.strategy[1] = 1.234), 'result.curves.strategy'],
    ['주 곡선에 null', (s) => (s.result.curves.hold[1] = null), 'result.curves.hold'],
    ['요약 소수 셋째 자리', (s) => (s.result.summary.totalReturnPct = 4.123), 'result.summary.totalReturnPct'],
    ['요약 횟수가 정수가 아님', (s) => (s.result.summary.wins = 1.5), 'result.summary.wins'],
    ['솎기 from이 점 수 이하', (s) => (s.result.sampled = { from: 5 }), 'result.sampled'],
    ['run.from이 축 첫날과 다름', (s) => (s.run.from = '2024-01-03'), 'run.from'],
    ['run.to가 축 마지막 날과 다름', (s) => (s.run.to = '2024-01-11'), 'run.to'],
    ['출처가 비었음', (s) => (s.run.source = ''), 'run.source'],
    ['fetchedAt이 양의 정수가 아님', (s) => (s.run.fetchedAt = 0), 'run.fetchedAt'],
    ['symbols가 전략 종목과 다름', (s) => s.result.symbols.reverse(), 'result.symbols'],
    ['거래 날짜가 축 밖', (s) => (s.result.trades[3][0] = 11), 'result.trades[3]'],
    ['거래 날짜가 거꾸로', (s) => (s.result.trades[1][0] = 0), 'result.trades[1]'],
    ['모르는 거래 종류', (s) => (s.result.trades[0][2] = 'sell'), 'result.trades[0]'],
    ['매수에 단계', (s) => (s.result.trades[0][3] = 1), 'result.trades[0]'],
    ['익절에 단계 없음', (s) => (s.result.trades[3][3] = null), 'result.trades[3]'],
    ['손절에 단계', (s) => (s.result.trades[2][3] = 1), 'result.trades[2]'],
    ['단계가 4', (s) => (s.result.trades[3][3] = 4), 'result.trades[3]'],
    ['매도에 손익 없음', (s) => (s.result.trades[2][7] = null), 'result.trades[2]'],
    ['매수에 손익', (s) => (s.result.trades[0][7] = 1), 'result.trades[0]'],
    ['가격이 정수가 아님', (s) => (s.result.trades[0][4] = 70000.5), 'result.trades[0]'],
    ['수량이 0', (s) => (s.result.trades[0][5] = 0), 'result.trades[0]'],
    ['이유가 40자 넘음', (s) => (s.result.trades[0][6] = '가'.repeat(41)), 'result.trades[0]'],
    ['종목별 길이가 symbols − failed와 다름', (s) => s.result.perSymbol.pop(), 'result.perSymbol'],
    ['종목별 순서가 거꾸로', (s) => s.result.perSymbol.reverse(), 'result.perSymbol'],
    ['종목별 round trip이 음수', (s) => (s.result.perSymbol[0][3] = -1), 'result.perSymbol[0]'],
    ['failed가 종목별과 겹침', (s) => (s.result.failed = [{ symbol: '005930', reason: '받지 못했어요' }]), 'result.failed'],
    ['failed 이유가 모르는 값', (s) => (s.result.failed[0].reason = '없음'), 'result.failed[0]'],
    ['건너뜀 개수 합이 요약과 다름', (s) => (s.result.summary.skippedSignals = 4), 'result.skipped.counts'],
    ['건너뜀 이유 순서가 틀림', (s) => s.result.skipped.counts.reverse(), 'result.skipped.counts'],
    ['건너뜀 목록과 개수가 다름', (s) => (s.result.skipped.rows[2][2] = 1), 'result.skipped.rows'],
    ['지수 실패 값이 모르는 문구', (s) => (s.result.indexFailed = '없음'), 'result.indexFailed'],
  ])('시뮬레이션 대응 검사: %s → invalid', (_name, edit, path) => {
    expect(sim(edit)).toMatchObject({ ok: false, code: 'invalid', path });
  });

  it.each<[string, Edit, string]>([
    ['거래 종목 위치가 범위 밖', (s) => (s.result.trades[0][1] = 3), 'result.trades[0]'],
    ['종목별 종목 위치가 범위 밖', (s) => (s.result.perSymbol[1][0] = 9), 'result.perSymbol[1]'],
    ['건너뜀 종목 위치가 범위 밖', (s) => (s.result.skipped.rows[0][1] = 3), 'result.skipped.rows[0]'],
    ['failed 종목이 symbols 밖', (s) => (s.result.failed[0].symbol = '035720'), 'result.failed[0]'],
  ])('시뮬레이션 참조: %s → reference', (_name, edit, path) => {
    expect(sim(edit)).toMatchObject({ ok: false, code: 'reference', path });
  });

  it('자금 숨김이면 수량·종목별 손익은 null이어야 하고, 아니면 숫자여야 한다', () => {
    expect(sim((s) => (s.result.trades[0][5] = 14), true)).toMatchObject({ code: 'invalid', path: 'result.trades[0]' });
    expect(sim((s) => (s.result.perSymbol[0][1] = 1), true)).toMatchObject({ code: 'invalid', path: 'result.perSymbol[0]' });
    expect(sim((s) => (s.result.trades[0][5] = null))).toMatchObject({ code: 'invalid', path: 'result.trades[0]' });
    expect(sim((s) => (s.result.perSymbol[0][1] = null))).toMatchObject({ code: 'invalid', path: 'result.perSymbol[0]' });
  });

  it('결과 종목 코드: 소문자·경로 문자열·중복은 거절, ETN은 통과', () => {
    expect(sim((s) => ((s.result.symbols[0] = 'abc123'), (s.strategy.universe.symbols[0] = 'abc123')))).toMatchObject({ code: 'invalid' });
    expect(val((s) => (s.result.today.picks[0].symbol = '../x'))).toMatchObject({ code: 'invalid', path: 'result.today.picks[0]' });
    expect(val((s) => (s.result.rebalances[0].picks[1][0] = '005930'))).toMatchObject({ code: 'invalid', path: 'result.rebalances[0].picks' });
    expect(checkShareSnapshot(simResultFixture(), 'simResult', NOW).ok).toBe(true); // Q500023 포함
  });

  it.each<[string, Edit, string]>([
    ['지수 순서가 기준과 다름', (s) => (s.result.indices[0].id = 'KOSDAQ'), 'result.indices[0]'],
    ['지수 개수가 기준과 다름', (s) => s.result.indices.push({ ...s.result.indices[0] }), 'result.indices'],
    ['지정 ETF 순서가 기준과 다름', (s) => (s.result.benchmarks[0].symbol = '229200'), 'result.benchmarks[0]'],
    ['곡선 없음인데 이유 없음', (s) => (s.result.benchmarks[0].reason = null), 'result.benchmarks[0]'],
    ['곡선 있음인데 통계 없음', (s) => (s.result.indices[0].stats = null), 'result.indices[0]'],
    ['ETF 이름이 30자 넘음', (s) => (s.result.benchmarks[0].name = 'x'.repeat(31)), 'result.benchmarks[0]'],
    ['시장별 순서가 틀림', (s) => s.result.byMarket.reverse(), 'result.byMarket[0]'],
    ['시장별 평균이 음수', (s) => (s.result.byMarket[0].avgPicked = -1), 'result.byMarket[0]'],
    ['모르는 안내', (s) => s.result.notes.push('magic'), 'result.notes'],
    ['안내 중복', (s) => s.result.notes.push('survivorship'), 'result.notes'],
    ['재선정일이 축 밖 날짜', (s) => (s.result.rebalances[1].day = 27), 'result.rebalances[1]'],
    ['재선정일이 거꾸로', (s) => (s.result.rebalances[1].day = 0), 'result.rebalances[1]'],
    ['선정 수가 통과 수보다 많음', (s) => (s.result.rebalances[0].passed = 1), 'result.rebalances[0]'],
    ['이력 수준과 모양이 다름', (s) => (s.result.history = 'codes'), 'result.rebalances[0].picks'],
    ['계산값 뺌인데 값이 있음', (s) => (s.result.history = 'noValues'), 'result.rebalances[0].picks[0]'],
    ['ValuePairs 길이가 홀수', (s) => s.result.rebalances[0].picks[0][3].pop(), 'result.rebalances[0].picks[0]'],
    ['ValuePairs 키 위치가 범위 밖', (s) => (s.result.rebalances[0].picks[0][3][0] = 9), 'result.rebalances[0].picks[0]'],
    ['ValuePairs 키가 겹침', (s) => (s.result.rebalances[0].picks[0][3][2] = 0), 'result.rebalances[0].picks[0]'],
    ['정수 키에 소수', (s) => (s.result.rebalances[0].picks[0][3][7] = 202406.5), 'result.rebalances[0].picks[0]'],
    ['4자리 키에 5자리', (s) => (s.result.rebalances[0].picks[0][3][3] = -12.345), 'result.rebalances[0].picks[0]'],
    ['boolean 키에 숫자', (s) => (s.result.rebalances[0].picks[0][3][5] = 1), 'result.rebalances[0].picks[0]'],
    ['목록 밖 값 키', (s) => (s.result.valueKeys[0] = '__proto__'), 'result.valueKeys'],
    ['값 키 중복', (s) => (s.result.valueKeys[1] = 'tradingValue'), 'result.valueKeys'],
    ['오늘 날짜가 틀림', (s) => (s.result.today.date = '2026-02-30'), 'result.today.date'],
    ['오늘 선정이 통과 수보다 많음', (s) => (s.result.today.passed = 0), 'result.today'],
    ['② 횟수가 음수', (s) => (s.result.trading = { curve: [0, 0, 0, 0], stats: s.result.hold.stats, trades: -1, skipCounts: [] }), 'result.trading.trades'],
    ['표시 없음 mark가 2', (s) => (s.result.rebalances[0].picks[0][2] = 2), 'result.rebalances[0].picks[0]'],
  ])('검증 대응 검사: %s → invalid', (_name, edit, path) => {
    expect(val(edit)).toMatchObject({ ok: false, code: 'invalid', path });
  });

  it('값 반올림 규칙: 정수 키는 그대로, 4자리 키는 4자리면 통과', () => {
    expect(val((s) => (s.result.rebalances[0].picks[0][3] = [3, 202406, 1, -12.35]))).toMatchObject({ ok: true });
    expect(val((s) => ((s.result.valueKeys = ['leaderRank', 'flowStreak', 'marketCap']), (s.result.rebalances[0].picks[0][3] = [0, 3, 1, 12, 2, 1234000]), (s.result.rebalances[0].picks[1][3] = []), (s.result.today.picks[0].values = [])))).toMatchObject({ ok: true });
  });

  it('코드만 이력은 종목 코드 배열이고 오늘 선정은 계산값을 담는다', () => {
    expect(val((s) => ((s.result.history = 'codes'), (s.result.rebalances[0].picks = ['005930', '000660'])))).toMatchObject({ ok: true });
    expect(val((s) => ((s.result.history = 'noValues'), (s.result.rebalances[0].picks = [['005930', 5.5, 1, null]])))).toMatchObject({ ok: true });
  });

  it('검증 묶음에 ETN이 있으면 거절한다', () => {
    expect(val((s) => (s.baskets[0].symbols = ['Q500023']))).toMatchObject({ code: 'invalid', path: 'baskets[0].symbols' });
  });

  it('검증 결과의 기준은 read 모드에서 빠진 필드를 채워 받는다', () => {
    const s = validationFixture() as any;
    delete s.criteria.costs;
    expect(checkShareSnapshot(s, 'validation', NOW, 'create')).toMatchObject({ ok: false, path: 'criteria.costs' });
    expect(checkShareSnapshot(s, 'validation', NOW, 'read').ok).toBe(true);
  });
});
```

- [ ] **Step 2: 실패하는지 확인해요**

Run: `corepack pnpm test src/lib/share/checkResult.test.ts`
Expected: FAIL. `"./checkResult"`가 없고, `SimResultSnapshot` 타입이 없어 `testFixtures.ts`가 컴파일되지 않아요(vitest는 타입을 보지 않으므로 실제로는 `checkShareSnapshot`이 `unsupported`를 돌려 `ok: true` 기대가 실패해요).

- [ ] **Step 3: 구현해요**

`src/lib/share/snapshot.ts`: 위 **Produces**의 타입을 `CompareSnapshot` 아래에 그대로 더하고(필드 설명 주석은 설계 2.2~2.5에서 옮겨요), 이 import를 더해요.

```ts
import type { NotBoughtReason } from '../screen/holdSelection';
import type { ByMarketKey, MissingReason, ValidationNote } from '../screen/runValidation';
import type { Market } from '../screen/types';
import type { SimFailureReason } from '../sim/loadSimData';
import type { SimResult, Skip, Trade } from '../sim/types';
import { checkRun, checkSimResult, checkValidation, type ResultFail } from './checkResult';
```

(모두 `import type`이라 Worker 번들에 계산 코드가 들어가지 않아요. `checkResult`만 런타임 import예요.)

`switch`의 `default` 앞에 두 분기를 더하고, `default`는 `unsupported` 그대로 둬요.

```ts
    case 'simResult': {
      const k = exactKeys(raw, ['kind', 'v', 'title', 'strategy', 'capitalHidden', 'run', 'result'], '');
      if (k) return k;
      if (typeof raw.capitalHidden !== 'boolean') return fail('invalid', 'capitalHidden');
      const st = checkStrategyPart(raw.strategy, raw.title, now, mode);
      if (!st.ok) return st;
      const universe = st.strategy.universe.kind === 'symbols' ? st.strategy.universe.symbols : [];
      const r = checkSimResult(raw.result, { universe, capitalHidden: raw.capitalHidden });
      if (r) return failOf(r);
      const run = checkRun(raw.run, (raw.result as SharedSimResult).axis);
      if (run) return failOf(run);
      return { ok: true, snapshot: { ...raw, strategy: st.strategy } as unknown as SimResultSnapshot };
    }
    case 'validation': {
      const k = exactKeys(raw, ['kind', 'v', 'title', 'criteria', 'baskets', 'capitalHidden', 'run', 'result'], '');
      if (k) return k;
      if (typeof raw.capitalHidden !== 'boolean') return fail('invalid', 'capitalHidden');
      const cr = checkCriteriaPart(raw, now, mode);
      if (!cr.ok) return cr;
      const r = checkValidation(raw.result, { indices: cr.criteria.benchmarks.indices, benchSymbols: cr.criteria.benchmarks.symbols });
      if (r) return failOf(r);
      const run = checkRun(raw.run, (raw.result as SharedValidation).axis);
      if (run) return failOf(run);
      return { ok: true, snapshot: { ...raw, criteria: cr.criteria } as unknown as ValidationSnapshot };
    }
```

그리고 `fail` 아래에 `const failOf = (r: ResultFail): PartFail => fail(r.code, r.path);`를 둬요.

`src/lib/share/checkResult.ts`(새 파일):

```ts
// 결과 스냅샷(simResult·validation)의 결과 부분 검사(설계 2.7). sync-worker가 함께 쓴다: DOM·계산 코드 의존 금지.
// 원칙은 snapshot.ts와 같다. 모르는 필드는 unknown-field, 모양·값이 틀리면 invalid, 가리키는 곳이 없으면 reference. 고쳐 받지 않는다.
import {
  BY_MARKET_KEYS,
  MISSING_REASONS,
  NOT_BOUGHT_REASONS,
  SELL_KINDS,
  SHARE_SYMBOL_RE,
  SIM_FAILURE_REASONS,
  SKIP_REASONS,
  TRADE_KINDS,
  VALIDATION_NOTES,
  VALUE_KEY_RULE,
} from './resultEnums';
import type { ShareAxis } from './snapshot';

/** 10년 일봉 여유 */
export const AXIS_MAX = 3700;
export const REASON_MAX = 40;
export const SOURCE_MAX = 30;
export const NAME_MAX = 30;
/** 선정 기준 상위 N의 한도(TAKE_MAX) */
export const PICKS_MAX = 30;

export type ResultFail = { code: 'invalid' | 'unknown-field' | 'reference'; path: string };

type Row = Record<string, unknown>;
const isRecord = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);
const bad = (path: string): ResultFail => ({ code: 'invalid', path });
const ref = (path: string): ResultFail => ({ code: 'reference', path });
const at = (path: string, k: string | number) => (typeof k === 'number' ? `${path}[${k}]` : `${path}.${k}`);

function keys(v: unknown, want: readonly string[], path: string): ResultFail | null {
  if (!isRecord(v)) return bad(path);
  for (const k of Object.keys(v)) if (!want.includes(k)) return { code: 'unknown-field', path: at(path, k) };
  for (const k of want) if (!Object.hasOwn(v, k)) return bad(at(path, k));
  return null;
}

const isInt = (x: unknown, min = 0): x is number => Number.isInteger(x) && (x as number) >= min;
/** 소수 둘째 자리 이하의 유한수 */
const is2 = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && Math.round(x * 100) / 100 === x;
const is2n = (x: unknown): x is number | null => x === null || is2(x);
const isSym = (x: unknown): x is string => typeof x === 'string' && SHARE_SYMBOL_RE.test(x);
const isText = (x: unknown, max: number): x is string => typeof x === 'string' && x.length >= 1 && x.length <= max;
const oneOf = <T extends string>(list: readonly T[], x: unknown): x is T => typeof x === 'string' && (list as readonly string[]).includes(x);

// ── 날짜 ──────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const utc = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export function isIsoDate(s: unknown): s is string {
  return typeof s === 'string' && DATE_RE.test(s) && iso(utc(s)) === s;
}
/** start(KST YYYY-MM-DD)에서 offset 달력 일 뒤 */
export function axisDate(start: string, offset: number): string {
  return iso(utc(start) + offset * 86_400_000);
}
/** start에서 date까지 달력 일수 */
export function dayOffset(start: string, date: string): number {
  return Math.round((utc(date) - utc(start)) / 86_400_000);
}

// ── 공통 조각 ──────────────────────────────────────────

function checkAxis(v: unknown, path: string): ResultFail | null {
  const k = keys(v, ['start', 'offsets'], path);
  if (k) return k;
  const a = v as Row;
  const o = a.offsets;
  if (!isIsoDate(a.start) || !Array.isArray(o) || o.length < 1 || o.length > AXIS_MAX || o[0] !== 0) return bad(path);
  for (let i = 1; i < o.length; i++) if (!isInt(o[i]) || (o[i] as number) <= (o[i - 1] as number)) return bad(path);
  return null;
}

function checkCurve(v: unknown, n: number, path: string, nullable: boolean): ResultFail | null {
  if (!Array.isArray(v) || v.length !== n) return bad(path);
  return v.every((x) => is2(x) || (nullable && x === null)) ? null : bad(path);
}

function checkSampled(v: unknown, n: number, path: string): ResultFail | null {
  if (v === null) return null;
  const k = keys(v, ['from'], path);
  if (k) return k;
  return isInt((v as Row).from) && ((v as Row).from as number) > n ? null : bad(path);
}

function checkStats(v: unknown, path: string): ResultFail | null {
  const k = keys(v, ['totalPct', 'cagrPct', 'mddPct', 'volPct'], path);
  if (k) return k;
  for (const f of ['totalPct', 'cagrPct', 'mddPct', 'volPct']) if (!is2((v as Row)[f])) return bad(at(path, f));
  return null;
}

/** [이유, 개수] 목록: SKIP_REASONS 순서, 중복 없음. 개수 합을 돌려준다 */
function checkCounts(v: unknown, path: string): ResultFail | number {
  if (!Array.isArray(v)) return bad(path);
  let last = -1;
  let sum = 0;
  for (const c of v) {
    if (!Array.isArray(c) || c.length !== 2 || !isInt(c[1])) return bad(path);
    const i = SKIP_REASONS.indexOf(c[0]);
    if (i <= last) return bad(path);
    last = i;
    sum += c[1];
  }
  return sum;
}

/** 곡선·이유·통계 세 짝: 곡선이 없으면 이유가 있고 통계가 없다 */
function checkTrio(v: Row, n: number, path: string): ResultFail | null {
  if (v.curve === null) return oneOf(MISSING_REASONS, v.reason) && v.stats === null ? null : bad(path);
  if (v.reason !== null) return bad(path);
  return checkCurve(v.curve, n, at(path, 'curve'), false) ?? checkStats(v.stats, at(path, 'stats'));
}

function checkPairs(v: unknown, valueKeys: readonly string[], path: string): ResultFail | null {
  if (!Array.isArray(v) || v.length % 2 !== 0) return bad(path);
  const seen = new Set<number>();
  for (let i = 0; i < v.length; i += 2) {
    const k = v[i];
    const x = v[i + 1];
    if (!isInt(k) || k >= valueKeys.length || seen.has(k)) return bad(path);
    seen.add(k);
    const rule = VALUE_KEY_RULE[valueKeys[k]];
    if (rule === 'bool') {
      if (typeof x !== 'boolean') return bad(path);
    } else if (x !== null) {
      if (typeof x !== 'number' || !Number.isFinite(x)) return bad(path);
      if (rule === 'int' ? !Number.isInteger(x) : Number(x.toPrecision(4)) !== x) return bad(path);
    }
  }
  return null;
}

// ── 실행 머리 ──────────────────────────────────────────

/** run.from·to는 축의 첫날·마지막 날. 축은 결과 검사가 먼저 확인했다 */
export function checkRun(v: unknown, axis: ShareAxis, path = 'run'): ResultFail | null {
  const k = keys(v, ['from', 'to', 'source', 'demo', 'fetchedAt'], path);
  if (k) return k;
  const r = v as Row;
  if (r.from !== axis.start) return bad(at(path, 'from'));
  if (r.to !== axisDate(axis.start, axis.offsets[axis.offsets.length - 1])) return bad(at(path, 'to'));
  if (!isText(r.source, SOURCE_MAX)) return bad(at(path, 'source'));
  if (typeof r.demo !== 'boolean') return bad(at(path, 'demo'));
  if (!isInt(r.fetchedAt, 1)) return bad(at(path, 'fetchedAt'));
  return null;
}

// ── 시뮬레이션 결과 ─────────────────────────────────────

const SIM_KEYS = ['axis', 'sampled', 'curves', 'summary', 'benchmarks', 'indexFailed', 'benchmarkFailed', 'symbols', 'trades', 'perSymbol', 'skipped', 'nearMiss', 'failed'];
const SUMMARY_INT = ['wins', 'losses', 'roundTrips', 'openPositions', 'skippedSignals'];
const SUMMARY_2 = ['totalReturnPct', 'cagrPct', 'mddPct', 'avgCashPct', 'vsHoldPp'];
const SUMMARY_2N = ['winRatePct', 'avgWinPct', 'avgLossPct', 'avgHoldDays', 'vsIndexPp', 'vsBenchmarkPp'];

export function checkSimResult(v: unknown, ctx: { universe: readonly string[]; capitalHidden: boolean }, path = 'result'): ResultFail | null {
  const k0 = keys(v, SIM_KEYS, path);
  if (k0) return k0;
  const r = v as Row;
  const axisFail = checkAxis(r.axis, at(path, 'axis'));
  if (axisFail) return axisFail;
  const offsets = (r.axis as ShareAxis).offsets;
  const n = offsets.length;
  const lastDay = offsets[n - 1];
  const sampled = checkSampled(r.sampled, n, at(path, 'sampled'));
  if (sampled) return sampled;

  const cp = at(path, 'curves');
  const ck = keys(r.curves, ['strategy', 'hold', 'index', 'benchmark'], cp);
  if (ck) return ck;
  const curves = r.curves as Row;
  for (const name of ['strategy', 'hold'])
    if (checkCurve(curves[name], n, at(cp, name), false)) return bad(at(cp, name));
  for (const name of ['index', 'benchmark'])
    if (curves[name] !== null && checkCurve(curves[name], n, at(cp, name), true)) return bad(at(cp, name));

  const sp = at(path, 'summary');
  const sk = keys(r.summary, [...SUMMARY_INT, ...SUMMARY_2, ...SUMMARY_2N], sp);
  if (sk) return sk;
  const sum = r.summary as Row;
  for (const f of SUMMARY_INT) if (!isInt(sum[f])) return bad(at(sp, f));
  for (const f of SUMMARY_2) if (!is2(sum[f])) return bad(at(sp, f));
  for (const f of SUMMARY_2N) if (!is2n(sum[f])) return bad(at(sp, f));

  const bp = at(path, 'benchmarks');
  const bk = keys(r.benchmarks, ['holdReturnPct', 'indexReturnPct', 'benchmarkReturnPct'], bp);
  if (bk) return bk;
  const bm = r.benchmarks as Row;
  if (!is2(bm.holdReturnPct)) return bad(at(bp, 'holdReturnPct'));
  if (!is2n(bm.indexReturnPct)) return bad(at(bp, 'indexReturnPct'));
  if (!is2n(bm.benchmarkReturnPct)) return bad(at(bp, 'benchmarkReturnPct'));
  if (r.indexFailed !== null && !oneOf(MISSING_REASONS, r.indexFailed)) return bad(at(path, 'indexFailed'));
  if (typeof r.benchmarkFailed !== 'boolean') return bad(at(path, 'benchmarkFailed'));

  const symbols = r.symbols;
  if (!Array.isArray(symbols) || symbols.length < 1 || symbols.length > 8 || !symbols.every(isSym) || new Set(symbols).size !== symbols.length)
    return bad(at(path, 'symbols'));
  if (symbols.length !== ctx.universe.length || symbols.some((s, i) => s !== ctx.universe[i])) return bad(at(path, 'symbols'));
  const symAt = (i: unknown) => isInt(i) && i < symbols.length;

  // 거래: 날짜 오름차순(같은 날 허용), 종류별 단계·손익 규칙, 자금 숨김이면 수량 null
  const tp = at(path, 'trades');
  if (!Array.isArray(r.trades)) return bad(tp);
  let prevDay = 0;
  for (const [i, t] of r.trades.entries()) {
    const p = at(tp, i);
    if (!Array.isArray(t) || t.length !== 8) return bad(p);
    const [day, sym, kind, stage, price, qty, reason, pnlPct] = t;
    if (!isInt(day) || day > lastDay || day < prevDay) return bad(p);
    prevDay = day;
    if (!isInt(sym)) return bad(p);
    if (!symAt(sym)) return ref(p);
    if (!oneOf(TRADE_KINDS, kind)) return bad(p);
    const sell = oneOf(SELL_KINDS, kind);
    const staged = kind === 'take' || kind === 'gapTake';
    if (staged ? !(isInt(stage, 1) && stage <= 3) : stage !== null) return bad(p);
    if (!isInt(price, 1)) return bad(p);
    if (ctx.capitalHidden ? qty !== null : !isInt(qty, 1)) return bad(p);
    if (!isText(reason, REASON_MAX)) return bad(p);
    if (sell ? !is2(pnlPct) : pnlPct !== null) return bad(p);
  }

  // 종목별: symbols 순서, 중복 없음 / failed: symbols 안, 종목별과 겹치지 않음, 둘을 합치면 symbols
  const pp = at(path, 'perSymbol');
  if (!Array.isArray(r.perSymbol)) return bad(pp);
  const inPer = new Set<number>();
  let prevSym = -1;
  for (const [i, row] of r.perSymbol.entries()) {
    const p = at(pp, i);
    if (!Array.isArray(row) || row.length !== 5) return bad(p);
    const [sym, pnl, pnlPct, roundTrips, firstDay] = row;
    if (!isInt(sym)) return bad(p);
    if (!symAt(sym)) return ref(p);
    if (ctx.capitalHidden ? pnl !== null : !Number.isInteger(pnl)) return bad(p);
    if (!is2(pnlPct) || !isInt(roundTrips)) return bad(p);
    if (firstDay !== null && !(isInt(firstDay) && firstDay <= lastDay)) return bad(p);
    if (sym <= prevSym) return bad(pp);
    prevSym = sym;
    inPer.add(sym);
  }
  const fp = at(path, 'failed');
  if (!Array.isArray(r.failed)) return bad(fp);
  const failedSyms = new Set<string>();
  for (const [i, f] of r.failed.entries()) {
    const p = at(fp, i);
    const fk = keys(f, ['symbol', 'reason'], p);
    if (fk) return fk;
    const row = f as Row;
    if (!isSym(row.symbol) || !oneOf(SIM_FAILURE_REASONS, row.reason)) return bad(p);
    const idx = symbols.indexOf(row.symbol);
    if (idx < 0) return ref(p);
    if (inPer.has(idx) || failedSyms.has(row.symbol)) return bad(fp);
    failedSyms.add(row.symbol);
  }
  if (r.perSymbol.length + r.failed.length !== symbols.length) return bad(pp);

  // 건너뜀: 이유별 개수(합 = summary.skippedSignals), 목록이 있으면 개수와 맞는다
  const kp = at(path, 'skipped');
  const kk = keys(r.skipped, ['counts', 'rows'], kp);
  if (kk) return kk;
  const skipped = r.skipped as Row;
  const total = checkCounts(skipped.counts, at(kp, 'counts'));
  if (typeof total !== 'number') return total;
  if (total !== sum.skippedSignals) return bad(at(kp, 'counts'));
  if (skipped.rows !== null) {
    const rp = at(kp, 'rows');
    if (!Array.isArray(skipped.rows)) return bad(rp);
    const byReason = new Array<number>(SKIP_REASONS.length).fill(0);
    for (const [i, row] of skipped.rows.entries()) {
      const p = at(rp, i);
      if (!Array.isArray(row) || row.length !== 3) return bad(p);
      const [day, sym, reason] = row;
      if (!isInt(day) || day > lastDay || !isInt(reason) || reason >= SKIP_REASONS.length) return bad(p);
      if (!isInt(sym)) return bad(p);
      if (!symAt(sym)) return ref(p);
      byReason[reason]++;
    }
    const counted = new Map((skipped.counts as [string, number][]).map(([reason, c]) => [reason, c]));
    if (SKIP_REASONS.some((reason, i) => (counted.get(reason) ?? 0) !== byReason[i])) return bad(rp);
  }

  if (r.nearMiss !== null) {
    const np = at(path, 'nearMiss');
    const nk = keys(r.nearMiss, ['maxDropPct', 'declineDays'], np);
    if (nk) return nk;
    const nm = r.nearMiss as Row;
    if (!is2(nm.maxDropPct) || !isInt(nm.declineDays)) return bad(np);
  }
  return null;
}

// ── 검증 결과 ─────────────────────────────────────────

const VAL_KEYS = ['axis', 'sampled', 'hold', 'trading', 'indices', 'benchmarks', 'byMarket', 'history', 'valueKeys', 'rebalances', 'today', 'notes'];

export function checkValidation(v: unknown, ctx: { indices: readonly string[]; benchSymbols: readonly string[] }, path = 'result'): ResultFail | null {
  const k0 = keys(v, VAL_KEYS, path);
  if (k0) return k0;
  const r = v as Row;
  const axisFail = checkAxis(r.axis, at(path, 'axis'));
  if (axisFail) return axisFail;
  const offsets = (r.axis as ShareAxis).offsets;
  const n = offsets.length;
  const sampled = checkSampled(r.sampled, n, at(path, 'sampled'));
  if (sampled) return sampled;

  const hp = at(path, 'hold');
  const hk = keys(r.hold, ['curve', 'stats', 'beat'], hp);
  if (hk) return hk;
  const hold = r.hold as Row;
  const hc = checkCurve(hold.curve, n, at(hp, 'curve'), false) ?? checkStats(hold.stats, at(hp, 'stats'));
  if (hc) return hc;
  if (hold.beat !== null) {
    const bk = keys(hold.beat, ['beat', 'total'], at(hp, 'beat'));
    if (bk) return bk;
    const b = hold.beat as Row;
    if (!isInt(b.beat) || !isInt(b.total) || b.beat > b.total) return bad(at(hp, 'beat'));
  }

  if (r.trading !== null) {
    const tp = at(path, 'trading');
    const tk = keys(r.trading, ['curve', 'stats', 'trades', 'skipCounts'], tp);
    if (tk) return tk;
    const t = r.trading as Row;
    const tc = checkCurve(t.curve, n, at(tp, 'curve'), false) ?? checkStats(t.stats, at(tp, 'stats'));
    if (tc) return tc;
    if (!isInt(t.trades)) return bad(at(tp, 'trades'));
    const c = checkCounts(t.skipCounts, at(tp, 'skipCounts'));
    if (typeof c !== 'number') return c;
  }

  const ip = at(path, 'indices');
  if (!Array.isArray(r.indices) || r.indices.length !== ctx.indices.length) return bad(ip);
  for (const [i, x] of r.indices.entries()) {
    const p = at(ip, i);
    const xk = keys(x, ['id', 'curve', 'reason', 'stats'], p);
    if (xk) return xk;
    const row = x as Row;
    if (row.id !== ctx.indices[i]) return bad(p);
    const trio = checkTrio(row, n, p);
    if (trio) return bad(p);
  }

  const bp = at(path, 'benchmarks');
  if (!Array.isArray(r.benchmarks) || r.benchmarks.length !== ctx.benchSymbols.length) return bad(bp);
  for (const [i, x] of r.benchmarks.entries()) {
    const p = at(bp, i);
    const xk = keys(x, ['symbol', 'name', 'curve', 'reason', 'stats'], p);
    if (xk) return xk;
    const row = x as Row;
    if (row.symbol !== ctx.benchSymbols[i] || !isText(row.name, NAME_MAX)) return bad(p);
    if (checkTrio(row, n, p)) return bad(p);
  }

  const mp = at(path, 'byMarket');
  if (!Array.isArray(r.byMarket) || r.byMarket.length !== BY_MARKET_KEYS.length) return bad(mp);
  for (const [i, x] of r.byMarket.entries()) {
    const p = at(mp, i);
    const xk = keys(x, ['key', 'inPool', 'stats', 'avgPicked'], p);
    if (xk) return xk;
    const row = x as Row;
    if (row.key !== BY_MARKET_KEYS[i] || typeof row.inPool !== 'boolean' || !is2(row.avgPicked) || row.avgPicked < 0) return bad(p);
    const st = checkStats(row.stats, at(p, 'stats'));
    if (st) return st;
  }

  if (!oneOf(['full', 'noValues', 'codes'] as const, r.history)) return bad(at(path, 'history'));
  const history = r.history;
  const vp = at(path, 'valueKeys');
  const vk = r.valueKeys;
  if (!Array.isArray(vk) || !vk.every((x) => typeof x === 'string' && Object.hasOwn(VALUE_KEY_RULE, x)) || new Set(vk).size !== vk.length) return bad(vp);
  const valueKeys = vk as string[];

  const daySet = new Set(offsets);
  const rp = at(path, 'rebalances');
  if (!Array.isArray(r.rebalances)) return bad(rp);
  let prev = -1;
  for (const [i, x] of r.rebalances.entries()) {
    const p = at(rp, i);
    const xk = keys(x, ['day', 'passed', 'picks'], p);
    if (xk) return xk;
    const row = x as Row;
    if (!isInt(row.day) || !daySet.has(row.day) || row.day <= prev) return bad(p);
    prev = row.day;
    if (!isInt(row.passed) || !Array.isArray(row.picks) || row.picks.length > Math.min(row.passed, PICKS_MAX)) return bad(p);
    const pk = at(p, 'picks');
    const seen = new Set<string>();
    for (const [j, pick] of row.picks.entries()) {
      const pj = at(pk, j);
      let symbol: unknown;
      if (history === 'codes') {
        if (Array.isArray(pick)) return bad(pk);
        symbol = pick;
      } else {
        if (!Array.isArray(pick)) return bad(pk);
        if (pick.length !== 4) return bad(pj);
        const [sym, retPct, mark, values] = pick;
        symbol = sym;
        if (!is2n(retPct) || !(mark === 0 || mark === 1 || oneOf(NOT_BOUGHT_REASONS, mark))) return bad(pj);
        if (history === 'full' ? checkPairs(values, valueKeys, pj) : values !== null) return bad(pj);
      }
      if (!isSym(symbol)) return bad(history === 'codes' ? pk : pj);
      if (seen.has(symbol)) return bad(pk);
      seen.add(symbol);
    }
  }

  const tdp = at(path, 'today');
  const tdk = keys(r.today, ['date', 'passed', 'picks'], tdp);
  if (tdk) return tdk;
  const today = r.today as Row;
  if (!isIsoDate(today.date)) return bad(at(tdp, 'date'));
  if (!isInt(today.passed) || !Array.isArray(today.picks) || today.picks.length > Math.min(today.passed, PICKS_MAX)) return bad(tdp);
  const seenToday = new Set<string>();
  for (const [j, pick] of today.picks.entries()) {
    const pj = at(at(tdp, 'picks'), j);
    const pk = keys(pick, ['symbol', 'values'], pj);
    if (pk) return pk;
    const row = pick as Row;
    if (!isSym(row.symbol) || seenToday.has(row.symbol)) return bad(pj);
    seenToday.add(row.symbol);
    if (checkPairs(row.values, valueKeys, pj)) return bad(pj);
  }

  const np = at(path, 'notes');
  if (!Array.isArray(r.notes) || !r.notes.every((x) => oneOf(VALIDATION_NOTES, x)) || new Set(r.notes).size !== r.notes.length) return bad(np);
  return null;
}
```

- [ ] **Step 4: 통과하는지 확인해요**

Run: `corepack pnpm test src/lib/share`
Expected: PASS(Task 2 테스트 포함)

Run: `corepack pnpm check && corepack pnpm --filter sync-worker check && corepack pnpm --filter sync-worker test`
Expected: 오류 0, 통과

- [ ] **Step 5: 커밋해요**

```bash
git add src/lib/share/snapshot.ts src/lib/share/checkResult.ts src/lib/share/checkResult.test.ts src/lib/share/testFixtures.ts
git commit -m "feat(share): 시뮬레이션·검증 결과 스냅샷 타입과 결과 부분 검사를 더함" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Task 4: 축약·솎기와 시뮬레이션 결과 만들기·펼치기

설계 1.5-2·4·5, 2.2, 2.4, 2.6, 3.1~3.5(시뮬레이션 열), 4.7의 `expandSimResult`, 6.1(솎기·줄이는 순서·자금 숨김·왕복·펼치기).

**Files:**
- Modify: `src/lib/ui/simulate/runController.svelte.ts` (`DoneMeta.symbols`, `start()`의 meta)
- Modify: `src/lib/ui/simulate/resultFixture.ts` (`meta.symbols`)
- Modify: `src/lib/ui/simulate/runController.test.ts` (테스트 하나 추가)
- Modify: `src/lib/share/compact.ts` (반올림·축·솎기·`simResultSnapshot`·`expandSimResult`·`perSymbolPct`)
- Modify: `src/lib/share/testFixtures.ts` (`tradingDays`, `bigDone`)
- Test: `src/lib/share/compact.test.ts`

**Interfaces:**
- Consumes: Task 3의 `SimResultSnapshot`·`SharedTrade`·`SharedPerSymbol`·`ShareAxis`·`ShareBuild`·`ShareReduction`·`checkShareSnapshot(…, 'create')`, `axisDate`·`dayOffset`(`./checkResult`), `SKIP_REASONS`·`SELL_KINDS`(`./resultEnums`), `strategySnapshot`·`SHARE_MAX_BYTES`(`./snapshot`), `jsonBytes`(`../sync/forbidden`)
- Produces:
  - `DoneMeta.symbols: string[]` — 실행한 종목(요청 순서, `resolveSymbols` 결과). `perSymbol`의 종목 ∪ `failed`의 종목 = `symbols`
  - `compact.ts`:

```ts
export const THIN_STEPS: readonly [500, 250, 120];
export const AXIS_PRETHIN = 3000;
export class BuildError extends Error { readonly path: string }
export function r2(x: number, path: string): number;            // 유한수가 아니면 BuildError
export function r2n(x: number | null | undefined): number | null;  // 유한수가 아니면 null
export function sig4(x: number): number;
export function toAxis(dates: readonly string[]): ShareAxis;
export function fromAxis(a: ShareAxis): string[];
export function thinIndices(n: number, m: number, keep: readonly number[]): number[];
export function extremes(values: readonly (number | null)[]): number[];   // [최고 위치, 최저 위치], null만 있으면 []
export function drawdownPoints(values: readonly number[]): number[];      // [직전 고점 위치, 바닥 위치]
export function finishBuild<S extends ShareSnapshot>(s: S, reduced: ShareReduction[], now: number): ShareBuild<S>;
export function simResultSnapshot(done: DoneState, opts: { hideCapital: boolean; now?: number }): ShareBuild<SimResultSnapshot>;
export function expandSimResult(s: SimResultSnapshot, names?: SymbolNames): DoneState;
export function perSymbolPct(s: SimResultSnapshot): Record<string, number>;
```

  - `testFixtures.ts`: `tradingDays(from: string, n: number): string[]`(주말 뺀 날짜), `bigDone(o: { days: number; trades: number; skips: number }): DoneState`(8종목, 지수·지정 종목 곡선)

- [ ] **Step 1: 실패하는 테스트를 써요**

`src/lib/ui/simulate/runController.test.ts`의 `describe('runController', …)` 안에 더해요.

```ts
  it('실행한 종목을 요청 순서대로 meta.symbols에 둔다(그룹이 나중에 바뀌어도 그대로)', async () => {
    const app = fakeApp(provider());
    const ctl = ctlFor(app);
    ctl.run(strat());
    await settled(ctl);
    const st = ctl.state;
    if (st.kind !== 'done') throw new Error(st.kind);
    expect(st.meta.symbols).toEqual(SYMBOLS);
    app.watchlists.groups[0].items.reverse();
    expect(st.meta.symbols).toEqual(SYMBOLS);
  });
```

`src/lib/share/testFixtures.ts` 끝에 더해요(import 줄에 `import type { DoneState } from '../ui/simulate/runController.svelte';`, `import type { Trade } from '../sim/types';`, `import { SKIP_REASONS } from './resultEnums';`를 더해요).

```ts
/** from부터 주말을 뺀 n일(KST 날짜 문자열) */
export function tradingDays(from: string, n: number): string[] {
  const out: string[] = [];
  let t = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  while (out.length < n) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
    t += 86_400_000;
  }
  return out;
}

export const BIG_SYMBOLS = ['005930', '000660', '035420', '035720', '051910', '006400', '005380', '000270'];

/** 크기 예산(설계 3.5)용 결과: 8종목, 지수·지정 종목 곡선, 소수 자리가 긴 값(반올림 확인용) */
export function bigDone(o: { days: number; trades: number; skips: number }): DoneState {
  const strategy = newStrategy(NOW, null, '큰 전략');
  strategy.universe = { kind: 'symbols', symbols: [...BIG_SYMBOLS] };
  strategy.benchmarks = { index: 'KOSPI', symbol: '069500' };
  const initial = strategy.capital.initial;
  const dates = tradingDays('2016-01-04', o.days);
  const wave = (i: number, a: number, f: number) => Math.round(initial * (1 + a * Math.sin(i / f) + i / (o.days * 5)));
  const spread = (i: number, count: number) => dates[Math.floor((i * (o.days - 1)) / Math.max(1, count))];
  const trades: Trade[] = Array.from({ length: o.trades }, (_, i) => {
    const date = spread(i, o.trades);
    const symbol = BIG_SYMBOLS[i % BIG_SYMBOLS.length];
    return i % 2 === 0
      ? { date, symbol, kind: 'buy', price: 50_000 + i, qty: 10 + (i % 7), fee: 75, tax: 0, reason: 'B 돌파' }
      : { date, symbol, kind: 'take', stage: 1, price: 52_000 + i, qty: 10, fee: 78, tax: 120, reason: '1단계 익절 100%', pnlPct: 3.21 + (i % 13) / 7 };
  });
  return {
    kind: 'done',
    result: {
      equity: dates.map((date, i) => ({
        date,
        strategy: wave(i, 0.2, 37),
        hold: wave(i, 0.15, 53),
        index: wave(i, 0.1, 71),
        benchmark: i % 50 === 7 ? null : wave(i, 0.12, 29),
        cash: initial / 2,
      })),
      summary: {
        totalReturnPct: 12.34567,
        cagrPct: 9.87654,
        mddPct: -23.456789,
        winRatePct: 55.5555,
        wins: 10,
        losses: 8,
        avgWinPct: 8.123,
        avgLossPct: -4.567,
        roundTrips: Math.floor(o.trades / 2),
        openPositions: 1,
        avgHoldDays: 19.256,
        avgCashPct: 62.1234,
        skippedSignals: o.skips,
        vsHoldPp: 16.111,
        vsIndexPp: 21.4,
        vsBenchmarkPp: 17.4444,
      },
      benchmarks: { holdReturnPct: 16.3333, indexReturnPct: 11.1111, benchmarkReturnPct: -2.5 },
      trades,
      skipped: Array.from({ length: o.skips }, (_, i) => ({ date: spread(i, o.skips), symbol: BIG_SYMBOLS[i % 8], reason: SKIP_REASONS[i % 4] })),
      perSymbol: BIG_SYMBOLS.map((symbol, i) => ({ symbol, name: symbol, pnl: (i - 3) * 123_457.6, roundTrips: 3, firstDate: dates[0] })),
      nearMiss: null,
    },
    meta: {
      venueLabel: 'KRX 일봉',
      fetchedAt: NOW,
      from: dates[0],
      to: dates[dates.length - 1],
      demo: false,
      failed: [],
      indexFailed: null,
      benchmarkFailed: false,
      candles: {},
      names: {},
      strategy,
      symbols: [...BIG_SYMBOLS],
    },
  };
}
```

`src/lib/share/compact.test.ts`를 아래로 바꿔요(Task 2의 `compareSnapshot` 테스트는 맨 아래에 그대로 둬요).

```ts
import { describe, expect, it } from 'vitest';
import { jsonBytes } from '../sync/forbidden';
import { resultHeadline, skipCounts } from '../ui/simulate/simText';
import { doneState } from '../ui/simulate/resultFixture';
import { compareSnapshot, drawdownPoints, expandSimResult, extremes, perSymbolPct, simResultSnapshot, thinIndices } from './compact';
import { checkShareSnapshot, SHARE_MAX_BYTES } from './snapshot';
import { bigDone, NOW } from './testFixtures';

// 만들기와 같은 식(부동소수 차이가 없게 * 100을 두 번)
const pctOf = (v: number, initial: number) => Math.round((v / initial - 1) * 100 * 100) / 100;

describe('thinIndices', () => {
  it('n ≤ m이면 그대로', () => {
    expect(thinIndices(5, 5, [])).toEqual([0, 1, 2, 3, 4]);
    expect(thinIndices(3, 120, [7])).toEqual([0, 1, 2]);
  });

  it('같은 입력이면 같은 결과, 첫·끝·keep을 남기고 m + keep 이하', () => {
    const a = thinIndices(1000, 120, [3, 517, 999, -1, 1000, 2.5]);
    expect(thinIndices(1000, 120, [3, 517, 999, -1, 1000, 2.5])).toEqual(a);
    expect(a[0]).toBe(0);
    expect(a.at(-1)).toBe(999);
    expect(a).toContain(3);
    expect(a).toContain(517);
    expect(a.length).toBeLessThanOrEqual(120 + 3);
    expect([...a].sort((x, y) => x - y)).toEqual(a);
    expect(new Set(a).size).toBe(a.length);
  });

  it('최고·최저(null 건너뜀, 같으면 처음)와 최대 낙폭 점', () => {
    expect(extremes([1, 5, null, 5, -2, -2])).toEqual([1, 4]);
    expect(extremes([null, null])).toEqual([]);
    expect(drawdownPoints([0, 10, 4, 12, 11, 2, 8])).toEqual([3, 5]);
    expect(drawdownPoints([1, 2, 3])).toEqual([0, 0]);
  });
});

describe('simResultSnapshot', () => {
  it('3년 일봉 · 8종목 · 거래 300 · 건너뜀 300은 줄이지 않고 들어간다(설계 3.5)', () => {
    const b = simResultSnapshot(bigDone({ days: 735, trades: 300, skips: 300 }), { hideCapital: false, now: NOW });
    if (!b.ok) throw new Error(JSON.stringify(b));
    expect(b.reduced).toEqual([]);
    expect(b.snapshot.result.sampled).toBeNull();
    expect(b.snapshot.result.axis.offsets).toHaveLength(735);
    expect(b.snapshot.result.trades).toHaveLength(300);
    expect(jsonBytes(b.snapshot)).toBeLessThanOrEqual(SHARE_MAX_BYTES);
  });

  it('반올림: 곡선·요약은 둘째 자리, 금액은 정수, 횟수는 그대로', () => {
    const done = bigDone({ days: 30, trades: 6, skips: 2 });
    const b = simResultSnapshot(done, { hideCapital: false, now: NOW });
    if (!b.ok) throw new Error(JSON.stringify(b));
    const r = b.snapshot.result;
    expect(r.summary.cagrPct).toBe(9.88);
    expect(r.summary.mddPct).toBe(-23.46);
    expect(r.summary.avgHoldDays).toBe(19.26);
    expect(r.summary.wins).toBe(10);
    expect(r.benchmarks.holdReturnPct).toBe(16.33);
    expect(r.perSymbol[0]).toEqual([0, -370373, -3.7, 3, 0]);
    expect(r.trades[1][7]).toBe(Math.round((3.21 + 1 / 7) * 100) / 100);
    expect(r.curves.strategy[0]).toBe(0);
    expect(r.curves.benchmark?.[7]).toBeNull();
    expect(r.skipped.counts).toEqual([
      ['현금 부족', 1],
      ['1주가 1회 금액보다 비쌈', 1],
    ]);
  });

  it('건너뜀 목록이 너무 크면 이유별 개수만 남긴다', () => {
    const b = simResultSnapshot(bigDone({ days: 735, trades: 300, skips: 9000 }), { hideCapital: false, now: NOW });
    if (!b.ok) throw new Error(JSON.stringify(b));
    expect(b.reduced).toEqual(['skipped-counts']);
    expect(b.snapshot.result.skipped.rows).toBeNull();
    expect(b.snapshot.result.skipped.counts.reduce((s, [, n]) => s + n, 0)).toBe(9000);
  });

  it('곡선이 크면 원래 축에서 솎고, 최고·최저·첫·끝 값은 남는다', () => {
    const done = bigDone({ days: 3000, trades: 600, skips: 0 });
    const b = simResultSnapshot(done, { hideCapital: false, now: NOW });
    if (!b.ok) throw new Error(JSON.stringify(b));
    expect(b.reduced).toEqual(['thinned']);
    const r = b.snapshot.result;
    expect(r.sampled).toEqual({ from: 3000 });
    expect(r.axis.offsets.length).toBeLessThanOrEqual(500 + 10);
    const initial = done.meta.strategy.capital.initial;
    const full = done.result.equity.map((e) => pctOf(e.strategy, initial));
    expect(Math.max(...r.curves.strategy)).toBe(Math.max(...full));
    expect(Math.min(...r.curves.strategy)).toBe(Math.min(...full));
    expect(r.curves.strategy[0]).toBe(full[0]);
    expect(r.curves.strategy.at(-1)).toBe(full.at(-1));
    expect(r.trades).toHaveLength(600);
  });

  it('축이 3,700점을 넘으면 크기와 상관없이 먼저 솎는다', () => {
    const b = simResultSnapshot(bigDone({ days: 4000, trades: 10, skips: 0 }), { hideCapital: false, now: NOW });
    if (!b.ok) throw new Error(JSON.stringify(b));
    expect(b.reduced).toContain('thinned');
    expect(b.snapshot.result.sampled).toEqual({ from: 4000 });
    expect(b.snapshot.result.axis.offsets.length).toBeLessThanOrEqual(3000 + 10);
  });

  it('거래 3,000건은 줄여도 넘으므로 거절한다(거래는 빼지 않는다)', () => {
    const b = simResultSnapshot(bigDone({ days: 735, trades: 3000, skips: 10 }), { hideCapital: false, now: NOW });
    expect(b).toMatchObject({ ok: false, code: 'too-large' });
    if (!b.ok && b.code === 'too-large') expect(b.bytes).toBeGreaterThan(SHARE_MAX_BYTES);
  });

  it('자금 숨김: 수량·종목별 원 손익은 null, JSON에 원래 초기 자금이 없다', () => {
    const done = bigDone({ days: 30, trades: 6, skips: 0 });
    done.meta.strategy.capital.initial = 777_000_000;
    const b = simResultSnapshot(done, { hideCapital: true, now: NOW });
    if (!b.ok) throw new Error(JSON.stringify(b));
    expect(b.snapshot.capitalHidden).toBe(true);
    expect(b.snapshot.result.trades.every((t) => t[5] === null)).toBe(true);
    expect(b.snapshot.result.perSymbol.every((p) => p[1] === null)).toBe(true);
    expect(JSON.stringify(b.snapshot)).not.toContain('777000000');
    expect(JSON.stringify(b.snapshot)).not.toContain('"fee"');
  });

  it('만든 쪽 왕복: JSON 왕복 뒤 create 검사를 통과한다', () => {
    const b = simResultSnapshot(doneState(), { hideCapital: false, now: NOW });
    if (!b.ok) throw new Error(JSON.stringify(b));
    expect(checkShareSnapshot(JSON.parse(JSON.stringify(b.snapshot)), 'simResult', NOW, 'create').ok).toBe(true);
    expect(b.snapshot.result.symbols).toEqual(['005930', '000660', '035720']);
    expect(b.snapshot.strategy.universe).toEqual({ kind: 'symbols', symbols: ['005930', '000660', '035720'] });
    expect(b.snapshot.run).toMatchObject({ from: '2023-10-11', to: '2026-10-08', source: 'KRX 일봉', demo: true });
  });

  it('NaN: null을 허용하지 않는 자리면 invalid, 허용하는 자리면 null', () => {
    const a = doneState((s) => (s.result.summary.totalReturnPct = Number.NaN));
    expect(simResultSnapshot(a, { hideCapital: false, now: NOW })).toMatchObject({ ok: false, code: 'invalid', path: 'result.summary.totalReturnPct' });
    const c = doneState((s) => (s.result.equity[1].strategy = Number.NaN));
    expect(simResultSnapshot(c, { hideCapital: false, now: NOW })).toMatchObject({ ok: false, code: 'invalid', path: 'result.curves.strategy[1]' });
    const d = doneState((s) => (s.result.equity[1].index = Number.NaN));
    const ok = simResultSnapshot(d, { hideCapital: false, now: NOW });
    if (!ok.ok) throw new Error(JSON.stringify(ok));
    expect(ok.snapshot.result.curves.index?.[1]).toBeNull();
  });

  it('펼치면 결과 화면 계산이 원래 값과 반올림 오차 안에서 같다', () => {
    const done = bigDone({ days: 60, trades: 10, skips: 6 });
    const b = simResultSnapshot(done, { hideCapital: false, now: NOW });
    if (!b.ok) throw new Error(JSON.stringify(b));
    const back = expandSimResult(b.snapshot, new Map([['005930', '삼성전자']]));
    const initial = done.meta.strategy.capital.initial;
    expect(back.result.equity.map((e) => e.date)).toEqual(done.result.equity.map((e) => e.date));
    back.result.equity.forEach((e, i) => expect(Math.abs(e.strategy - done.result.equity[i].strategy)).toBeLessThan(initial * 0.0001));
    expect(skipCounts(back.result.skipped)).toEqual(skipCounts(done.result.skipped));
    expect(back.result.trades.map((t) => [t.date, t.symbol, t.kind, t.stage, t.qty])).toEqual(done.result.trades.map((t) => [t.date, t.symbol, t.kind, t.stage, t.qty]));
    expect(back.result.summary.totalReturnPct).toBeCloseTo(done.result.summary.totalReturnPct, 2);
    expect(back.meta.names).toMatchObject({ '005930': '삼성전자', '000660': '000660', '069500': '069500' });
    expect(back.meta.candles).toEqual({});
    expect(back.meta.symbols).toEqual(done.meta.symbols);
    expect(resultHeadline(back.meta.from, back.meta.to, back.meta.venueLabel, back.meta.fetchedAt, back.meta.strategy.period.from)).toBe(
      resultHeadline(done.meta.from, done.meta.to, done.meta.venueLabel, done.meta.fetchedAt, done.meta.strategy.period.from),
    );
    expect(perSymbolPct(b.snapshot)['005930']).toBe(Math.round(((-3 * 123_457.6) / initial) * 100 * 100) / 100);
  });
});

describe('compareSnapshot', () => {
  it('숨긴 종목만 있으면 빈 종목 목록이 된다(화면은 이때 공유 단추를 숨긴다)', () => {
    const g = { id: 'g', name: '빈 그룹', items: [{ symbol: '005930', colorSlot: 1 as const, hidden: true, addedAt: 1 }] };
    expect(compareSnapshot(g, { period: { unit: 'D', n: 1 }, metric: 'change', benchmark: 'KOSPI', boardOrder: 'mine' }).symbols).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패하는지 확인해요**

Run: `corepack pnpm test src/lib/share/compact.test.ts src/lib/ui/simulate/runController.test.ts`
Expected: FAIL. `thinIndices`·`simResultSnapshot` 등이 `compact`에 없고, `meta.symbols`가 `undefined`예요.

- [ ] **Step 3: 구현해요**

`src/lib/ui/simulate/runController.svelte.ts`:

```ts
export interface DoneMeta {
  // …기존 필드 그대로…
  /** 실행한 작업본(비교 기준 이름·하락 조건 표시용) */
  strategy: Strategy;
  /** 실행에 쓴 종목(요청 순서). perSymbol에 있는 종목과 failed의 종목을 합치면 이것이다(공유 스냅샷이 쓴다, 설계 1.5-2) */
  symbols: string[];
}
```

`start()` 안 `const meta = { … }`에 `symbols: [...symbols],`를 `strategy,` 다음에 더해요. `src/lib/ui/simulate/resultFixture.ts`의 `meta`에도 `strategy,` 다음 줄에 `symbols: ['005930', '000660', '035720'],`를 더해요(종목별 두 개 + 제외 하나, 요청 순서).

`src/lib/share/compact.ts` 전체를 아래로 바꿔요(Task 2의 `compareSnapshot`은 그대로 들어 있어요).

```ts
// 공유 스냅샷 만들기 중 열 형식·축약이 필요한 것(설계 2.3~2.5, 3절)과 받은 결과 펼치기(4.7). 검사는 snapshot.ts·checkResult.ts가 한다.
import type { SimResult } from '../sim/types';
import type { Group, Settings } from '../state/schema';
import { jsonBytes } from '../sync/forbidden';
import type { DoneState } from '../ui/simulate/runController.svelte';
import { AXIS_MAX, axisDate, dayOffset } from './checkResult';
import { SELL_KINDS, SKIP_REASONS } from './resultEnums';
import type { SymbolNames } from './shareText';
import {
  checkShareSnapshot,
  SHARE_MAX_BYTES,
  shareTitle,
  strategySnapshot,
  type CompareSnapshot,
  type ShareAxis,
  type ShareBuild,
  type SharedPerSymbol,
  type SharedTrade,
  type ShareReduction,
  type ShareSnapshot,
  type SimResultSnapshot,
} from './snapshot';

/** 시세 값은 넣지 않는다. 받은 사람이 자기 연결이나 데모로 다시 받는다. 지표는 사용자가 고른 값(app.settings.metric)이다. */
export function compareSnapshot(g: Group, s: Pick<Settings, 'period' | 'metric' | 'benchmark' | 'boardOrder'>): CompareSnapshot {
  return {
    kind: 'compare',
    v: 1,
    title: shareTitle(g.name),
    symbols: g.items.filter((i) => !i.hidden).map((i) => i.symbol),
    view: { period: { unit: s.period.unit, n: s.period.n }, metric: s.metric, benchmark: s.benchmark, boardOrder: s.boardOrder },
  };
}

// ── 값 다듬기 ─────────────────────────────────────────

/** 만들기 실패: null을 허용하지 않는 자리의 유한수가 아닌 값, 가리킬 곳이 없는 종목 등. path는 스냅샷 안 경로다 */
export class BuildError extends Error {
  constructor(readonly path: string) {
    super(`share build: ${path}`);
  }
}
const zero = (x: number) => (Object.is(x, -0) ? 0 : x);
/** 소수 둘째 자리. 유한수가 아니면 만들기 실패 */
export function r2(x: number, path: string): number {
  if (!Number.isFinite(x)) throw new BuildError(path);
  return zero(Math.round(x * 100) / 100);
}
/** 소수 둘째 자리. 유한수가 아니면 null */
export function r2n(x: number | null | undefined): number | null {
  return x == null || !Number.isFinite(x) ? null : zero(Math.round(x * 100) / 100);
}
/** 유효숫자 4자리(조건 계산값) */
export function sig4(x: number): number {
  return zero(Number(x.toPrecision(4)));
}

export function toAxis(dates: readonly string[]): ShareAxis {
  return { start: dates[0], offsets: dates.map((d) => dayOffset(dates[0], d)) };
}
export function fromAxis(a: ShareAxis): string[] {
  return a.offsets.map((o) => axisDate(a.start, o));
}

// ── 솎기(설계 3.3) ────────────────────────────────────

export const THIN_STEPS = [500, 250, 120] as const;
/** 축이 AXIS_MAX(3,700)를 넘으면 크기와 상관없이 먼저 이 점 수로 솎는다 */
export const AXIS_PRETHIN = 3000;

/** n개 중 남길 위치(오름차순). m은 고르게 남길 점 수, keep은 반드시 남길 위치 */
export function thinIndices(n: number, m: number, keep: readonly number[]): number[] {
  if (n <= m) return [...Array(n).keys()];
  const s = new Set<number>([0, n - 1]);
  for (const k of keep) if (Number.isInteger(k) && k >= 0 && k < n) s.add(k);
  for (let i = 0; i < m; i++) s.add(Math.round((i * (n - 1)) / (m - 1)));
  return [...s].sort((a, b) => a - b);
}

/** [최고 위치, 최저 위치]. null은 건너뛰고 같은 값이면 처음 위치. 값이 없으면 [] */
export function extremes(values: readonly (number | null)[]): number[] {
  let hi = -1;
  let lo = -1;
  values.forEach((v, i) => {
    if (v === null) return;
    if (hi < 0 || v > (values[hi] as number)) hi = i;
    if (lo < 0 || v < (values[lo] as number)) lo = i;
  });
  return hi < 0 ? [] : [hi, lo];
}

/** 최대 낙폭의 [직전 고점 위치, 바닥 위치] */
export function drawdownPoints(values: readonly number[]): number[] {
  let peak = 0;
  let best: [number, number] = [0, 0];
  let worst = 0;
  values.forEach((v, i) => {
    if (v > values[peak]) peak = i;
    const dd = v - values[peak];
    if (dd < worst) {
      worst = dd;
      best = [peak, i];
    }
  });
  return best;
}

const pick = <T>(arr: readonly T[], at: readonly number[]): T[] => at.map((i) => arr[i]);

/** 만든 쪽 마지막 단계: JSON 왕복 뒤 create 검사(설계 3.1). 서버가 거절할 것을 미리 막는다 */
export function finishBuild<S extends ShareSnapshot>(s: S, reduced: ShareReduction[], now: number): ShareBuild<S> {
  const copy = JSON.parse(JSON.stringify(s)) as S;
  const c = checkShareSnapshot(copy, s.kind, now, 'create');
  if (c.ok) return { ok: true, snapshot: copy, reduced };
  if (c.code === 'too-large') return { ok: false, code: 'too-large', bytes: jsonBytes(copy) };
  return c.path === undefined ? { ok: false, code: 'invalid' } : { ok: false, code: 'invalid', path: c.path };
}

// ── 시뮬레이션 결과(설계 2.4, 3.4) ──────────────────────

function roundSummary(s: SimResult['summary']): SimResult['summary'] {
  const p = (k: keyof SimResult['summary']) => `result.summary.${k}`;
  return {
    totalReturnPct: r2(s.totalReturnPct, p('totalReturnPct')),
    cagrPct: r2(s.cagrPct, p('cagrPct')),
    mddPct: r2(s.mddPct, p('mddPct')),
    winRatePct: r2n(s.winRatePct),
    wins: s.wins,
    losses: s.losses,
    avgWinPct: r2n(s.avgWinPct),
    avgLossPct: r2n(s.avgLossPct),
    roundTrips: s.roundTrips,
    openPositions: s.openPositions,
    avgHoldDays: r2n(s.avgHoldDays),
    avgCashPct: r2(s.avgCashPct, p('avgCashPct')),
    skippedSignals: s.skippedSignals,
    vsHoldPp: r2(s.vsHoldPp, p('vsHoldPp')),
    vsIndexPp: r2n(s.vsIndexPp),
    vsBenchmarkPp: r2n(s.vsBenchmarkPp),
  };
}

export function simResultSnapshot(done: DoneState, opts: { hideCapital: boolean; now?: number }): ShareBuild<SimResultSnapshot> {
  const now = opts.now ?? Date.now();
  try {
    const { result, meta } = done;
    const initial = meta.strategy.capital.initial;
    // 규칙은 실행한 작업본, 종목은 실행에 쓴 종목(설계 1.5-2)
    const rules = strategySnapshot({ ...meta.strategy, universe: { kind: 'symbols', symbols: meta.symbols } }, { groups: [] }, opts);
    const symbols = [...meta.symbols];
    const at = new Map(symbols.map((s, i) => [s, i]));
    const idx = (s: string, path: string) => {
      const i = at.get(s);
      if (i === undefined) throw new BuildError(path);
      return i;
    };
    const dates = result.equity.map((e) => e.date);
    if (dates.length === 0) throw new BuildError('result.axis');
    const n = dates.length;
    const day = (d: string) => dayOffset(dates[0], d);
    const pct = (v: number, path: string) => r2((v / initial - 1) * 100, path);
    const pctN = (v: number | null) => (v === null ? null : r2n((v / initial - 1) * 100));

    const full = {
      strategy: result.equity.map((e, i) => pct(e.strategy, `result.curves.strategy[${i}]`)),
      hold: result.equity.map((e, i) => pct(e.hold, `result.curves.hold[${i}]`)),
      index: result.equity.some((e) => e.index !== null) ? result.equity.map((e) => pctN(e.index)) : null,
      benchmark: result.equity.some((e) => e.benchmark !== null) ? result.equity.map((e) => pctN(e.benchmark)) : null,
    };
    const trades: SharedTrade[] = result.trades.map((t, i) => {
      const p = `result.trades[${i}]`;
      const sell = (SELL_KINDS as readonly string[]).includes(t.kind);
      return [day(t.date), idx(t.symbol, p), t.kind, t.stage ?? null, Math.round(t.price), opts.hideCapital ? null : t.qty, t.reason, sell ? r2(t.pnlPct ?? Number.NaN, `${p}.pnlPct`) : null];
    });
    const perSymbol: SharedPerSymbol[] = result.perSymbol.map((ps, i) => {
      const p = `result.perSymbol[${i}]`;
      return [idx(ps.symbol, p), opts.hideCapital ? null : Math.round(ps.pnl), r2((ps.pnl / initial) * 100, p), ps.roundTrips, ps.firstDate === null ? null : day(ps.firstDate)];
    });
    const counts = SKIP_REASONS.map((reason) => [reason, result.skipped.filter((k) => k.reason === reason).length] as [(typeof SKIP_REASONS)[number], number]).filter(([, c]) => c > 0);
    const rows = result.skipped.map((k, i) => [day(k.date), idx(k.symbol, `result.skipped.rows[${i}]`), SKIP_REASONS.indexOf(k.reason)] as [number, number, number]);
    const summary = roundSummary(result.summary);
    const benchmarks = {
      holdReturnPct: r2(result.benchmarks.holdReturnPct, 'result.benchmarks.holdReturnPct'),
      indexReturnPct: r2n(result.benchmarks.indexReturnPct),
      benchmarkReturnPct: r2n(result.benchmarks.benchmarkReturnPct),
    };
    const nearMiss = result.nearMiss && { maxDropPct: r2(result.nearMiss.maxDropPct, 'result.nearMiss.maxDropPct'), declineDays: result.nearMiss.declineDays };
    const keep = [
      ...extremes(full.strategy),
      ...extremes(full.hold),
      ...(full.index ? extremes(full.index) : []),
      ...(full.benchmark ? extremes(full.benchmark) : []),
      ...drawdownPoints(full.strategy),
    ];

    const make = (m: number | null, withRows: boolean): SimResultSnapshot => {
      const pos = m === null ? [...Array(n).keys()] : thinIndices(n, m, keep);
      return {
        kind: 'simResult',
        v: 1,
        title: rules.title,
        strategy: rules.strategy,
        capitalHidden: opts.hideCapital,
        run: { from: dates[0], to: dates[n - 1], source: meta.venueLabel, demo: meta.demo, fetchedAt: meta.fetchedAt },
        result: {
          axis: toAxis(pick(dates, pos)),
          sampled: pos.length === n ? null : { from: n },
          curves: {
            strategy: pick(full.strategy, pos),
            hold: pick(full.hold, pos),
            index: full.index && pick(full.index, pos),
            benchmark: full.benchmark && pick(full.benchmark, pos),
          },
          summary,
          benchmarks,
          indexFailed: meta.indexFailed,
          benchmarkFailed: meta.benchmarkFailed,
          symbols,
          trades,
          perSymbol,
          skipped: { counts, rows: withRows ? rows : null },
          nearMiss,
          failed: meta.failed.map((f) => ({ symbol: f.symbol, reason: f.reason })),
        },
      };
    };

    // 줄이는 순서(설계 3.4): 그대로 → 건너뜀은 개수만 → 원래 축에서 500 → 250 → 120점. 그래도 넘으면 거절(거래는 빼지 않는다)
    const first = n > AXIS_MAX ? AXIS_PRETHIN : null;
    const steps: [m: number | null, rows: boolean][] = [[first, true]];
    if (rows.length > 0) steps.push([first, false]);
    for (const m of THIN_STEPS) if (m < (first ?? n)) steps.push([m, rows.length === 0]);
    let bytes = 0;
    for (const [m, withRows] of steps) {
      const s = make(m, withRows);
      bytes = jsonBytes(s);
      if (bytes > SHARE_MAX_BYTES) continue;
      const reduced: ShareReduction[] = [];
      if (s.result.skipped.rows === null) reduced.push('skipped-counts');
      if (s.result.sampled) reduced.push('thinned');
      return finishBuild(s, reduced, now);
    }
    return { ok: false, code: 'too-large', bytes };
  } catch (e) {
    if (e instanceof BuildError) return { ok: false, code: 'invalid', path: e.path };
    throw e;
  }
}

/** 받은 시뮬레이션 결과를 결과 화면(ResultView)이 받는 모양으로 되돌린다. 곡선은 initial × (1 + pct / 100), 원시 일봉은 없다 */
export function expandSimResult(s: SimResultSnapshot, names?: SymbolNames): DoneState {
  const r = s.result;
  const initial = s.strategy.capital.initial;
  const back = (p: number) => initial * (1 + p / 100);
  const backN = (p: number | null) => (p === null ? null : back(p));
  const date = (d: number) => axisDate(r.axis.start, d);
  const nameMap: Record<string, string> = {};
  const bench = s.strategy.benchmarks.symbol;
  for (const c of [...r.symbols, ...(bench ? [bench] : [])]) nameMap[c] = names?.get(c) ?? c;
  const result: SimResult = {
    equity: fromAxis(r.axis).map((d, i) => ({
      date: d,
      strategy: back(r.curves.strategy[i]),
      hold: back(r.curves.hold[i]),
      index: r.curves.index ? backN(r.curves.index[i]) : null,
      benchmark: r.curves.benchmark ? backN(r.curves.benchmark[i]) : null,
      cash: 0, // 화면에 쓰지 않는다(요약의 avgCashPct는 남는다)
    })),
    summary: { ...r.summary },
    benchmarks: { ...r.benchmarks },
    trades: r.trades.map(([d, sym, kind, stage, price, qty, reason, pnlPct]) => ({
      date: date(d),
      symbol: r.symbols[sym],
      kind,
      ...(stage !== null && { stage }),
      price,
      qty: qty ?? 0,
      fee: 0,
      tax: 0,
      reason,
      ...(pnlPct !== null && { pnlPct }),
    })),
    skipped: (r.skipped.rows ?? []).map(([d, sym, reason]) => ({ date: date(d), symbol: r.symbols[sym], reason: SKIP_REASONS[reason] })),
    perSymbol: r.perSymbol.map(([sym, pnl, , roundTrips, firstDay]) => ({
      symbol: r.symbols[sym],
      name: nameMap[r.symbols[sym]],
      pnl: pnl ?? 0,
      roundTrips,
      firstDate: firstDay === null ? null : date(firstDay),
    })),
    nearMiss: r.nearMiss ? { ...r.nearMiss } : null,
  };
  return {
    kind: 'done',
    result,
    meta: {
      venueLabel: s.run.source,
      fetchedAt: s.run.fetchedAt,
      from: s.run.from,
      to: s.run.to,
      demo: s.run.demo,
      failed: r.failed.map((f) => ({ symbol: f.symbol, name: nameMap[f.symbol], reason: f.reason })),
      indexFailed: r.indexFailed,
      benchmarkFailed: r.benchmarkFailed,
      candles: {},
      names: nameMap,
      strategy: s.strategy,
      symbols: [...r.symbols],
    },
  };
}

/** 종목별 자금 대비 %(받은 화면의 종목별 탭이 자금 숨김일 때 쓴다) */
export function perSymbolPct(s: SimResultSnapshot): Record<string, number> {
  return Object.fromEntries(s.result.perSymbol.map(([sym, , pct]) => [s.result.symbols[sym], pct]));
}
```

- [ ] **Step 4: 통과하는지 확인해요**

Run: `corepack pnpm test src/lib/share src/lib/ui/simulate`
Expected: PASS. 크기 예산 테스트가 실패하면 고정 데이터 숫자를 바꾸지 말고 먼저 `jsonBytes`를 찍어 설계 3.5와 비교한 뒤 리뷰어에게 알려요.

Run: `corepack pnpm check`
Expected: 오류 0(`DoneMeta.symbols`가 필수가 되어 `DoneMeta`를 만드는 다른 테스트 고정 데이터가 있으면 같이 고쳐요. `grep -rn "venueLabel:" src --include=*.ts`로 찾아요)

- [ ] **Step 5: 커밋해요**

```bash
git add src/lib/share/compact.ts src/lib/share/compact.test.ts src/lib/share/testFixtures.ts src/lib/ui/simulate/runController.svelte.ts src/lib/ui/simulate/runController.test.ts src/lib/ui/simulate/resultFixture.ts
git commit -m "feat(share): 시뮬레이션 결과를 열 형식으로 줄여 공유 스냅샷으로 만들고 펼침" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 5: 검증 결과 만들기·펼치기

설계 1.5-3·6, 2.5, 2.6, 3.1, 3.4(검증 열), 3.5(검증 예산), 4.7의 `expandValidation`, 6.1.

**Files:**
- Modify: `src/lib/share/compact.ts` (`validationSnapshot`, `expandValidation`, `ValidationRun` 타입)
- Modify: `src/lib/share/testFixtures.ts` (`bigValidationRun`)
- Test: `src/lib/share/compact.validation.test.ts` (새 파일)

**Interfaces:**
- Consumes: Task 4의 `r2`·`r2n`·`sig4`·`toAxis`·`fromAxis`·`thinIndices`·`extremes`·`drawdownPoints`·`finishBuild`·`BuildError`·`THIN_STEPS`·`AXIS_PRETHIN`, Task 3의 `ValidationSnapshot`·`SharedValidation`·`SharedPick`·`SharedRebalance`·`SharedStats`·`ValuePairs`, `criteriaSnapshot`(`./snapshot`), `VALUE_KEY_RULE`·`SKIP_REASONS`(`./resultEnums`), `axisDate`·`dayOffset`·`AXIS_MAX`(`./checkResult`), `ValidationResult`·`CurvePoint`·`CurveStats`(`../screen/runValidation`, 타입만), `Selection`(`../screen/select`, 타입만)
- Produces (`compact.ts`):

```ts
export interface ValidationRun {
  result: ValidationResult;
  criteria: SelectionCriteria;
  baskets: Basket[];
  strategies: Strategy[];
  /** 실행 때 시장 파일의 collectedAt(ISO 문자열) */
  collectedAt: string;
}
export const VALIDATION_SOURCE = '시장 데이터 파일';
export function validationSnapshot(run: ValidationRun, opts: { hideCapital: boolean; now?: number }): ShareBuild<ValidationSnapshot>;
export function expandValidation(s: ValidationSnapshot): ValidationResult;
```

- Produces (`testFixtures.ts`): `bigValidationRun(o: { days: number; every: number; take: number; baskets?: number }): ValidationRun`

- [ ] **Step 1: 실패하는 테스트를 써요**

`src/lib/share/testFixtures.ts` 끝에 더해요(import에 `import type { ValidationRun } from './compact';`, `import type { ValidationResult } from '../screen/runValidation';`, `import { axisDate } from './checkResult';`를 더해요).

```ts
const VALUE_NAMES = ['marketCap', 'tradingValue', 'return', 'ma', 'fromHigh', 'volatility', 'finPer', 'finPbr'];

/**
 * 크기 예산(설계 3.5)용 검증 실행: every 거래일마다 재선정, 상위 take, 조건 계산값 8개, 곡선 4개(①·②·KOSPI·KODEX 200).
 * baskets를 주면 300종목 묶음을 그 수만큼 기준에 넣는다.
 */
export function bigValidationRun(o: { days: number; every: number; take: number; baskets?: number }): ValidationRun {
  const criteria = newCriteria(NOW, null, '큰 기준');
  criteria.rank.take = o.take;
  const baskets = Array.from({ length: o.baskets ?? 0 }, (_, b) =>
    newBasket(NOW, `큰 묶음 ${b + 1}`, Array.from({ length: 300 }, (_, i) => String(100000 + b * 1000 + i))),
  );
  criteria.pool.baskets = baskets.map((b) => b.id);
  const capital = criteria.capital;
  const axis = tradingDays('2016-01-04', o.days);
  const curve = (a: number, f: number) => axis.map((date, i) => ({ date, value: capital * (1 + a * Math.sin(i / f) + i / o.days) }));
  const stats = { totalPct: 12.3456, cagrPct: 3.4567, mddPct: -23.4567, volPct: 18.888 };
  const at = Array.from({ length: Math.ceil(o.days / o.every) }, (_, k) => k * o.every);
  const picked = (k: number) =>
    Array.from({ length: o.take }, (_, j) => ({
      symbol: String(200000 + j),
      values: Object.fromEntries(VALUE_NAMES.map((name, v) => [name, (123456789.123 + k * 1000 + j) * (v + 1)])),
    }));
  const rebalances = at.map((i, k) => ({ date: axis[i], passed: o.take * 3 + 100, picked: picked(k) }));
  const result: ValidationResult = {
    axis,
    rebalances,
    today: { date: axisDate(axis[axis.length - 1], 1), passed: o.take * 3, picked: picked(at.length) },
    hold: {
      equity: curve(0.2, 40),
      segments: rebalances.map((r, k) => ({
        from: r.date,
        to: k + 1 < rebalances.length ? rebalances[k + 1].date : axis[axis.length - 1],
        picked: r.picked.map((p, j) => ({ symbol: p.symbol, retPct: -12.3456 - j, soldAtLastClose: false, notBought: false })),
      })),
      stats,
      beat: { beat: 10, total: rebalances.length },
    },
    trading: { curve: curve(0.25, 31), stats, trades: 120, skipCounts: { '현금 부족': 3, '거래 없음': 2 } },
    indices: [{ id: 'KOSPI', curve: curve(0.1, 61), stats }],
    benchmarks: [{ symbol: '069500', name: 'KODEX 200', curve: curve(0.12, 47), stats }],
    byMarket: [
      { key: 'KOSPI', inPool: true, stats, avgPicked: o.take / 2 },
      { key: 'KOSDAQ', inPool: true, stats, avgPicked: o.take / 3 },
      { key: 'ETF', inPool: false, stats, avgPicked: 0 },
    ],
    notes: ['survivorship', 'snapshot', 'dividend'],
  };
  return { result, criteria, baskets, strategies: [], collectedAt: '2026-10-16T18:00:00+09:00' };
}
```

`src/lib/share/compact.validation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { newCriteria } from '../screen/defaults';
import { jsonBytes } from '../sync/forbidden';
import { validationResult } from '../ui/screen/resultFixture';
import { expandValidation, validationSnapshot, type ValidationRun } from './compact';
import { checkShareSnapshot, SHARE_MAX_BYTES } from './snapshot';
import { bigValidationRun, NOW } from './testFixtures';

function smallRun(): ValidationRun {
  return { result: validationResult(), criteria: newCriteria(NOW, null, '반등 기준'), baskets: [], strategies: [], collectedAt: '2026-02-04T18:00:00+09:00' };
}

describe('validationSnapshot', () => {
  it('3년 월간 · 상위 10 · 계산값 8개 · 곡선 4개는 줄이지 않고 들어간다(설계 3.5)', () => {
    const b = validationSnapshot(bigValidationRun({ days: 735, every: 21, take: 10 }), { hideCapital: false, now: NOW });
    if (!b.ok) throw new Error(JSON.stringify(b));
    expect(b.reduced).toEqual([]);
    expect(b.snapshot.result.history).toBe('full');
    expect(b.snapshot.result.sampled).toBeNull();
    expect(jsonBytes(b.snapshot)).toBeLessThanOrEqual(SHARE_MAX_BYTES);
  });

  it('10년 월간 · 상위 30이면 계산값 빼기 → 솎기 → 코드만까지 가서 들어간다', () => {
    const b = validationSnapshot(bigValidationRun({ days: 2450, every: 21, take: 30, baskets: 2 }), { hideCapital: false, now: NOW });
    if (!b.ok) throw new Error(JSON.stringify(b));
    expect(b.reduced).toEqual(['thinned', 'codes-only']);
    expect(b.snapshot.result.history).toBe('codes');
    expect(b.snapshot.result.sampled).toEqual({ from: 2450 });
    expect(typeof b.snapshot.result.rebalances[0].picks[0]).toBe('string');
    expect(b.snapshot.result.today.picks[0].values.length).toBeGreaterThan(0); // 오늘 선정은 늘 계산값까지
  });

  it('재선정일은 솎아도 축에 남는다', () => {
    const b = validationSnapshot(bigValidationRun({ days: 2450, every: 21, take: 30, baskets: 2 }), { hideCapital: false, now: NOW });
    if (!b.ok) throw new Error(JSON.stringify(b));
    const days = new Set(b.snapshot.result.axis.offsets);
    for (const r of b.snapshot.result.rebalances) expect(days.has(r.day)).toBe(true);
  });

  it('값 반올림: 정수 키는 그대로, 나머지는 4자리', () => {
    const run = smallRun();
    run.result.rebalances[0].picked[0].values = { finQuarter: 202406, leaderRank: 3, flowStreak: 12, marketCap: 123456789.123, return: -12.3456, rebound: true, usdkrwBeta: Number.NaN };
    const b = validationSnapshot(run, { hideCapital: false, now: NOW });
    if (!b.ok) throw new Error(JSON.stringify(b));
    const r = b.snapshot.result;
    const pick = r.rebalances[0].picks[0] as [string, number | null, unknown, (number | boolean | null)[]];
    const values = Object.fromEntries(Array.from({ length: pick[3].length / 2 }, (_, i) => [r.valueKeys[pick[3][i * 2] as number], pick[3][i * 2 + 1]]));
    expect(values).toEqual({ finQuarter: 202406, leaderRank: 3, flowStreak: 12, marketCap: 123500000, return: -12.35, rebound: true, usdkrwBeta: null });
  });

  it('목록 밖 값 키는 만들기에서 막는다', () => {
    const run = smallRun();
    run.result.today.picked[0].values = { __proto__x: 1 } as Record<string, number>;
    expect(validationSnapshot(run, { hideCapital: false, now: NOW })).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('메타: 시장 파일 출처, 데모 아님, 수집 시각', () => {
    const b = validationSnapshot(smallRun(), { hideCapital: false, now: NOW });
    if (!b.ok) throw new Error(JSON.stringify(b));
    expect(b.snapshot.run).toEqual({ from: '2026-01-05', to: '2026-02-03', source: '시장 데이터 파일', demo: false, fetchedAt: Date.parse('2026-02-04T18:00:00+09:00') });
    expect(validationSnapshot({ ...smallRun(), collectedAt: '언제' }, { hideCapital: false, now: NOW })).toMatchObject({ ok: false, code: 'invalid', path: 'run.fetchedAt' });
  });

  it('자금 숨김: 기준 자본은 기본값, JSON에 원래 자본이 없다. ②의 전략은 넣지 않는다', () => {
    const run = smallRun();
    run.criteria.capital = 555_000_000;
    run.criteria.trading = { strategyId: crypto.randomUUID() };
    run.result.hold.equity = run.result.hold.equity.map((p, i) => ({ ...p, value: 555_000_000 * (1 + i / 100) }));
    const b = validationSnapshot(run, { hideCapital: true, now: NOW });
    if (!b.ok) throw new Error(JSON.stringify(b));
    expect(b.snapshot.capitalHidden).toBe(true);
    expect(b.snapshot.criteria.trading).toEqual({ strategyId: null });
    expect(JSON.stringify(b.snapshot)).not.toContain('555000000');
    expect(b.snapshot.result.hold.curve).toEqual([0, 1, 2, 3]);
  });

  it('만든 쪽 왕복: create 검사를 통과한다', () => {
    const b = validationSnapshot(smallRun(), { hideCapital: false, now: NOW });
    if (!b.ok) throw new Error(JSON.stringify(b));
    expect(checkShareSnapshot(JSON.parse(JSON.stringify(b.snapshot)), 'validation', NOW, 'create').ok).toBe(true);
  });

  it('펼치면 선정 이력·구간·오늘 선정·통계가 원래와 같고 곡선은 반올림 오차 안이다', () => {
    const run = smallRun();
    const b = validationSnapshot(run, { hideCapital: false, now: NOW });
    if (!b.ok) throw new Error(JSON.stringify(b));
    const back = expandValidation(b.snapshot);
    const orig = run.result;
    expect(back.axis).toEqual(orig.axis);
    expect(back.rebalances).toEqual(orig.rebalances);
    expect(back.today).toEqual(orig.today);
    expect(back.hold.segments).toEqual(orig.hold.segments);
    expect(back.hold.stats).toEqual(orig.hold.stats);
    expect(back.hold.beat).toEqual(orig.hold.beat);
    expect(back.byMarket).toEqual(orig.byMarket);
    expect(back.notes).toEqual(orig.notes);
    expect(back.indices.map((i) => [i.id, i.stats, i.reason])).toEqual(orig.indices.map((i) => [i.id, i.stats, i.reason]));
    back.hold.equity.forEach((p, i) => expect(Math.abs(p.value - orig.hold.equity[i].value)).toBeLessThan(run.criteria.capital * 0.0001));
  });

  it('코드만 이력을 펼치면 수익률 없이 종목 줄만 있다', () => {
    const b = validationSnapshot(bigValidationRun({ days: 2450, every: 21, take: 30, baskets: 2 }), { hideCapital: false, now: NOW });
    if (!b.ok) throw new Error(JSON.stringify(b));
    const back = expandValidation(b.snapshot);
    expect(back.rebalances[0].picked[0]).toEqual({ symbol: '200000', values: {} });
    expect(back.hold.segments[0].picked[0]).toEqual({ symbol: '200000', retPct: null, soldAtLastClose: false, notBought: false });
    expect(back.hold.segments.at(-1)!.to).toBe(back.axis.at(-1));
  });
});
```

- [ ] **Step 2: 실패하는지 확인해요**

Run: `corepack pnpm test src/lib/share/compact.validation.test.ts`
Expected: FAIL. `validationSnapshot`·`expandValidation`이 `compact`에 없어요.

- [ ] **Step 3: 구현해요**

`src/lib/share/compact.ts`에 import를 더하고(아래 `import type`들과 `criteriaSnapshot`·`VALUE_KEY_RULE`. 같은 모듈에서 오는 것은 기존 import 줄에 합쳐요), 파일 끝에 붙여요.

```ts
import type { Basket } from '../screen/baskets';
import type { CurvePoint, CurveStats, ValidationResult } from '../screen/runValidation';
import type { Selection } from '../screen/select';
import type { SelectionCriteria } from '../screen/types';
import type { Strategy } from '../sim/types';
import { VALUE_KEY_RULE } from './resultEnums';
import { criteriaSnapshot, type SharedPick, type SharedRebalance, type SharedStats, type SharedValidation, type ValidationSnapshot, type ValuePairs } from './snapshot';
```

```ts
// ── 검증 결과(설계 2.5, 3.4) ────────────────────────────

export interface ValidationRun {
  result: ValidationResult;
  criteria: SelectionCriteria;
  baskets: Basket[];
  strategies: Strategy[];
  /** 실행 때 시장 파일의 collectedAt(ISO 문자열) */
  collectedAt: string;
}

/** 시장 파일에는 데모 표시가 없고 데모 파일은 배포하지 않으므로 검증은 늘 demo: false다(설계 2.2) */
export const VALIDATION_SOURCE = '시장 데이터 파일';

type History = SharedValidation['history'];

export function validationSnapshot(run: ValidationRun, opts: { hideCapital: boolean; now?: number }): ShareBuild<ValidationSnapshot> {
  const now = opts.now ?? Date.now();
  try {
    const { result } = run;
    const rules = criteriaSnapshot(run.criteria, { baskets: run.baskets, strategies: run.strategies }, opts);
    const capital = run.criteria.capital;
    const dates = result.axis;
    if (dates.length === 0) throw new BuildError('result.axis');
    const n = dates.length;
    const fetchedAt = Date.parse(run.collectedAt);
    if (!Number.isFinite(fetchedAt) || fetchedAt <= 0) throw new BuildError('run.fetchedAt');
    const day = (d: string) => dayOffset(dates[0], d);
    const curvePct = (pts: CurvePoint[], path: string) => {
      if (pts.length !== n) throw new BuildError(path);
      return pts.map((p, i) => r2((p.value / capital - 1) * 100, `${path}[${i}]`));
    };
    const stats = (s: CurveStats, path: string): SharedStats => ({
      totalPct: r2(s.totalPct, `${path}.totalPct`),
      cagrPct: r2(s.cagrPct, `${path}.cagrPct`),
      mddPct: r2(s.mddPct, `${path}.mddPct`),
      volPct: r2(s.volPct, `${path}.volPct`),
    });

    // 값 키: 나온 순서대로 위치를 준다. 목록 밖 이름은 만들기 실패
    const valueKeys: string[] = [];
    const keyAt = new Map<string, number>();
    const pairs = (values: Selection['picked'][number]['values'], path: string): ValuePairs => {
      const out: ValuePairs = [];
      for (const [k, v] of Object.entries(values)) {
        const rule = Object.hasOwn(VALUE_KEY_RULE, k) ? VALUE_KEY_RULE[k] : undefined;
        if (!rule) throw new BuildError(path);
        if (!keyAt.has(k)) {
          keyAt.set(k, valueKeys.length);
          valueKeys.push(k);
        }
        let x: number | boolean | null;
        if (rule === 'bool') x = v;
        else if (typeof v !== 'number' || !Number.isFinite(v)) x = null;
        else if (rule === 'int') {
          if (!Number.isInteger(v)) throw new BuildError(path);
          x = v;
        } else x = sig4(v);
        out.push(keyAt.get(k)!, x);
      }
      return out;
    };

    const todayPicks = result.today.picked.map((p, j) => ({ symbol: p.symbol, values: pairs(p.values, `result.today.picks[${j}]`) }));
    const todayKeys = valueKeys.length;
    // 이력의 계산값은 full일 때만 키 표에 더한다. 위치가 늘 같게 full 키를 미리 한 번 만들어 둔다
    const fullHistory = result.rebalances.map((r, i) => r.picked.map((p, j) => pairs(p.values, `result.rebalances[${i}].picks[${j}]`)));
    const segOf = (date: string) => result.hold.segments.find((s) => s.from === date);
    const markOf = (date: string, symbol: string): { retPct: number | null; mark: SharedPick[2] } => {
      const sp = segOf(date)?.picked.find((x) => x.symbol === symbol);
      if (!sp) return { retPct: null, mark: 0 };
      return { retPct: r2n(sp.retPct), mark: sp.notBought ? (sp.notBoughtReason ?? 'noBar') : sp.soldAtLastClose ? 1 : 0 };
    };
    const rebalancesFor = (h: History): SharedRebalance[] =>
      result.rebalances.map((r, i) => ({
        day: day(r.date),
        passed: r.passed,
        picks:
          h === 'codes'
            ? r.picked.map((p) => p.symbol)
            : r.picked.map((p, j): SharedPick => {
                const m = markOf(r.date, p.symbol);
                return [p.symbol, m.retPct, m.mark, h === 'full' ? fullHistory[i][j] : null];
              }),
      }));

    const indices = result.indices.map((x, i) => ({
      id: x.id,
      curve: x.curve ? curvePct(x.curve, `result.indices[${i}].curve`) : null,
      reason: x.curve ? null : (x.reason ?? '받지 못했어요'),
      stats: x.curve && x.stats ? stats(x.stats, `result.indices[${i}].stats`) : null,
    }));
    const benchmarks = result.benchmarks.map((x, i) => ({
      symbol: x.symbol,
      name: x.name,
      curve: x.curve ? curvePct(x.curve, `result.benchmarks[${i}].curve`) : null,
      reason: x.curve ? null : (x.reason ?? '받지 못했어요'),
      stats: x.curve && x.stats ? stats(x.stats, `result.benchmarks[${i}].stats`) : null,
    }));
    const hold = curvePct(result.hold.equity, 'result.hold.curve');
    const trading = result.trading && {
      curve: curvePct(result.trading.curve, 'result.trading.curve'),
      stats: stats(result.trading.stats, 'result.trading.stats'),
      trades: result.trading.trades,
      skipCounts: SKIP_REASONS.filter((reason) => (result.trading!.skipCounts[reason] ?? 0) > 0).map((reason) => [reason, result.trading!.skipCounts[reason]!] as [(typeof SKIP_REASONS)[number], number]),
    };
    const curves = [hold, trading?.curve ?? null, ...indices.map((x) => x.curve), ...benchmarks.map((x) => x.curve)].filter((c): c is number[] => c !== null);
    const keep = [...curves.flatMap((c) => extremes(c)), ...drawdownPoints(hold), ...result.rebalances.map((r) => dates.indexOf(r.date))];

    const make = (m: number | null, h: History): ValidationSnapshot => {
      const pos = m === null ? [...Array(n).keys()] : thinIndices(n, m, keep);
      const cut = (c: number[] | null) => c && pick(c, pos);
      return {
        kind: 'validation',
        v: 1,
        title: rules.title,
        criteria: rules.criteria,
        baskets: rules.baskets,
        capitalHidden: opts.hideCapital,
        run: { from: dates[0], to: dates[n - 1], source: VALIDATION_SOURCE, demo: false, fetchedAt },
        result: {
          axis: toAxis(pick(dates, pos)),
          sampled: pos.length === n ? null : { from: n },
          hold: { curve: pick(hold, pos), stats: stats(result.hold.stats, 'result.hold.stats'), beat: result.hold.beat && { ...result.hold.beat } },
          trading: trading && { ...trading, curve: pick(trading.curve, pos) },
          indices: indices.map((x) => ({ ...x, curve: cut(x.curve) })),
          benchmarks: benchmarks.map((x) => ({ ...x, curve: cut(x.curve) })),
          byMarket: result.byMarket.map((x, i) => ({ key: x.key, inPool: x.inPool, stats: stats(x.stats, `result.byMarket[${i}].stats`), avgPicked: r2(x.avgPicked, `result.byMarket[${i}].avgPicked`) })),
          history: h,
          // 이력이 full이 아니면 오늘 선정이 쓰는 키만 남긴다(오늘 선정의 키가 먼저 번호를 받았다)
          valueKeys: h === 'full' ? [...valueKeys] : valueKeys.slice(0, todayKeys),
          rebalances: rebalancesFor(h),
          today: { date: result.today.date, passed: result.today.passed, picks: todayPicks },
          notes: [...result.notes],
        },
      };
    };

    // 줄이는 순서(설계 3.4): 그대로 → 계산값 빼기 → 원래 축에서 500 → 250 → 120점 → 코드만 → 거절
    const first = n > AXIS_MAX ? AXIS_PRETHIN : null;
    const anyPicks = result.rebalances.some((r) => r.picked.length > 0);
    const steps: [m: number | null, h: History][] = [[first, 'full']];
    if (anyPicks) steps.push([first, 'noValues']);
    for (const m of THIN_STEPS) if (m < (first ?? n)) steps.push([m, anyPicks ? 'noValues' : 'full']);
    if (anyPicks) steps.push([Math.min(THIN_STEPS[THIN_STEPS.length - 1], first ?? n), 'codes']);
    let bytes = 0;
    for (const [m, h] of steps) {
      const s = make(m, h);
      bytes = jsonBytes(s);
      if (bytes > SHARE_MAX_BYTES) continue;
      const reduced: ShareReduction[] = [];
      if (h === 'noValues') reduced.push('no-values');
      if (s.result.sampled) reduced.push('thinned');
      if (h === 'codes') reduced.push('codes-only');
      return finishBuild(s, reduced, now);
    }
    return { ok: false, code: 'too-large', bytes };
  } catch (e) {
    if (e instanceof BuildError) return { ok: false, code: 'invalid', path: e.path };
    throw e;
  }
}

/** 받은 검증 결과를 검증 화면(ValidationResult)이 받는 모양으로 되돌린다. 곡선 값 = capital × (1 + pct / 100) */
export function expandValidation(s: ValidationSnapshot): ValidationResult {
  const r = s.result;
  const capital = s.criteria.capital;
  const axis = fromAxis(r.axis);
  const points = (c: number[]): CurvePoint[] => c.map((p, i) => ({ date: axis[i], value: capital * (1 + p / 100) }));
  const values = (pairs: ValuePairs | null): Selection['picked'][number]['values'] => {
    const out: Selection['picked'][number]['values'] = {};
    if (pairs) for (let i = 0; i < pairs.length; i += 2) out[r.valueKeys[pairs[i] as number]] = pairs[i + 1];
    return out;
  };
  const dateOf = (d: number) => axisDate(r.axis.start, d);
  const codes = r.history === 'codes';
  const rebalances: Selection[] = r.rebalances.map((b) => ({
    date: dateOf(b.day),
    passed: b.passed,
    picked: codes ? (b.picks as string[]).map((symbol) => ({ symbol, values: {} })) : (b.picks as SharedPick[]).map(([symbol, , , v]) => ({ symbol, values: values(v) })),
  }));
  // 구간 끝은 담지 않았다: 다음 재선정일, 마지막 구간은 축의 마지막 날(holdSelection.ts와 같은 규칙, 설계 2.5)
  const segments = r.rebalances.map((b, i) => ({
    from: dateOf(b.day),
    to: i + 1 < r.rebalances.length ? dateOf(r.rebalances[i + 1].day) : axis[axis.length - 1],
    picked: codes
      ? (b.picks as string[]).map((symbol) => ({ symbol, retPct: null, soldAtLastClose: false, notBought: false }))
      : (b.picks as SharedPick[]).map(([symbol, retPct, mark]) =>
          typeof mark === 'string'
            ? { symbol, retPct, soldAtLastClose: false, notBought: true, notBoughtReason: mark }
            : { symbol, retPct, soldAtLastClose: mark === 1, notBought: false },
        ),
  }));
  return {
    axis,
    rebalances,
    today: { date: r.today.date, passed: r.today.passed, picked: r.today.picks.map((p) => ({ symbol: p.symbol, values: values(p.values) })) },
    hold: { equity: points(r.hold.curve), segments, stats: { ...r.hold.stats }, beat: r.hold.beat && { ...r.hold.beat } },
    trading: r.trading && {
      curve: points(r.trading.curve),
      stats: { ...r.trading.stats },
      trades: r.trading.trades,
      skipCounts: Object.fromEntries(r.trading.skipCounts),
    },
    indices: r.indices.map((x) => ({ id: x.id, curve: x.curve && points(x.curve), ...(x.reason !== null && { reason: x.reason }), stats: x.stats && { ...x.stats } })),
    benchmarks: r.benchmarks.map((x) => ({ symbol: x.symbol, name: x.name, curve: x.curve && points(x.curve), ...(x.reason !== null && { reason: x.reason }), stats: x.stats && { ...x.stats } })),
    byMarket: r.byMarket.map((x) => ({ ...x, stats: { ...x.stats } })),
    notes: [...r.notes],
  };
}
```

(`valueKeys`는 오늘 선정을 먼저 돌려 번호를 매기므로, 이력이 `noValues`·`codes`일 때 앞쪽 `todayKeys`개만 남겨도 오늘 선정의 키 위치가 그대로 맞아요.)

- [ ] **Step 4: 통과하는지 확인해요**

Run: `corepack pnpm test src/lib/share`
Expected: PASS. 크기 테스트가 실패하면 `jsonBytes`를 찍어 설계 3.5 숫자와 비교하고 리뷰어에게 알려요(고정 데이터나 기대값을 몰래 바꾸지 않아요).

Run: `corepack pnpm check`
Expected: 오류 0

- [ ] **Step 5: 커밋해요**

```bash
git add src/lib/share/compact.ts src/lib/share/compact.validation.test.ts src/lib/share/testFixtures.ts
git commit -m "feat(share): 선정 기준 검증 결과를 줄여 공유 스냅샷으로 만들고 펼침" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Task 6: Worker 테스트·표시 이름 통합·공유 오류 문구·요약 줄

설계 1.4 「정리」, 2.1(KIND 맵 네 벌 → `kindLabel`), 4.5(`snapshotLines`·`cardLines`), 6.4(sync-worker), 7절(`describeFail` 공유 문구).

**Files:**
- Modify: `sync-worker/src/shares.test.ts`
- Modify: `src/lib/share/shareText.ts`, Test: `src/lib/share/shareText.test.ts`
- Modify: `src/lib/sync/controller.svelte.ts` (`describeFail`, `ok`, `createShare`), Test: `src/lib/sync/controller.test.ts`
- Modify: `src/lib/share/ShareDialog.svelte`, `src/lib/share/kakao.ts`, `src/routes/SharedView.svelte`, `src/lib/ui/settings/SyncManage.svelte` (`KIND` 맵 → `kindLabel`)

**Interfaces:**
- Consumes: Task 1 `kindLabel`, Task 2 `compareSnapshot`·`CompareSnapshot`, Task 3 `simResultFixture`·`validationFixture`(`src/lib/share/testFixtures.ts`), `SimResultSnapshot`·`ValidationSnapshot`
- Produces:
  - `shareText.ts`: `metricLabel(id: Settings['metric']): string`, `compareViewText(view: CompareSnapshot['view']): string`, `cardLines(s: ShareSnapshot, names?: SymbolNames, line?: string | null): string[]`(1~2줄), `snapshotLines`가 여섯 종류를 모두 다룸
  - `controller.svelte.ts`: `describeFail(f: ApiFail, ctx?: 'profile' | 'share'): string`, `SHARE_TOO_LARGE_TEXT = '공유 내용이 너무 커요(100 KB). 기간이나 종목을 줄여 주세요'`

- [ ] **Step 1: 실패하는 테스트를 써요**

`sync-worker/src/shares.test.ts` 맨 위 import에 더하고, `describe('공유 API', …)` 안 끝에 붙여요.

```ts
import { compareSnapshot } from '../../src/lib/share/compact';
import { simResultFixture, validationFixture } from '../../src/lib/share/testFixtures';
```

```ts
  it('새 세 종류를 만들고(200) 읽으면 그대로 돌려준다', async () => {
    const { me, read } = await setup();
    const compare = compareSnapshot(
      { id: 'g0', name: '반도체', items: [{ symbol: '005930', colorSlot: 1, hidden: false, addedAt: 1 }] },
      { period: { unit: 'M', n: 1 }, metric: 'change', benchmark: 'AUTO', boardOrder: 'value' },
    );
    for (const snapshot of [compare, simResultFixture(), simResultFixture({ capitalHidden: true }), validationFixture()]) {
      const r = await j(await me.as('POST', '/v1/shares', { sourceProfileId: 'p1', kind: snapshot.kind, snapshot }));
      expect(r.status, snapshot.kind).toBe(200);
      const got = await read(r.body.capability as string);
      expect(got.status).toBe(200);
      expect(await got.json()).toMatchObject({ kind: snapshot.kind, title: snapshot.title, snapshot });
    }
  });

  it('요청 kind와 스냅샷 kind가 다르면 422 invalid, 모르는 kind는 422 unsupported', async () => {
    const { me } = await setup();
    const post = async (body: Record<string, unknown>) => j(await me.as('POST', '/v1/shares', { sourceProfileId: 'p1', ...body }));
    expect(await post({ kind: 'compare', snapshot: simResultFixture() })).toEqual({ status: 422, body: { error: 'invalid', path: 'kind' } });
    expect(await post({ kind: 'future', snapshot: { kind: 'future', v: 1, title: '새 종류' } })).toEqual({ status: 422, body: { error: 'unsupported', path: 'kind' } });
  });

  it('100 KiB 넘는 스냅샷은 422 too-large, 본문이 110 KiB를 넘으면 그 전에 413 too-large', async () => {
    const { me } = await setup();
    const post = async (pad: number) =>
      j(await me.as('POST', '/v1/shares', { sourceProfileId: 'p1', kind: 'simResult', snapshot: { ...simResultFixture(), pad: 'a'.repeat(pad) } }));
    expect(await post(101 * 1024)).toMatchObject({ status: 422, body: { error: 'too-large' } });
    expect(await post(120 * 1024)).toMatchObject({ status: 413, body: { error: 'too-large' } });
  });

  it('깊이 1,000의 중첩 스냅샷은 500이 아니라 422', async () => {
    const { me } = await setup();
    let deep: Record<string, unknown> = {};
    for (let i = 0; i < 1000; i++) deep = { a: deep };
    const r = await j(await me.as('POST', '/v1/shares', { sourceProfileId: 'p1', kind: 'group', snapshot: { ...group(), deep } }));
    expect(r).toEqual({ status: 422, body: { error: 'invalid' } });
  });
```

`src/lib/share/shareText.test.ts` 끝에 더해요(import에 `import { cardLines, compareViewText } from './shareText';`, `import { compareSnapshot } from './compact';`, `import { simResultFixture, validationFixture } from './testFixtures';`, `import { fmtReturnPct, trendReturn } from '../ui/simulate/simText';`, `import { trendPp } from '../ui/screen/screenText';`, `import { newCriteria } from '../screen/defaults';`, `import { criteriaSnapshot } from './snapshot';`를 더해요).

```ts
describe('새 종류의 요약', () => {
  const cmp = compareSnapshot(
    { id: 'g', name: '반도체', items: ['000660', '005930', '035420', '051910'].map((symbol, i) => ({ symbol, colorSlot: (i + 1) as 1, hidden: false, addedAt: 1 })) },
    { period: { unit: 'M', n: 1 }, metric: 'change', benchmark: 'AUTO', boardOrder: 'value' },
  );

  it('보기 설정 한 줄', () => {
    expect(compareViewText(cmp.view)).toBe('기간 1개월 · 지표 등락률 · 벤치마크 자동 · 정렬 값 순');
    expect(compareViewText({ ...cmp.view, benchmark: 'KOSDAQ', boardOrder: 'mine' })).toBe('기간 1개월 · 지표 등락률 · 벤치마크 KOSDAQ · 정렬 내 순서');
  });

  it('카드 두 줄: 그룹·전략·기준·비교', () => {
    expect(cardLines(group, names)).toEqual(['종목 2개: SK하이닉스, 999999']);
    expect(cardLines({ ...group, symbols: ['000660', '005930', '035420', '051910', '000270'] }, names)).toEqual(['종목 5개: SK하이닉스, 삼성전자, 035420 외 2개']);
    const s = newStrategy(1, null);
    s.universe = { kind: 'symbols', symbols: ['005930'] };
    s.period = { from: '2023-10-11', to: '2026-10-11' };
    const st = strategySnapshot(s, { groups: [] }, { hideCapital: true });
    const [a, b] = cardLines(st);
    expect(a).toBe('종목 1개 · 2023.10.11 ~ 2026.10.11');
    expect(b).toMatch(/^하락 (\d+%|끔) · 익절 \d+%(\/\d+%)* · 손절 \d+(\.\d+)?%$/);
    const cr = criteriaSnapshot(newCriteria(1, null, '기준'), { baskets: [], strategies: [] }, { hideCapital: false });
    expect(cardLines(cr)[0]).toBe('KOSPI·KOSDAQ 상위 10개 · 매월 재선정');
    expect(cardLines(cmp, names)).toEqual(['종목 4개 · 1개월 등락률', 'SK하이닉스, 삼성전자, 035420']);
    expect(cardLines(cmp, names, '삼성전자 +3.2% · 10.29 14:32 기준')[1]).toBe('삼성전자 +3.2% · 10.29 14:32 기준');
  });

  it('카드 두 줄: 시뮬레이션·검증(데모면 끝에 · 데모)', () => {
    const sim = simResultFixture();
    expect(cardLines(sim)).toEqual([`총수익률 ${trendReturn(4.1)} · 최대 낙폭 ${fmtReturnPct(-3.69)}`, '종목 3개 · 거래 2번 · 2024.01.02 ~ 2024.01.12']);
    expect(cardLines({ ...sim, run: { ...sim.run, demo: true } })[1]).toBe('종목 3개 · 거래 2번 · 2024.01.02 ~ 2024.01.12 · 데모');
    const val = validationFixture();
    expect(cardLines(val)).toEqual([`① 선정만 ${trendReturn(12.34)} · 지수 대비 ${trendPp(12.34 - 8.06)}`, '상위 10개 · 매월 · 2026.01 ~ 2026.02']);
  });

  it('미리 보기 줄: 결과 종류는 제목·두 줄·시세 출처·초기 자금', () => {
    const lines = snapshotLines(simResultFixture({ capitalHidden: true }));
    expect(lines[0]).toBe('제목: 눌림목');
    expect(lines[3]).toMatch(/^시세 출처: KRX 일봉 · \d{4}\.\d{2}\.\d{2} \d{2}:\d{2} 받음$/);
    expect(lines[4]).toBe('초기 자금: 비공개');
    expect(snapshotLines(cmp, names)).toEqual(['제목: 반도체', '종목 4개: SK하이닉스(000660), 삼성전자(005930), 035420, 051910', '보기: 기간 1개월 · 지표 등락률 · 벤치마크 자동 · 정렬 값 순']);
    expect(snapshotLines(validationFixture()).at(-1)).toBe('초기 자금: 10,000,000원');
  });
});
```

`src/lib/sync/controller.test.ts` 끝에 더해요(`describeFail`을 import해요).

```ts
describe('describeFail', () => {
  it('too-large는 공유 요청이면 공유 문구, 프로필 동기화면 프로필 문구', () => {
    const f = { ok: false, kind: 'invalid', code: 'too-large' } as const;
    expect(describeFail(f, 'share')).toBe('공유 내용이 너무 커요(100 KB). 기간이나 종목을 줄여 주세요');
    expect(describeFail(f)).toBe('프로필이 너무 커요(256 KiB). 전략·그룹을 줄여 주세요.');
    expect(describeFail({ ok: false, kind: 'invalid', code: 'unsupported' }, 'share')).toBe('서버가 이 데이터를 받지 않았어요.');
  });
});
```

- [ ] **Step 2: 실패하는지 확인해요**

Run: `corepack pnpm --filter sync-worker test`
Expected: PASS일 수도 있어요(Task 2·3에서 검사가 이미 넓어졌으므로). 새 테스트가 바로 통과하면 그대로 두고 다음으로 가요. 실패하면 메시지를 읽고 Task 2·3 구현과 대조해요.

Run: `corepack pnpm test src/lib/share/shareText.test.ts src/lib/sync/controller.test.ts`
Expected: FAIL. `cardLines`·`compareViewText`가 없고, `describeFail(f, 'share')`가 프로필 문구를 돌려줘요.

- [ ] **Step 3: 구현해요**

`src/lib/sync/controller.svelte.ts`:

```ts
export const SHARE_TOO_LARGE_TEXT = '공유 내용이 너무 커요(100 KB). 기간이나 종목을 줄여 주세요';

/** ctx: 공유 요청이면 'share'. 422·413 too-large를 공유 한도(100 KB) 문구로 보인다(설계 7절) */
export const describeFail = (f: ApiFail, ctx: 'profile' | 'share' = 'profile'): string =>
  f.kind === 'limit' && f.code === 'share-limit'
    ? ERRORS['share-limit']
    : f.kind === 'invalid' && f.code === 'too-large'
      ? ctx === 'share'
        ? SHARE_TOO_LARGE_TEXT
        : ERRORS['too-large']
      : (ERRORS[f.kind] ?? ERRORS.server);
```

같은 파일의 `const ok = <T>(r: …): T | null => {` 를 `const ok = <T>(r: { ok: true; data: T } | ApiFail, ctx: 'profile' | 'share' = 'profile'): T | null => {`로 바꾸고 본문의 `describeFail(r)`를 `describeFail(r, ctx)`로 바꿔요. `createShare`의 `ok(await api.createShare(…))`를 `ok(await api.createShare(…), 'share')`로 바꿔요.

`src/lib/share/shareText.ts`(기존 `symbolNames`·`symbolList`·`won`·`on`은 그대로):

```ts
// 공유 스냅샷의 사람이 읽는 요약(만들기 미리 보기·읽기 화면·카카오 카드가 함께 쓴다).
import type { UniverseItem } from '../data/universe';
import { METRICS } from '../data/metricRegistry';
import type { Settings } from '../state/schema';
import { kstDate } from '../time/kst';
import { kstHHMM, periodLabel } from '../ui/compare/compareText';
import { trendPp } from '../ui/screen/screenText';
import { dotDate, fmtReturnPct, trendReturn } from '../ui/simulate/simText';
import type { CompareSnapshot, ShareSnapshot } from './snapshot';

// …SymbolNames·symbolNames·won·on·symbolList 그대로…

const BENCH = { AUTO: '자동', KOSPI: 'KOSPI', KOSDAQ: 'KOSDAQ' } as const;
const ORDER = { value: '값 순', mine: '내 순서' } as const;
const REBAL = { monthly: '매월', quarterly: '매 분기', semiannual: '반기마다' } as const;

export const metricLabel = (id: Settings['metric']): string => METRICS.find((m) => m.id === id)?.label ?? id;

/** `기간 1개월 · 지표 등락률 · 벤치마크 자동 · 정렬 값 순` */
export function compareViewText(v: CompareSnapshot['view']): string {
  return `기간 ${periodLabel(v.period)} · 지표 ${metricLabel(v.metric)} · 벤치마크 ${BENCH[v.benchmark]} · 정렬 ${ORDER[v.boardOrder]}`;
}

const nameOnly = (c: string, names?: SymbolNames) => names?.get(c) ?? c;
const firstNames = (symbols: string[], names?: SymbolNames, k = 3) => symbols.slice(0, k).map((c) => nameOnly(c, names)).join(', ');
const ym = (d: string) => d.slice(0, 7).replace('-', '.');

/** 카카오 카드 설명 두 줄(설계 4.5). line은 비교 화면 캡처가 준 둘째 줄 후보 */
export function cardLines(s: ShareSnapshot, names?: SymbolNames, line: string | null = null): string[] {
  switch (s.kind) {
    case 'group': {
      const n = s.symbols.length;
      return [`종목 ${n}개: ${firstNames(s.symbols, names)}${n > 3 ? ` 외 ${n - 3}개` : ''}`];
    }
    case 'strategy': {
      const st = s.strategy;
      const n = st.universe.kind === 'symbols' ? st.universe.symbols.length : 0;
      const drop = st.entry.decline.dropPct.on ? `${st.entry.decline.dropPct.value}%` : '끔';
      return [
        `종목 ${n}개 · ${dotDate(st.period.from)} ~ ${dotDate(st.period.to)}`,
        `하락 ${drop} · 익절 ${st.exit.takeProfit.map((t) => `${t.pct}%`).join('/')} · 손절 ${st.exit.stopLoss.pct}%`,
      ];
    }
    case 'criteria': {
      const c = s.criteria;
      return [`${c.pool.markets.join('·')} 상위 ${c.rank.take}개 · ${REBAL[c.rebalance]} 재선정`, `${dotDate(c.period.from)} ~ ${dotDate(c.period.to)}`];
    }
    case 'compare':
      return [`종목 ${s.symbols.length}개 · ${periodLabel(s.view.period)} ${metricLabel(s.view.metric)}`, line ?? firstNames(s.symbols, names)];
    case 'simResult': {
      const sum = s.result.summary;
      const demo = s.run.demo ? ' · 데모' : '';
      return [
        `총수익률 ${trendReturn(sum.totalReturnPct)} · 최대 낙폭 ${fmtReturnPct(sum.mddPct)}`,
        `종목 ${s.result.symbols.length}개 · 거래 ${sum.roundTrips}번 · ${dotDate(s.run.from)} ~ ${dotDate(s.run.to)}${demo}`,
      ];
    }
    case 'validation': {
      const hold = s.result.hold.stats.totalPct;
      const idx = s.result.indices[0]?.stats?.totalPct;
      const demo = s.run.demo ? ' · 데모' : '';
      return [
        `① 선정만 ${trendReturn(hold)}${idx === undefined ? '' : ` · 지수 대비 ${trendPp(hold - idx)}`}`,
        `상위 ${s.criteria.rank.take}개 · ${REBAL[s.criteria.rebalance]} · ${ym(s.run.from)} ~ ${ym(s.run.to)}${demo}`,
      ];
    }
  }
}

const fetched = (t: number) => `${dotDate(kstDate(t))} ${kstHHMM(t)} 받음`;
```

`snapshotLines`의 `switch`에 세 분기를 더해요(group·strategy·criteria 분기는 그대로).

```ts
    case 'compare':
      return [`제목: ${s.title}`, `종목 ${s.symbols.length}개: ${symbolList(s.symbols, names)}`, `보기: ${compareViewText(s.view)}`];
    case 'simResult':
    case 'validation': {
      const initial = s.kind === 'simResult' ? s.strategy.capital.initial : s.criteria.capital;
      return [`제목: ${s.title}`, ...cardLines(s, names), `시세 출처: ${s.run.source} · ${fetched(s.run.fetchedAt)}`, `초기 자금: ${s.capitalHidden ? '비공개' : won(initial)}`];
    }
```

`KIND` 맵 네 벌을 지워요.
- `src/lib/share/ShareDialog.svelte`: `const KIND = …` 줄을 지우고 `import { kindLabel } from './kinds';`. 시트 제목을 `title={request ? \`${kindLabel(request.kind)} 공유\` : '공유'}`로.
- `src/lib/share/kakao.ts`: `const KIND = …`를 지우고 `title: \`${kindLabel(snapshot.kind)} 공유: ${snapshot.title}\``.
- `src/routes/SharedView.svelte`: `const KIND = …`를 지우고 `{kindLabel(view.data.kind)} · {fmtDate(…)}까지 볼 수 있어요`.
- `src/lib/ui/settings/SyncManage.svelte`: `const KIND = …`를 지우고 `<small>{kindLabel(s.kind)}</small>`.

- [ ] **Step 4: 통과하는지 확인해요**

Run: `corepack pnpm test src/lib/share src/lib/sync src/routes/SharedView.test.ts src/lib/ui/settings`
Expected: PASS

Run: `corepack pnpm --filter sync-worker test && corepack pnpm --filter sync-worker check && corepack pnpm check`
Expected: 통과, 오류 0

- [ ] **Step 5: 커밋해요**

```bash
git add sync-worker/src/shares.test.ts src/lib/share/shareText.ts src/lib/share/shareText.test.ts src/lib/sync/controller.svelte.ts src/lib/sync/controller.test.ts src/lib/share/ShareDialog.svelte src/lib/share/kakao.ts src/routes/SharedView.svelte src/lib/ui/settings/SyncManage.svelte
git commit -m "feat(share): 새 공유 종류의 요약 문구와 공유용 크기 오류 문구를 더하고 종류 표시를 한곳으로 모음" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 7: 가져오기 대기 값·계획 함수·`leaveShared`

설계 1.5-7·11·14, 4.8(대기 값·흐름 2·계획 함수·이름·한도), 5.4, 6.2.

**Files:**
- Create: `src/lib/share/pendingImport.ts`, `src/lib/share/pendingImport.test.ts`
- Create: `src/lib/share/importPlan.ts`, `src/lib/share/importPlan.test.ts`
- Modify: `src/lib/state/app.svelte.ts` (`App.leaveShared`, 구현, 반환 객체)
- Test: `src/lib/state/app.test.ts` (`describe('leaveShared', …)` 추가)

**Interfaces:**
- Consumes: Task 2 `checkShareSnapshot(…, 'read')`·`cutUtf16`·`GroupSnapshot`·`StrategySnapshot`·`CriteriaSnapshot`·`CompareSnapshot`, Task 1 `isShareKind`·`ShareKind`, `withNewGroup`(`src/sheets/groupImport.ts`), `newBasket`·`sanitizeBaskets`·`MAX_BASKETS`·`BASKET_CAP_MESSAGE`(`src/lib/screen/baskets.ts`), `sanitizeCriteria`(`src/lib/screen/validate.ts`), `MAX_CRITERIA`(`src/lib/screen/defaults.ts`), `CRITERIA_CAP_MESSAGE`(`src/lib/screen/criteriaStore.ts`), `sanitizeStrategies`(`src/lib/sim/validate.ts`), `MAX_STRATEGIES`(`src/lib/sim/defaults.ts`), `STRATEGY_CAP_MESSAGE`(`src/lib/sim/strategyStore.ts`), `MAX_ITEMS`(`src/lib/state/watchlist.ts`), `jsonDiff`
- Produces:
  - `pendingImport.ts`:

```ts
export const IMPORT_KEY = 'gazua:v1:share-import';
export const IMPORT_DONE_KEY = 'gazua:v1:share-import-done';
export const IMPORT_TTL_MS = 30 * 60 * 1000;
export type ImportSnapshot = GroupSnapshot | StrategySnapshot | CriteriaSnapshot | CompareSnapshot;
export interface PendingImport { id: string; from: ShareKind; snapshot: ImportSnapshot; at: number }
export function importPart(s: ShareSnapshot): ImportSnapshot;
export function stashImport(snapshot: ShareSnapshot, now: number, store?: Storage | null): boolean;
export function peekImport(now: number, store?: Storage | null): PendingImport | null;
export function clearImport(store?: Storage | null): void;
export function wasImported(id: string, store?: Storage | null): boolean;
export function markImported(id: string, store?: Storage | null): void;
```

  - `importPlan.ts`: 설계 4.8의 `ImportState`, `ImportPlan`, `ImportApplied`, `ImportInput`, `planImport(p, cur)`, `applyImport(p, cur, opts)`, `uniqueName(base, taken, max = 30)` 그대로, 그리고 `IMPORT_NAME_MAX = 30`
  - `App.leaveShared(): void` — 공유 해시를 지우고 `enter()`와 같은 판단: 관문이 있으면 관문, 없고 `!settings.onboarded`면 온보딩, 아니면 비교

- [ ] **Step 1: 실패하는 테스트를 써요**

`src/lib/share/pendingImport.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { memoryBacking } from '../state/testStorage';
import { clearImport, IMPORT_KEY, IMPORT_TTL_MS, markImported, peekImport, stashImport, wasImported } from './pendingImport';
import { groupSnapshot } from './snapshot';
import { NOW, simResultFixture, validationFixture } from './testFixtures';

const g = groupSnapshot({ id: 'g', name: '반도체', items: [{ symbol: '005930', colorSlot: 1, hidden: false, addedAt: 1 }] });
const throwing = (): Storage =>
  ({
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
    removeItem: () => {
      throw new Error('blocked');
    },
  }) as unknown as Storage;

afterEach(() => clearImport(null));

describe('가져오기 대기 값', () => {
  it('넣고 읽어도 지우지 않고, clearImport가 지운다', () => {
    const store = memoryBacking();
    expect(stashImport(g, NOW, store)).toBe(true);
    const a = peekImport(NOW + 1000, store);
    expect(a).toMatchObject({ from: 'group', snapshot: g, at: NOW });
    expect(peekImport(NOW + 2000, store)?.id).toBe(a!.id);
    clearImport(store);
    expect(peekImport(NOW, store)).toBeNull();
  });

  it('30분이 지나면 지우고 null', () => {
    const store = memoryBacking();
    stashImport(g, NOW, store);
    expect(peekImport(NOW + IMPORT_TTL_MS + 1, store)).toBeNull();
    expect(store.getItem(IMPORT_KEY)).toBeNull();
  });

  it('망가진 JSON·종류가 맞지 않음·검사 실패는 지우고 null', () => {
    const store = memoryBacking();
    for (const bad of [
      '{',
      JSON.stringify({ id: 'x', from: 'group', snapshot: { ...g, kind: 'strategy' }, at: NOW }),
      JSON.stringify({ id: 'x', from: 'magic', snapshot: g, at: NOW }),
      JSON.stringify({ id: 'x', from: 'group', snapshot: { ...g, symbols: ['../x'] }, at: NOW }),
      JSON.stringify({ id: 'x', from: 'group', snapshot: { ...g, token: 1 }, at: NOW }),
    ]) {
      store.setItem(IMPORT_KEY, bad);
      expect(peekImport(NOW, store)).toBeNull();
      expect(store.getItem(IMPORT_KEY)).toBeNull();
    }
  });

  it('simResult는 strategy, validation은 criteria로 바꿔 규칙만 둔다', () => {
    const store = memoryBacking();
    const sim = simResultFixture();
    stashImport(sim, NOW, store);
    const a = peekImport(NOW, store)!;
    expect(a.from).toBe('simResult');
    expect(a.snapshot).toEqual({ kind: 'strategy', v: 1, title: sim.title, strategy: sim.strategy, capitalHidden: false });
    expect(store.getItem(IMPORT_KEY)!).not.toContain('"result"');
    const val = validationFixture({ capitalHidden: true });
    stashImport(val, NOW, store);
    expect(peekImport(NOW, store)!.snapshot).toEqual({ kind: 'criteria', v: 1, title: val.title, criteria: val.criteria, baskets: val.baskets, capitalHidden: true });
  });

  it('저장소가 던지면 메모리로 같은 탭 안에서 이어 간다', () => {
    const store = throwing();
    expect(stashImport(g, NOW, store)).toBe(false);
    expect(peekImport(NOW, store)?.snapshot).toEqual(g);
    clearImport(store);
    expect(peekImport(NOW, store)).toBeNull();
  });

  it('가져온 id는 최근 20개까지 기억한다(탭 복제 대비)', () => {
    const store = memoryBacking();
    for (let i = 0; i < 25; i++) markImported(`id-${i}`, store);
    expect(wasImported('id-24', store)).toBe(true);
    expect(wasImported('id-5', store)).toBe(true);
    expect(wasImported('id-4', store)).toBe(false);
    expect(wasImported('id-x', throwing())).toBe(false);
  });
});
```

`src/lib/share/importPlan.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BASKET_CAP_MESSAGE, newBasket } from '../screen/baskets';
import { CRITERIA_CAP_MESSAGE } from '../screen/criteriaStore';
import { newCriteria } from '../screen/defaults';
import { newStrategy } from '../sim/defaults';
import { STRATEGY_CAP_MESSAGE } from '../sim/strategyStore';
import { sanitizeStrategies } from '../sim/validate';
import { applyImport, planImport, uniqueName, type ImportInput, type ImportState } from './importPlan';
import type { ImportSnapshot } from './pendingImport';
import { criteriaSnapshot, strategySnapshot, type CompareSnapshot, type GroupSnapshot } from './snapshot';
import { NOW } from './testFixtures';

const state = (o: Partial<ImportState> = {}): ImportState => ({
  watchlists: { groups: [] },
  strategies: [],
  criteria: [],
  baskets: [],
  universe: null,
  ...o,
});
const input = (snapshot: ImportSnapshot, from: ImportInput['from'] = snapshot.kind): ImportInput => ({ snapshot, from });
const codes = (n: number) => Array.from({ length: n }, (_, i) => String(100000 + i));
const group = (symbols: string[], title = '반도체'): GroupSnapshot => ({ kind: 'group', v: 1, title, symbols });

describe('uniqueName', () => {
  it('충돌이 없으면 그대로, 있으면 2, 3…', () => {
    expect(uniqueName('반도체', new Set())).toBe('반도체');
    expect(uniqueName('반도체', new Set(['반도체']))).toBe('반도체 2');
    expect(uniqueName('반도체', new Set(['반도체', '반도체 2']))).toBe('반도체 3');
  });

  it('30자(UTF-16)를 넘지 않게 끝을 자르고 서로게이트 쌍을 반으로 자르지 않는다', () => {
    const long = 'a'.repeat(30);
    expect(uniqueName(long, new Set([long]))).toBe('a'.repeat(28) + ' 2');
    const emoji = 'a'.repeat(27) + '😀'; // 29
    const n = uniqueName(emoji, new Set([emoji]));
    expect(n).toBe('a'.repeat(27) + ' 2');
    expect(n.length).toBeLessThanOrEqual(30);
    const s = newStrategy(NOW, null, n);
    expect(sanitizeStrategies({ strategies: [s] }, NOW).repaired).toBe(false);
  });
});

describe('planImport / applyImport', () => {
  it('그룹: 50종목이면 앞에서 10개 + 안내, 종목 목록에 없는 코드는 빼고 개수를 알린다', () => {
    const symbols = codes(50);
    const universe = new Set(symbols.filter((_, i) => i !== 1 && i !== 2));
    const p = planImport(input(group(symbols)), state({ universe }));
    expect(p.blocked).toBeNull();
    expect(p.lines).toEqual(['그룹 「반도체」 · 종목 10개']);
    expect(p.notes).toEqual(['종목 목록에 없는 종목 2개는 뺐어요', '상위 10개만 넣었어요']);
    const a = applyImport(input(group(symbols)), state({ universe }), { now: NOW, applyView: true });
    const made = a.watchlists!.groups[0];
    expect(made.items.map((i) => i.symbol)).toEqual([symbols[0], ...symbols.slice(3, 12)]);
    expect(a.route).toEqual({ name: 'compare', groupId: made.id });
    expect(made.id).not.toBe('shared');
  });

  it('그룹: 종목 목록이 null이면 거르지 않고, 남는 종목이 없으면 막는다', () => {
    expect(planImport(input(group(['999999'])), state()).blocked).toBeNull();
    expect(planImport(input(group(['999999'])), state({ universe: new Set(['005930']) })).blocked).toBe('가져올 수 있는 종목이 없어요');
  });

  it('그룹: 같은 이름이 있으면 2를 붙여 안내한다', () => {
    const cur = state({ watchlists: { groups: [{ id: 'g1', name: '반도체', items: [] }] } });
    const p = planImport(input(group(['005930'])), cur);
    expect(p.lines).toEqual(['그룹 「반도체 2」 · 종목 1개']);
    expect(p.notes).toContain('같은 이름이 있어 「반도체 2」로 저장해요');
  });

  it('비교 화면: 보기 설정은 체크했을 때만, 바뀌는 키는 네 개뿐', () => {
    const cmp: CompareSnapshot = { kind: 'compare', v: 1, title: '반도체', symbols: ['005930'], view: { period: { unit: 'M', n: 3 }, metric: 'rsi', benchmark: 'KOSDAQ', boardOrder: 'mine' } };
    expect(planImport(input(cmp), state()).view).toEqual(cmp.view);
    const on = applyImport(input(cmp), state(), { now: NOW, applyView: true });
    expect(on.settings).toEqual({ period: { unit: 'M', n: 3 }, metric: 'rsi', benchmark: 'KOSDAQ', boardOrder: 'mine' });
    expect(Object.keys(on.settings!).sort()).toEqual(['benchmark', 'boardOrder', 'metric', 'period']);
    expect(applyImport(input(cmp), state(), { now: NOW, applyView: false }).settings).toBeUndefined();
  });

  it('전략: 20개면 막고, 새 ID·updatedAt, 자금 숨김 안내, 결과에서 왔으면 결과 안내', () => {
    const snap = strategySnapshot(newStrategy(NOW, null, '눌림목'), { groups: [] }, { hideCapital: true, now: NOW });
    const full = state({ strategies: Array.from({ length: 20 }, (_, i) => newStrategy(NOW, null, `s${i}`)) });
    expect(planImport(input(snap), full).blocked).toBe(STRATEGY_CAP_MESSAGE);
    expect(() => applyImport(input(snap), full, { now: NOW, applyView: true })).toThrow(STRATEGY_CAP_MESSAGE);
    const p = planImport(input(snap, 'simResult'), state());
    expect(p.lines).toEqual(['전략 「눌림목」']);
    expect(p.notes).toEqual(['초기 자금은 기본값으로 저장해요', '결과는 저장하지 않아요. 저장한 뒤 실행하면 내 데이터로 다시 계산해요']);
    const a = applyImport(input(snap, 'simResult'), state(), { now: NOW + 5, applyView: true });
    const made = a.strategies![0];
    expect(made.id).not.toBe('shared');
    expect(made.updatedAt).toBe(NOW + 5);
    expect(made.universe).toEqual(snap.strategy.universe);
    expect(a.route).toEqual({ name: 'simulate', strategyId: made.id });
  });

  it('전략: 정리 함수가 바꾸는 값이 있으면 저장하지 않는다', () => {
    const snap = strategySnapshot(newStrategy(NOW, null, '이상한 전략'), { groups: [] }, { hideCapital: false, now: NOW });
    snap.strategy.capital.perBuyPct = 0;
    expect(planImport(input(snap), state()).blocked).toBe('가져올 수 없는 공유예요');
  });

  it('기준: 묶음 b0·b1을 새 ID로 바꾸고, 같은 이름 묶음끼리도 겹치지 않게 한다', () => {
    const c = newCriteria(NOW, null, '대형');
    const b1 = newBasket(NOW, '반도체', ['005930']);
    const b2 = newBasket(NOW, '반도체', ['000660']);
    c.pool.baskets = [b1.id, b2.id];
    const snap = criteriaSnapshot(c, { baskets: [b1, b2], strategies: [] }, { hideCapital: false, now: NOW });
    const cur = state({ baskets: [newBasket(NOW, '반도체', ['035420'])] });
    const p = planImport(input(snap, 'validation'), cur);
    expect(p.lines).toEqual(['선정 기준 「대형」 · 묶음 2개']);
    expect(p.notes).toEqual([
      '같은 이름이 있어 「반도체 2」로 저장해요',
      '같은 이름이 있어 「반도체 3」로 저장해요',
      '② 매매 규칙은 함께 오지 않아요. 저장한 뒤 매매 규칙을 골라 주세요',
      '결과는 저장하지 않아요. 저장한 뒤 실행하면 내 데이터로 다시 계산해요',
    ]);
    const a = applyImport(input(snap, 'validation'), cur, { now: NOW, applyView: true });
    const added = a.baskets!.slice(1);
    expect(added.map((b) => b.name)).toEqual(['반도체 2', '반도체 3']);
    expect(a.criteria![0].pool.baskets).toEqual(added.map((b) => b.id));
    expect(a.route).toEqual({ name: 'simulate', tab: 'criteria', criteriaId: a.criteria![0].id });
  });

  it('기준: 묶음 29개 + 2개면 묶음 한도로, 기준 20개면 기준 한도로 막는다', () => {
    const c = newCriteria(NOW, null, '대형');
    const bs = [newBasket(NOW, 'a', ['005930']), newBasket(NOW, 'b', ['000660'])];
    c.pool.baskets = bs.map((b) => b.id);
    const snap = criteriaSnapshot(c, { baskets: bs, strategies: [] }, { hideCapital: false, now: NOW });
    const many = Array.from({ length: 29 }, (_, i) => newBasket(NOW, `m${i}`, ['005930']));
    expect(planImport(input(snap), state({ baskets: many })).blocked).toBe(BASKET_CAP_MESSAGE);
    const crit = Array.from({ length: 20 }, (_, i) => newCriteria(NOW, null, `c${i}`));
    expect(planImport(input(snap), state({ criteria: crit })).blocked).toBe(CRITERIA_CAP_MESSAGE);
  });
});
```

`src/lib/state/app.test.ts` 끝에 더해요.

```ts
describe('leaveShared', () => {
  const SHARED = `#/s/${'a'.repeat(43)}`;

  it('프로필이 여럿이면 프로필 선택으로 가고 공유 해시를 지운다', () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_TWO);
    seed(backing, 'p:p1:settings', { onboarded: true });
    location.hash = SHARED;
    const app = make(backing);
    expect(app.route.name).toBe('shared');
    app.leaveShared();
    expect(app.route.name).toBe('profiles');
    expect(location.hash.startsWith('#/s/')).toBe(false);
  });

  it('잠금이면 잠금 해제로', async () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_ONE);
    seed(backing, 'p:p1:settings', { onboarded: true, provider: 'kis', proxyUrl: 'https://proxy.test', keyLock: true });
    seed(backing, 'p:p1:secrets', await lockSecrets(SECRETS, 'correct horse'));
    location.hash = SHARED;
    const app = make(backing);
    app.leaveShared();
    expect(app.route.name).toBe('unlock');
    expect(location.hash.startsWith('#/s/')).toBe(false);
  });

  it('첫 실행(onboarded false)이면 온보딩으로', () => {
    const backing = memoryBacking();
    location.hash = SHARED;
    const app = make(backing);
    app.leaveShared();
    expect(app.route.name).toBe('onboarding');
    expect(location.hash).toBe('#/onboarding');
  });

  it('관문·온보딩이 없으면 비교 화면으로', () => {
    const backing = memoryBacking();
    seed(backing, 'meta', META_ONE);
    seed(backing, 'p:p1:settings', { onboarded: true });
    seed(backing, 'p:p1:watchlists', lists('g1'));
    location.hash = SHARED;
    const app = make(backing);
    app.leaveShared();
    expect(app.route).toEqual({ name: 'compare', groupId: 'g1' });
    expect(location.hash).toBe('#/compare/g1');
  });
});
```

- [ ] **Step 2: 실패하는지 확인해요**

Run: `corepack pnpm test src/lib/share/pendingImport.test.ts src/lib/share/importPlan.test.ts src/lib/state/app.test.ts`
Expected: FAIL. 두 모듈이 없고, `app.leaveShared is not a function`.

- [ ] **Step 3: 구현해요**

`src/lib/share/pendingImport.ts`:

```ts
// 가져오기 대기 값(설계 4.8). SharedView가 넣고, 관문·온보딩을 지난 뒤 ImportHost가 읽는다.
// sessionStorage는 같은 탭의 다른 스크립트도 쓸 수 있으므로 읽을 때마다 다시 검사하고 30분 뒤 버린다(설계 1.5-7).
import { isShareKind, type ShareKind } from './kinds';
import { checkShareSnapshot, type CompareSnapshot, type CriteriaSnapshot, type GroupSnapshot, type ShareSnapshot, type StrategySnapshot } from './snapshot';

export const IMPORT_KEY = 'gazua:v1:share-import';
export const IMPORT_DONE_KEY = 'gazua:v1:share-import-done';
export const IMPORT_TTL_MS = 30 * 60 * 1000;
const DONE_MAX = 20;

/** 가져올 수 있는 종류만 둔다. simResult는 strategy로, validation은 criteria로 바꿔 넣는다 */
export type ImportSnapshot = GroupSnapshot | StrategySnapshot | CriteriaSnapshot | CompareSnapshot;
export interface PendingImport {
  /** 이 가져오기를 구별하는 무작위 값(탭 복제로 두 번 저장되지 않게) */
  id: string;
  /** 원래 받은 종류(확인 창 안내에 쓴다) */
  from: ShareKind;
  snapshot: ImportSnapshot;
  at: number;
}

/** 저장소를 쓸 수 없는 환경(사생활 보호 등)에서 같은 탭 안 이동을 잇는 값 */
let memory: string | null = null;

const session = (): Storage | null => {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
};
const local = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

const EXPECT: Record<ShareKind, ImportSnapshot['kind']> = {
  group: 'group',
  strategy: 'strategy',
  criteria: 'criteria',
  compare: 'compare',
  simResult: 'strategy',
  validation: 'criteria',
};

/** 결과 종류는 결과 부분을 버리고 규칙 부분만 남긴다(설계 1.5-14) */
export function importPart(s: ShareSnapshot): ImportSnapshot {
  switch (s.kind) {
    case 'simResult':
      return { kind: 'strategy', v: 1, title: s.title, strategy: s.strategy, capitalHidden: s.capitalHidden };
    case 'validation':
      return { kind: 'criteria', v: 1, title: s.title, criteria: s.criteria, baskets: s.baskets, capitalHidden: s.capitalHidden };
    default:
      return s;
  }
}

/** sessionStorage에 둔다. 쓰지 못하면 false(그때는 메모리 값으로 같은 탭 안에서만 이어 간다) */
export function stashImport(snapshot: ShareSnapshot, now: number, store: Storage | null = session()): boolean {
  const value: PendingImport = { id: crypto.randomUUID(), from: snapshot.kind, snapshot: importPart(snapshot), at: now };
  const json = JSON.stringify(value);
  memory = json;
  if (!store) return false;
  try {
    store.setItem(IMPORT_KEY, json);
    return true;
  } catch {
    return false;
  }
}

function parse(raw: string, now: number): PendingImport | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  const { id, from, snapshot, at } = v as Record<string, unknown>;
  if (typeof id !== 'string' || id === '' || id.length > 64) return null;
  if (!isShareKind(from) || typeof at !== 'number' || !(now - at >= 0 && now - at <= IMPORT_TTL_MS)) return null;
  const want = EXPECT[from];
  if (typeof snapshot !== 'object' || snapshot === null || (snapshot as { kind?: unknown }).kind !== want) return null;
  const c = checkShareSnapshot(snapshot, want, now, 'read');
  return c.ok ? { id, from, snapshot: c.snapshot as ImportSnapshot, at } : null;
}

/** 지우지 않고 읽는다. 30분이 지났거나 종류가 맞지 않거나 검사에 실패하면 지우고 null */
export function peekImport(now: number, store: Storage | null = session()): PendingImport | null {
  let raw: string | null = null;
  try {
    raw = store ? store.getItem(IMPORT_KEY) : null;
  } catch {
    raw = null;
  }
  raw ??= memory;
  if (raw === null) return null;
  const p = parse(raw, now);
  if (!p) clearImport(store);
  return p;
}

/** 저장하거나 닫을 때 지운다 */
export function clearImport(store: Storage | null = session()): void {
  memory = null;
  try {
    store?.removeItem(IMPORT_KEY);
  } catch {
    // 지우지 못해도 30분 뒤 버린다
  }
}

function doneIds(store: Storage | null): string[] {
  try {
    const v: unknown = JSON.parse(store?.getItem(IMPORT_DONE_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function wasImported(id: string, store: Storage | null = local()): boolean {
  return doneIds(store).includes(id);
}

export function markImported(id: string, store: Storage | null = local()): void {
  try {
    store?.setItem(IMPORT_DONE_KEY, JSON.stringify([...doneIds(store).filter((x) => x !== id), id].slice(-DONE_MAX)));
  } catch {
    // 기록하지 못하면 탭 복제 방지만 빠진다
  }
}
```

`src/lib/share/importPlan.ts`:

```ts
// 받은 공유를 이 프로필에 새로 만드는 계획과 적용(설계 4.8). 순수 함수다: 저장은 ImportHost가 app.set*으로 한다.
import { withNewGroup } from '../../sheets/groupImport';
import { BASKET_CAP_MESSAGE, MAX_BASKETS, newBasket, sanitizeBaskets, type Basket } from '../screen/baskets';
import { CRITERIA_CAP_MESSAGE } from '../screen/criteriaStore';
import { MAX_CRITERIA } from '../screen/defaults';
import type { SelectionCriteria } from '../screen/types';
import { sanitizeCriteria } from '../screen/validate';
import { MAX_STRATEGIES } from '../sim/defaults';
import { STRATEGY_CAP_MESSAGE } from '../sim/strategyStore';
import type { Strategy } from '../sim/types';
import { sanitizeStrategies } from '../sim/validate';
import type { Route } from '../state/routes';
import type { Settings, Watchlists } from '../state/schema';
import { MAX_ITEMS } from '../state/watchlist';
import { jsonDiff } from '../sync/forbidden';
import type { ShareKind } from './kinds';
import type { ImportSnapshot } from './pendingImport';
import { cutUtf16, type CompareSnapshot, type CriteriaSnapshot } from './snapshot';

export const IMPORT_NAME_MAX = 30;
const UNREADABLE = '가져올 수 없는 공유예요';

export interface ImportState {
  watchlists: Watchlists;
  strategies: Strategy[];
  criteria: SelectionCriteria[];
  baskets: Basket[];
  /** 앱 종목 코드. 받지 못했으면 null(그때는 거르지 않는다) */
  universe: ReadonlySet<string> | null;
}
export interface ImportPlan {
  /** 만들 것 한 줄씩(바뀐 이름으로) */
  lines: string[];
  /** 이름 변경·자르기·뺀 종목·자금·결과 안내 */
  notes: string[];
  /** 저장할 수 없는 이유. 있으면 저장 단추를 끈다 */
  blocked: string | null;
  /** compare만: 적용할 수 있는 보기 설정 */
  view: CompareSnapshot['view'] | null;
}
export interface ImportApplied {
  watchlists?: Watchlists;
  strategies?: Strategy[];
  criteria?: SelectionCriteria[];
  baskets?: Basket[];
  settings?: Partial<Pick<Settings, 'period' | 'metric' | 'benchmark' | 'boardOrder'>>;
  route: Route;
}
/** 대기 값(PendingImport)의 snapshot·from. from은 확인 창 안내에만 쓴다 */
export interface ImportInput {
  snapshot: ImportSnapshot;
  from: ShareKind;
}

/**
 * base가 taken에 없으면 그대로, 있으면 ` 2`, ` 3`…을 붙인다. 붙인 결과가 max(UTF-16 길이, 저장 검사와 같은 기준)를 넘으면
 * 이름 끝을 잘라 맞추되 서로게이트 쌍을 반으로 자르지 않는다.
 */
export function uniqueName(base: string, taken: ReadonlySet<string>, max = IMPORT_NAME_MAX): string {
  const b = cutUtf16(base.trim(), max).trim() || '공유';
  if (!taken.has(b)) return b;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const name = cutUtf16(b, max - suffix.length).trimEnd() + suffix;
    if (!taken.has(name)) return name;
  }
}

const namesOf = (list: readonly { name: string }[]) => new Set(list.map((x) => x.name.trim()));

/** 종목 목록으로 거르고(null이면 거르지 않음) 앞에서 MAX_ITEMS개 */
function groupSymbols(symbols: readonly string[], universe: ReadonlySet<string> | null) {
  const known = universe ? symbols.filter((s) => universe.has(s)) : [...symbols];
  return { symbols: known.slice(0, MAX_ITEMS), unknown: symbols.length - known.length, cut: known.length > MAX_ITEMS };
}

/** 한 번의 가져오기로 만드는 묶음끼리도 겹치지 않게 차례로 taken에 더한다 */
function basketNames(s: CriteriaSnapshot, cur: ImportState): string[] {
  const taken = new Set(namesOf(cur.baskets));
  return s.baskets.map((b) => {
    const name = uniqueName(b.name, taken);
    taken.add(name);
    return name;
  });
}

const changed = (a: unknown, b: unknown) => b === undefined || jsonDiff(a, b) !== null;

export function planImport(p: ImportInput, cur: ImportState): ImportPlan {
  const s = p.snapshot;
  const lines: string[] = [];
  const notes: string[] = [];
  let blocked: string | null = null;
  let view: ImportPlan['view'] = null;
  const renamed = (base: string, name: string) => {
    if (name !== base) notes.push(`같은 이름이 있어 「${name}」로 저장해요`);
  };
  switch (s.kind) {
    case 'group':
    case 'compare': {
      const g = groupSymbols(s.symbols, cur.universe);
      if (g.symbols.length === 0) blocked = '가져올 수 있는 종목이 없어요';
      const name = uniqueName(s.title, namesOf(cur.watchlists.groups));
      lines.push(`그룹 「${name}」 · 종목 ${g.symbols.length}개`);
      renamed(s.title, name);
      if (g.unknown > 0) notes.push(`종목 목록에 없는 종목 ${g.unknown}개는 뺐어요`);
      if (g.cut) notes.push(`상위 ${MAX_ITEMS}개만 넣었어요`);
      if (s.kind === 'compare') view = { ...s.view, period: { ...s.view.period } };
      break;
    }
    case 'strategy': {
      const name = uniqueName(s.title, namesOf(cur.strategies));
      if (cur.strategies.length >= MAX_STRATEGIES) blocked = STRATEGY_CAP_MESSAGE;
      const next = { ...s.strategy, name };
      if (!blocked && changed(next, sanitizeStrategies({ strategies: [next] }, 0).strategies[0])) blocked = UNREADABLE;
      lines.push(`전략 「${name}」`);
      renamed(s.title, name);
      if (s.capitalHidden) notes.push('초기 자금은 기본값으로 저장해요');
      break;
    }
    case 'criteria': {
      const name = uniqueName(s.title, namesOf(cur.criteria));
      const bn = basketNames(s, cur);
      if (cur.criteria.length >= MAX_CRITERIA) blocked = CRITERIA_CAP_MESSAGE;
      else if (cur.baskets.length + s.baskets.length > MAX_BASKETS) blocked = BASKET_CAP_MESSAGE;
      if (!blocked) {
        const next = { ...s.criteria, name };
        const bs = s.baskets.map((b, i) => ({ id: b.id, name: bn[i], updatedAt: 0, symbols: b.symbols }));
        if (changed(next, sanitizeCriteria({ criteria: [next] }, 0).criteria[0]) || sanitizeBaskets({ baskets: bs }).repaired) blocked = UNREADABLE;
      }
      lines.push(s.baskets.length ? `선정 기준 「${name}」 · 묶음 ${s.baskets.length}개` : `선정 기준 「${name}」`);
      renamed(s.title, name);
      s.baskets.forEach((b, i) => renamed(b.name, bn[i]));
      if (s.capitalHidden) notes.push('초기 자금은 기본값으로 저장해요');
      break;
    }
  }
  if (p.from === 'validation') notes.push('② 매매 규칙은 함께 오지 않아요. 저장한 뒤 매매 규칙을 골라 주세요');
  if (p.from === 'simResult' || p.from === 'validation') notes.push('결과는 저장하지 않아요. 저장한 뒤 실행하면 내 데이터로 다시 계산해요');
  return { lines, notes, blocked, view };
}

/** planImport가 막지 않은 경우에만 부른다. 막힌 계획이면 던진다. 늘 새로 만들고 기존 것을 덮어쓰지 않는다 */
export function applyImport(p: ImportInput, cur: ImportState, opts: { now: number; applyView: boolean }): ImportApplied {
  const plan = planImport(p, cur);
  if (plan.blocked) throw new Error(plan.blocked);
  const s = p.snapshot;
  switch (s.kind) {
    case 'group':
    case 'compare': {
      const { symbols } = groupSymbols(s.symbols, cur.universe);
      const { watchlists, groupId } = withNewGroup(cur.watchlists, uniqueName(s.title, namesOf(cur.watchlists.groups)), symbols, opts.now);
      const settings = s.kind === 'compare' && opts.applyView ? { ...s.view, period: { ...s.view.period } } : undefined;
      return { watchlists, ...(settings && { settings }), route: { name: 'compare', groupId } };
    }
    case 'strategy': {
      const strategy: Strategy = { ...structuredClone(s.strategy), id: crypto.randomUUID(), name: uniqueName(s.title, namesOf(cur.strategies)), updatedAt: opts.now };
      return { strategies: [...cur.strategies, strategy], route: { name: 'simulate', strategyId: strategy.id } };
    }
    case 'criteria': {
      const bn = basketNames(s, cur);
      const ids = new Map<string, string>();
      const baskets = s.baskets.map((b, i) => {
        const made = newBasket(opts.now, bn[i], [...b.symbols]);
        ids.set(b.id, made.id);
        return made;
      });
      const c = structuredClone(s.criteria);
      const criteria: SelectionCriteria = {
        ...c,
        id: crypto.randomUUID(),
        name: uniqueName(s.title, namesOf(cur.criteria)),
        updatedAt: opts.now,
        pool: { ...c.pool, baskets: c.pool.baskets.map((id) => ids.get(id)!) },
      };
      return { baskets: [...cur.baskets, ...baskets], criteria: [...cur.criteria, criteria], route: { name: 'simulate', tab: 'criteria', criteriaId: criteria.id } };
    }
  }
}
```

`src/lib/state/app.svelte.ts`:
- `App` 인터페이스의 `navigate(r: Route): void;` 위에 더해요.

```ts
  /**
   * 공유 읽기 화면(#/s/…)에서 앱으로 나간다. 공유 해시를 지우고 enter()와 같은 판단을 한다:
   * 관문(프로필 선택·잠금 해제)이 있으면 관문, 없고 첫 실행이면 온보딩, 아니면 비교 화면(설계 1.5-11).
   */
  leaveShared(): void;
```

- `navigate` 함수 아래에 구현을 두고, 반환 객체의 `navigate,` 옆에 `leaveShared,`를 더해요.

```ts
  function leaveShared() {
    // 관문이 있으면 navigate가 관문 화면으로 두고 공유 해시를 지운다(관문을 마친 뒤 enter()가 온보딩까지 본다)
    if (gate()) return navigate({ name: 'compare' });
    navigate(settings.onboarded ? { name: 'compare' } : { name: 'onboarding' });
  }
```

`src/App.svelte`의 SharedView `onexit`을 `onexit={() => app.leaveShared()}`로 바꿔요(「가즈아 열기」 단추도 같은 길로 가요).

- [ ] **Step 4: 통과하는지 확인해요**

Run: `corepack pnpm test src/lib/share src/lib/state`
Expected: PASS

Run: `corepack pnpm check`
Expected: 오류 0

- [ ] **Step 5: 커밋해요**

```bash
git add src/lib/share/pendingImport.ts src/lib/share/pendingImport.test.ts src/lib/share/importPlan.ts src/lib/share/importPlan.test.ts src/lib/state/app.svelte.ts src/lib/state/app.test.ts src/App.svelte
git commit -m "feat(share): 받은 공유를 가져오는 대기 값·계획·적용 함수와 공유 화면에서 나가는 길을 더함" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Task 8: 가져오기 확인 창(ImportHost)과 App 연결

설계 1.3-1-1·8, 4.8(흐름 3~5, 이동 표, 탭 복제·되돌리기), 7절(가져오기 오류), 8절(Sheet·alert·포커스), 6.3(`ImportHost.test.ts`·axe).

**Files:**
- Create: `src/lib/share/inApp.ts`, `src/lib/share/inApp.test.ts`
- Create: `src/lib/share/testAxe.ts`
- Create: `src/lib/share/ImportHost.svelte`, `src/lib/share/ImportHost.test.ts`
- Modify: `src/App.svelte` (`<ImportHost {app} />`)
- Modify: `package.json`, `pnpm-lock.yaml` (`axe-core` 개발 의존성)

**Interfaces:**
- Consumes: Task 7 `peekImport`·`clearImport`·`wasImported`·`markImported`·`PendingImport`, `planImport`·`applyImport`·`ImportState`·`ImportPlan`, Task 6 `compareViewText`, `sharedUniverse`(`src/sheets/universeSource.ts`), `App`(`setBaskets`·`setCriteria`·`setStrategies`·`setWatchlists`·`updateSettings`·`navigate`·`route`·`meta`)
- Produces:
  - `inApp.ts`: `isKakaoInApp(ua: string): boolean`, `isIos(ua: string): boolean`, `openExternalHref(href: string): string`
  - `testAxe.ts`: `expectNoAxeViolations(container: Element): Promise<void>`
  - `ImportHost.svelte` props: `{ app: App; universe?: () => Promise<UniverseItem[]>; ua?: string; now?: () => number }`

- [ ] **Step 1: 개발 의존성을 더해요**

Run: `corepack pnpm add -D axe-core@4.13.0`
Expected: `package.json` devDependencies에 `"axe-core": "4.13.0"`이 생기고 lockfile이 바뀌어요(`@axe-core/playwright`가 이미 같은 버전을 끌어와 새로 받는 것은 없어요).

- [ ] **Step 2: 실패하는 테스트를 써요**

`src/lib/share/inApp.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isIos, isKakaoInApp, openExternalHref } from './inApp';

const ANDROID_KAKAO = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 KAKAOTALK 10.8.0';
const IOS_KAKAO = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 KAKAOTALK 10.8.0';

describe('인앱 판정', () => {
  it('UA에 KAKAOTALK이 있으면 인앱, iPhone·iPad면 iOS', () => {
    expect(isKakaoInApp(ANDROID_KAKAO)).toBe(true);
    expect(isKakaoInApp('Mozilla/5.0 Chrome/120')).toBe(false);
    expect(isIos(IOS_KAKAO)).toBe(true);
    expect(isIos(ANDROID_KAKAO)).toBe(false);
  });
  it('기본 브라우저로 여는 주소', () => {
    expect(openExternalHref('https://a.test/#/s/abc')).toBe('kakaotalk://web/openExternal?url=https%3A%2F%2Fa.test%2F%23%2Fs%2Fabc');
  });
});
```

`src/lib/share/ImportHost.test.ts`:

```ts
// @vitest-environment jsdom
import { currentSnackbar, dismissSnackbar } from '@sch0718/ui-svelte';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { itemsOf, makeTestApp } from '../../sheets/testApp';
import { newStrategy } from '../sim/defaults';
import { STRATEGY_CAP_MESSAGE } from '../sim/strategyStore';
import type { App } from '../state/app.svelte';
import { compareSnapshot } from './compact';
import ImportHost from './ImportHost.svelte';
import { clearImport, markImported, peekImport, stashImport } from './pendingImport';
import { groupSnapshot, strategySnapshot } from './snapshot';
import { expectNoAxeViolations } from './testAxe';
import { NOW, validationFixture } from './testFixtures';

let apps: App[] = [];
const universe = async () => ['005930', '000660'].map((s) => ({ s, n: s, m: 'KOSPI', t: 'STOCK' as const }));
const g = groupSnapshot({ id: 'x', name: '반도체', items: itemsOf(['005930', '000660']) });
const TITLE = '이 프로필에 저장할까요?';

function setup(o: { onboarded?: boolean; ua?: string } = {}) {
  const app = makeTestApp({ groups: [{ id: 'g1', name: '기존', items: [] }], now: NOW, settings: { onboarded: o.onboarded ?? true } });
  apps.push(app);
  render(ImportHost, { app, universe, now: () => NOW, ua: o.ua ?? 'Mozilla/5.0' });
  return app;
}
afterEach(() => {
  for (const a of apps) a.destroy();
  apps = [];
  clearImport();
  localStorage.clear();
  dismissSnackbar();
});

describe('ImportHost', () => {
  it('관문·온보딩 화면에서는 열리지 않고 대기 값이 남는다. 일반 화면이 되면 연다', async () => {
    stashImport(g, NOW);
    const app = setup({ onboarded: false });
    expect(app.route.name).toBe('onboarding');
    await tick();
    expect(screen.queryByText(TITLE)).toBeNull();
    expect(peekImport(NOW)).not.toBeNull();
    app.updateSettings({ onboarded: true });
    app.navigate({ name: 'compare' });
    expect(await screen.findByText(TITLE)).toBeTruthy();
    expect(screen.getByText('「내 프로필」 프로필에 저장해요')).toBeTruthy();
    expect(screen.getByRole('list', { name: '만들 것' }).textContent).toContain('그룹 「반도체」 · 종목 2개');
  });

  it('저장하면 새 그룹을 만들고 그 비교 화면으로 가며 대기 값을 지운다', async () => {
    stashImport(g, NOW);
    const app = setup();
    await fireEvent.click(await screen.findByRole('button', { name: '저장' }));
    const made = app.watchlists.groups.find((x) => x.name === '반도체')!;
    expect(made.items.map((i) => i.symbol)).toEqual(['005930', '000660']);
    expect(app.route).toEqual({ name: 'compare', groupId: made.id });
    expect(peekImport(NOW)).toBeNull();
    expect(currentSnackbar()?.message).toBe('가져왔어요');
  });

  it('비교 화면: 보기 설정 체크를 끄면 설정은 그대로다', async () => {
    const cmp = compareSnapshot({ id: 'x', name: '반도체', items: itemsOf(['005930']) }, { period: { unit: 'M', n: 6 }, metric: 'rsi', benchmark: 'KOSDAQ', boardOrder: 'mine' });
    stashImport(cmp, NOW);
    const app = setup();
    const before = { ...app.settings };
    const check = (await screen.findByLabelText('보기 설정도 적용')) as HTMLInputElement;
    expect(check.checked).toBe(true);
    expect(screen.getByText('기간 6개월 · 지표 RSI(14) · 벤치마크 KOSDAQ · 정렬 내 순서', { exact: false })).toBeTruthy();
    await fireEvent.click(check);
    await fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(app.settings.period).toEqual(before.period);
    expect(app.settings.metric).toBe(before.metric);
  });

  it('검증 결과에서 온 기준: ②·결과 안내, 저장하면 기준 편집으로 간다', async () => {
    stashImport(validationFixture(), NOW);
    const app = setup();
    expect(await screen.findByText('② 매매 규칙은 함께 오지 않아요. 저장한 뒤 매매 규칙을 골라 주세요')).toBeTruthy();
    expect(screen.getByText('결과는 저장하지 않아요. 저장한 뒤 실행하면 내 데이터로 다시 계산해요')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: '저장' }));
    const c = app.criteria.find((x) => x.name === '대형 우량')!;
    expect(app.baskets.map((b) => b.id)).toEqual(c.pool.baskets);
    expect(app.route).toEqual({ name: 'simulate', tab: 'criteria', criteriaId: c.id });
  });

  it('한도로 막히면 이유를 alert로 보이고 저장 단추 대신 닫기만 둔다', async () => {
    const app = setup();
    app.setStrategies(Array.from({ length: 20 }, (_, i) => newStrategy(NOW, null, `s${i}`)));
    stashImport(strategySnapshot(newStrategy(NOW, null, '눌림목'), app.watchlists, { hideCapital: false, now: NOW }), NOW);
    app.navigate({ name: 'simulate' });
    expect((await screen.findByRole('alert')).textContent).toBe(STRATEGY_CAP_MESSAGE);
    expect(screen.queryByRole('button', { name: '저장' })).toBeNull();
    expect(screen.getByText('목록을 정리한 뒤 공유 링크를 다시 열면 가져올 수 있어요')).toBeTruthy();
  });

  it('저장하지 않기: 아무것도 만들지 않고 대기 값을 지워 다시 열리지 않는다', async () => {
    stashImport(g, NOW);
    const app = setup();
    await fireEvent.click(await screen.findByRole('button', { name: '저장하지 않기' }));
    expect(app.watchlists.groups.map((x) => x.name)).toEqual(['기존']);
    expect(peekImport(NOW)).toBeNull();
    app.navigate({ name: 'settings' });
    await tick();
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it('이미 가져온 대기 값(탭 복제)은 창 대신 스낵바', async () => {
    stashImport(g, NOW);
    markImported(peekImport(NOW)!.id);
    setup();
    await waitFor(() => expect(currentSnackbar()?.message).toBe('이미 가져왔어요'));
    expect(screen.queryByText(TITLE)).toBeNull();
    expect(peekImport(NOW)).toBeNull();
  });

  it('카카오톡 인앱이면 이 브라우저에 저장된다고 먼저 알린다', async () => {
    stashImport(g, NOW);
    setup({ ua: 'Mozilla/5.0 (Linux; Android 14) KAKAOTALK 10.8.0' });
    expect(await screen.findByText('지금 이 브라우저(카카오톡)에 저장돼요')).toBeTruthy();
  });

  it('axe 위반이 없다', async () => {
    stashImport(g, NOW);
    setup();
    await screen.findByText(TITLE);
    await expectNoAxeViolations(document.body);
  });
});
```

- [ ] **Step 3: 실패하는지 확인해요**

Run: `corepack pnpm test src/lib/share/inApp.test.ts src/lib/share/ImportHost.test.ts`
Expected: FAIL. `./inApp`·`./ImportHost.svelte`·`./testAxe`가 없어요.

- [ ] **Step 4: 구현해요**

`src/lib/share/inApp.ts`:

```ts
// 카카오톡 인앱 브라우저 안내(사용자 결정 8, 설계 4.7). 인앱에서도 가져오기는 막지 않는다.
export const isKakaoInApp = (ua: string): boolean => /KAKAOTALK/i.test(ua);
export const isIos = (ua: string): boolean => /iPhone|iPad/.test(ua);
/** 카카오 공식 문서에는 없고 개발자 포럼·여러 서비스가 쓰는 관용 스킴이다. 동작은 docs/live-check.md에서 확인한다 */
export const openExternalHref = (href: string): string => `kakaotalk://web/openExternal?url=${encodeURIComponent(href)}`;
```

`src/lib/share/testAxe.ts`:

```ts
// 테스트 전용: jsdom에서 axe를 돌린다. e2e(tests/e2e/a11y.spec.ts)와 같은 태그만 보고, jsdom은 색을 계산하지 않으므로 대비 규칙은 끈다.
import axe from 'axe-core';
import { expect } from 'vitest';

export async function expectNoAxeViolations(container: Element): Promise<void> {
  const r = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    rules: { 'color-contrast': { enabled: false } },
  });
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' ; ')}`)).toEqual([]);
}
```

`src/lib/share/ImportHost.svelte`:

```svelte
<script lang="ts">
  // 받은 공유 가져오기 확인 창(설계 4.8). 관문·온보딩을 지나 일반 화면이 되면 대기 값을 읽어 연다.
  // 확인 없이는 아무것도 저장하지 않고, 기존 데이터를 덮어쓰지 않고 늘 새로 만든다(설계 5.4).
  import { Sheet, showSnackbar } from '@sch0718/ui-svelte';
  import { tick, untrack } from 'svelte';
  import type { UniverseItem } from '../data/universe';
  import type { App } from '../state/app.svelte';
  import type { RouteName } from '../state/routes';
  import { sharedUniverse } from '../../sheets/universeSource';
  import { applyImport, planImport, type ImportApplied, type ImportPlan, type ImportState } from './importPlan';
  import { isKakaoInApp } from './inApp';
  import { clearImport, markImported, peekImport, wasImported, type PendingImport } from './pendingImport';
  import { compareViewText } from './shareText';

  let {
    app,
    universe = sharedUniverse,
    ua = globalThis.navigator?.userAgent ?? '',
    now = Date.now,
  }: {
    app: App;
    universe?: () => Promise<UniverseItem[]>;
    ua?: string;
    now?: () => number;
  } = $props();

  /** 관문(profiles·unlock)·온보딩·공유 화면에서는 열지 않는다 */
  const NORMAL: readonly RouteName[] = ['compare', 'simulate', 'performance', 'settings', 'help'];

  let pending = $state.raw<PendingImport | null>(null);
  let plan = $state.raw<ImportPlan | null>(null);
  let codes = $state.raw<ReadonlySet<string> | null>(null);
  let applyView = $state(true);
  let loading = false;

  const current = (): ImportState => ({ watchlists: app.watchlists, strategies: app.strategies, criteria: app.criteria, baskets: app.baskets, universe: codes });
  const profileName = $derived(app.meta.profiles.find((p) => p.id === app.meta.activeProfileId)?.name ?? '');

  $effect(() => {
    const name = app.route.name;
    if (!NORMAL.includes(name)) return;
    untrack(() => {
      if (pending || loading) return;
      const p = peekImport(now());
      if (!p) return;
      if (wasImported(p.id)) {
        clearImport();
        showSnackbar('이미 가져왔어요');
        return;
      }
      loading = true;
      universe()
        .then(
          (items) => new Set(items.map((u) => u.s)),
          () => null,
        )
        .then((set) => {
          loading = false;
          codes = set;
          applyView = true;
          plan = planImport(p, current());
          pending = p;
        });
    });
  });

  function close() {
    clearImport();
    pending = null;
    plan = null;
  }

  /** 이동한 화면의 첫 제목으로 포커스(설계 8절) */
  async function focusLanding() {
    await tick();
    const h = document.querySelector<HTMLElement>('main h1') ?? document.querySelector<HTMLElement>('main h2') ?? document.querySelector<HTMLElement>('h1, h2');
    if (!h) return;
    if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1');
    h.focus();
  }

  function write(applied: ImportApplied, before: ImportState) {
    // 묶음 → 기준 순서. 기준 쓰기가 실패하면 방금 더한 묶음을 되돌린다(설계 4.8)
    if (applied.baskets) app.setBaskets(applied.baskets);
    try {
      if (applied.criteria) app.setCriteria(applied.criteria);
    } catch (e) {
      if (applied.baskets) app.setBaskets(before.baskets);
      throw e;
    }
    if (applied.strategies) app.setStrategies(applied.strategies);
    if (applied.watchlists) app.setWatchlists(applied.watchlists);
    if (applied.settings) app.updateSettings(applied.settings);
  }

  function save() {
    const p = pending;
    if (!p || !plan || plan.blocked) return;
    // 두 탭이 함께 창을 띄운 경우: 쓰기 직전에 한 번 더 본다
    if (wasImported(p.id)) {
      close();
      showSnackbar('이미 가져왔어요');
      return;
    }
    const before = current();
    try {
      const applied = applyImport(p, before, { now: now(), applyView });
      write(applied, before);
      markImported(p.id);
      close();
      app.navigate(applied.route);
      showSnackbar('가져왔어요');
      void focusLanding();
    } catch {
      showSnackbar('가져오지 못했어요');
    }
  }
</script>

<Sheet open={pending !== null && plan !== null} title="이 프로필에 저장할까요?" onclose={close}>
  {#if pending && plan}
    <div class="imp">
      {#if isKakaoInApp(ua)}<p class="where">지금 이 브라우저(카카오톡)에 저장돼요</p>{/if}
      <p>「{profileName}」 프로필에 저장해요</p>
      <ul class="lines" aria-label="만들 것">
        {#each plan.lines as line (line)}<li>{line}</li>{/each}
      </ul>
      {#if plan.notes.length > 0}
        <ul class="notes" aria-label="안내">
          {#each plan.notes as note (note)}<li>{note}</li>{/each}
        </ul>
      {/if}
      {#if plan.view}
        <label class="check">
          <input type="checkbox" bind:checked={applyView} />
          보기 설정도 적용
        </label>
        <p class="sub">{compareViewText(plan.view)}</p>
      {/if}
      {#if plan.blocked}
        <p class="err" role="alert">{plan.blocked}</p>
        <p class="sub">목록을 정리한 뒤 공유 링크를 다시 열면 가져올 수 있어요</p>
        <button type="button" class="primary" onclick={close}>닫기</button>
      {:else}
        <button type="button" class="primary" onclick={save}>저장</button>
        <button type="button" class="ghost" onclick={close}>저장하지 않기</button>
      {/if}
    </div>
  {/if}
</Sheet>

<style>
  .imp {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 0 20px 8px;
    font-size: var(--fs-body);
  }
  .where {
    font-weight: 700;
  }
  .lines,
  .notes {
    background: var(--surface2);
    border-radius: 12px;
    padding: 10px 14px 10px 28px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .notes,
  .sub {
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: var(--touch);
  }
  .err {
    color: var(--err);
  }
  .primary,
  .ghost {
    min-height: var(--touch);
    border-radius: 12px;
    font-weight: 700;
  }
  .primary {
    background: var(--accent);
    color: var(--on-accent);
  }
  .ghost {
    background: var(--surface2);
  }
</style>
```

`src/App.svelte`: `import ImportHost from './lib/share/ImportHost.svelte';`를 더하고, 맨 아래 `<ShareHost />` 다음 줄에 `<ImportHost {app} />`를 둬요.

- [ ] **Step 5: 통과하는지 확인해요**

Run: `corepack pnpm test src/lib/share src/routes`
Expected: PASS. axe 위반이 나오면 메시지의 규칙 id를 보고 마크업을 고쳐요(규칙을 끄지 않아요).

Run: `corepack pnpm check`
Expected: 오류 0

- [ ] **Step 6: 커밋해요**

```bash
git add package.json pnpm-lock.yaml src/lib/share/inApp.ts src/lib/share/inApp.test.ts src/lib/share/testAxe.ts src/lib/share/ImportHost.svelte src/lib/share/ImportHost.test.ts src/App.svelte
git commit -m "feat(share): 받은 공유를 이 프로필에 저장하는 확인 창을 더함" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 9: 결과 컴포넌트의 읽기 전용·금액 숨김·건너뜀 개수·솎기 안내

설계 2.6(받은 화면 표시), 4.7 「기존 컴포넌트에 더하는 것」, 8절(누를 수 없는 줄은 버튼이 아님), 6.3 마지막 줄.

**Files:**
- Modify: `src/lib/ui/simulate/ResultView.svelte`, `TradeList.svelte`, `SymbolTab.svelte`, `SkipList.svelte`, `EquityChart.svelte`
- Modify: `src/lib/ui/screen/ValidationResult.svelte`, `TodayPicks.svelte`
- Test: `src/lib/ui/simulate/ResultView.test.ts`, `TradeList.test.ts`, `src/lib/ui/screen/ValidationResult.test.ts`, `TodayPicks.test.ts` (기존 파일에 추가)

**Interfaces:**
- Consumes: 기존 `DoneState`, `Skip`, `skipCounts`·`skipReasonLabel`(`simText.ts`), `trendClass`·`fmtWon`(`src/lib/ui/format.ts`)
- Produces (새 prop, 모두 선택이고 기본값은 지금 동작):
  - `ResultView`: `onEdit?: (section?: Issue['section']) => void`, `readonly?: boolean`(기본 false), `hideAmounts?: boolean`(기본 false), `skippedCounts?: [Skip['reason'], number][]`, `pnlPct?: Record<string, number>`, `sampledNote?: string`
  - `TradeList`: `onTrade?: (t: Trade) => void`, `hideQty?: boolean`
  - `SymbolTab`: `pnlPct?: Record<string, number>`
  - `SkipList`: `counts?: [Skip['reason'], number][]`
  - `EquityChart`: `sampledNote?: string`
  - `ValidationResult`: `app: App | null`, `colorConvention?: 'kr' | 'global'`(없으면 `app?.settings.colorConvention ?? 'kr'`), `sampledNote?: string`
  - `TodayPicks`: `app: App | null`(null이면 목록만)

- [ ] **Step 1: 실패하는 테스트를 써요**

`src/lib/ui/simulate/ResultView.test.ts` 끝에 더해요.

```ts
describe('ResultView 읽기 전용(받은 공유)', () => {
  const view = (o: Record<string, unknown> = {}, state: DoneState = doneState()) => render(ResultView, { state, colorConvention: 'kr', readonly: true, ...o });

  it('규칙 고치기·거래 차트 시트가 없고 거래 줄은 버튼이 아니다', async () => {
    view({}, (() => {
      const s = doneState();
      noTrades(s, s.result.skipped);
      return s;
    })());
    expect(screen.queryByRole('button', { name: '규칙 고치기' })).toBeNull();
    const s2 = render(ResultView, { state: doneState(), colorConvention: 'kr', readonly: true });
    expect(within(s2.container).queryAllByRole('button', { name: /SK하이닉스/ })).toHaveLength(0);
    expect(within(s2.container).getAllByRole('listitem').length).toBeGreaterThan(0);
  });

  it('금액 숨김: 매수 줄은 가격만, 종목별은 자금 대비 %', async () => {
    view({ hideAmounts: true, pnlPct: { '005930': 1.41, '000660': -0.88 } });
    expect(screen.getByText('70,000원')).toBeTruthy();
    expect(screen.queryByText(/14주/)).toBeNull();
    await fireEvent.click(tab('종목별'));
    expect(screen.getByText('자금 대비 +1.41%')).toBeTruthy();
    expect(screen.getByText('자금 대비 −0.88%')).toBeTruthy();
  });

  it('건너뜀 목록 없이 개수만 받으면 탭 이름·본문·거래 0건 문구가 개수를 쓴다', async () => {
    const s = doneState();
    s.result.skipped = [];
    view({ skippedCounts: [['현금 부족', 1], ['1주가 1회 금액보다 비쌈', 2]] }, s);
    await fireEvent.click(tab('건너뛴 신호 3'));
    expect(screen.getByText('목록은 크기 때문에 빼고 보냈어요')).toBeTruthy();
    expect(screen.getByText('2번')).toBeTruthy();
    const z = doneState();
    noTrades(z, []);
    z.result.summary.skippedSignals = 3;
    render(ResultView, { state: z, colorConvention: 'kr', readonly: true, skippedCounts: [['현금 부족', 3]] });
    expect(screen.getByText('매수 신호가 3번 났지만 한 번도 사지 못했어요')).toBeTruthy();
  });

  it('솎은 곡선 안내를 차트 아래에 적는다', () => {
    view({ sampledNote: '곡선은 735점 중 120점으로 줄였어요 · 수치는 전체 기간 기준이에요' });
    expect(screen.getByText('곡선은 735점 중 120점으로 줄였어요 · 수치는 전체 기간 기준이에요')).toBeTruthy();
  });
});
```

`src/lib/ui/simulate/TradeList.test.ts` 끝에 더해요(파일의 기존 import·고정 데이터를 써요. 거래 고정 데이터 이름이 다르면 그 파일의 것을 써요).

```ts
describe('TradeList 읽기 전용', () => {
  it('onTrade가 없으면 줄이 버튼이 아니고 안내에서 「행을 눌러」를 뺀다', () => {
    const { container } = render(TradeList, { trades: doneState().result.trades, names: {} });
    expect(within(container).queryAllByRole('button')).toHaveLength(0);
    expect(container.textContent).toContain('매도 줄 %는 평균 단가 대비예요(수수료·세금 제외)');
    expect(container.textContent).not.toContain('행을 눌러');
  });
  it('hideQty면 수량 없이 가격만', () => {
    const { container } = render(TradeList, { trades: doneState().result.trades, names: {}, hideQty: true });
    expect(container.textContent).toContain('132,400원');
    expect(container.textContent).not.toContain('12주');
  });
});
```

(`TradeList.test.ts`에 `doneState`·`within` import가 없으면 `import { doneState } from './resultFixture';`, `within`을 더해요.)

`src/lib/ui/screen/ValidationResult.test.ts` 끝에 더해요.

```ts
describe('ValidationResult 읽기 전용(app 없음)', () => {
  it('app 없이 그리고, 오늘 선별에 그룹 만들기 단추가 없다. 색 관례는 prop으로 받는다', () => {
    render(ValidationResult, { app: null, colorConvention: 'global', result: validationResult(), names: {}, criteriaName: '반등 기준', capital: 10_000_000, flow: DEFAULT_FLOW, fin: DEFAULT_FIN, sampledNote: '곡선은 4점 중 3점으로 줄였어요 · 수치는 전체 기간 기준이에요' });
    expect(screen.getByRole('heading', { name: '오늘 기준 선별' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '관심 그룹으로 만들기' })).toBeNull();
    expect(screen.getByText('곡선은 4점 중 3점으로 줄였어요 · 수치는 전체 기간 기준이에요')).toBeTruthy();
  });
});
```

`src/lib/ui/screen/TodayPicks.test.ts` 끝에 더해요.

```ts
describe('TodayPicks 읽기 전용', () => {
  it('app이 null이면 목록만 보인다', () => {
    render(TodayPicks, { app: null, selection, names: {}, criteriaName: '반등 기준' });
    expect(screen.getAllByRole('listitem')).toHaveLength(10);
    expect(screen.queryByRole('button', { name: '관심 그룹으로 만들기' })).toBeNull();
  });
});
```

- [ ] **Step 2: 실패하는지 확인해요**

Run: `corepack pnpm test src/lib/ui/simulate src/lib/ui/screen`
Expected: FAIL. 새 prop을 받지 않아 「규칙 고치기」 단추가 있고, `app.settings` 접근에서 `TypeError: Cannot read properties of null`.

- [ ] **Step 3: 구현해요**

`src/lib/ui/simulate/ResultView.svelte`:

```ts
  import type { Skip, Trade } from '../../sim/types';
  let {
    state: done,
    colorConvention,
    theme,
    stale = false,
    onEdit,
    readonly = false,
    hideAmounts = false,
    skippedCounts,
    pnlPct,
    sampledNote,
  }: {
    state: DoneState;
    colorConvention: 'kr' | 'global';
    theme?: string;
    stale?: boolean;
    /** 편집으로 돌아간다. 읽기 전용(받은 공유)이면 없다 */
    onEdit?: (section?: Issue['section']) => void;
    /** 받은 공유: 규칙 고치기·거래 차트 시트를 숨기고 거래 줄을 누를 수 없게 */
    readonly?: boolean;
    /** 자금 숨김 공유: 거래 수량을 숨기고 종목별은 자금 대비 %로 */
    hideAmounts?: boolean;
    /** 건너뛴 신호 목록 없이 받은 이유별 개수(공유에서 skipped.rows가 null일 때) */
    skippedCounts?: [Skip['reason'], number][];
    /** 종목별 자금 대비 %(hideAmounts일 때) */
    pnlPct?: Record<string, number>;
    /** 곡선을 솎은 공유의 안내(차트 아래) */
    sampledNote?: string;
  } = $props();

  // 건너뜀 수·이유: 목록이 없으면(개수만 받은 공유) summary와 받은 개수로 센다
  const skipN = $derived(skippedCounts ? sum.skippedSignals : result.skipped.length);
  const skipList = $derived(
    skippedCounts ? skippedCounts.map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n) : skipCounts(result.skipped),
  );
  const cashIssue = $derived.by(() => {
    const top = skipList[0]?.reason ?? null;
    return top === '현금 부족' || top === '1주가 1회 금액보다 비쌈';
  });
```

(`dominantSkipReason` import는 더 쓰지 않으면 지워요.) 마크업에서 바꿀 곳:
- `{#if result.skipped.length === 0}` → `{#if skipN === 0}`
- `매수 신호가 {result.skipped.length}번` → `매수 신호가 {skipN}번`
- `{#each skipCounts(result.skipped) as c (c.reason)}` → `{#each skipList as c (c.reason)}`
- 「규칙 고치기」 단추를 `{#if !readonly && onEdit}…{/if}`로 감싸고 `onclick={() => (cashIssue ? onEdit('capital') : onEdit())}`는 그대로
- `{#if result.skipped.length > 0}<SkipList … />` → `{#if skipN > 0}<SkipList skipped={result.skipped} names={meta.names} counts={skippedCounts} />`
- 탭 이름 `` `건너뛴 신호 ${result.skipped.length}` `` → `` `건너뛴 신호 ${skipN}` ``
- `<TradeList trades={result.trades} names={meta.names} onTrade={readonly ? undefined : pick} hideQty={hideAmounts} />`
- `<SymbolTab … pnlPct={hideAmounts ? pnlPct : undefined} />`
- 셋째 탭 `<SkipList skipped={result.skipped} names={meta.names} counts={skippedCounts} />`
- `<EquityChart … {sampledNote} />`
- `<TradeChartSheet … />`를 `{#if !readonly}…{/if}`로 감싸요

`src/lib/ui/simulate/TradeList.svelte`:

```ts
  let {
    trades,
    names,
    onTrade,
    hideQty = false,
  }: {
    trades: Trade[];
    names: Record<string, string>;
    /** 없으면(받은 공유) 줄을 누를 수 없고 버튼이 아닌 목록 항목으로 그린다 */
    onTrade?: (t: Trade) => void;
    /** 자금 숨김 공유: 수량 없이 가격만 */
    hideQty?: boolean;
  } = $props();
```

`rows`의 매수 값을 `{ text: hideQty ? \`${fmtWon(t.price)}원\` : \`${t.qty}주 · ${fmtWon(t.price)}원\`, cls: '' }`로 바꿔요. 안내 문단을 아래로 바꿔요.

```svelte
{#if hasSell}
  <p class="note">매도 줄 %는 평균 단가 대비예요(수수료·세금 제외){onTrade ? '. 포지션 결과는 행을 눌러 확인해 주세요' : ''}</p>
{/if}
```

줄 마크업은 `onTrade`가 있으면 지금 단추 그대로, 없으면 같은 안쪽 span을 `<div class="item">`에 그려요(`.chev`는 빼요). `<style>`의 버튼 줄 규칙에 `.item`을 같은 선택자로 더해 모양을 맞춰요.

```svelte
        <li>
          {#if onTrade}
            <button type="button" aria-label={r.label} onclick={() => onTrade(r.t)}>
              <span class="nm">{r.name}</span>
              {#if r.value}<span class="val num {r.value.cls}">{r.value.text}</span>{/if}
              <span class="sub num">{r.sub}</span>
              <span class="chev" aria-hidden="true">›</span>
            </button>
          {:else}
            <div class="item">
              <span class="nm">{r.name}</span>
              {#if r.value}<span class="val num {r.value.cls}">{r.value.text}</span>{/if}
              <span class="sub num">{r.sub}</span>
            </div>
          {/if}
        </li>
```

`src/lib/ui/simulate/SymbolTab.svelte`: prop `pnlPct?: Record<string, number>`를 더하고 값 칸을 바꿔요.

```svelte
<script lang="ts">
  // …기존 import…
  /** 자금 대비 %: `+3.21%`, `−0.88%`(소수 둘째 자리, 진짜 빼기 기호) */
  const pctText = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`;
</script>

        {#if pnlPct}
          {@const v = pnlPct[p.symbol] ?? 0}
          <span class="num {trendClass(v, colorConvention)}">자금 대비 {pctText(v)}</span>
        {:else}
          <span class="num {trendClass(p.pnl, colorConvention)}">{trendWon(p.pnl)}</span>
        {/if}
```

`src/lib/ui/simulate/SkipList.svelte`: prop `counts?: [Skip['reason'], number][]`를 더하고, 있으면 목록 대신 이유별 개수를 보여요.

```svelte
{#if counts}
  <ul class="rows" aria-label="건너뛴 이유">
    {#each counts as [reason, n] (reason)}
      <li><span class="why">{skipReasonLabel(reason)}</span> <span class="num">{n}번</span></li>
    {/each}
  </ul>
  <p class="none">목록은 크기 때문에 빼고 보냈어요</p>
{:else if skipped.length === 0}
  <p class="none">건너뛴 신호가 없어요</p>
{:else}
  <ul class="rows" aria-label="건너뛴 신호">
    {#each skipped as k, i (i)}
      <li>
        <span class="num date">{dotDate(k.date)}</span>
        <span class="name">{names[k.symbol] ?? k.symbol}</span>
        <span class="why">{skipReasonLabel(k.reason)}</span>
      </li>
    {/each}
  </ul>
{/if}
```

(`skipReasonLabel`을 `./simText`에서 import해요.)

`src/lib/ui/simulate/EquityChart.svelte`: prop `sampledNote?: string`(문서 주석 `/** 곡선을 솎은 공유의 안내 */`)를 더하고, 차트를 감싸는 맨 바깥 요소의 끝(범례 다음)에 `{#if sampledNote}<p class="sampled">{sampledNote}</p>{/if}`를 둬요. `.sampled { margin: 4px 0 0; font-size: var(--fs-sub); color: var(--t2); }`.

`src/lib/ui/screen/ValidationResult.svelte`:

```ts
    app: App | null;
    /** 색 관례. 없으면 app 설정(받은 공유 화면은 보는 사람 설정을 넘긴다) */
    colorConvention?: 'kr' | 'global';
    /** 곡선을 솎은 공유의 안내 */
    sampledNote?: string;
  // …
  const conv = $derived(colorConvention ?? app?.settings.colorConvention ?? 'kr');
```

`{app.settings.colorConvention}`을 쓰는 곳(EquityChart의 `theme` 문자열 등)을 모두 `{conv}`로 바꾸고, `<EquityChart … {sampledNote} />`를 넘겨요. `<TodayPicks {app} … />`는 그대로예요(null을 그대로 넘겨요).

`src/lib/ui/screen/TodayPicks.svelte`: 타입을 `app: App | null`로 바꾸고, `관심 그룹으로 만들기` 단추·완료 안내(`비교 화면에서 보기`)·`<Sheet>` 전체를 `{#if app}…{/if}`로 감싸요. `create`·`addTo`·`goCompare`는 `if (!app) return;`으로 시작해요.

- [ ] **Step 4: 통과하는지 확인해요**

Run: `corepack pnpm test src/lib/ui src/routes`
Expected: PASS(기존 결과 화면·검증 화면 테스트가 그대로 통과해야 해요)

Run: `corepack pnpm check`
Expected: 오류 0. `RunPanel.svelte`가 `ResultView`에 `onEdit`을 넘기는 것은 그대로 맞아요.

- [ ] **Step 5: 커밋해요**

```bash
git add src/lib/ui/simulate/ResultView.svelte src/lib/ui/simulate/TradeList.svelte src/lib/ui/simulate/SymbolTab.svelte src/lib/ui/simulate/SkipList.svelte src/lib/ui/simulate/EquityChart.svelte src/lib/ui/screen/ValidationResult.svelte src/lib/ui/screen/TodayPicks.svelte src/lib/ui/simulate/ResultView.test.ts src/lib/ui/simulate/TradeList.test.ts src/lib/ui/screen/ValidationResult.test.ts src/lib/ui/screen/TodayPicks.test.ts
git commit -m "feat(share): 결과 화면 컴포넌트에 읽기 전용·금액 숨김·건너뜀 개수·솎기 안내를 더함" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Task 10: 받은 화면(SharedView) — 새 종류·받는 쪽 검사·인앱 안내·가져오기 단추

설계 1.3-8, 2.6(받은 화면 표시), 3.3(솎기 안내 문구), 4.7 전부, 4.8 흐름 1, 8절, 6.3(`SharedView.test.ts`).

**Files:**
- Create: `src/lib/share/view/SharedSimResult.svelte`, `src/lib/share/view/SharedValidation.svelte`
- Modify: `src/routes/SharedView.svelte`
- Modify: `src/App.svelte` (SharedView에 `colorConvention`·`theme`)
- Test: `src/routes/SharedView.test.ts` (기존 파일에 추가)

**Interfaces:**
- Consumes: Task 2·3 `checkShareSnapshot(…, 'read')`·`ShareSnapshot`·`SimResultSnapshot`·`ValidationSnapshot`, Task 4·5 `expandSimResult`·`perSymbolPct`·`expandValidation`, Task 6 `snapshotLines`·`kindLabel`, Task 7 `stashImport`, Task 8 `isKakaoInApp`·`isIos`·`openExternalHref`·`expectNoAxeViolations`, Task 9의 `ResultView`(`readonly`·`hideAmounts`·`skippedCounts`·`pnlPct`·`sampledNote`)·`ValidationResult`(`app: null`·`colorConvention`·`sampledNote`), `usesMacro`(`src/lib/screen/precompute.ts`), `flowRunSnap`·`finRunSnap`(`src/lib/ui/screen/screenText.ts`), `dotDate`(`simText.ts`), `kstDate`(`src/lib/time/kst.ts`), `kstHHMM`(`compareText.ts`)
- Produces:
  - `SharedView` props: 기존 `capability`·`read`·`onexit`·`universe`에 더해 `onimport?: (s: ShareSnapshot) => void`(기본 `(s) => stashImport(s, Date.now())`), `colorConvention?: 'kr' | 'global'`(기본 `'kr'`), `theme?: string`, `ua?: string`(기본 `navigator.userAgent`), `now?: () => number`(기본 `Date.now`)
  - 상태 `unsupported`·`unreadable`과 문구
  - `SharedSimResult` props: `{ snapshot: SimResultSnapshot; names?: SymbolNames; colorConvention: 'kr' | 'global'; theme?: string }`
  - `SharedValidation` props: `{ snapshot: ValidationSnapshot; names?: SymbolNames; colorConvention: 'kr' | 'global'; theme?: string }`
  - `sampledText(sampled: { from: number }, kept: number): string` — `곡선은 {from}점 중 {kept}점으로 줄였어요 · 수치는 전체 기간 기준이에요` (`src/lib/share/shareText.ts`에 둬요)

- [ ] **Step 1: 실패하는 테스트를 써요**

`src/routes/SharedView.test.ts` 맨 위에 더해요.

```ts
import { beforeEach, afterEach } from 'vitest';
import { fireEvent, within } from '@testing-library/svelte';
import { lwcCharts, resetLwcStub, ResizeObserverStub } from '../lib/chart/lwcStub';
import { compareSnapshot } from '../lib/share/compact';
import { clearImport, IMPORT_KEY } from '../lib/share/pendingImport';
import type { ShareSnapshot } from '../lib/share/snapshot';
import { expectNoAxeViolations } from '../lib/share/testAxe';
import { NOW, simResultFixture, validationFixture } from '../lib/share/testFixtures';

vi.mock('lightweight-charts', async () => (await import('../lib/chart/lwcStub')).lwcModule());
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  resetLwcStub();
});
afterEach(() => {
  vi.unstubAllGlobals();
  clearImport();
});

const dataOf = (snapshot: unknown, kind = (snapshot as { kind: string }).kind): SharedRead =>
  ({ kind, title: (snapshot as { title: string }).title, snapshot, createdAt: NOW, expiresAt: NOW + 7 * 864e5 }) as SharedRead;
const readOf = (snapshot: unknown, kind?: string) => vi.fn(async (): Promise<ApiResult<SharedRead>> => ({ ok: true, data: dataOf(snapshot, kind) }));
const names = vi.fn(async () => [
  { s: '005930', n: '삼성전자', m: 'KOSPI', t: 'STOCK' as const },
  { s: '000660', n: 'SK하이닉스', m: 'KOSPI', t: 'STOCK' as const },
]);
const cmp = compareSnapshot(
  { id: 'g', name: '반도체', items: [{ symbol: '005930', colorSlot: 1, hidden: false, addedAt: 1 }] },
  { period: { unit: 'M', n: 1 }, metric: 'change', benchmark: 'AUTO', boardOrder: 'value' },
);
```

파일 끝에 더해요.

```ts
describe('SharedView 새 종류', () => {
  const show = (snapshot: unknown, o: Record<string, unknown> = {}) =>
    render(SharedView, { capability: CAP, read: readOf(snapshot), onexit: vi.fn(), universe: names, ...o });

  it('비교 화면: 요약 줄과 가져오면 볼 수 있다는 안내, 규칙 원문은 없다', async () => {
    show(cmp);
    expect(await screen.findByText('보기: 기간 1개월 · 지표 등락률 · 벤치마크 자동 · 정렬 값 순')).toBeTruthy();
    expect(screen.getByText('가져오면 내 연결이나 데모로 같은 화면을 볼 수 있어요')).toBeTruthy();
    expect(screen.getByText(/비교 화면 · .*까지 볼 수 있어요/)).toBeTruthy();
    expect(screen.queryByText('규칙 전체 보기')).toBeNull();
  });

  it('시뮬레이션 결과: 머리줄·요약 카드·거래 줄(종목 이름)·규칙 원문(결과 없음)', async () => {
    show(simResultFixture());
    expect(await screen.findByText(/^2024\.01\.02 ~ 2024\.01\.12 · KRX 일봉 · \d{4}\.\d{2}\.\d{2} \d{2}:\d{2} 받음$/)).toBeTruthy();
    expect(screen.getByRole('list', { name: '요약' }).textContent).toContain('총수익률');
    await waitFor(() => expect(screen.getAllByText('삼성전자').length).toBeGreaterThan(0));
    const rules = screen.getByText('규칙 전체 보기').closest('details')!;
    expect(rules.textContent).toContain('"strategy"');
    expect(rules.textContent).not.toContain('"axis"');
    expect(rules.textContent).not.toContain('"result"');
    expect(lwcCharts.length).toBeGreaterThan(0);
  });

  it('자금 숨김: 배지와 가격만 보이는 거래 줄, 종목별은 자금 대비 %', async () => {
    show(simResultFixture({ capitalHidden: true }));
    expect(await screen.findByText('초기 자금 비공개')).toBeTruthy();
    expect(screen.getByText('70,000원')).toBeTruthy();
    expect(screen.queryByText(/14주/)).toBeNull();
  });

  it('건너뜀 목록이 없는 결과는 개수로 탭 이름을 단다', async () => {
    const s = simResultFixture();
    s.result.skipped.rows = null;
    show(s);
    expect(await screen.findByRole('radio', { name: '건너뛴 신호 3' })).toBeTruthy();
  });

  it('솎은 곡선은 안내를 적는다', async () => {
    const s = simResultFixture();
    s.result.sampled = { from: 900 };
    show(s);
    expect(await screen.findByText('곡선은 900점 중 5점으로 줄였어요 · 수치는 전체 기간 기준이에요')).toBeTruthy();
  });

  it('검증 결과: 카드·오늘 선별·선정 이력', async () => {
    show(validationFixture());
    expect(await screen.findByRole('heading', { name: '오늘 기준 선별' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '선정 이력' })).toBeTruthy();
    expect(screen.getAllByText('① 선정만').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '관심 그룹으로 만들기' })).toBeNull();
  });

  it('모르는 종류와 읽을 수 없는 공유를 나눠 안내한다', async () => {
    render(SharedView, { capability: CAP, read: readOf({ kind: 'future', v: 1, title: '새 종류' }), onexit: () => {}, universe: names });
    expect((await screen.findByRole('alert')).textContent).toBe('이 공유는 새 버전 앱에서 볼 수 있어요. 앱을 새로 고쳐 주세요.');
    const broken = simResultFixture();
    broken.result.trades[0][1] = 9;
    render(SharedView, { capability: CAP, read: readOf(broken), onexit: () => {}, universe: names });
    await waitFor(() => expect(screen.getAllByRole('alert').map((a) => a.textContent)).toContain('이 공유를 읽을 수 없어요. 보낸 사람에게 다시 만들어 달라고 해 주세요.'));
  });

  it('카카오톡 인앱이면 안내와 기본 브라우저 단추, iOS면 홈 화면 안내를 덧붙인다', async () => {
    show(cmp, { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) KAKAOTALK 10.8.0' });
    const note = await screen.findByRole('note');
    expect(note.textContent).toContain('카카오톡 안에서 열었어요. 여기서 가져오면 이 카카오톡 브라우저에만 저장돼요.');
    expect(note.textContent).toContain('홈 화면에 추가한 가즈아는 Safari와 저장소가 따로라');
    expect(within(note).getByRole('button', { name: '기본 브라우저로 열기' })).toBeTruthy();
  });

  it('내 앱에 가져오기: 대기 값을 넣고 onexit을 부른다(결과는 규칙만)', async () => {
    const onexit = vi.fn();
    show(simResultFixture(), { onexit });
    await fireEvent.click(await screen.findByRole('button', { name: '내 앱에 가져오기' }));
    expect(onexit).toHaveBeenCalledTimes(1);
    const stored = JSON.parse(sessionStorage.getItem(IMPORT_KEY)!);
    expect(stored).toMatchObject({ from: 'simResult', snapshot: { kind: 'strategy', title: '눌림목' } });
    expect(screen.getByText(/결과는 저장하지 않고 규칙만 가져와요/)).toBeTruthy();
  });

  it.each<[string, ShareSnapshot]>([
    ['compare', cmp],
    ['simResult', simResultFixture()],
    ['validation', validationFixture()],
  ])('%s: axe 위반이 없다', async (_k, snapshot) => {
    const { container } = show(snapshot);
    await screen.findByRole('button', { name: '내 앱에 가져오기' });
    await expectNoAxeViolations(container);
  });
});
```

- [ ] **Step 2: 실패하는지 확인해요**

Run: `corepack pnpm test src/routes/SharedView.test.ts`
Expected: FAIL. 새 종류 본문·`unsupported` 문구·`내 앱에 가져오기` 단추가 없어요.

- [ ] **Step 3: 구현해요**

`src/lib/share/shareText.ts`에 더해요.

```ts
/** 솎은 곡선 안내(설계 3.3) */
export const sampledText = (sampled: { from: number }, kept: number): string =>
  `곡선은 ${sampled.from}점 중 ${kept}점으로 줄였어요 · 수치는 전체 기간 기준이에요`;
```

`src/lib/share/view/SharedSimResult.svelte`:

```svelte
<script lang="ts">
  // 받은 시뮬레이션 결과를 결과 화면(ResultView)으로 읽기 전용으로 보인다. 원시 일봉이 없어 거래 차트 시트는 없다.
  import ResultView from '../../ui/simulate/ResultView.svelte';
  import { expandSimResult, perSymbolPct } from '../compact';
  import { sampledText, type SymbolNames } from '../shareText';
  import type { SimResultSnapshot } from '../snapshot';

  let { snapshot, names, colorConvention, theme }: { snapshot: SimResultSnapshot; names?: SymbolNames; colorConvention: 'kr' | 'global'; theme?: string } = $props();

  const done = $derived(expandSimResult(snapshot, names));
  const r = $derived(snapshot.result);
</script>

<ResultView
  state={done}
  {colorConvention}
  {theme}
  readonly
  hideAmounts={snapshot.capitalHidden}
  skippedCounts={r.skipped.rows === null ? r.skipped.counts : undefined}
  pnlPct={snapshot.capitalHidden ? perSymbolPct(snapshot) : undefined}
  sampledNote={r.sampled ? sampledText(r.sampled, r.axis.offsets.length) : undefined}
/>
```

`src/lib/share/view/SharedValidation.svelte`:

```svelte
<script lang="ts">
  // 받은 검증 결과를 검증 화면(ValidationResult)으로 읽기 전용으로 보인다. 흐름 기간·수급·재무 표시는 받은 기준에서 다시 만든다(설계 2.5).
  import { usesMacro } from '../../screen/precompute';
  import ValidationResult from '../../ui/screen/ValidationResult.svelte';
  import { finRunSnap, flowRunSnap } from '../../ui/screen/screenText';
  import { expandValidation } from '../compact';
  import { sampledText, type SymbolNames } from '../shareText';
  import type { ValidationSnapshot } from '../snapshot';

  let { snapshot, names, colorConvention, theme }: { snapshot: ValidationSnapshot; names?: SymbolNames; colorConvention: 'kr' | 'global'; theme?: string } = $props();

  const result = $derived(expandValidation(snapshot));
  const c = $derived(snapshot.criteria);
  const nameMap = $derived<Record<string, string>>(names ? Object.fromEntries(names) : {});
  const r = $derived(snapshot.result);
</script>

<ValidationResult
  app={null}
  {colorConvention}
  {result}
  names={nameMap}
  criteriaName={snapshot.title}
  capital={c.capital}
  {theme}
  macro={{ used: usesMacro(c), lookback: { usdkrw: c.conditions.macro.usdkrw.trend.lookback, wti: c.conditions.macro.wti.trend.lookback } }}
  flow={flowRunSnap(c)}
  fin={finRunSnap(c)}
  sampledNote={r.sampled ? sampledText(r.sampled, r.axis.offsets.length) : undefined}
/>
```

`src/routes/SharedView.svelte`의 `<script>`를 아래처럼 바꿔요(종목 이름을 받는 `$effect`는 그대로).

```ts
  import { Badge } from '@sch0718/ui-svelte';
  import type { ApiResult, SharedRead } from '../lib/sync/api';
  import type { UniverseItem } from '../lib/data/universe';
  import { kindLabel } from '../lib/share/kinds';
  import { isIos, isKakaoInApp, openExternalHref } from '../lib/share/inApp';
  import { stashImport } from '../lib/share/pendingImport';
  import { snapshotLines, symbolNames, type SymbolNames } from '../lib/share/shareText';
  import { checkShareSnapshot, type ShareSnapshot } from '../lib/share/snapshot';
  import SharedSimResult from '../lib/share/view/SharedSimResult.svelte';
  import SharedValidation from '../lib/share/view/SharedValidation.svelte';
  import { sharedUniverse } from '../sheets/universeSource';
  import { kstDate } from '../lib/time/kst';
  import { kstHHMM } from '../lib/ui/compare/compareText';
  import { dotDate } from '../lib/ui/simulate/simText';

  let {
    capability,
    read,
    onexit,
    universe = sharedUniverse,
    onimport = (s: ShareSnapshot) => void stashImport(s, Date.now()),
    colorConvention = 'kr',
    theme,
    ua = globalThis.navigator?.userAgent ?? '',
    now = Date.now,
  }: {
    capability: string | undefined;
    read: ((cap: string) => Promise<ApiResult<SharedRead>>) | null;
    onexit: () => void;
    universe?: () => Promise<UniverseItem[]>;
    /** 가져올 내용을 탭 저장소에 둔다(설계 4.8). 부른 뒤 onexit으로 앱에 들어간다 */
    onimport?: (s: ShareSnapshot) => void;
    /** 보는 사람의 색 관례·테마(app.settings) */
    colorConvention?: 'kr' | 'global';
    theme?: string;
    ua?: string;
    now?: () => number;
  } = $props();

  type Fail = 'gone' | 'missing' | 'offline' | 'unavailable' | 'error' | 'unsupported' | 'unreadable';
  type View = { state: 'loading' } | { state: 'ok'; data: SharedRead; snapshot: ShareSnapshot } | { state: Fail };
  let view = $state<View>({ state: 'loading' });
```

읽기 `$effect`의 성공 분기를 받는 쪽 검사로 바꿔요(서버는 읽을 때 다시 검사하지 않아요, 설계 4.7).

```ts
    read(cap).then((r) => {
      if (!alive) return;
      if (r.ok) {
        const c = checkShareSnapshot(r.data.snapshot, r.data.kind, now(), 'read');
        view = c.ok ? { state: 'ok', data: r.data, snapshot: c.snapshot } : { state: c.code === 'unsupported' ? 'unsupported' : 'unreadable' };
      } else view = { state: r.kind === 'gone' ? 'gone' : r.kind === 'not-found' ? 'missing' : r.kind === 'offline' ? 'offline' : 'error' };
    });
```

`MESSAGE`에 두 문구를 더하고, 규칙 원문·도우미를 바꿔요.

```ts
  const MESSAGE: Record<Fail, string> = {
    gone: '만료됐거나 철회된 공유예요.',
    missing: '링크가 맞지 않아요. 받은 주소를 다시 확인해 주세요.',
    offline: '서버에 연결할 수 없어요. 연결을 확인하고 다시 열어 주세요.',
    unavailable: '이 앱에는 공유 기능이 설정되지 않았어요.',
    error: '공유를 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.',
    unsupported: '이 공유는 새 버전 앱에서 볼 수 있어요. 앱을 새로 고쳐 주세요.',
    unreadable: '이 공유를 읽을 수 없어요. 보낸 사람에게 다시 만들어 달라고 해 주세요.',
  };
  /** 규칙 원문: 결과 종류는 규칙 부분(strategy 또는 criteria·baskets)만. result를 거대한 JSON으로 그리지 않는다(설계 4.7) */
  const rulesOf = (s: ShareSnapshot): Record<string, unknown> | null => {
    switch (s.kind) {
      case 'group':
      case 'compare':
        return null;
      case 'strategy':
      case 'simResult':
        return { strategy: s.strategy };
      case 'criteria':
      case 'validation':
        return { criteria: s.criteria, baskets: s.baskets };
    }
  };
  const isResult = (s: ShareSnapshot) => s.kind === 'simResult' || s.kind === 'validation';
  const runLine = (s: ShareSnapshot) =>
    s.kind === 'simResult' || s.kind === 'validation'
      ? `${dotDate(s.run.from)} ~ ${dotDate(s.run.to)} · ${s.run.source} · ${dotDate(kstDate(s.run.fetchedAt))} ${kstHHMM(s.run.fetchedAt)} 받음`
      : null;
  const inApp = $derived(isKakaoInApp(ua));
  function importIt(s: ShareSnapshot) {
    onimport(s);
    onexit();
  }
  const fmtDate = (t: number) => new Date(t).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
```

마크업의 `<main>` 안을 아래로 바꿔요(스타일은 기존 것에 `.inapp`, `.run`, `.badges`, `.import`, `.primary`를 더해요).

```svelte
<main class="shared">
  <header>
    <span class="badge">읽기 전용 공유</span>
    <button type="button" class="exit" onclick={onexit}>가즈아 열기</button>
  </header>
  {#if inApp}
    <div class="inapp" role="note">
      <p>카카오톡 안에서 열었어요. 여기서 가져오면 이 카카오톡 브라우저에만 저장돼요. 평소 쓰는 브라우저에 저장하려면 기본 브라우저로 열어 주세요.</p>
      {#if isIos(ua)}<p>홈 화면에 추가한 가즈아는 Safari와 저장소가 따로라, 홈 화면 앱에서 이 링크를 다시 열어야 거기에 저장돼요.</p>{/if}
      <button type="button" onclick={() => (location.href = openExternalHref(location.href))}>기본 브라우저로 열기</button>
    </div>
  {/if}
  {#if view.state === 'loading'}
    <p role="status">불러오는 중…</p>
  {:else if view.state === 'ok'}
    {@const s = view.snapshot}
    {@const rules = rulesOf(s)}
    <h1>{view.data.title}</h1>
    <p class="meta">{kindLabel(s.kind)} · {fmtDate(view.data.expiresAt)}까지 볼 수 있어요</p>
    {#if s.kind === 'simResult' || s.kind === 'validation'}
      <p class="run">{runLine(s)}</p>
      <p class="badges">
        {#if s.run.demo}<Badge>데모 데이터</Badge>{/if}
        {#if s.capitalHidden}<Badge>초기 자금 비공개</Badge>{/if}
      </p>
    {/if}
    {#if s.kind === 'simResult'}
      <SharedSimResult snapshot={s} {names} {colorConvention} {theme} />
    {:else if s.kind === 'validation'}
      <SharedValidation snapshot={s} {names} {colorConvention} {theme} />
    {:else}
      <ul class="lines">
        {#each snapshotLines(s, names) as line, i (i)}<li>{line}</li>{/each}
      </ul>
      {#if s.kind === 'compare'}<p class="note">가져오면 내 연결이나 데모로 같은 화면을 볼 수 있어요</p>{/if}
    {/if}
    {#if rules}
      <!-- 요약은 일부만 보여 준다. 받은 규칙 전부를 그대로 읽을 수 있게 한다(결과 부분은 넣지 않는다). -->
      <details class="rules">
        <summary>규칙 전체 보기</summary>
        <pre>{JSON.stringify(rules, null, 2)}</pre>
      </details>
    {/if}
    <div class="import">
      <button type="button" class="primary" onclick={() => importIt(s)}>내 앱에 가져오기</button>
      <p class="note">이 기기의 프로필에 저장해요. 로그인이나 키가 없어도 돼요.{isResult(s) ? ' 결과는 저장하지 않고 규칙만 가져와요' : ''}</p>
    </div>
    <p class="note">공유한 사람의 다른 데이터·계좌·키는 들어 있지 않아요. 이 화면의 내용은 이 기기에 저장하지 않아요.</p>
  {:else}
    <p class="msg" role="alert">{MESSAGE[view.state]}</p>
  {/if}
</main>
```

```css
  .inapp {
    background: var(--surface2);
    border-radius: var(--r-card);
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: var(--fs-sub);
  }
  .inapp button,
  .primary {
    min-height: var(--touch);
    padding: 0 14px;
    border-radius: 12px;
    font-weight: 700;
  }
  .inapp button {
    background: var(--surface);
    align-self: flex-start;
  }
  .primary {
    background: var(--accent);
    color: var(--on-accent);
    width: 100%;
  }
  .run {
    font-size: var(--fs-sub);
    color: var(--t2);
  }
  .badges {
    display: flex;
    gap: 6px;
  }
  .import {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
```

`src/App.svelte`의 SharedView에 보는 사람 설정을 넘겨요.

```svelte
    <SharedView
      capability={route.capability}
      read={publicApi ? (cap) => publicApi.readShare(cap) : null}
      onexit={() => app.leaveShared()}
      colorConvention={app.settings.colorConvention}
      theme={app.settings.theme}
    />
```

- [ ] **Step 4: 통과하는지 확인해요**

Run: `corepack pnpm test src/routes/SharedView.test.ts src/lib/share src/lib/ui`
Expected: PASS(기존 SharedView 테스트 포함). axe 위반이 나오면 규칙 id를 보고 마크업을 고쳐요.

Run: `corepack pnpm check`
Expected: 오류 0

- [ ] **Step 5: 커밋해요**

```bash
git add src/routes/SharedView.svelte src/routes/SharedView.test.ts src/lib/share/view/SharedSimResult.svelte src/lib/share/view/SharedValidation.svelte src/lib/share/shareText.ts src/App.svelte
git commit -m "feat(share): 받은 화면에 새 공유 종류·받는 쪽 검사·인앱 안내·내 앱에 가져오기를 더함" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 11: 공유 대화 상자의 `ShareBuild` 처리와 기존 진입점

설계 3.1(만들기 결과·클라이언트 검사), 3.4(거절·줄임 안내), 4.1(`ShareRequest`·`CardCapture` 타입), 4.2(제목·자금 빼기 문구·원문 보기), 4.9(기존 공유 단추 감싸기), 7절, 8절(alert).

**Files:**
- Modify: `src/lib/share/shareStore.svelte.ts`
- Modify: `src/lib/share/ShareDialog.svelte`, Test: `src/lib/share/ShareDialog.test.ts`
- Modify: `src/sheets/GroupSheet.svelte:159`, `src/lib/ui/simulate/StrategyList.svelte:45-50`, `src/lib/ui/screen/CriteriaList.svelte:56-61` (`build`를 `built(…)`로 감쌈)

**Interfaces:**
- Consumes: Task 2 `ShareBuild`·`ShareReduction`·`built`, Task 1 `kindLabel`, Task 6 `snapshotLines`, `jsonBytes`(`../sync/forbidden`), Task 4·5 `simResultFixture`·`bigDone`(테스트)
- Produces (`shareStore.svelte.ts`, 설계 4.1 그대로):

```ts
export interface ShareRequest {
  kind: ShareKind;
  name: string;
  profileId: string;
  /** 가상 자금 빼기 여부를 받아 보낼 스냅샷을 만든다(group·compare는 무시) */
  build(hideCapital: boolean): ShareBuild;
  /** 비교·결과 화면: 지금 보이는 차트로 카드 이미지를 만든다. 그릴 곡선이 없으면 null */
  capture?: () => CardCapture | null;
}
export interface CardCapture {
  /** 합성한 카드(1600×800, 표시 800×400) */
  canvas: HTMLCanvasElement;
  /** 미리 보기 대체 글 */
  alt: string;
  /** 카카오 카드 설명 둘째 줄 후보 */
  line: string | null;
}
```

- Produces (`ShareDialog.svelte`): `REDUCTION_TEXT: Record<ShareReduction, string>`(모듈 스크립트에서 내보냄), 거절 문구 `tooLargeText(bytes: number): string`

- [ ] **Step 1: 실패하는 테스트를 써요**

`src/lib/share/ShareDialog.test.ts`의 고정 요청을 `ShareBuild`로 바꿔요: `import { built, groupSnapshot, strategySnapshot } from './snapshot';`, `groupReq.build`를 `() => built(groupSnapshot(…))`로, 전략 요청을 `(h) => built(strategySnapshot(…))`로, 「늦게 온 링크」 테스트의 `other.build`도 `() => built(groupSnapshot(…))`로 바꾸고, 첫 테스트의 기대값을 `expect(s.createShare).toHaveBeenCalledWith('p1', 'group', (groupReq.build(true) as { snapshot: unknown }).snapshot, 7);`로 바꿔요. 그리고 import에 `import { simResultSnapshot } from './compact';`, `import { bigDone, NOW as FIX_NOW, simResultFixture } from './testFixtures';`를 더하고 끝에 붙여요.

```ts
describe('ShareDialog 결과 종류', () => {
  const simReq = (build: ShareRequest['build']): ShareRequest => ({ kind: 'simResult', name: '눌림목', profileId: 'p1', build });

  it('제목은 종류 이름, 자금 빼기 문구는 결과용, 미리 보기는 요약만', () => {
    render(ShareDialog, { request: simReq(() => built(simResultFixture())), sync: sync(), onclose: () => {} });
    expect(screen.getByText('시뮬레이션 결과 공유')).toBeTruthy();
    expect(screen.getByLabelText('가상 초기 자금과 금액·수량 빼기')).toBeTruthy();
    const lines = screen.getByRole('list', { name: '보낼 내용' }).textContent!;
    expect(lines).toContain('총수익률');
    expect(lines).not.toContain('"trades"');
  });

  it('결과 원문은 펼칠 때만 만들어지고, 규칙 원문은 들여 쓴 JSON이다', async () => {
    render(ShareDialog, { request: simReq(() => built(simResultFixture())), sync: sync(), onclose: () => {} });
    const raw = screen.getByText(/^결과 원문\(약 \d+ KB\)$/).closest('details')!;
    expect(raw.querySelector('pre')).toBeNull();
    raw.open = true;
    await fireEvent(raw, new Event('toggle'));
    expect(raw.querySelector('pre')!.textContent).toContain('"axis":{"start":"2024-01-02"');
    const rules = screen.getByText('보낼 원문 보기').closest('details')!;
    expect(rules.querySelector('pre')!.textContent).toContain('\n  "strategy": {');
  });

  it('줄인 단계를 한 줄씩 알린다', () => {
    render(ShareDialog, { request: simReq(() => ({ ok: true, snapshot: simResultFixture(), reduced: ['skipped-counts', 'thinned'] })), sync: sync(), onclose: () => {} });
    const list = screen.getByRole('list', { name: '줄인 내용' });
    expect(list.textContent).toContain('건너뛴 신호는 이유별 개수만 보내요');
    expect(list.textContent).toContain('곡선은 점 수를 줄여 보내요');
  });

  it('너무 크면 거절 문구를 보이고 링크 만들기를 끈다(서버에 보내지 않는다)', async () => {
    const s = sync();
    render(ShareDialog, { request: simReq((h) => simResultSnapshot(bigDone({ days: 735, trades: 3000, skips: 0 }), { hideCapital: h, now: FIX_NOW })), sync: s, onclose: () => {} });
    expect(screen.getByRole('alert').textContent).toMatch(/^결과가 너무 커서 공유할 수 없어요\(약 \d+ KB, 한도 100 KB\)\. 기간이나 종목을 줄여 다시 실행해 주세요$/);
    const button = screen.getByRole('button', { name: '링크 만들기' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await fireEvent.click(button);
    expect(s.createShare).not.toHaveBeenCalled();
  });

  it('형식으로 바꾸지 못하면 그 문구를 보이고 경로는 원문 보기 안에만 둔다', () => {
    render(ShareDialog, { request: simReq(() => ({ ok: false, code: 'invalid', path: 'result.trades[3]' })), sync: sync(), onclose: () => {} });
    expect(screen.getByRole('alert').textContent).toBe('이 결과는 공유 형식으로 바꾸지 못했어요');
    expect((screen.getByRole('button', { name: '링크 만들기' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('보낼 원문 보기').closest('details')!.textContent).toContain('result.trades[3]');
  });

  it('비교 화면에는 자금 빼기 체크가 없다', () => {
    const cmp: ShareRequest = {
      kind: 'compare',
      name: '반도체',
      profileId: 'p1',
      build: () => built({ kind: 'compare', v: 1, title: '반도체', symbols: ['005930'], view: { period: { unit: 'D', n: 1 }, metric: 'change', benchmark: 'AUTO', boardOrder: 'value' } }),
    };
    render(ShareDialog, { request: cmp, sync: sync(), onclose: () => {} });
    expect(screen.queryByLabelText(/가상 초기 자금/)).toBeNull();
    expect(screen.getByText('비교 화면 공유')).toBeTruthy();
  });
});
```

- [ ] **Step 2: 실패하는지 확인해요**

Run: `corepack pnpm test src/lib/share/ShareDialog.test.ts src/lib/share/shareButtons.test.ts`
Expected: FAIL. 대화 상자가 `ShareBuild`를 모르고(`snapshot.kind` 없음), 거절·줄임 문구가 없어요.

- [ ] **Step 3: 구현해요**

`src/lib/share/shareStore.svelte.ts`의 import를 `import type { ShareBuild, ShareKind } from './snapshot';`로 바꾸고, `ShareRequest`·`CardCapture`를 위 **Produces** 그대로 둬요.

기존 진입점을 감싸요.
- `src/sheets/GroupSheet.svelte`: `build: () => built(groupSnapshot(g))` (`import { built, groupSnapshot } from '../lib/share/snapshot';`)
- `src/lib/ui/simulate/StrategyList.svelte`: `build: (hideCapital) => built(strategySnapshot(s, watchlists, { hideCapital, now: Date.now() }))`
- `src/lib/ui/screen/CriteriaList.svelte`: `build: (hideCapital) => built(criteriaSnapshot(c, refs, { hideCapital, now: Date.now() }))`

`src/lib/share/ShareDialog.svelte`: 파일 맨 위에 모듈 스크립트를 두고, 인스턴스 스크립트의 스냅샷 만들기·자금 체크·원문 부분을 바꿔요.

```svelte
<script lang="ts" module>
  import type { ShareReduction } from './snapshot';
  /** 줄인 단계 안내(설계 3.4, 「내가 정한 기본값」 10번) */
  export const REDUCTION_TEXT: Record<ShareReduction, string> = {
    'skipped-counts': '건너뛴 신호는 이유별 개수만 보내요',
    'no-values': '선정 이력의 조건 계산값은 빼고 보내요',
    thinned: '곡선은 점 수를 줄여 보내요',
    'codes-only': '선정 이력은 종목 코드만 보내요',
  };
  export const tooLargeText = (bytes: number) => `결과가 너무 커서 공유할 수 없어요(약 ${Math.ceil(bytes / 1024)} KB, 한도 100 KB). 기간이나 종목을 줄여 다시 실행해 주세요`;
  export const INVALID_TEXT = '이 결과는 공유 형식으로 바꾸지 못했어요';
</script>
```

```ts
  import { jsonBytes } from '../sync/forbidden';
  import { kindLabel } from './kinds';
  import { SHARE_TTL_DEFAULT_DAYS, SHARE_TTL_MAX_DAYS, type ShareBuild, type ShareSnapshot } from './snapshot';

  const build = $derived<ShareBuild | null>(request ? request.build(hideCapital) : null);
  const snapshot = $derived<ShareSnapshot | null>(build?.ok ? build.snapshot : null);
  const isResult = $derived(request?.kind === 'simResult' || request?.kind === 'validation');
  const hasCapital = $derived(request !== null && ['strategy', 'criteria', 'simResult', 'validation'].includes(request.kind));
  /** 규칙 부분: 결과 종류는 strategy 또는 criteria·baskets만(들여 쓴 JSON) */
  const rulesPart = $derived.by(() => {
    const s = snapshot;
    if (!s) return null;
    if (s.kind === 'simResult') return { strategy: s.strategy };
    if (s.kind === 'validation') return { criteria: s.criteria, baskets: s.baskets };
    return s;
  });
  const sizeKb = $derived(snapshot && isResult ? Math.max(1, Math.round(jsonBytes(snapshot) / 1024)) : 0);
  let rawOpen = $state(false);
```

`create()` 첫 줄은 그대로 `if (!request || !snapshot || !ttlValid) return;`예요(`snapshot`이 null이면 보내지 않아요). `close()`와 요청이 바뀌는 `$effect`에 `rawOpen = false;`를 더해요. 시트 제목을 `kindLabel`로 바꾼 것(Task 6)은 그대로예요.

링크 전 화면(`{:else}` 분기)을 아래로 바꿔요. 링크 화면(`{#if link}`)은 Task 13에서 바꿔요.

```svelte
<Sheet open={request !== null} title={request ? `${kindLabel(request.kind)} 공유` : '공유'} onclose={close}>
  {#if request && build}
    <div class="share">
      {#if link}
        <!-- 링크 화면은 지금 마크업 그대로다. Task 13이 카카오 부분을 바꾼다 -->
        <p class="lead">링크를 가진 사람은 누구나 {fmtDate(link.expiresAt)}까지 읽을 수 있어요.</p>
        <input class="url" readonly value={link.url} aria-label="공유 링크" onfocus={(e) => e.currentTarget.select()} />
        <button type="button" class="primary" onclick={copyLink}>링크 복사</button>
        {#if kakaoState !== 'off'}
          <button type="button" class="kakao" disabled={kakaoState !== 'ready'} onclick={sendToKakao}>
            {kakaoState === 'ready' ? '카카오톡으로 보내기' : '카카오톡 준비 중…'}
          </button>
        {/if}
        <p class="hint">설정 › 동기화 › 내 공유에서 언제든 철회할 수 있어요. 이미 본 내용·캡처는 지울 수 없어요.</p>
      {:else}
        {#if !build.ok}
          <p class="err" role="alert">{build.code === 'too-large' ? tooLargeText(build.bytes) : INVALID_TEXT}</p>
          {#if build.code === 'invalid' && build.path}
            <details>
              <summary>보낼 원문 보기</summary>
              <pre>{build.path}</pre>
            </details>
          {/if}
        {:else if snapshot}
          <p class="lead">아래 내용만 보내요. 프로필 이름·키·계좌·프록시 주소는 넣지 않아요.</p>
          {#if build.reduced.length > 0}
            <ul class="reduced" aria-label="줄인 내용">
              {#each build.reduced as r (r)}<li>{REDUCTION_TEXT[r]}</li>{/each}
            </ul>
          {/if}
          <ul class="preview" aria-label="보낼 내용">
            {#each snapshotLines(snapshot, names) as line, i (i)}<li>{line}</li>{/each}
          </ul>
          <details>
            <summary>보낼 원문 보기</summary>
            <pre>{JSON.stringify(rulesPart, null, 2)}</pre>
          </details>
          {#if isResult}
            <details ontoggle={(e) => (rawOpen = e.currentTarget.open)}>
              <summary>결과 원문(약 {sizeKb} KB)</summary>
              {#if rawOpen && (snapshot.kind === 'simResult' || snapshot.kind === 'validation')}<pre class="compact">{JSON.stringify(snapshot.result)}</pre>{/if}
            </details>
          {/if}
        {/if}
        {#if hasCapital}
          <label class="check">
            <input type="checkbox" bind:checked={hideCapital} />
            {isResult ? '가상 초기 자금과 금액·수량 빼기' : '가상 초기 자금 빼기'}
          </label>
        {/if}
        <label class="ttl" for="share-ttl-{uid}">
          만료(일)
          <input id="share-ttl-{uid}" type="number" min="1" max={SHARE_TTL_MAX_DAYS} step="1" bind:value={ttl} aria-invalid={ttlValid ? undefined : 'true'} />
        </label>
        {#if !ttlValid}<p class="err" role="alert">1~{SHARE_TTL_MAX_DAYS}일 사이로 정해 주세요</p>{/if}
        {#if failed}<p class="err" role="alert">{failed}</p>{/if}
        <button type="button" class="primary" disabled={!snapshot || !ttlValid || sync.busy} onclick={create}>{sync.busy ? '만드는 중…' : '링크 만들기'}</button>
      {/if}
    </div>
  {/if}
</Sheet>
```

`<style>`에 `.reduced`(`.preview`와 같은 상자, `color: var(--t2)`)와 `.compact { white-space: pre-wrap; word-break: break-all; }`를 더해요. 거절 상태에서도 「가상 초기 자금 빼기」 체크는 보여요(체크를 바꾸면 다시 만들어 보므로).

- [ ] **Step 4: 통과하는지 확인해요**

Run: `corepack pnpm test src/lib/share src/sheets src/lib/ui/simulate src/lib/ui/screen`
Expected: PASS(`shareButtons.test.ts` 포함)

Run: `corepack pnpm check`
Expected: 오류 0

- [ ] **Step 5: 커밋해요**

```bash
git add src/lib/share/shareStore.svelte.ts src/lib/share/ShareDialog.svelte src/lib/share/ShareDialog.test.ts src/sheets/GroupSheet.svelte src/lib/ui/simulate/StrategyList.svelte src/lib/ui/screen/CriteriaList.svelte
git commit -m "feat(share): 공유 대화 상자가 만들기 결과의 거절·줄임을 알리고 결과 원문은 펼칠 때만 그림" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Task 12: 카드 캡처와 비교·결과 화면의 공유 진입점

설계 1.5-2·3, 4.1(진입점 표), 4.3(캡처·합성 전부), 4.9(화면별 바뀌는 곳), 6.3(`cardImage.test.ts`, `lwcStub`), 8절(단추·대체 글).

**Files:**
- Create: `src/lib/share/cardImage.ts`, `src/lib/share/cardImage.test.ts`
- Modify: `src/lib/chart/lwcStub.ts` (`takeScreenshot`, `StubChart.screenshots`)
- Modify: `src/lib/chart/CompareChart.svelte`, `src/lib/ui/compare/ChartPanel.svelte`, `src/lib/ui/simulate/EquityChart.svelte` (`export function screenshot()`)
- Modify: `src/routes/Compare.svelte` (공유 단추·`captureCard`)
- Modify: `src/lib/ui/simulate/ResultView.svelte` (`onShare`, `export function capture()`), `src/lib/ui/simulate/RunPanel.svelte` (`onShare`, `capture()` 넘김)
- Modify: `src/lib/ui/screen/ValidationResult.svelte` (`export function capture()`)
- Modify: `src/routes/Simulate.svelte` (`runSnap` 확장, 결과 공유 두 곳)
- Test: `src/lib/ui/simulate/EquityChart.test.ts`, `ResultView.test.ts`, `src/lib/ui/screen/ValidationResult.test.ts`, `src/routes/Compare.test.ts` (기존 파일에 추가)

**Interfaces:**
- Consumes: Task 11 `CardCapture`·`ShareRequest`·`openShare`·`canShare`, Task 2 `built`·`shareTitle`, Task 2 `compareSnapshot`, Task 4 `simResultSnapshot`, Task 5 `validationSnapshot`, `formatMetricValue`·`periodLabel`·`kstHHMM`(`compareText.ts`), `orderRows`(`rows.ts`), `trendReturn`·`fmtReturnPct`·`dotDate`·`returnClass`(`simText.ts`), `kstDate`
- Produces (`cardImage.ts`):

```ts
export interface CardText {
  title: string;
  subtitle: string;
  /** 오른쪽 값 목록. swatch는 선 색(차트 범례 대신, DOM 범례는 캡처에 들어가지 않는다) */
  rows: { label: string; value: string; tone: 'up' | 'down' | 'flat'; swatch?: string }[];
  footer: string;
}
export interface CardColors { bg: string; text: string; sub: string; up: string; down: string; accent: string }
export const CARD_WIDTH = 1600;
export const CARD_HEIGHT = 800;
export const CARD_FILE_MAX = 5 * 1024 * 1024;
export const PROVIDER_NAME: Record<'kis' | 'toss' | 'demo', string>;
export function composeCard(chart: HTMLCanvasElement, text: CardText, colors: CardColors): HTMLCanvasElement;
export function cardFile(canvas: HTMLCanvasElement): Promise<File | null>;
export function readCardColors(el: Element): CardColors;
export function toneOf(v: number | null): 'up' | 'down' | 'flat';
export function cardAlt(text: CardText, kind: string): string;
export function compareCardText(a: { title: string; period: string; metric: string; at: number; rows: { name: string; value: string; tone: 'up' | 'down' | 'flat' }[]; provider: 'kis' | 'toss' | 'demo' }): CardText;
export function compareCardLine(rows: readonly { name: string; value: string }[], at: number): string;
export function simResultCardText(done: DoneState): CardText;
export function validationCardText(result: ValidationResult, title: string): CardText;
```

  - `CompareChart`·`EquityChart`: `export function screenshot(): HTMLCanvasElement | null` (`chart.takeScreenshot(true, false)`, 차트가 없으면 null)
  - `ChartPanel`: `export function screenshot(): HTMLCanvasElement | null`
  - `ResultView`: prop `onShare?: () => void`, `export function capture(): CardCapture | null`(거래 0건이면 null)
  - `RunPanel`: prop `onShare?: () => void`, `export function capture(): CardCapture | null`
  - `ValidationResult`: `export function capture(): CardCapture | null`
  - `Simulate.svelte`의 `runSnap`: `{ name; capital; macro; flow; fin; criteria: SelectionCriteria; baskets: Basket[]; strategies: Strategy[]; collectedAt: string }`

- [ ] **Step 1: 실패하는 테스트를 써요**

`src/lib/share/cardImage.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { doneState } from '../ui/simulate/resultFixture';
import { fmtReturnPct, trendReturn } from '../ui/simulate/simText';
import { validationResult } from '../ui/screen/resultFixture';
import { CARD_FILE_MAX, cardAlt, cardFile, compareCardLine, compareCardText, composeCard, readCardColors, simResultCardText, validationCardText } from './cardImage';

type Call = [op: string, ...args: unknown[]];
let calls: Call[] = [];
/** jsdom에는 canvas 그리기가 없으므로 호출을 기록하는 가짜 2D context(설계 6.3) */
const ctx = {
  fillStyle: '',
  font: '',
  textBaseline: '',
  scale: (x: number, y: number) => calls.push(['scale', x, y]),
  fillRect: (...a: number[]) => calls.push(['rect', ...a]),
  fillText: (t: string, x: number, y: number) => calls.push(['text', t, x, y]),
  drawImage: (img: unknown, ...a: number[]) => calls.push(['image', img, ...a]),
};
beforeEach(() => {
  calls = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
});
afterEach(() => vi.restoreAllMocks());

const COLORS = { bg: '#fff', text: '#111', sub: '#666', up: '#e00', down: '#00e', accent: '#53e' };
const TEXT = {
  title: '반도체',
  subtitle: '1개월 · 등락률 · 10.29 14:32 기준',
  rows: Array.from({ length: 6 }, (_, i) => ({ label: `종목${i}`, value: `+${i}.0%`, tone: 'up' as const })),
  footer: '한국투자증권',
};

describe('composeCard', () => {
  it('1600×800(표시 800×400), 위 띠에 가즈아·제목·부제, 왼쪽에 차트, 오른쪽에 값 5개, 아래에 출처', () => {
    const chart = Object.assign(document.createElement('canvas'), { width: 1200, height: 600 });
    const card = composeCard(chart, TEXT, COLORS);
    expect([card.width, card.height]).toEqual([1600, 800]);
    expect(calls[0]).toEqual(['scale', 2, 2]);
    const texts = calls.filter((c) => c[0] === 'text').map((c) => c[1]);
    expect(texts.slice(0, 3)).toEqual(['가즈아', '반도체', '1개월 · 등락률 · 10.29 14:32 기준']);
    expect(texts).toContain('종목4');
    expect(texts).not.toContain('종목5');
    expect(texts.at(-1)).toBe('한국투자증권');
    const footer = calls.filter((c) => c[0] === 'text').at(-1)!;
    expect(footer[3] as number).toBeGreaterThanOrEqual(376);
    const img = calls.find((c) => c[0] === 'image')!;
    expect(img[1]).toBe(chart);
    const [, , x, y, w, h] = img as [string, unknown, number, number, number, number];
    expect(x).toBe(16);
    expect(y).toBeGreaterThanOrEqual(64);
    expect(w).toBeLessThanOrEqual(496);
    expect(w / h).toBeCloseTo(2, 5);
    const valueXs = calls.filter((c) => c[0] === 'text' && String(c[1]).startsWith('종목')).map((c) => c[2] as number);
    expect(Math.min(...valueXs)).toBeGreaterThanOrEqual(496);
  });
});

describe('cardFile', () => {
  const fake = (blob: Blob | null | 'throw') =>
    ({
      toBlob: (cb: (b: Blob | null) => void, type: string, q: number) => {
        if (blob === 'throw') throw new Error('tainted');
        expect([type, q]).toEqual(['image/jpeg', 0.85]);
        cb(blob);
      },
    }) as unknown as HTMLCanvasElement;
  it('JPEG 0.85 파일, 5 MB를 넘거나 실패하면 null', async () => {
    const f = await cardFile(fake(new Blob(['x'], { type: 'image/jpeg' })));
    expect(f?.type).toBe('image/jpeg');
    expect(await cardFile(fake(new Blob([new Uint8Array(CARD_FILE_MAX + 1)])))).toBeNull();
    expect(await cardFile(fake(null))).toBeNull();
    expect(await cardFile(fake('throw'))).toBeNull();
  });
});

describe('카드 글', () => {
  it('색은 CSS 변수에서, 없으면 기본값', () => {
    const el = document.createElement('div');
    el.style.setProperty('--bg', '#010203');
    el.style.setProperty('--up', '#ff0000');
    document.body.append(el);
    expect(readCardColors(el)).toMatchObject({ bg: '#010203', up: '#ff0000' });
    expect(readCardColors(el).text).toMatch(/^#/);
    el.remove();
  });

  it('비교 화면: 부제는 기간 · 지표 · 기준 시각, 출처는 공급자(데모면 데모 데이터), 둘째 줄 후보', () => {
    const at = Date.UTC(2026, 9, 29, 5, 32); // KST 14:32
    const t = compareCardText({ title: '반도체', period: '1개월', metric: '등락률', at, rows: [{ name: '삼성전자', value: '+3.2%', tone: 'up' }], provider: 'demo' });
    expect(t.subtitle).toBe('1개월 · 등락률 · 10.29 14:32 기준');
    expect(t.footer).toBe('데모 데이터');
    expect(t.rows).toEqual([{ label: '삼성전자', value: '+3.2%', tone: 'up' }]);
    expect(compareCardText({ title: 'x', period: '1일', metric: 'RSI(14)', at, rows: [], provider: 'kis' }).footer).toBe('한국투자증권');
    expect(compareCardLine([{ name: '삼성전자', value: '+3.2%' }, { name: 'SK하이닉스', value: '+2.1%' }], at)).toBe('삼성전자 +3.2% · SK하이닉스 +2.1% · 10.29 14:32 기준');
    expect(cardAlt(t, '비교 화면')).toBe('반도체 비교 화면 캡처: 1개월 · 등락률 · 10.29 14:32 기준, 삼성전자 +3.2%');
  });

  it('시뮬레이션 결과: 총수익률·최대 낙폭·같은 종목 보유·지수, 부제는 기간', () => {
    const t = simResultCardText(doneState());
    expect(t.subtitle).toBe('2023.10.11 ~ 2026.10.11');
    expect(t.rows.map((r) => [r.label, r.value])).toEqual([
      ['총수익률', trendReturn(32.4)],
      ['최대 낙폭', fmtReturnPct(-12.3)],
      ['같은 종목 보유', trendReturn(16.3)],
      ['KOSPI', trendReturn(11)],
    ]);
    expect(t.footer).toBe('데모 데이터');
  });

  it('검증 결과: ① 선정만, ②(있으면), 첫 지수', () => {
    const t = validationCardText(validationResult(), '반등 기준');
    expect(t.title).toBe('반등 기준');
    expect(t.subtitle).toBe('2026.01.05 ~ 2026.02.03');
    expect(t.rows.map((r) => r.label)).toEqual(['① 선정만', 'KOSPI']);
    expect(t.footer).toBe('시장 데이터 파일');
  });
});
```

`src/lib/ui/simulate/EquityChart.test.ts` 끝에 더해요(파일의 기존 render 방식과 고정 데이터를 그대로 써요).

```ts
describe('EquityChart screenshot', () => {
  it('위 레이어는 넣고 십자선은 빼고 찍는다', () => {
    const { component } = render(EquityChart, { equity: doneState().result.equity, initial: 10_000_000 });
    const shot = component.screenshot();
    expect(shot).not.toBeNull();
    expect(lwcCharts[0].screenshots).toEqual([[true, false]]);
  });
});
```

`src/lib/ui/simulate/ResultView.test.ts` 끝에 더해요.

```ts
describe('ResultView 결과 공유', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => ({ scale() {}, fillRect() {}, fillText() {}, drawImage() {} }) as unknown as CanvasRenderingContext2D,
    );
  });
  it('onShare가 있으면 머리줄에 결과 공유 단추', async () => {
    const onShare = vi.fn();
    render(ResultView, { state: doneState(), colorConvention: 'kr', onEdit: vi.fn(), onShare });
    await fireEvent.click(screen.getByRole('button', { name: '결과 공유' }));
    expect(onShare).toHaveBeenCalledTimes(1);
  });
  it('capture: 곡선이 있으면 카드, 거래 0건이면 null', () => {
    const a = render(ResultView, { state: doneState(), colorConvention: 'kr', onEdit: vi.fn() });
    const card = a.component.capture();
    expect(card?.canvas.width).toBe(1600);
    expect(card?.alt).toMatch(/^눌림목|^새 전략/);
    expect(card?.line).toBeNull();
    const s = doneState();
    noTrades(s);
    const b = render(ResultView, { state: s, colorConvention: 'kr', onEdit: vi.fn() });
    expect(b.component.capture()).toBeNull();
  });
});
```

(`doneState()`의 전략 이름은 `newStrategy` 기본값이에요. `alt` 앞부분은 그 이름이라 정규식으로 둘 다 받아요.)

`src/lib/ui/screen/ValidationResult.test.ts` 끝에 더해요.

```ts
describe('ValidationResult capture', () => {
  it('자산 곡선을 찍어 카드를 만든다', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => ({ scale() {}, fillRect() {}, fillText() {}, drawImage() {} }) as unknown as CanvasRenderingContext2D,
    );
    const app = makeTestApp({ groups: [{ id: 'g1', name: '반도체', items: [] }], now: NOW });
    apps.push(app);
    const r = render(ValidationResult, { app, result: validationResult(), names: {}, criteriaName: '반등 기준', capital: 10_000_000, flow: DEFAULT_FLOW, fin: DEFAULT_FIN });
    const card = r.component.capture();
    expect(card?.alt.startsWith('반등 기준 검증 결과 캡처: 2026.01.05 ~ 2026.02.03')).toBe(true);
    expect(lwcCharts.at(-1)!.screenshots).toEqual([[true, false]]);
  });
});
```

`src/routes/Compare.test.ts` 끝에 더해요(import에 `import { closeShare, currentShare, setShareController } from '../lib/share/shareStore.svelte';`, `import type { SyncController } from '../lib/sync/controller.svelte';`를 더해요).

```ts
describe('비교 화면 공유', () => {
  afterEach(() => {
    closeShare();
    setShareController(null);
  });

  it('로그인했고 보이는 종목이 있으면 공유 단추로 비교 화면 스냅샷을 연다', async () => {
    setShareController({ account: { email: 'me@example.test' } } as SyncController);
    const app = makeApp(EXAMPLE);
    render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd });
    await fireEvent.click(screen.getByRole('button', { name: '공유' }));
    const req = currentShare()!;
    expect(req.kind).toBe('compare');
    const b = req.build(true);
    expect(b.ok && b.snapshot).toMatchObject({ kind: 'compare', title: '반도체', symbols: EXAMPLE, view: { period: app.settings.period, metric: app.settings.metric } });
    expect(typeof req.capture).toBe('function');
  });

  it('로그인하지 않았거나 보이는 종목이 없으면 단추가 없다', () => {
    setShareController({ account: null } as SyncController);
    const app = makeApp(EXAMPLE);
    render(Compare, { app, now: NOW, sessions, isOpenToday: true, barEnd });
    expect(screen.queryByRole('button', { name: '공유' })).toBeNull();
  });
});
```

- [ ] **Step 2: 실패하는지 확인해요**

Run: `corepack pnpm test src/lib/share/cardImage.test.ts src/lib/ui/simulate src/lib/ui/screen/ValidationResult.test.ts src/routes/Compare.test.ts`
Expected: FAIL. `./cardImage`가 없고, 컴포넌트에 `screenshot`·`capture`가 없으며, `lwcCharts[0].screenshots`가 `undefined`예요.

- [ ] **Step 3: 구현해요**

`src/lib/chart/lwcStub.ts`: `StubChart`에 `/** takeScreenshot(addTopLayer, includeCrosshair) 호출 기록 */ screenshots: [boolean | undefined, boolean | undefined][];`를 더하고, `createChart`의 `chart` 초기값에 `screenshots: [],`, 반환 api에 아래를 더해요.

```ts
    takeScreenshot: (addTopLayer?: boolean, includeCrosshair?: boolean) => {
      chart.screenshots.push([addTopLayer, includeCrosshair]);
      return Object.assign(document.createElement('canvas'), { width: 600, height: 300 });
    },
```

`src/lib/chart/CompareChart.svelte`·`src/lib/ui/simulate/EquityChart.svelte`의 `<script>` 끝에 더해요(두 파일 모두 `chart` 상태가 있어요).

```ts
  /** 카드 이미지용: 위 레이어(세션 띠 등 primitive)는 넣고 십자선은 뺀다(lightweight-charts 5.2 takeScreenshot) */
  export function screenshot(): HTMLCanvasElement | null {
    return chart ? chart.takeScreenshot(true, false) : null;
  }
```

`src/lib/ui/compare/ChartPanel.svelte`:

```ts
  let chartRef = $state<ReturnType<typeof CompareChart>>();
  export function screenshot(): HTMLCanvasElement | null {
    return chartRef?.screenshot() ?? null;
  }
```

마크업은 `<CompareChart bind:this={chartRef} {series} … />`로 바꿔요.

`src/lib/share/cardImage.ts`:

```ts
// 카카오 카드 이미지(설계 4.3): 차트 캡처에 글자를 직접 그려 1600×800 canvas 하나로 합친다. 새 라이브러리를 쓰지 않는다.
import type { ValidationResult } from '../screen/runValidation';
import { kstDate } from '../time/kst';
import { kstHHMM } from '../ui/compare/compareText';
import type { DoneState } from '../ui/simulate/runController.svelte';
import { dotDate, fmtReturnPct, trendReturn } from '../ui/simulate/simText';

export interface CardText {
  /** 굵은 제목(그룹·전략·기준 이름) */
  title: string;
  /** 기간 · 지표 · 기준 시각 같은 한 줄 */
  subtitle: string;
  /** 오른쪽 값 목록. swatch는 선 색(DOM 범례는 캡처에 들어가지 않아 여기 그린다) */
  rows: { label: string; value: string; tone: 'up' | 'down' | 'flat'; swatch?: string }[];
  /** 아래 줄: 시세 출처(데모면 '데모 데이터') */
  footer: string;
}
export interface CardColors {
  bg: string;
  text: string;
  sub: string;
  up: string;
  down: string;
  accent: string;
}

export const CARD_WIDTH = 1600;
export const CARD_HEIGHT = 800;
/** 카카오 업로드 한도 */
export const CARD_FILE_MAX = 5 * 1024 * 1024;
export const PROVIDER_NAME: Record<'kis' | 'toss' | 'demo', string> = { kis: '한국투자증권', toss: '토스증권', demo: '데모 데이터' };

// 표시 800×400 기준 배치: 위 64px 띠, 왼쪽 약 62% 차트, 오른쪽 값 목록, 맨 아래 24px 출처
const W = 800;
const H = 400;
const CHART = { x: 16, y: 72, w: 480, h: 296 };
const LIST_X = 512;

export function composeCard(chart: HTMLCanvasElement, text: CardText, colors: CardColors): HTMLCanvasElement {
  const card = document.createElement('canvas');
  card.width = CARD_WIDTH;
  card.height = CARD_HEIGHT;
  const g = card.getContext('2d');
  if (!g) throw new Error('canvas 2d를 쓸 수 없어요');
  g.scale(CARD_WIDTH / W, CARD_HEIGHT / H);
  const font = getComputedStyle(document.body).fontFamily || 'sans-serif';
  g.fillStyle = colors.bg;
  g.fillRect(0, 0, W, H);
  g.textBaseline = 'top';
  g.fillStyle = colors.accent;
  g.font = `800 18px ${font}`;
  g.fillText('가즈아', 24, 12);
  g.fillStyle = colors.text;
  g.font = `700 20px ${font}`;
  g.fillText(text.title, 100, 10);
  g.fillStyle = colors.sub;
  g.font = `400 13px ${font}`;
  g.fillText(text.subtitle, 100, 38);
  if (chart.width > 0 && chart.height > 0) {
    const r = Math.min(CHART.w / chart.width, CHART.h / chart.height);
    const w = chart.width * r;
    const h = chart.height * r;
    g.drawImage(chart, CHART.x, CHART.y + (CHART.h - h) / 2, w, h);
  }
  text.rows.slice(0, 5).forEach((row, i) => {
    const y = 80 + i * 56;
    if (row.swatch) {
      g.fillStyle = row.swatch;
      g.fillRect(LIST_X, y + 4, 10, 10);
    }
    g.fillStyle = colors.sub;
    g.font = `400 13px ${font}`;
    g.fillText(row.label, LIST_X + (row.swatch ? 16 : 0), y);
    g.fillStyle = row.tone === 'up' ? colors.up : row.tone === 'down' ? colors.down : colors.text;
    g.font = `700 20px ${font}`;
    g.fillText(row.value, LIST_X, y + 20);
  });
  g.fillStyle = colors.sub;
  g.font = `400 12px ${font}`;
  g.fillText(text.footer, 24, H - 20);
  return card;
}

/** JPEG 0.85로 만든다. 실패하거나 5 MB(카카오 한도)를 넘으면 null */
export function cardFile(canvas: HTMLCanvasElement): Promise<File | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob(
        (b) => resolve(b && b.size > 0 && b.size <= CARD_FILE_MAX ? new File([b], 'gazua-card.jpg', { type: 'image/jpeg' }) : null),
        'image/jpeg',
        0.85,
      );
    } catch {
      resolve(null);
    }
  });
}

/** 지금 테마의 CSS 변수를 읽는다. 색 관례(colorConvention)는 보낸 사람 것을 따른다 */
export function readCardColors(el: Element): CardColors {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    bg: v('--bg', '#ffffff'),
    text: v('--t1', '#111111'),
    sub: v('--t2', '#5c5c66'),
    up: v('--up', '#e5383b'),
    down: v('--down', '#2f6fde'),
    accent: v('--accent', '#5b47e0'),
  };
}

export function toneOf(v: number | null): 'up' | 'down' | 'flat' {
  if (v === null || !Number.isFinite(v)) return 'flat';
  const r = Math.round(v * 10) / 10;
  return r > 0 ? 'up' : r < 0 ? 'down' : 'flat';
}

/** `{제목} {종류} 캡처: {부제}, {값 목록을 쉼표로}` */
export function cardAlt(text: CardText, kind: string): string {
  return `${text.title} ${kind} 캡처: ${text.subtitle}${text.rows.map((r) => `, ${r.label} ${r.value}`).join('')}`;
}

const stamp = (at: number) => `${kstDate(at).slice(5).replace('-', '.')} ${kstHHMM(at)}`;

export function compareCardText(a: {
  title: string;
  period: string;
  metric: string;
  at: number;
  rows: { name: string; value: string; tone: 'up' | 'down' | 'flat' }[];
  provider: 'kis' | 'toss' | 'demo';
}): CardText {
  return {
    title: a.title,
    subtitle: `${a.period} · ${a.metric} · ${stamp(a.at)} 기준`,
    rows: a.rows.slice(0, 5).map((r) => ({ label: r.name, value: r.value, tone: r.tone })),
    footer: PROVIDER_NAME[a.provider],
  };
}

/** 카카오 설명 둘째 줄 후보: `삼성전자 +3.2% · SK하이닉스 +2.1% · 10.29 14:32 기준` */
export function compareCardLine(rows: readonly { name: string; value: string }[], at: number): string {
  return [...rows.map((r) => `${r.name} ${r.value}`), `${stamp(at)} 기준`].join(' · ');
}

export function simResultCardText(done: DoneState): CardText {
  const { result, meta } = done;
  const s = result.summary;
  return {
    title: meta.strategy.name,
    subtitle: `${dotDate(meta.from)} ~ ${dotDate(meta.to)}`,
    rows: [
      { label: '총수익률', value: trendReturn(s.totalReturnPct), tone: toneOf(s.totalReturnPct) },
      { label: '최대 낙폭', value: fmtReturnPct(s.mddPct), tone: toneOf(s.mddPct) },
      { label: '같은 종목 보유', value: trendReturn(result.benchmarks.holdReturnPct), tone: toneOf(result.benchmarks.holdReturnPct) },
      { label: meta.strategy.benchmarks.index, value: trendReturn(result.benchmarks.indexReturnPct), tone: toneOf(result.benchmarks.indexReturnPct) },
    ],
    footer: meta.demo ? '데모 데이터' : meta.venueLabel,
  };
}

export function validationCardText(result: ValidationResult, title: string): CardText {
  const rows: CardText['rows'] = [{ label: '① 선정만', value: trendReturn(result.hold.stats.totalPct), tone: toneOf(result.hold.stats.totalPct) }];
  if (result.trading) rows.push({ label: '② 선정 + 매매 규칙', value: trendReturn(result.trading.stats.totalPct), tone: toneOf(result.trading.stats.totalPct) });
  const idx = result.indices[0];
  if (idx) rows.push({ label: idx.id, value: idx.stats ? trendReturn(idx.stats.totalPct) : '—', tone: toneOf(idx.stats?.totalPct ?? null) });
  return { title, subtitle: `${dotDate(result.axis[0])} ~ ${dotDate(result.axis[result.axis.length - 1])}`, rows, footer: '시장 데이터 파일' };
}
```

`src/lib/ui/simulate/ResultView.svelte`: prop `onShare?: () => void`(주석 `/** 결과 공유(로그인했을 때만 넘긴다) */`)를 더하고, 아래를 `<script>`에 둬요.

```ts
  import type { CardCapture } from '../../share/shareStore.svelte';
  import { cardAlt, composeCard, readCardColors, simResultCardText } from '../../share/cardImage';
  let equityChart = $state<ReturnType<typeof EquityChart>>();
  let root = $state<HTMLElement>();
  /** 지금 보이는 수익 곡선으로 카드를 만든다. 거래 0건이라 곡선이 없으면 null(설계 4.1) */
  export function capture(): CardCapture | null {
    if (result.trades.length === 0 || !root) return null;
    const chart = equityChart?.screenshot();
    if (!chart) return null;
    const text = simResultCardText(done);
    return { canvas: composeCard(chart, text, readCardColors(root)), alt: cardAlt(text, '시뮬레이션 결과'), line: null };
  }
```

마크업: `<section class="result" … bind:this={root}>`, `<EquityChart bind:this={equityChart} … />`, 머리줄 `<p class="head">` 끝에 `{#if onShare}<button type="button" class="share" onclick={onShare}>결과 공유</button>{/if}`. `.share { margin-left: auto; min-height: var(--touch); padding: 0 12px; border-radius: 12px; background: var(--surface2); font-weight: 700; }`, `.head`에 `display: flex; align-items: center; gap: 6px; flex-wrap: wrap;`를 더해요.

`src/lib/ui/simulate/RunPanel.svelte`: prop `onShare?: () => void`를 더하고 `<ResultView bind:this={resultView} state={run} {colorConvention} {theme} {stale} {onEdit} {onShare} />`로 바꾼 뒤 내보내요.

```ts
  import type { CardCapture } from '../../share/shareStore.svelte';
  let resultView = $state<ReturnType<typeof ResultView>>();
  export function capture(): CardCapture | null {
    return resultView?.capture() ?? null;
  }
```

`src/lib/ui/screen/ValidationResult.svelte`: 바깥 `<div class="vr">`에 `bind:this={root}`, `<EquityChart bind:this={equityChart} … />`를 두고 내보내요.

```ts
  import type { CardCapture } from '../../share/shareStore.svelte';
  import { cardAlt, composeCard, readCardColors, validationCardText } from '../../share/cardImage';
  let equityChart = $state<ReturnType<typeof EquityChart>>();
  let root = $state<HTMLElement>();
  export function capture(): CardCapture | null {
    const chart = equityChart?.screenshot();
    if (!chart || !root) return null;
    const text = validationCardText(result, criteriaName);
    return { canvas: composeCard(chart, text, readCardColors(root)), alt: cardAlt(text, '검증 결과'), line: null };
  }
```

`src/routes/Compare.svelte`:

```ts
  import { canShare, openShare, type CardCapture } from '../lib/share/shareStore.svelte';
  import { built, shareTitle } from '../lib/share/snapshot';
  import { compareSnapshot } from '../lib/share/compact';
  import { cardAlt, compareCardLine, compareCardText, composeCard, readCardColors, toneOf } from '../lib/share/cardImage';
  import { orderRows } from '../lib/ui/compare/rows';
  // formatMetricValue·periodLabel은 compareText에서 이미 가져오거나 더한다

  let chartPanel = $state<ReturnType<typeof ChartPanel>>();
  const canShareCompare = $derived(canShare() && group !== undefined && items.some((i) => !i.hidden));

  /** 시세가 보이는 화면 캡처(설계 4.3). 불러오는 중이면 반쯤 그린 차트를 보내지 않는다 */
  function captureCard(): CardCapture | null {
    if (!group || ctl.progress) return null;
    const chart = chartPanel?.screenshot();
    if (!chart) return null;
    const ordered = orderRows(rows.filter((r) => !r.hidden), app.settings.boardOrder, null).slice(0, 5);
    const cells = ordered.map((r) => ({ name: r.name, value: r.value === null ? '—' : formatMetricValue(r.value, unit), tone: toneOf(r.value) }));
    const text = compareCardText({ title: shareTitle(group.name), period: periodLabel(period), metric: metricDef.label, at: now, rows: cells, provider: app.provider.id });
    return { canvas: composeCard(chart, text, readCardColors(document.documentElement)), alt: cardAlt(text, '비교 화면'), line: compareCardLine(cells.slice(0, 2), now) };
  }

  function shareCompare() {
    const g = group;
    if (!g) return;
    openShare({ kind: 'compare', name: g.name, profileId: app.meta.activeProfileId, build: () => built(compareSnapshot(g, app.settings)), capture: captureCard });
  }
```

`{#snippet bar()}`의 `<span class="title">…</span>` 앞에 `{#if canShareCompare}<button type="button" class="share" onclick={shareCompare}>공유</button>{/if}`를 두고, `<ChartPanel bind:this={chartPanel} … />`로 바꿔요. `.share`는 `min-height: var(--touch); padding: 0 12px; border-radius: 12px; background: var(--surface2); font-weight: 700; flex-shrink: 0;`.

`src/routes/Simulate.svelte`:
- `runSnap` 타입에 `criteria: SelectionCriteria; baskets: Basket[]; strategies: Strategy[]; collectedAt: string`을 더하고, `runCriteria(c)`에서 채워요(실행할 때의 기준·묶음·전략 사본, 설계 1.5-3).

```ts
    const snapC = $state.snapshot(c) as SelectionCriteria;
    const snapB = $state.snapshot(app.baskets) as Basket[];
    const snapS = $state.snapshot(app.strategies) as Strategy[];
    runSnap = {
      name: c.name,
      capital: c.capital,
      macro: { used: usesMacro(c), lookback: { usdkrw: fx.usdkrw.trend.lookback, wti: fx.wti.trend.lookback } },
      flow: flowRunSnap(c),
      fin: finRunSnap(c),
      criteria: snapC,
      baskets: snapB,
      strategies: snapS,
      collectedAt: info?.collectedAt ?? '',
    };
    vctl.run({ criteria: c, strategies: snapS, baskets: snapB });
```

- 공유 두 개를 더해요.

```ts
  import { canShare, openShare } from '../lib/share/shareStore.svelte';
  import { simResultSnapshot, validationSnapshot } from '../lib/share/compact';
  let validationView = $state<ReturnType<typeof ValidationResult>>();

  function shareSim() {
    const st = ctl.state;
    if (st.kind !== 'done') return;
    openShare({
      kind: 'simResult',
      name: st.meta.strategy.name,
      profileId: app.meta.activeProfileId,
      build: (hideCapital) => simResultSnapshot(st, { hideCapital, now: Date.now() }),
      capture: () => panel?.capture() ?? null,
    });
  }
  function shareValidation() {
    const snap = runSnap;
    const result = vctl.result;
    if (vctl.state !== 'done' || !snap || !result) return;
    openShare({
      kind: 'validation',
      name: snap.name,
      profileId: app.meta.activeProfileId,
      build: (hideCapital) => validationSnapshot({ result, criteria: snap.criteria, baskets: snap.baskets, strategies: snap.strategies, collectedAt: snap.collectedAt }, { hideCapital, now: Date.now() }),
      capture: () => validationView?.capture() ?? null,
    });
  }
```

- `<RunPanel … onShare={canShare() ? shareSim : undefined} />`
- 검증 결과 줄: `기준 고치기` 단추 옆에 `{#if canShare()}<button type="button" class="share" onclick={shareValidation}>결과 공유</button>{/if}`, `<ValidationResult bind:this={validationView} … />`

- [ ] **Step 4: 통과하는지 확인해요**

Run: `corepack pnpm test src/lib/share src/lib/ui src/lib/chart src/routes`
Expected: PASS(기존 차트·비교·시뮬레이션 테스트 포함)

Run: `corepack pnpm check`
Expected: 오류 0

- [ ] **Step 5: 커밋해요**

```bash
git add src/lib/share/cardImage.ts src/lib/share/cardImage.test.ts src/lib/chart/lwcStub.ts src/lib/chart/CompareChart.svelte src/lib/ui/compare/ChartPanel.svelte src/lib/ui/simulate/EquityChart.svelte src/lib/ui/simulate/EquityChart.test.ts src/routes/Compare.svelte src/routes/Compare.test.ts src/lib/ui/simulate/ResultView.svelte src/lib/ui/simulate/ResultView.test.ts src/lib/ui/simulate/RunPanel.svelte src/lib/ui/screen/ValidationResult.svelte src/lib/ui/screen/ValidationResult.test.ts src/routes/Simulate.svelte
git commit -m "feat(share): 비교·결과 화면에 공유 진입점을 두고 차트 캡처로 카드 이미지를 합성함" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Task 13: 카카오 카드 — 캡처 업로드·지우기·종류별 요약 문구

설계 1.5-8, 4.2(캡처 미리 보기·체크·링크 뒤 순서·닫을 때 지우기·「이미지 빼고 보내기」·attempt), 4.4(kakao.ts·CSP 주석), 4.5(카드 설명 두 줄), 5.3, 7절(업로드 실패·시간 초과·SDK 변화), 8절(aria-live·대체 글·label), 6.3(`ShareDialog.test.ts`·`kakao.test.ts`).

**Files:**
- Modify: `src/lib/share/kakao.ts`, Test: `src/lib/share/kakao.test.ts`
- Modify: `src/lib/share/ShareDialog.svelte`, Test: `src/lib/share/ShareDialog.test.ts`
- Modify: `kakao-csp.config.ts` (주석만)

**Interfaces:**
- Consumes: Task 6 `cardLines`, Task 11 `CardCapture`·`ShareRequest.capture`, Task 12 `cardFile`, Task 1 `kindLabel`, `preloadKakao`·`sendKakao`·`kakaoLinkFits`(`@sch0718/kakao-share`)
- Produces (`kakao.ts`, 설계 4.4 그대로):

```ts
export interface KakaoImage { url: string; width: number; height: number }
export const UPLOAD_TIMEOUT_MS = 15_000;
export const FIXED_IMAGE = { width: 800, height: 400 } as const;
/** preloadKakao 뒤에 부른다. https 주소이고 200×200 이상일 때만 돌려주고, 아니면 null(카드는 고정 이미지) */
export function uploadCardImage(file: File, timeoutMs?: number): Promise<KakaoImage | null>;
/** 실패는 무시한다 */
export function deleteCardImage(url: string): void;
/** image가 없으면 종류별 고정 이미지(share/<kind>.png, 800×400) */
export function kakaoCard(snapshot: ShareSnapshot, url: string, opts?: { names?: SymbolNames; image?: KakaoImage | null; line?: string | null }): KakaoCard;
```

- [ ] **Step 1: 실패하는 테스트를 써요**

`src/lib/share/kakao.test.ts`의 `describe('kakaoCard', …)`를 아래로 바꾸고, 업로드 테스트를 더해요(import에 `deleteCardImage`, `uploadCardImage`, `afterEach`, `vi`, `simResultFixture`를 더해요).

```ts
describe('kakaoCard', () => {
  const group = groupSnapshot({
    id: 'g-secret-id',
    name: '반도체',
    items: [
      { symbol: '005930', colorSlot: 1, hidden: false, addedAt: 1 },
      { symbol: '000660', colorSlot: 2, hidden: false, addedAt: 2 },
    ],
  });

  it('이미지가 없으면 종류별 고정 이미지(800×400), 설명은 카드 두 줄', () => {
    const names = new Map([['005930', '삼성전자']]);
    expect(kakaoCard(group, URL_, { names })).toEqual({
      title: '그룹 공유: 반도체',
      description: '종목 2개: 삼성전자, 000660',
      imageUrl: 'https://gazua.sch0718.dev/share/group.png',
      imageWidth: 800,
      imageHeight: 400,
      url: URL_,
      buttonTitle: '열어 보기',
    });
  });

  it('올린 캡처가 있으면 그 주소와 크기, 결과 종류는 두 줄 요약', () => {
    const card = kakaoCard(simResultFixture(), URL_, { image: { url: 'https://k.kakaocdn.net/dn/abc.jpg', width: 1600, height: 800 } });
    expect(card).toMatchObject({ title: '시뮬레이션 결과 공유: 눌림목', imageUrl: 'https://k.kakaocdn.net/dn/abc.jpg', imageWidth: 1600, imageHeight: 800 });
    expect(card.description!.split('\n')).toHaveLength(2);
    expect(card.description).toContain('총수익률');
  });

  it('스냅샷 원문이나 원본 ID를 넣지 않는다', () => {
    const card = JSON.stringify(kakaoCard(group, URL_));
    expect(card).not.toContain('g-secret-id');
    expect(card).not.toContain('"kind"');
    expect(card).not.toContain('colorSlot');
  });

  it('전략은 요약 두 줄만 쓰고 비공개 자금은 그대로 비공개다', () => {
    const st = { ...newStrategy(0, null, '눌림목'), id: 's1' };
    st.capital.initial = 123_456_789;
    const card = kakaoCard(strategySnapshot(st, { groups: [] }, { hideCapital: true }), URL_);
    expect(card.title).toBe('전략 공유: 눌림목');
    expect(card.description?.split('\n')).toHaveLength(2);
    expect(card.description).not.toContain('123,456,789');
  });
});

describe('카드 이미지 업로드', () => {
  const file = new File(['x'], 'gazua-card.jpg', { type: 'image/jpeg' });
  const share = (o: Record<string, unknown>) => Object.assign(globalThis, { Kakao: { Share: o } });
  afterEach(() => Reflect.deleteProperty(globalThis, 'Kakao'));

  it('파일 배열로 올리고 https·200×200 이상만 받는다', async () => {
    const uploadImage = vi.fn(async () => ({ infos: { original: { url: 'https://k.kakaocdn.net/a.jpg', width: 1600, height: 800 } } }));
    share({ uploadImage });
    expect(await uploadCardImage(file)).toEqual({ url: 'https://k.kakaocdn.net/a.jpg', width: 1600, height: 800 });
    expect(uploadImage).toHaveBeenCalledWith({ file: [file] });
    share({ uploadImage: async () => ({ infos: { original: { url: 'http://k.kakaocdn.net/a.jpg', width: 1600, height: 800 } } }) });
    expect(await uploadCardImage(file)).toBeNull();
    share({ uploadImage: async () => ({ infos: { original: { url: 'https://k.kakaocdn.net/a.jpg', width: 150, height: 150 } } }) });
    expect(await uploadCardImage(file)).toBeNull();
  });

  it('SDK에 uploadImage가 없거나 실패하면 null', async () => {
    share({});
    expect(await uploadCardImage(file)).toBeNull();
    share({ uploadImage: async () => Promise.reject(new Error('403')) });
    expect(await uploadCardImage(file)).toBeNull();
  });

  it('시간이 지나면 null이고, 늦게 온 응답의 이미지는 지운다', async () => {
    let resolve!: (v: unknown) => void;
    const deleteImage = vi.fn(async () => ({}));
    share({ uploadImage: () => new Promise((r) => (resolve = r)), deleteImage });
    expect(await uploadCardImage(file, 5)).toBeNull();
    resolve({ infos: { original: { url: 'https://k.kakaocdn.net/late.jpg', width: 1600, height: 800 } } });
    await new Promise((r) => setTimeout(r, 0));
    expect(deleteImage).toHaveBeenCalledWith({ imageUrl: 'https://k.kakaocdn.net/late.jpg' });
  });

  it('지우기 실패는 무시한다', async () => {
    share({ deleteImage: async () => Promise.reject(new Error('x')) });
    expect(() => deleteCardImage('https://k.kakaocdn.net/a.jpg')).not.toThrow();
    share({});
    expect(() => deleteCardImage('https://k.kakaocdn.net/a.jpg')).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});
```

`src/lib/share/ShareDialog.test.ts`: 기존 「SDK가 준비되면 공유 링크와 스냅샷 요약만 담아 보낸다」의 설명 기대값을 `'종목 1개: 삼성전자'`로 바꾸고(카드 설명이 `cardLines`를 써요), `fakeKakao()`가 `Share`에 업로드·지우기를 함께 붙이게 바꿔요.

```ts
    function fakeKakao(upload: (o: { file: File[] }) => Promise<unknown> = async () => ({ infos: { original: { url: 'https://k.kakaocdn.net/card.jpg', width: 1600, height: 800 } } })) {
      let initialized = false;
      const Share = { sendDefault: vi.fn(), uploadImage: vi.fn(upload), deleteImage: vi.fn(async () => ({})) };
      const init = vi.fn(() => {
        initialized = true;
        Object.assign(sdk, { Share });
      });
      const sdk = { init, isInitialized: () => initialized };
      Object.assign(window, { Kakao: sdk });
      return { init, Share };
    }
```

같은 `describe('카카오톡으로 보내기', …)` 안에 더해요.

```ts
    const shotCanvas = () =>
      ({
        width: 1600,
        height: 800,
        toDataURL: (type: string) => `data:${type};base64,AAAA`,
        toBlob: (cb: (b: Blob) => void) => cb(new Blob(['jpeg'], { type: 'image/jpeg' })),
      }) as unknown as HTMLCanvasElement;
    const ALT = '반도체 비교 화면 캡처: 1개월 · 등락률 · 10.29 14:32 기준, 삼성전자 +3.2%';
    const cmpReq = (capture: ShareRequest['capture'] = vi.fn(() => ({ canvas: shotCanvas(), alt: ALT, line: '삼성전자 +3.2% · 10.29 14:32 기준' }))): ShareRequest => ({
      kind: 'compare',
      name: '반도체',
      profileId: 'p1',
      build: () => built({ kind: 'compare', v: 1, title: '반도체', symbols: ['005930'], view: { period: { unit: 'M', n: 1 }, metric: 'change', benchmark: 'AUTO', boardOrder: 'value' } }),
      capture,
    });
    async function open(req: ShareRequest, kakao: { appKey: string } | null = KAKAO) {
      const onclose = vi.fn();
      const view = render(ShareDialog, { request: req, sync: sync(), onclose, copy: vi.fn(async () => {}), universe, kakao });
      return { view, onclose };
    }
    const makeLink = async () => {
      await fireEvent.click(screen.getByRole('button', { name: '링크 만들기' }));
      await waitFor(() => expect(screen.getByLabelText('공유 링크')).toBeTruthy());
    };
    const ready = async () => {
      const b = (await screen.findByRole('button', { name: '카카오톡으로 보내기' })) as HTMLButtonElement;
      await waitFor(() => expect(b.disabled).toBe(false));
      return b;
    };
    const sentImage = (sdk: ReturnType<typeof fakeKakao>) => (sdk.Share.sendDefault.mock.calls[0]![0] as { content: { imageUrl: string; description: string } }).content;

    it('키가 있고 캡처가 있으면 열 때 한 번 캡처해 data: URL로 미리 보고, 체크와 안내를 둔다', async () => {
      fakeKakao();
      const capture = vi.fn(() => ({ canvas: shotCanvas(), alt: ALT, line: null }));
      await open(cmpReq(capture));
      expect(capture).toHaveBeenCalledTimes(1);
      const img = screen.getByRole('img', { name: ALT }) as HTMLImageElement;
      expect(img.src.startsWith('data:image/jpeg')).toBe(true);
      expect((screen.getByLabelText('화면 캡처 함께 보내기') as HTMLInputElement).checked).toBe(true);
      expect(screen.getByText('링크를 만들면 이 캡처를 카카오 서버에 바로 올려요(카카오톡 카드에 넣으려고요). 링크를 철회해도 카카오톡으로 보낸 캡처는 지울 수 없어요.')).toBeTruthy();
    });

    it('카카오 키가 없으면 캡처하지 않고, 캡처가 null이면 캡처 부분을 숨긴다', async () => {
      const capture = vi.fn(() => null);
      await open(cmpReq(capture), null);
      expect(capture).not.toHaveBeenCalled();
      await open(cmpReq(vi.fn(() => null)));
      expect(screen.queryByLabelText('화면 캡처 함께 보내기')).toBeNull();
    });

    it('링크를 만들면 캡처를 올리고(캡처 올리는 중…) 그 이미지로 보낸다. 보낸 뒤 닫으면 지우지 않는다', async () => {
      let finish!: (v: unknown) => void;
      const sdk = fakeKakao(() => new Promise((r) => (finish = r)));
      const { view } = await open(cmpReq());
      await makeLink();
      expect(await screen.findByRole('button', { name: '캡처 올리는 중…' })).toBeTruthy();
      finish({ infos: { original: { url: 'https://k.kakaocdn.net/card.jpg', width: 1600, height: 800 } } });
      await fireEvent.click(await ready());
      expect(sentImage(sdk).imageUrl).toBe('https://k.kakaocdn.net/card.jpg');
      expect(sentImage(sdk).description).toBe('종목 1개 · 1개월 등락률\n삼성전자 +3.2% · 10.29 14:32 기준');
      await view.rerender({ request: null, sync: sync(), onclose: () => {}, kakao: KAKAO });
      expect(sdk.Share.deleteImage).not.toHaveBeenCalled();
    });

    it('체크를 끄면 올리지 않고 고정 이미지로 보낸다', async () => {
      const sdk = fakeKakao();
      await open(cmpReq());
      await fireEvent.click(screen.getByLabelText('화면 캡처 함께 보내기'));
      await makeLink();
      await fireEvent.click(await ready());
      expect(sdk.Share.uploadImage).not.toHaveBeenCalled();
      expect(sentImage(sdk).imageUrl).toBe('https://app.example.test/share/compare.png');
    });

    it('업로드에 실패하면 고정 이미지로 돌아가고 안내한다', async () => {
      const sdk = fakeKakao(async () => Promise.reject(new Error('403')));
      await open(cmpReq());
      await makeLink();
      await fireEvent.click(await ready());
      expect(screen.getByText('캡처를 올리지 못해 기본 그림으로 보내요')).toBeTruthy();
      expect(sentImage(sdk).imageUrl).toBe('https://app.example.test/share/compare.png');
    });

    it('보내지 않고 닫으면 올린 이미지를 지운다', async () => {
      const sdk = fakeKakao();
      const { view } = await open(cmpReq());
      await makeLink();
      await ready();
      await view.rerender({ request: null, sync: sync(), onclose: () => {}, kakao: KAKAO });
      expect(sdk.Share.deleteImage).toHaveBeenCalledWith({ imageUrl: 'https://k.kakaocdn.net/card.jpg' });
    });

    it('이미지 빼고 보내기: 지우고 고정 이미지 카드로 바꾼다', async () => {
      const sdk = fakeKakao();
      await open(cmpReq());
      await makeLink();
      await ready();
      await fireEvent.click(screen.getByRole('button', { name: '이미지 빼고 보내기' }));
      expect(sdk.Share.deleteImage).toHaveBeenCalledWith({ imageUrl: 'https://k.kakaocdn.net/card.jpg' });
      await fireEvent.click(await ready());
      expect(sentImage(sdk).imageUrl).toBe('https://app.example.test/share/compare.png');
    });

    it('업로드 중에 이미지를 빼면 카드는 바로 고정 이미지, 늦게 온 응답의 이미지도 지운다', async () => {
      let finish!: (v: unknown) => void;
      const sdk = fakeKakao(() => new Promise((r) => (finish = r)));
      await open(cmpReq());
      await makeLink();
      await screen.findByRole('button', { name: '캡처 올리는 중…' });
      await fireEvent.click(screen.getByRole('button', { name: '이미지 빼고 보내기' }));
      await fireEvent.click(await ready());
      expect(sentImage(sdk).imageUrl).toBe('https://app.example.test/share/compare.png');
      finish({ infos: { original: { url: 'https://k.kakaocdn.net/late.jpg', width: 1600, height: 800 } } });
      await waitFor(() => expect(sdk.Share.deleteImage).toHaveBeenCalledWith({ imageUrl: 'https://k.kakaocdn.net/late.jpg' }));
    });
```

- [ ] **Step 2: 실패하는지 확인해요**

Run: `corepack pnpm test src/lib/share/kakao.test.ts src/lib/share/ShareDialog.test.ts`
Expected: FAIL. `uploadCardImage`·`deleteCardImage`가 없고, `kakaoCard`가 세 번째 인자를 이름표로 받으며, 대화 상자에 캡처 부분이 없어요.

- [ ] **Step 3: 구현해요**

`src/lib/share/kakao.ts`(`readKakaoConfig`는 그대로):

```ts
// 카카오톡으로 공유 링크 보내기. 키는 빌드 때 넣고(VITE_KAKAO_JS_KEY), 없으면 기능을 끈다(링크 복사만).
// 메시지에는 만든 공유 링크와 스냅샷의 사람이 읽는 요약, 카드 이미지만 쓴다. 스냅샷 원문(JSON)·원본 ID·키는 넣지 않는다.
// 카드 이미지 업로드는 SDK 2.8.4의 Share.uploadImage(POST https://kapi.kakao.com/v2/api/talk/message/image/upload, FormData)다.
// @sch0718/kakao-share 0.1.1의 KakaoSdk 타입에는 없어서 여기서 넓혀 부른다(근거: 설계 4.4, kakao.min.js 88,359 B, 2026-10-29).
import type { KakaoCard, KakaoShareConfig } from '@sch0718/kakao-share';
import { kindLabel } from './kinds';
import { cardLines, type SymbolNames } from './shareText';
import type { ShareSnapshot } from './snapshot';

export interface KakaoImage {
  url: string;
  width: number;
  height: number;
}
interface KakaoShareImages {
  uploadImage(o: { file: File[] | FileList }): Promise<{ infos: { original: KakaoImage } }>;
  deleteImage(o: { imageUrl: string }): Promise<unknown>;
}
const images = (): Partial<KakaoShareImages> | undefined => (globalThis as { Kakao?: { Share?: Partial<KakaoShareImages> } }).Kakao?.Share;

export const UPLOAD_TIMEOUT_MS = 15_000;
/** 고정 이미지는 캡처 카드와 같은 2:1이다(설계 1.5-9) */
export const FIXED_IMAGE = { width: 800, height: 400 } as const;

const validImage = (o: unknown): o is KakaoImage => {
  const x = o as Partial<KakaoImage> | undefined;
  return typeof x?.url === 'string' && x.url.startsWith('https://') && typeof x.width === 'number' && typeof x.height === 'number' && x.width >= 200 && x.height >= 200;
};

/** 실패는 무시한다 */
export function deleteCardImage(url: string): void {
  try {
    Promise.resolve(images()?.deleteImage?.({ imageUrl: url })).catch(() => {});
  } catch {
    // SDK가 동기로 던져도 무시한다
  }
}

/** preloadKakao 뒤에 부른다. https 주소이고 200×200 이상일 때만 돌려주고, 아니면 null(카드는 고정 이미지) */
export async function uploadCardImage(file: File, timeoutMs = UPLOAD_TIMEOUT_MS): Promise<KakaoImage | null> {
  const upload = images()?.uploadImage;
  if (!upload) return null;
  let sent: Promise<{ infos: { original: KakaoImage } }>;
  try {
    sent = upload({ file: [file] });
  } catch {
    return null;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'timeout'>((r) => (timer = setTimeout(() => r('timeout'), timeoutMs)));
  try {
    const r = await Promise.race([sent, late]);
    if (r === 'timeout') {
      // 늦게 온 응답의 이미지는 보내지 않으므로 지운다
      sent.then((x) => validImage(x?.infos?.original) && deleteCardImage(x.infos.original.url)).catch(() => {});
      return null;
    }
    const o = r?.infos?.original;
    return validImage(o) ? { url: o.url, width: o.width, height: o.height } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 카드 제목은 `{종류} 공유: {제목}`, 설명은 두 줄(설계 4.5). image가 없으면 종류별 고정 이미지(share/<kind>.png, 800×400) */
export function kakaoCard(snapshot: ShareSnapshot, url: string, opts: { names?: SymbolNames; image?: KakaoImage | null; line?: string | null } = {}): KakaoCard {
  const image = opts.image ?? null;
  return {
    title: `${kindLabel(snapshot.kind)} 공유: ${snapshot.title}`,
    description: cardLines(snapshot, opts.names, opts.line ?? null).slice(0, 2).join('\n'),
    // 카카오가 서버에서 받아 가는 이미지라 공유 링크와 같은 출처의 절대 주소를 쓴다
    imageUrl: image ? image.url : new URL(`share/${snapshot.kind}.png`, url).href,
    imageWidth: image ? image.width : FIXED_IMAGE.width,
    imageHeight: image ? image.height : FIXED_IMAGE.height,
    url,
    buttonTitle: '열어 보기',
  };
}
```

`src/lib/share/ShareDialog.svelte` 인스턴스 스크립트에 캡처·업로드 상태를 더하고, 카카오 `$effect`·`sendToKakao`·`close`를 바꿔요.

```ts
  import { untrack } from 'svelte';
  import { cardFile } from './cardImage';
  import { deleteCardImage, kakaoCard, readKakaoConfig, uploadCardImage, type KakaoImage } from './kakao';
  import type { CardCapture, ShareRequest } from './shareStore.svelte';

  // 캡처: 카카오 키가 있고 capture가 있으면 열 때 한 번(보이는 화면 그대로). null이면 캡처 부분을 숨기고 고정 이미지(설계 4.2)
  let shot = $state.raw<CardCapture | null>(null);
  let preview = $state<string | null>(null);
  /** 「화면 캡처 함께 보내기」. 링크 전 화면에서만 정한다 */
  let sendShot = $state(true);
  /** 「이미지 빼고 보내기」를 눌렀다(되돌리지 않는다) */
  let dropped = $state(false);
  let cardImage = $state.raw<KakaoImage | null>(null);
  let uploadNote = $state<string | null>(null);
  let sent = false;

  function takeShot(r: ShareRequest | null): CardCapture | null {
    if (!r?.capture || !kakao) return null;
    try {
      return r.capture();
    } catch {
      return null;
    }
  }
  /** 보내지 않은 캡처는 카카오 서버에서 지운다(설계 1.5-8) */
  function discardImage() {
    if (cardImage && !sent) deleteCardImage(cardImage.url);
    cardImage = null;
  }
  function resetShot(r: ShareRequest | null) {
    discardImage();
    sent = false;
    dropped = false;
    sendShot = true;
    uploadNote = null;
    shot = untrack(() => takeShot(r));
    try {
      preview = shot ? shot.canvas.toDataURL('image/jpeg', 0.85) : null;
    } catch {
      shot = null;
      preview = null;
    }
  }
```

요청이 바뀌는 `$effect`에 `untrack(() => resetShot(request));`를 더해요(`void request; attempt++; link = null; failed = null; rawOpen = false;` 다음).

카카오 단추 상태를 `let kakaoState = $state<'off' | 'loading' | 'uploading' | 'ready'>('off');`로 넓히고 `$effect`를 바꿔요.

```ts
  $effect(() => {
    if (!kakaoUrl || !kakao) {
      kakaoState = 'off';
      return;
    }
    let alive = true;
    kakaoState = 'loading';
    preloadKakao(kakao).then(
      async () => {
        if (!alive) return;
        const s = untrack(() => (sendShot && !dropped ? shot : null));
        if (s) {
          kakaoState = 'uploading';
          const file = await cardFile(s.canvas);
          const img = file ? await uploadCardImage(file) : null;
          // 다른 요청으로 바뀌었거나(alive) 이미지를 뺐으면(dropped) 늦게 온 응답은 버리고 그 이미지를 지운다
          if (!alive || dropped) {
            if (img) deleteCardImage(img.url);
            if (!alive) return;
          } else {
            cardImage = img;
            if (!img) uploadNote = '캡처를 올리지 못해 기본 그림으로 보내요';
          }
        }
        kakaoState = 'ready';
      },
      () => {
        if (alive) kakaoState = 'off';
      },
    );
    return () => {
      alive = false;
    };
  });

  function dropImage() {
    dropped = true;
    if (cardImage) deleteCardImage(cardImage.url);
    cardImage = null;
    if (kakaoState === 'uploading') kakaoState = 'ready';
  }

  function sendToKakao() {
    if (!link || !kakao) return;
    sent = true;
    const card = kakaoCard(link.snapshot, link.url, { names, image: dropped ? null : cardImage, line: shot?.line ?? null });
    if (!sendKakao(card, kakao)) showSnackbar('카카오톡을 열지 못했어요. 링크를 복사해 보내 주세요');
  }
```

`close()` 맨 앞에 `discardImage();`를 더하고, 끝의 상태 초기화에 `sent = false; dropped = false; sendShot = true; shot = null; preview = null; uploadNote = null;`를 더해요.

링크 화면(`{#if link}`)의 카카오 부분을 바꿔요.

```svelte
        {#if kakaoState !== 'off'}
          {#if preview && sendShot && !dropped}
            <div class="shot-mini">
              <img src={preview} alt={shot?.alt ?? ''} width="160" height="80" />
              <button type="button" class="ghost" onclick={dropImage}>이미지 빼고 보내기</button>
            </div>
          {/if}
          <div aria-live="polite">
            <button type="button" class="kakao" disabled={kakaoState !== 'ready'} onclick={sendToKakao}>
              {kakaoState === 'ready' ? '카카오톡으로 보내기' : kakaoState === 'uploading' ? '캡처 올리는 중…' : '카카오톡 준비 중…'}
            </button>
          </div>
          {#if uploadNote}<p class="hint">{uploadNote}</p>{/if}
        {/if}
```

링크 전 화면(`{:else if snapshot}` 분기의 원문 보기 다음, 자금 체크 앞)에 캡처 부분을 둬요.

```svelte
          {#if kakao && preview}
            <figure class="shot">
              <img src={preview} alt={shot?.alt ?? ''} width="400" height="200" />
            </figure>
            <label class="check">
              <input type="checkbox" bind:checked={sendShot} />
              화면 캡처 함께 보내기
            </label>
            <p class="hint">링크를 만들면 이 캡처를 카카오 서버에 바로 올려요(카카오톡 카드에 넣으려고요). 링크를 철회해도 카카오톡으로 보낸 캡처는 지울 수 없어요.</p>
          {/if}
```

`<style>`에 `.shot img { width: 100%; height: auto; border-radius: 12px; }`, `.shot-mini { display: flex; align-items: center; gap: 12px; }`, `.shot-mini img { border-radius: 8px; }`, `.ghost { min-height: var(--touch); padding: 0 12px; border-radius: 12px; background: var(--surface2); }`를 더해요.

`kakao-csp.config.ts`의 `KAKAO_SCRIPT_SOURCES` 위 주석 끝에 줄을 더해요(CSP 값은 바꾸지 않아요).

```ts
// 카드 캡처 업로드(Kakao.Share.uploadImage)는 SDK가 https://kapi.kakao.com으로 보낸다. 지금은 connect-src 'self' https: 안이다.
// 나중에 connect-src를 좁히면 https://kapi.kakao.com을 넣어야 한다(공유 확장 설계 4.4).
```

- [ ] **Step 4: 통과하는지 확인해요**

Run: `corepack pnpm test src/lib/share kakao-csp.config.test.ts`
Expected: PASS(CSP 테스트는 그대로 통과)

Run: `corepack pnpm check`
Expected: 오류 0

- [ ] **Step 5: 커밋해요**

```bash
git add src/lib/share/kakao.ts src/lib/share/kakao.test.ts src/lib/share/ShareDialog.svelte src/lib/share/ShareDialog.test.ts kakao-csp.config.ts
git commit -m "feat(share): 카카오톡 카드에 화면 캡처를 올리고 종류별 요약 두 줄과 고정 이미지를 씀" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 14: 고정 이미지·e2e·실연결 점검 문서·마무리 검증

설계 1.5-9·10·15, 4.6(고정 이미지·PWA), 6.5(e2e), 10절(실연결 점검), 4.4 「번들」, 4.9 「배포 순서」.

**Files:**
- Create: `scripts/build-share-images.mjs`, `public/share/{group,strategy,criteria,compare,simResult,validation}.png`(스크립트 산출물, 커밋)
- Create: `tests/share-images.test.mjs`
- Modify: `package.json` (`"build:share-images"`)
- Modify: `pwa.config.ts` (`globIgnores`에 `'share/**'`), Test: `pwa.config.test.ts`
- Create: `tests/e2e/share.spec.ts`
- Modify: `docs/live-check.md` (㉚ 항목)

**Interfaces:**
- Consumes: `loadTheme`·`FONT`(`scripts/motion/kit.mjs`), `public/icon.svg`, `playwright-core`의 `chromium`, Task 7 대기 값 키 `gazua:v1:share-import`와 `PendingImport` 모양, Task 8 확인 창 문구, `openApp`·`enterDemo`·`loadExampleGroup`·`leaderboardRows`·`FIXED_NOW`(`tests/e2e/helpers.ts`)
- Produces: 고정 PNG 6장(800×400), `corepack pnpm build:share-images`, e2e `share.spec.ts`

- [ ] **Step 1: 실패하는 테스트를 써요**

`tests/share-images.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
// src/lib/share/kinds.ts의 SHARE_KINDS와 같아야 한다(카카오 카드 고정 이미지 이름)
const kindsSource = readFileSync(new URL('src/lib/share/kinds.ts', root), 'utf8');
const KINDS = JSON.parse(kindsSource.match(/SHARE_KINDS = (\[[^\]]+\])/)[1].replaceAll("'", '"'));

test('종류마다 public/share/<kind>.png가 800×400 PNG로 있다', () => {
  assert.deepEqual(KINDS, ['group', 'strategy', 'criteria', 'compare', 'simResult', 'validation']);
  for (const kind of KINDS) {
    const png = readFileSync(new URL(`public/share/${kind}.png`, root));
    assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG', kind);
    // IHDR: 16~19 폭, 20~23 높이(빅 엔디언)
    assert.equal(png.readUInt32BE(16), 800, `${kind} width`);
    assert.equal(png.readUInt32BE(20), 400, `${kind} height`);
  }
});
```

`pwa.config.test.ts`의 `globIgnores`를 보는 테스트(33행 `expect(wb.globIgnores).toContain('help/**');` 근처)에 더해요.

```ts
    // 카카오 카드 고정 이미지는 카카오 서버만 받아 가므로 미리 저장하지 않는다(공유 확장 설계 4.6)
    expect(wb.globIgnores).toContain('share/**');
```

`tests/e2e/share.spec.ts`:

```ts
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { enterDemo, FIXED_NOW, leaderboardRows, openApp } from './helpers';

// 지금 e2e 빌드에는 동기화 설정이 없어 SharedView는 unavailable이다. 그래서 「내 앱에 가져오기」가 남기는 대기 값을
// 직접 넣고, 관문·온보딩 → 확인 창 → 저장 → 이동을 본다(설계 1.5-10, 6.5). SharedView 화면은 컴포넌트 테스트가 덮는다.
const KEY = 'gazua:v1:share-import';
const TITLE = '이 프로필에 저장할까요?';
const AT = Date.parse(FIXED_NOW);

// 받는 쪽 검사는 전략·기준의 빠진 필드를 기본값으로 채워 받으므로(설계 2.7 read) 최소 모양으로도 가져와진다
const compare = { kind: 'compare', v: 1, title: '반도체 공유', symbols: ['005930', '000660'], view: { period: { unit: 'M', n: 1 }, metric: 'change', benchmark: 'AUTO', boardOrder: 'value' } };
const group = (title: string) => ({ kind: 'group', v: 1, title, symbols: ['005930'] });
const strategy = { kind: 'strategy', v: 1, title: '눌림목 공유', strategy: { id: 'shared', name: '눌림목 공유', updatedAt: 0, universe: { kind: 'symbols', symbols: ['005930'] } }, capitalHidden: true };
const criteria = { kind: 'criteria', v: 1, title: '대형 우량 공유', criteria: { id: 'shared', name: '대형 우량 공유', updatedAt: 0 }, baskets: [], capitalHidden: false };
const pending = (from: string, snapshot: unknown) => ({ id: `e2e-${from}-${Math.random().toString(36).slice(2)}`, from, snapshot, at: AT });

/** addInitScript는 다시 불러올 때마다 돌아 값을 다시 심으므로 쓰지 않는다. 한 번만 넣고 다시 불러온다(설계 6.5) */
async function stash(page: Page, value: unknown): Promise<void> {
  await page.evaluate(([k, v]) => sessionStorage.setItem(k, v), [KEY, JSON.stringify(value)] as const);
  await page.reload();
}

async function expectNoSeriousViolations(page: Page, state: string): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const bad = results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' ; ')}`);
  expect(bad, `${state}: axe violations`).toEqual([]);
}

test('온보딩 전: 첫 실행이면 온보딩이 먼저 뜨고, 데모로 둘러보기 뒤 확인 창에서 비교 화면을 저장한다', async ({ page }) => {
  await openApp(page);
  await stash(page, pending('compare', compare));
  await expect(page.getByRole('button', { name: '데모로 둘러보기' })).toBeVisible();
  await expect(page.getByText(TITLE)).toHaveCount(0);
  await page.getByRole('button', { name: '데모로 둘러보기' }).click();
  const sheet = page.getByRole('dialog', { name: TITLE });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText('그룹 「반도체 공유」 · 종목 2개')).toBeVisible();
  await expectNoSeriousViolations(page, '확인 창');
  await sheet.getByRole('button', { name: '저장' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page).toHaveURL(/#\/compare\/[^/]+$/);
  await expect(page.getByRole('tab', { name: '반도체 공유' })).toHaveCount(1);
  await expect(leaderboardRows(page)).toHaveCount(2);
  await expectNoSeriousViolations(page, '가져온 비교 화면');
});

test('온보딩 후: 같은 이름 그룹(기본 그룹 「내 관심」)이 있으면 2를 붙여 바로 확인 창에서 저장한다', async ({ page }) => {
  await openApp(page);
  await enterDemo(page);
  await stash(page, pending('group', group('내 관심')));
  const sheet = page.getByRole('dialog', { name: TITLE });
  await expect(sheet.getByText('같은 이름이 있어 「내 관심 2」로 저장해요')).toBeVisible();
  await sheet.getByRole('button', { name: '저장' }).click();
  await expect(page.getByRole('tab', { name: '내 관심 2' })).toHaveCount(1);
});

test('저장하지 않기: 아무것도 생기지 않고 다시 열어도 창이 뜨지 않는다', async ({ page }) => {
  await openApp(page);
  await enterDemo(page);
  await stash(page, pending('strategy', strategy));
  const sheet = page.getByRole('dialog', { name: TITLE });
  await expect(sheet.getByText('초기 자금은 기본값으로 저장해요')).toBeVisible();
  await sheet.getByRole('button', { name: '저장하지 않기' }).click();
  await expect(sheet).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('비교할 종목을 추가해 보세요')).toBeVisible();
  await expect(page.getByText(TITLE)).toHaveCount(0);
  await page.goto('./#/simulate');
  await expect(page.getByText('눌림목 공유')).toHaveCount(0);
});

test('검증 결과에서 온 기준: ② 안내 뒤 저장하면 기준 편집으로 간다', async ({ page }) => {
  await openApp(page);
  await enterDemo(page);
  await stash(page, pending('validation', criteria));
  const sheet = page.getByRole('dialog', { name: TITLE });
  await expect(sheet.getByText('② 매매 규칙은 함께 오지 않아요. 저장한 뒤 매매 규칙을 골라 주세요')).toBeVisible();
  await expectNoSeriousViolations(page, '기준 확인 창');
  await sheet.getByRole('button', { name: '저장' }).click();
  await expect(page).toHaveURL(/#\/simulate\/criteria\/[^/]+$/);
  await expectNoSeriousViolations(page, '가져온 기준 편집');
});
```

- [ ] **Step 2: 실패하는지 확인해요**

Run: `corepack pnpm test:scripts`
Expected: FAIL. `public/share/group.png`가 없어요(`ENOENT`).

Run: `corepack pnpm test pwa.config.test.ts`
Expected: FAIL. `globIgnores`에 `share/**`가 없어요.

- [ ] **Step 3: 구현해요**

`scripts/build-share-images.mjs`:

```js
// 카카오 카드 고정 이미지(공유 확장 설계 4.6): 종류별 800×400 PNG를 public/share/에 만든다.
// 라이트 토큰 배경, 왼쪽에 로고, 오른쪽에 종류 이름과 단순 도형. 숫자는 넣지 않는다.
// 새 의존성 없이 이미 개발 의존성인 playwright-core의 Chromium으로 찍는다. 손으로 돌리고(prebuild에 넣지 않는다) 결과 PNG를 커밋한다.
//   corepack pnpm build:share-images
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { FONT, loadTheme } from './motion/kit.mjs';

const root = new URL('../', import.meta.url);
const { light: t } = loadTheme([
  fileURLToPath(import.meta.resolve('@sch0718/ui-svelte/tokens.css')),
  fileURLToPath(new URL('src/lib/ui/tokens.css', root)),
]);
const icon = await readFile(new URL('public/icon.svg', root), 'utf8');
const viewBox = icon.match(/viewBox="([^"]+)"/)?.[1] ?? '0 0 512 512';
const logo = icon
  .replace(/^[\s\S]*?<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .trim();

// src/lib/share/kinds.ts의 SHARE_KIND_LABEL과 같은 이름(tests/share-images.test.mjs가 종류 목록을 맞춘다)
const KINDS = [
  ['group', '그룹', 'bars'],
  ['strategy', '전략', 'checks'],
  ['criteria', '선정 기준', 'checks'],
  ['compare', '비교 화면', 'lines'],
  ['simResult', '시뮬레이션 결과', 'lines'],
  ['validation', '검증 결과', 'bars'],
];

const SHAPES = {
  lines: [
    `<polyline points="0,110 70,70 140,90 210,30 300,50" fill="none" stroke="${t.s[0]}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`,
    `<polyline points="0,120 70,105 140,60 210,80 300,40" fill="none" stroke="${t.s[1]}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`,
    `<polyline points="0,100 70,115 140,110 210,120 300,95" fill="none" stroke="${t.s[2]}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`,
  ].join(''),
  bars: [40, 80, 60, 110, 90]
    .map((h, i) => `<rect x="${i * 60}" y="${130 - h}" width="40" height="${h}" rx="8" fill="${i === 3 ? t.accent : t.accentSoft}"/>`)
    .join(''),
  checks: [0, 1, 2]
    .map(
      (i) =>
        `<g transform="translate(0 ${i * 44})"><rect width="32" height="32" rx="8" fill="${t.accent}"/>` +
        `<polyline points="8,17 14,23 25,10" fill="none" stroke="${t.onAccent}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>` +
        `<rect x="48" y="10" width="${200 - i * 40}" height="12" rx="6" fill="${t.line}"/></g>`,
    )
    .join(''),
};

const svg = (label, shape) => `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400" viewBox="0 0 800 400">
  <rect width="800" height="400" fill="${t.bg}"/>
  <svg x="64" y="104" width="192" height="192" viewBox="${viewBox}">${logo}</svg>
  <text x="304" y="140" font-family="${FONT.replaceAll('"', "'")}" font-size="44" font-weight="800" fill="${t.t1}">${label}</text>
  <text x="304" y="180" font-family="${FONT.replaceAll('"', "'")}" font-size="22" fill="${t.t2}">가즈아 공유</text>
  <g transform="translate(304 214)">${SHAPES[shape]}</g>
</svg>`;

await mkdir(new URL('public/share/', root), { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 400 }, deviceScaleFactor: 1 });
  for (const [kind, label, shape] of KINDS) {
    await page.setContent(`<!doctype html><html><body style="margin:0">${svg(label, shape)}</body></html>`);
    const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 800, height: 400 } });
    await writeFile(new URL(`public/share/${kind}.png`, root), png);
    console.log(`public/share/${kind}.png: ${png.length} bytes`);
  }
} finally {
  await browser.close();
}
```

`package.json`의 `scripts`에 `"build:motion"` 다음 줄로 `"build:share-images": "node scripts/build-share-images.mjs",`를 더해요.

`pwa.config.ts`:

```ts
  // 도움말 그림(help/img, 약 400KB)은 도움말을 열 때 받아 담는다(아래 gazua-help).
  // 카카오 카드 고정 이미지(share/*.png)는 카카오 서버만 받아 가므로 미리 저장하지 않는다(공유 확장 설계 4.6).
  // Firebase Auth 청크와 같은 도메인의 로그인 도우미는 로그인할 때만 받는다(AUTH_GLOB_IGNORES).
  globIgnores: ['help/**', 'share/**', ...AUTH_GLOB_IGNORES],
```

이미지를 만들어요.

Run: `corepack pnpm build:share-images`
Expected: `public/share/group.png: … bytes`부터 `validation.png`까지 여섯 줄. Chromium이 없다는 오류가 나면 `corepack pnpm exec playwright install chromium`을 한 번 돌리고 다시 해요. 만든 PNG를 열어 로고·글자가 잘리지 않았는지 눈으로 확인해요.

`docs/live-check.md` 끝(㉘ 다음)에 더해요.

```markdown
## ㉚ 공유 확장: 카카오 캡처 업로드·카드·인앱 브라우저·크기

- **무엇을**: 공유 확장(docs/superpowers/specs/2026-10-29-share-expansion-design.md 10절)을 실제 환경에서.
  - 운영 도메인에서 `Kakao.Share.uploadImage`가 성공하는지(등록 도메인·앱 키 권한), 돌려준 주소의 호스트와 크기 값.
  - 업로드한 800×400(실제 1600×800) JPEG와 고정 PNG가 카카오톡 카드(PC·모바일)에서 잘리지 않는지.
  - `deleteImage` 뒤 그 주소가 더는 열리지 않는지, 이미 보낸 메시지의 이미지는 남는지. 카카오 업로드 이미지의 보관 기간(카카오 문서).
  - 3년 일봉 실제 KIS 결과·실제 시장 파일 검증 결과의 스냅샷 크기(설계 3.5 예산과 비교).
  - 받은 사람이 PWA 옛 버전일 때 새 종류 링크가 어떻게 보이는지, 새 버전 배포 뒤 `unsupported` 문구가 나오는지.
  - 카카오톡 인앱 브라우저(Android·iOS)에서 `kakaotalk://web/openExternal?url=`이 기본 브라우저를 여는지. iOS 홈 화면 PWA와 Safari가 저장소를 따로 쓰는지.
  - Workers Free 실행당 CPU 10 ms 안에서 100 KiB 결과 스냅샷 검사가 끝나는지(로컬 `wrangler dev`에서 설계 3.5의 두 고정 데이터와 100 KiB 경계 스냅샷으로 재요).
- **어떻게**: Worker를 먼저 배포하고 앱을 배포해요(옛 Worker는 새 종류를 거절해요). 비교·시뮬레이션 결과·검증 결과를 각각 공유해 카카오톡 PC·Android·iOS로 받아 봐요.
- **바꿀 곳**: 업로드·카드는 `src/lib/share/kakao.ts`·`ShareDialog.svelte`, 인앱 안내는 `src/lib/share/inApp.ts`·`src/routes/SharedView.svelte`(스킴이 안 되면 단추를 빼고 `오른쪽 위 ⋮ › 다른 브라우저로 열기`를 글로 안내), 크기는 `src/lib/share/compact.ts`, CPU가 넘으면 `src/lib/share/checkResult.ts`의 동일성 비교를 줄여요.
- 결과:
```

- [ ] **Step 4: 통과하는지 확인해요**

Run: `corepack pnpm test:scripts && corepack pnpm test pwa.config.test.ts`
Expected: PASS

Run: `corepack pnpm check:e2e`
Expected: 오류 0

Run: `corepack pnpm e2e tests/e2e/share.spec.ts`
Expected: 모든 뷰포트 프로젝트(phone, tablet-portrait, tablet-landscape, desktop)에서 4개 테스트 통과(phone-narrow는 이 파일을 돌리지 않아요)

- [ ] **Step 5: 전체 검증을 돌리고 번들 크기를 기록해요**

Run(각각):
- `corepack pnpm check` → 오류 0
- `corepack pnpm check:e2e` → 오류 0
- `corepack pnpm test` → 전부 통과
- `corepack pnpm test:scripts` → 전부 통과
- `corepack pnpm --filter sync-worker check` → 오류 0
- `corepack pnpm --filter sync-worker test` → 전부 통과
- `corepack pnpm e2e` → 기존·새 e2e 전부 통과
- `corepack pnpm build` → 성공

번들 크기는 변경 전후를 같은 방법으로 재요. `git stash`는 다른 세션과 공유되므로 쓰지 않고, `main`을 별도 작업 트리로 꺼내 재요.

```bash
corepack pnpm build
for f in dist/assets/*.js; do echo "$(wc -c < "$f") $(gzip -c "$f" | wc -c) $(basename "$f")"; done | sort -k3 > /tmp/share-size-after.txt
git worktree add /tmp/gazua-size-main main
(cd /tmp/gazua-size-main && corepack pnpm install --frozen-lockfile && corepack pnpm build && for f in dist/assets/*.js; do echo "$(wc -c < "$f") $(gzip -c "$f" | wc -c) $(basename "$f")"; done | sort -k3 > /tmp/share-size-before.txt)
git worktree remove --force /tmp/gazua-size-main
corepack pnpm --filter sync-worker exec wrangler deploy --dry-run --outdir /tmp/sync-worker-after
```

Expected: 두 파일의 각 줄은 `raw gzip 파일명`이에요. 주 청크(`index-*.js`)와 전체 합계의 raw·gzip 전후를, Worker 산출물(`/tmp/sync-worker-after`) 크기와 함께 PR 본문용 메모로 남겨요(이 저장소에 파일로 커밋하지 않아요). Worker 변경 전 크기는 `/tmp/gazua-size-main`을 지우기 전에 같은 `wrangler deploy --dry-run --outdir /tmp/sync-worker-before`로 재요.

- [ ] **Step 6: 커밋해요**

```bash
git add scripts/build-share-images.mjs public/share package.json pwa.config.ts pwa.config.test.ts tests/share-images.test.mjs tests/e2e/share.spec.ts docs/live-check.md
git commit -m "feat(share): 카카오 카드 고정 이미지와 가져오기 e2e, 실연결 점검 항목을 더함" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

PR을 열 때(이 계획 범위 밖, 사용자가 정해요) 본문에 번들 크기 전후, 배포 순서(Worker 먼저), 실연결 점검 ㉚, KIS 약관 결정(사용자 결정 5)을 적어요.

---

## 이번에 하지 않는 것

설계 1.6 그대로예요.
- 받은 결과의 저장(결과는 SharedView에서만 보이고, 가져오면 규칙만 저장해요)
- SharedView 안의 거래별 차트 시트(원시 일봉을 보내지 않아요)
- 받은 비교 화면을 가져오기 전에 그 자리에서 시세로 보여 주기
- 캡처 이미지를 스냅샷이나 D1에 넣기(캡처는 카카오 서버로만 가요)
- 로그인한 초대 대상 공유, 공동 편집, 공유 목록 공개
- 서버 변경(D1 스키마, 한도, 엔드포인트). `checkShareSnapshot`의 종류만 넓혀요
- 토스 공급자 시세의 제3자 제공 조건 검토(설계 5.1에 확인 필요로 남아요)
- 내 성과(`#/performance`) 공유(금지 키 `orders`·`holdings`·`performance`가 막아요)
- 덜어 낸 것(설계 1.5-15): 거래의 수수료·세금, 선정 이력의 구간 끝 `to`, 캡처 파일의 5 MB 재시도, 고정 PNG의 PWA 미리 저장
- 동기화 설정을 넣은 두 번째 e2e 빌드(설계 1.5-10)

## 설계 대응표

| 설계 절 | Task |
|---|---|
| 1.3 사용자 결정 1·1-1 | 7, 8, 10, 14 |
| 1.3 사용자 결정 2 | 2, 12, 13 |
| 1.3 사용자 결정 3·3-1·3-2 | 3, 4, 5, 9, 10, 12 |
| 1.3 사용자 결정 4 | 6, 13, 14 |
| 1.3 사용자 결정 5 | Global Constraints, 14(PR 본문) |
| 1.3 사용자 결정 6 | 4, 5, 9, 10 |
| 1.3 사용자 결정 7 | 5, 7 |
| 1.3 사용자 결정 8 | 8, 10 |
| 1.4 정리(KIND 맵·too-large 문구) | 6 |
| 1.5-1 compare 1~10 / group 자르기 | 2, 7 |
| 1.5-2 `DoneMeta.symbols` | 4 |
| 1.5-3 `runSnap` 확장 | 12 |
| 1.5-4·5·6 곡선 %·건너뜀·이력 수준 | 4, 5 |
| 1.5-7 대기 값 30분·다시 검사 | 7 |
| 1.5-8 보내지 않은 캡처 지우기 | 13 |
| 1.5-9 고정 이미지 800×400 | 13, 14 |
| 1.5-10 e2e 범위 | 14 |
| 1.5-11 `leaveShared` | 7 |
| 1.5-12 read 모드 | 1, 2, 3 |
| 1.5-13 보내기 전 클라이언트 검사 | 4(`finishBuild`), 11 |
| 1.5-14 결과 종류 대기 값은 규칙만 | 7 |
| 2.1 종류·표시 이름 | 1, 6 |
| 2.2 공통 형식·반올림 | 3, 4, 5 |
| 2.3 compare | 2 |
| 2.4 simResult | 3, 4 |
| 2.5 validation·`VALUE_KEYS` | 1, 3, 5 |
| 2.6 자금 숨김 | 4, 5, 9, 10 |
| 2.7 검사 확장·종목 코드·깊이·열거값 | 1, 2, 3 |
| 3.1~3.5 축약과 크기 | 4, 5, 11 |
| 4.1 공유 요청 모양 | 11, 12 |
| 4.2 공유 대화 상자 | 11, 13 |
| 4.3 캡처와 카드 합성 | 12 |
| 4.4 kakao.ts·CSP·번들 | 13, 14 |
| 4.5 요약 문구 | 6 |
| 4.6 고정 이미지 | 14 |
| 4.7 받은 화면 | 9, 10 |
| 4.8 가져오기 | 7, 8 |
| 4.9 화면별 바뀌는 곳·배포 순서 | 11, 12, 14 |
| 5.1~5.4 보안·약관 | Global Constraints, 2, 3, 4, 7, 13 |
| 6.1~6.5 테스트 | 1~14 각 Step 1 |
| 7 오류 처리 | 6, 8, 10, 11, 13 |
| 8 접근성 | 8, 9, 10, 13, 14 |
| 10 실연결 점검 | 14 |
