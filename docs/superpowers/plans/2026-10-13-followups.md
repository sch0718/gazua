# 후속 작업 처리 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 2026-10-12 후속 작업 목록 중 아직 남은 16건(정확도·오류 안내·보안·운영·접근성)을 고친다.

**Architecture:** 기존 구조를 바꾸지 않고 항목마다 원인 위치에서 최소로 고친다. 비교 화면 정확도(candleService·rows·lineData), 오류 안내(loadIssue·auth·kis), 저장(profileStore·validate), 보안·운영(DataTools·requestQueue·proxy·CI), 접근성(GroupTabs·Toggle·Sheet·snackbar)으로 나눈다.

**Tech Stack:** Svelte 5(runes), TypeScript 5, Vitest 3, Playwright, Cloudflare Worker/Node 프록시(`proxy/`), GitHub Actions. 새 런타임 의존성 없음(개발 의존성 `@types/node@^22`만 추가).

**Spec:** `docs/superpowers/specs/2026-10-11-stock-compare-design.md`
**입력(근거·file:line·수정 방향):** `docs/superpowers/followups/2026-10-13-followups-triage.md` — 각 Task는 거기 적힌 항목 번호의 근거와 수정 방향을 따른다. 이 계획의 결정이 우선한다.

## Global Constraints

- 모든 pnpm 명령 앞에 `export PATH=/opt/homebrew/opt/nvm/versions/node/v22.15.1/bin:$PATH`. 단위 `corepack pnpm test`(TZ=America/New_York), 타입 `corepack pnpm check`, 빌드 `corepack pnpm build`, e2e `corepack pnpm e2e`, 프록시 `corepack pnpm --filter proxy test`.
- 시각·날짜는 KST, `src/lib/time/kst.ts`만.
- UI 문구 `~해요`체, 이 계획의 문구는 그대로. 주석은 한국어로 간결하게.
- 토큰만 사용(글자 크기·색). 상승·하락은 ▲▼ + trendClass.
- 키·토큰을 로그·오류·URL·배너에 넣지 않는다(프록시 주소는 origin만).
- 프록시는 시세 경로 허용 목록만, 주문·계좌 경로는 `403 proxy-path-blocked` 유지.
- 스펙과 어긋나게 바뀌면 같은 커밋에서 스펙도 고친다.
- 공용 컴포넌트(Sheet·Toggle·snackbarStore·Segmented)의 기본 동작은 다른 화면에서 그대로여야 하고 새 prop은 선택값이다.

## Review Focus

1. **NXT 모드 1일 차트의 RVOL** — NXT 거래량을 NXT 평균으로 나눠야 한다(KRX 평균이면 크게 작음). → Task 2 `NXT mode RVOL uses NXT daily average`.
2. **장중 5초 시세가 들어온 직후 한 행** — 가격과 %가 같은 시세에서 나와야 한다. → Task 3 `row value follows the quote the row shows`.
3. **잠금 모드에서 새로고침 직후 KIS 토큰 재발급 제한** — 남은 초가 보여야 한다. → Task 5 `throttled reissue after reload shows remaining seconds`.
4. **8종목 중 1종목만 일시적 연결 실패** — 배너 없이 그 행만 표시. 진짜 키 오류는 가려지면 안 된다. → Task 4 `one flaky row does not raise the proxy banner but credentials still do`.
5. **시트에서 종목을 삭제한 직후 키보드 사용자** — 포커스를 잃지 않고 되돌리기에 닿아야 한다. → Task 10 `delete in detail sheet keeps focus and reaches undo by Tab`.

---

### Task 1: 메타 갱신과 기간 끝 거래정지 띠 (#2, #4)

**Files:** Modify `src/lib/ui/compare/compareController.svelte.ts`, `src/lib/chart/lineData.ts`, `src/lib/chart/CompareChart.svelte`, `src/routes/Compare.svelte`, spec §4.3·§5.4. Test `compareController.test.ts`, `lineData.test.ts`.

**Interfaces:** `ChartSeriesInput.suspended?: boolean` (lineData.ts). Compare.svelte가 `badgesOf`와 같은 규칙(`meta.krxSuspended || (venueMode==='NXT' && meta.nxtSuspended===true)`)으로 채운다.

- [ ] **Step 1: 실패 테스트**
  - compareController: 가짜 now가 KST 자정을 넘긴 뒤 `reload()` → `getStockMeta`가 모든 종목으로 다시 불리고 `krxSuspended` 변화가 `ctl.metas`에 반영; 다시 받기가 실패하면 이전 메타 유지.
  - lineData: `suspended: true`면 마지막 봉 뒤의 열린 날에 띠; 없으면 기존 `:305` 경우 그대로.
- [ ] **Step 2: RED 확인** — `TZ=America/New_York corepack pnpm vitest run src/lib/ui/compare/compareController.test.ts src/lib/chart/lineData.test.ts`
- [ ] **Step 3: 구현** — 트리아지 #2·#4. 스펙 §4.3 meta 줄을 "메모리, KST 날짜가 바뀌면 다시 받는다(IndexedDB 저장소 없음)"로, §5.4에 기간 끝까지 이어지는 정지 띠 규칙과 한 종목 그룹 한계를 적는다.
- [ ] **Step 4: GREEN + 전체 단위·check**
- [ ] **Step 5: Commit** — `fix(compare): refresh stock meta on a new KST day and band halts that run to the period end`

### Task 2: RVOL 분모를 같은 거래소 평균으로 (#1)

**Files:** Modify `src/lib/data/candleService.ts`, `src/lib/ui/compare/compareText.ts`, 헤드라인 메모를 그리는 곳(`Headline.svelte` 또는 compareView), spec §6·§4.3. Test `candleService.test.ts`, `compareText.test.ts`, Headline 테스트.

**Interfaces:**
- `Venues.rvol: Venue` = 분봉 거래소가 하나면 그것, 아니면 base.
- `LoadedSeries.avgVolumeVenue: Venue` — 실제로 분모에 쓴 거래소.
- `compareText.RVOL_KRX_BASE_NOTE = 'KRX 20일 평균 거래량 대비예요'` — `avgVolumeVenue`가 분봉 거래소와 다를 때(자동 모드, 대체) RVOL 지표 헤드라인에 표시.

- [ ] **Step 1: 실패 테스트** — `NXT mode RVOL uses NXT daily average`(avgDailyVolume = NXT 일봉 거래량 평균); 통합 모드는 `getCandles({venue:'UNIFIED', interval:'1d'})` 추가 1회(D1만); 통합 일봉 20개 미만이면 KRX 평균 + `avgVolumeVenue: 'KRX'`; 조정 factor 유지; 메모 표시 조건.
- [ ] **Step 2: RED**
- [ ] **Step 3: 구현** — 트리아지 #1. 추가 조회는 기존 메모 키 규칙과 요청 우선순위 그대로.
- [ ] **Step 4: GREEN + 전체 단위·check**
- [ ] **Step 5: Commit** — `fix(compare): RVOL divides by the same venue's daily average, KRX fallback is labelled`

### Task 3: 행의 %도 5초 시세로 (#3)

**Files:** Modify `src/lib/ui/compare/rows.ts`(또는 `src/lib/data/seriesMetrics.ts`), `src/routes/Compare.svelte`, spec §4.4·§7.2. Test `rows.test.ts`, Compare 테스트.

**Interfaces:** `withQuote(series: LoadedSeries, quote: Quote | undefined, now: number): LoadedSeries` — 순수 함수. 적용 조건: 시리즈가 오래되지 않음, 스크럽 중 아님, prevDay 아님, 시세 거래소 = 시리즈 거래소, `quote.ts`가 마지막 봉보다 새로움. D1은 합성 종가 봉(v:0) 추가, 그 밖은 오늘 일봉 종가만 교체(v 유지). 행 값에만 쓰고 차트는 원래 캔들.

- [ ] **Step 1: 실패 테스트** — `row value follows the quote the row shows`(기준 100, 캔들 110, 시세 112 → 값 12, 가격 112); 오래된 시리즈·스크럽 중에는 시세 무시; 시세가 마지막 봉보다 오래되면 무시; 초과수익은 지수 마지막 봉 이후면 캔들 값으로 남음(허용).
- [ ] **Step 2: RED** · **Step 3: 구현**(트리아지 #3) · **Step 4: GREEN + 전체**
- [ ] **Step 5: Commit** — `fix(compare): leaderboard value uses the same 5-second quote as its price`

### Task 4: 연결 오류 배너 과반 규칙과 타임아웃 스펙 (#6, #7)

**Files:** Modify `src/lib/ui/compare/loadIssue.ts`, `src/lib/ui/compare/compareController.svelte.ts`, spec §11·§9 #9. Test `loadIssue.test.ts`, `compareController.test.ts`.

**Interfaces:** `CONNECTION_CODES = ['proxy-unreachable', 'timeout']`; `issueFaults(faults: LoadFault[], total: number): LoadFault[]` — 연결 코드 오류는 그 코드 실패 수가 `total / 2` **초과**일 때만 남김. `dominantFault`는 이 결과에 적용(순서 중요: 먼저 거르고 나서 고름). timeout의 기존 `allFailed` 조건도 같은 과반으로 바꿈(`● 실시간` 판단의 allFailed는 그대로).

- [ ] **Step 1: 실패 테스트** — `one flaky row does not raise the proxy banner but credentials still do`(8개 중 proxy 1 + credentials 1 → credentials 배너); 5/8 proxy → proxy 배너; 1/1 → 배너; compareController에서 한 종목만 실패하면 `issueView` null.
- [ ] **Step 2: RED** · **Step 3: 구현** — 트리아지 #6. 코드 문구는 그대로 두고 스펙 §11 1·2행을 "프록시 미응답(fetch 실패) → 프록시에 연결할 수 없어요" / "응답 지연(8초 타임아웃·upstream-timeout) → 응답이 늦어요 + 진단 열기"로 나누고 두 행 모두 "과반 실패일 때 배너"(트리아지 #7). §9 #9도 맞춤.
- [ ] **Step 4: GREEN + 전체** · **Step 5: Commit** — `fix(compare): connection banners need a majority of failed rows; spec splits proxy down from slow response`

### Task 5: KIS 토큰 재발급 제한 남은 초 (#5)

**Files:** Modify `src/lib/providers/auth.ts`, `src/lib/providers/kis.ts`, `src/lib/providers/diagnostics.ts`, `src/lib/state/profileStore.ts`(키), 공급자 생성부(`factory.ts`/`app.svelte.ts`에서 저장소 연결), spec §11·§10.1. Test `auth.test.ts`, `kis.test.ts`, `diagnostics.test.ts`.

**Interfaces:**
- `profileKeys.tokenIssuedAt(id, provider: 'kis') = \`p:${id}:tokenIssuedAt:kis\`` — 값은 epoch ms(비밀 아님, 잠금 모드에서도 저장).
- `createTokenManager`가 발급 성공 시각을 `issuedAt` 저장소(`{ load(): number | null; save(t: number): void }`)에 기록.
- KIS `issueToken`이 `ApiError('token-throttled')`를 `retryAfterMs` 없이 받으면 `max(0, lastIssuedAt + 60_000 − now())`로 채워 다시 던짐(모르면 그대로).
- 진단 ③의 KIS 발급도 같은 시각 저장소에 기록.

- [ ] **Step 1: 실패 테스트** — `throttled reissue after reload shows remaining seconds`: t0 발급(저장) → 새 매니저(새로고침 흉내, 같은 저장소) → t0+20s 재발급이 제한되면 `retryAfterMs === 40_000`; 헤더 Retry-After가 있으면 그것 우선; 시각 모르면 undefined; 진단 ③ 발급도 시각 기록.
- [ ] **Step 2: RED** · **Step 3: 구현**(트리아지 #5) · **Step 4: GREEN + 전체** — `loadIssue.test.ts`의 `· 40초 남았어요` 표시는 기존 테스트로 확인
- [ ] **Step 5: Commit** — `fix(kis): token throttle countdown from the last issue time, kept across reloads`

### Task 6: 저장값 정리 안내와 빈 관심 그룹 (#8, #9)

**Files:** Modify `src/lib/state/storage.ts`, `src/lib/state/profileStore.ts`, `src/lib/state/validate.ts`(`validWatchlists`), `src/lib/state/app.svelte.ts`, spec §11·§10.1. Test `storage.test.ts`/`app.test.ts`, `profileStore` 관련 테스트, `exportImport.test.ts`.

**Interfaces:** `StorageIssue.kind`에 `'proxy-cleared'` 추가, `detail?: string`; `SafeStorage.reportProxyCleared(key: string, detail?: string)`. 배너 상수 `PROXY_CLEARED_BANNER(origin?: string)`: origin 있으면 `저장된 프록시 주소(${origin})는 개발 서버에서만 쓸 수 있어서 지웠어요`, 없으면 `저장된 프록시 주소가 올바르지 않아 지웠어요`; 액션 `{ label: '연결 설정', run: navigate settings/connection }`. origin은 http이고 로컬 호스트로 파싱될 때만(`new URL(raw).origin`).

- [ ] **Step 1: 실패 테스트** — 저장된 `proxyUrl: 'http://localhost:8787'`, `vi.stubEnv('DEV', false)` → 배너에 `http://localhost:8787`와 `연결 설정`; 다른 틀린 필드는 기존 손상 배너도 함께; 모든 그룹이 깨지면 `내 관심` 그룹 하나 저장 + 손상 배너; 저장값 `{groups: []}` → 기본 그룹; 가져오기에서 그룹 0개는 기존 형식 오류로 실패.
- [ ] **Step 2: RED** · **Step 3: 구현**(트리아지 #8·#9) · **Step 4: GREEN + 전체**
- [ ] **Step 5: Commit** — `fix(state): say which proxy address was cleared; never leave a profile without a watch group`

### Task 7: 키 포함 내보내기 확인, 429 그룹 정지, 프록시 보안 (#10, #11, #13a, #13b)

**Files:** Modify `src/lib/ui/settings/DataTools.svelte`, `src/lib/data/requestQueue.ts`, `proxy/src/handler.ts`, `proxy/docker-compose.yml`, `proxy/README.md`, spec §3.3·§3.4. Test `DataTools.test.ts`, `requestQueue.test.ts`, `proxy/src/handler.test.ts`.

**Interfaces:** DataTools prop `confirmFn?: (message: string) => boolean`(기본 `window.confirm`), 문구 `키가 들어 있는 파일을 내보낼까요? 이 파일을 가진 사람은 누구나 이 키로 증권사 API를 쓸 수 있어요.`; requestQueue는 rate-limited면 `g.nextStart = max(g.nextStart, now + delay)`, pump 루프는 `nextStart − now > 0`이면 잠든 뒤 다시 확인; 프록시 `tokenMatches(given, expected): Promise<boolean>`(SHA-256 두 해시 XOR 누적 비교); cloudflared는 **구현 시점에 실제 존재하는 릴리스 태그**로 고정(웹에서 확인, 추측 금지) + README에 올리는 방법.

- [ ] **Step 1: 실패 테스트** — 키 포함·확인 거절 → 다운로드 없음, 수락 → 키 포함 다운로드, 키 없음 → 확인 안 물음; A가 429(retryAfter 3000) at t0 → 같은 그룹 B는 t0+3000 이후 시작, 다른 그룹 영향 없음; 프록시 토큰 맞음 200, 같은 길이 틀림·다른 길이·없음 401 `proxy-token-invalid`.
- [ ] **Step 2: RED** · **Step 3: 구현**(트리아지 #10·#11·#13a·#13b) · **Step 4: GREEN** — 단위 전체, check, `corepack pnpm --filter proxy test`, `docker compose -f proxy/docker-compose.yml config`(docker가 없으면 YAML 검토로 대신하고 보고)
- [ ] **Step 5: Commit** — `fix: confirm key export, pause a rate-limited group, constant-time proxy token, pinned cloudflared`

### Task 8: CI 유니버스 캐시와 e2e 타입 검사 (#12, #14)

**Files:** Modify `scripts/build-universe.mjs`, `.github/workflows/ci.yml`, `package.json`, `tests/e2e/simulate.spec.ts:74`; Create `tsconfig.e2e.json`; spec §3.5·§12. Test 로컬 `corepack pnpm check:e2e`, 환경 스위치 동작.

**Interfaces:** `UNIVERSE_REUSE=true`이고 `public/universe.json`이 있으면 `[universe] 캐시된 파일을 그대로 써요`를 찍고 종료; ci.yml 두 잡(ci·e2e)에 ISO 주 키 `universe-<YYYY-Www>` 캐시(restore-keys `universe-`)와 cache-hit를 `UNIVERSE_REUSE`로 전달; deploy.yml은 바꾸지 않음; Playwright 브라우저 `~/.cache/ms-playwright` 캐시(키 `pw-${{ runner.os }}-1.63.0`), 적중 시 `pnpm exec playwright install-deps chromium`만; 개발 의존성 `@types/node@^22`, 스크립트 `"check:e2e": "tsc -p tsconfig.e2e.json"`, ci 잡에 `pnpm check:e2e` 단계.

- [ ] **Step 1:** `node --test`로 `UNIVERSE_REUSE` 스위치 테스트(파일 있음 → 다운로드 없이 종료, 없음 → 기존 동작) — `tests/` 아래 기존 `demo.test.mjs` 방식.
- [ ] **Step 2:** `corepack pnpm check:e2e`가 지금 실패함을 확인(TS2339, `process` 미정의).
- [ ] **Step 3: 구현** — 트리아지 #12·#14. 워크플로 YAML은 `actionlint`가 있으면 돌리고 없으면 구조를 꼼꼼히 검토.
- [ ] **Step 4:** `check:e2e` 0, 스위치 테스트 통과, `corepack pnpm build`·`corepack pnpm e2e` 통과(로컬은 UNIVERSE_REUSE 없이).
- [ ] **Step 5: Commit** — `ci: weekly universe cache, cached Playwright browsers, e2e type check`

### Task 9: 그룹 탭 화살표 이동과 토글 대비 (#15, #17)

**Files:** Modify `src/lib/ui/compare/GroupTabs.svelte`, `src/lib/ui/components/Toggle.svelte`, (선택) `src/lib/ui/tokens.css`, spec §8.2·§9 #7. Test `GroupTabs.test.ts`, `tokens.test.ts`, Toggle 테스트.

**Interfaces:** GroupTabs roving tabindex — 선택된 탭(없으면 첫 탭)만 `tabindex=0`, ←/→ 순환, Home/End, 포커스만 이동(수동 활성화), Enter/Space가 선택(`onselect`), `currentId`가 바뀌면 포커스 위치 초기화. Toggle — 켬 손잡이 `var(--on-accent)`, 끔 트랙 `var(--t3)`.

- [ ] **Step 1: 실패 테스트** — 탭 중 `tabindex=0`은 하나; ArrowRight가 다음 탭으로 포커스만 옮기고 `onselect` 안 부름; End는 마지막; Enter가 `onselect`; tokens.test에 비텍스트 3:1 검사(라이트·다크 두 블록 모두: `--on-accent` 대 `--accent`, `#fff` 대 `--t3`, `--t3` 대 `--surface`).
- [ ] **Step 2: RED** · **Step 3: 구현**(트리아지 #15·#17) · **Step 4: GREEN + 전체 + e2e a11y**
- [ ] **Step 5: Commit** — `fix(a11y): arrow keys move between group tabs; toggle thumb and track meet 3:1`

### Task 10: 시트 안에서 되돌리기 도달과 삭제 후 포커스 (#16)

**Files:** Modify `src/lib/ui/components/Sheet.svelte`, `src/lib/ui/components/Snackbar.svelte`, `src/lib/ui/components/snackbarStore.svelte.ts`, `src/sheets/GroupSheet.svelte`, `src/sheets/StockDetailSheet.svelte`(또는 Compare의 시트 연결부), `src/lib/ui/compare/Leaderboard.svelte`(다음 행 버튼 찾기), spec §7.3·§9 #3. Test `Sheet.test.ts`, `Snackbar.test.ts`, `GroupSheet.test.ts`, e2e `compare.spec.ts`.

**Interfaces:** 스낵바 액션 버튼에 `data-snackbar-action`; Sheet의 포커스 순환 목록에 그 버튼을 끝에 포함(있을 때만); `snackbarStore.holdSnackbar()`/`releaseSnackbar()` — `.snack`에 포커스가 있는 동안 타이머 정지; Sheet prop `returnFocus?: () => HTMLElement | null | undefined` — 정리 때 `previous`가 문서에 없으면 이걸로 포커스(종목 삭제: 같은 위치의 다음 행 버튼, 없으면 `+ 종목 추가`); GroupSheet 삭제 뒤 `tick()` 다음 같은 위치 그룹의 삭제 버튼, 없으면 닫기 버튼.

- [ ] **Step 1: 실패 테스트** — 스낵바 액션이 있으면 마지막 컨트롤에서 Tab → 되돌리기, 한 번 더 Tab → 첫 컨트롤; `previous`가 사라지면 `returnFocus` 사용; 포커스 중에는 타이머가 안 끝남, 포커스를 떠나면 다시 흐름; GroupSheet 삭제 뒤 `document.activeElement`가 시트 안; e2e `delete in detail sheet keeps focus and reaches undo by Tab`(키보드만으로 종목 상세 → 삭제 → Tab으로 되돌리기 → Enter로 복원).
- [ ] **Step 2: RED** · **Step 3: 구현**(트리아지 #16) · **Step 4: GREEN** — 단위 전체(모든 시트 테스트), e2e 전체
- [ ] **Step 5: Commit** — `fix(a11y): undo is reachable from an open sheet, focus returns after deletes`

### Task 11: 후속 목록 정리

**Files:** Modify `docs/superpowers/followups/2026-10-12-gazua-followups.md`(각 항목에 처리 결과·커밋 표시, 13c 이미 해결, 실기기 항목은 남음), `docs/superpowers/followups/2026-10-13-followups-triage.md`(처리 결과 열).

- [ ] **Step 1:** 두 문서에 항목별 처리 결과와 커밋 SHA를 적는다. 남은 것은 실기기 확인(IME·PWA·maskable)과 실연결 점검 ②·⑭.
- [ ] **Step 2:** `corepack pnpm test`, `check`, `check:e2e`, `build`, `e2e` 전부 통과.
- [ ] **Step 3: Commit** — `docs: record follow-up resolutions`

## 순서

1 → 2 → 3(비교 화면, Compare.svelte 공유) → 4 → 5(loadIssue 공유) → 6 → 7 → 8 → 9 → 10 → 11.
