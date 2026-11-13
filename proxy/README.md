# 가즈아 프록시

KIS·토스증권 Open API는 브라우저 CORS를 허용하지 않아서, 정적 앱이 이 작은 프록시를 거쳐 호출해요. 같은 `handle()` 함수가 Cloudflare Worker(KIS)와 Node 컨테이너(토스, 고정 집 IP)에서 모두 돌아요.

## HTTP 계약

- `GET /health` → `200 {"ok":true,"providers":["kis","toss"],"originAllowed":true|false,"tossToken":true|false}`. 비밀값이 없어서 **어느 출처에서나 읽혀요**(허용하지 않은 출처에는 `access-control-allow-origin: *`). 앱 연결 진단이 "터널이 끊겨 프록시까지 닿지 않음"과 "이 출처를 허용하지 않음"을 구분하는 데 써요. 다른 경로는 허용한 출처만 받아요.
- `{GET|POST} /{kis|toss}/{상위 경로}?{쿼리}` → 허용 목록에 있는 경로만 상위로 전달하고, 응답(상태·본문·`content-type`·`retry-after`·`x-ratelimit-remaining`·`tr_cont`)을 그대로 돌려줘요.
- 확인 순서: 출처(`Origin`이 `ALLOWED_ORIGINS`에 있어야 함, 아니면 `403 origin-not-allowed`) → `X-Proxy-Token`(`PROXY_TOKEN`을 설정한 경우, 아니면 `401 proxy-token-invalid`) → 경로·메서드 허용 목록(아니면 `403 proxy-path-blocked`, 상위 호출 없음) → 전달.
- 상위 네트워크 오류는 `502 upstream-unreachable`.
- 주문·매수가능금액 같은 계좌 경로는 허용 목록에서 계속 거절해요. 별도 검사를 거치는 Node의 `POST /order/toss`만 주문을 받아요. 아래 토스 경로는 **조회(GET)만** 받아요.
  - 계좌 목록(`/api/v1/accounts`)과 보유 주식(`/api/v1/holdings`): 관심그룹 가져오기와 내 성과의 수량 대조에 써요.
  - 주문 목록(`/api/v1/orders`): 내 성과의 체결 내역을 받는 데 써요. 사용자가 허락한 예외예요. 같은 경로의 `POST`(주문 생성)는 막아요. 주문 상세·정정·취소(`/api/v1/orders/{id}`, `…/modify`, `…/cancel`), 조건주문(`/api/v1/conditional-orders`), 매수가능금액(`/api/v1/buying-power`), 매도가능수량, 수수료 경로도 계속 막아요.
  - 보유 주식과 주문 목록에 필요한 `X-Tossinvest-Account` 헤더를 함께 전달해요.
- 이 프록시를 고칠 때 허용 목록을 더 넓히지 마세요. 주문은 아래의 별도 경로와 한도 검사를 거쳐요.
- 요청 로그는 `method path status ms`만 남겨요. 헤더·본문·쿼리는 기록하지 않아요.

## 주문 경로

Node 프록시에서 본인 토스 계좌의 국내 주식 지정가(`LIMIT`)·당일(`DAY`) 매수·매도만 받아요. CLI의 `gazua order`와 실전 `gazua auto`가 이 경로를 써요. 웹 화면과 MCP에는 주문 기능이 없어요. `Claude는 실제 주문을 실행하지 않는다`는 원칙에 따라 Claude·Codex 개발 시험은 가짜 fetch와 임시 디렉터리로만 해요. 첫 소액 주문은 사용자가 직접 확인해요.

- `GET /order/status`: 켜짐·중지 여부, 1회·하루 금액 한도, 총 가용 금액과 지금 쓴 금액(`invested`), 분당 매수·하루 전체 건수 한도와 오늘(KST) 보낸 건수·금액을 돌려줘요. 비밀값은 없어요.
- `POST /order/toss`: `authorization`, `x-tossinvest-account` 헤더와 `{symbol, side, quantity, price}`만 받아요. 종목은 영문 대문자·숫자 6자리, 방향은 `BUY`·`SELL`, 수량·지정가는 양의 안전한 정수예요. 프록시가 지정가 본문과 UUID를 새로 만들어요.
- 출처와 프록시 토큰을 먼저 검사해요. 서버 `PROXY_TOKEN`이 비었거나 Worker 판이면 `404 order-unavailable`이에요. 허용 목록의 `/toss/api/v1/orders` POST와 정정·취소·조건주문 경로는 계속 막혀요.
- 주문 금액은 `수량 × 지정가`예요. **1회 금액이 한도 이상이면 거절**해요. 매수·매도 모두 같고 수수료·세금은 포함하지 않아요. 매도 체결가는 지정가보다 높아 받을 금액이 한도를 넘을 수 있어요.
- 하루 금액 합은 선택 한도까지 허용해요. 기본 반복 상한은 최근 60초 매수 3건·KST 하루 매수·매도 합계 20건이에요. 처리 중인 다른 주문은 `409 order-busy`로 즉시 거절해요. 토스 오류·시간 초과도 보낸 건수와 금액에 포함해요.

맥의 `proxy/.env`에 아래 설정을 넣어요. `ORDER_ENABLED=true`와 함께 1회 한도 `ORDER_MAX_AMOUNT`나 총 가용 금액 `ORDER_TOTAL_MAX_AMOUNT` 중 하나 이상이 올바르게 있어야 켜져요. 1회 한도를 비우면 총 가용 금액이 한 번에 쓸 수 있는 최대예요. 금액·건수는 쉼표·소수 없는 양의 안전한 정수예요. 선택 설정도 잘못되면 주문 전체가 꺼져요. 하루 금액 한도와 총 가용 금액은 비우면 검사하지 않아요. 총 가용 금액은 감사 로그에 남은 「보낸」 매수 금액에서 「접수 성공을 확인한」 매도 금액을 뺀 잔액으로 세요. 매수만 막고 매도는 막지 않아요. 잔액은 0 아래로 내려가지 않아서, 원래 갖고 있던 주식을 팔아도 한도가 늘지 않아요. 미체결·취소된 주문도 보낸 금액으로 남으니, 잔액을 처음부터 다시 세려면 프록시를 멈추고 감사 로그를 다른 이름으로 옮긴 뒤 다시 시작해요.

```dotenv
ORDER_ENABLED=true
# 둘 중 하나 이상: 1회 한도(이 금액 이상 거절), 총 가용 금액
ORDER_MAX_AMOUNT=300000
ORDER_TOTAL_MAX_AMOUNT=5000000
# 선택 설정
ORDER_DAILY_MAX_AMOUNT=1000000
# 분당 매수 건수(매도는 제외)
ORDER_MAX_PER_MINUTE=3
ORDER_MAX_PER_DAY=20
ORDER_STOP_FILE=~/gazua-order.stop
ORDER_AUDIT_LOG=~/Library/Logs/gazua-orders.jsonl
```

`~`는 홈으로 바꿔요. 경로는 절대 경로나 `~/`로 시작해야 해요(launchd의 작업 폴더가 `/`라서 상대 경로는 막아요). 위 목록에 없는 `ORDER_` 설정(키 오타)이 있어도 주문이 꺼져요. 주문은 맥 Node 판에서만 써요. Docker 판은 `ORDER_*`를 넘기지 않아 꺼져 있고, 켜면 감사 로그가 컨테이너와 함께 사라지므로 쓰지 않아요. 설정 변경은 사용자가 `proxy/macos/install.sh`로 빌드·재시작해야 적용돼요. 중지 파일은 재시작 없이 만들거나 지워요. 멈추는 순서는 중지 파일 만들기(`touch ~/gazua-order.stop`) → 토스 앱에서 미체결 주문 확인·필요하면 취소 → 필요하면 `ORDER_ENABLED`를 끄고 재시작이에요. 중지 파일을 지우면 다시 주문을 받아요.

감사 로그는 기본 `~/Library/Logs/gazua-orders.jsonl`이고 권한은 600이에요. 거절(`reject`)·보내기(`send`)·결과(`result`)를 한 줄 JSON으로 남겨요. 토큰·계좌 번호·요청 원문은 쓰지 않아요. `send`를 쓰지 못하면 `503 order-audit-failed`로 거절하고 토스에 보내지 않아요. 시작 때 로그를 만들거나 열고 오늘 합계와 최근 60초 기록을 복원한 뒤 주문을 받아요. 그 전에는 `order-disabled`예요. 깨진 로그나 복원 실패가 있으면 주문을 끄고 시작 로그에 이유·깨진 줄 번호를 남겨요. 해당 줄을 확인·정리한 뒤 재시작하고, **감사 로그는 지우지 않아요**.

토스에는 고정 HTTPS 주소로 한 번만 보내며 리다이렉트를 따라가지 않아요. 토스의 4xx만 `order-upstream`(토스가 거절함)으로 돌려줘요. 토스의 5xx·200 아닌 2xx·3xx와 연결 끊김은 `502 upstream-unreachable`, 시간 초과는 `504 upstream-timeout`이고 모두 `clientOrderId`를 붙여요. 주문이 들어갔을 수 있으므로 토스 앱에서 확인하기 전에는 다시 보내지 마세요. CLI가 ID를 못 받았다면 감사 로그의 `send`에서 시각·종목으로 찾아요.

## 맥의 시장 데이터 조회

Node 프록시가 맥의 시장 파일을 읽고 선정 기준 미리 보기·검증을 계산한다. 휴대폰에는 요약과 계산 결과만 보낸다. 앱에 이 기기 파일이 있으면 그 파일을 먼저 쓴다. 없으면 설정에 저장한 프록시 주소와 토큰으로 맥에 요청한다.

- `GET /market/meta`: 수집일·기간·종목 수·파일 형식과 업종·테마 목록을 반환한다. `info.file`은 선택한 파일 이름이다.
- `POST /market/screen`: Worker의 `preview`·`run` 요청을 받고 마지막 결과·오류만 반환한다. 요청의 `input.data`는 버린다. 요청을 차례로 계산하며 원격 진행률은 보내지 않는다.
- 모든 시장 경로는 `ALLOWED_ORIGINS`와 `x-proxy-token`을 검사한다. 서버의 `PROXY_TOKEN`이 비어 있거나 Cloudflare Worker 판이면 `404 market-unavailable`이다.
- 파일이 없으면 `404 market-file-missing`, gzip·JSON·형식 검사에 실패하면 `503 market-file-invalid`이다. 다른 시장 경로는 `404 market-not-found`, 잘못된 메서드는 `405 method-not-allowed`이다.
- `/market/screen` 본문은 1 MiB까지, 다른 경로는 16 KB까지 받는다. 넘으면 `413 payload-too-large`이다. `Accept-Encoding: gzip` 요청에는 압축해 응답한다.

파일 폴더는 `MARKET_DATA_DIR`, 기본값은 `~/gazua-data`이다. `~`로 시작하는 설정도 홈으로 바꾼다. 이 폴더에서 `market-data-YYYYMMDD.json.gz` 중 날짜가 가장 큰 파일을 고른다. 이름·수정 시각·크기가 바뀌면 데이터와 계산 캐시를 다시 만든다. 파일 교체만으로는 프록시를 다시 시작할 필요가 없다.

`proxy/.env`에서 `MARKET_DATA_DIR`을 바꾸면 `proxy/macos/install.sh`로 빌드·재시작한다. 직접 실행할 때는 같은 환경변수를 설정하고 `pnpm --filter proxy build` 뒤 `pnpm --filter proxy start`로 다시 띄운다. 맥이 잠들거나 터널이 끊기면 앱에 「맥 데이터에 닿지 않아요」가 표시된다. 앱에서 취소하거나 90초 시간 제한에 걸려도 맥의 계산은 끝까지 돌고 결과만 버린다. `MARKET_DATA_DIR`을 `~/Documents`·iCloud 아래에 두면 macOS 개인정보 보호 때문에 LaunchAgent가 파일을 읽지 못해 `market-file-invalid`가 난다. 기본값 `~/gazua-data`를 쓴다.

Node 빌드는 웹의 순수 계산기를 esbuild로 묶어 `proxy/dist/node/server.js`를 만든다. 브라우저 전용 코드가 번들에 들어오면 실패한다. Docker는 저장소 루트를 빌드 문맥으로 쓴다(`docker build -f proxy/Dockerfile .`). 컨테이너에 시장 파일을 넣지 않으면 `market-file-missing`이다. 시장 파일은 본인 기기 사이에서만 쓰며 공개 배포하지 않는다.

## 개발

```bash
corepack pnpm --filter proxy test
corepack pnpm --filter proxy build
```

## KIS: Cloudflare Worker

1. `corepack pnpm --filter proxy exec wrangler login`
2. `proxy/wrangler.toml`의 `[vars] ALLOWED_ORIGINS`를 앱 주소(예: `https://gazua.<도메인>`, 커스텀 도메인이 없으면 `https://<사용자>.github.io`)로 바꿔요. 여러 개면 콤마로 구분하고, 경로 없이 출처만 정확히 적어요.
3. (선택) `corepack pnpm --filter proxy exec wrangler secret put PROXY_TOKEN`
4. `corepack pnpm --filter proxy deploy:worker`
5. 배포된 `https://gazua-proxy.<계정>.workers.dev/health`가 200을 주는지 확인해요.

> **확인 필요:** Cloudflare Workers가 KIS의 비표준 포트(`:9443`)로 나가는 요청을 실제로 보낼 수 있는지는 아직 확인하지 못했어요. 막혀서 `502 upstream-unreachable`가 나오면 KIS도 아래 Node 컨테이너로 돌리세요.

## 토스증권: Docker + Cloudflare Tunnel

토스 Open API는 허용된 IP에서만 호출돼요. 집 공인 IP가 고정된 환경에서 컨테이너를 돌리고, Cloudflare Tunnel로 외부에 노출해요.

1. Cloudflare Zero Trust에서 Tunnel을 만들고, Public Hostname이 `http://proxy:8787`을 가리키게 설정한 뒤 토큰을 복사해요.
2. `proxy/.env`를 만들어요(커밋되지 않아요).
   ```
   ALLOWED_ORIGINS=https://gazua.<도메인>
   PROXY_TOKEN=<임의의 긴 문자열>
   TUNNEL_TOKEN=<터널 토큰>
   ```
3. `cd proxy && docker compose up -d --build`
4. `https://<터널 호스트명>/health`가 200을 주는지 확인해요.

### cloudflared 버전 올리기

`docker-compose.yml`의 `cloudflare/cloudflared` 이미지는 `latest`가 아니라 릴리스 태그(현재 `2026.10.0`)로 고정돼 있어요. 터널이 예고 없이 바뀌지 않게 하려는 거예요.

1. https://github.com/cloudflare/cloudflared/releases 에서 새 릴리스 태그를 확인해요.
2. `docker-compose.yml`의 `image:` 태그를 그 값으로 바꿔요.
3. `cd proxy && docker compose pull cloudflared && docker compose up -d`
4. `https://<터널 호스트명>/health`가 200을 주는지 확인해요.

### 토스 허용 IP 등록

1. 집 공인 IP 확인: `curl -s https://api.ipify.org`
2. 토스증권 WTS › 설정 › Open API › 허용 IP 관리에 그 IP를 등록해요.

### IP가 바뀌었을 때

토스 호출이 `403`/인증 오류로 갑자기 실패하면 공인 IP가 바뀐 경우가 많아요.

1. 다시 `curl -s https://api.ipify.org`로 현재 IP를 확인해요.
2. 토스증권 WTS › 설정 › Open API › 허용 IP 관리에서 옛 IP를 지우고 새 IP를 등록해요.
3. 컨테이너를 재시작할 필요는 없어요.

## 토스증권: 맥에서 바로 돌리기 (Docker 없이)

Docker 대신 맥에 `cloudflared`를 서비스로 설치하고 프록시를 Node로 띄우는 방법이에요. 2026-10-18에 이 방법으로 연결을 확인했어요.

1. Cloudflare에 도메인을 하나 연결해요(대시보드 › 도메인에서 상태가 `활성`).
2. Zero Trust › Networks › Tunnels에서 터널을 만들고, 운영 체제로 **macOS**를 골라 안내된 명령으로 `cloudflared` 서비스를 설치해요. 대시보드에서 터널이 HEALTHY가 되면 돼요.
3. 터널의 공개 호스트 이름을 추가해요. 하위 도메인은 `gazua-proxy`, 서비스 유형은 **HTTP**, URL은 **`localhost:8787`**이에요. Docker 방식의 `proxy:8787`은 compose 안에서만 통해요.
4. `proxy/.env`를 만들어요(커밋되지 않아요). 이 방식에는 `TUNNEL_TOKEN`이 필요 없어요.
   ```
   ALLOWED_ORIGINS=https://gazua.<도메인>
   PROXY_TOKEN=<openssl rand -hex 32로 만든 값>
   ```
5. 로그인할 때 프록시가 자동으로 뜨게 설치해요. 빌드하고 LaunchAgent(`dev.gazua.proxy`)를 등록한 뒤 `/health`까지 확인해요.
   ```bash
   proxy/macos/install.sh
   ```
6. 이 맥의 공인 IP를 토스 허용 IP에 등록해요(위 `토스 허용 IP 등록`). 토스로 나가는 요청은 터널이 아니라 이 맥에서 바로 나가요.
7. `https://gazua-proxy.<도메인>/health`가 200을 주면 앱 설정의 프록시 URL에 그 주소를, 프록시 토큰에 `PROXY_TOKEN` 값을 넣어요.

- `install.sh`는 저장소 hook(`git config core.hooksPath .githooks`)도 켜요. 그 뒤로는 `git pull`(병합·앞으로 감기·rebase)로 프록시 코드(`proxy/src`·`proxy/node`·`proxy/package.json`·`proxy/tsconfig.json`·`proxy/build.mjs`·`install.sh`, 번들에 들어가는 `src/lib/screen`·`sim`·`marketData`·`time`·`data`)가 바뀌면 hook이 `install.sh`를 한 번 다시 돌려 새 버전으로 재시작해요. 로컬 커밋이 이미 상대 쪽에 있어 rebase가 모두 생략하는 경우도 `post-checkout`이 잡아요(브랜치만 바꾸는 checkout에는 반응하지 않아요). 프록시가 설치되지 않은 기기에서는 아무것도 하지 않고, 실패해도 `git pull`은 막지 않아요.
- 다른 hook 경로를 이미 쓰고 있거나 `.git/hooks`에 직접 둔 hook(`.sample` 말고 실행 가능한 파일)이 있으면, 그 hook이 꺼지지 않게 hook 경로를 바꾸지 않고 켜는 방법만 알려 줘요(`proxy/macos/enable-hooks.sh`). 기존 hook이 필요 없으면 `git config core.hooksPath .githooks`로, 계속 쓰려면 `.git/hooks`의 `post-merge`·`post-rewrite`·`post-checkout`에서 `.githooks`의 같은 이름 hook을 `"$@"`와 함께 불러요.
- 자동 반영은 기본 rebase 방식(merge 백엔드) 기준이에요. `git rebase --apply`로 커밋이 전부 생략되면 hook이 불리지 않으니 `install.sh`를 직접 실행해요.
- `.env`를 고친 뒤에는 `proxy/macos/install.sh`를 직접 다시 실행해요(hook은 코드 변경만 봐요).
- 로그는 `~/Library/Logs/gazua-proxy.log`예요. 지우려면 `proxy/macos/uninstall.sh`를 실행해요.
- 맥이 잠자기에 들어가면 프록시도 응답하지 않아요.
- 앱은 프록시 URL을 하나만 받는데, 이 프록시는 `/kis/...` 경로도 처리해요. KIS로 바꿀 때도 같은 주소와 토큰을 써요.

### 잘 안 될 때

| 증상 | 원인 |
|---|---|
| 앱 진단 ②에서 "프록시까지 닿지 않았어요" 또는 `/health`가 `error code: 1033`(530) | 터널이 끊겼어요. `cloudflared` 로그에 `Invalid tunnel secret`이 보이면 Cloudflare에서 터널 토큰이 바뀐 거예요. 새 토큰을 `/Library/Application Support/com.cloudflare.cloudflared/token`에 넣고 `sudo launchctl kickstart -k system/com.cloudflare.cloudflared`로 다시 띄워요 |
| `/health`가 `error code: 502` | 터널은 붙었는데 `localhost:8787`에 프록시가 없어요. `lsof -nP -iTCP:8787 -sTCP:LISTEN`로 확인하고, `cloudflared` 로그(`/Library/Logs/com.cloudflare.cloudflared.err.log`)에 `connection refused`가 보이면 프록시를 띄워요 |
| 앱 진단 `401 proxy-token-invalid` | 앱의 프록시 토큰과 `.env`의 `PROXY_TOKEN`이 달라요. 앱은 끝 4자리만 보여 주니 모르면 새로 만들어 양쪽을 바꿔요 |
| 앱 진단 `403 origin-not-allowed` | `ALLOWED_ORIGINS`에 경로나 끝 `/`가 붙었어요. 출처만 적어요 |

- 프록시 토큰은 Cloudflare 대시보드에 없어요. 직접 정한 값이고 앱과 `.env` 두 곳에만 있어요.
- 토큰을 묻는 명령(`read -s`)은 Claude Code 채팅창의 `!` 입력으로 돌리면 입력을 받지 못해요. 진짜 터미널에서 돌리거나 `.env`에 적어요.
- 셸에 autoenv 같은 `cd` 훅이 있으면 `cd proxy`에서 질문을 띄워 다음 입력을 가로챌 수 있어요. 절대 경로로 실행하면 피할 수 있어요.


`ORDER_MAX_PER_MINUTE`은 매수에만 적용하고, 재시작 복원에서도 최근 매수만 세요. `ORDER_MAX_PER_DAY`와 하루 금액은 매수·매도를 합쳐 세요. 총 가용 금액의 `invested`는 매수 전송 때 늘고, 매도는 토스 접수 성공이 확인됐을 때만 줄어요. 재시작 때도 같은 `clientOrderId`의 성공 결과를 확인하며, 거절·결과 불명 매도로 매수 한도를 되살리지 않아요. 접수된 매도의 미체결·만료까지 추적하지는 않으므로 토스 앱에서 확인해 주세요.


## 토스 토큰을 맥 프록시가 맡기

맥 Node 프록시에 `PROXY_TOKEN`과 `TOSS_CLIENT_ID`·`TOSS_CLIENT_SECRET`이 모두 있으면 프록시 한 곳에서 토큰을 발급하고 메모리에만 보관해요. 웹·CLI·수집기는 `/health`의 `tossToken: true`를 확인해 토큰 발급과 인증 헤더 없이 요청해요. 키가 없거나 `PROXY_TOKEN`이 없으면 맡지 않고 기존 인증 방식으로 동작해요. Cloudflare Worker 판은 맡지 않아요.

관리 모드에서도 `ALLOWED_ORIGINS`와 프록시 토큰 검사를 먼저 통과해야 해요. 클라이언트가 보내는 `/toss/oauth2/token`은 `403 toss-token-managed`로 막고, 토스로 나가는 조회·주문에는 프록시 토큰 관리자의 인증을 붙여요. 조회 401은 마지막 발급 뒤 60초가 지난 경우에만 한 번 새 토큰으로 다시 보내요. 주문은 401이어도 다시 보내지 않아요.

배포는 다음 순서로 해요.

1. 새 웹과 CLI·수집 스크립트를 먼저 배포해요. 각 기기의 열린 웹 탭은 페이지를 새로고침해 새 버전을 불러와요. 아직 프록시가 맡기 전이므로 기존 클라이언트의 토스 키는 유지해요.
2. CLI·수집 예약 작업에 `GAZUA_PROXY_URL`·`GAZUA_PROXY_TOKEN`·`GAZUA_PROXY_ORIGIN`을 설정해요. URL은 맥 프록시 주소, 토큰은 프록시의 `PROXY_TOKEN`과 같은 값, 출처는 `ALLOWED_ORIGINS`에 등록한 값이에요.
3. `proxy/.env`에 `TOSS_CLIENT_ID`·`TOSS_CLIENT_SECRET`을 넣고 `PROXY_TOKEN`도 설정돼 있는지 확인해요. 그런 다음 `proxy/macos/install.sh`를 직접 다시 실행해 빌드·재시작해요. 키·토큰 값은 저장소나 로그에 옮기지 않아요.
4. `~/Library/Logs/gazua-proxy.log`에서 시작 로그 `toss-token: proxy`, `/health`에서 `tossToken: true`를 확인해요. `toss-token: off`면 키 두 개와 `PROXY_TOKEN` 설정을 확인해요. 발급 실패 로그는 `toss-token: issue failed <상태 코드>`이고 값은 기록하지 않아요.
5. 각 기기의 웹 페이지를 다시 새로고침하고 진단 카드의 「토스 조회: 맥 프록시가 맡음」과 시세·차트를 확인해요. CLI·수집 예약 작업도 새 버전과 프록시 설정으로 실행해요. 관리 모드에서는 클라이언트에 토스 키가 없어도 돼요. 기존 키는 지우지 않아도 되며, 앱의 키 삭제는 프록시 토큰도 지우므로 새 기기에서만 키 없이 시작해요.

토큰 발급에 실패하면 조회·주문은 `502 toss-token-failed`예요. 주문은 상류 전송·감사 로그 `send`·하루 건수 증가 전에 끝나며, CLI는 `order-token-failed`로 「주문을 보내지 않았어요」라고 안내해요. 다른 주문 502·504는 기존처럼 결과 불명이므로 토스 앱에서 먼저 확인해요.

비관리 모드로 되돌릴 때는 먼저 키 없이 쓰던 웹 기기에 토스 키를 저장하고, CLI·수집 예약 작업에도 `TOSS_CLIENT_ID`·`TOSS_CLIENT_SECRET`을 복원해요. 그다음 `proxy/.env`에서 토스 키 두 항목을 제거하고 `proxy/macos/install.sh`를 다시 실행해요. `PROXY_TOKEN`과 허용 출처는 유지해요. 열린 웹 탭은 새로고침해 기억한 관리 여부를 비워요.

관리 수집과 프록시 설정이 있는 CLI는 맥 프록시의 공인 IP로 토스에 나가요. 비관리 수집은 토스에 직접 요청하므로 수집 기기의 공인 IP를 토스 허용 IP에 등록해야 해요. CLI도 프록시 설정이 없으면 실행 기기의 허용 IP가 필요해요. 비관리로 돌아가면 기기별 토큰 발급 경쟁도 다시 생길 수 있어요.
