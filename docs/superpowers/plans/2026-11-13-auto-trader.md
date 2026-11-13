# 전략 자동 실행기 구현 계획

설계: [2026-11-13-auto-trader-design.md](../specs/2026-11-13-auto-trader-design.md). 설계와 다르면 설계를 따른다.

전제: 사용자 1명·맥 한 대. 시험은 동작을 지키는 만큼만 쓴다. 실제 주문·네트워크 호출 없음(가짜 fetch). 사용자에게 보이는 글·주석·커밋은 한국어.

## 순서

### 1. 프록시 분당 제한을 매수에만, 거절된 매도는 한도 복원 안 함 (`proxy/node/order.ts`, `proxy/node/order.test.ts`)

- `send`: `recent.length >= cfg.maxPerMinute` 검사를 `order.side === 'BUY' &&` 일 때만 한다. `recent.push(now)`도 매수일 때만.
- 복원(`ready`): `now - sent < 60_000 && side === 'BUY'`일 때만 `recent.push(sent)`.
- `count >= cfg.maxPerDay`는 그대로(매수·매도 합계).
- 총 가용 금액(설계 §9): `send`에서 `spend(order)`를 매수일 때만 바로 하고, 매도는 토스 200 접수(성공 분기) 때만 `spend`한다. 복원은 `send` 매도를 `clientOrderId`별로 보관했다가 같은 ID의 `result`가 `status: 200`일 때만 `spend`한다(`result` 줄은 지금도 `clientOrderId`·`status`를 쓴다). 매수 `send`는 지금처럼 바로 더한다.
- 시험 추가: 총 한도 상태에서 매도가 토스 4xx로 거절되면 `/order/status`의 `invested`가 그대로, 재시작 뒤에도 그대로. 접수된 매도는 줄어든다(재시작 포함).
- 시험: `maxPerMinute: 1`로 매수 1건 뒤 매수는 `order-rate-limited`, 매도는 통과(`maxPerDay`는 셈). 재시작 복원: 감사 로그에 최근 매도 `send`만 있으면 매수 통과, 최근 매수 `send`가 있으면 매수 거절. 기존 `it.each([{ maxPerMinute: 1 }, …])` 시험이 매수 요청을 쓰는지 확인하고 필요하면 맞춘다.
- 검증: `corepack pnpm --filter proxy test`.

### 2. 주문 보내기 함수 꺼내기 (`cli/src/commands/order.ts`)

- `export function proxySettings(ctx)`: 환경변수 세 개 → `{ server, headers }`(없으면 `order-not-configured`, 토큰은 `ctx.redact`에 등록).
- `export async function orderStatus(ctx, s)`: `limitsOf(await proxyCall(... '/order/status'))`.
- `export async function tossCredentials(ctx)`: `buildProvider(ctx,'toss',readCreds(ctx.env)).provider.account.orderHeaders()` + 가리기 등록. 계정 객체도 돌려준다(보유 조회용).
- `export async function sendOrder(ctx, s, credentials, input)`: POST `/order/toss` + 결과 검사(`unknownOrder`). 성공 시 `{ orderId, clientOrderId, amount }`.
- `order` 명령은 이 함수들을 써서 지금과 같은 출력을 낸다. 기존 `order.test.ts`가 그대로 통과해야 한다(수정 금지).

### 3. 시세 파싱 넓히기 (`cli/src/naverMarket.ts`)

- `DayBar`에 선택 필드 `high?`, `low?`, `volume?` 추가. `parseDayBars`가 `highPrice`·`lowPrice`·`accumulatedTradingVolume`을 읽는다(유한한 양수일 때만, 거래량은 0 이상).
- 기존 `naverMarket.test.ts`·알람 시험이 통과해야 한다. 새 필드 시험 1개.

### 4. 자동 실행기 모듈 (`cli/src/auto/`)

- `config.ts`: `readAutoConfig(env)` → `{ strategy, profile?, mode, buySlipPct, sellSlipPct }`. 설계 §2 검사. 오류는 `CliError('invalid-args', …)`.
- `tick.ts`: `tickOf(price)`, `tickUp(price)`, `tickDown(price)`(설계 §5 표).
- `ledger.ts`: `ledgerPath(dir, mode)`, `readLedger(path, today)`(없으면 빈 원장, 손상이면 `CliError('invalid-args', '자동 실행 원장을 읽을 수 없어요: <경로>')`, 날짜가 바뀐 `today` 비우기. 형식은 설계 §4의 `AutoLedger`), `writeLedger(path, ledger)`(`writeJsonFile`). 형식 검사는 필드 타입만 본다.
- `judge.ts`(순수 함수):
  - `toCandles(bars: DayBar[]): Candle[]`(high·low가 없으면 그 봉은 open·close의 최대·최소, 거래량 없으면 0).
  - `restore(pos, strategy): Position`(`openPosition` → `sells` 재생 → `markClose(peak)`).
  - `decideSell(pos, strategy, price, heldDays, sellSignal): { qty, reason, stage? } | null`(설계 §6 순서. 익절은 도달한 단계 수량의 합).
  - `decideBuy(...)`: 매수 조건·하루 한 번·보유·15:15·수량(`buyBudget`) → `{ qty, price, reason } | { skip } | null`.
- `run.ts`: `runAuto(ctx, deps)` 오케스트레이션(설계 §1·§6·§7). 의존성(`now`, `fetch`, 프로필 읽기, 토스 계정, 주문 보내기, 알림)은 `ctx`와 위 함수로 주입해 시험에서 바꿔 끼운다.
  - 시간·장 상태(`NAVER.kospiStatus`, `parseMarketStatus`가 `OPEN`이 아니면 `skipped: 'closed'`).
  - 원장 → 프로필·전략(`strategyId` 비교) → 종목(전략 ∪ 원장) 일봉 → 토스 보유 확인(실전, 필요할 때 한 번: `pendingSell` 체결 기록, 전날 포지션 수량 맞춤과 `boughtQty = qty + 확정 매도 합계`) → 매도 → 매수 → 원장 쓰기.
  - 주문 직전 원장 쓰기, 결과별 원장 갱신(설계 §7 표).
  - 알림(`sendNtfy`, `readAlertConfig`), 끝 줄 「투자 조언 아님」. 연습 제목 `[연습]`.
  - 실행 전체 오류: 같은 날 같은 코드는 한 번만 알리고 다시 던진다(`notified`).
- `cli/src/commands/auto.ts`: `auto` 명령(인자 없음, 남는 위치 인자는 `invalid-args`). `execute.ts`의 `COMMANDS`에 `auto` 추가. MCP 도구에는 넣지 않는다.

시험(`cli/src/auto/*.test.ts`, `cli/src/commands/auto.test.ts`), 설계 §12만:
- config 4건, tick 경계, judge(손절·추적·두 단계 동시 익절 합산·단계 익절 재매도 없음·기간 청산), run: 연습 모드 매수 알림·프록시 미호출, 하루 한 번, 15:15 이후 매수 없음, 장 상태 CLOSE면 아무것도 안 함, 실전 매수 성공 원장, 실전 rate-limited 되돌림·upstream 하루 막음·unknown 유지, 실전 매도 토스 보유 min·보유 0이면 안 팖(오늘 산 것은 유지)·`pendingSell` 중복 없음·부분 체결 기록·거절 뒤 그날 막힘, 전날 포지션 매도 뒤 재매수 없음, 실전에서 `totalMaxAmount` null이면 매수 안 함, 포지션이 있는데 전략이 바뀌면 멈춤, 원장 손상 시 멈춤, 주문 전 원장 기록(보내는 fetch 안에서 원장 파일을 읽어 확인).
- 네이버·토스·프록시·ntfy는 `fakeFetch`(`cli/src/testing.ts`)로 경로별 응답.

### 5. 예약 작업 (`scripts/macos/auto-agent/`)

- `install.sh`·`run.sh`·`plist.template`·`uninstall.sh`·`README.md`(collect-agent·alert-agent 본보기). 설계 §10.
- `tests/auto-agent.test.mjs`: `GAZUA_AUTO_DRY=1` 설치가 `StartInterval`(간격×60)과 `run.sh` 경로를 담은 plist를 만들고 `plutil -lint` 통과, `AUTO_INTERVAL_MIN=9`는 거절. `run.sh`는 장 밖 시각에 node를 띄우지 않음(`GAZUA_AUTO_NOW`처럼 시각을 바꿔 끼울 환경변수를 run.sh에 두고 시험).
- 설치(`launchctl`)는 하지 않는다.

### 6. 문서

- `cli/README.md`: `gazua auto` 명령 표 줄, 「자동 실행기」 절(설정 키, 연습·실전, 원장 파일, 알림, 예약 작업 설치 명령, 위험·중지 파일). 새 오류 코드는 만들지 않는다.
- `proxy/README.md`: 분당 제한은 매수만.
- `docs/roadmap.md` 단계 C: 자동 실행기 줄과 확인 시점(설계 §14).

## 검증(구현 뒤 Claude가 직접)

```bash
corepack pnpm --filter gazua-cli check
corepack pnpm --filter gazua-cli test
corepack pnpm --filter gazua-cli build
corepack pnpm --filter proxy test
corepack pnpm --filter proxy build
corepack pnpm test
corepack pnpm check
corepack pnpm build
corepack pnpm test:scripts
```
