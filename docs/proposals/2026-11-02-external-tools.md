# 외부 도구 적용 검토: impeccable · hyperframes · TradingAgents

> 검토: 2026-11-02 · Claude와 Codex(`gpt-6.1-sol` high) 교차 검증 · 설치·실측은 하지 않았어요

- 「프로젝트 도구 검토」 세션에서 정리한 향후 적용 방안을 옮겨 적었어요. 지금은 기록만 하고, 설치나 코드 변경은 하지 않았어요.
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
- **(b) 아이디어 → 명시적 규칙 → 결정적 검증:**
  - LLM이 낸 전략 아이디어를 전략 빌더의 조건식으로 옮겨요.
  - 그 조건식은 기존 엔진(`src/lib/sim/simulate.ts`)과 기준 검증(`src/lib/screen/runValidation.ts`)으로만 평가해요.
  - LLM이 과거 기간의 매매 결정에 직접 끼어든 결과는 백테스트로 인정하지 않아요.
- **(c) 그들의 실패에서 얻는 점검표:** 가즈아의 시뮬레이션과 성과 비교가 아래 항목을 이미 다루는지 확인해 볼 만해요.
  - 거래 비용·세금 반영
  - 바이앤홀드·지수 기준선의 부호와 계산 검산
  - 짧은 기간·적은 종목으로 낸 높은 Sharpe 경계
  - 미래 정보 누출 검사
