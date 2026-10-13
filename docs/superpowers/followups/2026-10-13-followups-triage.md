# 후속 작업 점검 (2026-10-13, main c3783cc)

[2026-10-12 후속 작업 목록](2026-10-12-gazua-followups.md)을 현재 코드에 대조한 결과예요. 실기기 확인 항목(한글 IME·PWA 갱신·maskable 아이콘)은 실제 기기가 필요해서 제외했어요. 처리 결과 열은 `feat/followups` 브랜치(2026-10-13)에서 채웠어요. 스펙은 [stock-compare-design](../specs/2026-10-11-stock-compare-design.md).

| # | 항목 | 상태 | 크기 | 처리 결과 |
|---|---|---|---|---|
| 1 | D1 RVOL 분모가 늘 KRX 20일 평균 | 남음 | M | 해결 — `ad015dc` |
| 2 | 종목 메타를 탭이 열린 동안 다시 받지 않음 | 남음 | S | 해결 — `9492581`, `3509e04` |
| 3 | 한 행의 가격(5초)과 %(60초)가 최대 1분 어긋남 | 남음 | M | 해결 — `95519cb`, `4ee25fe` |
| 4 | 기간 끝까지 이어지는 거래정지에 띠가 없음 | 남음 | S | 해결 — `9492581`, `3509e04` |
| 5 | KIS 토큰 발급 제한 남은 초가 Retry-After 있을 때만 | 남음 | M | 해결 — `da56e5c`, `db2e383` |
| 6 | 한 행의 일시적 연결 오류로 프록시 배너 | 남음 | S | 해결 — `ef526ce` |
| 7 | 8초 타임아웃 문구가 스펙(프록시 미응답)과 다름 | 스펙·코드 불일치 | S | 해결(스펙을 코드에 맞춤) — `ef526ce` |
| 8 | 저장된 http://localhost 프록시를 지울 때 일반 문구 | 남음 | S | 해결 — `bac475f` |
| 9 | 그룹이 모두 깨지면 빈 목록 | 남음 | S | 해결 — `bac475f` |
| 10 | 키 포함 내보내기 확인 대화상자 없음 | 남음 | S | 해결 — `191bef4` |
| 11 | 429가 같은 그룹 다른 요청을 멈추지 않음 | 남음 | S | 해결 — `191bef4` |
| 12 | CI가 매번 KIS 마스터를 받음 | 남음 | S | 해결 — `dcb6b1c` |
| 13a | PROXY_TOKEN 상수 시간 비교 | 남음 | S | 해결 — `191bef4` |
| 13b | cloudflared:latest 고정 | 남음 | S | 해결 — `191bef4` |
| 13c | 리다이렉트 때 x-proxy-token 전달 | **이미 해결**(d21bb9b, fdad0b8) | — | 이미 해결 — `d21bb9b`, `fdad0b8` |
| 14 | CI Playwright 캐시·e2e 타입 검사 | 남음(+ simulate.spec.ts:74 타입 오류 발견) | S | 해결 — `dcb6b1c` |
| 15 | GroupTabs 화살표 키 이동 | 남음 | S | 해결 — `532cec1` |
| 16 | 시트 포커스 중 스낵바 도달 불가·삭제 후 포커스 복귀 | 남음 | M | 해결 — `3ba1b86`, `bae8a88` |
| 17 | 토글 대비(다크 켬 2.59:1, 라이트 끔 1.26:1) | 남음 | S | 해결 — `532cec1` |

## 항목별 근거와 수정 방향

1. **RVOL 분모** — `candleService.ts:303` `avgVolumeBefore(baseDaily)`, base는 KRX(`:214`); 분자는 그 거래소 1분봉 합(`seriesMetrics.ts:58`). NXT는 크게 과소, 통합은 과대. 수정: `venuesFor`에 `rvol` 거래소(분봉 거래소가 하나면 그것, 아니면 base). 분모 일봉은 rvol===base → baseDaily, ===series → seriesDaily, 그 밖(UNIFIED) → 종목당 1회 추가 조회(D1만, 같은 메모 키 규칙). 20봉 미만이면 KRX로 대체. `LoadedSeries.avgVolumeVenue`를 두고 분봉 거래소와 다르면 헤드라인 메모 `KRX 20일 평균 거래량 대비예요`(compareText.ts). 조정 factor 유지. 테스트 candleService·compareText. 스펙 §6 4행, §4.3.
2. **메타 갱신** — `compareController.svelte.ts:207-213` 없는 종목만 받음, 공급자 바뀔 때만 리셋(`:411`). 수정: `metaDay` 기록, KST 날짜가 바뀌면 다시 받기, 실패하면 이전 메타 유지. 테스트 compareController(자정 넘김, 실패 유지). 스펙 §4.3 meta 줄(메모리, IndexedDB 저장소 없음으로 정정).
3. **가격·% 어긋남** — `rows.ts:55` 가격은 5초 시세, `:85` 값은 60초 캔들. 수정: 행 전용 순수 함수 `withQuote(series, quote, now)` — 오래된 시리즈·스크럽·prevDay·거래소 불일치·시세가 마지막 봉보다 오래되면 적용 안 함. D1은 합성 종가(v:0) 추가, 그 밖은 오늘 일봉 종가 교체. Compare.svelte rows만, 차트는 원래 캔들. 테스트 rows(기준 100, 캔들 110, 시세 112 → 12, 가격 112; 오래됨·스크럽 무시). 스펙 §4.4, §7.2-6.
4. **거래정지 띠** — `lineData.ts:198` `t < r.last` 조건이 마지막 봉 뒤를 뺌(`lineData.test.ts:305`이 고정). 수정: `ChartSeriesInput.suspended`(badgesOf와 같은 규칙), `haltDays` 조건 `(t < r.last || s.suspended)`. 한 종목뿐인 그룹은 openDays가 캔들에서만 나와 여전히 한계(기록). 테스트 lineData. 스펙 §5.4. #2 다음.
5. **EGW00133 카운트다운** — `loadIssue.ts:83`은 retryAfterMs(헤더)만, `auth.ts`는 발급 시각을 모름, 진단도 따로 발급(`diagnostics.ts:184`). 수정: 토큰 매니저 `lastIssuedAt`, `kis.ts`가 throttled에서 retryAfterMs 없으면 `lastIssuedAt+60s−now` 채움. 잠금 모드 새로고침 대비 비밀 아닌 시각을 `p:{id}:tokenIssuedAt:kis`에 저장(매니저·진단 ③ 둘 다). 테스트 auth/kis(t0 발급, t0+20s 재발급 제한 → 40,000). 스펙 §11 토큰 행, §10.1.
6. **한 행 연결 오류 배너** — `compareController.svelte.ts:400-403` dominantFault 전체, `loadIssue.ts:60-68,89-90` proxy-unreachable 개수 확인 없음(timeout만 allFailed). 수정: `issueFaults(faults, total)` — 연결 코드(`proxy-unreachable`,`timeout`)는 과반(> n/2) 실패일 때만 남기고 **그 다음** dominantFault. timeout의 allFailed도 같은 과반. 테스트 loadIssue(8개 중 1개 proxy + 1개 credentials → credentials 배너; 5/8 → proxy), compareController. 스펙 §11, §9 #9.
7. **8초 타임아웃 문구** — `http.ts:39,106` → `timeout` → `응답이 늦어요`; 프록시는 상류를 15초 기다려(`proxy/node/server.ts:11`) 8초 중단은 대개 "프록시는 살아 있고 증권사가 느림". 수정 방향(권장): 코드 유지, 스펙 §11을 "프록시 미응답(fetch 실패) → 프록시에 연결할 수 없어요" / "응답 지연(8초·upstream-timeout) → 응답이 늦어요 + 진단 열기, 과반 실패일 때 배너"로 나눔. 대안: 프록시 상류 7초로 줄이고 클라이언트 중단을 proxy-unreachable로.
8. **localhost 프록시 지움 배너** — `profileStore.ts:37-38` reportCorrupt → 일반 `CORRUPT_BANNER`. 수정: `StorageIssue` `'proxy-cleared'` + `detail`(http·로컬 호스트로 파싱될 때만 origin, userinfo·쿼리 노출 안 함), 배너 `저장된 프록시 주소(${origin})는 개발 서버에서만 쓸 수 있어서 지웠어요`(대체 `저장된 프록시 주소가 올바르지 않아 지웠어요`), 액션 `연결 설정`. 다른 필드는 그대로 corrupt. 테스트(vitest는 DEV=true라 `vi.stubEnv('DEV', false)` 필요). 스펙 §11 새 행, §10.1.
9. **빈 관심 그룹** — `validate.ts:77-102` `{groups:[], repaired:true}`, `profileStore.ts:49-52` 그대로 반환. 수정: 그룹 0개면 기존 기본 그룹 경로(`내 관심` 저장, 손상 안내), `validWatchlists`가 빈 그룹을 거부(가져오기 실패). 테스트 profileStore/app/exportImport. 스펙 §10.1.
10. **키 포함 내보내기 확인** — `DataTools.svelte:57-60` 바로 내보냄(스펙 §9 #5는 이중 확인을 약속). 수정: `confirmFn` prop(Profiles·KeyLock과 같은 패턴), 문구 `키가 들어 있는 파일을 내보낼까요? 이 파일을 가진 사람은 누구나 이 키로 증권사 API를 쓸 수 있어요.` 테스트 DataTools.
11. **429 그룹 정지** — `requestQueue.ts:41,74-84` 실패한 항목만 잠, `pump`(`:92-98`)이 깨어난 뒤 nextStart를 다시 보지 않음. 수정: rate-limited면 `g.nextStart = max(g.nextStart, now+delay)`, pump는 `wait = nextStart − now > 0`이면 자고 continue. 테스트 requestQueue(같은 그룹 B는 t0+3000 이후, 다른 그룹은 영향 없음). 스펙 §3.4.
12. **CI 유니버스 캐시** — `prebuild`가 매번 받음, ci·e2e 두 번. 수정: `build-universe.mjs`에 `UNIVERSE_REUSE=true`이고 파일이 있으면 건너뜀(`[universe] 캐시된 파일을 그대로 써요`), ci.yml 두 잡에 주 단위 키 `actions/cache@v4`(`universe-<ISO 주>`, restore-keys `universe-`), deploy.yml은 그대로 매번 새로. 스펙 §3.5.
13a. **PROXY_TOKEN** — `proxy/src/handler.ts:67` `!==`. 수정: SHA-256 해시 두 개를 XOR 누적 비교(`crypto.subtle`, Workers·Node 22). 테스트 handler(맞음 200, 같은 길이 틀림·다른 길이·없음 401). 스펙 §3.3.
13b. **cloudflared 고정** — `proxy/docker-compose.yml:15`. 수정: 구현 시점의 실제 릴리스 태그로 고정(추측 금지), proxy/README에 올리는 방법.
14. **CI e2e** — playwright install 매번, `check:e2e` 없음, tsconfig가 tests 제외, 루트에 @types/node 없음, `simulate.spec.ts:74` TS2339. 수정: `~/.cache/ms-playwright` 캐시(키 `pw-${runner.os}-1.63.0`, 적중 시 `install-deps`만), `tsconfig.e2e.json` + `@types/node@^22` + `check:e2e` 스크립트, `(el as Element).remove()`, ci 잡에 `pnpm check:e2e`. 스펙 §12.
15. **GroupTabs 화살표** — `GroupTabs.svelte:22-34` 모든 탭이 탭 순서. 수정: roving tabindex(선택 탭 0, 나머지 −1), ←/→ 순환, Home/End, 포커스만 이동, Enter/Space로 선택(수동 활성화 — 화살표마다 그룹 로드 방지). 테스트 GroupTabs. 스펙 §9 #7.
16. **시트·스낵바** — `Sheet.svelte:68-87` 포커스 가둠이 시트만, 스낵바는 밖(`App.svelte:131`), GroupSheet 삭제 후 포커스 body, StockDetailSheet 삭제 후 사라진 행으로 복귀 실패, 스낵바 5초 고정. 수정: 스낵바 액션 `data-snackbar-action`을 Sheet 포커스 순환에 포함, 포커스가 있으면 타이머 멈춤(hold/release), Sheet 정리 때 `previous.isConnected`가 아니면 `returnFocus` prop(다음 행 버튼, 없으면 `+ 종목 추가`), GroupSheet 삭제 뒤 같은 위치의 삭제 버튼 또는 닫기. 테스트 Sheet·Snackbar·GroupSheet, e2e compare. 스펙 §7.3, §9 #3.
17. **토글 대비** — `Toggle.svelte:59` 손잡이 `#fff`, 다크 켬 `--accent #a093ff` 2.59:1, 라이트 끔 `--line` 1.26:1. 수정: 켬 손잡이 `var(--on-accent)`(다크 7.41:1, 라이트 6.14:1), 끔 트랙 `var(--t3)`(손잡이 5.21 / 3.42, 트랙 대 면 5.2). tokens.test에 비텍스트 3:1 검사. 스펙 §8.2.

## 순서와 공유 파일
- #2 → #4 (거래정지 띠가 메타의 정지 표시를 씀)
- #6 → #7 (loadIssue 과반 규칙, §11 한 번에)
- #5·#6·#7: loadIssue.ts/errors.ts
- #8·#9: profileStore.ts
- #12·#14: ci.yml (#14의 타입 오류 수정은 check:e2e와 함께)
- #1·#3: candleService.ts/seriesMetrics.ts/Compare.svelte
- #13a·b: proxy/
- #16: 공용 Sheet·snackbarStore (모든 시트 테스트)
- 그 밖: 스펙 §4.3은 없는 IndexedDB `meta` 저장소를 설명함(#2에서 정정)

## 남은 것
- **실기기 확인** — 한글 IME 단축키(`isComposing`), 설치형 PWA·서비스 워커 갱신, maskable 아이콘 안전 영역. 실제 기기가 있어야 해서 코드로는 확인할 수 없어요.
- **실연결 점검 ②·⑭** — 실제 증권사 키가 있어야 해서 [live-check.md](../../live-check.md)에서 직접 확인해야 해요.
