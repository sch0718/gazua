# 가즈아 로드맵

> 기준일: 2026-11-02 (전략 빌더·읽기 전용 CLI·서버·DB 2단계 현황 갱신, 나머지는 2026-10-31 조사 기록)

이 문서가 우선순위의 기준이에요. 각 기능의 세부 설계와 구현 계획은 `docs/superpowers/specs/`와 `docs/superpowers/plans/`에서 다뤄요.

## 최우선 1: 나만의 투자 전략과 시뮬레이션 재생

전략 빌더(PR #62)와 재생(PR #60)은 구현됐어요. 아래 재생 계획과 한계는 2026-10-31 조사 기록이에요.

### 지금

- 전략(`src/lib/sim/types.ts`의 `Strategy`)은 v2 형식이에요(`src/lib/sim/strategyV2.ts`).
  - 이동평균·RSI·거래량·가격·반등 패턴 조건을 조합해요. 묶음 안은 AND, 묶음끼리는 OR예요(`src/lib/sim/rules.ts`).
  - 분할 매수, 1~3단계 익절·손절에 트레일링 스톱·기간 청산·조건 매도를 더했어요(`src/lib/sim/position.ts`, `src/lib/sim/simulate.ts`).
  - 최대 8종목이며, 처음 자금·총자산·남은 현금의 비율 또는 종목별 같은 금액으로 배분해요.
- 선정 기준이 전략을 참조해 매매하는 연결은 이미 있어요(`src/lib/screen/runValidation.ts`).

### A: 전략 빌더 (구현됨)

- 지표·가격·거래량 조건을 조합하는 편집기와 자금 배분 선택을 구현했어요(`src/lib/ui/simulate/StrategyEditor.svelte`).
- 기존 v1 전략은 읽을 때 v2로 옮겨요(`src/lib/sim/strategyV1.ts`의 `toV2`, `src/lib/sim/strategyStore.ts`).
- 엔진(`src/lib/sim/simulate.ts`, 순수 TS)은 일반 조건식으로 실행해요.
- 설계: `docs/superpowers/specs/2026-11-01-strategy-builder-design.md`. PR #62(`f5377a2`)로 병합됐어요.

### B: 재생 (구현됨, PR #60)

- 엔진이 거래일마다 아래 값을 내보내게 해요.
  - 종목별 보유 수량·평단·종가·평가액
  - 손절가·다음 추가 매수가·익절가
  - 신호 발생일
- 지금 `SimResult`에는 자산 곡선 `equity[]`와 체결 `trades[]`만 있어요. 일별 포지션은 없어요.
- 결과 화면에 아래를 더해요.
  - 재생/일시정지
  - 배속(예: 1·2·4·8배)
  - 하단 타임라인: 누르면 그 거래일로 이동해요.
  - 날짜 패널: 특정 날짜를 누르면 그날의 보유·현금·신호 상태를 보여 줘요.
- 차트는 기존 `lightweight-charts`를 써요.

### 한계

- 일봉 단위라 「시간대」는 거래일 단위예요. 장중 체결 시각은 없어요.
- 긴 기간 계산은 지금 메인 스레드에서 돌아요(`src/lib/ui/simulate/runController.svelte.ts`). 웹 워커로 옮길지 정해야 해요.

## 최우선 2: AI가 쓰는 가즈아 CLI

읽기 전용 단계 A는 구현됐어요. 실계좌 주문은 결정이 필요해요.

### 지금

- `cli/` 워크스페이스에 읽기 전용 `gazua` 진입점이 있어요(`cli/src/main.ts`). PR #63(`729e072`)으로 병합됐어요.
- 동기화 API(`sync-worker`)는 브라우저의 Origin 검사·`X-Gazua-Session` 세션과 별도로 CLI 기기 코드 로그인·읽기 전용 토큰 인증을 지원해요(`sync-worker/src/cli.ts`). 로그인은 사람이 앱에서 기기 코드를 승인해야 끝나요.
- 공급자 코드(`src/lib/providers/toss.ts`·`kis.ts`)를 Node에서도 재사용해요. CLI는 프록시와 같은 허용 목록을 적용해 증권사를 직접 호출해요(`cli/src/direct.ts`).
- 같은 코어를 감싸는 읽기 전용 MCP 서버 `gazua mcp`(stdio, 도구 7개)가 있어요. 설계는 `docs/superpowers/specs/2026-11-02-readonly-mcp-design.md`예요.
- 프록시는 주문 경로를 막아요(`proxy/src/allowlist.ts`). 주문 코드는 없어요.
- 「주문 없음」은 최초 설계부터의 결정이에요(`docs/superpowers/specs/2026-10-11-stock-compare-design.md` §1.3, `docs/proposals/2026-10-25-server-and-db.md`).

### 단계 A: 읽기 전용 CLI·MCP (구현됨)

- `gazua profiles`·`watchlists`·`strategies`: 동기화한 프로필·관심 그룹·전략 조회
- `gazua quote`: 시세 조회, `gazua holdings`: 토스 국내 보유 수량·평단 조회(KIS 보유 조회는 지원하지 않아요)
- `gazua signals`·`simulate`: 전략 신호 계산과 시뮬레이션 요약
- 기계가 읽기 좋은 JSON 출력(기본 한 줄)
- `gazua login`·`logout`: 기기 코드 로그인과 토큰 철회
- `gazua mcp`: CLI 읽기 명령과 일대일인 MCP 도구 7개(`login`·`logout` 제외). Claude Code 등록 방법은 `cli/README.md`의 「MCP 서버」 절에 있어요.
- 설치·명령·제약·배포 순서는 `cli/README.md`, 설계는 `docs/superpowers/specs/2026-11-01-readonly-cli-design.md`에 있어요. 운영 Worker에는 D1 `0005` 마이그레이션·`CLI_IP_SALT` 시크릿과 함께 배포했어요(2026-11-01).

### 단계 B: 주문 제안·모의투자

- AI가 전략 신호로 주문안을 만들어요. 사람이 확인해야 실행돼요.
- KIS 모의투자 환경으로 먼저 검증해요. 모의투자로 할 수 있는 범위는 실연결로 확인해야 해요.

### 단계 C: 실계좌 주문 (결정 필요)

- 사용자가 정해야 할 것:
  - 프록시 주문 경로 개방
  - 주문 한도(1회·하루 금액, 허용 종목)
  - 즉시 중지 스위치
  - 주문 감사 로그
  - 사람 승인 여부
- 최초 설계의 「주문 없음」 결정을 바꾸는 일이에요. 그래서 별도 설계에서 위험과 함께 정해요. 위험은 AI 오판, 프롬프트 주입, 키 노출, 실제 손실이에요.
- 약관상 자동 주문 허용 범위(KIS·토스)도 확인해야 해요.

### 참고

- Claude는 실제 돈이 오가는 주문을 직접 실행하지 않아요.
- 주문은 사람이 확인하는 흐름을 기본으로 둬요.

## 다음 우선순위

- 증권사 키 종단 간 암호화 동기화 — 구현·배포됐어요(PR #59). 두 기기 사이 실연결 점검만 남았어요.
- KIS 키 발급 뒤 실연결 점검 ①②③④⑦⑧⑨⑪ 등(`docs/live-check.md`) — 그 결과로 NXT 15:30–15:40 모델(`src/lib/market/sessions.config.ts`)과 일봉 거절 기억(`src/lib/data/candleService.ts`)을 고쳐요.
- 서버·DB 3단계(공동 그룹·정기 계산·알림·성과 이력) — 제안서(`docs/proposals/2026-10-25-server-and-db.md`) 순서대로 해요.

## 검토만 한 외부 도구

- impeccable(디자인 점검), hyperframes(데모 영상 자동 생성), TradingAgents(아이디어만 빌림)의 적용 방안을 기록해 뒀어요. 순서는 정하지 않았어요([외부 도구 적용 검토](proposals/2026-11-02-external-tools.md), 2026-11-02).

## 범위 밖으로 둔 것

지금은 계획이 없어요.

- 가격 알림·푸시
- 미국 주식
- 실시간 WebSocket
- 추세선 도구
- 뉴스·공시

## 구현 현황 요약

2026-10-31에 조사했어요. v1.1 지표(변동성·RSI(14))는 2026-11-02에 켰어요. 서버·DB 2단계는 2026-11-02에 다시 봤어요.

| 묶음 | 구현 | 남은 것 |
|---|---|---|
| 최초 로드맵(2026-10-11) | 24개 중 24개 | 없음 |
| 서버·DB 1단계 | 6/6 | 없음 |
| 서버·DB 2단계 | 5/5 | 없음 |
| 서버·DB 3단계 | 0/4 | 4개 |
