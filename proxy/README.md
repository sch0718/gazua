# 가즈아 프록시

KIS·토스증권 Open API는 브라우저 CORS를 허용하지 않아서, 정적 앱이 이 작은 프록시를 거쳐 호출해요. 같은 `handle()` 함수가 Cloudflare Worker(KIS)와 Node 컨테이너(토스, 고정 집 IP)에서 모두 돌아요.

## HTTP 계약

- `GET /health` → `200 {"ok":true,"providers":["kis","toss"]}`
- `{GET|POST} /{kis|toss}/{상위 경로}?{쿼리}` → 허용 목록에 있는 경로만 상위로 전달하고, 응답(상태·본문·`content-type`·`retry-after`·`x-ratelimit-remaining`·`tr_cont`)을 그대로 돌려줘요.
- 확인 순서: 출처(`Origin`이 `ALLOWED_ORIGINS`에 있어야 함, 아니면 `403 origin-not-allowed`) → `X-Proxy-Token`(`PROXY_TOKEN`을 설정한 경우, 아니면 `401 proxy-token-invalid`) → 경로·메서드 허용 목록(아니면 `403 proxy-path-blocked`, 상위 호출 없음) → 전달.
- 상위 네트워크 오류는 `502 upstream-unreachable`.
- 주문·계좌 경로는 허용 목록에 없어서 항상 거절돼요.
- 로그는 `method path status ms`만 남겨요. 헤더·본문·쿼리는 기록하지 않아요.

## 개발

```bash
corepack pnpm --filter proxy test
corepack pnpm --filter proxy build
```

## KIS: Cloudflare Worker

1. `corepack pnpm --filter proxy exec wrangler login`
2. `proxy/wrangler.toml`의 `[vars] ALLOWED_ORIGINS`를 앱 주소(예: `https://<사용자>.github.io`)로 바꿔요. 여러 개면 콤마로 구분하고, 경로 없이 출처만 정확히 적어요.
3. (선택) `corepack pnpm --filter proxy exec wrangler secret put PROXY_TOKEN`
4. `corepack pnpm --filter proxy deploy:worker`
5. 배포된 `https://gazua-proxy.<계정>.workers.dev/health`가 200을 주는지 확인해요.

> **확인 필요:** Cloudflare Workers가 KIS의 비표준 포트(`:9443`)로 나가는 요청을 실제로 보낼 수 있는지는 아직 확인하지 못했어요. 막혀서 `502 upstream-unreachable`가 나오면 KIS도 아래 Node 컨테이너로 돌리세요.

## 토스증권: Docker + Cloudflare Tunnel

토스 Open API는 허용된 IP에서만 호출돼요. 집 공인 IP가 고정된 환경에서 컨테이너를 돌리고, Cloudflare Tunnel로 외부에 노출해요.

1. Cloudflare Zero Trust에서 Tunnel을 만들고, Public Hostname이 `http://proxy:8787`을 가리키게 설정한 뒤 토큰을 복사해요.
2. `proxy/.env`를 만들어요(커밋되지 않아요).
   ```
   ALLOWED_ORIGINS=https://<사용자>.github.io
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
