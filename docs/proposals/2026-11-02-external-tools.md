# 외부 도구 적용 검토: impeccable · hyperframes · TradingAgents

> 검토: 2026-11-02 · Claude와 Codex(`gpt-6.1-sol` high) 교차 검증 · impeccable은 2026-11-03에 가즈아에서 시범 적용했고 2026-11-12에 렌더 스캔을 스크립트로 묶었어요(1절). hyperframes는 2026-11-12에 확인하고 들이지 않았어요(2절 「2026-11-12 확인」)
>
> **결정(2026-11-14): impeccable과 hyperframes는 가즈아·repass·landmark 모두에서 쓰지 않아요.** impeccable은 시범에서 고칠 지적이 10건 중 1건뿐이고 정적 검사는 0건이라, 패키지·`lint:design` 명령·렌더 스캔 스크립트를 걷어냈어요. 아래 1·2절은 검토 기록으로만 남겨요.

- 「프로젝트 도구 검토」 세션에서 정리한 향후 적용 방안을 옮겨 적었어요. 2026-11-03 기준으로 impeccable은 가즈아에 설치해 실측했고, 3절 (a)안(전략 비판 스킬)은 구현했고, (c)안은 점검했어요([백테스트 점검표](2026-11-03-backtest-checklist.md)). (b)안은 아직 기록만 있어요. hyperframes는 2026-11-12에 확인하고 들이지 않았어요(2절).
- impeccable과 hyperframes는 repass·landmark와 같은 방식으로 쓰는 세 프로젝트 공통안이에요. TradingAgents는 가즈아에만 해당하고, 통합하지 않고 아이디어만 빌려요.
- 적용 순서는 정하지 않았어요. 시작할 때 이 문서를 근거로 별도 설계를 써요.

## 1. impeccable — 디자인 점검 (세 프로젝트 공통)

[pbakaus/impeccable](https://github.com/pbakaus/impeccable)은 Anthropic frontend-design 스킬에서 출발한 디자인 스킬·플러그인이에요. 라이선스는 Apache-2.0이에요.

- 명령이 23개 있어요(audit, critique, harden, clarify, polish 등).
- LLM 없이 도는 62개 규칙 검사기 `npx impeccable detect`가 있어요.
- Rust 엔진 바이너리, 라이브 모드, 편집 훅이 함께 들어 있어요.

### 위험

- 전역으로 설치하면 Codex·Grok 훅을 프로젝트에 써 넣어요(이슈 #1190).
- 설치된 훅은 모델이 명령을 거절해도 자동으로 돌아요.
- 새 디자인 방향을 impeccable.style에서 받아 오고, 텔레메트리가 있어요.
- 규칙의 취향이 강해요.

### 적용 원칙

- **설치:** 프로젝트 단위로만 설치하고 전역 설치는 하지 않아요. 훅은 끄고, `DO_NOT_TRACK=1`로 텔레메트리를 꺼요. 세 저장소는 같은 버전으로 고정해요.
- **스크립트:** `package.json`에 `lint:design` → `impeccable detect <화면 소스 경로>`를 둬요.
  - 처음에는 결과를 보고만 하고 CI를 막지 않아요.
  - 오탐을 기록해 무시 규칙의 기준선을 만들어요.
- **명령:** audit, critique, harden(빈 상태·오류·접근성), clarify(문구)처럼 검토하는 명령만 써요. bolder, overdrive, colorize 같은 생성형 명령은 이미 있는 디자인 언어를 흔들 수 있어서 쓰지 않아요.
- **디자인 맥락:** 이미 있는 문서와 시각 자료를 근거로 만들어요. 가즈아에서는 `docs/design/`(목업, 시뮬레이션 UI 리뷰)과 `docs/readme/`(README 소개 그림, `scripts/build-motion.mjs`로 만드는 생성물)예요.
- **한계:** 정적 검사는 실제 기기·키보드·스크린리더 확인을 대신하지 못해요.
- **공통화 순서:**
  1. 한 저장소에서 오탐률을 확인해요.
  2. 쓸 만하면 무시 규칙과 스크립트를 세 저장소에 맞춰요.
  3. 그다음 공용 위치로 옮길지 정해요. 후보는 `@sch0718` 패키지나 sch0718 플러그인 마켓플레이스예요.

### 가즈아에서 특히 쓸모 있는 곳

전략 빌더 편집기처럼 조건을 많이 넣는 화면이에요. harden과 clarify로 빈 상태, 오류 문구, 좁은 화면을 점검하기 좋아요.

### 가즈아 시범 결과 (2026-11-03)

설계는 `docs/superpowers/specs/2026-11-03-impeccable-trial-design.md`예요.

**설치 확인**

- `impeccable@4.8.0`(엔진 `@impeccable/cli-<os>-<arch>@0.1.18`)을 devDependency로 버전을 고정해 설치했어요. 전역 설치는 하지 않았어요.
- 설치 스크립트가 없어요. 엔진 바이너리 sha256이 패키지에 든 체크섬과 같았어요.
- 설치와 `detect` 실행 전후 비교 결과예요.
  - 저장소: `package.json`·`pnpm-lock.yaml`만 바뀌었어요.
  - 홈: `~/.claude`·`~/.codex`·`~/.cursor`의 설정 파일 17개 해시가 같았고, `~/.impeccable`도 생기지 않았어요.
- 텔레메트리는 디자인 방향 받기(roll API)에만 있어요. `lint:design`에는 `DO_NOT_TRACK=1 IMPECCABLE_NO_TELEMETRY=1`을 붙였어요.
- 스킬·훅(`impeccable install`·`skills`)과 LLM 명령(audit·critique·harden·clarify)은 쓰지 않았어요. 이 명령들은 스킬이 있어야 도는데, 스킬을 깔면 훅 설정을 쓰기 때문이에요. 전략 편집기는 같은 관점으로 직접 읽어 점검했어요.

**검사 방식별 결과**

| 방식 | 대상 | 지적 |
|---|---|---|
| `pnpm lint:design`(`src` 484파일은 정규식, `index.html`은 HTML 엔진) | 소스 | 1건 |
| `.svelte`를 HTML 엔진으로 | 소스 | 2건 |
| 렌더 화면(`detect --cdp`) | 화면 11개 × 폰 375·데스크톱 1440 | 26건(고유 7건) |

**분류와 오탐률:** 원인(규칙 × 원본) 단위로 고유 10건이에요.

| # | 규칙 | 원본 | 나온 검사 | 분류 |
|---|---|---|---|---|
| 1 | `side-tab` | `ResultView.svelte` 지난 결과 왼쪽 강조선 | 정규식 | 취향 |
| 2 | `tight-leading` | `CompareChart.svelte` 한 줄짜리 차트 끝 라벨 | HTML 엔진 | 오탐 |
| 3 | `tiny-text` | `ChartPanel.svelte` 범례 11.5px | HTML 엔진 | 취향 |
| 4 | `undersized-ui-text` | `@sch0718/ui-svelte` `Badge` 10px | 렌더 | 취향 |
| 5 | `undersized-ui-text` | `@sch0718/ui-svelte` `Segmented` 보조 글자 10px | 렌더 | 취향 |
| 6 | `repeating-stripes-gradient` | `ChartPanel.svelte` 범례 빗금(거래 불가·단일가 표시) | 렌더 | 오탐 |
| 7 | `nested-cards` | `CondGroupCard.svelte` 조건 묶음 카드 | 렌더 | 취향 |
| 8 | `first-viewport-column-overflow` | `Simulate.svelte` 데스크톱 편집기·결과 나란히 배치 | 렌더 | 오탐 |
| 9 | `flat-type-hierarchy` | `Performance.svelte` 제목 13·15px | 렌더 | 취향 |
| 10 | `low-contrast` | `ConnectionForm.svelte` 프록시 주소 입력 placeholder, 브라우저 기본색 `--bg` 위 4.3:1(WCAG 1.4.3 미달) | 렌더 | **실제** |

- 합계는 실제 1건(10%), 오탐 3건(30%), 취향 6건(60%)이에요. 지적마다의 근거는 설계 문서 「분류」 표에 있어요.
- 10번은 axe e2e가 placeholder를 보지 않아 놓친 문제예요.
- 고칠 지적의 비율(정밀도)이 10%예요. 정적 검사(`lint:design`)만 보면 고칠 지적이 0건이고, 실제 문제 1건은 렌더 스캔에서만 나왔어요.
- 전략 편집기에서 나온 지적은 조건 묶음 카드 중첩(취향)과 데스크톱 배치(오탐)뿐이에요. 직접 점검(오류 문구, 빈 상태, 한도 안내, 좁은 화면)에서도 분명한 결함은 없었어요.

**고친 것과 기준선**

- `src/lib/ui/tokens.css`에 전역 `::placeholder { color: var(--t3); opacity: 1; }`를 넣었어요. 다시 스캔하니 설정 화면의 `low-contrast`가 0건이었어요. 프록시 주소 입력이 보이고 색이 `--t3`인 것도 확인했어요.
- 기준선은 `ResultView.svelte`의 `side-tab` 줄 끝 인라인 주석 하나예요(`impeccable-disable-line side-tab -- 사유`).
  - `side-tab`은 값 단위 무시(`ignores add-value`)를 받지 않아요.
  - `"*" --file`로 넣으면 그 파일 전체가 가려져서, 줄 단위 주석을 골랐어요.
  - 그래서 `.impeccable/config.json`은 만들지 않았어요.
- HTML 엔진 지적(2·3번)과 렌더 스캔 지적(4~9번)은 위 분류표가 기준선이에요. 다시 돌릴 때 `--json` 결과의 규칙 ID와 원본을 이 표와 맞춰 봐요.

**다시 돌리는 법** (2026-11-12부터 스크립트)

- 렌더 스캔: `pnpm lint:design:render`(`scripts/design-scan.mjs`). 빌드한 뒤 `vite preview`(포트 4181)와 headless Chromium(CDP 9341)을 띄우고, 위 시범 순서대로 화면 11개 × 폰 375·데스크톱 1440에서 `impeccable detect --json --cdp`를 돌려요. 포트는 `DESIGN_SCAN_PORT`·`DESIGN_SCAN_CDP_PORT`로 바꿔요.
  - 지적을 `scripts/design-scan-baseline.json`(규칙·스니펫·선택자·화면과 분류·사유)과 맞춰 「기준선」·「새 지적」으로 나눠 보여요. 보고서는 `test-results/design-scan/report.json`이에요.
  - 종료 코드: 건너뛴 화면이나 검사·실행 실패가 있으면 2, 새 지적이 있으면 1, 없으면 0. CI에는 넣지 않았어요.
  - 새 지적은 실제 문제면 고치고, 오탐·취향이면 사유와 함께 기준선 파일에 더해요.
- HTML 엔진: 저장소 루트에 `.impeccable/config.local.json`을 `{"detector":{"extensions":[{"ext":".svelte","engine":"html"}]}}`로 잠깐 만들고 `pnpm lint:design`을 돌린 뒤 지워요.

**렌더 스캔 재실행 결과 (2026-11-12)**

- 22개 화면이 모두 돌았고 원인 단위 지적은 9개예요. 실제 문제는 0건이에요. 시범에서 고친 placeholder `low-contrast`는 다시 나오지 않았어요.
- 8개는 시범 4~9번과 같아 기준선으로 옮겼어요. `Badge`·`Segmented` 10px은 공용 패키지 기본 스타일이고 WCAG 하한이 없는 취향이라, 가즈아 `tokens.css`에서 덮지 않았어요(덮으면 세 저장소 모양이 갈라져요).
- 새로 1개가 나왔어요. 시뮬레이션 템플릿 화면의 프리셋 비교 안내(`StrategyList.svelte` `.cmp-note`) 11px `tiny-text`예요. 앱 라벨 토큰(`--fs-label`)을 쓰는 보조 문구라 시범 3번처럼 취향으로 기준선에 넣었어요.

**공용화**

- 세 저장소에 맞추는 일(버전 고정·스크립트·무시 규칙)과 공용 위치로 옮기는 일은 이 측정 결과를 보고 따로 정해요. 이번 시범은 가즈아 한 저장소의 측정과 명백한 수정까지만 했어요.
- 판단에 쓸 사실은 다음과 같아요.
  - 정적 검사(`lint:design`)에서 고칠 지적은 0건이었어요.
  - 실제 문제 1건은 렌더 스캔에서만 나왔어요.
  - 정밀도는 10%였어요.

**후속**

- placeholder는 공용 패키지 `@sch0718/ui-svelte`에 지정이 없어 브라우저 기본색이 남은 것이에요. 가즈아는 `tokens.css`에서 정했어요. `Badge`·`Segmented` 10px는 공용 패키지 기본 스타일이에요. 둘 다 공용 패키지에서 다룰지는 공용화와 함께 따로 정해요.
- 360px 프로젝트(`phone-narrow`)가 `simulate.spec.ts`를 돌리지 않아요. 360px에서는 전략 편집기의 모든 구역 펼침 점검이 비어 있어요.
- 조건 묶음 사이 「또는」이 `aria-hidden`이라, 화면 읽기 프로그램에서는 묶음끼리의 관계가 덜 드러나요(분명한 결함은 아니라 기록만 해요).

## 2. hyperframes — 데모 영상 자동 생성 (세 프로젝트 공통, 가즈아가 시범 1순위)

[heygen-com/hyperframes](https://github.com/heygen-com/hyperframes)는 HTML/CSS/JS 컴포지션을 헤드리스 Chrome에서 프레임 단위로 seek한 뒤 FFmpeg로 MP4를 만들어요.

- 라이선스는 Apache-2.0이고, 렌더 비용이나 상업 이용 제한이 없어요.
- Node 22 이상과 FFmpeg가 필요해요.
- Claude Code 플러그인과 스킬(`/hyperframes` 등)이 있어요.

### 제약

- 애니메이션을 `seek(time)`으로 되감을 수 있어야 해요. GSAP 정지 타임라인, WAAPI, CSS를 써요. `setTimeout`이나 `requestAnimationFrame`으로 상태를 바꾸는 코드는 그대로는 렌더되지 않아요.
- 텔레메트리(PostHog)가 기본으로 켜져 있어요. `HYPERFRAMES_NO_TELEMETRY=1`로 꺼요.
- macOS XProtect가 렌더 프로세스를 죽이는 이슈가 있어요(#6530).
- 릴리스가 매우 잦고, breaking 변경도 나와요(0.9.0).
- 로컬 렌더가 느려요. 30초짜리 1080p에 약 3분이 걸려요.

### 가즈아에서 할 일 (코드로 확인함)

- 지금 `motion/gazua-demo.html`은 `setTimeout`으로 13단계를 진행해요. 영상은 macOS Shift+Cmd+5로 손으로 녹화해요.
- MP4를 자동으로 만들려면 원본 `poc/gazua-poc.html`의 단계 진행을 seek 가능한 타임라인(WAAPI나 GSAP 정지 타임라인)으로 바꾼 뒤, `motion/gazua-demo.html`에 다시 복사해야 해요. 이 변경은 PoC의 `?demo` 재생에도 함께 적용돼요.
- 바꾼 뒤에도 아래 두 가지는 유지해야 해요.
  - `tests/demo.test.mjs` 회귀 테스트와 「조작하면 멈춤」 동작
  - 이 파일이 `poc/gazua-poc.html`의 사본이라는 관계

### 세 프로젝트 공통 파이프라인

1. **원재료:** 데모 데이터로 앱을 띄워 Playwright로 녹화하거나, 위 모션 데모를 써요.
2. **합성:** hyperframes 공통 템플릿 하나로 인트로 타이틀, 자막, 강조, 아웃트로(서비스 주소)를 입혀요. 저장소마다 다른 것은 브랜드 값(색·로고·서비스명)뿐이에요.
3. **산출물:** MP4는 커서 git에 넣지 않아요. 배포 위치는 따로 정해요.

가즈아에서 템플릿이 굳으면 repass·landmark가 가져다 써요. 영상을 실제로 배포할 필요가 확실해질 때 시작해요.

### 2026-11-12 확인: 들이지 않음

- 확인한 것: 저장소 `heygen-com/hyperframes`, Apache-2.0, npm `hyperframes@0.9.38`(압축 해제 25MB, `puppeteer-core`·`esbuild` 등 의존). 설치 스크립트는 없고, 텔레메트리(PostHog)는 `HYPERFRAMES_NO_TELEMETRY`·`DO_NOT_TRACK`으로 꺼져요.
- 들이지 않은 이유
  - 자동 업데이트가 기본으로 `npm|pnpm|bun install -g`를 백그라운드에서 돌려요(사람 없는 실행이나 `HYPERFRAMES_NO_AUTO_INSTALL=1`이면 꺼짐). 적용 원칙의 「전역 설치 금지」와 맞지 않아요.
  - 설정을 `~/.hyperframes`에, 브라우저를 `~/.cache/hyperframes`·`~/.cache/puppeteer`에 둬요.
  - 같은 패키지의 `usage` 명령이 macOS 키체인의 Claude Code 자격 증명과 `~/.codex/auth.json`을 읽어 각 회사 사용량 API로 보내요. 렌더에는 쓰이지 않지만 들일 코드에 들어 있어요.
  - 릴리스가 하루에도 여러 번이에요.
  - 무엇보다 위 파이프라인 1단계(원재료)는 이미 있는 Playwright 녹화로 충분해요. hyperframes가 더하는 건 2단계 합성(인트로·자막)이고, 배포할 영상이 필요해질 때 버전 고정과 `HYPERFRAMES_CONFIG_DIR`·`HYPERFRAMES_BROWSER_PATH`·`HYPERFRAMES_NO_AUTO_INSTALL=1`·`HYPERFRAMES_NO_TELEMETRY=1`로 저장소 안에 가둬 다시 따져요.
- 대신 만든 것: `pnpm demo:video`(`scripts/demo-video.mjs`). 데모 데이터로 폰 375×812에서 온보딩 → `데모로 둘러보기` → `예시 그룹 불러오기` → 시뮬레이션 → `＋ 새 전략` → `하락 후 반등` → 실행 → 재생·일시정지를 Playwright로 녹화해요(약 16초).
  - 결과는 `test-results/demo-video/gazua-demo.webm`이고, `ffmpeg`가 있으면 `gazua-demo.mp4`도 만들어요. 커밋하지 않아요.
  - 포트는 4182(`DEMO_VIDEO_PORT`)예요.
  - 손으로 녹화하던 `motion/gazua-demo.html`(모션 그래픽)과는 대상이 달라 그대로 둬요.

## 3. TradingAgents — 아이디어만 빌림 (가즈아 전용)

[TauricResearch/TradingAgents](https://github.com/TauricResearch/TradingAgents)는 LLM 멀티에이전트 매매 프레임워크예요. 라이선스는 Apache-2.0이고, 버전은 v0.7.1로 1.0 이전이에요.

- 펀더멘털·심리·뉴스·기술 애널리스트가 병렬로 보고서를 써요.
- 강세 연구원과 약세 연구원이 그 보고서로 토론해요.
- 트레이더가 제안하면 리스크 관리와 포트폴리오 매니저가 승인해요.

### 통합하지 않는 이유

- **데이터:** 미국 시장 중심이에요(Yahoo, SEC, FRED). KRX 지원은 확인되지 않았고, 매크로 데이터도 미국 것뿐이에요.
- **비용:** 요청 한 번에 32.9만 토큰이 든 사례가 있어요.
- **백테스트 신뢰성:**
  - 논문의 AAPL 바이앤홀드 기준선 부호가 틀렸다는 재계산이 있어요.
  - 거래 비용을 반영한 재현에서는 바이앤홀드가 5종목 중 4종목에서 이겼어요.
  - LLM이 사전학습으로 결과를 미리 알고 있을 수 있는 누출 문제도 풀리지 않았어요.
- **설계 충돌:** 가즈아의 강점은 재현 가능한 결정적 백테스트이고, 「주문 없음」이 설계 결정이에요. LLM 의견을 엔진의 신호로 넣으면 기준 검증의 신뢰가 깨져요.

### 빌려 올 아이디어

로드맵 최우선 1·2와 이어져요.

- **(a) 역할 토론형 전략 비판:** 읽기 전용 `gazua` CLI의 출력(`signals`, 시뮬레이션 요약 등)을 입력으로 받아요. 강세·약세·리스크 역할의 에이전트가 전략의 약점을 따지는 Claude Code 스킬을 만들어요.
  - CLI 다음 단계인 MCP 서버와 묶기 좋아요.
  - 출력은 참고 의견일 뿐이고 매매 신호가 아니에요.
  - **구현됨(2026-11-03):** `.claude/skills/strategy-critique/`. MCP 도구 `strategies`·`simulate`·`signals`의 결과를 쓰고, 개선 아이디어는 전략 빌더 조건식으로 내며 효과는 (b)안대로 엔진 시뮬레이션으로만 확인하라고 안내해요. 설계는 `docs/superpowers/specs/2026-11-03-strategy-critique-skill-design.md`예요.
- **(b) 아이디어 → 명시적 규칙 → 결정적 검증:**
  - LLM이 낸 전략 아이디어를 전략 빌더의 조건식으로 옮겨요.
  - 그 조건식은 기존 엔진(`src/lib/sim/simulate.ts`)과 기준 검증(`src/lib/screen/runValidation.ts`)으로만 평가해요.
  - LLM이 과거 기간의 매매 결정에 직접 끼어든 결과는 백테스트로 인정하지 않아요.
- **(c) 그들의 실패에서 얻는 점검표:** 가즈아의 시뮬레이션과 성과 비교가 아래 항목을 이미 다루는지 확인해 볼 만해요. 2026-11-03에 점검했고 결과는 [백테스트 점검표](2026-11-03-backtest-checklist.md)에 있어요.
  - 거래 비용·세금 반영
  - 바이앤홀드·지수 기준선의 부호와 계산 검산
  - 짧은 기간·적은 종목으로 낸 높은 Sharpe 경계
  - 미래 정보 누출 검사
