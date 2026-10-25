# 가즈아 동기화 Worker

여러 기기에서 같은 프로필(그룹·전략·선정 기준·묶음·분석 설정)을 쓰게 하고, 만료·철회되는 읽기 전용 공유 링크를 만드는 Cloudflare Worker예요. 증권사 [프록시](../proxy/README.md)와 코드·배포·설정을 따로 둬요. 이 Worker는 증권사를 부르지 않아요.

- 근거: [서버·DB 도입 검토](../docs/proposals/2026-10-25-server-and-db.md) 7절 1단계
- 구현 계획: [docs/superpowers/plans/2026-10-25-sync-phase1.md](../docs/superpowers/plans/2026-10-25-sync-phase1.md)
- 쓰는 서비스: Workers Free, D1 Free, Firebase Auth(Spark, Google 로그인만). **결제 등록이 필요한 것(R2, Cloudflare Access, Firebase Blaze, Firestore)은 쓰지 않아요.**

## 올리는 것과 올리지 않는 것

| 올려요(평문 JSON, Cloudflare 계정 주인과 Cloudflare가 볼 수 있어요) | 올리지 않아요 |
|---|---|
| 프로필 이름, 관심 그룹, 전략, 선정 기준, 내 묶음 | 증권사 키, 프록시 토큰, 접근 토큰 |
| 분석 설정: 기간·지표·벤치마크·성과 벤치마크·색 규칙·정렬 | 주문 캐시(`gazua-account`), 성과 이력, 봉 캐시, 시장 데이터 |
| | 공급자·프록시 주소·거래소·테마·키 잠금·온보딩·마지막 그룹, 최근 종목, 도움말 기록 |

서버도 같은 검증기(`src/lib/sync/dto.ts`, `src/lib/share/snapshot.ts`)로 다시 검사해요. 모르는 필드나 금지 키(`appKey`, `proxyToken`, `accessToken`, `orders`, `accountId` 등)가 어느 깊이에 있든 `422`로 거절해요.

## HTTP 계약

모든 요청은 `Origin`이 `ALLOWED_ORIGINS`와 정확히 같아야 해요. 다르면 `403 origin`이에요. preflight는 `GET, POST, PUT, DELETE`와 `Authorization, Content-Type, X-Gazua-Session, X-Share-Token` 헤더만 허용해요. 모든 응답은 `Cache-Control: no-store`예요.

개인 API는 매 요청에 두 가지를 보내요.
- `Authorization: Bearer <Firebase ID 토큰>`: RS256 서명과 `aud`, `iss`, `exp`, `iat`, `auth_time`, `sub`를 검사해요. 이메일은 `email_verified`여야 하고 `ALLOWED_EMAILS`에 있어야 해요.
- `X-Gazua-Session: <기기 세션>`: D1에는 SHA-256만 둬요. 마지막 사용 후 30일이 지나면 만료되고, 언제든 철회할 수 있어요.

| 메서드·경로 | 설명 |
|---|---|
| `POST /v1/session` | 기기 세션 만들기. `auth_time`이 5분 이내인 토큰만 받아요. 철회된 기기는 Google 로그인을 다시 거쳐야 해요 |
| `DELETE /v1/session` | 이 기기 로그아웃 |
| `GET /v1/sessions`, `DELETE /v1/sessions/:id`, `DELETE /v1/sessions?others=1` | 기기 목록과 철회 |
| `GET /v1/profiles` | 프로필 색인(리비전, 삭제 시각, 정리 예정 시각) |
| `GET/PUT/DELETE /v1/profiles/:id` | `PUT`·`DELETE`는 `{ opId, expectedRevision }`를 받아요. 기준이 다르면 `409`(현재 본문 포함), 삭제됐으면 `410`이에요. 같은 `opId`로 다시 보내면 처음 결과를 그대로 줘요 |
| `POST /v1/profiles/:id/restore` | 삭제 후 30일 안이면 복구 |
| `GET /v1/profiles/:id/revisions[/:rev]` | 현재와 과거 10개 |
| `POST/GET /v1/shares`, `DELETE /v1/shares/:id` | 공유 만들기·목록·철회. 만료는 기본 7일, 최대 30일이고, 활성 공유는 50개까지예요 |
| `GET /v1/public/share` | 로그인 없이 `X-Share-Token: <capability>`로 읽어요. 만료·철회·원본 삭제면 `410`이에요 |

capability는 256비트(base64url 43자)예요. 만들 때 한 번만 돌려주고 D1에는 해시만 둬요. 링크는 `https://<앱>/#/s/<capability>`이고, fragment라서 서버 로그·Referer에 남지 않아요. 로그에는 `메서드 경로패턴 상태 시간`만 남겨요.

하루 한 번(KST 03:17) Cron이 아래를 지워요. 한 번에 지우는 양에 상한이 있어요.
- 삭제 30일이 지난 프로필의 본문·이력·공유·색인
- 만료·철회 후 30일이 지난 공유
- 오래된 세션

## 개발

```bash
corepack pnpm --filter sync-worker test     # 테스트용 D1(node:sqlite) 위의 단위·API 테스트
corepack pnpm --filter sync-worker check    # 타입 검사
corepack pnpm --filter sync-worker smoke    # 실제 workerd + 로컬 D1(wrangler dev)에서 흐름 확인. 지어낸 키만 써요
```

`test/devEntry.ts`는 스모크 전용 진입점이에요. Google 인증서 대신 지어낸 공개키로 검증해요. **배포에 쓰지 마세요.** `wrangler.toml`의 `main`은 `src/worker.ts`예요.

## 처음 배포하기 (사용자가 직접 해요)

계정 만들기, 프로젝트 만들기, 배포는 직접 해요. 아래 값(프로젝트 ID, D1 ID, 이메일, API 키)은 **저장소에 커밋하지 않아요.**

### 1. Firebase (Spark, 결제 등록 없음)

1. [Firebase 콘솔](https://console.firebase.google.com/)에서 프로젝트를 만들어요. Google Analytics는 꺼도 돼요. **요금제는 Spark 그대로 두고 결제 계정을 연결하지 않아요.**
2. Authentication › 시작하기 › 로그인 방법에서 **Google**을 사용 설정해요.
3. Authentication › 설정 › 승인된 도메인에 앱 도메인(`gazua.sch0718.dev`)을 더해요. 개발할 때 `localhost`는 기본으로 들어 있어요.
4. 프로젝트 설정 › 내 앱 › 웹 앱을 추가하고 `apiKey`, `authDomain`, `projectId`, `appId`를 확인해요. Firebase Hosting은 켜지 않아도 돼요. Firestore는 만들지 않아요.

### 2. Cloudflare D1과 Worker

```bash
corepack pnpm --filter sync-worker exec wrangler login
corepack pnpm --filter sync-worker exec wrangler d1 create gazua-sync
```

1. 출력된 `database_id`를 `sync-worker/wrangler.toml`의 `[[d1_databases]]`에 넣어요. 비밀은 아니지만 기본은 커밋하지 않아요(로컬에서만 바꿔 두기).
2. 같은 파일의 `FIREBASE_PROJECT_ID`에 Firebase 프로젝트 ID를 넣어요. `ALLOWED_ORIGINS`는 앱 출처(`https://gazua.sch0718.dev`)예요.
3. 마이그레이션을 적용하고 허용 이메일을 secret으로 넣어요. 여러 개면 콤마로 구분해요.

```bash
corepack pnpm --filter sync-worker migrate:remote
corepack pnpm --filter sync-worker exec wrangler secret put ALLOWED_EMAILS
corepack pnpm --filter sync-worker deploy
```

4. **Cron 수를 확인해요.** Workers Free는 계정 전체에 Cron 트리거가 5개까지예요. 같은 계정의 증권사 프록시·랜드마크 Worker가 쓰는 수를 대시보드(Workers & Pages › 각 Worker › Settings › Triggers)에서 합쳐 보고, 넘으면 `wrangler.toml`의 `[triggers]`를 지운 뒤 정리를 다른 방법으로 돌려요.

### 3. 앱 빌드 설정

GitHub 저장소 Settings › Secrets and variables › Actions › **Variables**에 아래 값을 넣어요. 앱 번들에 들어가는 공개 설정값이라 secret이 아니어도 돼요.

| 변수 | 값 |
|---|---|
| `VITE_SYNC_API_URL` | 배포한 Worker 주소(예: `https://gazua-sync.<계정>.workers.dev`) |
| `VITE_FIREBASE_API_KEY` | 웹 앱 `apiKey` |
| `VITE_FIREBASE_AUTH_DOMAIN` | `authDomain`(예: `<프로젝트>.firebaseapp.com`) |
| `VITE_FIREBASE_PROJECT_ID` | `projectId` |
| `VITE_FIREBASE_APP_ID` | `appId` |

하나라도 비면 동기화·공유 기능이 꺼진 채로 빌드돼요. 지금과 똑같이 동작해요. 값이 있으면 빌드가 `index.html` CSP에 `script-src https://apis.google.com`과 `frame-src https://<authDomain>`을 더해요. 로컬 개발은 저장소 루트의 `.env.local`에 같은 값을 넣어요(`.env.example` 참고).

### 4. 배포 뒤 확인

- 다른 출처에서 `OPTIONS /v1/profiles`를 보내면 `403`이에요.
- 허용 목록에 없는 Google 계정으로 로그인하면 「허용 목록에 없어요」가 뜨고 세션이 생기지 않아요.
- 두 기기에서 로그인하고 동기화를 켠 뒤, 한쪽에서 그룹을 더하면 다른 쪽에 보여요.
- Workers 대시보드 › gazua-sync › Metrics에서 **CPU 시간 중앙값**이 무료 한도(요청당 10ms)보다 충분히 낮은지 봐요. 로컬 Node 측정은 토큰 검증 1회에 약 0.06ms였어요(참고값, 인증서 받기 제외).
- D1 대시보드에서 하루 읽기·쓰기 행 수를 봐요. 무료 한도는 하루 읽기 500만 행, 쓰기 10만 행이에요.

## 무료 한도 아끼기

같은 Cloudflare 계정을 증권사 프록시·랜드마크와 함께 써요. 그래서 앱은 이렇게 동작해요.
- 변경은 3초 모아서 보내요.
- 받기는 앱을 열 때, 탭에 돌아올 때(5분에 한 번까지), `지금 동기화`를 누를 때만 해요. 폴링은 하지 않아요.
- 세션 마지막 사용 시각은 1시간에 한 번만 써요.
- 관리 목록(기기·삭제한 프로필·과거 버전·내 공유)은 펼칠 때만 서버에서 읽어요.
- 한도를 넘거나 서버가 응답하지 않아도 로컬 사용과 JSON 내보내기는 그대로예요. 다시 시도할 때는 간격을 늘려 가요(최대 5분).
