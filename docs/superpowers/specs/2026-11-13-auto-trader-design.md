# 전략 자동 실행기(`gazua auto`) 설계

- 날짜: 2026-11-13
- 전제: 사용자 1명, 본인 토스 계좌, 무료 운영, 맥 한 대. 판단이 갈리면 작은 쪽을 고른다.
- 승인: 방향은 사용자가 승인했다(2026-11-13). 처음에는 연습 모드(`AUTO_MODE=dry`)로만 운영한다.
- 이미 있는 것으로 안 되는 이유: `gazua signals --propose`는 종가 기준으로 하루 한 번 주문안만 내고, `gazua order`는 사람이 한 건씩 보낸다. 장중에 몇 분 간격으로 판정해 스스로 사고팔고, 자기가 산 포지션을 따로 기억하는 장치는 없다.

## 1. 하는 일

`gazua auto`는 **한 번 실행**하고 끝난다. launchd가 평일 장중에 1~5분마다 부른다.

1. 설정(`auto.env`)과 원장(`auto-positions*.json`)을 읽는다.
2. 시간·장 상태를 확인한다. 09:05 전, 15:20 뒤, 코스피가 `OPEN`이 아니면(상태를 모를 때 포함) 아무것도 하지 않고 끝낸다.
3. 동기화된 프로필에서 `AUTO_STRATEGY` 전략과 종목을 읽는다(`pickProfile`·`findStrategy`·`resolveSymbols`, `signals`와 같다).
4. 전략 종목과 원장 종목의 네이버 일봉을 받는다. 마지막 봉이 오늘이면 그것이 진행 중 임시 봉이다.
5. 원장 포지션마다 매도 판정 → 조건이 맞으면 매도(15:20까지).
6. 전략 종목마다 매수 판정 → 조건이 맞으면 매수(15:15 전까지, 같은 종목 하루 한 번).
7. 연습 모드는 주문 대신 ntfy로 「이렇게 보냈을 것」을 알리고 연습 원장만 바꾼다. 실전 모드는 `gazua order`와 같은 프록시 경로로 보낸다.
8. 결과를 JSON 한 줄로 낸다(launchd 로그에 남는다).

매도를 매수보다 먼저 판정한다. 오늘 매도를 보낸 종목은 그날 다시 사지 않는다(원장 `today.sold`).

## 2. 설정 `~/.config/gazua/auto.env`

| 키 | 기본 | 뜻 |
|---|---|---|
| `AUTO_STRATEGY` | (필수) | 전략 이름 또는 ID |
| `AUTO_PROFILE` | 없음 | 프로필이 여럿일 때 이름 또는 ID |
| `AUTO_MODE` | `dry` | `dry`(연습) 또는 `live`(실전). 다른 값이면 오류(실전으로 넘어가지 않는다) |
| `AUTO_BUY_SLIPPAGE_PCT` | `1` | 매수 지정가 = 현재가 × (1 + 이 값%) 를 호가 단위로 올림. 0~5 |
| `AUTO_SELL_SLIPPAGE_PCT` | `2` | 매도 지정가 = 현재가 × (1 − 이 값%) 를 호가 단위로 내림. 0~10 |
| `AUTO_INTERVAL_MIN` | `1` | 예약 작업 간격(분). 1~5. 예약 스크립트만 읽는다 |

- `AUTO_`로 시작하는데 위에 없는 키가 있으면 오류로 멈춘다(오타가 조용히 기본값이 되지 않게, 프록시의 `ORDER_` 규칙과 같다).
- 실전 모드는 같은 파일에 `TOSS_CLIENT_ID`·`TOSS_CLIENT_SECRET`(CLI용 토스 앱 키)과 `GAZUA_PROXY_URL`·`GAZUA_PROXY_TOKEN`·`GAZUA_PROXY_ORIGIN`이 필요하다. 연습 모드는 토스 키 없이 돈다.
- ntfy는 기존 `alert.env`의 `GAZUA_ALERT_NTFY_TOPIC`·`GAZUA_ALERT_NTFY_SERVER`를 쓴다(`readAlertConfig`). 토픽은 저장소·출력에 쓰지 않는다.
- 파일 권한은 600. 예약 스크립트가 `node --env-file=alert.env --env-file=auto.env`로 둘 다 넘긴다.
- `AUTO_MODE=live`로 바꾸는 것이 사람의 승인이다. `--yes`는 받지 않는다. 프록시 한도(`ORDER_TOTAL_MAX_AMOUNT` 등)와 중지 파일은 그대로 마지막 방어선이다.

## 3. 장중 판정

### 시세

- 네이버 공개 시세 `NAVER.itemDay(code, 시작, 오늘 2359)` 한 번으로 받는다. 2026-11-13 11:44에 확인: 응답 마지막 원소가 오늘 날짜이고 `openPrice`·`highPrice`·`lowPrice`·`closePrice`(현재가)·`accumulatedTradingVolume`이 있다.
- `parseDayBars`를 넓혀 `high`·`low`·`volume`도 읽는다(값이 없거나 0 이하이면 그 봉을 버리는 기존 규칙은 open·close에만 적용하고, high·low·volume은 있으면 읽는다). 기존 `DayBar` 사용처(알람)는 open·close만 써서 동작이 바뀌지 않는다.
- 일봉을 `Candle`(`t`=그날 KST 00:00, `o,h,l,c,v`)로 바꿔 `evaluateAt`에 넣는다. 거래대금(`value`)은 네이버 일봉에 없어 비워 둔다(거래대금 규칙은 시뮬레이션과 다르게 나올 수 있어 결과 `notes`에 적는다).
- 조회 시작일은 `warmFrom(오늘, strategy)`(기존 함수).
- 토스는 시세에 쓰지 않는다(토스 토큰은 한 기기에서만 유효해 휴대폰 앱과 부딪힌다). 토스는 실전 모드의 주문 직전 보유 확인과 주문에만 쓴다.
- 기존 `gazua signals`(종가 기준, 공급자 일봉)는 바꾸지 않는다.

### 종목별 판정

- 마지막 봉이 오늘이 아니면(거래정지·자료 지연) 그 종목은 이번 실행에서 매수·매도 판정을 건너뛰고 `skipped`에 적는다.
- 현재가 = 오늘 봉의 `close`.
- 매수: `evaluateAt(candles, strategy.rules.buy, 마지막 인덱스)`. 오늘 봉은 진행 중이라 거래량 등은 하루 전체보다 작다. 이는 사용자가 고른 방식이다(「장중 추격매수」).
- 매도 신호: 전략의 `sell.signal`이 켜져 있으면 같은 방식으로 판정한다.
- 종목 코드가 6자리 숫자가 아니면(예: `Q`로 시작하는 ETN) 이번 범위에서는 건너뛴다(`skipped`, 사람이 직접).

## 4. 원장

- 실전: `<설정 디렉터리>/auto-positions.json`, 연습: `<설정 디렉터리>/auto-positions.dry.json`. 권한 600, `writeJsonFile`(임시 파일 후 이름 바꾸기).
- 내용:

```ts
interface AutoLedger {
  version: 1;
  /** 원장을 만든 전략 ID. 포지션이 남아 있는데 AUTO_STRATEGY가 다른 전략을 가리키면 멈춘다 */
  strategyId: string | null;
  /** 오늘(KST) 매수를 보낸(또는 시도한) 종목과 매도를 보낸 종목. 날짜가 바뀌면 비운다 */
  today: { date: string; bought: string[]; sold: string[] };
  positions: AutoPosition[];
  /** 같은 날 같은 오류 알림을 한 번만 보내기 위한 기록: 'YYYY-MM-DD:<code>' */
  notified: string[];
}
interface AutoPosition {
  symbol: string;
  boughtAt: string;      // 매수를 보낸 KST 날짜
  buyPrice: number;      // 보낸 지정가(실제 체결가는 이 값 이하일 수 있음)
  orderId?: string;      // 매수 주문 ID(참고용)
  boughtQty: number;     // 처음 산 수량
  qty: number;           // 지금 원장 수량
  peak: number;          // 산 뒤 본 현재가 최고값(처음은 buyPrice)
  sells: { qty: number; stage?: number }[]; // 체결이 확인된 매도(부분 체결도 확인되는 대로 넣는다, 익절 단계 포함)
  pendingSell?: { date: string; sentAt: number; qty: number; qtyBefore: number; price: number; reason: string; stage?: number; warned?: boolean };
  unconfirmed?: true;    // 매수 결과 불명(order-unknown 등)
  sellBlocked?: string;  // 자동 매도가 막힌 날짜(그날은 더 보내지 않는다)
}
```

- 파일이 없으면 빈 원장. **있는데 읽을 수 없거나 형식이 틀리면 멈춘다**(빈 원장으로 보면 하루 한 번 규칙과 보유 기억이 사라져 중복 매수가 날 수 있다). 알림을 보내고 오류로 끝난다.
- **주문을 보내기 전에 먼저 원장을 쓴다.** 매수는 `today.bought`에 추가하고 포지션을 `unconfirmed`로 넣은 뒤 보낸다. 결과가 성공이면 `unconfirmed`를 지운다. 매도는 `today.sold`에 추가하고 `pendingSell`을 먼저 쓴다. 보내는 중에 꺼지면 다음 실행은 그것을 「보냈을 수 있음」으로 보고 다시 보내지 않는다.
- 원장에 포지션이 있는데 지금 `AUTO_STRATEGY`가 가리키는 전략 ID가 `strategyId`와 다르면 멈추고 알린다(전략 교체는 포지션을 다 정리한 뒤에). 같은 전략의 규칙을 앱에서 고치면 기존 포지션에도 새 규칙이 적용된다(문서에 적는다). 포지션이 없으면 `strategyId`를 지금 전략으로 바꾼다.
- 동시 실행은 예약 스크립트의 `lockf` 잠금으로 막는다. 사람이 손으로 돌릴 때도 `run.sh`를 쓰도록 안내한다.

## 5. 매수

조건(모두 만족):
- KST 15:15 전.
- 전략 매수 조건이 오늘 임시 봉에서 맞음.
- 오늘 `today.bought`·`today.sold`에 없음(같은 종목 하루 한 번, 오늘 판 종목 재매수 없음).
- 원장에 그 종목 포지션이 없음(추가 매수 없음).
- 실전: 토스 보유에 그 종목이 없음(`proposeOrders`의 「이미 보유 중」과 같다. 원래 가진 종목을 섞지 않는다). 매수 후보가 있을 때만 토스 보유를 한 번 조회한다.

가격·수량:
- 지정가 = `tickUp(현재가 × (1 + 매수 여유/100))`.
- 수량 = `floor(buyBudget(strategy, 전략 종목 수) / 지정가)`(`proposals.ts`의 `buyBudget`). 0주면 건너뛴다. 비율 배분(`cashPct`·`equityPct`)은 잔고를 몰라 처음 자금 기준이라 시뮬레이션보다 많이 살 수 있다(결과 `notes`에 적는다). 실전 모드에서는 프록시의 총 가용 금액 `ORDER_TOTAL_MAX_AMOUNT`가 꼭 있어야 매수한다(`/order/status`의 `totalMaxAmount`가 null이면 매수하지 않고 하루 한 번 알림).
- 호가 단위(KRX 2023-01-25 이후 주식): 2천 원 미만 1, 5천 미만 5, 2만 미만 10, 5만 미만 50, 20만 미만 100, 50만 미만 500, 그 이상 1,000원. ETF·ETN 구분은 하지 않는다(틀리면 토스가 거절하고 알림이 간다).
- 상한가 초과 등은 따로 막지 않는다. 토스가 거절하면 알림.

## 6. 매도(자동 실행기가 산 포지션만)

### 판정

원장 포지션을 시뮬레이션의 `openPosition`(`src/lib/sim/position.ts`)으로 되살려 같은 규칙을 쓴다.
- `openPosition(buyPrice, boughtQty, { ...strategy.scaleIn, on: false }, strategy.rules.sell)` → 확정 매도 `sells`를 차례로 `sell(qty, stage)` → `markClose(peak)`.
- 실행마다 먼저 `peak = max(peak, 현재가)`로 올린다.
- 아래 순서로 처음 맞는 하나만 낸다(한 실행에서 포지션당 매도 한 건).
  1. 손절: `stopPrice()`(본전 손절 포함)가 있고 현재가 ≤ 그 값 → 전량.
  2. 추적 손절: `trailPrice()`가 있고 현재가 ≤ 그 값 → 전량.
  3. 익절: `takeLevels()` 중 현재가 ≥ 가격인 단계를 모두 모아 그 수량의 합(마지막 단계가 들면 전량, 원장 qty 이하)을 한 주문으로, 단계 번호는 가장 높은 단계로 낸다(시뮬레이션이 같은 날 여러 단계를 차례로 파는 것과 같은 수량). 수량 0이면 건너뜀.
  4. 기간 청산: `timeExit.on`이고 `boughtAt`부터 오늘까지 네이버 일봉 수 ≥ `days` → 전량.
  5. 매도 신호: 맞으면 전량.
- 기준 가격은 원장 `buyPrice`(보낸 매수 지정가)다. 실제 평단은 토스 확인 때 알림에 함께 적는다.

### 보내기

- 15:20 이후 새 매도 없음.
- `pendingSell`이 있거나 `sellBlocked`가 오늘인 포지션은 새 매도를 내지 않는다(같은 포지션에 두 번 보내지 않는다).
- 실전: 보내기 직전 토스 보유를 조회한다. 팔 수량 = `min(판정 수량, 원장 qty, 토스 보유 수량)`.
  - 토스 보유가 0이면 매도하지 않는다. 오늘 산 포지션이면 매수가 아직 체결 중일 수 있어 그대로 두고, 전날 이전에 산 포지션이면(당일 매수 주문은 만료됨) 원장에서 지우고 「보유가 없어 팔지 않았어요」 알림.
- 실전에서 토스 보유를 조회했을 때 전날 이전에 산 포지션은 `qty = min(qty, 토스 수량)`으로 맞추고, 줄었으면 `boughtQty = qty + 확정 매도 합계`로 함께 맞춘다(매수 부분 체결 확정. 익절 단계 수량이 실제로 산 수량 기준이 된다. 0이면 지운다). 익절 주문이 일부만 체결되고 만료되면 그 단계는 끝난 것으로 본다(덜 파는 쪽, 시뮬레이션과 다를 수 있다). 매수 후보가 있을 때는 이미 토스에 그 종목이 있으면 사지 않으므로, 원래 가진 종목과 섞이는 경우는 사람이 같은 종목을 뒤에 손으로 산 때뿐이다(그때는 사람이 확인).
- 지정가 = `tickDown(현재가 × (1 − 매도 여유/100))`. 한국거래소는 더 낮은 매도 지정가를 매수 호가에 바로 체결하므로 미끄러짐 상한 역할을 한다.
- 연습: 바로 체결된 것으로 본다(`sells`에 넣고 `qty`를 줄이고, 0이면 지운다).

### 실전 매도 뒤 확인(다음 실행부터)

`pendingSell`이 있으면 토스 보유를 조회해 `held = min(원장 qty, 토스 수량)`:
- 줄어든 만큼(`qty − held`, 양수일 때)을 그때마다 `sells`에 `{ qty, stage }`로 넣고 `qty = held`로 맞춘다(부분 체결도 바로 기록해 만료돼도 판 수량과 단계가 남는다).
- `qtyBefore − held ≥ pending.qty`이면 다 팔렸다 → `pendingSell` 삭제, `qty`가 0이면 포지션 삭제. 일부만이면 `pendingSell`은 둔다.
- `pending.date`가 오늘이 아니면(당일 주문이 만료) `pendingSell`을 지우고 다시 판정한다.
- 보낸 지 10분이 지났는데 다 팔리지 않았고 `warned`가 아니면 「안 팔렸어요. 토스 앱에서 확인해 주세요」 알림을 한 번 보내고 `warned: true`.

토스 보유 조회는 매수 후보가 있거나, 매도 판정이 맞았거나, `pendingSell`이 있을 때만 하고 한 실행에 한 번만 한다.

## 7. 주문 보내기(실전)와 오류

- `cli/src/commands/order.ts`에서 프록시 설정 읽기, `/order/status`, `/order/toss` 보내기를 함수로 꺼내 `gazua order`와 `gazua auto`가 같이 쓴다(`proxyCall`·`PROXY_ERRORS`·`orderHeaders` 그대로). `gazua order`의 동작·출력은 바꾸지 않는다.
- 실행마다 주문이 필요할 때 `/order/status`를 한 번 본다. 꺼져 있거나 중지 파일이 있으면 이번 실행은 주문하지 않고, 하루 한 번 알림.
- 결과 처리:
  - 성공(토스 접수, 체결은 아님): 매수는 `unconfirmed`를 지우고 `orderId`를 적는다. 매도는 `pendingSell` 유지(체결 확인은 다음 실행).
  - `order-rate-limited`·`order-busy`: 보내지 않은 것이 확실하다. 매수는 `today.bought`와 포지션을 되돌려 다음 실행에서 다시 판정하게 한다. 매도는 `pendingSell`과 `today.sold`를 되돌린다.
  - 그 밖의 보내기 전 거절(`order-over-limit`·`order-daily-limit`·`order-total-limit`·`order-stopped`·`order-disabled`·`order-invalid`)과 토스 거절(`order-upstream`): 보내지 않았다. 매수는 포지션을 지우되 `today.bought`는 남겨 그날 다시 시도하지 않는다. 매도는 `pendingSell`을 지우고 `sellBlocked = 오늘`로 둬 그날은 자동 매도를 더 보내지 않으며 「자동 매도가 막혔어요(<코드>). 토스 앱에서 직접 확인해 주세요」 알림(같은 날 같은 종목·코드는 한 번). 1회 한도·하루 한도에 걸린 청산을 쪼개 보내는 일은 하지 않는다(사람에게 넘긴다).
  - `order-unknown`과 그 밖의 오류: 들어갔을 수 있다. 매수는 포지션을 `unconfirmed`로 남기고, 매도는 `pendingSell`을 남긴다. 「토스 앱에서 확인해 주세요」 알림. 다시 보내지 않는다.
- 실행 전체가 실패하면(설정 오류, 로그인 만료, 원장 손상 등) 같은 날 같은 오류 코드는 한 번만 알리고 오류로 끝난다. 원장을 못 읽는 경우는 알림 기록도 못 쓰므로 매번 알림이 갈 수 있다(드문 경우라 그대로 둔다).

## 8. 알림

- 주문(또는 연습 주문)마다 한 건. 제목: `[연습] 매수 005930 삼성전자` / `매도 …`. 본문: 수량, 지정가, 현재가, 이유(전략 조건 문구나 「손절」 등), 실전이면 결과(접수·거절·결과 불명). 끝 줄 「투자 조언 아님」.
- 종목명은 알림을 보낼 종목만 `NAVER.stockBasic`으로 찾는다. 못 찾으면 코드.
- 권유 문구(「사세요」 등)는 쓰지 않는다. 사실(무엇을 얼마에 보냈는지)만 쓴다.

## 9. 프록시 횟수 제한 조정(`proxy/node/order.ts`)

- `ORDER_MAX_PER_MINUTE`은 **매수에만** 적용한다. 매도는 분당 제한에서 빠져 동시 급락 때 밀리지 않는다.
- `ORDER_MAX_PER_DAY`는 매수·매도 합쳐 그대로.
- **총 가용 금액 복원 고침**: 지금은 매도를 보낼 때 `invested`를 줄여, 토스가 거절한 매도로도 매수 한도가 다시 생긴다(검토에서 재현). 매도는 토스가 200으로 접수했을 때만 `invested`를 줄인다. 재시작 복원도 매도 `send`는 같은 `clientOrderId`의 `result`가 `status: 200`일 때만 줄인다(결과 줄이 없으면 줄이지 않는다, 보수적). 접수 뒤 체결되지 않고 만료된 매도까지 따지지는 않는다(사람이 확인).
- 재시작 복원도 같다: 감사 로그 `send` 중 최근 60초의 **매수**만 분당 기록에 넣는다.
- `/order/status`의 응답 형식은 그대로(`maxPerMinute`의 뜻만 「분당 매수」로 문서에 적는다).
- 시험: 매수 3건 뒤 4번째 매수는 `order-rate-limited`, 같은 분의 매도는 통과. 재시작 복원도 매수만 센다. 토스가 거절한 매도 뒤 총 가용 금액이 그대로이고, 재시작 뒤에도 같다.

## 10. 예약 작업 `scripts/macos/auto-agent/`

collect-agent를 본보기로 `install.sh`·`run.sh`·`plist.template`·`uninstall.sh`·`README.md`.
- 라벨 `com.gazua.auto`. `StartInterval = AUTO_INTERVAL_MIN × 60`(설치 때 읽음, 1~5만 허용).
- `run.sh`: KST(`TZ=Asia/Seoul`) 월~금 09:05~15:20 밖이면 바로 끝난다(node를 띄우지 않는다). 안이면 `lockf -t 0`으로 잠그고 `node --env-file=alert.env --env-file=auto.env cli/dist/gazua.mjs auto`를 실행. 잠금을 못 잡으면 「다른 실행이 돌고 있어요」로 끝난다.
- 휴장일은 CLI가 네이버 장 상태로 건너뛴다.
- 로그 `~/Library/Logs/gazua/auto.log`.
- `install.sh`는 `auto.env`가 없으면 `AUTO_MODE=dry`와 빈 `AUTO_STRATEGY=`로 만들고(권한 600) 채우라고 안내한다. `AUTO_STRATEGY`가 비어 있으면 설치하지 않는다. `GAZUA_AUTO_DRY=1`이면 임시 경로에 plist만 만든다(시험용).
- **이 작업에서 설치하지 않는다.** 설치 명령은 사람이 실행한다.

## 11. 출력

```json
{ "mode": "dry", "strategy": "…", "skipped": "hours|closed|null",
  "buys": [{ "symbol": "005930", "quantity": 3, "price": 213000, "reason": "…", "result": "dry|sent|rejected|unknown", "code": "…" }],
  "sells": [{ "symbol": "…", "quantity": 3, "price": 207000, "reason": "손절", "result": "…" }],
  "skippedSymbols": [{ "symbol": "…", "reason": "…" }],
  "notes": ["…"] }
```

MCP 도구로는 내보내지 않는다.

## 12. 시험(동작을 지키는 만큼만)

- 설정 읽기: 기본값, `AUTO_MODE` 오타 거절, 모르는 `AUTO_` 키 거절, 여유 범위.
- 호가 단위 올림·내림 경계.
- 매수: 시간(15:15), 하루 한 번, 보유 중 건너뜀, 수량 계산, 연습 모드에서 fetch로 프록시를 부르지 않음(가짜 fetch로 확인).
- 매도: 손절·추적 손절·단계 익절(두 단계를 한꺼번에 넘으면 합친 수량, 두 번째 실행에서 같은 단계 재매도 없음)·`pendingSell` 중복 방지·부분 체결 기록·거절 뒤 그날 막힘·토스 보유 0일 때 안 팖(오늘 산 것은 원장 유지)·토스 보유가 원장보다 적을 때 적은 쪽(100주 주문 중 60주 체결이면 첫 50% 익절은 30주)·전날 산 포지션 전량 매도 뒤 같은 날 재매수 없음.
- 전략 교체: 포지션이 있는데 다른 전략이면 멈춤.
- 실전 오류 분류: rate-limited 되돌림, upstream 하루 막음, unknown 유지.
- 원장 손상 시 멈춤, 보내기 전 원장 기록.
- 프록시: §9.
- 예약 스크립트: `GAZUA_AUTO_DRY=1`로 plist가 `plutil -lint`를 통과(기존 `tests/collect-agent.test.mjs` 방식).
- `cli/README.md`에 `gazua auto`가 있어야 한다(`readme.test.ts`가 이미 검사).

## 13. 범위 밖

취소·정정 주문, 앱 화면에서 전략 고르기, KIS, MCP 주문 도구, 원래 보유 종목 매도, 분할 매수(추가 매수), 체결가 기준 평단 보정, 상한가·하한가 검사, ETF 호가 단위 구분.

## 14. 확인할 시점

연습 모드로 두 주 운영한 뒤(2026-11-27) 알림 기록을 보고 실전으로 바꿀지 사용자가 정한다. 실전으로 바꿨다면 2026-12-27에 감사 로그에 자동 실행기 주문이 있는지 확인한다.
