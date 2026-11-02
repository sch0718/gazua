# impeccable 시범 적용: 디자인 정적 검사와 오탐률 측정

> 작성일: 2026-11-03 · 관련: 외부 도구 검토 1절(`docs/proposals/2026-11-02-external-tools.md`)

## 목표

외부 도구 검토 1절의 적용 원칙대로 impeccable을 가즈아에 프로젝트 단위로 붙여요. 그리고 오탐률을 재요. 세 저장소 공용화(버전 고정·공용 위치)는 이 측정 결과를 보고 따로 정하므로 이번 범위가 아니에요.

- `pnpm lint:design`으로 화면 소스를 정적 검사해요. CI는 막지 않아요.
- 결과를 실제 문제·오탐·취향으로 나누고, 오탐·취향은 무시 규칙 기준선(D3)에 사유와 함께 적어요.
- 실제 문제 중 harden·clarify 성격(빈 상태, 오류 문구, 좁은 화면, 접근성)이 분명한 것만 고쳐요.
- 오탐률을 검토 문서 1절에 적고, 공용화는 「측정 결과를 보고 따로 정함」으로만 적어요.

범위 밖:

- impeccable 스킬·플러그인·훅 설치(`impeccable install`, `skills install`). 저장소와 홈에 훅·스킬 설정을 쓰기 때문이에요.
- 생성형 명령(bolder, overdrive, colorize 등)과 디자인 방향 받기(roll API). LLM이 도는 audit·critique·harden·clarify 명령도 스킬이 있어야 돌므로 이번에는 쓰지 않아요. 같은 관점(빈 상태·오류·접근성·문구)으로 전략 편집기를 직접 읽어 점검해요.
- 공용 패키지 `@sch0718/ui-svelte`의 스타일 변경. 세 저장소가 함께 쓰므로 여기서 덮어쓰지 않고 후속으로 넘겨요.
- 렌더된 화면 스캔(`--cdp`·URL)을 스크립트로 저장소에 넣는 일. 이번 측정에는 썼지만, 상시 도구로 둘지는 공용화와 함께 따로 정해요.

## 지금 상태 (2026-11-03 조사)

### 패키지 출처

- `impeccable@4.8.0`(npm `latest`, 2026-10-26 갱신). 저장소 `github.com/pbakaus/impeccable`, Apache-2.0, 관리자 `paulbakaus`.
- 설치 스크립트(`preinstall`·`install`·`postinstall`·`prepare`)가 없어요. 패키지 파일은 `cli/bin/cli.js`(116줄짜리 실행 shim), 체크섬 목록, LICENSE뿐이에요.
- 엔진은 플랫폼별 optionalDependency(`@impeccable/cli-<os>-<arch>@0.1.18`)의 Rust 바이너리예요. darwin-arm64 바이너리의 sha256이 패키지에 든 `engine-checksums.txt` 값과 같아요. 서명은 ad-hoc이에요.
- shim은 `IMPECCABLE_BIN` → optionalDependency → `~/.impeccable/bin/<버전>` 캐시 순서로 바이너리를 찾아요. 셋 다 없을 때만 GitHub 릴리스에서 내려받고, 체크섬이 맞아야 캐시에 써요. optionalDependency가 깔려 있으면 네트워크와 홈 쓰기가 없어요.
- 텔레메트리는 디자인 방향 받기(roll API)에만 붙어 있어요. `DO_NOT_TRACK` 또는 `IMPECCABLE_NO_TELEMETRY`가 있으면 건너뛰어요(바이너리 도움말 문구로 확인).
- 바이너리 문자열에 `.codex/hooks.json`·`.claude/settings.json`·`.agents/skills/impeccable` 같은 경로가 있어요. `install`·`skills` 명령이 쓰는 곳이고, `detect`·`ignores`는 쓰지 않아요(아래 설치 전후 비교).

### 설치 전후 비교

- `pnpm add -D -E -w impeccable@4.8.0` 전후로 비교했어요.
  - `git status`: `package.json`·`pnpm-lock.yaml`만 바뀌었어요.
  - 홈 설정 파일 17개의 sha1이 같아요. 대상은 `~/.claude/settings.json`, `~/.codex/` 아래 11개(`.codex-global-state.json`, `app-server-daemon/loaded-threads.json`, `auth.json`, `chrome-native-hosts-v2.json`, `computer-use/config.json`, `config.toml`, `external_agent_session_imports.json`, `hooks.json`, `models_cache.json`, `vendor_imports/skills-curated-cache.json`, `version.json`), `~/.cursor/` 아래 5개(`argv.json`, `extensions/extensions.json`, `mcp.json`, `skills-cursor/.sync-manifest.json`, `unified_repo_list.json`)예요. `~/.grok`·`~/.gemini`·`~/.agents`는 원래 없었어요.
  - 설치 전 값은 이 세션 scratchpad의 `home-before.sha`에 있어요(저장소 밖). 구현 끝에 같은 목록을 다시 재서 비교해요.
  - `~/.impeccable`이 생기지 않았어요.
- `detect`를 여러 번 돌린 뒤에도 같아요.

### 검사 결과

| 방식 | 대상 | 지적 |
|---|---|---|
| 정규식(기본) | `src` 484파일 | 1건 |
| HTML 엔진(`.svelte`를 `engine: html`로) | `src` | 2건 |
| 렌더 화면(`--cdp`) | 화면 11개 × 폰 375·데스크톱 1440 | 26건(고유 7건) |

- 정규식 검사는 글자 크기·대비 같은 요소 규칙을 돌리지 못해요. 도구도 "적게 센 값"이라고 알려요.
- 렌더 화면 스캔에서는 다음 화면을 Playwright로 띄웠어요.
  - 온보딩, 비교(빈 상태·예시 그룹)
  - 시뮬레이션 빈 목록, 템플릿 고르기
  - 전략 편집기(처음·모든 구역 펼침), 결과
  - 성과, 설정, 도움말

### 분류

같은 원인(규칙 × 원본 위치)은 한 건으로 셌어요.

| # | 규칙 | 원본 | 나온 검사 | 분류 | 근거 |
|---|---|---|---|---|---|
| 1 | `side-tab` | `ResultView.svelte` `.result.stale` 왼쪽 3px 강조선 | 정규식 | 취향 | 지난 실행 결과를 투명도 대신 강조선으로 알리려고 고른 표현이에요(주석에 이유가 있어요). |
| 2 | `tight-leading` | `CompareChart.svelte` `.end-label` `line-height: 1` | HTML 엔진 | 오탐 | 차트 끝에 붙는 한 줄짜리 절대 위치 라벨이라 줄간격이 없어요. |
| 3 | `tiny-text` | `ChartPanel.svelte` `.legend` 11.5px | HTML 엔진 | 취향 | 차트 범례예요. 앱 라벨 토큰(11px) 이상이에요. |
| 4 | `undersized-ui-text` | `@sch0718/ui-svelte` `Badge` 10px(NXT·데모 데이터·데모 계좌예요) | 렌더 | 취향(공용 패키지) | WCAG에는 글자 크기 하한이 없어요. 세 저장소 공용 컴포넌트라 바꾸려면 따로 정해야 해요. |
| 5 | `undersized-ui-text` | `@sch0718/ui-svelte` `Segmented` 보조 글자 10px(KRX·NXT) | 렌더 | 취향(공용 패키지) | 4와 같아요. |
| 6 | `repeating-stripes-gradient`(참고) | `ChartPanel.svelte` 범례 빗금 | 렌더 | 오탐 | 장식이 아니라 거래 불가·거래정지·단일가 구간을 뜻하는 범례 표시예요. |
| 7 | `nested-cards` | `CondGroupCard.svelte` 조건 묶음(편집기·결과) | 렌더 | 취향 | "묶음 안은 모두 만족, 묶음끼리는 또는"을 보여 주는 구조예요(스펙 §10.2). |
| 8 | `first-viewport-column-overflow` | `Simulate.svelte` 데스크톱 `.split` | 렌더 | 오탐 | 왼쪽 편집기와 오른쪽 결과를 나란히 두는 배치예요. 실행 전에는 결과 칸이 비어 있어 짧은 게 맞아요. |
| 9 | `flat-type-hierarchy` | `Performance.svelte` 제목 13·15px | 렌더 | 취향 | 촘촘한 데이터 화면에 맞춘 크기예요. |
| 10 | `low-contrast`(참고) | `ConnectionForm.svelte` 프록시 주소 입력(`#<uid>-url`) placeholder, 브라우저 기본색 `#757575` on `--bg` 4.3:1 | 렌더 | **실제** | WCAG 1.4.3 미달이에요. 앱에 placeholder 색 지정이 없어요. |

- 지적 10건 중 고칠 실제 문제는 1건(10%)이에요.
  - 오탐 3건(30%), 취향 6건(60%)이에요.
  - 오탐과 취향을 합쳐 90%는 손대지 않는 지적이에요.
- 전략 편집기에서 나온 지적은 7·8번뿐이고, 둘 다 고칠 대상이 아니에요.

### 전략 편집기 직접 점검 (harden·clarify 관점)

- 오류: 숫자 칸·이름 칸에 `aria-invalid`, `aria-describedby`, `role="alert"`가 있어요. 막는 경고와 확인할 점은 색과 기호(!/△)로 함께 구분해요.
- 빈 상태: 매수 조건이 없거나, 종목이 0개이거나, 조건 매도가 비었으면 막는 경고 문구가 있어요(`src/lib/sim/validate.ts`). 그룹이 지워지면 "고른 그룹이 지워졌어요. 다시 골라 주세요." 안내가 나와요. 관심 그룹은 하나 아래로 지울 수 없어서(`groupActions.ts`) 그룹 칩이 비는 경우는 없어요.
- 한도: 묶음·조건 최대 개수에 닿으면 추가 버튼을 끄고 이유를 보여요.
- 좁은 화면: e2e가 375px 이상(375·820·1180·1440)에서 모든 구역을 펼쳐도 카드 밖으로 넘치지 않는지 확인하고, 320px에서는 처음 자금 칸만 확인해요(`tests/e2e/simulate.spec.ts`). 360px 프로젝트 `phone-narrow`는 `testMatch`에 `simulate.spec.ts`가 없어 전략 편집기를 점검하지 않아요. 360px 점검은 이번 범위 밖의 빠진 점검이에요.
- 분명한 결함은 찾지 못했어요. 아래 하나는 "분명한 것만 고친다" 기준에 못 미쳐 기록만 해요.
  - 묶음 사이 "또는"이 `aria-hidden`이에요. 화면 읽기 프로그램에서는 묶음이 "매수 묶음 1", "매수 묶음 2"로만 들려 둘의 관계가 덜 드러나요.

## 결정과 근거

### D1. 설치: 버전 고정 devDependency, 실행 시 텔레메트리 끄기

- `devDependencies`에 `"impeccable": "4.8.0"`(정확한 버전)으로 둬요. 엔진 버전은 이 버전이 가리키는 `0.1.18`로 함께 고정돼요.
- `lint:design` 스크립트 앞에 `DO_NOT_TRACK=1 IMPECCABLE_NO_TELEMETRY=1`을 붙여요. `detect`는 텔레메트리를 쓰지 않지만, 원칙을 스크립트에 남겨 두려는 거예요. 저장소 스크립트는 이미 `TZ=… vitest`처럼 POSIX 환경 변수 접두를 써요.

### D2. 스크립트: `lint:design` = `impeccable detect src index.html`

- 화면 소스는 `src`(Svelte·TS·CSS)와 `index.html`이에요. `poc/`·`motion/`은 원본 PoC와 그 사본이라 앱 화면이 아니어서 빼요.
- 엔진은 도구 기본값을 써요. `src`의 `.svelte`·`.ts`·`.css`는 정규식, `index.html`은 HTML 엔진으로 돌아요. `.svelte`를 HTML 엔진으로 돌리면 요소 규칙을 얻는 대신 정규식 규칙과 줄 번호를 잃어요. 이번 측정에서 HTML 엔진이 더 찾은 2건도 오탐·취향이었어요.
- CI 워크플로에는 넣지 않아요. 지적이 있으면 종료 코드 2로 끝나지만, 로컬에서 보고만 해요.
- 저장소 루트에서 `pnpm lint:design`으로만 돌려요. 설정과 무시 규칙 경로가 실행한 디렉터리 기준이에요.

### D3. 무시 규칙 기준선: 줄 단위 인라인 주석, 사유와 함께

- 규칙을 통째로 끄지 않고 지적이 난 줄 하나만 가려요. 같은 규칙이 다른 곳에서 새로 나오면 다시 보이게 하려는 거예요.
- `ignores add-value`는 쓰지 않아요. `side-tab`은 뽑을 값이 없어 값 단위 무시를 받지 않고(`has no extractable ignore value`), `"*" --file`로 넣으면 그 파일의 같은 규칙이 모두 가려져요.
- 대신 지적이 난 줄 끝에 `/* impeccable-disable-line <규칙> -- <사유> */`를 달아요. 그래서 기준선은 `.impeccable/config.json`이 아니라 소스 안의 인라인 주석이에요. 주석 하나는 동작을 바꾸지 않아서 D4의 "고치는 것"에 넣지 않아요.
- `lint:design`(정규식)에 나오는 건 1번(`side-tab`)뿐이라 인라인 주석도 1번 하나예요. HTML 엔진에서만 나온 2·3번과 렌더 스캔에서만 나온 4~9번은 `lint:design` 기준선에 넣을 수 없으니, 검토 문서의 분류표를 그 검사들의 기준선으로 남겨요.
- 사유는 위 분류표의 근거를 짧게 옮겨요.

### D3-1. 렌더 스캔 재실행 절차

저장소에 스크립트는 넣지 않고, 아래 절차를 검토 문서에 적어 다시 돌릴 수 있게 해요.

1. `pnpm build` 뒤 `vite preview --port 4174 --strictPort`로 띄워요.
2. Playwright Chromium을 `--remote-debugging-port=9333`으로 띄워요. e2e와 같은 설정(`locale: ko-KR`, `timezoneId: Asia/Seoul`, `serviceWorkers: block`, 시계 고정, 메뉴 안내 본 것으로)을 써요.
3. 뷰포트는 폰 375×812(`isMobile`)와 데스크톱 1440×900이에요.
4. e2e 헬퍼와 같은 순서로 화면에 들어가요: 온보딩 → `데모로 둘러보기` → `예시 그룹 불러오기` → 시뮬레이션 → `＋ 새 전략` → `하락 후 반등` → 모든 구역 펼침 → 실행 결과 → `#/performance`·`#/settings`·`#/help`.
5. 화면마다 `DO_NOT_TRACK=1 IMPECCABLE_NO_TELEMETRY=1 pnpm exec impeccable detect --json --cdp 9333`을 돌려요. `--cdp`는 지금 보이는 페이지를 이동하지 않고 검사해요.

placeholder 확인은 설정 화면 두 뷰포트만 다시 돌리면 돼요. 데모 프로필 설정 화면에 프록시 주소 입력(`ConnectionForm.svelte`)이 보이는 상태여야 해요.

HTML 엔진 지적(2·3번)은 저장소 루트에 `.impeccable/config.local.json`을 `{"detector":{"extensions":[{"ext":".svelte","engine":"html"}]}}`로 잠깐 만들고 `pnpm lint:design`을 돌린 뒤 그 파일을 지워 다시 확인해요.

### D4. 고치는 것: placeholder 색 하나

- `src/lib/ui/tokens.css`에 전역 `::placeholder { color: var(--t3); opacity: 1; }`를 둬요.
  - `--t3`는 공용 토큰이 "흰 표면·표면 2·배경 모두 WCAG AA"라고 밝힌 색이에요. 라이트 `#676d77`, 다크 `#868b94`예요.
  - Firefox는 placeholder에 기본 불투명도를 줘서 `opacity: 1`도 함께 둬요.
- 테스트: `tokens.test.ts`가 토큰 CSS를 읽어 검사하는 방식이면, 같은 방식으로 이 규칙이 있는지 확인해요. 실제 대비는 렌더 스캔을 다시 돌려 `low-contrast`가 사라졌는지 봐요.
- 브라우저 기본색이 남은 원인은 공용 패키지 기본 스타일에 placeholder 지정이 없어서예요. 공용 패키지에서 다룰지는 공용화와 함께 따로 정해요.

### D5. 기록: 검토 문서 1절에 「가즈아 시범 결과」

- 설치 확인, 검사 방식별 건수, 분류표 요약, 오탐률, 후속을 적어요.
- 공용화(세 저장소 버전 고정, `@sch0718` 패키지·플러그인 마켓플레이스로 옮기기)는 「측정 결과를 보고 따로 정함」으로만 적어요. 그 설계·작업은 하지 않아요.

## 완료 기준

- `pnpm lint:design`이 기준선을 적용한 뒤 지적 0건으로 끝나요.
- D3-1 절차로 설정 화면을 다시 스캔하면 `low-contrast` placeholder 지적이 사라져요.
- `pnpm check`, `pnpm check:e2e`, `pnpm test`, `pnpm test:scripts`, `pnpm e2e`를 통과해요.
- 설치·실행 뒤 `git status`에 의도한 파일만 있어요. 홈 설정 파일 해시가 설치 전과 같아요.
