# 외부 도구 적용: impeccable 렌더 스캔 스크립트 · 데모 영상 스크립트 (설계·계획)

> 작성일: 2026-11-12 · 근거: `docs/proposals/2026-11-02-external-tools.md` 1·2절, `docs/superpowers/specs/2026-11-03-impeccable-trial-design.md`
> 전제: 사용자 1명, 여러 기기, 무료 운영. 작은 작업이라 설계와 계획을 이 문서 하나로 써요.

## 목표

1. impeccable 시범의 렌더 스캔 절차(「다시 돌리는 법」)를 스크립트 하나로 묶어 `pnpm lint:design:render`로 다시 돌릴 수 있게 해요. 다시 돌려 실제 문제만 고치고, 오탐·취향은 기준선으로 남겨요.
2. 데모 데이터로 주요 흐름 하나(전략 만들기 → 시뮬레이션 실행 → 재생)를 찍는 짧은 데모 영상 스크립트를 둬요. hyperframes는 이번에 들이지 않아요(아래 D5).

범위 밖: 생성형 디자인 변경, 새 화면, 공용 패키지(`@sch0718/ui-svelte`) 수정, 다른 저장소, 세 저장소 공용화, CI 연결. 동시에 도는 세션이 맡은 파일(`proxy/**`, `src/lib/marketData/**`, `src/lib/screen/**`, `src/lib/ui/screen/**`, `src/lib/ui/settings/DataTools.svelte`, `src/routes/Simulate.svelte`, `.github/workflows/ci.yml`, `pnpm-lock.yaml`)은 고치지 않아요. 거기서 나온 지적은 목록으로만 남겨요.

## 결정

### D1. 렌더 스캔 스크립트 `scripts/design-scan.mjs`

- 새 의존성 없이 이미 있는 `@playwright/test`의 `chromium`과 `impeccable@4.8.0`을 써요. `pnpm-lock.yaml`이 바뀌지 않아요.
- 흐름
  1. `dist/`가 없으면 멈추고 `pnpm build`를 먼저 하라고 알려요. 스크립트 항목은 `"lint:design:render": "pnpm build && node scripts/design-scan.mjs"`예요.
  2. `vite preview --port 4181 --strictPort`를 자식 프로세스로 띄우고 응답을 기다려요. 끝나면(오류 포함) 꼭 종료해요. 포트는 `DESIGN_SCAN_PORT`로 바꿀 수 있어요(e2e 4173, 다른 세션과 겹치지 않게 4180번대).
  3. Chromium을 headless로 `--remote-debugging-port=9341`(`DESIGN_SCAN_CDP_PORT`)로 띄워요. 컨텍스트는 e2e와 같게 `locale: ko-KR`, `timezoneId: Asia/Seoul`, `serviceWorkers: 'block'`, 시계 고정(`2026-10-08T17:42:00+09:00`, `tests/e2e/helpers.ts`의 `FIXED_NOW`), 메뉴 안내 본 것으로(`gazua:help-seen:v1`)예요.
  4. 뷰포트 두 개: 폰 375×812(`isMobile`, `hasTouch`), 데스크톱 1440×900. 뷰포트마다 새 컨텍스트에 페이지 하나만 열어요(`--cdp`가 고를 페이지가 하나여야 해요).
  5. 화면 순서(시범과 같음): 온보딩 → `데모로 둘러보기`(비교 빈 상태) → `예시 그룹 불러오기`(리더보드) → 시뮬레이션 목록 → `＋ 새 전략`(템플릿 고르기) → `하락 후 반등`(편집기 처음) → 모든 구역 펼침 → `시뮬레이션 실행` 결과 → `#/performance` → `#/settings` → `#/help`. 선택자는 `tests/e2e/helpers.ts`·`simulate.spec.ts`와 같은 역할·이름을 써요. 한 화면 이동이 실패하면 그 화면과 뒤 화면을 「건너뜀」으로 적고 다음 뷰포트로 가요.
  6. 화면마다 애니메이션이 끝나게 잠깐 기다린 뒤 `DO_NOT_TRACK=1 IMPECCABLE_NO_TELEMETRY=1 impeccable detect --json --cdp <CDP 포트>`을 돌려요. 포트는 브라우저를 띄운 값과 같은 변수를 써요. 종료 코드 2는 「지적 있음」이라 정상으로 보고, JSON 배열을 읽어요.
- 결과
  - `test-results/design-scan/report.json`(git 무시 경로)에 화면·뷰포트·지적 전체를 써요.
  - 콘솔에는 지적을 원인 단위(규칙 × 스니펫)로 묶어 「기준선」·「새 지적」으로 나눠 보여요.
  - 화면 11개 × 뷰포트 2개의 완료 여부를 보고서와 콘솔에 적어요.
  - 종료 코드: 건너뛴 화면·실패가 하나라도 있으면 2(가장 앞섬), 아니면 새 지적이 있으면 1, 없으면 0. CI에는 넣지 않아요.

### D2. 렌더 스캔 기준선 `scripts/design-scan-baseline.json`

- 렌더 지적은 소스 줄이 없어 줄 단위 무시 주석을 쓸 수 없어요. 그래서 시범 분류표(4~9번)를 기계가 읽는 표로 옮겨요.
- 항목: `{ "rule": "<규칙 ID>", "match": "<스니펫 정규식>", "selector": "<선택자 정규식>" (선택), "screens": ["<화면 ID>", …] (선택), "class": "오탐|취향|공용 패키지|보류", "reason": "<사유>" }`. 규칙이 같고 스니펫이 맞으면(화면을 적었으면 화면도 맞으면) 기준선으로 봐요.
- 새로 나온 지적은 분류해서: 실제 문제면 고치고, 오탐·취향이면 이 파일에 사유와 함께 더하고, 금지 파일에 걸린 실제 문제는 `class: "보류"`로 넣고 인계 메모에 적어요.
- 정적 검사(`pnpm lint:design`)의 기준선은 지금처럼 줄 끝 인라인 주석이에요.

### D3. 고치는 것

- 다시 돌린 결과에서 실제 문제(WCAG 미달, 잘림, 넘침처럼 분명한 결함)만 고쳐요. 공용 패키지에서 온 문제는 `src/lib/ui/tokens.css` 같은 가즈아 파일에서 덮을 수 있으면 덮고, 아니면 보고만 해요.
- `Badge`·`Segmented` 10px은 시범에서 「취향(공용 패키지)」으로 분류했어요. WCAG에 글자 크기 하한이 없고, 덮으면 세 저장소 사이에 모양이 갈라지므로 덮지 않고 기준선에 둬요.

### D4. 데모 영상 스크립트 `scripts/demo-video.mjs`

- 이미 있는 Playwright의 `recordVideo`로 찍어요. 새 의존성이 없어요.
- 흐름: D1과 같은 방식으로 `vite preview`(포트 4182, `DEMO_VIDEO_PORT`)를 띄우고, 폰 375×812 한 뷰포트에서 온보딩 → `데모로 둘러보기` → `예시 그룹 불러오기` → 시뮬레이션 → `＋ 새 전략` → `하락 후 반등` → `시뮬레이션 실행` → 결과 → 재생 막대 `재생` 몇 초 → `일시정지`. 동작 사이에 사람이 보기 좋게 쉬어요(약 1초). 시계 고정은 `setFixedTime`이라 재생 타이머는 돌아요.
- 결과: `test-results/demo-video/gazua-demo.webm`. `ffmpeg`가 PATH에 있으면 `gazua-demo.mp4`(H.264, `yuv420p`, `+faststart`)도 만들어요. 없으면 webm만 두고 알려요. 결과물은 커밋하지 않아요(`test-results/`는 git 무시).
- 스크립트 항목: `"demo:video": "pnpm build && node scripts/demo-video.mjs"`.
- `scripts/build-motion.mjs`·`motion/`은 SVG·HTML 모션이라 실제 앱 녹화와 겹치지 않아요. 두 스크립트가 같이 쓰는 「preview 띄우기·컨텍스트 만들기」는 `scripts/lib/app-preview.mjs` 하나로 둬요(쓰는 곳 두 곳이지만 같은 PR에서 같이 생기고 화면 이동 함수까지 겹쳐서 복사보다 나아요).

### D5. hyperframes는 들이지 않음 (2026-11-12 확인)

- 저장소·라이선스: `heygen-com/hyperframes`, Apache-2.0, npm `hyperframes@0.9.38`(오늘 배포, 압축 해제 25MB, 의존성에 `puppeteer-core`·`esbuild`·`hono` 등). 설치 스크립트는 없어요.
- 텔레메트리: PostHog(`us.i.posthog.com`), `HYPERFRAMES_NO_TELEMETRY`·`DO_NOT_TRACK`으로 꺼져요.
- 걸리는 점
  - 자동 업데이트가 `npm|pnpm|bun install -g hyperframes@<버전>`을 백그라운드로 돌려요. 사람이 없는 실행이나 `HYPERFRAMES_NO_AUTO_INSTALL=1`·`HYPERFRAMES_NO_UPDATE_CHECK=1`이면 꺼지지만, 기본값이 전역 설치예요(적용 원칙 「전역 설치 금지」와 맞지 않아요).
  - 기본 설정 폴더가 `~/.hyperframes`이고, 브라우저를 `~/.cache/hyperframes`·`~/.cache/puppeteer`에 받아요.
  - `usage` 명령은 macOS 키체인의 Claude Code 자격 증명과 `~/.codex/auth.json`을 읽어 각 회사 사용량 API로 보내요. 렌더에는 쓰이지 않지만 같은 패키지에 들어 있어요.
  - 릴리스가 하루에도 여러 번이고 0.x에서 breaking 변경이 나와요.
  - 들이려면 `pnpm-lock.yaml`을 바꿔야 하는데, 지금 다른 세션이 그 파일을 고치고 있어요.
- 무엇보다 지금 필요한 「데모 데이터로 흐름 하나를 찍은 짧은 영상」은 Playwright 녹화로 충분해요. hyperframes가 더해 주는 것은 인트로·자막·강조 합성이고, 제안 문서도 그것을 「영상을 실제로 배포할 필요가 확실해질 때」로 미뤄 두었어요. 그때 버전을 고정하고 `HYPERFRAMES_CONFIG_DIR`·`HYPERFRAMES_BROWSER_PATH`·`HYPERFRAMES_NO_AUTO_INSTALL=1`·`HYPERFRAMES_NO_TELEMETRY=1`로 저장소 안에 가둬 다시 따져요.

## 계획

| 순서 | 파일 | 할 일 |
|---|---|---|
| 1 | `scripts/lib/app-preview.mjs` | `startPreview({ port })`(빌드 확인, `vite preview` 자식 프로세스, 응답 대기, `stop()`), `newAppContext(browser, viewport, { recordVideo } = {})`(D1의 컨텍스트 설정과 init script, 영상 스크립트는 `recordVideo`를 넘겨요), `enterDemoFlow` 같은 화면 이동 함수 |
| 2 | `scripts/design-scan.mjs`, `scripts/design-scan-baseline.json` | D1·D2. 기준선에는 시범 4~9번을 먼저 옮겨요 |
| 3 | `scripts/demo-video.mjs` | D4 |
| 4 | `package.json` | `lint:design:render`, `demo:video` 스크립트(의존성은 바꾸지 않아요) |
| 5 | `tests/design-scan.test.mjs` | 기준선 맞추기 함수(순수 함수로 빼서)만 `node --test`로 시험해요. 브라우저를 띄우는 부분은 시험하지 않고 직접 돌려 확인해요 |
| 6 | (이 세션) | `pnpm lint:design:render`를 돌려 지적을 분류하고, 실제 문제를 고치고, 기준선을 채워요. `pnpm demo:video`로 영상을 만들어 봐요 |
| 7 | `docs/proposals/2026-11-02-external-tools.md` | 1절 「다시 돌리는 법」을 스크립트로 바꾸고 「렌더 스캔 재실행 결과(2026-11-12)」를 짧게, 2절에 D5 판단과 `pnpm demo:video`를 짧게 더해요 |

## 검증

- `pnpm check`, `pnpm check:e2e`, `pnpm test`, `pnpm test:scripts`, `pnpm build`, `pnpm e2e`가 통과해요.
- `pnpm lint:design`이 지적 0건이에요.
- `pnpm lint:design:render`가 끝까지 돌고, 남은 지적이 모두 기준선에 있어 종료 코드 0이에요.
- `pnpm demo:video`가 결과 영역, 재생 중 날짜가 바뀜, 일시정지를 e2e와 같은 선택자로 확인하고, 컨텍스트를 닫은 뒤 `video.saveAs()`로 저장이 끝난 파일을 `test-results/demo-video/`에 둬요. 영상은 사람이 한 번 재생해 봐요.
- `git status`에 의도한 파일만 있어요. `pnpm-lock.yaml`은 바뀌지 않아요.
