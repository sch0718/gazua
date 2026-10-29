# 카카오·네이버 간편 로그인 구현 계획

- 날짜: 2026-10-29
- 근거: `@sch0718/firebase-session` 0.2.0의 카카오·네이버 로그인([설계 문서](https://github.com/sch0718/sch0718-toolkit-web/blob/main/docs/superpowers/specs/2026-10-29-firebase-session-social-login-design.md) 13장 「가즈아 적용」, 패키지 README)
- 목표: 카카오·네이버 개발자 앱을 등록하고 키를 넣기만 하면 설정 › 동기화·공유에서 바로 로그인을 시험할 수 있게 해요. 키가 없어도 로컬에서 화면 흐름을 볼 수 있게 개발용 가짜 공급자를 둬요.

## 확정된 결정

| 항목 | 결정 |
|---|---|
| 방식 | Worker가 공급자 id_token을 직접 검증하고 D1 기기 세션을 만들어요(Firebase를 거치지 않아요). 이후 요청은 세션 헤더만 보내요 |
| 허용 기준 | 공급자 계정 ID `kakao:<sub>`·`naver:<sub>`. 비밀값 `ALLOWED_ACCOUNTS`(콤마 구분). 이메일로 식별·인가하지 않아요(소셜 사용자의 email은 `''`) |
| 계정 연결 | 같은 사람의 Google·카카오·네이버 계정을 잇지 않아요. 공급자마다 데이터가 따로예요 |
| 카카오 앱 | 카카오톡 공유에 쓰는 앱에 카카오 로그인을 켜서 함께 써요. 공유는 JavaScript 키, 로그인은 REST API 키·클라이언트 시크릿 |
| 패키지 | `@sch0718/firebase-session` 0.2.0(앱·Worker 둘 다 정확한 버전). 0.2.1(API 같음)이 나오면 두 `package.json`의 버전만 바꿔요 |

## 이 계획에서 정한 것

| 항목 | 정한 값 | 이유 |
|---|---|---|
| 콜백 주소 | `<앱 출처>/auth/callback/`(끝 슬래시 포함) | 앱은 해시 라우팅이라 공급자가 붙이는 `?code&state`를 받을 실제 경로가 필요해요. 디렉터리 색인(`auth/callback/index.html`)이면 GitHub Pages·`vite preview`·개발 서버가 모두 같은 파일을 줘요 |
| 콜백 페이지 | `auth/callback/index.html`. `index.html`과 같고 `<meta name="referrer" content="no-referrer">` 한 줄만 더해요. 같은 `src/main.ts`를 불러요 | GitHub Pages는 응답 헤더를 못 바꿔서 meta로 둬요. 앱 전체에 no-referrer를 걸면 카카오톡 공유 SDK 등에 영향이 있을 수 있어 콜백 문서에만 둬요. 두 파일이 어긋나지 않게 시험으로 묶어요 |
| 콜백 처리 순서 | `main.ts`가 마운트 전에 `readSocialCallback` → 즉시 `stripSocialCallback`으로 주소를 지움 → 콜백 화면이 `createSocialSession` → 성공하면 로그인 전 화면(해시)으로 | 패키지 README대로 읽은 즉시 주소를 지워요(코드가 기록·Referer에 남지 않게) |
| 돌아갈 화면 | 로그인 단추를 누를 때 `localStorage['gazua:social-return']`에 `{ hash, label, createdAt }`을 적고 콜백에서 꺼내 지워요(10분 유효) | 기기 이름 입력값과 원래 화면을 리다이렉트 너머로 넘겨요 |
| 단추 노출 | `VITE_KAKAO_LOGIN_CLIENT_ID`·`VITE_NAVER_LOGIN_CLIENT_ID`가 있을 때만 그 단추가 보여요. Google 단추는 Firebase 설정이 다 있을 때만 | 키를 넣은 공급자만 켜요 |
| 소셜만 쓰는 빌드 | `VITE_SYNC_API_URL`과 소셜 client id만 있어도 동기화가 켜져요(Firebase 값 없이). 이때 Google 단추는 숨어요 | 키 없이 가짜 공급자로 시험하거나 Firebase 없이 쓸 수 있게 |
| Worker 공급자 켜기 | `KAKAO_CLIENT_ID`·`KAKAO_CLIENT_SECRET`(네이버도 같은 꼴) 둘 다 있을 때만 그 공급자를 켜요. 둘 다 없으면 `social` 옵션을 넘기지 않아요(`/v1/session/social`은 404) | "비밀값이 있을 때만 켬". 카카오 클라이언트 시크릿은 기본으로 켜져 있어요 |
| Redirect URI 허용 목록 | `[vars] SOCIAL_REDIRECT_URIS`(콤마 구분, 정확히 일치). 기본값은 운영 `https://gazua.sch0718.dev/auth/callback/`. 비면 모두 거절해요 | 패키지는 생략하면 형식만 검사하지만, 가즈아는 늘 목록을 넘겨 닫힌 쪽으로 둬요. 로컬 주소는 운영 Worker에 넣지 않아요(개발용 Worker·개발용 공급자 앱) |
| 마이그레이션 | 패키지 `migrations/firebase-session-0002_social_sessions.sql`을 `sync-worker/migrations/0002_social_sessions.sql`로 복사해요. 시험이 패키지 파일과 SQL이 같은지 확인해요 | wrangler는 `NNNN_이름.sql` 순서로 적용해요 |
| 503 | 공급자·JWKS 장애는 `503 provider-unavailable`, Google 인증서 장애는 지금처럼 `503 certs-unavailable`. 앱은 「잠시 뒤 다시」를 보여요 | 클라이언트가 `limit`으로 받아요 |
| 403 | `not-allowed` 응답의 `account`를 콜백 화면에 그대로 보여 주고 복사 단추를 둬요 | 처음 로그인할 때 허용 목록에 넣을 값을 알려 줘요 |
| 계정 표시 | 소셜은 「카카오 계정」·「네이버 계정」과, 토큰에 이메일이 있으면 그 값(검증 안 된 표시용), 없으면 `kakao:<sub>` | 이메일 대신 공급자 이름·계정 |
| 인앱 브라우저 | 카카오톡(`KAKAOTALK`)·네이버 앱(`NAVER(inapp`) 인앱 브라우저면 「Google 로그인은 막혀요」 안내와 카카오 로그인(있으면)·다른 브라우저로 열기를 권해요 | Google은 임베디드 웹뷰를 `disallowed_useragent`로 막아요 |
| 지연 로드 | 소셜 로그인 시작·콜백 화면 코드는 동적 import로 따로 받아요 | 첫 로딩 크기를 늘리지 않게 |
| CSP | 바꾸지 않아요. 공급자로는 `location.assign` 최상위 이동이라 `connect-src`·`frame-src`·`script-src`와 무관하고, 폼 제출이 아니라 `form-action`도 해당 없어요. meta CSP는 이동(`navigate-to`)을 막지 않아요 | 패키지 README와 같은 판단 |
| PWA | `navigateFallbackDenylist`에 `/auth/callback/`을 더하고 프리캐시에서 뺀다 | 서비스 워커가 앱 셸(`index.html`, no-referrer 없음)로 대신 답하지 않게 |

## 화면 흐름

1. 설정 › 동기화·공유(로그인 전): 기기 이름 입력, `Google로 로그인`(Firebase 설정 시), `카카오로 로그인`, `네이버로 로그인`(client id가 있을 때).
2. 단추 → 돌아갈 화면·기기 이름 저장 → `beginSocialSignIn`(PKCE·state·nonce) → 공급자 인가 화면(최상위 이동).
3. 공급자 → `/auth/callback/?code&state` → `main.ts`가 콜백을 읽고 주소를 지움 → 콜백 화면 「카카오로 로그인하는 중…」.
4. 성공: 원래 화면(대개 `#/settings`)으로 돌아가고 「카카오 계정으로 로그인됨」. 동기화를 켜 두었으면 바로 동기화해요.
5. 실패: 콜백 화면에 이유와 다음 행동. 허용 목록 밖이면 `kakao:<sub>` 값과 복사 단추, 503이면 「잠시 뒤 다시」, 취소·만료·다른 브라우저면 「다시 로그인」.
6. 로그인 뒤 로그아웃·로그인한 기기 목록·철회는 Google과 같아요(세션 헤더만으로 동작).

## Worker 경로

| 메서드·경로 | 동작 |
|---|---|
| `POST /v1/session/social` | `{ provider, code, codeVerifier, redirectUri, label? }` → `{ sessionId, expiresAt, user }`. 400 형식·Redirect URI, 401 `invalid-code`·`invalid-token`, 403 `not-allowed` + `account`, 404 소셜 꺼짐, 503 `provider-unavailable` |
| 기존 개인 API | `Authorization` 없이 `X-Gazua-Session`만 오면 소셜 세션으로 인증해요(Google 세션은 401 `missing-token`). 허용 목록을 매 요청 다시 봐요 |

## 환경변수·비밀값

| 이름 | 어디 | 비밀 |
|---|---|---|
| `KAKAO_CLIENT_ID`·`KAKAO_CLIENT_SECRET` | Worker secret | ID는 공개 값이지만 secret으로 함께 넣어요. 시크릿은 비밀 |
| `NAVER_CLIENT_ID`·`NAVER_CLIENT_SECRET` | Worker secret | 위와 같아요 |
| `ALLOWED_ACCOUNTS` | Worker secret | 비밀 취급 |
| `SOCIAL_REDIRECT_URIS` | `wrangler.toml` `[vars]` | 아님 |
| `VITE_KAKAO_LOGIN_CLIENT_ID`·`VITE_NAVER_LOGIN_CLIENT_ID` | 앱 빌드(GitHub Variables, `.env.local`) | 아님(인가 URL에 드러나요) |
| `VITE_SOCIAL_DEV_MOCK` | 로컬 `.env.local`만 | 개발 서버에서만 읽어요 |

## 개발용 가짜 공급자

- Worker: `sync-worker/test/devSocialEntry.ts`(배포 금지, `wrangler.toml`의 `main`은 그대로 `src/worker.ts`)가 가짜 인가 화면(`/__dev/social/<공급자>/authorize`), 토큰 교환(Worker의 공급자 `fetch`를 바꿔 끼움), 서명 키(JWKS 대신 `keys` 주입)를 맡아요. `pnpm --filter sync-worker dev:social`이 로컬 D1 마이그레이션 뒤 띄워요.
- 앱: 개발 서버(`import.meta.env.DEV`)이고 `VITE_SOCIAL_DEV_MOCK=true`일 때만 공급자 인가 주소를 가짜 Worker 주소로 바꿔 이동해요. 운영 빌드에서는 `import.meta.env.DEV`가 `false`로 바뀌어 코드가 빠져요(빌드 결과에 `__dev/social`이 없는지 확인).
- 왜 안전한가: 가짜 공급자는 지어낸 키로 서명한 토큰을 가짜 Worker 안에서만 받아요. 운영 Worker 코드(`src/`)는 `test/`를 가져오지 않고(시험으로 확인), 운영 앱 번들에는 바꿔 치는 코드가 없어요. PKCE·state·nonce·Redirect URI 검사는 실제와 같은 코드로 돌아요.

## 시험 계획

- Worker(`sync-worker/src/social.test.ts`): 성공(카카오·네이버, identity·email `''`), 403 + account(세션 안 생김), 소셜 꺼짐 404, 켜지 않은 공급자 400, Redirect URI 불일치·목록 비어 있음 400, 토큰 5xx·키 장애 503, 4xx `invalid-code`, 세션 전용 인증(동기화 API·기기 목록·철회), 허용 목록에서 빼면 403, Google 세션을 토큰 없이 쓰면 401, 로그에 계정·코드 없음, 0002 SQL이 패키지 파일과 같음, `main`이 `src/worker.ts`이고 `src/`가 `test/`를 가져오지 않음.
- 앱: 설정 읽기(소셜만·둘 다·없음), 콜백 꺼내기(`takeSocialCallback`: 경로·주소 지우기·돌아갈 화면), 컨트롤러 통합(가짜 공급자 + 실제 Worker 핸들러: 로그인·동기화·다시 열기·로그아웃·철회·403·503), 단추 노출 조건, 콜백 화면 오류 표시·복사, 인앱 안내, 가짜 공급자 이동 조건, 콜백 HTML·PWA 설정.
- E2E(`tests/e2e/social-callback.spec.ts`, 4173 포트의 운영 빌드): 콜백 주소가 즉시 지워지고 no-referrer가 걸리며 돌아가기가 동작.

## 사용자가 할 일

`sync-worker/README.md` 「카카오·네이버 로그인(선택)」에 순서대로 적어요(카카오 디벨로퍼스 → 네이버 개발자센터 → 원격 D1 마이그레이션 → Worker 비밀값 → 배포 → 앱 빌드 변수 → 첫 로그인 403의 account를 `ALLOWED_ACCOUNTS`에 → 실기기 확인([live-check ㉙](../../live-check.md))).
