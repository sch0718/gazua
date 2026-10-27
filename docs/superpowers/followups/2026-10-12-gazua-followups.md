# 가즈아 — 후속 작업 목록 (2026-10-12)

구현 브랜치 `feat/app-implementation`의 리뷰에서 나왔지만 이번 범위에서 미룬 항목입니다. 실제 API로 확인할 항목은 [live-check.md](../../live-check.md)에 따로 있습니다.

2026-10-13에 `feat/followups` 브랜치에서 코드로 처리할 수 있는 항목을 모두 처리했어요. 항목마다 `→ 해결`로 처리 결과와 커밋을 적었고, 항목별 근거·수정 방향은 [점검 결과](2026-10-13-followups-triage.md)에 있어요. 남은 것은 맨 아래 "아직 남은 것"이에요.

## 정확도
- ~~D1 NXT/통합 모드의 RVOL이 KRX 20일 평균 거래량으로 나눔 → 해당 거래소 일봉 평균을 쓰거나 표기.~~ → 해결: 같은 거래소의 20일 평균으로 나누고, 20봉 미만이면 KRX로 대체하며 헤드라인 메모에 표기해요. (`ad015dc`)
- ~~종목 메타(거래정지 등)를 탭을 연 뒤 다시 받지 않음 → KST 날짜가 바뀌면 만료.~~ → 해결: KST 날짜가 바뀌면 종목별로 다시 받고, 실패하면 이전 메타를 유지해요. (`9492581`, `3509e04`)
- ~~한 행 안에서 가격(5초 시세)과 %(60초 캔들)가 최대 1분 어긋남.~~ → 해결: 값도 같은 5초 시세를 쓰고, 시세를 쓰지 않을 땐 가격도 시세를 보여주지 않아요. (`95519cb`, `4ee25fe`)
- ~~기간 끝까지 이어지는 거래정지는 마지막 봉 뒤로 띠가 없음(행 배지는 표시됨).~~ → 해결: 정지 중인 종목은 기간 끝까지 띠를 그려요. (`9492581`, `3509e04`)
- ~~KIS 토큰 발급 제한(EGW00133) 남은 초 표시는 `Retry-After`가 있을 때만 나옴 → 토큰 매니저의 마지막 발급 시각으로 계산.~~ → 해결: 마지막 발급 시각으로 남은 시간을 계산하고, 새로고침해도 유지하며 최대 1분으로 제한해요. (`da56e5c`, `db2e383`)

## 오류 안내
- ~~8개 중 한 행의 일시적 연결 오류만으로 `프록시에 연결할 수 없어요` 배너가 뜸 → 다수/전부 실패일 때만.~~ → 해결: 같은 연결 오류로 과반 행이 실패할 때만 배너를 띄워요. (`ef526ce`)
- ~~8초 타임아웃은 스펙상 '프록시 미응답'이지만 `응답이 늦어요`로 표시.~~ → 해결: 코드는 유지하고 스펙 §11을 "프록시 미응답"과 "응답 지연"으로 나눴어요. (`ef526ce`)
- ~~저장돼 있던 `http://localhost` 프록시 주소를 지울 때 배너가 일반 문구 → 어떤 값이 지워졌는지 표시.~~ → 해결: 지운 주소(origin)를 알려 주는 전용 배너와 `연결 설정` 버튼을 추가했어요. (`bac475f`)
- ~~`sanitizeWatchlists`가 그룹이 모두 깨졌을 때 기본 `내 관심` 그룹 대신 빈 목록을 돌려줌.~~ → 해결: 그룹이 0개면 기본 `내 관심` 그룹을 저장하고, 빈 그룹 가져오기는 거부해요. (`bac475f`)

## 보안·운영
- ~~키 포함 내보내기에 확인 대화상자 추가(현재 체크박스 + 안내문).~~ → 해결: 확인 대화상자를 거쳐야 내보내요. (`191bef4`)
- ~~429 수신 시 같은 그룹의 다른 요청도 `Retry-After`만큼 멈추기.~~ → 해결: 429를 받으면 그룹 전체의 다음 시작 시각을 미뤄요. (`191bef4`)
- ~~CI 빌드가 매번 KIS 마스터를 내려받음 → 마지막 universe.json 캐시.~~ → 해결: ci·e2e 잡에서 주 단위로 캐시해요. 배포 빌드는 그대로 매번 새로 받아요. (`dcb6b1c`)
- 프록시:
  - ~~`PROXY_TOKEN` 상수 시간 비교~~ → 해결 (`191bef4`)
  - ~~`cloudflared:latest` 버전 고정~~ → 해결 (`191bef4`)
  - ~~리다이렉트 시 `x-proxy-token` 전달 방지~~ → 이미 해결 (`d21bb9b`, `fdad0b8`)
- ~~CI에서 Playwright 브라우저 캐시, e2e 파일 타입 검사(`check:e2e`).~~ → 해결: 브라우저 캐시와 `check:e2e`를 CI에 넣고 e2e의 타입 오류도 고쳤어요. (`dcb6b1c`)

## 접근성·UI
- ~~GroupTabs에 화살표 키 이동(roving tabindex) 없음.~~ → 해결: 화살표·Home·End로 이동하고 Enter/Space로 선택해요. (`532cec1`)
- ~~시트가 포커스를 잡고 있을 때 스낵바(되돌리기)에 키보드로 갈 수 없음, 삭제 후 포커스 복귀 없음.~~ → 해결: 열린 시트에서도 되돌리기에 닿고, 삭제와 되돌리기 뒤 포커스가 알맞은 곳으로 돌아가요. (`3ba1b86`, `bae8a88`)
- ~~다크 모드 토글 손잡이와 트랙 대비 약 2.6:1(비텍스트 3:1 미달).~~ → 해결: 손잡이와 트랙 모두 3:1 이상이고 토큰 테스트로 검사해요. (`532cec1`)

## 아직 남은 것
- 실제 한글 IME에서 단축키(`isComposing`) 동작, 설치형 PWA·서비스 워커 갱신, maskable 아이콘 안전 영역을 실기기에서 확인. → 남음: 실제 기기가 있어야 해요.
- 실연결 점검 ②·⑭ ([live-check.md](../../live-check.md)). → 남음: 실제 증권사 키가 있어야 해요.

## 새 후속 (2026-10-13 브랜치 리뷰에서 남김)
`feat/followups`의 작업별 리뷰와 최종 리뷰에서 나온, 영향이 작거나 실제 기기·키가 있어야 확인되는 것들이에요. 줄마다 무엇 · 어디 · 왜 미뤘는지를 적었어요.

2026-10-13에 `feat/followups-2` 브랜치에서 코드로 처리할 수 있는 항목을 처리했어요([계획](../plans/2026-10-13-followups-2.md)). 처리한 항목은 `→ 해결`로 결과와 커밋을 적었고, 범위 밖 항목은 `→ 남음`으로 사유를 그대로 뒀어요. 결정이 바뀐 두 가지는 아래 해당 줄에 `결정 변경`으로 적었어요.

**먼저 하면 좋은 것 셋** (표시: ★)
- ~~★ proxy-cleared 값을 저장소에 되쓰지 않음 · `src/lib/state/storage.ts:131` · 배너가 설정을 한 번 저장할 때까지 로드마다 반복돼요.~~ → 해결: 지운 주소를 저장소에 되써서 배너가 로드마다 반복되지 않아요. 다른 설정 값은 건드리지 않고, 쓰기가 실패해도 메모리 전용 모드로 넘어가지 않아요. (`60d6595`)
- ~~★ Playwright 캐시 키가 `1.63.0`으로 고정 · `.github/workflows/ci.yml:63` · 스펙 §12 표현도 맞춰요.~~ → 해결: 캐시 키가 `pnpm-lock.yaml` 해시를 따라가요. 스펙 §12도 맞췄어요. (`393d9b0`)
- ~~★ 전략 목록 삭제 뒤 포커스가 body에 남음 · `src/routes/Simulate.svelte`의 StrategyList 삭제~~ → 해결: 삭제 뒤 포커스가 알맞은 곳으로 돌아가요. Simulate 테스트를 더했어요. (`b553d37`)

### 정확도·데이터
- ~~`isSuspended` 규칙이 `badgesOf`와 중복 · `src/lib/ui/compare/rows.ts:103,107`~~ → 해결: `badgesOf`가 `isSuspended`를 써요. 표 테스트를 더했어요. (`f503ef7`)
- 기간 내내 거래정지인 종목은 봉이 없어 띠가 안 그려짐 · 스펙 §5.4 · 한계로 문서화만 했어요. → 남음: 문서화된 한계예요.
- ~~`ensureMetas` 주석이 "지금 종목 전체"로 남음(지금은 종목별) · `compareController.svelte.ts:214`~~ → 해결: 주석을 종목별 동작에 맞게 고쳤어요. (`f503ef7`)
- UN 일봉이 5xx·타임아웃이면 재시도로 로드가 약 3.5초 늦음, 일시 실패 시 RVOL과 메모가 1분간 바뀌고 메모에 어떤 종목인지 안 나옴 · `candleService.ts` · 결정적인 KIS 거절을 하루 동안 기억하게 하려면 live-check ②가 먼저 필요해요. → 남음: 실연결 점검 ②가 먼저예요.
- ~~AUTO 과거일 보정 테스트가 없고 실패를 메모하지 않는 동작을 고정하는 테스트도 없음 · `candleService.test.ts`~~ → 해결: AUTO 과거일 보정 테스트와 "RVOL 실패는 메모하지 않음" 테스트를 더했어요. (`f503ef7`)
- D1 초과수익은 캔들 값을 시세 가격 옆에 둠, `series.daily` 종가에는 시세를 덮지 않음(쓰는 곳 없음) · `rows.ts` · 문서화된 허용 동작이에요. → 남음: 허용 동작이에요.
- ~~`priceOf`가 `rowSeries`를 다시 돌려 행마다 복사가 두 번 · `rows.ts:59`~~ → 해결: `priceOf`가 다시 계산하지 않아요. (`f503ef7`)
- UNIFIED 일봉 테스트가 KRX 꼬리 구간을 가정하고, AUTO가 KRX로 넘기는 16:00과 NXT 15:30–15:40은 실제 시간표와 맞지 않음 · `rows.test.ts`, `sessions.config.ts` · KRX 부분은 검증함(2026-10-13 확인): KRX가 2026-09-14부터 시간외 단일가(16:00–18:00)를 없애고 16:00–20:00 연속매매 애프터마켓을 열었어요(ETF·ETN과 관리종목·투자경고 등 일부 종목 제외). 그래서 AUTO가 16:00에 KRX로 넘기는 것은 맞아요. NXT 15:30–15:40은 앱 모델과 달라요(2026-10-14 공식 공지로 확인): NXT는 프리 08:00–08:50, 메인 09:00:30–15:20, 애프터마켓 호가접수 15:30·체결 15:40–20:00이고, 별도의 종가매매시장이 15:30–16:00에 KRX 당일 종가로 시간우선 체결해요(고정가). 즉 15:30–15:40은 "NXT 종가 단일가"가 아니라 애프터마켓 호가접수 구간과 종가매매시장이 겹친 구간인데, `sessions.config.ts`의 NXT `after-auction` 15:30–15:40(라벨 "NXT 종가 단일가")은 이를 단일가로 보는 근사예요. → 남음: 아래 "종가 고정가 체결" 항목과 함께 실연결 점검 ②에서 분봉을 확인한 뒤 고쳐요. 출처: KRX 규정 사이트 regulation.krx.co.kr/contents/RGL/03/03010301/RGL03010301.jsp (2026-10-13 확인), 넥스트레이드 시장운영 공지 nextrade.co.kr/menu/notice/view.do?scBbsKndCode=notice&scNttCl=general&scNttNo=31 (2025-12-18 공지, 2026-01-02 임시 시간표지만 시장 구조 확인용, 2026-10-14 확인), 넥스트레이드 거래제도 nextrade.co.kr/menu/transactionSys.do, hankyung.com/article/2026091442517 (2026-09-14).

### 오류 안내
- ~~`LoadIssue.allFailed`를 읽는 곳이 없고 "● 실시간" 주석이 헷갈림 · `loadIssue.ts:24`, `compareController.svelte.ts:69,414`~~ → 해결: `allFailed`를 지우고 주석을 고쳤어요. (`f503ef7`)
- ~~행 하나만 타임아웃인 경우를 컨트롤러 수준에서 검사하는 테스트가 없음 · `compareController.test.ts`.~~ → 해결: 행 하나만 타임아웃인 경우의 컨트롤러 테스트를 더했어요. (`f503ef7`)
- ~~프록시 오류 3 + 타임아웃 2(8개 중)처럼 섞이면 배너가 안 뜸(같은 코드로 과반일 때만 셈) · `compareController.svelte.ts`, 스펙 §11~~ → 해결 (결정 변경): `proxy-unreachable`과 `timeout`을 합쳐 세요. 합계가 행의 과반이면 배너를 띄우고, 코드는 더 많은 쪽(같으면 `proxy-unreachable`)이에요. 그 밖의 코드는 지금처럼 코드별로 판단해요. 스펙 §11도 고쳤어요. (`f503ef7`)
- ~~proxy-cleared 배너가 주소를 고친 뒤에도 그 세션에 남음 · `src/lib/state/storage.ts`의 issues가 지워지지 않아요.~~ → 해결: 새 주소를 저장하면 배너가 사라져요. 연결 설정 테스트를 더했어요. (`60d6595`)
- ~~proxy-cleared 문구가 `DEV=true`일 때 query·userinfo 사유와 안 맞고, `localHttpOrigin` 직접 단위 테스트와 `{groups:[]}` 케이스의 corrupt 배너 단언이 없음 · `storage.ts`, `storage.test.ts`~~ → 해결: DEV 문구를 맞추고 `localHttpOrigin` 단위 테스트와 `{groups:[]}`의 corrupt 배너 단언을 더했어요. (`60d6595`)
- ~~KIS 토큰 발급 시각이 프로필 단위이고 키 단위가 아님 · `app.svelte.ts`~~ → 해결: 스펙 §11에 "발급 시각은 프로필 단위"를 적고, 프로필 전환 때 저장소를 검사하는 `issuedAt` 테스트를 더했어요. (`60d6595`)

### 보안·운영
- ~~한 그룹의 여러 요청이 잇달아 429를 받는 경우의 테스트가 없음 · `requestQueue.test.ts`.~~ → 해결: 한 그룹의 여러 요청이 429를 받는 테스트를 더했어요. (`393d9b0`)
- `window.confirm` 기본값이 특이한 환경에서는 조용히 거절로 처리됨 · 키 포함 내보내기 확인 · 대체 UI는 필요할 때 정해요. → 남음: 대체 UI는 필요할 때 정해요.
- ~~스펙 §3.3 "같은 시간"이 과장이고, §7.4 설정 데이터 행에 새 확인 대화상자가 빠져 있음~~ → 해결: 스펙 §3.3·§7.4·§12 문구를 고쳤어요. (`393d9b0`)
- ~~유니버스 캐시: 일부 복원 뒤 내려받기가 실패하면 낡은 파일이 이번 주 키로 저장될 수 있음 · `.github/workflows/ci.yml`~~ → 해결: 캐시를 복원과 저장으로 나누고, 새로 받은 파일만 저장하도록 신선도 검사를 넣었어요. (`393d9b0`)
- ~~유니버스 테스트가 `URL.pathname`을 씀(`fileURLToPath`로 바꾸기) · `tests/universe-reuse.test.mjs`~~ → 해결: `fileURLToPath`를 써요. (`393d9b0`)
- ~~앱 `pnpm check`에 `@types/node`가 보임 · `tsconfig.json`에 `types`가 없어요.~~ → 해결: 앱 `tsconfig.json`에 `"types": []`를 두고, 테스트용 `tsconfig.test.json`을 새로 만들었어요. (`393d9b0`)

### 접근성·UI
- ~~상세 시트에서 지운 뒤 되돌리기가 Tab 횟수에 의존함 · `src/sheets/StockDetailSheet.svelte`~~ → 해결: 삭제 뒤 포커스가 행에 머무는 동안 스낵바 타이머를 멈추고(WCAG 2.2.1), 포커스가 벗어나면 남은 시간부터 다시 세요. (`219b3d2`)
- ~~GroupTabs가 Alt·Cmd·Ctrl+화살표·Home·End를 삼킴 · `GroupTabs.svelte`~~ → 해결: 보조키가 있으면 넘겨요. 테스트를 더했어요. (`b553d37`)
- ~~Toggle 테스트가 정규식에 기대 깨지기 쉽고 꺼진 손잡이의 `#fff` 단언이 없음 · `Components.test.ts`.~~ → 해결: 테스트를 단단하게 고치고 꺼진 손잡이 단언을 더했어요. (`b553d37`)
- ~~`groupActions`의 프로필 가드 테스트가 없음 · `GroupSheet.svelte`.~~ → 해결: `groupActions` 프로필 가드 테스트를 더했어요. (`b553d37`)
- ~~`detailRestoredFocus`가 심볼로만 행을 찾아 그룹을 바꾼 뒤에는 엉뚱한 행을 잡을 수 있음 · `Compare.svelte:307`.~~ → 해결: 그룹까지 확인해서 행을 찾아요. (`219b3d2`)
- 스크린리더가 aria-modal 밖 안내를 읽는지는 실기기에서 확인해야 해요. → 남음: 실기기가 있어야 해요.
- ~~열린 시트 상태의 되돌리기 e2e~~ → 해결: 열린 시트에서 되돌리기 e2e를 더했어요. (`b553d37`)
- ~~`selectedIndex` 정렬 중복(`Compare.svelte`)~~ → 해결: 중복된 정렬을 없앴어요. (`219b3d2`, `cb79226`)
- ~~실시간 재정렬 중 Tab 순서 변동~~ → 해결 (결정 변경): 키보드 포커스가 리더보드 안에 있는 동안만 행 순서를 고정하고 값은 계속 갱신해요. 클릭·시트 이동 등으로 포커스가 벗어나면 바로 다시 정렬해요. 스펙도 고쳤어요. (`219b3d2`, `cb79226`)
- 시트가 열린 중 다른 스낵바 동작 · 스펙 §7.3이 허용해요. → 남음: 허용 동작이에요.

### 2차 브랜치 리뷰에서 남김 (2026-10-13)
2026-10-13에 `feat/followups-3` 브랜치에서 처리했어요([계획](../plans/2026-10-13-followups-3.md)).
- ~~Safari에서 순서가 고정된 채 행을 누르면 `focusout`의 `relatedTarget`이 null이라 고정이 풀려 누르고 떼는 사이에 다시 정렬됨 · `Leaderboard.svelte`의 `onfocusout`~~ → 해결: 목록 안에서 누르면 클릭이 끝날 때까지 순서를 고정하고, 다음 `pointerdown`·300ms 안전 해제·`pointercancel`·키 입력에서 풀어요. 실제 WebKit 하니스에서 누른 행마다 클릭이 들어가는 것을 확인했어요. (`5fd6c96`, `d90169b`)
- ~~편집기 DX: 테스트·설정 파일이 루트 `tsconfig.json`에서 빠져 편집기가 비엄격 프로젝트로 추론함 · `tsconfig.json`, `tsconfig.test.json`~~ → 해결: 루트 `tsconfig.json`이 테스트·설정 파일까지 넓게 덮고(strict, node 타입), 앱만 검사하는 설정은 `tsconfig.app.json`으로 옮겼어요. `tsconfig.test.json`은 없앴어요. `tests/e2e`는 기존대로 `tsconfig.e2e.json`을 써요. (`9afc714`)
- ~~테스트 다듬기 · 컨트롤러 혼합 실패 테스트(3개 중 프록시 1 + 타임아웃 1 + 정상 1로), `loadIssue.test.ts`의 중복 타임아웃 단언, Toggle 테스트 정리를 `finally`로, StrategyList의 복제 뒤 다른 것 삭제 테스트, 두 번째 로드의 손상 가드 테스트, 서로 다른 시각의 429 여러 번 테스트, `Leaderboard.test.ts`의 "이미 고정된 목록 안 포인터 누름" 테스트가 가드만 확인함~~ → 해결: 항목을 모두 처리했어요. 혼합 실패(프록시 1 + 타임아웃 1 + 정상 1) 테스트 추가, 중복 타임아웃 단언 제거, Toggle 정리를 `afterEach`로 이동, StrategyList 복제 뒤 삭제 테스트, 두 번째 로드 손상 가드 테스트, 서로 다른 시각의 429 여러 번 테스트를 더하고, Leaderboard 누름 테스트가 실제 동작을 단언하도록 고쳤어요. (`ee9edd2`)
- ~~`write-failed` 저장소 안내는 기록만 되고 화면에 안 나옴 · `storage.ts`~~ → 해결 (의도한 동작으로 결정): 정리용 최선 노력 쓰기의 실패이고 사용자가 할 일이 없어서 배너를 띄우지 않아요. 스펙 §10.1에 적었어요. (`ee9edd2`)
- 종가 고정가 체결(KRX 시간외종가 08:30–08:40·15:40–16:00, NXT 종가매매시장 15:30–16:00)과 NXT 15:30–15:40 호가접수 구간을 모델링하지 않음 · `sessions.config.ts` · 고정가 체결이에요. KIS 분봉에 이 체결이 들어오는지 몰라서 실연결 점검 ②에서 먼저 확인해야 해요. 그대로 두면 NXT가 지원하지 않는 종목은 15:40–16:00에 거래 불가로 보이고, NXT 15:30–15:40은 단일가 구간으로 근사돼요. → 남음: 실연결 점검 ②가 먼저예요. 확인한 뒤 `sessions.config.ts`의 NXT `after-auction`을 고쳐요.
- KRX 애프터마켓의 종목별 추가 제외(관리종목·투자경고 등)를 모델링하지 않음 · 앱에 해당 메타데이터가 없어서 지금은 반영할 수 없어요. → 남음: 메타데이터가 없어요.
- iOS Safari에서 누름 고정이 실제 기기 터치 타이밍으로 잘 동작하는지 확인하지 못함 · `Leaderboard.svelte` · WebKit 하니스로만 확인했어요. → 남음: 실제 기기가 있어야 해요.

### 선정 기준 검증 2~4단계 (2026-10-16)
조건 표(스펙 5장)에 줄을 더하는 구조로 붙인다. 각 단계는 따로 설계한다.

**진행 상황: 2~4단계가 모두 끝났어요. 2단계(재무·가치)는 [설계](../specs/2026-10-17-fundamental-criteria-design.md), 브랜치 `feat/fundamentals`예요. 실연결 점검은 [live-check ㉕·㉖](../../live-check.md)이에요.** 4단계(환율·유가 영향도, 테마)는 끝났어요 ([설계](../specs/2026-10-16-macro-theme-criteria-design.md), 브랜치 `feat/macro-theme-criteria`). 3단계(투자자 매매동향)도 끝났어요([설계](../specs/2026-10-16-investor-flow-criteria-design.md), 브랜치 `feat/investor-flow`). 3단계의 실연결 점검은 [live-check ㉓·㉔](../../live-check.md)예요. 4단계의 실연결 점검은 [live-check ㉑·㉒·㉒-1](../../live-check.md)예요. 데이터 조사 결과는 [스펙 9장](../specs/2026-10-16-selection-criteria-validation-design.md)이다. 2·3단계 수집은 같은 스크립트에서 하고 앱은 수집 파일만 읽으므로 프록시 허용 목록을 바꿀 필요가 없다.
- ~~2단계 재무·가치: KIS 재무 TR(재무비율·손익·대차). 결산년월은 있고 공시일은 없다. → 조건부 가능. 공시 지연 규칙(연간 +90일, 분기 +60일)이 필요하고, PER·PBR은 과거 종가 ÷ 그때 공시된 EPS·BPS로 계산한다. 이력 깊이는 실연결 확인이 필요하다. 정밀하게 하려면 DART(키·`corp_code` 매핑)가 필요하다.~~ → 해결: 2단계에서 만들었어요. 경로·필드·단위·깊이는 ㉕에서 확인해요.
- ~~3단계 투자자 매매동향: KIS 종목별 투자자 일별(FHPTJ04160001). 날짜를 거슬러 조회하고 수량과 금액을 준다. → 가능. 최대 깊이는 실연결 확인이 필요하다. 반영은 하루 늦춘다.~~ → 해결: 3단계에서 만들었어요. 경로·필드·단위와 최대 깊이는 ㉓에서 확인해요.
- ~~4단계 환율·유가 영향도: FRED CSV(DEXKOUS, DCOILWTICO, DCOILBRENTEU). 키가 필요 없고 1980년대부터 있다. → 가능. 수집 스크립트에서 함께 받는다(브라우저 CORS 문제 없음).~~ → 해결: 4단계에서 만들었어요.
- ~~4단계 테마: KIS `theme_code.mst`(현재 편입만), 사용자 정의 묶음. → 가능. 과거 편입 이력이 없다는 한계를 안내한다.~~ → 해결: 4단계에서 만들었어요. 결과에 테마 메모로 한계를 안내해요.
- 실연결 점검 ⑯~⑲ 결과와 `output2` 빈 구간 동작은 [live-check](../../live-check.md)에서 확인한다.

### 선정 기준 검증 1단계에서 남김 (2026-10-16)
[설계](../specs/2026-10-16-selection-criteria-validation-design.md) · [계획](../plans/2026-10-16-selection-criteria-validation.md)의 작업별·최종 리뷰에서 나온 것 중 영향이 작아 미룬 것들이에요.

- ~~해외식 색 관례에서 첫 ETF 선(`--s6`)이 상승색 초록과 거의 같음 · `src/lib/ui/screen/curveStyles.ts` · 관례에 따라 ETF 팔레트를 고르거나 선 모양으로 구분하고, `tokens.test`가 두 관례를 모두 보게 해요. 두 번째 ETF와 두 번째 지수가 같은 `--s3`(실선·점선으로 구분)인 것도 함께 정리해요.~~ → 해결: ETF 선 전용 토큰 `--etf-1`·`--etf-2`를 두고 관례마다 골라요. 한국 관례는 초록·황토, 글로벌 관례는 파랑·황토예요(두 테마 모두 `--bg` 위 3:1 이상). 두 번째 ETF는 이제 지수 보라(`--s3`)와 겹치지 않아요. 관례를 바꾸면 차트가 색을 다시 읽어요. `tokens.test`가 두 관례 모두에서 등락색·지수 색과 다른지 봐요. (`feat/etf-line-colors`)
- 같은 업종 이름이 시장마다 다른 레벨에 잡히면 업종 고르기에서 두 줄로 나뉨 · `precompute.ts`의 묶음 키 · 실연결 점검 ⑰에서 실제로 갈리는지 확인한 뒤 정해요.
- 수집기: 토큰 발급 응답 본문 읽기 시간 초과가 `netFail`을 거치지 않음, `--update` 겹침 구간을 정확한 값으로 비교, 빈 구간에서 `output2`를 빼고 응답하면 재시도 후 실패로 셈(실연결 점검 ⑱을 첫 5년 수집 전에 먼저) · `scripts/kis-collect.mjs`, `scripts/collect-market-data.mjs`
- ~~시장 데이터 검증기가 `managed`·`halted` 불리언을 확인하지 않고, o·h·l·v·tv에 0을 허용함 · `src/lib/marketData/format.ts` · 수집기만 파일을 만들어 영향이 작아요.~~ → 해결: `managed`·`halted`가 불리언이 아니면 `format`이에요. 수집기가 가격 0 이하인 행을 버리므로 o·h·l은 c처럼 0 초과, v·tv는 0 이상(음수면 `corrupt`)만 받아요. (`claude/chore-small-cleanup-bbfe95`)
- ~~CI에서 `test:scripts`가 demo·universe 테스트를 한 번 더 돎 · `.github/workflows/ci.yml` · 단계를 하나로 합쳐요.~~ → 해결: CI는 `test:scripts` 한 단계만 돌아요. (`feat/followups-4`)
- 데모 fixture에 KRX 휴장일이 없음, 기본 `DecompressionStream` 경로는 jsdom에서 안 돌아 e2e만 덮음 · `tests/fixtures/market-data-demo.json.gz`
- ~~테스트 보강: ① 첫 구간이 자본(initial)에서 시작하는지 고정, ② 창 밖에서 막힌 추가 매수가 창 안에서 같은 가격에 채워지는 경우, 기존 그룹에 넣을 때 "이미 있음 + 자리 부족" 두 번째 줄~~ → 해결: ① 첫날 값에서 재면 결과가 뒤집히는 `beatCount` 경우, ② 창 밖 d(10)에 97에서 막힌 분할 매수가 창이 다시 열린 d(11)에 97로 체결되는 경우, 그리고 `TodayPicks`의 `빈자리가 모자라 1개는 넣지 못했어요` 줄을 테스트로 고정했어요. ①·②는 동작을 일부러 망가뜨려 테스트가 실패하는 것도 확인했어요. (`claude/chore-small-cleanup-bbfe95`)
- ~~선정 기준 편집의 복제가 한도에서 이유 없이 비활성(전략 편집과 같음) · `CriteriaEditor.svelte`~~ → 해결: 선정 기준·전략 편집 모두 복제 버튼을 막지 않고, 한도에서 누르면 목록 화면처럼 한도 스낵바(`… 20개까지 저장할 수 있어요`)로 이유를 알려요. (`claude/chore-small-cleanup-bbfe95`)
- 실제 기기에서 5년 파일로 검증 실행(메모리·시간) · 실연결 점검 ⑳

### 2단계에서 미룬 것 (2026-10-17)
`feat/fundamentals`의 작업별 리뷰에서 나온 것 중 영향이 작아 미룬 것들이에요.

- Q5 잔여 위험: 마지막 연간 행 뒤 열린 회계연도 안에서 결산월이 바뀌면 `a`와 증가율 값이 틀리게 붙을 수 있어요. KIS 데이터가 서로 어긋나야 생겨요 · `scripts/fetch-fundamentals.mjs` · ㉕에서 실제로 나오는지 보고 판단해요.
- `cumulative:false`이면 결산 분기에서 분기 값이 연간 값보다 먼저 쓰여요 · `scripts/fetch-fundamentals.mjs`의 `income` · ㉕에서 누적 여부를 확인한 뒤 다시 봐요.
- 재무는 STOCK 종목만 받아요(Q6). REIT·기타는 재무가 없어요 · `scripts/collect-market-data.mjs` · 필요하면 대상을 넓혀요.
- 데모의 적자 종목과 늦게 시작하는 종목은 관리종목이라 기본 풀(관리종목 제외)에서 빠져요 · `scripts/make-demo-market-data.mjs` · 해당 경우를 e2e로 보려면 풀 설정을 바꿔야 해요.
- 데모의 우량주 테스트 기준이 ROE 18 이상이에요. 217776이 한 때 19.9까지 내려가서 20으로 못 잡아요 · `tests/demo.test.mjs`
- ~~테스트 도우미가 겹쳐요(`finStock`, FIN_BASE 자르기). 한 테스트 묶음은 id `'late'`를 이름 `'저PER'`에 다시 써요 · `src/lib/screen/*.test.ts`~~ → 해결: `testData.ts`에 `finStock(s, n, patch, meta)`와 `cutFin`(재무 배열 자르기)을 두고 `fin.test`·`select.test`가 함께 써요. `runValidation.test`의 묶음 id는 내용과 무관한 `'pool'`로 바꿨어요. (`claude/chore-small-cleanup-bbfe95`)
- ~~`CriteriaEditor.svelte`가 약 770줄이에요 · 다음에 `RankSection`을 떼어내요.~~ → 해결: `RankSection.svelte`로 떼어냈어요(약 690줄). 정렬 이름은 `screenText.ts`의 `RANK_LABEL` 한 곳에 둬요. (`feat/followups-4`)

### 4단계에서 미룬 것 (2026-10-16)
`feat/macro-theme-criteria`의 작업별·최종 리뷰에서 나온 것 중 영향이 작아 미룬 것들이에요.

- ~~`fetch-fred`가 4xx에도 재시도함, 시간 초과 테스트가 없고 `now`를 인자로 받지 않음 · `scripts/fetch-fred.mjs` · 4xx는 바로 실패로 보고, 시간 초과와 `now` 주입 테스트를 더해요.~~ → 해결: 4xx(429 제외)는 바로 실패해요. 시간 초과는 `timeoutMs`로 줄여 테스트해요. `now`는 기간을 늘 호출하는 쪽이 넘겨서 쓰는 곳이 없어 넣지 않았어요. (`f4b0e54`)
- 키가 없는 이전 데이터에서 `themes()`가 호출마다 본문 전체를 읽음 · `src/lib/marketData/store.ts` · 읽은 요약을 한 번 저장해 둬요.
- ~~`loadBaskets`는 `{}`를 손상으로 알리지만 sanitize는 빈 것으로 봄, 쓰이지 않는 `now` 인자가 있음, `pool.themes`와 묶음 개수에 상한이 없음 · `src/lib/screen/baskets.ts`의 묶음 저장·정리 · 두 쪽 판단을 맞추고 인자를 지우고 상한을 정해요.~~ → 해결 (판단 차이는 의도로 결정): sanitize는 `baskets` 칸이 없는 이전 내보내기 파일을 받아야 해서 `{}`를 빈 목록으로 보고, 저장소는 앱이 늘 `{ baskets: [...] }`로 쓰므로 `{}`를 손상으로 봐요. `loadCriteria`도 같은 규칙이라 주석과 테스트로 고정했어요. `sanitizeBaskets`의 `now` 인자를 지웠어요. 선정 기준의 `pool.themes`는 `POOL_THEMES_MAX`(500, KIS 테마 약 300개), `pool.baskets`는 `MAX_BASKETS`(30)개까지 앞에서부터 남기고 `repaired`로 알려요. (`claude/chore-small-cleanup-bbfe95`)
- 중분류 대장주 회귀 케이스가 모든 곳에서 0을 줘서 확인이 약함: 데모에 중분류 코드가 없어요 · `tests/fixtures/market-data-demo.json.gz`, `scripts/make-demo-market-data.mjs` · 데모에 중분류 코드를 넣어요.
- ~~정렬을 민감도 큰 순(`macroBeta`)만으로 할 때 워밍업 구간의 빈 칸을 메모하지 않음 · `src/lib/ui/screen/ValidationResult.svelte` · 조건에 민감도를 켠 경우의 안내와 맞춰요.~~ → 해결: 민감도 순으로 정렬하면 β가 필요하다고 보고, 후보 전체에 β가 없는 재선정일에 `macroGap` 메모를 남겨요. (`feat/followups-4`)
- ~~PreviewPanel이 막힌 상태에서도 기준일 줄과 `.state` 스타일을 보여줌(보기만 어색함) · `src/lib/ui/screen/PreviewPanel.svelte`~~ → 해결: 막혔으면 기준일 줄을 감추고 상태 영역(`role="status"`)에 안내만 보여요. 상태 영역은 화면 낭독기 알림 때문에 그대로 둬요. `PreviewPanel.test`를 더했어요. (`claude/chore-small-cleanup-bbfe95`)
- 민감도를 켜면 봉마다 메모리가 약 24 B(β용 Float64 두 배열과 Int32 색인 두 배열)라 449만 봉이면 약 108 MB인데, 스펙 3.4는 72 MB로만 어림함 · `src/lib/screen` 사전 계산과 스펙 3.4 · 5년 실행에서 실제 사용량을 재고 스펙의 어림값을 고치거나 배열을 줄여요.
- 테마를 가져올 때 데이터 파일 전체를 읽음 · `src/lib/marketData` · 테마 부분만 따로 읽는 길을 찾아요.

### 3단계에서 미룬 것 (2026-10-17)
`feat/investor-flow`의 작업별·최종 리뷰에서 나온 것 중 영향이 작아 미룬 것들이에요.

- ~~수집기 테스트 R5의 제목이 `start>to` 경우를 말하지만 실제로는 그 경우를 돌리지 않음 · `tests/collect-market-data.test.mjs` (R5) · 그 경우를 실제로 돌리거나 제목을 고쳐요.~~ → 해결: 제목을 실제로 확인하는 경우(일봉 실패로 남긴 종목)에 맞췄어요. `start>to`면 요청하지 않으니 경고 분모에도 세지 않아요. (`feat/followups-4`)
- ~~수급 절반 실패 경고의 분모가 이전 값을 지킨 종목까지 포함해서 경고가 덜 나올 수 있음 · `scripts/collect-market-data.mjs` · 이번에 받으려던 종목 수를 분모로 해요.~~ → 해결: 분모가 이번 수집에서 받으려던 종목 수예요(.partial에서 이어 받은 종목과 멈춘 뒤 남은 종목은 넣고, 이전 값만 지킨 종목은 빼요). 재무 경고도 같은 규칙으로 맞췄어요. R4b 테스트를 더했어요. (`feat/followups-4`)
- ~~`--update`의 "새 일봉 0개"와 "수정주가 다시 받기" 경우는 테스트가 없음(탐침으로는 정상 확인) · `tests/collect-market-data.test.mjs`~~ → 해결: (S7c) 새 일봉 0개면 일봉·수급이 이전 파일과 같고 수급은 겹친 5일만 다시 받고, (S7d) 수정주가로 일봉을 다시 받은 종목도 이전 수급을 지키고 뒤로 이어 붙이는 것을 테스트로 고정했어요. (`claude/chore-small-cleanup-bbfe95`)
- ~~`Simulate.test`가 `StrategyEditor.svelte:201`에서 `binding_property_non_reactive` 경고를 찍음 · 3단계 이전부터 있었어요.~~ → 해결: 함수 바인딩(`bind:this={() => …, (v) => …}`)으로 바꿔 경고가 없어요. (`feat/followups-4`)
- ~~정렬 고르기가 6개가 되어 좁은 폰에서 줄이 넘어감 · `src/lib/ui/screen/CriteriaEditor.svelte` · 모양을 다시 잡아요.~~ → 해결: `Segmented`에 `wrap`을 더해 600px 미만에서는 두 칸씩, 넓은 화면에서는 넘치면 다음 줄로 가요. 375px에서 가로 스크롤 없음을 확인했어요. (`feat/followups-4`)
- KIS 수급 API의 경로·필드·단위는 `FLOW_API`의 가정이고 확인하지 못함 · `scripts/fetch-investor-flow.mjs` · 실연결 점검 ㉓에서 확인해 고쳐요.
- ~~정렬이 `flow`일 때 통과 개수에 계산할 수 없는 종목이 빠짐. `macroBeta`는 그런 종목도 세므로 둘이 다름 · `src/lib/screen` · 어느 쪽에 맞출지 정해요.~~ → 해결 (결정): `macroBeta`도 수급·재무 순처럼 β가 없는 종목을 정렬과 통과 수에서 빼요. [4단계 스펙](../specs/2026-10-16-macro-theme-criteria-design.md) 3.3 정렬에 적었어요. (`feat/followups-4`)

### 좁은 폰 화면(갤럭시 플립 등, 2026-10-26)

사용자가 갤럭시 Z 플립에서 확인한 내용이에요. 인앱 브라우저 360×780에서 같은 증상을 재현했어요. 412px에서는 2번이 나타나지 않아요.

- 비교 화면 앱 바에서 그룹 이름이 `관…`, `내 …`처럼 잘림 · `src/lib/ui/compare/GroupTabs.svelte`, `src/App.svelte`(앱 바 오른쪽 상태 칩·아이콘 3개) · 상태 칩(`KRX 정규 · 15:15`)과 아이콘이 폭을 차지해 그룹 탭에 남는 자리가 거의 없어요. 좁은 폭에서는 상태 칩을 점·시각만으로 줄이거나, 그룹 탭을 앱 바 아래 줄로 내리는 방안을 비교해요.
- 종목이 9~10개면 거래 가능 시간 막대(레인)의 아래쪽 줄이 범례(`거래 불가`·`단일가`·`거래 없음`)와 `표 보기`에 겹침 · `src/lib/chart/SessionLanes.svelte`, `src/lib/ui/compare/ChartPanel.svelte` · 360px에서 재현, 412px에서는 겹치지 않아요. 레인 영역 높이가 종목 수에 맞춰 늘지 않는 것으로 보여요. 원인을 확인하고, e2e에 360px·10종목 경우의 겹침 검사(요소 경계 상자 비교)를 더해요.
- 좁은 폰 폭이 e2e에 없음 · `playwright.config.ts` · 지금은 phone 375px만 있어요. 360px(갤럭시 플립·S 시리즈 기본 폭) 프로젝트를 더하거나, 비교 화면 레이아웃 검사만 360px로 한 번 더 돌려요.
