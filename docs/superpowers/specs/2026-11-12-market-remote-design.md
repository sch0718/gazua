# 시장 데이터 원격(맥) 조회 — 설계·계획

- 날짜: 2026-11-12
- 전제: 사용자 1명, 여러 기기, 무료 운영. 시장 파일은 본인 기기 사이에서만 쓴다(KIS 약관, 다른 사람에게 배포하지 않음).
- 요청: 「데이터는 맥북에 있어도 핸드폰에서는 다 가져올 필요 없게, 사용할 때 조회하는 데이터만 통신을 통해 가져오도록.」
- 이미 있는 것으로 안 되는 이유: 지금은 기기마다 파일 전체(gzip 15.6MB, 풀면 수백 MB)를 IndexedDB에 가져와야 한다. Drive 전달(#68)도 전체를 옮긴다.

## 1. 웹 앱이 시장 파일을 쓰는 곳 (조사 결과)

| 쓰는 곳 | 저장소 호출 | 실제로 필요한 데이터 |
|---|---|---|
| `src/routes/Simulate.svelte` 선정 기준 탭 | `info()`, `sectors()`, `themes()`, `themeSymbols(code)` | 요약(수집일·기간·종목 수·v2~v4 여부), 업종 목록, 테마 목록·테마별 종목 코드. 모두 작다 |
| 선정 기준 미리 보기·검증 (`src/lib/screen/worker.ts` → `workerHandler.ts`) | `info()`, `load()` | **전 종목 일봉·수급·재무·지수·매크로 전체.** `preview`·`runValidation`이 모든 종목을 훑는다 |
| `src/lib/ui/settings/DataTools.svelte`, `MarketDrive.svelte` | `info()`, `importFile()`, `clear()` | 이 기기에 가져온 파일의 요약 |

- 종목 하나의 일봉을 시장 파일에서 읽는 화면은 없다(종목 일봉은 증권사 API에서 받는다). 그래서 `/market/bars` 같은 종목 단위 경로는 만들지 않는다.
- CLI(`cli/src/marketFile.ts`)는 이 작업과 무관하다.

## 2. 전 종목 계산: (a) 맥에서 계산 선택

선정 기준 미리 보기·검증은 전 종목이 필요한 유일한 기능이고, 선정 기준 탭의 핵심이다.

- (b) 「필요할 때 전체를 받는다」는 휴대폰에서 이 탭을 쓸 때마다 결국 파일 전체를 받는 것이라 요청 취지에 어긋나고, 휴대폰 메모리에도 무겁다.
- (a) 「맥 프록시에서 계산」은 이미 있는 순수 함수 `createWorkerHandler({ store, post })`를 그대로 Node에서 부르면 된다. 새 계산 코드가 없고, 웹 쪽은 `WorkerLike` 자리에 「프록시에 POST하는 가짜 Worker」만 넣으면 된다.
- 그래서 (a)가 코드도 작고 요청에도 맞는다. 대가: 프록시 Node 빌드가 웹 앱 코드(`src/lib/screen`, `src/lib/sim`, `src/lib/marketData/format.ts` 등)를 묶어야 해서 빌드를 tsc 출력에서 esbuild 번들로 바꾼다(CLI와 같은 방식). 출력 경로 `proxy/dist/node/server.js`는 그대로라 launchd 설정은 바뀌지 않는다.
- 계산 중에는 프록시의 이벤트 루프가 몇 초 막힌다. 사용자 1명이고 그 사람이 직접 기다리는 계산이라 받아들인다(worker_threads는 쓰지 않는다). 진행률은 원격에서 보이지 않는다(끝나면 결과만 온다).

## 3. 프록시 (Node 판만)

### 경로

모든 `/market/*` 경로는 기존 증권사 경로와 같은 규칙을 지난다: 허용한 출처만(`ALLOWED_ORIGINS`), 토큰(`x-proxy-token`)이 맞아야 한다, OPTIONS 사전 요청도 같은 방식.

- 기존 증권사 경로는 서버 `PROXY_TOKEN`이 비어 있으면 토큰 검사를 끄지만(`handler.ts`, `server.ts`), 시장 경로는 토큰을 필수로 한다. 서버 토큰이 비어 있으면 `server.ts`가 시장 처리기를 붙이지 않아 `/market/*`는 404 `market-unavailable`을 준다(설치 스크립트를 거치지 않고 직접 띄운 경우도 같다).

| 경로 | 응답 |
|---|---|
| `GET /market/meta` | `{ info, sectors, themes }`. `info`는 `MarketDataInfo`와 같은 이름의 필드(`collectedAt, stocks, range, version, hasMacro, themeCount, hasFlow, flowStocks, hasFin, finStocks`)에 `file`(파일 이름)을 더한다. `themes`는 `{ code, name, symbols }[]` 전체(작다) |
| `POST /market/screen` | 본문 `WorkerRequest`(`{type:'preview', id, input}` 또는 `{type:'run', input}`). `input.data`는 버린다. `createWorkerHandler`가 낸 메시지 중 `progress`를 뺀 마지막 하나(`preview`·`result`·`error`)를 JSON으로 돌려준다 |
| 그 밖의 `/market/...` | 404 `market-not-found`. 방법이 틀리면 405 `method-not-allowed` |

- 오류: 파일 없음 404 `market-file-missing`, 파일을 풀거나 검사하지 못함 503 `market-file-invalid`. 본문은 기존과 같은 `{ error: { code } }`.
- 응답은 요청에 `accept-encoding: gzip`이 있으면 `content-encoding: gzip`으로 보낸다(`zlib.gzipSync`).
- Cloudflare Worker 판(`proxy/src/worker.ts`)에는 시장 기능을 넣지 않는다. `handle`에 시장 처리기가 없으면 `/market/*`는 404 `market-unavailable`.
- Node 서버 본문 제한은 `/market/screen`만 1 MiB(전략·묶음·기준이 들어간다), 나머지는 지금처럼 16 KB.

### 파일 읽기 (`proxy/node/market.ts`)

- 폴더: 환경변수 `MARKET_DATA_DIR`(`.env`), 없으면 `~/gazua-data`(`os.homedir()`). `~`로 시작하는 값도 홈으로 바꾼다.
- 요청마다 폴더를 읽어 `market-data-YYYYMMDD.json.gz` 이름 중 날짜가 가장 큰 파일을 고른다. 수집 세션이 새 파일을 쓰고 이전 하나를 백업으로 남기므로 「가장 새 이름」이 지금 파일이다.
- 그 파일의 `이름|mtimeMs|size`가 지난번과 같으면 메모리에 풀어 둔 값을 쓴다. 다르면 다시 읽는다(gunzip → JSON.parse → `validateMarketData`). 읽는 중에 온 요청은 같은 읽기를 기다린다. 실패도 같은 키로 기억해 같은 파일을 매 요청 다시 풀지 않는다(파일이 바뀌면 다시 시도).
- 수집 계정 표시(`owner`)는 보지 않는다. 시장 경로는 토큰이 있을 때만 열리므로(위 「경로」) 프록시 토큰이 이미 본인 기기임을 보장한다.
- 검증 계산기(`createWorkerHandler`)는 하나만 만들어 두고, 저장소로 `{ info, load }`를 넘긴다. 프록시의 `info()`는 `importId`에 파일 교체 식별자 `이름|mtimeMs|size`를 넣는다. `src/lib/screen/workerHandler.ts`의 데이터 캐시 키(`loadData`)에 `info.importId`를 더해, 이름·크기·요약이 같고 내용만 바뀐 파일도 다시 읽고 미리 계산 캐시(`cachedPrecompute`의 키)도 함께 버리게 한다. 이 기기에 가져온 파일(IndexedDB)은 가져올 때마다 `importId`가 새로 정해지므로 같은 규칙이 그대로 맞는다.

### 빌드·배포

- `proxy/build.mjs`(esbuild, `platform: node`, `format: esm`, `bundle: true`) → `proxy/dist/node/server.js`. CLI처럼 번들에 `import.meta.env`·`window.`·`navigator.locks`가 있으면 실패시킨다.
- `proxy/package.json`: `build`는 `tsc --noEmit -p tsconfig.json && node build.mjs`, devDependency에 `esbuild`(CLI와 같은 `0.25.12`). `proxy/tsconfig.json`은 `rootDir`을 빼고 `noEmit: true`, CLI(`cli/tsconfig.json`)처럼 `lib: ["ES2022", "DOM", "DOM.Iterable"]`, `types: ["node", "vite/client"]`로 둔다. `createWorkerHandler`의 타입 전용 import도 검사 대상이므로 `src/lib/marketData/store.ts`의 `navigator.storage`, `src/lib/state/secrets.ts`의 `CryptoKey`, `src/lib/state/profileStore.ts`·`src/lib/ui/settings/connection.ts`의 `import.meta.env` 타입이 필요하다. 이 타입 설정과 별개로 브라우저 전용 코드의 실행 번들 유입은 위 빌드 검사로 막는다.
- DOM 타입을 함께 쓰면 `proxy/node/server.ts`의 `toRequest`에서 `readBody`가 반환하는 `Buffer`를 `RequestInit.body`에 바로 넣을 수 없다. `init.body = new Uint8Array(await readBody(incoming, maxBodyBytes)).buffer`로 복사해 `ArrayBuffer`를 넘긴다(타입 단언으로 덮지 않는다).
- 루트 `pnpm-lock.yaml`의 `proxy` 항목도 갱신한다(CI는 `pnpm install --frozen-lockfile`).
- Dockerfile(NAS용)은 저장소 루트를 빌드 문맥으로 쓰도록 바꾼다(`docker-compose.yml`의 `build.context: ..`, `dockerfile: proxy/Dockerfile`). Docker 빌드 단계는 타입 검사를 하지 않고 `esbuild@0.25.12`만 설치해 `node proxy/build.mjs`로 번들한다(타입 검사는 저장소의 `pnpm --filter proxy build`와 CI가 맡으므로 이미지에 vite 타입이 필요 없다). 컨테이너에는 시장 파일이 없으므로 `/market/*`는 `market-file-missing`을 준다.
- `.githooks/proxy-auto-update`가 보는 경로에 `proxy/build.mjs`와, 번들에 들어가는 웹 코드 `src/lib/screen`, `src/lib/sim`, `src/lib/marketData`, `src/lib/time`, `src/lib/data`를 더한다.

## 4. 웹 앱

### 시장 데이터 원본 고르기 (`src/lib/marketData/source.ts`)

`createMarketSource({ local, remote })`는 Simulate가 쓰는 `info/sectors/themes/themeSymbols`와 `mode()`를 낸다.

- `local.info()`가 있으면 `mode = 'local'`, 지금처럼 IndexedDB를 쓴다.
- 없고 원격이 설정돼 있으면(`app.settings.proxyUrl`이 비어 있지 않음, 토큰은 `app.secrets?.proxyToken`) `mode = 'remote'`, `/market/meta`를 쓴다.
- 둘 다 아니면 `mode = 'none'`, `info()`는 null(지금의 「가져와 주세요」 안내 그대로).
- 원격에 닿지 못하면 `mode = 'remote-error'`, `info()`는 null. 안내 문구는 「맥 데이터에 닿지 않아요」로 바꿔 보인다.

### 원격 원본 (`src/lib/marketData/remote.ts`)

- `createRemoteMarketData({ baseUrl, token, fetchImpl })`. `meta()`는 `/market/meta`를 한 번 받아 메모리에 10분 둔다(같은 세션에서 업종·테마·테마 종목은 다시 요청하지 않는다). IndexedDB 캐시는 만들지 않는다(받는 양이 작다).
- `screen(msg, signal)`: `/market/screen`에 POST. 시간 제한 90초(Cloudflare Tunnel의 약 100초 한도 안).
- 요청은 `redirect: 'manual'`, 토큰은 `x-proxy-token` 머리글(기존 `http.ts`와 같은 규칙).
- `makeRemoteWorker(remote)`: `WorkerLike`를 구현한다. `postMessage`는 `screen`을 불러 받은 메시지를 `onmessage`로 넘긴다. 연결 실패·시간 초과·프록시 오류는 `{ type:'error', code:'remote', id }`. `terminate`는 진행 중 요청을 모두 끊는다. `WorkerErrorCode`에 `'remote'`를 더하고 문구는 「맥 데이터에 닿지 않아요」.

### 화면

- `src/lib/ui/screen/screenText.ts`: `FAILURE_TEXT`는 `Record<WorkerErrorCode, string>`이므로 `'remote': '맥 데이터에 닿지 않아요'`를 추가한다. 검증 실패 화면(`ValidationRun.svelte`)은 이 매핑으로 원격 오류를 표시한다.
- `CriteriaEditor.svelte` → `PreviewPanel.svelte`: `validationController.svelte.ts`가 전달하는 `PreviewError.code`를 버리지 않고 미리 보기 표시 컴포넌트까지 넘긴다. `'remote'`이면 `FAILURE_TEXT.remote`를 표시하고, 다른 오류는 기존 「미리 보기를 계산하지 못했어요」를 유지한다. `'cancelled'`는 지금처럼 오류로 표시하지 않는다.
- `Simulate.svelte`: 기본 `marketData`를 `createMarketSource(...)`로 바꾸고, 검증 컨트롤러의 `makeWorker` 기본값을 「원본이 remote면 `makeRemoteWorker`, 아니면 지금 Worker」로 한다(컨트롤러는 첫 실행 때 만든다). 테스트가 넣는 `makeWorker`·`marketData`는 그대로 우선한다.
- `DataTools.svelte` 시장 데이터 영역: 「지금 쓰는 데이터: 이 기기 파일 / 맥(원격) / 없음」과 수집 날짜를 보인다. 이 기기 파일이 없을 때만 원격 요약을 읽는다.

## 5. 시험

- 프록시 `proxy/node/market.test.ts`(임시 폴더에 작은 gz 파일, `src/lib/screen/testData.ts`의 `mkFile` 사용): 토큰 틀림 401, 서버 토큰 미설정이면 `/market/meta`·`/market/screen` 404 `market-unavailable`, 허용 안 된 출처 403, 파일 없음 404, 깨진 파일 503, 가장 새 이름 고르기, 파일 교체(mtime·크기 변경) 뒤 다시 읽기와 같은 파일은 다시 안 읽기, `/market/meta` 모양, gzip 머리글, `/market/screen` preview 결과.
- `proxy/src/handler.test.ts`: 시장 처리기 없으면 `/market/meta` 404 `market-unavailable`.
- 웹 `remote.test.ts`: meta는 한 번만 요청, 토큰 머리글, 원격 Worker가 결과·오류를 넘김, terminate가 요청을 끊음. `source.test.ts`: local/remote/none/remote-error 고르기.
- 화면: 검증 실패와 미리 보기 모두 `'remote'` 오류에 「맥 데이터에 닿지 않아요」를 표시하는지 확인한다. 미리 보기의 다른 오류 문구와 취소를 표시하지 않는 동작도 유지하는지 확인한다.
- 프록시 파일 교체 시험에는 이름·gzip 크기·요약이 같고 주식수와 mtime만 다른 파일로 바꾼 뒤 `/market/screen` 결과가 새 파일을 따르는지도 넣는다. `run` 결과 하나도 확인한다.
- e2e(`tests/e2e/`, Playwright `page.route`로 `/market/meta`·`/market/screen`을 흉내 낸다): ① 로컬 파일 없이 프록시 주소·토큰만 설정한 상태에서 선정 기준 탭이 원격 요약을 보이고, 미리 보기와 검증 실행 결과가 표시된다(Simulate에 `marketData`·`makeWorker`를 주입하지 않아 기본 선택을 거친다). ② 로컬 파일을 가져온 상태에서는 `/market/*` 요청이 0건이다.
- `tests/proxy-auto-update.test.mjs`: 새로 감시하는 경로(`proxy/build.mjs`, `src/lib/screen/...`)가 바뀐 병합 뒤에도 설치가 다시 실행되는 경우를 더한다.
- 기존 시험·e2e는 프록시가 설정되지 않은 상태라 그대로 지나가야 한다.

## 6. 구현 순서

1. 프록시: `market.ts`(파일 읽기·경로·`importId`), `src/lib/screen/workerHandler.ts`(캐시 키에 `importId`), `handler.ts`(시장 처리기 주입·404), `server.ts`(본문 제한·`MARKET_DATA_DIR`), `build.mjs`·`package.json`·`tsconfig.json`·Dockerfile·compose·githook, 루트 `pnpm-lock.yaml`, 시험.
2. 웹: `remote.ts`, `source.ts`, `runValidation.ts`의 오류 코드, `screenText.ts`의 `FAILURE_TEXT`, `CriteriaEditor.svelte`·`PreviewPanel.svelte`의 미리 보기 오류 코드 전달·표시, `Simulate.svelte`, `DataTools.svelte`, `MarketDataNotice.svelte` 문구, 시험.
3. 문서: `proxy/README.md`(경로·`MARKET_DATA_DIR`·다시 시작), `docs/roadmap.md` 한 줄.
4. 검사: `pnpm --filter proxy test`, `pnpm --filter proxy build`, 루트 `pnpm test`, `pnpm test:scripts`, `pnpm check`, `pnpm build`, 관련 e2e. Docker 이미지 빌드(`docker build -f proxy/Dockerfile .`)는 이 기기에 Docker가 없으면 미확인으로 기록한다.

## 범위 밖

수집 스크립트, 주문 경로, sync-worker 저장, 시장 파일 공개 배포, Drive 전달 변경, 종목 단위 일봉 경로, 원격 진행률 표시, IndexedDB 원격 캐시.
