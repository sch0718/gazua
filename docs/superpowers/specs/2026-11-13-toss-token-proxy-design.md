# 토스 토큰을 맥 프록시가 맡기 설계 (2026-11-13)

## 1. 왜

- 전제: 사용자 1명, 여러 기기(휴대폰·맥 브라우저, 맥 CLI 예약 작업), 무료 운영. 맥 Node 프록시(포트 8787, launchd `dev.gazua.proxy`, 설정 `proxy/.env`) 한 대가 상시 돈다.
- 토스 OpenAPI는 키(client) 하나에 유효 토큰이 하나뿐이다. 새로 받으면 이전 토큰이 바로 무효다.
- 지금은 웹 탭·기기, CLI, 수집 스크립트가 각자 `/oauth2/token`을 불러 서로의 토큰을 무효화한다. 웹은 60초 재발급 간격에 막히면 `token-contended`(「다른 기기나 탭에서 같은 토스 키로 토큰을 받고 있어요」)를 띄운다.
- 이미 있는 것으로는 안 되는 이유: 모든 토스 호출이 이미 맥 프록시를 지나가지만(웹), 프록시는 인증 헤더를 그대로 넘길 뿐이라 발급 주체가 여럿이다. 발급 주체를 프록시 하나로 모으는 장치는 없다.

## 2. 무엇을 (범위)

1. 프록시: `proxy/.env`에 `TOSS_CLIENT_ID`·`TOSS_CLIENT_SECRET`가 있으면 토스 토큰을 혼자 발급·캐시하고, 토스로 가는 요청에 자기 토큰을 붙인다. 없으면 지금 동작 그대로.
2. 웹: 프록시가 맡으면 토큰을 받지 않고 인증 없이 프록시로 보낸다. 그 기기에 토스 키가 없어도 된다. 진단 카드에 방식을 한 줄 보인다.
3. CLI(`quote`·`holdings`·`signals`·`simulate`·`order`·`auto`)와 수집 스크립트(`scripts/collect-market-data.mjs --provider toss`): CLI는 `GAZUA_PROXY_URL`·`GAZUA_PROXY_TOKEN`·`GAZUA_PROXY_ORIGIN`이 있으면 프록시로 보내고(맡음이면 토큰 없이, 아니면 지금처럼 키로 받은 토큰과 함께), 수집 스크립트는 프록시가 맡을 때만 프록시로 보낸다. 프록시 설정이 없으면 둘 다 지금 그대로.
4. 문서: `proxy/README.md`, `cli/README.md`, `docs/roadmap.md`.

범위 밖: KIS, 수집 DB 원격 조회, 새 계정·로그인, 토큰 암호화 저장, 프록시 다중 인스턴스, Cloudflare Worker 판(맡지 않음, 지금 그대로), 수동 점검 스크립트(`scripts/toss-live-check.mjs`·`toss-depth-check.mjs`는 원 API를 직접 확인하는 도구라 그대로 둔다).

## 3. 고른 방식

- A(고름): 프록시가 토큰을 맡고, 클라이언트는 `/health`의 `tossToken` 한 칸으로 맡음 여부를 안다. 클라이언트는 맡음이면 인증 헤더 없이 보낸다.
- B: 프록시가 토큰을 발급해 클라이언트에 나눠 준다(`/toss-token`). 토큰이 여러 곳에 퍼지고 만료·무효화 동기화가 다시 필요해 버림.
- C: 맡음 여부를 클라이언트 설정으로 둔다. 기기마다 켜야 하고 프록시 상태와 어긋날 수 있어 버림.

## 4. 프록시

### 4.1 토큰 관리자 `proxy/node/tossToken.ts`(새 파일)

```ts
export interface TossTokenKeeper {
  /** 쓸 수 있는 토큰. 없거나 만료 60초 전이면 발급한다. 동시에 불러도 발급은 한 번. */
  get(): Promise<string>;
  /** 토스가 401로 거절한 토큰을 버린다. 마지막 발급 뒤 60초가 지나지 않았으면 버리지 않고 false. */
  invalidate(token: string): boolean;
}
export function readTossKeys(env): { clientId: string; clientSecret: string } | undefined;
export function createTossTokenKeeper(keys, deps: { fetchImpl; now; timeoutMs }): TossTokenKeeper;
```

- 발급: `POST https://openapi.tossinvest.com/oauth2/token`(form `grant_type=client_credentials`, `client_id`, `client_secret`), `redirect: 'manual'`, 제한 시간 `upstreamTimeoutMs`. 응답 `access_token`·`expires_in`이 맞지 않으면 실패.
- 메모리에만 둔다. 파일·로그에 키·토큰을 쓰지 않는다. 실패 로그는 `toss-token: issue failed <status>`처럼 상태만.
- 재발급 최소 간격 60초: 맡은 뒤 같은 키를 다른 곳(옛 버전 앱 등)이 쓰면 401이 계속 나는데, 그때마다 다시 받으면 서로 무효화가 이어진다. 60초 안의 401은 다시 받지 않고 그대로 돌려준다.
- 발급 실패는 캐시하지 않는다(다음 요청이 다시 시도). 진행 중 발급은 공유한다.
- 시간: 토큰은 대부분 캐시에서 나오므로 발급이 끼는 요청은 드물다. 그 요청이 클라이언트 제한(웹·CLI 8초, 수집 20초)을 넘으면 그 요청만 시간 초과로 끝나고, 발급은 계속돼 다음 요청은 캐시를 쓴다. 따로 시간 예산을 두지 않는다(드문 경우는 다시 시도로 처리).

### 4.2 `handler.ts`

- `HandleOptions.tossToken?: TossTokenKeeper`(Node만 넣는다. Worker는 없음).
- `/health` 응답에 `tossToken: boolean`(`opts.tossToken`이 있으면 true)을 더한다. 키·토큰 값은 없다.
- `tossToken`이 있고 provider가 `toss`일 때:
  - `/toss/oauth2/token`은 403 `toss-token-managed`로 막는다(발급 경쟁 방지).
  - 클라이언트의 `authorization`을 버리고 `Bearer <프록시 토큰>`을 붙인다. 다른 전달 헤더(`x-tossinvest-account` 등)는 그대로.
  - 토큰을 못 받으면 502 `toss-token-failed`.
  - 상류가 401이면 `invalidate(쓴 토큰)`이 true일 때만 새 토큰으로 한 번 더 보낸다(토스 데이터 경로는 전부 GET이라 다시 보내도 안전하다). false면 401을 그대로 돌려준다.
- KIS와 `tossToken`이 없을 때는 지금 그대로.

### 4.3 주문 `/order/toss`

- `createOrderHandler`에 `tossToken?`를 넘긴다. 있으면 클라이언트 `authorization`이 없어도 받고, 상류 주문에는 프록시 토큰을 붙인다. 없으면 지금처럼 `authorization` 필수.
- 계좌 키 `x-tossinvest-account`는 지금처럼 클라이언트가 보낸다(작은 쪽). 클라이언트는 프록시를 거친 `/toss/api/v1/accounts` 조회로 얻는다.
- 주문은 401이어도 다시 보내지 않는다(중복 주문 위험). 401이면 `invalidate`만 해 다음 요청이 새 토큰을 받게 한다.
- 토큰을 못 받으면 감사 로그 `send` 전에 502 `toss-token-failed`로 끝낸다(보낸 것 없음, 하루 건수도 세지 않음). CLI는 이 코드를 결과 불명이 아닌 미전송으로 다룬다(6.2).

### 4.4 `server.ts`

- `readTossKeys(process.env 또는 opts.orderEnv)`로 키가 있으면 관리자를 만들어 `handle`과 주문 처리기에 넘긴다. 시작 로그 `toss-token: proxy` / `toss-token: off`(값 없음).
- `PROXY_TOKEN`이 없으면 맡지 않는다(토큰 없는 프록시가 아무에게나 계좌를 열지 않게).

## 5. 웹

### 5.1 `src/lib/providers/proxyHealth.ts`(새 파일)

`proxyManagesTossToken(baseUrl, fetchImpl, timeoutMs = 8000): Promise<boolean>` — `${base}/health`를 `redirect: 'manual'`로 읽는다(프록시 토큰은 보내지 않는다. `/health`는 토큰 검사 전에 답한다). 웹·CLI가 같이 쓴다.

- 2xx JSON 객체이고 `ok === true`인 정상 응답에서만 판정한다. `tossToken === true`면 true, `false`이거나 필드가 없으면(옛 프록시) false.
- 비2xx·비JSON·잘못된 응답(`ok !== true`, boolean이 아닌 `tossToken`)과 네트워크 오류는 `ApiError('proxy-unreachable')`, 시간 초과는 `timeout`, 3xx·`opaqueredirect`는 `proxy-redirect`로 던진다. false로 바꾸거나 직접 발급으로 넘어가지 않는다. 실패는 기억하지 않는다(5.2).

### 5.2 토스 제공자 `toss.ts`

- `TossDeps.creds`를 선택으로, `proxyManagesToken?: () => Promise<boolean>`을 더한다.
- 호출마다 인증 헤더를 정하는 `auth()`:
  - 맡음 여부를 한 번 확인해 기억한다(성공한 결과만. 실패는 던지고 기억하지 않는다).
  - 맡음이면 `authorization` 없이 보낸다. 토큰 관리자·`issueToken`을 부르지 않으므로 `token-contended`가 나지 않는다.
  - 아님이면 지금처럼 토큰 관리자. 키가 없으면 `ApiError('invalid-credentials', '토스 키를 넣거나 맥 프록시에 키를 넣어 주세요')`.
  - `proxyManagesToken`이 없으면 지금 그대로(아님).
- `api()`의 재시도: `token-expired` 또는 `proxy-token-managed`면 기억한 맡음 여부를 지우고 한 번 다시 시도한다(프록시가 재시작해 방식이 바뀐 경우). 맡음 모드에서는 토큰 무효화를 하지 않는다.
- `account.orderHeaders()`: 맡음이면 `{ 'x-tossinvest-account' }`만 돌려준다. 타입은 `authorization?: string`.
- `getAccessToken`: 맡음이면 진단이 토큰을 쓰지 않도록 맡음 여부를 따로 알린다(5.4).

### 5.3 `factory.ts`

- 토스: 프록시 주소가 있으면 `proxyManagesToken: () => proxyManagesTossToken(proxyUrl, fetchImpl)`을 넘긴다. 토스 키가 없어도 데모로 바꾸지 않고 토스 제공자를 만든다(맡음이 아니면 첫 호출이 `invalid-credentials`로 안내한다). 프록시 주소가 없으면 지금처럼 데모.

### 5.4 진단·설정 표시

- `runDiagnostics` ②에서 `/health` JSON의 `tossToken === true`이고 공급자가 토스면 ③을 발급 없이 `ok`, hint 「맥 프록시가 토큰을 맡아요」로 끝내고 ④는 인증 없이 보낸다. 이 경우 키가 없어도 실패로 보지 않는다.
- `Diagnostics.svelte` 카드 맨 위(공급자가 토스이고 프록시 주소가 있을 때) 한 줄: 「토스 조회: 맥 프록시가 맡음」 또는 「토스 조회: 이 기기가 직접 받음」. 카드가 열릴 때 `proxyManagesTossToken`을 한 번 부른다. 실패하면 줄을 숨긴다.
- `errors.ts`: `ErrorCode`에 `proxy-token-managed`(제목 「맥 프록시가 토스 토큰을 맡고 있어요. 다시 불러와 주세요」), `PROXY_CODES`에 `toss-token-managed → proxy-token-managed`, `toss-token-failed → upstream`.
- 키 입력 화면·안내 중 「토스 키가 없으면 데모」를 전제로 한 곳이 있으면 맞춘다(구현 때 확인).

## 6. CLI·스크립트

### 6.1 CLI 토스 제공자 `cli/src/providers.ts`

- `proxyOf(ctx)`: `GAZUA_PROXY_URL`·`GAZUA_PROXY_TOKEN`·`GAZUA_PROXY_ORIGIN`이 모두 있으면 `{ server, headers: { origin, 'x-proxy-token' } }`, 아니면 undefined. `order.ts`의 `proxySettings`가 이것을 쓴다(셋이 없으면 지금처럼 `order-not-configured`).
- 토스이고 `proxyOf`가 있으면: 클라이언트는 `createProxyClient({ baseUrl: server, proxyToken, fetchImpl: ctx.fetch })`에 `origin` 헤더를 더해 감싼 것, `proxyManagesToken: () => proxyManagesTossToken(server, ctx.fetch)`. 키는 선택. 파일 토큰 저장소·잠금은 그대로 넘긴다(아님 모드에서만 쓰인다).
- 프록시 설정이 없으면 지금 그대로(직접 호출, 키 필수).
- `cli/src/env.ts`의 `chooseProvider(creds, flag, proxy?)`: 프록시 설정이 있으면 토스 키가 없어도 토스를 고를 수 있다.
- 공급자 생성 전의 진입점도 함께 바꾼다. `cli/src/commands/market.ts`의 `quote`, `cli/src/commands/signals.ts`의 `makeSignals`, `cli/src/commands/simulate.ts`의 `makeSimulate`는 `chooseProvider(creds, ctx.args.provider, proxyOf(ctx))`로 프록시 설정을 전달한다. `--provider kis`의 키 검사는 그대로 둔다.
- `cli/src/commands/market.ts`의 `holdings`는 공급자 생성 전 `!creds.toss`만으로 거절하지 않고, 토스 키와 `proxyOf(ctx)`가 모두 없을 때만 `no-credentials`로 거절한다. 토스 전용 검사는 유지한다. 프록시 설정은 있으나 맡음이 아니고 키도 없으면 5.2의 첫 호출에서 `invalid-credentials`로 실패한다.
- `quote`·`holdings`·`signals`·`simulate`는 위 사전 검사·선택 변경 뒤 `buildProvider`를 사용한다. `order`·`auto`는 `tossAccount`(`buildProvider`+`orderHeaders`)를 사용하므로 공통 공급자 변경과 6.2를 함께 적용한다.

### 6.2 주문 `cli/src/commands/order.ts`

- `tossAccount`: `credentials.authorization`이 있을 때만 가린다. 맡음이면 `x-tossinvest-account`만 보낸다.
- 토큰 발급 실패는 미전송이다. 지금 `proxyCall`은 보낸 뒤의 502·504를 오류 코드를 보기 전에 `order-unknown`으로 바꾸고 `send` 줄을 찾으라고 안내한다. 4.3의 `toss-token-failed`에는 `send` 줄이 없다.
  - `PROXY_ERRORS`에 `toss-token-failed → order-token-failed`(새 `CliErrorCode`, 문구 「맥 프록시가 토스 토큰을 받지 못해 주문을 보내지 않았어요. 잠시 뒤 다시 해 주세요」)를 더한다.
  - `proxyCall`은 502·504를 `order-unknown`으로 바꾸기 전에 `error.code`가 `toss-token-failed`인지 먼저 본다. 다른 502·504와 코드 없는 응답은 지금처럼 `order-unknown`.
  - `cli/src/auto/run.ts`: `order-token-failed`를 `RETRY`(`order-rate-limited`·`order-busy`)에 더한다. 자동 실행기 설계(`2026-11-13-auto-trader-design.md` 7절)의 「보내지 않은 것이 확실하다」 규칙대로 매수는 포지션·`today.bought`, 매도는 `pendingSell`·`today.sold`를 되돌린다.

### 6.3 수집 `scripts/collect-market-data.mjs`·`toss-collect.mjs`

- `--provider toss`이고 `GAZUA_PROXY_URL`·`TOKEN`·`ORIGIN`이 모두 있으면 `/health`를 5.1과 같은 규칙(`redirect: 'manual'`, 프록시 토큰 없음)으로 읽는다. `tossToken === true`면 `createTossClient({ baseUrl: <프록시>/toss, headers: { origin, 'x-proxy-token' }, proxyManaged: true })`로 키 없이 받는다. 정상 비관리 응답일 때만 기존 경로(키 필수, 토스 직접)를 쓰고, 조회 실패는 수집을 오류로 끝낸다(직접 발급으로 넘어가지 않는다). 프록시 설정이 없으면 지금처럼 직접 호출.
- `toss-collect.mjs`: `baseUrl`(기본 `BASE_URL`)·`headers`·`proxyManaged`를 받는다. 맡음이면 발급하지 않고 `authorization`을 붙이지 않으며, 401은 다시 받지 않고 실패로 둔다(재발급은 프록시 몫).
- 수집기의 프록시 요청은 `src/lib/providers/http.ts`의 `createProxyClient`와 같은 규칙으로 `redirect: 'manual'`을 지정한다. 3xx·`opaqueredirect`는 재시도 없이 즉시 실패로 처리하고 `Location`으로 다시 보내지 않는다. 다른 출처에 `x-proxy-token`이 전달되는 것을 막는다.
- 프록시 토큰도 오류 문구에서 가린다(`GAZUA_PROXY_TOKEN`을 가림 목록에 더한다).

## 7. 오류·보안

- 키·토큰·프록시 토큰 값은 응답·로그·오류 문구에 남기지 않는다. 프록시 로그는 지금처럼 method·path·status·ms와 시작·발급 실패 상태 코드만.
- 맡음 프록시는 토큰 없는 요청에도 계좌 조회를 열어 준다. 대신 `PROXY_TOKEN`과 허용 출처 검사는 그대로 먼저 통과해야 한다(4.4).
- 옛 클라이언트가 `/oauth2/token`을 부르면 403 `toss-token-managed`. 현재 웹의 `src/lib/providers/errors.ts`에는 이 코드 매핑이 없어 `upstream` 오류가 되고, `toss.ts`의 `api()`는 `token-expired`만 재시도하므로 다음 발급 시 실패하며 맡음 여부를 재확인하지 않는다. 맡음 여부를 다시 확인하고 한 번 더 시도하는 것은 5.2·5.4를 적용한 새 웹만 해당한다. 구버전 탭은 새 웹을 배포한 뒤 브라우저에서 페이지를 새로고침해야 한다(9절).

## 8. 시험

- 프록시: 관리자(단일 발급, 만료 전 재발급, 60초 안 401은 재발급 안 함, 실패는 캐시 안 함, 값이 로그에 없음), 핸들러(맡음일 때 인증 교체·`/oauth2/token` 403·401 한 번 재시도·`/health` 플래그, 없을 때 그대로), 주문(인증 없이 받음·프록시 토큰 사용·401 재전송 없음·발급 실패 시 send 기록 없음), 서버(키 있으면 `/health` true).
- 웹: 토스 제공자(맡음이면 발급 호출 0번·인증 헤더 없음·`token-contended` 없음, 키 없이 동작, 방식 바뀜 재시도, 조회 실패 시 발급 없음·기억 안 함), factory(키 없어도 프록시 있으면 토스), 진단(맡음이면 ③ 발급 없이 ok), `proxyHealth`(true·false·옛 프록시, 비2xx·비JSON·잘못된 응답·네트워크 오류·시간 초과·리다이렉트는 던짐).
- CLI: `buildProvider` 프록시 경로(origin·프록시 토큰 헤더, 인증 없음, 주입한 `ctx.fetch` 사용), `chooseProvider`, `order` 맡음 시 `authorization` 없이 전송. `order`: 502 `toss-token-failed`는 `order-token-failed`(send 안내 없음), 코드 없는 502·504는 그대로 `order-unknown`. `auto`: `order-token-failed`면 원장을 되돌린다.
- CLI 진입점: `cli/src/commands/market.test.ts`·`signals.test.ts`·`simulate.test.ts`에서 증권사 키 없이 프록시 환경변수 세 개만 설정하고 `/health`가 `tossToken: true`인 경우 `quote`·`holdings`·`signals`·`simulate`를 각각 `run`으로 실행한다. `signals`·`simulate`는 동기화 로그인·프로필·전략을 준비하고 실제 `buildProvider`를 사용한다. 성공 결과와 `/toss` 조회 경로, origin·프록시 토큰 헤더, `authorization` 및 `/oauth2/token` 호출 없음을 확인한다. 프록시 설정도 키도 없으면 기존 `no-credentials`, 프록시가 맡지 않고 키가 없으면 `invalid-credentials`, `--provider kis`에 KIS 키가 없으면 기존 `no-credentials`를 확인한다.
- 스크립트: `toss-collect` 맡음 모드(발급 없음·헤더), `collect-market-data` 선택 로직(정상 비관리 응답일 때만 직접 경로, 조회 실패 시 오류 종료·직접 발급 없음). `tests/toss-collect.test.mjs`에 프록시 요청의 `redirect: 'manual'`을 확인하고, 다른 출처를 가리키는 `Location`이 있는 3xx 및 `opaqueredirect` 응답 각각에서 즉시 실패하며 fetch가 한 번만 호출되고 다른 출처로 두 번째 요청이 발생하지 않는 시험을 더한다.
- 모두 가짜 fetch로. 실제 발급·주문 없음.

## 9. 사람이 할 일

배포 순서:

1. 프록시 관리를 활성화하기 전에 5절의 새 웹과 6절의 CLI·수집 스크립트를 먼저 배포한다. 각 기기의 열린 웹 탭은 브라우저에서 페이지를 새로고침해 새 버전을 불러온다. 이 단계에서는 클라이언트의 기존 토스 키를 유지한다(맡음이 아니면 키가 필요하다).
2. CLI·수집 예약 작업의 env 파일에 `GAZUA_PROXY_URL`·`GAZUA_PROXY_TOKEN`·`GAZUA_PROXY_ORIGIN`을 넣는다(주문을 쓰면 이미 있다).
3. `proxy/.env`에 `TOSS_CLIENT_ID`·`TOSS_CLIENT_SECRET`을 넣고 `proxy/macos/install.sh`를 다시 실행해 새 프록시를 빌드·재시작한다. 4.4의 `PROXY_TOKEN`도 설정되어 있어야 한다.
4. 각 기기의 웹 페이지를 새로고침해 맡음 여부를 새로 확인하고, 휴대폰 진단 카드의 「토스 조회: 맥 프록시가 맡음」 줄과 시세·차트가 경고 없이 뜨는지 확인한다. CLI·수집 작업도 새 버전과 프록시 설정으로 실행하는지 확인한다. 클라이언트의 토스 키는 지우지 않아도 된다(맡음이면 쓰이지 않는다). 지금 웹에는 토스 키만 지우는 기능이 없고 키 삭제는 프록시 토큰까지 지우므로, 새 기기에서만 키 없이 시작한다.

비관리 모드로 되돌리는 순서:

1. 키 없이 시작한 웹 기기에는 설정 화면에서 토스 Client ID·Client Secret을 입력·저장하고, 키 없는 CLI·수집 작업에는 `TOSS_CLIENT_ID`·`TOSS_CLIENT_SECRET`을 넣는다. 비관리 모드의 수집은 토스에 직접 요청하므로 실행 기기의 공인 IP가 토스 허용 IP로 등록되어 있어야 한다(`cli/README.md`). CLI는 프록시 설정이 있으면 비관리 모드에서도 프록시를 거친다.
2. `proxy/.env`에서 토스 키 두 항목을 제거하고 `proxy/macos/install.sh`를 다시 실행한다. 프록시 접속 인증인 `PROXY_TOKEN`과 허용 출처 설정은 유지한다.
3. 열린 웹 탭을 브라우저에서 페이지 새로고침해 기억한 맡음 여부를 버리고 키를 사용하는 제공자를 다시 만든다. 키 없는 상태에서는 5.2에 따라 `invalid-credentials`로 실패하므로 자동 복구에 기대지 않는다. CLI·수집은 복원한 키가 들어 있는 환경으로 다음 실행을 시작한다. 비관리 모드는 기존의 기기 간 토큰 발급 경쟁이 다시 생길 수 있다(1절).
