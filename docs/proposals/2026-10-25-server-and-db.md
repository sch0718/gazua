# 서버·DB 도입 검토

> 작성·공식 문서 확인: 2026-10-25 · 대상: sch0718/gazua v0.7.0, 현재 체크아웃 `00b86a7`

- GitHub Pages와 브라우저 저장을 유지하면서, **별도 Cloudflare Worker + D1에 작은 개인 데이터와 공유 스냅샷만 저장**하는 안을 추천해요.
- 처음에는 프로필·그룹·전략·선정 기준·바구니와 분석 설정만 일반 동기화하고, 증권사 키·프록시 토큰·주문 캐시·성과 이력은 제외해요.
- 개인 동기화는 Firebase Auth(Spark)의 Google 로그인 → `Authorization: Bearer` ID 토큰 → Worker 검증 → D1 자체 세션·사용자 매핑으로 보호해요. Firebase는 인증에만 쓰고 Firestore는 쓰지 않아요. 공유는 만료·철회가 가능한 읽기 전용 링크로 나눠요.
- DB는 D1을 쓰고 R2는 쓰지 않아요. 시장 파일은 기기마다 수동 가져오기를 유지하고, 본인 기기 간 자동 전달은 2단계에 선택 기능인 Google Drive `appDataFolder`로 붙여요. 무료 저장 공간·API 한도 안에서 결제 등록 없이 비공개로 보관해요. 대규모 정기 계산은 다음 단계로 미뤄요.
- DB만 붙이면 오프라인 충돌·보안·백업이 해결되지는 않아요. 버전 비교, 충돌 사본, 공유 전용 형식과 복구 경로를 함께 만들어요.

## 1. 현재 구조에서 확인한 것

이 절은 저장소 코드를 직접 읽어 확인했어요. 뒤의 추천 구조·용량 예산·구현 규모는 제안이며, 실제 사용자 데이터나 외부 계정 설정을 조회한 결과는 아니에요.

### 배포와 오프라인

[package.json](../../package.json)은 버전 `0.7.0`, Svelte 5, Vite와 `vite-plugin-pwa`를 사용해요. [vite.config.ts](../../vite.config.ts)는 `base: '/'`로 도메인 루트에 배포하고, 주석과 [README](../../README.md)는 서비스 주소를 `gazua.sch0718.dev`로 안내해요. 이 체크아웃에는 `public/CNAME` 파일이 없고, 실제 GitHub Pages 도메인 설정은 조회하지 않았어요. [.github/workflows/deploy.yml](../../.github/workflows/deploy.yml)은 `main` push·수동 실행·평일 KST 06:00에 빌드한 `dist/`를 GitHub Pages에 올려요. 예약 실행은 종목 유니버스를 갱신하는 정적 재배포이며, 개인 데이터를 다루는 앱 서버는 아니에요.

[pwa.config.ts](../../pwa.config.ts)는 앱 셸을 미리 저장하고, 글꼴은 `gazua-fonts`, 종목 유니버스는 `gazua-universe`, 도움말 그림은 `gazua-help` 캐시에 담아요. 외부 시세·프록시 요청에는 런타임 캐시 규칙이 없어요. 앱을 오프라인으로 여는 것과 최신 시세를 받는 것은 별개예요. [개발 문서](../development.md)에 적힌 것처럼 출처가 바뀌면 브라우저 저장소도 달라져요.

### localStorage: 프로필별 개인 데이터

[storage.ts](../../src/lib/state/storage.ts)는 모든 상대 키 앞에 `gazua:v1:`를 붙여 JSON을 저장해요. 저장소가 없거나 쓰기에 실패하면 메모리로 계속하고 문제를 기록해요. 이때의 변경은 영구 보관됐다고 볼 수 없어요.

| 실제 키 | 내용·범위 | 근거 |
|---|---|---|
| `gazua:v1:meta` | `schemaVersion: 1`, `activeProfileId`, 프로필 목록의 `id/name/createdAt` | [schema.ts](../../src/lib/state/schema.ts) |
| `gazua:v1:p:<id>:settings` | 공급자·프록시 URL·거래소·기간·지표·벤치마크·테마·색 규칙·정렬·성과 벤치마크·마지막 그룹·키 잠금·온보딩 여부 | [schema.ts](../../src/lib/state/schema.ts), [profileStore.ts](../../src/lib/state/profileStore.ts) |
| `gazua:v1:p:<id>:watchlists` | 그룹의 `id/name/items`, 종목 코드·색·숨김·추가 시각 | [schema.ts](../../src/lib/state/schema.ts) |
| `gazua:v1:p:<id>:strategies` | `{ strategies: [...] }` | [strategyStore.ts](../../src/lib/sim/strategyStore.ts) |
| `gazua:v1:p:<id>:criteria` | `{ criteria: [...] }` | [criteriaStore.ts](../../src/lib/screen/criteriaStore.ts) |
| `gazua:v1:p:<id>:baskets` | `{ baskets: [...] }` | [baskets.ts](../../src/lib/screen/baskets.ts) |
| `gazua:v1:p:<id>:recent` | 최근 추가한 종목, 최대 5개 | [profileStore.ts](../../src/lib/state/profileStore.ts) |
| `gazua:v1:p:<id>:secrets` | KIS 앱 키·시크릿, 토스 client ID·secret, 프록시 토큰. 잠금 여부에 따라 평문 또는 암호문 | [secrets.ts](../../src/lib/state/secrets.ts) |
| `gazua:v1:p:<id>:token:kis`, `…:token:toss` | 접근 토큰과 만료 시각. 잠금 모드에서는 메모리에만 있어요 | [profileStore.ts](../../src/lib/state/profileStore.ts), [app.svelte.ts](../../src/lib/state/app.svelte.ts) |
| `gazua:v1:p:<id>:tokenIssuedAt:kis` | 마지막 KIS 토큰 발급 시각. 잠금 모드에서도 남겨요 | [profileStore.ts](../../src/lib/state/profileStore.ts) |
| `gazua:help-seen:v1` | 처음 안내를 본 메뉴 ID 배열. 프로필과 무관한 기기 기록이에요 | [seen.ts](../../src/lib/help/seen.ts) |

프로필은 로그인 계정이 아니라 이 브라우저 안의 데이터 구획이에요. `meta`의 스키마 버전과 키 접두어는 1이고, 프로필별 객체 모두에 별도 버전 필드가 있는 구조는 아니에요. 한 그룹은 최대 10종목([watchlist.ts](../../src/lib/state/watchlist.ts)), 전략·선정 기준은 각각 최대 20개([전략 기본값](../../src/lib/sim/defaults.ts), [선정 기준 기본값](../../src/lib/screen/defaults.ts)), 바구니는 최대 30개·각 300종목이에요([baskets.ts](../../src/lib/screen/baskets.ts)).

### IndexedDB와 메모리 캐시

| DB 이름 / 스키마 버전 | object store / 키 | 저장 내용·범위 |
|---|---|---|
| `gazua-market-data` / 1 | `files` / `current`, `current-info`, `current-sectors`, `current-themes`, `current-theme-symbols` | 가져온 시장 데이터 본문 하나와 요약·업종·테마 요약·테마별 종목이에요. 프로필 공통이에요. [store.ts](../../src/lib/marketData/store.ts) |
| `gazua-account` / 1 | `orders`, `keyPath: 'key'` / `<profileId>\|<providerId>\|<accountId>` | 정규화한 주문 배열, `syncedAt`, KST 날짜 `syncedThrough`예요. 마지막 날짜의 7일 전부터 다시 받아 주문 ID로 합쳐요. [orderCache.ts](../../src/lib/perf/orderCache.ts) |
| `gazua-cache` / 1 | `candles`, `keyPath: 'key'` / 공급자·종목·봉 종류·날짜 등을 조합 | 종목 분봉·지수 봉과 만료·최근 사용 시각·크기예요. 종목 단위로 오래 안 쓴 항목을 지워요. [candleCache.ts](../../src/lib/data/candleCache.ts), [candleService.ts](../../src/lib/data/candleService.ts) |

시장 데이터 **파일 형식 버전 1~4**와 IndexedDB **스키마 버전 1**은 달라요. [format.ts](../../src/lib/marketData/format.ts)가 지원하는 파일을 검사하고, 가져올 때 본문과 요약을 한 트랜잭션으로 바꿔요. 압축을 푼 크기의 1.2배를 기준으로 저장 공간을 점검하고 영구 저장 권한도 요청해요. 압축 파일 자체를 그대로 보관하는 방식은 아니에요.

종목 수정주가 일봉은 [candleService.ts](../../src/lib/data/candleService.ts)의 `createDailyMemo()`가 메모리에만 둬요. 검증용 데이터·미리 계산 결과도 [workerHandler.ts](../../src/lib/screen/workerHandler.ts)의 메모리 캐시예요. [app.svelte.ts](../../src/lib/state/app.svelte.ts)는 키 잠금 시 주문 캐시를 메모리로 전환하고 기존 프로필 주문 캐시를 지워요. 키 삭제·프로필 삭제 때도 주문 캐시를 정리해요. 잠금은 계좌 캐시를 암호화해 IndexedDB에 보관하는 기능이 아니에요.

### JSON 내보내기·가져오기

[exportImport.ts](../../src/lib/state/exportImport.ts)의 형식은 `format: 'gazua-export'`, `schemaVersion: 1`이에요.

- **포함:** 선택한 프로필 하나의 이름, 설정, 관심그룹, 최근 종목, 전략, 선정 기준, 바구니예요. 키는 기본 제외이고, 사용자가 포함을 고르면 저장된 형태를 복사해요. 잠금 전이면 평문, 잠금 후면 암호문이에요. 프록시 토큰도 `secrets`에 포함될 수 있어요.
- **제외:** 전체 프로필 색인·기존 프로필 ID·생성 시각·활성 프로필 선택, 접근 토큰·발급 시각, 시장 데이터, 주문 캐시, 봉 캐시, 도움말 본 기록이에요. 시뮬레이션·검증·내 성과의 계산 결과 이력을 저장하는 필드도 없어요.
- **가져오기:** 내용을 검증하고 새 UUID를 가진 `이름 (가져옴)` 프로필을 추가해요. 현재 프로필을 바꾸거나 두 기기의 변경을 병합하지 않아요. [DataTools.svelte](../../src/lib/ui/settings/DataTools.svelte)의 JSON 가져오기 한도는 1 MiB이고, 키 포함 체크의 기본값은 `false`예요.

따라서 기존 내보내기는 수동 이전·백업의 출발점이지만, 동기화 프로토콜이나 안전한 공개 공유 형식으로 그대로 쓰기에는 부족해요. `includeSecrets: false`여도 프로필 이름·프록시 URL·최근 종목·전략의 자금 값 등이 남을 수 있어요.

### 증권사 프록시와 키 잠금

[providers.md](../providers.md), [proxy/README.md](../../proxy/README.md)와 구현을 함께 확인했어요. [worker.ts](../../proxy/src/worker.ts)는 Cloudflare Worker 진입점이고, [Node 서버](../../proxy/node/server.ts)는 같은 [handler.ts](../../proxy/src/handler.ts)를 호출해요. 맥에서는 Node 프록시 `localhost:8787`을 Cloudflare Tunnel에 연결하고 LaunchAgent로 실행할 수 있어요. 저장소 문서는 KIS `:9443`의 Worker 연결 가능 여부를 아직 미확인으로 남겨요. 맥이 잠자거나 꺼지면 맥 프록시도 응답하지 않아요.

[allowlist.ts](../../proxy/src/allowlist.ts)는 **공급자·정확한 경로 또는 제한된 정규식·HTTP 메서드**를 함께 검사해요. KIS는 토큰 발급 POST와 명시된 7개 시세 GET만 허용해요. 토스는 토큰 발급 POST, 시세·봉·종목·달력·지수·섹터 조회와 예외로 승인된 계좌 목록·보유 주식·`GET /api/v1/orders`를 허용해요. 같은 주문 경로의 POST, 주문 상세·정정·취소·조건주문·매수가능금액 등은 계속 `403 proxy-path-blocked`예요.

`handler.ts`는 출처를 정확히 대조하고, 설정돼 있으면 `X-Proxy-Token`도 검사해요. CORS는 사용자 인증을 대신하지 않아요. Node 서버는 본문 16 KiB, 상류 대기 15초로 제한하고 로그에는 메서드·경로·상태·시간만 남겨요. 헤더·본문·쿼리는 기록하지 않아요.

[secrets.ts](../../src/lib/state/secrets.ts)의 실제 잠금 값은 **PBKDF2-SHA256 310,000회, 무작위 salt 16바이트, AES-GCM 256비트, 무작위 IV 12바이트**예요. 저장 형태는 base64 `enc/iv/salt`와 `kdf/iter`예요. 로그인 기능이나 기기 간 E2EE 키 배포·복구 기능은 없어요. 토스는 키마다 유효한 토큰이 하나라는 제약도 있어, 설정 동기화가 곧 같은 키의 다중 기기 사용을 안전하게 만들어 주지는 않아요([providers.md](../providers.md)).

## 2. 무엇을 동기화할까요

크기는 실제 개인 데이터 측정값이 아니라 초기 설계를 위한 추정이에요. 직렬화한 UTF-8 바이트를 구현 전에 재야 해요. 시장 데이터의 압축 후 수십 MB도 [development.md](../development.md)에 적힌 추정이며, 풀린 데이터는 더 커져요.

| 종류 | 대략의 크기 | 민감도 | 동기화 가치 | 추천 처리 |
|---|---|---|---|---|
| 그룹·프로필 이름·색인 | 프로필당 수 KB~수십 KB, 그룹 수에 따라 증가 | 중간: 투자 관심사·이름 | 높음 | **동기화**. 프로필 ID는 기기 간 유지하고 계정 소유권을 따로 붙여요 |
| 설정 | 프로필당 수 KB | 낮음~중간: 프록시 주소 포함 | 높음 | **분석 설정의 허용 필드만 동기화**. 기간·지표·벤치마크·색 규칙·정렬을 허용해요. `proxyUrl/provider/keyLock/onboarded/lastGroupId`와 활성 프로필·기기 테마는 우선 로컬에 둬요 |
| 전략·선정 기준·바구니 | 합계 수십~수백 KB를 예산으로 잡아요 | 중간~높음: 투자 방법·가상 자금 | 매우 높음 | **1단계는 일반 동기화(사용자 결정, 2026-10-25)**. D1에 평문 JSON으로 저장해 Cloudflare 계정 주인과 Cloudflare가 내용을 볼 수 있어요. 처음부터 E2EE는 하지 않아요 |
| 시장 데이터 파일 | gzip 수십 MB 추정, 압축 해제 후 증가 | 계좌 정보는 없지만 재배포 조건 확인 필요 | 원본 통일보다는 재다운로드 가치가 높음 | D1의 개인 데이터 동기화에서는 **제외**. 2단계 전까지 수동 가져오기를 유지하고, 2단계에 선택 기능인 Drive `appDataFolder`로 본인 기기끼리 나눠요 |
| 토스 주문 캐시 | 거래량에 따라 수십 KB~수 MB 이상 | 높음: 계좌 식별자·주문·금액·보유 추론 | 기기 간 성과 계산에 도움 | 1단계 **동기화 안 함**. 이후에도 사용자가 이 항목의 **E2EE 동기화**를 직접 켠 경우에만 서버에 보관해요 |
| 증권사 키·프록시 토큰 | 수 KB, 암호화하면 조금 증가 | 매우 높음: 토스 키는 주문 권한 | 편리하지만 피해가 큼 | 1단계 **동기화 안 함**. 이후에도 사용자가 항목별로 **E2EE 동기화**를 직접 켠 경우에만 서버에 보관해요 |
| 접근 토큰·마지막 발급 시각 | 수 KB / 숫자 하나 | 토큰은 매우 높음, 시각은 낮음 | 낮음, 기기별 갱신 동작과 결합 | **동기화 안 함**. 증권사 토큰과 앱 로그인 세션도 구분해요 |
| 최근 추가 종목 | 수백 B~수 KB | 중간: 사용 흔적 | 낮음 | 우선 **동기화 안 함**. 원하면 후속 선택 옵션으로 둬요 |
| 도움말 본 기록 | 수백 B~수 KB | 낮음 | 낮음 | **동기화 안 함**. 새 기기의 안내는 다시 보여 줘요 |
| 분봉·지수 봉 캐시 | 사용량에 따라 수 MB 이상 | 낮음, 데이터 이용 조건은 별도 | 낮음: 재생성 가능 | **동기화 안 함**. 기기 캐시로 둬요 |
| 앱 셸·글꼴·유니버스·도움말 Cache Storage | 배포·열람량에 따라 수 MB 이상 | 낮음 | 없음 | **동기화 안 함**. PWA가 다시 받아요 |
| 일봉 메모·검증 중간 계산·화면 결과 | 메모리에서 계산량에 따라 증가 | 성과 결과는 높을 수 있음 | 중간 결과는 낮음 | **동기화 안 함**. 저장할 결과 요약은 별도 형식을 새로 만들어요 |

현재 개인 프로필을 하나의 안전한 문서로 묶되 **문서당 256 KiB**를 초기 앱 한도로 제안해요. 넘으면 조용히 자르지 않고 알려 줘요. 키나 계좌 캐시를 이 문서에 끼워 넣는 예외는 두지 않아요.

## 3. 무료 선택지 비교

아래 가격은 USD이고, 모두 **2026-10-25 공식 문서 확인** 기준이에요. 무료 플랜과 유료 플랜 안의 무료 사용량은 구분해요. 기존 도메인·맥·전기·인터넷 비용과 개발·운영 시간까지 없어진다는 뜻은 아니에요. 현재 Cloudflare 계정의 남은 할당량·결제 설정은 확인하지 않았어요.

### Cloudflare: 기존 경험을 활용하는 선택

| 구성 | 무료 한도·주요 조건 | 인증·오프라인 | 운영 부담·종속성 | 출처·확인일 |
|---|---|---|---|---|
| Workers Free | 하루 100,000요청, 실행당 CPU 10 ms, 메모리 128 MB, 요청당 subrequest 50개. Cron은 계정당 5개, 무료 Cron도 CPU 10 ms예요 | 최종 사용자 인증은 별도예요. 로컬 큐·재전송을 직접 만들어요 | 낮음~중간. 기존 프록시와 계정 할당량을 공유하므로 별도 Worker여도 완전히 분리된 예산은 아니에요. 런타임 API에 종속돼요 | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) · 2026-10-25 |
| D1 Free | 하루 읽기 500만 행·쓰기 10만 행, 계정 합계 5 GB. **DB 하나는 500 MB, 계정당 10개**, Time Travel 7일이에요. 한도 초과 시 무료 사용이 제한돼요 | Worker에서 소유권을 검사해요. 브라우저에 관리 자격 증명을 주지 않아요. 오프라인 기능은 별도예요 | SQLite 계열 SQL은 옮기기 쉽지만 binding·마이그레이션·복구 API는 Cloudflare에 묶여요 | [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [limits](https://developers.cloudflare.com/d1/platform/limits/) · 2026-10-25 |
| KV Free | 저장 1 GB, 하루 읽기 100,000개, 쓰기·삭제·목록 조회 **각 1,000개**예요 | Worker 인증이 필요해요. eventual consistency여서 기기 간 동시 저장·즉시 철회의 원장으로 부적합해요 | 설정·공통 캐시에 간단해요. 버전 비교 트랜잭션용으로는 D1을 권해요. KV API 종속성은 중간이에요 | [KV pricing](https://developers.cloudflare.com/kv/platform/pricing/), [consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/) · 2026-10-25 |
| R2 Standard 무료 사용량 | 매월 10 GB-month, Class A 100만 회·B 1,000만 회, 직접 egress 무료예요. Infrequent Access에는 이 무료량이 적용되지 않아요. **R2 구독·checkout이 필요하고 초과분은 과금돼요** | Worker를 통한 접근 권한 검사 또는 제한된 다운로드 권한을 써요. 파일을 내려받은 뒤 로컬에서 써요 | 큰 파일에 적합하고 S3 호환으로 이전도 비교적 쉬워요. 무과금 하드캡으로 보장되는 플랜은 아니에요 | [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [시작 조건](https://developers.cloudflare.com/r2/get-started/) · 2026-10-25 |
| Durable Objects Free | **SQLite backend만** 가능해요. 하루 100,000요청·13,000 GB-s, SQL 읽기 500만 행·쓰기 10만 행, 저장 합계 5 GB예요 | Worker 인증과 로컬 저장은 별도예요. 공동 편집 조정·WebSocket 방에 쓸 수 있어요 | 객체 수명·hibernation·배포를 관리해야 해요. API 종속성이 높아 지금은 추가하지 않아요 | [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) · 2026-10-25 |

R2는 비교 자료로만 남기며 **추천안에서는 쓰지 않아요(사용자 결정, 2026-10-25)**.

**같은 Cloudflare 계정의 앱은 할당량을 함께 써요.** 다른 앱인 랜드마크도 같은 계정의 Workers·D1을 쓰면 Workers 하루 100,000요청, D1 하루 읽기 500만 행·쓰기 10만 행, D1 계정 합계 5 GB·DB 10개, Cron 5개를 함께 써요. 기존 증권사 프록시 Worker도 같은 계정의 Workers 할당량을 쓰므로 앱별 요청·DB 사용량·Cron 예산을 나눠 둬요([Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), 2026-10-25 확인).

Workers·D1·KV·DO의 위 공식 가격·한도 문서에서는 주간 비활성 pause 조건을 확인하지 못했어요. 이를 영구 보존·무중단 보장으로 해석하지 않고, 장기 비활성 계정 처리의 별도 조건은 **확인 필요**로 남겨요. R2의 실제 결제 수단 등록 조건도 계정에서 확인해야 해요. 이번 검토에서는 가입·구독·checkout을 하지 않아요.

### 관리형 DB와 맥 자체 호스팅

| 선택지 | 무료 가격·한도 / 비활성 조건 | 인증 방법 | 웹 PWA 오프라인 | 운영 부담·종속성 / 판단 | 출처·확인일 |
|---|---|---|---|---|---|
| Firebase Spark / Firestore Standard | $0, 결제 수단 불필요. 무료 DB 하나/프로젝트, 저장 1 GiB, 하루 문서 읽기 50,000·쓰기 20,000·삭제 20,000, 월 egress 10 GiB예요. 정기 비활성 pause는 인용 문서에서 확인하지 못했어요 | Firebase Auth Google/GitHub·이메일 등 + Security Rules예요. Identity Platform 사용 시 일반 MAU 무료량 50,000을 가격표에서 확인했어요 | 웹 SDK의 영구 로컬 캐시는 **기본 꺼짐**이며 켜야 해요. 같은 문서 변경은 last-write-wins예요 | 오프라인 구현 부담은 낮아지지만 문서 모델·Rules·SDK 종속성이 높아요. 시장 파일 보관·서버 배치는 Spark만으로 해결하기 어려워요 | [가격](https://firebase.google.com/pricing), [Firestore 한도](https://firebase.google.com/docs/firestore/quotas), [오프라인](https://firebase.google.com/docs/firestore/manage-data/enable-offline) · 2026-10-25 |
| Turso Free | $0, 카드 불필요, DB 100개, 저장 5 GB, 월 읽기 5억 행·쓰기 1,000만 행, sync 3 GB예요. 비활성 archive/pause의 현재 일수·해제 방법은 **확인 필요**예요 | DB 토큰·JWKS 연계가 가능하지만 앱 사용자 로그인과 소유권 정책은 별도 설계해요 | 서버·네이티브의 embedded replica가 웹 PWA의 IndexedDB 동기화를 자동 제공한다고 가정하지 않아요. 브라우저용 경로는 별도 검증해요 | SQL 계열이라 데이터 이전은 비교적 쉬워요. 인증 API·sync 구현이 추가되므로 지금 D1을 대체할 이점은 작아요 | [가격](https://turso.tech/pricing), [SDK 인증](https://docs.turso.tech/sdk/authentication), [unarchive 문서](https://docs.turso.tech/cli/group/unarchive) · 2026-10-25 |
| Neon Free | $0, 카드 불필요. 프로젝트 100개, 프로젝트당 월 100 CU-hours·Postgres 1 GB·egress 5 GB, 계정 저장 합계 20 GB예요. **5분 idle 후 scale-to-zero**이고 다음 연결 때 자동 기동해요 | 관리형 Neon Auth도 제공해요. 공식 표는 최대 60,000 MAU예요. SQL 직접 연결 자격 증명을 PWA에 넣지 않고 Auth/API·권한을 구성해요 | 일반 Postgres만으로 오프라인 복제가 생기지 않아요 | Postgres 이전은 쉬운 편이에요. compute 재기동·API·권한·클라이언트 동기화를 다뤄야 해요. 초기 개인용에는 구성 요소가 늘어요 | [가격](https://neon.com/pricing), [플랜 상세](https://neon.com/docs/introduction/plans), [scale-to-zero](https://neon.com/docs/introduction/scale-to-zero) · 2026-10-25 |
| PocketBase + 사용자 맥 + 기존 Tunnel | 소프트웨어는 무료 자체 호스팅이에요. 관리형 무료 저장량이 아니라 맥의 디스크·메모리·회선이 한도예요. 전기·장비 비용은 남아요. **맥 종료·잠자기·회선 단절 동안 동기화·공유·배치 모두 중단**돼요 | 일반 사용자 OAuth2·비밀번호·이메일 OTP 등과 collection API rules를 써요. 관리자 권한은 앱에 주지 않아요 | 로컬 복사본과 outbox를 직접 만들어요. 서버가 꺼져도 기존 로컬 작업은 가능하게 해요 | 실행 파일 하나·SQLite라 시작은 간단해요. 업데이트·권한·백업·복구·가동 시간은 본인 책임이에요. DB는 옮길 수 있지만 API·규칙·hooks는 PocketBase에 묶여요 | [공식 소개](https://pocketbase.io/docs/), [운영·백업](https://pocketbase.io/docs/going-to-production/), [인증](https://pocketbase.io/docs/authentication/) · 2026-10-25 |

Supabase는 사용자 결정으로 후보에서 제외했어요(2026-10-25).

Firebase는 **2026-02-03부터 Cloud Storage 접근 유지에도 Blaze가 필요**해요. Spark의 무료 Firestore와 Storage의 유료 플랜 내 무료량을 섞으면 안 돼요. Cloud Functions도 Spark 가격표에는 제공되지 않아요. 공유 만료는 Firestore Rules에서 서버 요청 시각으로 검사할 수 있지만, TTL 자동 삭제·PITR·관리형 백업에는 결제 활성화가 필요해요. [Storage 변경 안내](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024), [가격](https://firebase.google.com/pricing), [Firestore 무료 제외 기능](https://firebase.google.com/docs/firestore/quotas)에서 확인했어요(2026-10-25).

PocketBase를 고른다면 별도 포트 `127.0.0.1:8090`에 묶고 기존 Tunnel에 DB 전용 호스트를 추가하는 안이에요. 증권사 프록시의 포트·라우팅·허용 목록과 분리해요. 자동 시작, 정확한 앱 출처 CORS, 사용자별 API rules, rate limit, 관리자 접근 제한, 일관된 `pb_data` 백업과 복구 점검을 준비해야 해요. 공식 [소개 문서](https://pocketbase.io/docs/)는 v1 이전의 완전한 하위 호환을 보장하지 않고 중요 운영 용도에는 수동 마이그레이션 부담을 경고해요(2026-10-25). 맥 하나에 원본과 유일한 백업을 함께 두지는 않아요. 이는 도입 시 할 일이며 이번 작업에서 실행하지 않아요.

### 자체 앱 서버 없이 파일 서비스로 동기화하기

여기서 서버 없다는 말은 **직접 운영하는 앱 서버가 없다**는 뜻이에요. 저장 서비스 서버·OAuth 등록·권한 관리와 충돌 처리까지 없어지지는 않아요.

| 방법 | 무료 조건·한도 | 웹 PWA에서 실제 가능한 범위 / 인증·오프라인 | 운영·종속성 / 판단 | 출처·확인일 |
|---|---|---|---|---|
| Google Drive `appDataFolder` | 일반 Google 계정은 Drive·Gmail·Photos 합계 15 GB예요. API 표준 사용은 추가 비용 없이 가능해요. 현 한도는 분당 프로젝트 1,000,000·사용자/프로젝트 325,000 quota units, 일일 프로젝트 egress 1 TB, 일일 billing threshold 400,000,000 units예요. 메서드마다 단위가 달라요 | Google Identity Services의 브라우저 토큰 모델과 `drive.appdata` 범위로 가능해요. 짧은 수명의 토큰 재취득에 사용자 동작이 필요할 수 있어요. 로컬 사본·재시도·충돌 처리는 직접 만들어요 | 본인 기기 동기화·백업 대안이에요. **appDataFolder 안 파일은 공유할 수 없어** 만료 공유는 다른 저장소/API가 필요해요. OAuth와 Drive 형식에 종속돼요 | [appDataFolder](https://developers.google.com/workspace/drive/api/guides/appdata), [브라우저 인증](https://developers.google.com/identity/oauth2/web/guides/use-token-model), [API 한도·가격](https://developers.google.com/workspace/drive/api/guides/limits), [15 GB](https://support.google.com/drive/answer/6374270) · 2026-10-25 |
| GitHub Gist | 일반 인증 REST 기본 5,000요청/시간, 미인증 60요청/시간이며 secondary limit도 있어요. Gist 저장 용량의 명시적 무료 보장값은 **확인 필요**예요 | 인증한 REST로 JSON 갱신은 가능하지만, 안전한 로그인 구현이 필요해요. OAuth code 교환의 client secret을 정적 앱에 둘 수 없고 해당 토큰 교환은 CORS 제약도 있어요. 오프라인 큐는 별도예요 | **secret Gist는 비공개가 아니에요.** 링크를 알면 읽을 수 있고 버전·복제본에 내용이 남아요. 개인정보·만료 공유용으로 권하지 않아요 | [Gist 공개 범위](https://docs.github.com/en/get-started/writing-on-github/editing-and-sharing-content-with-gists/creating-gists), [REST 한도](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api), [OAuth 흐름](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps) · 2026-10-25 |
| GitHub 비공개 저장소 | GitHub Free는 비공개 저장소를 제공해요. REST 인증 기본 5,000요청/시간이에요. 파일·저장소 크기는 별도 제한이 있어 무제한 데이터 저장으로 보지 않아요 | REST로 파일을 읽고 갱신하며 이전 SHA로 충돌을 감지할 수 있어요. GitHub App/OAuth 중계가 필요할 수 있어요. PAT를 공유 배포본에 넣는 방식은 피하고, 로컬 캐시를 따로 둬요 | JSON 백업은 가능하지만 저장할 때마다 커밋·히스토리가 생겨 개인 DB처럼 쓰기 불편해요. 만료·철회 가능한 공개 읽기 API도 별도예요 | [GitHub Free](https://docs.github.com/en/get-started/learning-about-github/githubs-plans), [Contents API](https://docs.github.com/en/rest/repos/contents), [REST 한도](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) · 2026-10-25 |
| WebDAV | 프로토콜 자체의 무료 저장량은 없어요. 기존 NAS·Nextcloud·제공자의 비용·쿼터를 따라요. 이 사용자의 제공자·무료량은 **확인 필요**예요 | HTTPS, 앱 출처의 CORS와 OPTIONS·PUT·PROPFIND 등 허용이 맞으면 브라우저에서 가능해요. Basic/app password를 쓰는 서버도 있어 자격 증명 취급이 필요해요. ETag/조건부 갱신·로컬 큐는 구현해야 해요 | 기존 서버가 있으면 대안이에요. CORS가 막힌 서비스를 범용 증권사 프록시로 우회하지 않아요. 프로토콜 종속성은 낮고 운영 부담은 제공자에 따라 달라요 | [Nextcloud WebDAV](https://docs.nextcloud.com/server/latest/developer_manual/client_apis/WebDAV/basic.html), [공식 webdav-client CORS 설명](https://github.com/perry-mitchell/webdav-client/blob/master/README.md) · 2026-10-25 |
| iCloud Drive / CloudKit JS | 일반 iCloud 무료 공간은 5 GB지만 웹 앱의 임의 파일 접근 권한은 아니에요. CloudKit 개발에는 활성 Apple Developer Program 등 별도 준비가 필요해요. CloudKit의 현 무료 서비스 쿼터·개발자 비용은 **확인 필요**예요 | 웹 PWA가 iCloud Drive 폴더를 백그라운드로 마음대로 동기화하는 공식 일반 API는 확인하지 못했어요. 파일 선택으로 JSON을 수동 가져오기·저장하기는 가능해요. CloudKit JS는 웹에서 가능하지만 **기존 CloudKit 앱·컨테이너·웹 서비스 설정**을 요구하고 Drive와 다른 제품이에요 | 순수 정적 PWA에 가장 작은 무료 해법으로 보기 어려워요. Apple 로그인·스키마·컨테이너·SDK에 강하게 묶여요. 현재 CSP의 외부 스크립트 제한도 검토해야 해요 | [iCloud 공간](https://support.apple.com/en-us/108922), [CloudKit JS](https://developer.apple.com/documentation/cloudkitjs), [CloudKit 준비](https://developer.apple.com/documentation/cloudkit/enabling-cloudkit-in-your-app) · 2026-10-25 |

Drive는 오래 알려진 요청 횟수만 옮겨 적지 않고 현재 공식 문서의 quota-unit 표를 사용했어요. 문서는 2026년 중 초과 사용 과금 계획도 예고해요. 실제 프로젝트에 적용되는 쿼터와 시행 시점은 도입 때 다시 확인해야 해요. 파일 서비스들의 장기 비활성 보존 조건은 서비스 계정 정책도 따르며, 이 비교로 영구 보존을 보장하지 않아요.

### 시장 파일을 git·GitHub Pages·Release로 대신하기 어려운 이유

이 저장소는 공개 저장소예요. 시장 파일은 [collect-market-data.mjs](../../scripts/collect-market-data.mjs)가 KIS API로 받은 시세·재무·매매동향을 담으므로, 공개 배포가 KIS 데이터 재배포 약관에 걸릴 수 있어요. **KIS 약관은 확인하지 않았으므로 확인 필요**예요. 아래 용량 조건을 충족하더라도 KIS 약관 확인 후 공개 배포 여부는 **미정(보류)**이에요.

- **git 커밋:** GitHub는 파일이 50 MiB를 넘으면 경고하고 100 MiB를 넘으면 차단해요. 저장소는 1 GB 미만을 권장하고 5 GB 미만을 강력히 권장해요([대용량 파일 공식 문서](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github), 2026-10-25 확인). 수십 MB로 추정한 gzip 파일을 갱신마다 커밋하면 히스토리에 수십 MB짜리 버전이 계속 쌓여요. 현재 공개 저장소에 커밋한 파일은 본인 기기만 읽는 비공개 보관이 아니에요.
- **GitHub Pages:** 게시한 사이트는 1 GB 이하여야 하고 월 대역폭은 100 GB의 느슨한 한도(soft limit)가 있어요([Pages 한도](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits), 2026-10-25 확인). 공식 문서는 원본 저장소가 비공개여도 Pages 사이트는 인터넷에 공개된다고 안내해요([Pages 공개 범위 안내](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https), 2026-10-25 확인). 시장 파일을 사이트에 넣으면 함께 공개돼요.
- **GitHub Release:** 첨부 파일의 총용량·배포 대역폭 제한은 없어요. 다만 저장소 읽기 권한이 있으면 Release를 볼 수 있고, 공개 저장소는 누구나 접근할 수 있으므로 이 저장소의 Release 첨부도 공개돼요([Release 공식 문서](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases), [저장소 공개 범위](https://docs.github.com/en/repositories/creating-and-managing-repositories/about-repositories), 2026-10-25 확인). [첨부 파일 API 문서](https://docs.github.com/en/rest/releases/assets)는 브라우저용 다운로드 URL을 안내하지만, 다른 출처인 이 앱의 브라우저 `fetch`에서 첨부 본문을 읽는 CORS 지원 보장은 확인하지 못했으므로 **확인 필요**로 남겨요(2026-10-25 확인).

### CRDT·로컬 우선 라이브러리가 필요할까요

| 도구 | 해결하는 문제 | 무료·추가 부담 | 이 앱에서의 판단 / 공식 출처·확인일 |
|---|---|---|---|
| Automerge | 여러 기기의 오프라인 변경과 객체·목록 변경을 병합해요 | 라이브러리와 별개로 저장·전송·인증·복구 경로가 필요해요. 히스토리와 데이터 모델 전환 비용도 있어요 | 실제 공동 편집이 잦아질 때 검토해요. 1명 중심의 작은 문서에 우선 도입할 필요는 작아요. [공식 문서](https://automerge.org/docs/hello/) · 2026-10-25 |
| Yjs | 공유 자료형·실시간 공동 편집을 제공해요 | 저장 provider·전송 provider와 권한을 따로 붙여요. 무료 라이브러리가 무료 호스팅 보장은 아니에요 | 그룹 목록을 자주 함께 편집할 때 후보예요. 단순 읽기 공유에 넣지는 않아요. [공식 문서](https://docs.yjs.dev/) · 2026-10-25 |
| RxDB | 브라우저 로컬 DB, push/pull·체크포인트·충돌 처리·다중 탭 복제를 제공해요 | 오픈소스 core·기본 Dexie 저장·replication은 무료예요. 공식 Free 표는 동시 open collection 13개이고, 일부 저장·WebCrypto 암호화 플러그인은 유료예요 | 저장 계층을 넓게 교체할 때 이점이 있어요. 지금 localStorage+idb를 옮기는 비용이 먼저 생겨요. [복제](https://rxdb.info/replication.html), [무료/유료 구분](https://rxdb.info/premium/) · 2026-10-25 |
| ElectricSQL / Electric Sync | Postgres에서 클라이언트로 읽기 경로를 HTTP Shape로 동기화해요 | 쓰기는 별도 API·권한·충돌 정책이 필요해요. Cloud는 쓰기 100만 건당 $1·보존 GB-month당 $0.10, 월 $5 미만 청구 면제인 PAYG예요. DB 비용은 별도예요 | D1에 바로 붙이는 범용 양방향 CRDT가 아니에요. Postgres 중심으로 커질 때 다시 비교해요. [현재 공식 문서](https://electric.ax/docs/sync/), [가격](https://electric.ax/pricing) · 2026-10-25 |

**1단계는 라이브러리 도입 없이 서버 리비전 비교와 충돌 사본으로 충분하다고 판단해요.** 그룹 순서·삭제·전략 참조를 어떻게 병합할지는 CRDT를 골라도 앱이 결정해야 해요. 계좌·키 E2EE와 공개 공유 권한도 이 라이브러리들이 자동으로 해결하지 않아요.

## 4. 인증은 무엇이 맞을까요

| 방식 | 개인용 앱의 장점 | 추가 일·제약 | 판단 |
|---|---|---|---|
| 이메일 매직링크 | 비밀번호를 관리하지 않아도 돼요 | 메일 발송·스팸·재시도·링크 만료·redirect 검증이 필요해요. | 첫 선택에서 제외해요 |
| Firebase Auth(Spark) + Google | 결제 정보 없이 기존 Google 계정으로 신원을 확인할 수 있어요. DB는 D1을 유지해요 | Worker의 ID 토큰 검증·허용 목록·D1 자체 세션·사용자 매핑이 필요해요. Firebase Auth 가입 자체를 본인만으로 제한하는 구성은 아니에요 | **소유자 로그인으로 추천해요(사용자 결정, 2026-10-25)** |
| Google Identity Services 직접 연동(OAuth/OIDC) | Firebase Auth 없이 기존 Google 계정으로 로그인할 수 있어요 | 토큰 검증·자체 세션·권한 처리가 필요해요. [공식 설정 문서](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid)에서 OAuth 클라이언트 생성에 결제 계정이 필요 없다는 명시적 근거는 찾지 못해 **확인 필요**예요(2026-10-25) | 직접 연동 대안으로 남겨요 |
| GitHub OAuth | 개발자가 쓰기 편하고 기존 GitHub 계정을 활용해요 | 비개발자 공유에는 진입 장벽이 있어요. code 교환은 안전한 서버 중계가 필요할 수 있어요 | 본인이 선호하면 Google 대신 선택해요 |
| Cloudflare Access | Google 같은 IdP 앞에서 이메일 허용 목록으로 개인 API를 잠글 수 있어요. Free는 사용자 50명까지예요 | [조직 생성 공식 문서](https://developers.cloudflare.com/learning-paths/clientless-access/initial-setup/create-zero-trust-org/)에 따르면 **Free도 결제 정보 입력이 필요**해요. Free에서는 청구하지 않아요(2026-10-25 확인) | **결제 등록 없는 무료 원칙에 맞지 않아 추천에서 제외해요(사용자 결정, 2026-10-25)** |
| 패스키 | 생체 인증 등으로 로그인하고 앱이 비밀번호를 보관하지 않아요 | 서버 challenge·공개키 검증·RP ID·복구·새 기기 등록을 설계해야 해요. E2EE 복호화 키가 자동으로 생기는 것은 아니에요 | 첫 단계에서는 보류해요 |
| 계정 없는 동기화 비밀 키 + QR 기기 연결 | 외부 로그인 계정 없이 본인 기기를 연결하는 대안이에요 | 비밀 키 생성·안전한 기기 전달·분실 복구·기기 철회를 설계해야 해요. QR에 담긴 비밀이 유출되면 접근 권한도 유출돼요 | 복구·기기 관리 방식을 정한 뒤 검토해요 |

선택은 **Workers + D1 + Firebase Auth(Spark, 인증만)**이에요. Firebase Auth는 Google 신원 확인에만 쓰고, 개인 동기화 Worker가 Firebase ID 토큰을 검증한 뒤 D1에 자체 세션·사용자 매핑을 둬요. **Firestore는 쓰지 않아요(사용자 결정, 2026-10-25)**. Spark는 결제 정보 없이 시작할 수 있고, 공식 정책상 무료 한도를 넘으면 과금 대신 해당 제품 사용이 그달 남은 기간 중단돼요. 결제 계정을 연결하거나 Blaze로 전환하지 않아요([Spark 결제 정책](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans), 2026-10-25 확인).

앱은 Google 로그인으로 받은 **Firebase ID 토큰을 `Authorization: Bearer <ID 토큰>` 헤더로 개인 API에 보내요.** Worker는 매 요청에서 서드파티 JWT 라이브러리로 `alg=RS256`과 `kid`에 맞는 Google 공개키의 서명을 확인하고, `aud=<프로젝트 ID>`, `iss=https://securetoken.google.com/<프로젝트 ID>`, 만료(`exp`, 미래)·발급 시각(`iat`, 과거)·인증 시각(`auth_time`, 과거), 비어 있지 않은 `sub`를 검사해요. 공개키는 Google의 [공개 인증서 엔드포인트](https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com)에서 받고 응답의 `Cache-Control: max-age`에 맞춰 갱신해요. 검증한 `sub`를 안정된 사용자 ID로 D1 소유자에 매핑하고 자체 세션·사용자 상태를 확인해요. 클라이언트가 보낸 `ownerId`는 믿지 않아요. 이 검증 조건은 Firebase 공식 [ID 토큰 검증 — 서드파티 JWT 라이브러리 사용](https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_a_third-party_jwt_library) 절에서 확인했어요(2026-10-25).

**Firebase Auth 자체는 누구나 Google로 가입할 수 있어요.** Google 첫 로그인 때 Firebase 사용자 계정이 만들어지므로 가입 성공을 개인 API 접근 허가로 취급하지 않아요. Worker에서 검증된 토큰의 허용 이메일(`email_verified`도 확인) 또는 `sub` 목록을 검사해 본인만 허용해요([Firebase Google 로그인](https://firebase.google.com/docs/auth/web/google-signin), 2026-10-25 확인). CORS는 정확한 앱 출처만 허용하고, preflight에는 필요한 메서드와 `Authorization`·`Content-Type` 헤더만 허용해요. 실제 개인 데이터 요청은 토큰 검증·허용 목록·소유권 검사를 모두 통과해야 해요. CORS는 인증을 대신하지 않아요.

Firebase 웹 SDK 도입 때는 CSP와 번들 크기를 점검해요. 현재 [index.html](../../index.html)의 meta CSP는 `script-src 'self'`, `connect-src 'self' https:`이고, `frame-src`가 없어 `default-src 'self'`를 따라요. [csp.config.ts](../../csp.config.ts)는 개발 서버에서만 로컬 HTTP 연결을 추가해요. SDK를 앱 번들에 넣을 때의 크기 증가와 Google 로그인에 필요한 외부 스크립트·인증 프레임 허용 여부를 확인해야 해요. 이번에는 코드를 바꾸지 않아요. GitHub OAuth와 패스키 구현 조건은 기존 [GitHub OAuth](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps), [패스키 서버 검증](https://developers.google.com/identity/passkeys/developer-guides/server-authentication)을 기준으로 비교해요(2026-10-25 확인).

로그인 실패·만료 상태에서는 로컬 작업을 이어가고 다음 로그인 뒤 동기화해요. 공개 읽기 공유 API는 Firebase ID 토큰으로 보호하는 개인 API와 별도 경계에 두고, 공유 대상에게는 로그인 없이 승인된 스냅샷만 보여 줘요. 공동 편집이 생기면 참여자도 로그인시키고 DB membership으로 권한을 검사해요.

## 5. 서버·DB가 생기면 좋아지는 기능

우선순위는 P0부터, 규모는 관련 화면·권한·복구를 포함한 상대 추정이에요. 배포 계정 설정과 실제 검증에 따라 달라져요.

| 기능 | 지금의 불편 | 개선 방식 | 우선순위 / 규모 | 전제·제약 |
|---|---|---|---|---|
| 기기 간 동기화 | 기기마다 JSON을 옮기고 새 프로필을 만들어야 해요 | 같은 사용자·프로필 ID의 버전을 서버에 보관하고 접속·수정 후 push/pull해요. 오프라인 변경은 큐에 남겨요 | P0 / 중간 | 동시 수정은 충돌 사본을 남겨 사용자가 고르게 해요. 키·계좌는 제외해요 |
| 그룹·전략·선정 기준·결과 읽기 공유 | 전체 파일이나 화면 캡처를 보내야 해요 | 허용 필드만 복사한 독립 스냅샷을 링크로 보여 줘요. 링크 소지자 읽기 전용으로 기본 7일·최대 30일 만료와 언제든 철회를 적용해요 | P0 / 중간 | 그룹 참조·바구니 참조는 선택한 종목으로 풀고 결과는 요약만 보내요. 실시간 시세·개인 성과 공개는 기본 제외예요 |
| 함께 쓰는 그룹 | 각자 바꾼 파일이 갈라져요 | 소유자·편집자·읽기 참여자, 초대 수락, 버전 충돌·변경 기록을 제공해요 | P2 / 큼 | 비회원 공개 공유와 다르게 로그인·membership이 필요해요. CRDT는 사용량을 보고 골라요 |
| 시장 데이터 공통 보관 | 기기마다 큰 파일을 가져와야 해요 | 2단계 전까지 수동 가져오기예요. 2단계에 선택 기능인 Drive `appDataFolder`에 본인 gzip을 보관하고 다른 본인 기기에서 내려받아요. D1에는 파일 버전·해시·수집 시각 같은 manifest만 둘 수 있어요 | P1 / 중간 | R2는 쓰지 않아요. Drive 무료 공간·API 한도 안에서 결제 등록 없이 비공개로 써요. appDataFolder 파일은 공유할 수 없고, KIS 재배포 약관 확인 후 공개 배포 여부는 **미정(보류)**이에요 |
| 매일 선정 기준 재계산 | 브라우저를 열고 계산해야 해요 | 날짜·데이터 버전·기준 버전을 고정한 작업을 실행하고 결과만 DB에 써요 | P2 / 큼 | 큰 파일 해제·전 종목 계산은 무료 Worker CPU 10 ms에 맞는다고 볼 수 없어요. 맥 배치 우선 검토예요 |
| 알림 | 앱을 보고 있어야 결과를 알아요 | 계산 완료·선정 변화 이벤트를 저장하고 사용자가 허용한 Web Push 등으로 알려 줘요 | P2 / 중간~큼 | Cron은 알림 전달 서비스가 아니에요. 권한·구독 갱신·중복 방지·실패 재시도와 브라우저별 지원 검증이 필요해요. 메일 등 전달자의 무료량은 확인 필요예요 |
| 내 성과 이력 | 주문 캐시를 비우거나 데이터가 바뀌면 같은 결과를 재현하기 어려워요 | 계산 시각·벤치마크·계산 버전·데이터 기준·추정 여부를 가진 성과 스냅샷을 남겨요 | P2 / 큼 | 계좌별 금액·수익률도 민감해요. 로컬 보관부터 시작하고 서버에는 선택한 E2EE 스냅샷만 둬요 |
| 백업 | 브라우저 삭제·기기 분실 뒤 수동 파일이 없으면 복구하기 어려워요 | 작은 개인 데이터의 제한된 버전 이력과 별도 다운로드 백업·복원 검증을 제공해요 | P0 / 작음~중간 | 동기화는 삭제도 퍼뜨려요. 과거 버전과 별도 오프라인 복사본이 필요해요. 키·시장 파일은 별도 정책이에요 |

### 무료 정기 실행의 현실적인 범위

Workers Free의 Cron Triggers는 계정당 **5개**, 실행당 **CPU 10 ms**, wall time 최대 **15분**이에요. 15분은 CPU를 15분 쓸 수 있다는 뜻이 아니에요. 시간은 UTC로 설정하고 KST 날짜·휴장일·완료 시각을 앱 규칙에 맞춰 계산해야 해요. 요청 수·D1 쓰기 등 관련 한도도 함께 사용해요([Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Cron 설정](https://developers.cloudflare.com/workers/configuration/cron-triggers/), 2026-10-25).

처음에는 만료 공유·오래된 백업의 소량 정리, 삭제 후 30일이 지난 프로필의 서버 본문·공유·이력 정리, 새 데이터 manifest 확인 같은 짧은 작업만 맡겨요. tombstone과 삭제 예정 시각으로 복구 기간이 지난 대상을 골라 소량씩 지워요. 만료 판정은 정리 Cron 성공 여부와 무관하게 매 요청에서 해요. 전체 시장 수집은 기존 [collect-market-data.mjs](../../scripts/collect-market-data.mjs)와 [development.md](../development.md)의 흐름을 활용해 맥에서 돌리는 안이 현실적이에요. 맥이 꺼져 있으면 다음 기동 때 미실행 날짜를 찾아 이어 받아요.

서버 자동 수집을 위해 증권사 키를 클라우드에 평문 배치하거나 프록시 허용 목록을 확장하지 않아요. 키는 사용자가 관리하는 맥의 기존 로컬 환경에 두고 결과 파일만 업로드하는 경계를 유지해요. 서버가 읽을 수 없는 E2EE 키를 넣어 두고 서버가 이를 복호화해 수집하게 하는 것은 E2EE 취지와 맞지 않아요. 자동 수집·공통 배포는 자료 이용 조건을 확인한 뒤 시작해요.

## 6. 보안 경계를 지키는 설계

### 동기화·프록시·공유를 나눠요

GitHub Pages 앱에서 Firebase Auth(Spark)로 Google 로그인 → `Authorization: Bearer` ID 토큰 → 개인 동기화 Worker의 토큰·허용 목록 검증 → D1 자체 세션·사용자 매핑을 새 경로로 둬요. CORS는 정확한 앱 출처만 허용해요. Firebase는 인증에만 쓰고 Firestore는 쓰지 않아요. 기존 앱 → 증권사 프록시 → 증권사 경로는 유지해요. 개인 동기화 API에 증권사 호출 기능을 넣지 않아요. 기존 [allowlist.ts](../../proxy/src/allowlist.ts)는 확장하지 않으며 주문 생성·정정·취소 차단을 유지해요.

동기화 전용 DTO는 허용한 필드로 새로 만들어요. 설정은 기간·지표·벤치마크·색 규칙·정렬만 포함하고, 테마·공급자·프록시 URL·키 잠금·온보딩·마지막 그룹과 활성 프로필 선택은 기기에 둬요. 서버에서도 같은 스키마를 검사하고, 알 수 없는 필드·과도한 크기·허용하지 않은 연결 정보를 거절해요. `settings` 전체 복사나 localStorage 전체 순회 업로드는 하지 않아요. owner 검사는 모든 읽기·쓰기·삭제에 적용하고, 검증된 `sub`에서 D1 소유자를 결정해요. 클라이언트가 보낸 `ownerId`나 브라우저의 프로필 UUID만으로 접근시키지 않아요.

### 키·계좌·성과 이력은 1단계에서 제외해요

그룹·전략·선정 기준·바구니는 1단계에 D1 평문 JSON으로 일반 동기화해요. Cloudflare 계정 주인과 Cloudflare가 내용을 볼 수 있으며, 처음부터 E2EE는 하지 않아요(사용자 결정, 2026-10-25). 증권사 키·프록시 토큰·주문 캐시·성과 이력은 1단계에서 제외해요. 계좌 식별자가 든 캐시 키까지 포함해 `gazua-account`도 제외하며, 이후에도 사용자가 항목별 E2EE를 직접 켠 경우에만 서버에 보관해요. 접근 토큰은 동기화·공유·백업용 DTO에 넣지 않아요. 기존 프록시 운영용 토큰 설정과 새 클라우드 데이터 저장은 구분해요.

후속 E2EE는 **단말에서 암호화하고 수신 단말에서만 복호화**하는 별도 기능이에요. 서버에는 버전 있는 암호문 envelope와 최소 메타데이터만 둬요. 현 PBKDF2/AES-GCM 구현을 참고하되 문서 ID·스키마 버전을 인증 데이터에 묶는 방식, IV 재사용 금지, 암호 변경·기기 폐기·복구 키·분실 시 복구 불가 안내를 설계해야 해요. 로그인 암호·OAuth 토큰·서버 관리 키를 복호화 암호 대신 쓰지 않아요. 서버의 at-rest 암호화는 E2EE가 아니에요.

키 동기화를 켜더라도 토스 단일 유효 토큰 제약은 남아요. 주문 캐시 E2EE도 잠금 모드의 현재 메모리 전용 원칙을 명시적으로 검토한 별도 동의 없이는 추가하지 않아요. E2EE는 업로드 이후의 평문 유출을 줄이지만 잠금 해제된 단말의 XSS나 악성 앱 배포까지 막지는 못해요.

### 공유 링크는 전용 스냅샷으로 만들어요

1. **복사할 필드부터 정해요.** 그룹은 공개 제목·종목 코드·공개 표시 설정, 전략·선정 기준은 선택한 규칙과 필요한 종목만, 결과는 계산 요약·기준일·버전만 복사해요. 계좌·키·토큰·프록시 URL·개인 프로필 이름·최근 종목·실계좌 금액·내부 소유자 ID는 넣지 않아요. 가상 초기 자금·자유 입력 제목도 미리 보기에서 사용자가 검토하게 해요.
2. **공유 형식과 검증기를 분리해요.** 기존 `exportData()`를 공개에 재사용하지 않아요. 클라이언트가 필드를 섞어 보내도 서버가 거절해요. 그룹 ID·전략 ID·바구니 ID 참조는 공개 스냅샷 안에서 완결되도록 해석하고 원본 DB로 따라가는 링크를 만들지 않아요.
3. **읽기 권한을 링크 하나로 제한해요.** 암호학적 무작위 256비트 capability를 만들고 서버에는 해시만 보관해요. URL fragment에 담아 페이지가 읽은 뒤 요청 헤더로 전달하는 방식을 제안해요. 토큰 원문·요청 헤더·개인 본문·전체 공유 URL은 로그에 남기지 않아요. 이 문서에는 실제 값이나 예시 토큰을 적지 않아요.
4. **서버에서 만료·철회를 검사해요.** 기본 7일, 최대 30일을 적용하고 언제든 철회할 수 있어요(사용자 결정, 2026-10-25). 서버 시각과 `expiresAt/revokedAt`을 매 조회 때 확인하고, 공개 목록 조회나 수정 API는 제공하지 않아요. 생성·철회는 본인 인증 뒤에만 가능해요. KV·CDN·서비스워커에 공유 응답을 캐시하지 않고 `Cache-Control: no-store`로 다뤄요.
5. **복사 이후의 한계도 알려 줘요.** 링크를 전달받은 사람은 누구나 만료 전 읽을 수 있어요. 철회는 이후 서버 조회를 막지만 이미 본 내용·다운로드·캡처를 지우지는 못해요. 사용자별 접근 제한이 필요하면 링크 공개 대신 로그인한 초대 대상으로 바꿔요.

## 7. 추천안과 단계별 로드맵

### 선택의 이유

**Workers Free + D1 Free + Firebase Auth(Spark, Google 로그인·인증만)**을 1순위로 추천해요. 결제 등록 없는 무료 원칙에 맞춰 Access는 제외하고, Firebase로 Google 신원을 확인한 뒤 Worker가 ID 토큰을 검증해 D1 자체 세션·사용자 매핑을 관리해요(사용자 결정, 2026-10-25). 이미 있는 Cloudflare 배포 경험을 쓰고, 작은 SQL DB 하나로 동기화 버전·공유 만료·백업 메타데이터를 처리할 수 있어요. 인증과 충돌 처리까지 완제품으로 제공하는 서비스는 아니므로 초기 구현 규모는 중간이에요.

DB까지 바꾸고 계정·권한 기능을 빨리 구성하는 것이 더 중요하면 **Firebase Spark / Firestore Standard + Firebase Auth + Security Rules**를 대안으로 검토해요. 이는 Firebase를 인증에만 쓰고 **Firestore를 쓰지 않는 추천안(Workers + D1 + Firebase Auth)**과 별개예요. 문서 모델·Rules·SDK 종속성이 높고, 시장 파일 보관·서버 배치는 Spark만으로 해결하기 어려워요. **Drive appDataFolder**는 본인 동기화만 필요할 때 대안이고, **PocketBase+맥**은 맥이 꺼질 때 공유도 중단돼도 괜찮고 운영을 직접 맡을 때 선택해요. 이번 두 목적을 한 번에 해결하기에는 Workers+D1+Firebase Auth가 가장 균형이 좋다고 판단해요.

### 1단계: 가장 작은 무료 동기화와 읽기 공유

**범위:** 사용자 1명, 여러 기기, 작은 프로필 데이터, 로그인 없는 만료 공유예요. R2·DO·CRDT·증권사 키·프록시 토큰·주문 캐시·성과 이력 동기화는 넣지 않아요. 개인 프로필은 작은 스냅샷 단위로, 공유는 별도 DTO로 시작해요. 기존 GitHub Pages 배포는 유지해요.

| 부분 | 바뀔 기존 파일·모듈 | 새로 만들 것 | 규모 |
|---|---|---|---|
| 안전한 동기화 형식 | [profileStore.ts](../../src/lib/state/profileStore.ts), [schema.ts](../../src/lib/state/schema.ts), [app.svelte.ts](../../src/lib/state/app.svelte.ts)의 저장 연동부 | `src/lib/sync/` 아래 DTO·검증·기존 데이터 변환. 프로필 색인은 작은 별도 문서로 동기화하고 활성 선택은 기기에 둬요 | 중간 |
| 로컬 저장·복구 | [storage.ts](../../src/lib/state/storage.ts)와 상태 저장 호출부 | IndexedDB outbox·마지막 수신 리비전·작업 ID. 앱 시작 때 로컬 상태와 마지막 확인 스냅샷을 대조해 미전송 변경도 복구해요 | 중간 |
| 동기화 API | 기존 프록시는 변경 대상에서 제외해요 | 별도 `sync-worker/`의 fetch API에서 Bearer Firebase ID 토큰·허용 목록을 검증하고 정확한 앱 출처의 CORS만 허용해요. D1 migrations·환경별 설정과 자체 세션·사용자 매핑, users, profile index, profiles, revisions, shares 테이블을 제안해요 | 중간 |
| 로그인·동기화 상태 | [DataTools.svelte](../../src/lib/ui/settings/DataTools.svelte) 등 설정 화면, [index.html](../../index.html)의 CSP | Firebase Auth(Spark) Google 로그인·ID 토큰 취득/갱신·Bearer 전송, SDK 번들·CSP 점검, 수동 동기화·오프라인/대기/실패 표시·충돌 사본 선택 UI | 중간 |
| 공유 | [routes.ts](../../src/lib/state/routes.ts)와 그룹·전략·선정 기준·결과 화면 | `src/lib/share/`의 전용 serializer·미리 보기·읽기 화면·생성/철회 UI | 중간 |
| 백업·검증·배포 | 기존 [exportImport.ts](../../src/lib/state/exportImport.ts)는 수동 내보내기 용도로 유지해요 | 프로필당 과거 리비전 10개 보관, 삭제 후 30일 복구·이후 서버 본문·공유·이력 정리, 별도 파일 내보내기·복원, API 권한·충돌·공유 누출 검증, 별도 Worker 배포 절차 | 작음~중간 |

경로는 향후 구현 위치를 제안한 것이며 아직 없는 파일에는 저장소 링크를 걸지 않았어요. 전체 1단계는 **중간** 규모이고 로그인·공유·충돌 UI까지 포함하면 작은 설정 수정만으로 끝나지는 않아요.

동기화 규칙은 다음처럼 시작해요.

- 로컬 저장을 먼저 완료하고, 작업 ID·기준 리비전과 함께 변경을 큐에 넣어요. 서버 확인 전에는 전송 완료로 표시하지 않아요. 재시도에는 같은 작업 ID를 써 중복 저장을 막아요.
- 서버는 `expectedRevision`이 현재 리비전과 같을 때만 조건부 갱신해요. 비교·갱신·이력 기록은 원자적으로 처리하고, 서로 다른 기기 시계의 `updatedAt`으로 덮어쓰지 않아요.
- 기준이 다르면 자동 덮어쓰기 없이 두 버전을 원본과 충돌 사본으로 모두 남겨 사용자가 고르게 해요. 프로필 문서 안의 그룹·전략 참조는 함께 검증해요. 삭제는 tombstone과 삭제 예정 시각으로 전달하고, 삭제 후 30일 동안 복구할 수 있게 보관해요. 30일이 지나면 서버 본문·공유·이력을 모두 지워요. 오래 오프라인이었던 기기가 지운 프로필을 부활시키지 못하게 해요.
- 기존 JSON 가져오기가 새 UUID를 만드는 동작은 유지해요. 원격 동기화에는 같은 ID를 보존하는 전용 적용 경로를 만들어 수동 가져오기와 구분해요. 새 기기의 기존 로컬 프로필은 동의 없이 원격 값으로 덮어쓰지 않아요.
- 서버 오류·무료량 초과·로그인 만료 때 로컬 사용과 JSON 내보내기를 유지해요. 작은 데이터만 재전송하고 탭 간 전송을 조정하며 백오프해요. PWA 백그라운드 실행을 전제하지 않고 앱을 열 때 다시 시도해요.

초기 자체 한도는 개인 문서 256 KiB, 공유 스냅샷 100 KiB, 활성 공유 50개, 과거 리비전 프로필당 10개로 시작해요(보존 개수는 사용자 결정, 2026-10-25). 예를 들어 100 KiB 문서 10개에 과거 10개씩을 남기면 과거 본문은 100 KiB × 10문서 × 10개 = 10,000 KiB, 약 9.77 MiB예요. 인덱스·현재 본문·공유를 더해도 D1 단일 DB 500 MB 이내에서 출발할 여지가 있어요. 이는 실측이 아닌 용량 예산이에요. 요청·스캔 행 수·DB 크기를 관찰하고, 자체 한도 초과는 거절해요. 유료 업그레이드를 자동으로 켜지 않아요.

**완료 기준:** 두 기기 왕복, 오프라인 수정 후 재접속, 동시 수정·삭제 충돌, 재시도 중복 방지, 계정 소유권 위반 거절, 키·계좌 필드 주입 거절, 공유 만료·철회·참조 누출 방지, 백업을 새 로컬 프로필로 복원하기를 확인해요. Bearer Firebase ID 토큰의 서명·클레임·만료 검증, 허용 목록 밖 사용자 거절, D1 자체 세션·사용자 매핑, 정확한 앱 출처의 CORS·preflight와 JWT 검증의 무료 CPU 예산도 실제 배포 전 검증해요.

### 2단계: 시장 파일의 본인 기기 간 전달과 복구 강화

**범위:** 시장 데이터의 수동 가져오기 유지와 선택적인 본인 기기 간 자동 전달, 백업 운용, 사용자가 원한 경우에만 E2EE 개인 데이터 보관이에요. 규모는 **중간~큼**이에요. DB는 D1을 쓰고 시장 파일에 R2는 쓰지 않아요(사용자 결정, 2026-10-25).

- **2단계의 Drive 기능 도입 전까지 기기마다 수동 가져오기**를 유지해요. 지금처럼 시장 파일을 직접 옮겨 가져오며, 파일 저장을 위해 별도 구독·결제 등록을 하지 않아요.
- **Google Drive `appDataFolder`를 통한 시장 파일 전달은 2단계에 선택 기능으로 넣어요(사용자 결정, 2026-10-25).** `drive.appdata` 범위로 본인 파일을 보관하고 같은 Google 계정의 다른 기기에서 내려받아요. appDataFolder 파일은 공유할 수 없어 공개 배포 경로로 쓰지 않아요. 일반 Google 계정의 Drive·Gmail·Photos 합계 15 GB와 API quota-unit 한도 안에서 결제 등록 없이 무료로 시작해요. 정확한 한도와 도입 때 재확인할 조건은 3절의 기존 Drive 비교를 따라요. 짧은 수명의 토큰 재취득에 사용자 동작이 필요할 수 있으므로 무인 백그라운드 전달을 전제하지 않아요.
- D1에는 파일 본문 대신 파일 버전·해시·수집 시각 같은 목록(manifest)만 둘 수 있어요. Drive 기능을 넣을 때 [marketData/store.ts](../../src/lib/marketData/store.ts)에 검증된 다운로드·교체 경로를 붙이고, 설정 화면에 버전·크기·다시 받기를 더해요. 무료 공간·API 한도에 맞는 보관 개수·업로드 제한을 정해요.
- [수집 스크립트](../../scripts/collect-market-data.mjs)는 맥에서 계속 실행하고, Drive 기능을 선택한 경우에만 본인 appDataFolder 업로드·manifest 갱신 작업을 추가해요. 키를 클라우드로 이동하지 않아요. 실패한 수집 파일은 내려받을 버전으로 올리지 않아요. git·Pages·Release를 통한 공개 배포는 3절처럼 KIS 재배포 약관 확인이 필요하며, 확인 후 공개 배포 여부도 **미정(보류)**이에요.
- `sync-worker/`의 짧은 정리 Cron은 tombstone·삭제 예정 시각을 기준으로 삭제 후 30일이 지난 프로필의 서버 본문·공유·이력을 모두 정리해요. 보존·정리 운용을 점검하고, 별도 매체에 내려받은 백업의 복구를 정기 점검해요. D1 Time Travel의 무료 7일은 단기 사고 복구용이고 유일한 백업으로 삼지 않아요.
- E2EE를 선택하면 `src/lib/sync/crypto/`에 버전 있는 envelope·복구 키·키 변경을 만들고 [secrets.ts](../../src/lib/state/secrets.ts)와 잠금 UI의 경계를 검토해요. 증권사 키·프록시 토큰·주문 캐시·성과 이력은 각각 별도 기본 꺼짐 E2EE 옵션으로 두고, 사용자가 항목별로 직접 켠 경우에만 서버에 보관해요.

### 3단계: 공동 그룹·정기 계산·알림·성과 이력

**범위:** 다중 사용자 권한, 자동 작업, 재현 가능한 결과 보관이에요. 규모는 **큼**이에요. 실제 사용이 생긴 기능부터 따로 구현해요.

- 공동 그룹: [watchlist.ts](../../src/lib/state/watchlist.ts), 상태·그룹 UI에 원격 group/member 모델을 연결해요. 새 membership·초대·권한·감사 이력을 만들고 초대 취소·탈퇴·오프라인 편집자 충돌을 다뤄요. 빈번한 동시 편집이 확인되면 Yjs/Automerge 또는 DO 조정을 비교해요.
- 정기 계산: [screen/runValidation.ts](../../src/lib/screen/runValidation.ts), [precompute.ts](../../src/lib/screen/precompute.ts)의 계산 부분을 입출력 어댑터와 분리해 배치에서 재사용해요. 새 jobs/results·실행 ID·재시도·날짜별 누락 보충을 만들어요. 무료 클라우드에 무거운 계산이 맞지 않으면 맥에서 실행하고, 맥이 꺼져 있으면 지연됨을 표시해요. 클라우드 상시 실행은 무료 조건을 다시 검토해요.
- 성과 이력: [perf/compose.ts](../../src/lib/perf/compose.ts), [perf/types.ts](../../src/lib/perf/types.ts)에 대응하는 버전 있는 스냅샷을 새로 정의해요. 계산에 사용한 시세 기준·추정 분할 여부·벤치마크·수수료·불완전한 계좌 내역 한계를 함께 남겨요. 서버 보관은 E2EE 선택 후에만 해요.
- 알림: 새 구독 관리·동의 UI·이벤트 큐·중복 방지·전달 어댑터를 만들어요. 공개 공유 수신자에게 알림을 자동 등록하지 않아요. 채널별 무료 한도와 실제 폰 PWA 지원을 확인한 뒤 범위를 정해요.

## 8. 결정이 필요한 것

1. **기본 경로(결정됨):** Workers + D1 + Firebase Auth(Spark, 인증만)로 구성해요. 결제 등록 없는 무료 원칙에 따라 Access는 제외하고 Firestore는 쓰지 않아요(사용자 결정, 2026-10-25).
2. **본인 로그인(방식 결정됨):** Firebase Auth로 Google 신원을 확인하고, Worker에서 Bearer ID 토큰을 검증한 뒤 D1 자체 세션·사용자 매핑을 둬요(사용자 결정, 2026-10-25). Worker에서 허용할 이메일 또는 `sub` 목록과 자체 세션의 만료·철회 정책은 구현 전에 정해요.
3. **일반 개인 데이터의 공개 범위(결정됨):** 일반 동기화로 시작하고, 그룹·전략·선정 기준·바구니는 D1에 평문 JSON으로 저장해요. Cloudflare 계정 주인과 Cloudflare가 내용을 볼 수 있어요. 처음부터 E2EE는 하지 않아요(사용자 결정, 2026-10-25).
4. **동기화할 설정(결정됨):** 허용 필드 목록에 따라 기간·지표·벤치마크·색 규칙·정렬 등 분석 설정만 동기화해요. 테마·공급자·프록시 URL·키 잠금·온보딩·마지막 그룹은 기기마다 둬요(사용자 결정, 2026-10-25).
5. **공유 정책(결정됨):** 링크 소지자 읽기 전용으로, 기본 7일·최대 30일 만료를 적용해요. 원본과 분리된 스냅샷을 공유하고 언제든 철회할 수 있어요(사용자 결정, 2026-10-25).
6. **충돌 처리(결정됨):** 자동 덮어쓰기 없이 두 버전을 모두 남기고 사용자가 고르는 충돌 사본 방식으로 처리해요(사용자 결정, 2026-10-25).
7. **키·계좌·성과(결정됨):** 증권사 키·프록시 토큰·주문 캐시·성과 이력은 1단계에서 계속 제외해요. 이후에도 사용자가 항목별 E2EE를 직접 켠 경우에만 서버에 보관해요(사용자 결정, 2026-10-25).
8. **큰 파일·자동 작업(일부 결정됨):** R2는 쓰지 않고, 본인 기기 간 시장 파일 전달용 Drive `appDataFolder` 선택 기능은 2단계에 넣어요. 그때까지 수동 가져오기를 유지해요(사용자 결정, 2026-10-25). **KIS 약관 확인 후 공개 배포 여부는 미정(보류)**이에요. 무거운 작업은 맥에서 이어가며, 맥의 비가동 시간도 허용해야 해요.
9. **보존(결정됨):** 프로필당 과거 리비전 10개를 보관하고, 프로필 삭제 후 30일 동안 복구할 수 있게 해요. 30일이 지나면 서버 본문·공유·이력을 모두 지워요. 별도 파일 백업(내보내기)과 복구 점검도 함께 써요(사용자 결정, 2026-10-25).

## 출처

외부 링크는 공식 문서·공식 프로젝트 저장소만 사용했어요. 아래는 모두 **2026-10-25 확인**이에요. 가격·플랜은 변경될 수 있어 도입 직전에 다시 확인해요. 비활성 조건처럼 본문에 `확인 필요`로 남긴 항목은 수치를 추정해 채우지 않았어요.

| 구분 | 공식 출처 | 확인 날짜 |
|---|---|---|
| Cloudflare 실행·예약 | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) | 2026-10-25 |
| D1 | [가격](https://developers.cloudflare.com/d1/platform/pricing/), [한도·Time Travel](https://developers.cloudflare.com/d1/platform/limits/) | 2026-10-25 |
| KV | [가격](https://developers.cloudflare.com/kv/platform/pricing/), [일관성](https://developers.cloudflare.com/kv/concepts/how-kv-works/) | 2026-10-25 |
| R2·DO | [R2 가격](https://developers.cloudflare.com/r2/pricing/), [R2 구독 조건](https://developers.cloudflare.com/r2/get-started/), [DO 가격](https://developers.cloudflare.com/durable-objects/platform/pricing/) | 2026-10-25 |
| Access(추천 제외) | [가격](https://www.cloudflare.com/plans/), [Google IdP](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/), [Free도 결제 정보가 필요한 조직 생성 절차](https://developers.cloudflare.com/learning-paths/clientless-access/initial-setup/create-zero-trust-org/) | 2026-10-25 |
| Firebase Auth·ID 토큰 검증·Spark 결제 정책 | [Google 로그인](https://firebase.google.com/docs/auth/web/google-signin), [ID 토큰 검증(서드파티 JWT 라이브러리)](https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_a_third-party_jwt_library), [Spark: 결제 정보 불필요·한도 초과 시 제품 사용 중단](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans) | 2026-10-25 |
| Google Identity Services 직접 연동 | [OAuth 클라이언트 설정](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid). 결제 계정 불필요 여부는 확인 필요예요 | 2026-10-25 |
| Firebase | [가격](https://firebase.google.com/pricing), [Firestore 한도](https://firebase.google.com/docs/firestore/quotas), [오프라인](https://firebase.google.com/docs/firestore/manage-data/enable-offline), [Storage의 Blaze 요구](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024) | 2026-10-25 |
| Turso | [가격](https://turso.tech/pricing), [SDK 인증](https://docs.turso.tech/sdk/authentication), [unarchive](https://docs.turso.tech/cli/group/unarchive) | 2026-10-25 |
| Neon | [가격](https://neon.com/pricing), [플랜 상세](https://neon.com/docs/introduction/plans), [scale-to-zero](https://neon.com/docs/introduction/scale-to-zero) | 2026-10-25 |
| PocketBase | [공식 소개](https://pocketbase.io/docs/), [운영·백업](https://pocketbase.io/docs/going-to-production/), [인증](https://pocketbase.io/docs/authentication/) | 2026-10-25 |
| Google Drive | [appDataFolder](https://developers.google.com/workspace/drive/api/guides/appdata), [브라우저 OAuth](https://developers.google.com/identity/oauth2/web/guides/use-token-model), [API 한도·가격](https://developers.google.com/workspace/drive/api/guides/limits), [저장 공간](https://support.google.com/drive/answer/6374270) | 2026-10-25 |
| GitHub | [Free 플랜](https://docs.github.com/en/get-started/learning-about-github/githubs-plans), [Gist](https://docs.github.com/en/get-started/writing-on-github/editing-and-sharing-content-with-gists/creating-gists), [Contents API](https://docs.github.com/en/rest/repos/contents), [REST 한도](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api), [OAuth](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps) | 2026-10-25 |
| GitHub 시장 파일 보관·배포 | [대용량 파일·저장소 권장 크기](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github), [Pages 한도](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits), [Pages 공개 범위 안내](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https), [Release 한도·접근 권한](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases), [저장소 공개 범위](https://docs.github.com/en/repositories/creating-and-managing-repositories/about-repositories), [Release 첨부 API](https://docs.github.com/en/rest/releases/assets) | 2026-10-25 |
| WebDAV | [Nextcloud API](https://docs.nextcloud.com/server/latest/developer_manual/client_apis/WebDAV/basic.html), [webdav-client CORS](https://github.com/perry-mitchell/webdav-client/blob/master/README.md) | 2026-10-25 |
| iCloud | [저장 공간](https://support.apple.com/en-us/108922), [CloudKit JS](https://developer.apple.com/documentation/cloudkitjs), [CloudKit 준비](https://developer.apple.com/documentation/cloudkit/enabling-cloudkit-in-your-app) | 2026-10-25 |
| 로컬 우선 | [Automerge](https://automerge.org/docs/hello/), [Yjs](https://docs.yjs.dev/), [RxDB 복제](https://rxdb.info/replication.html), [RxDB 플랜](https://rxdb.info/premium/), [Electric Sync](https://electric.ax/docs/sync/), [Electric 가격](https://electric.ax/pricing) | 2026-10-25 |
| 패스키 | [서버 인증 검증](https://developers.google.com/identity/passkeys/developer-guides/server-authentication) | 2026-10-25 |

저장소 근거는 각 절의 상대 링크로 연결했어요. 문체는 [providers.md](../providers.md)와 [development.md](../development.md)를 따랐어요. 이번 결과물은 검토 문서이며 앱 코드·프록시·외부 계정·배포 설정은 변경하지 않았어요.
