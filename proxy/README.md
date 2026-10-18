# 가즈아 프록시

KIS·토스증권 Open API는 브라우저 CORS를 허용하지 않아서, 정적 앱이 이 작은 프록시를 거쳐 호출해요. 같은 `handle()` 함수가 Cloudflare Worker(KIS)와 Node 컨테이너(토스, 고정 집 IP)에서 모두 돌아요.

## HTTP 계약

- `GET /health` → `200 {"ok":true,"providers":["kis","toss"]}`
- `{GET|POST} /{kis|toss}/{상위 경로}?{쿼리}` → 허용 목록에 있는 경로만 상위로 전달하고, 응답(상태·본문·`content-type`·`retry-after`·`x-ratelimit-remaining`·`tr_cont`)을 그대로 돌려줘요.
- 확인 순서: 출처(`Origin`이 `ALLOWED_ORIGINS`에 있어야 함, 아니면 `403 origin-not-allowed`) → `X-Proxy-Token`(`PROXY_TOKEN`을 설정한 경우, 아니면 `401 proxy-token-invalid`) → 경로·메서드 허용 목록(아니면 `403 proxy-path-blocked`, 상위 호출 없음) → 전달.
- 상위 네트워크 오류는 `502 upstream-unreachable`.
- 주문·주문 조회·매수가능금액 같은 계좌 경로는 허용 목록에 없어서 항상 거절돼요. 토스의 계좌 목록(`/api/v1/accounts`)과 보유 주식(`/api/v1/holdings`) **조회(GET)만** 관심그룹 가져오기용으로 열려 있고, 보유 주식에 필요한 `X-Tossinvest-Account` 헤더를 함께 전달해요.
- 로그는 `method path status ms`만 남겨요. 헤더·본문·쿼리는 기록하지 않아요.

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

- 프록시 코드를 바꾸거나 `.env`를 고친 뒤에는 `proxy/macos/install.sh`를 다시 실행해요. 다시 빌드하고 재시작해요.
- 로그는 `~/Library/Logs/gazua-proxy.log`예요. 지우려면 `proxy/macos/uninstall.sh`를 실행해요.
- 맥이 잠자기에 들어가면 프록시도 응답하지 않아요.
- 앱은 프록시 URL을 하나만 받는데, 이 프록시는 `/kis/...` 경로도 처리해요. KIS로 바꿀 때도 같은 주소와 토큰을 써요.

### 잘 안 될 때

| 증상 | 원인 |
|---|---|
| `/health`가 `error code: 502` | 터널은 붙었는데 `localhost:8787`에 프록시가 없어요. `lsof -nP -iTCP:8787 -sTCP:LISTEN`로 확인하고, `cloudflared` 로그(`/Library/Logs/com.cloudflare.cloudflared.err.log`)에 `connection refused`가 보이면 프록시를 띄워요 |
| 앱 진단 `401 proxy-token-invalid` | 앱의 프록시 토큰과 `.env`의 `PROXY_TOKEN`이 달라요. 앱은 끝 4자리만 보여 주니 모르면 새로 만들어 양쪽을 바꿔요 |
| 앱 진단 `403 origin-not-allowed` | `ALLOWED_ORIGINS`에 경로나 끝 `/`가 붙었어요. 출처만 적어요 |

- 프록시 토큰은 Cloudflare 대시보드에 없어요. 직접 정한 값이고 앱과 `.env` 두 곳에만 있어요.
- 토큰을 묻는 명령(`read -s`)은 Claude Code 채팅창의 `!` 입력으로 돌리면 입력을 받지 못해요. 진짜 터미널에서 돌리거나 `.env`에 적어요.
- 셸에 autoenv 같은 `cd` 훅이 있으면 `cd proxy`에서 질문을 띄워 다음 입력을 가로챌 수 있어요. 절대 경로로 실행하면 피할 수 있어요.
