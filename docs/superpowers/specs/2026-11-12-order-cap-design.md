# 실계좌 주문: 1회 최대 금액 (로드맵 최우선 2 단계 C, 작은 버전)

작성 2026-11-12. 전제: 사용자 1명, 본인 토스 계좌만, 여러 기기, 무료 운영.

## 1. 정한 것

사용자 결정(2026-11-12): 실계좌 주문을 만든다. **주문 가능한 최대 금액을 정하고, 그 금액 이상은 자동으로 거래할 수 없게 한다.** 단계 B(모의투자·2차 인증)는 하지 않는다.

최초 설계 §1.3의 「주문 없음」을 이 범위만큼 바꾼다. 이 설계의 `gazua order`가 보내는 주문은 **맥 프록시 한 곳**에서만 나가고, 한도는 그 맥의 `proxy/.env`에서만 정한다. 한도 보장은 이 프록시를 경유하는 주문에 적용한다.

| 항목 | 정한 값 |
|---|---|
| 증권사 | 토스만 (KIS 주문은 범위 밖) |
| 주문 종류 | 국내 주식 **지정가(LIMIT)·당일(DAY)** 매수·매도만. 시장가·금액 주문·소수점·미국 주식·`OPG`/`CLS`는 받지 않음 |
| 1회 금액 | **주문 금액** `수량 × 지정가`(원, 정수). 수수료·세금은 넣지 않음. 매수는 이 값보다 비싸게 체결되지 않는다. 매도는 지정가보다 높게 체결될 수 있어 받는 돈이 이 값을 넘을 수 있다(나가는 돈이 아니라 들어오는 돈이므로 받아들임). 한도는 체결 금액이 아니라 주문 금액에 건다 |
| 1회 한도 | `ORDER_MAX_AMOUNT`(원). **1회 금액 ≥ 한도면 거절** |
| 하루 한도(선택) | `ORDER_DAILY_MAX_AMOUNT`(원). 오늘(KST) 보낸 주문 금액 합 + 이번 금액 > 한도면 거절. 비우면 검사 안 함 |
| 매수·매도 | 둘 다 같은 한도를 적용(「자동으로 거래」에 매도도 들어감) |
| 반복 상한 | 보낸 주문 기준 **1분에 3건, 하루 20건**(`ORDER_MAX_PER_MINUTE`, `ORDER_MAX_PER_DAY`로 낮추거나 올림) |
| 즉시 중지 | 중지 파일이 있으면 모든 주문 거절(`ORDER_STOP_FILE`, 기본 `~/gazua-order.stop`). 재시작 없이 `touch`/`rm`로 바뀜 |
| 켜기 | `ORDER_ENABLED=true` **그리고** 올바른 `ORDER_MAX_AMOUNT`가 있어야 켜짐. 하나라도 없거나 틀리면 꺼짐 |
| 감사 로그 | `ORDER_AUDIT_LOG`, 기본 `~/Library/Logs/gazua-orders.jsonl`, 권한 600, 한 줄 JSON |
| 열린 토스 쓰기 경로 | `POST /api/v1/orders`(주문 생성) 하나. 정정·취소·조건주문은 계속 막음 |
| 주문 내는 곳 | CLI `gazua order` 명령(사람이 실행). MCP 도구로 내보내지 않음. 웹 주문 화면 없음 |

「Claude는 실제 주문을 실행하지 않는다」: 개발·검토 세션(Claude·Codex)은 주문 경로를 실제 토스로 부르지 않고 가짜 fetch로만 시험한다. 첫 소액 주문은 사용자가 직접 한다.

### 왜 이렇게 작게

- 이 프록시를 경유하는 주문은 클라이언트가 보낸 숫자로 프록시가 금액을 계산하고 한도를 비교하므로, 주문 요청으로 한도를 바꾸거나 검사를 우회할 수 없다. 다만 CLI는 토스 자격증명을 보유하고 토큰·계좌 조회를 직접 한다(§4). 토스 허용 IP에서 자격증명을 가진 별도 프로그램이 토스에 직접 보내는 주문은 프록시가 통제하지 못한다. 사용자 1명이 자격증명과 실행 프로그램을 관리하는 신뢰 경계다.
- 지정가만 받으면 주문 금액(수량×지정가)이 주문 전에 확정된다. 시장가는 수량×가격을 미리 알 수 없어 「그 금액 이상 금지」를 걸 수 없으므로 받지 않는다. 매도 지정가가 더 높게 체결되는 경우는 위 표대로 한도 위반으로 보지 않는다.
- 정정은 금액을 올릴 수 있어 막는다. 취소는 돈이 나가지 않지만 첫 버전에서 필요가 확인되지 않아 막아 두고 토스 앱에서 한다.
- 이미 있는 것으로는 안 되는 이유: 지금은 프록시·CLI 모두 주문 경로가 허용 목록에 없어 기존 프록시·CLI로 주문을 보낼 방법이 없다.

## 2. 토스 문서에서 확인한 것 (2026-11-12, `openapi-docs/latest/openapi.json`, `overview.md`, `faq.md`)

- `POST /api/v1/orders`, 헤더 `Authorization: Bearer {token}`, `X-Tossinvest-Account: {accountSeq}`. Rate group `ORDER` 초당 10회.
- 본문(수량 기반): `symbol`(KRX 6자리), `side`(`BUY`/`SELL`), `orderType`(`LIMIT`/`MARKET`), `timeInForce`(`DAY` 기본), `quantity`(문자열 10진수, 국내는 양의 정수), `price`(문자열, 국내는 원 단위 정수·호가 단위), `clientOrderId`(선택, 최대 36자 `[a-zA-Z0-9-_]`, 10분간 멱등성 키), `confirmHighValueOrder`(1억 원 이상이면 `true` 필요, 아니면 `400 confirm-high-value-required`).
- 금액 기반(`orderAmount`)은 미국 시장가 전용. 이 설계는 쓰지 않음.
- 응답 `200 {"result":{"orderId","clientOrderId"}}`. 오류 `{"error":{"requestId","code","message","data"}}`. 예: `insufficient-buying-power`(422), `order-hours-closed`(422), `price-out-of-range`(422), `invalid-request`(400, 호가 단위 불일치 등).
- 토큰 scope는 비어 있음(Client Credentials). 주문 권한을 따로 켜는 단계는 문서에 없음.
- FAQ: 짧은 시간 대량 반복 주문(예: 수십 분 안에 소액 수백 건)은 어뷰징으로 보고 매매를 제한.
- 수수료 조회 `GET /api/v1/commissions`가 있으나 쓰지 않음(1회 금액에 수수료를 넣지 않으므로).

확인 필요:
- 토스 앱에서 동의하는 Open API 이용약관 원문(로드맵과 같음).
- 실제 주문이 문서대로 받아지는지, 호가 단위 오류 응답 모양 — 사용자의 첫 소액 주문으로 확인.
- 어뷰징 판정의 정확한 기준(FAQ는 예시만 줌). 1분 3건·하루 20건은 그보다 훨씬 낮게 잡은 값.

## 3. 프록시

### 3.1 경로

`handle` 순서는 그대로 두고, 토큰 검사 뒤 `/market/*` 옆에 `/order/*` 분기를 둔다.

- 서버 `PROXY_TOKEN`이 비어 있거나 처리기가 주입되지 않았으면(Worker 판) `404 order-unavailable`. 상류 호출 없음.
- `GET /order/status` → `200 {"enabled","stopped","maxAmount","dailyMaxAmount","maxPerMinute","maxPerDay","usedToday":{"count","amount"}}`. 비밀값 없음.
- `POST /order/toss` → 주문 한 건.
- 그 밖의 `/order/*` → `404 order-not-found`, 메서드가 틀리면 `405 method-not-allowed`.
- 허용 목록(`allowlist.ts`)은 바꾸지 않는다. `/toss/api/v1/orders` POST는 여전히 `403 proxy-path-blocked`.

처리기는 `HandleOptions.order`로 Node 판(`proxy/node/server.ts`)만 주입한다(`market`과 같은 방식). 구현은 `proxy/node/order.ts`.

### 3.2 요청

```
POST /order/toss
x-proxy-token, origin (기존 검사)
authorization: Bearer <토스 토큰>          ← 그대로 전달
x-tossinvest-account: <accountSeq>        ← 그대로 전달
content-type: application/json
{"symbol":"005930","side":"BUY","quantity":10,"price":70000}
```

- `symbol`: `^[0-9A-Z]{6}$`. `side`: `BUY`|`SELL`. `quantity`, `price`: JSON 파싱 뒤 **양의 안전한 정수**(`Number.isSafeInteger`, 1 이상). 문자열·`1.5` 같은 소수·음수·0은 `400 order-invalid`. `1e3`·`1.0`처럼 파싱하면 정수가 되는 표기는 그 정수로 받는다(프록시가 검증한 값으로 본문을 새로 만들므로 우회가 아니다).
- 그 밖의 필드가 있으면 `400 order-invalid`(시장가·금액 주문 같은 필드를 몰래 실어 보내지 못하게).
- `authorization`·`x-tossinvest-account`가 없으면 `400 order-invalid`.
- 1회 금액 `quantity * price`가 `Number.MAX_SAFE_INTEGER`를 넘으면 `400 order-invalid`(한도 비교 전에 걸러짐).

프록시는 받은 본문을 넘기지 않고 **새로 만든다**:
`{"clientOrderId":<프록시가 만든 UUID>,"symbol","side","orderType":"LIMIT","timeInForce":"DAY","quantity":String(q),"price":String(p)}`. `confirmHighValueOrder`는 넣지 않는다(1억 원 이상은 토스도 거절).

### 3.3 검사 순서 (한 번에 한 건씩, 직렬)

주문은 한 번에 한 건만 처리한다. 처리 중에 다른 주문이 오면 줄을 세우지 않고 바로 `409 order-busy`로 거절한다(사용자 1명이 손으로 치는 명령이라 겹칠 일이 드물고, 대기 중인 주문이 클라이언트가 끊긴 뒤 늦게 나가는 일을 막는다). 동시 요청이 카운터를 같이 읽어 한도를 넘는 일도 이것으로 막는다. `order-busy` 거절은 상류 호출 0.

1. 켜짐 여부 → `403 order-disabled`
2. 중지 파일 → `403 order-stopped`
3. 본문 검사 → `400 order-invalid`
4. 1회 금액 ≥ `ORDER_MAX_AMOUNT` → `403 order-over-limit` (`data: {amount, maxAmount}`)
5. 하루 금액 합 초과 → `403 order-daily-limit` (`data: {amount, usedToday, dailyMaxAmount}`). 하루 한도가 비어 있어도 `usedToday + amount`가 `Number.MAX_SAFE_INTEGER`를 넘으면 더하기 전에 같은 코드로 거절한다.
6. 반복 상한(최근 60초 보낸 건수 ≥ 분당 상한, 오늘 보낸 건수 ≥ 하루 상한) → `429 order-rate-limited`
7. 감사 로그에 `send` 줄을 먼저 쓴다(쓰기 호출이 끝난 뒤 보낸다. 전원 장애까지 보장하는 `fsync`는 하지 않는다). 쓰지 못하면 `503 order-audit-failed`로 보내지 않는다.
8. 카운터에 반영(보낸 건수·금액)한 뒤 토스로 보낸다. 시간 제한은 기존 `upstreamTimeoutMs`. 목적지는 `UPSTREAM.toss`(HTTPS) + `/api/v1/orders` 고정이고 요청으로 바꿀 수 없다. 기존 처리기처럼 `redirect: 'manual'`로 보내고 3xx는 `order-upstream` 실패로 처리해 `Location`으로 다시 보내지 않는다(보낸 카운터는 유지).
9. 결과 줄을 감사 로그에 쓴다(실패해도 응답은 돌려줌).

- 카운터는 **토스로 보낸 주문**(7단계를 지난 것)만 센다. 토스가 거절하거나 시간이 지나도 보낸 것으로 센다(결과를 모르면 보수적으로).
- 하루 기준은 KST 날짜.
- 프록시 시작 때 감사 로그의 `send` 줄에서 오늘(KST)의 건수·금액과 `ts`가 최근 60초에 속하는 주문의 시각 목록을 되살린다(재시작으로 하루·분당 한도가 풀리지 않게). 최근 60초 복원은 KST 날짜로 거르지 않아 전날 자정 직전의 주문도 포함한다. 복원한 시각은 이후 검사에서도 최근 60초에 속하는 동안만 센다. KST 날짜가 바뀌면 오늘 건수·금액만 초기화하고 최근 60초 시각 목록은 유지한다. 로그를 읽지 못하거나 되살린 합계가 안전한 정수 범위를 넘으면 주문을 끈다(`order-disabled`, 시작 로그에 이유).
- 시작 순서: ① 로그 파일을 열거나 없으면 빈 파일로 만든다(권한 600) ② 복원 ③ 주문 받기. ①·②가 끝나기 전에 온 주문은 `order-disabled`. 파일이 없던 최초 기동은 카운터 0에서 시작한다. 파일을 만들지 못하면 읽기 실패와 같다.
- 깨진 줄(JSON 객체가 아님, `send` 줄의 수량·가격·금액이 양의 안전한 정수가 아니거나 `amount ≠ quantity × price`, `ts`를 읽지 못함)이 하나라도 있으면 건너뛰지 않고 주문을 끈다. 시작 로그에 줄 번호를 남기고, 사람이 그 줄을 확인·정리한 뒤 재시작한다(「다르면 사람이 다시 확인」).

### 3.4 응답

- 토스 200 → `200 {"ok":true,"orderId","clientOrderId","amount"}`.
- 토스 오류 → 토스 상태 그대로, `{"error":{"code":"order-upstream","status",`토스 `code`·`message`}}`.
- 네트워크 오류 `502 upstream-unreachable`, 시간 초과 `504 upstream-timeout`(주문이 들어갔을 수 있다는 뜻 — CLI가 「토스 앱에서 확인」으로 안내). 둘 다 `data: {clientOrderId}`를 붙인다.
- 프록시는 토스로 보낸 주문을 자동으로 다시 보내지 않는다. 다시 보내는 요청은 새 `clientOrderId`를 받는 새 주문이므로 토스의 멱등성 키가 적용되지 않는다.

### 3.5 감사 로그

한 줄 JSON. 파일은 `open(..., 'a', 0o600)`로 만들고, 있던 파일 권한이 600이 아니면 `chmod 600`.

```json
{"ts":"2026-11-12T09:05:01.123+09:00","day":"2026-11-12","event":"reject","code":"order-over-limit","symbol":"005930","side":"BUY","quantity":10,"price":70000,"amount":700000}
{"ts":"…","day":"…","event":"send","clientOrderId":"…","symbol":"…","side":"…","quantity":…,"price":…,"amount":…}
{"ts":"…","day":"…","event":"result","clientOrderId":"…","status":200,"orderId":"…"}
{"ts":"…","day":"…","event":"result","clientOrderId":"…","status":422,"tossCode":"insufficient-buying-power"}
```

- 토큰·`authorization`·`accountSeq`·프록시 토큰·요청 원문은 쓰지 않는다. 본문이 깨져 값을 못 읽은 거절은 `code`만 쓴다.
- 기존 서버 로그(`method path status ms`)는 그대로.

### 3.6 설정 (`proxy/.env`, 이 맥에서만)

```
ORDER_ENABLED=true
ORDER_MAX_AMOUNT=300000
# 선택
ORDER_DAILY_MAX_AMOUNT=1000000
ORDER_MAX_PER_MINUTE=3
ORDER_MAX_PER_DAY=20
ORDER_STOP_FILE=~/gazua-order.stop
ORDER_AUDIT_LOG=~/Library/Logs/gazua-orders.jsonl
```

- 금액·건수는 양의 정수 문자열만(쉼표·소수 불가)이고, 숫자로 바꾼 값이 `Number.isSafeInteger`여야 한다. 틀리면 주문 꺼짐. 선택 값이 틀리면 그 값만 기본값이 아니라 **주문 전체를 끈다**(오타로 한도가 사라지지 않게).
- `~`는 홈으로 바꾼다.
- 바꾼 뒤 `proxy/macos/install.sh`로 재시작(중지 파일만 재시작 없이 바뀜).

## 4. CLI `gazua order`

```
gazua order buy 005930 10 70000          # 요약만 보여 주고 보내지 않음
gazua order buy 005930 10 70000 --yes    # 보냄
```

- 인자: `buy|sell`, 6자리 종목, 수량(양의 정수), 지정가(양의 정수, 원). 쉼표 없음.
- 첫 버전 CLI는 토스에 공인 IP가 허용 등록된 기기에서 실행한다(`cli/README.md`의 「증권사 키」). 기존 공급자(`cli/src/providers.ts`의 `buildProvider`)는 `cli/src/direct.ts`의 `createDirectClient`로 토큰·계좌 조회를 토스에 직접 보내므로 이 조회는 주문 프록시를 경유하지 않는다. 다른 기기에서도 주문하려면 그 기기의 공인 IP 허용 등록과 맥 프록시 접속 설정이 모두 필요하다. 프록시에 접속할 수 있다는 것만으로는 토큰·계좌 조회가 가능해지지 않는다.
- 필요한 환경변수: `TOSS_CLIENT_ID`·`TOSS_CLIENT_SECRET`(토큰·계좌 번호를 받는 데 씀, 기존과 같음), `GAZUA_PROXY_URL`, `GAZUA_PROXY_TOKEN`, `GAZUA_PROXY_ORIGIN`(프록시 `ALLOWED_ORIGINS` 중 하나). `GAZUA_PROXY_TOKEN`은 출력 거르기 목록(`SECRET_ENV`)에 넣는다. 없으면 `order-not-configured`.
- `GAZUA_PROXY_URL`은 `cli/src/session.ts`의 `normalizeServer()`로 검증한다(HTTPS, 로컬 `localhost`·`127.0.0.1`·`[::1]`만 HTTP). 틀리면 `invalid-args`이고 어떤 호출도 하지 않는다.
- CLI→프록시 요청(`GET /order/status`, `POST /order/toss`)은 `redirect: 'manual'`이고, 3xx·`opaqueredirect`는 실패로 처리해 다른 주소로 토큰·계좌 번호·주문 본문을 보내지 않는다. 주문 POST가 3xx를 받으면 결과 불명(`order-unknown`)으로 본다.
- `--yes`가 없으면 프록시 `GET /order/status`로 한도를 받아 요약만 낸다: `{"sent":false,"order":{side,symbol,quantity,price,amount},"limits":{…},"hint":"보내려면 --yes를 붙여요"}`. 1회 금액이 한도 이상이면 요약에 「한도 이상이라 프록시가 거절해요」를 더한다(최종 판정은 프록시).
- `--yes`면 토스 토큰과 계좌 번호(종합매매 accountSeq)를 기존 토스 공급자로 받아 `POST /order/toss`. 성공 시 `{"sent":true,"orderId","amount"}`. 토큰·계좌 번호·프록시 토큰은 출력에서 가린다.
- 거절은 `CliError`로, 쉬운 말로:
  - `order-disabled`: 「맥 프록시에서 주문이 꺼져 있어요(proxy/.env의 ORDER_ENABLED·ORDER_MAX_AMOUNT)」
  - `order-stopped`: 「주문 중지 파일이 있어 멈췄어요」
  - `order-over-limit`: 「1회 최대 금액(N원) 이상이라 보낼 수 없어요(이번 M원)」
  - `order-busy`(「다른 주문을 처리하는 중이에요. 잠시 뒤 다시 해 주세요」), `order-daily-limit`, `order-rate-limited`, `order-invalid`, `order-unavailable`(Worker 판이거나 프록시 토큰 없음), `order-upstream`(토스 메시지 덧붙임).
  - `order-unknown`(결과 불명): 「주문이 들어갔을 수 있어요. 토스 앱에서 확인하기 전에는 다시 보내지 마세요」. `POST /order/toss`를 보낸 뒤 결과를 확인하지 못한 경우 모두 여기에 넣는다. 프록시의 `502 upstream-unreachable`·`504 upstream-timeout`, 프록시와의 연결 끊김·시간 초과, 응답 본문을 해석하지 못함이 해당한다. 기존 `fromApiError`의 일반 `network`로 바꾸지 않는다. 프록시가 `clientOrderId`를 주었으면 함께 출력하고, 받지 못했으면 맥 감사 로그의 `send` 줄(시각·종목)에서 찾으라고 안내한다.
- CLI는 주문 POST를 자동으로 다시 보내지 않는다(`--yes` 한 번에 POST 최대 1건). 같은 키로 안전하게 다시 보내는 기능은 첫 버전에 넣지 않는다(§8).
- 신호의 주문안(`signals --propose`)은 그대로 출력만 한다. 사람이 주문안을 보고 이 명령을 직접 친다.
- MCP: `order`는 도구 목록에 넣지 않는다. 시험으로 고정한다.
- 토스 공급자(`src/lib/providers/toss.ts`)에 주문용 헤더를 꺼내는 작은 함수(토큰 + 종합매매 accountSeq)를 더한다. 주문용 함수는 계좌 목록에서 `accountType === 'BROKERAGE'`인 계좌만 고르고, 해당 계좌가 없으면 실패하여 `POST /order/toss`를 보내지 않는다. 기존 `brokerageSeq()`의 「종합매매가 없으면 첫 계좌」 대체 동작을 주문용으로 재사용하지 않는다. 읽기 기능의 기존 대체 동작은 유지한다. 앱은 주문용 함수를 쓰지 않는다.

## 5. 웹 앱

첫 버전에서는 바꾸지 않는다(주문 버튼·상태 표시 없음). 상태는 `gazua order …`의 요약과 프록시 `GET /order/status`로 본다.

## 6. 시험 (모두 가짜 fetch, 임시 디렉터리)

프록시(`proxy/node/order.test.ts`, `proxy/src/handler.test.ts`):
- 꺼짐(설정 없음, `ORDER_ENABLED` 없음, 한도 틀림, 선택 값 틀림, 안전한 정수 범위를 넘는 값) → `order-disabled`, 상류 호출 0.
- 토큰 없음·틀림 → 401, 서버 `PROXY_TOKEN` 없음 → 404 `order-unavailable`, Worker 판(처리기 없음) → 404.
- 한도: 금액 = 한도 → 거절, 한도 − 1 → 통과, 정수가 아닌 값·문자열·지수·음수·추가 필드·큰 수 → `order-invalid`.
- 상류로 간 본문이 `LIMIT`·`DAY`·문자열 수량·가격·`clientOrderId`이고 `confirmHighValueOrder`·추가 필드가 없음.
- 하루 금액 한도, 분당·하루 건수. 처리 중에 온 두 번째 요청은 `409 order-busy`·상류 호출 0.
- 매도 지정가 주문도 같은 주문 금액 기준(금액 = 한도 → 거절).
- 감사 로그 최초 기동(파일 없음 → 600 파일 생성, 카운터 0), 깨진 줄·금액 불일치 줄 → `order-disabled`, 로그 경로를 만들 수 없음 → `order-disabled`.
- 상류 307·308 → `order-upstream`, 상류 호출 1건, 카운터 유지.
- 중지 파일 생기면 거절, 지우면 통과.
- 감사 로그: 권한 600, 줄 모양, 토큰·authorization·계좌 번호 없음, 로그 쓰기 실패 시 503·상류 호출 0, 재시작 시 오늘 카운터 복원.
- 재시작: 최근 60초 안에 분당 상한만큼 보낸 뒤 재시작해도 추가 주문은 `429 order-rate-limited`·상류 호출 0. 복원한 주문이 60초 창에서 모두 빠지면 분당 제한이 풀림(다른 한도는 미도달).
- KST 자정 경계: 자정 직전 분당 상한만큼 보낸 뒤 자정 직후 재시작하면 오늘 건수·금액은 0이지만 전날 `send`의 `ts`가 최근 60초에 속해 추가 주문은 거절. 재시작 없이 자정을 넘어도 같은 분당 제한을 유지.
- `/toss/api/v1/orders` POST는 여전히 403.

CLI(`cli/src/commands/order.test.ts`):
- `--yes` 없으면 주문 POST 없음(가짜 fetch 호출 목록으로 확인).
- 인자 검사, 설정 없음, 원격 HTTP `GAZUA_PROXY_URL` → `invalid-args`·fetch 0.
- 상태 GET·주문 POST가 `redirect: 'manual'`이고 3xx를 따라가지 않음.
- 거절 코드별 문구. 프록시 502·504, 연결 끊김, 해석할 수 없는 응답은 모두 `order-unknown` 문구이고 주문 POST는 1건뿐(자동 재시도 없음).
- MCP 도구 목록에 `order` 없음.

토스 공급자(`src/lib/providers/toss.account.test.ts`)와 CLI 시험에 추가:
- 종합매매·비종합매매 계좌가 섞여 있으면 주문용 함수는 종합매매 accountSeq를 고른다.
- 비종합매매 계좌만 있거나 계좌 목록이 비어 있으면 주문용 함수는 실패하고, CLI의 `POST /order/toss` 호출은 0건이다.
- 읽기 기능은 종합매매 계좌가 없으면 첫 계좌를 고르는 기존 시험을 유지한다.

## 7. 문서

- `proxy/README.md`: 주문 경로, 켜는 법, 한도, 중지, 감사 로그, 「Claude는 실제 주문을 실행하지 않는다」.
- `cli/README.md`: `gazua order`.
- `docs/roadmap.md` 단계 C: 정한 것과 남은 것.
- `proxy/README.md`에 멈추는 순서: 중지 파일 만들기 → 토스 앱에서 미체결 주문 확인·필요하면 취소 → (필요하면) `ORDER_ENABLED` 끄고 `install.sh` 재시작. 감사 로그는 지우지 않는다.
- `cli/src/main.ts` 머리 주석의 「쓰기·주문 명령은 없다」 고침. MCP 서버 안내문(「주문·쓰기는 없어요」)은 MCP에 주문이 없으므로 그대로.

## 8. 남은 것 (이번에 안 함)

- 취소 경로, 결과 불명 주문을 같은 `clientOrderId`로 다시 보내기, 웹 상태 표시, 주문안 파일을 받아 여러 건 보내기, 허용 종목 목록, KIS 주문, 2차 인증.
- 실제 쓰는지 확인: 2026-12-12에 감사 로그에 `send`가 있는지 본다.
