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

## 구현하며 바뀐 것 (2026-10-29)

- **첫 로딩 크기.** 패키지 `/client` 색인이 소셜 실행 코드(`social.js`: PKCE·`beginSocialSignIn`·`readSocialCallback`)를 다시 내보내서, 지연 로드한 `socialFlow`만 쓰는데도 첫 청크에 들어갔어요. `vite.config.ts`의 `manualChunks`로 `social` 청크에 따로 두고, 설정 읽기(`readSocialConfig`)는 `config.ts`에 같은 규칙으로 직접 구현했어요(패키지 함수와 같은지 시험). 실패 안내 문구는 콜백 화면만 쓰는 `socialText.ts`로 옮겼어요. 첫 청크는 803.45 kB(gzip 278.00) → 810.62 kB(gzip 280.50)예요. 늘어난 7 kB는 컨트롤러·설정 패널·진입점의 소셜 분기예요.
- **가짜 인가 화면의 CSP.** Chromium은 폼 제출 뒤 리다이렉트 대상에도 `form-action`을 적용해서 `'self'`만 두면 승인 뒤 앱으로 돌아가지 못했어요. 검사한 콜백 출처를 `form-action`에 더했어요(인앱 브라우저에서 확인).
- **0002 누락 진단.** 패키지가 던지는 `@sch0718/firebase-session:` 안내 오류는 내부 오류 로그에 문구까지 남겨요(그 밖의 오류는 지금처럼 이름만).
- **다시 로그인.** 콜백 화면의 「다시 로그인」은 처음 저장한 돌아갈 화면을 그대로 넘겨요(콜백 주소에는 원래 해시가 없어서).
- **리퍼러 정책 복구.** 콜백 화면을 끝내거나 콜백 화면 없이 앱을 열 때 메타의 content를 `strict-origin-when-cross-origin`으로 바꿔요. 메타를 지우는 것만으로는 정책이 복구되지 않아요.
- **청크 로드 전 주소 정리.** 콜백 경로에서는 원래 주소를 보관하고 code·state·error·error_description만 동기적으로 지워요. 다른 쿼리·해시는 남기고, 지연 로드한 콜백 처리에는 원래 주소를 넘겨요.
- **공용 기기 재인증.** 로그아웃 뒤 재인증 요청을 sync store meta에 남기고 로그인 성공 때 지워요(저장소가 없으면 메모리). 카카오에만 `prompt=login`을 보내되 카카오톡 인앱 브라우저에서는 공식 문서상 지원하지 않아 보내지 않으며, 403 화면의 「다시 로그인」은 저장된 재인증 플래그를 따르고, 카카오 일반 브라우저에서는 「다른 계정으로 로그인」 단추로 재인증을 따로 요청해요. 재인증 플래그 읽기 실패나 1.5초 넘는 연결 대기는 재인증으로 이어 가요. 네이버에는 prompt를 보내지 않고 공급자 로그아웃을 안내해요.
- **처리 중 돌아가기.** 10초가 지나면 안내와 「돌아가기」를 보여 줘요. 돌아가거나 앱 연결·세션 응답이 20초 넘게 없으면 요청은 유지한 채 기다림과 busy를 풀어요. 늦은 성공은 세션을 보관하고, 늦은 실패는 오류를 남기며 둘 다 컨트롤러가 알려 줘요. 화면은 기존 alive 검사로 늦은 결과를 무시해요. 콜백 화면 청크를 못 받아도 안내와 「돌아가기」를 보여 주고 리퍼러 정책을 복원해요.
- **늦은 소셜 결과의 세대 검사.** 기다림을 끝낸 뒤 사용자가 로그아웃·Google 로그인을 하면 늦은 성공이 다시 로그인시키거나 Google 세션을 카카오로 바꾸고, 공용 기기 재인증 플래그까지 지웠어요. 컨트롤러에 `authGeneration`을 두고 `signOut`·`signIn`·`signInWith`·`startSession`·소셜 세션 수락·`completeSocialSignIn` 시작이 동기적으로 올려요(세션 철회 응답 같은 `forget`은 올리지 않아요). 기다림을 끝낸 시도는 결과가 왔을 때와 수락 중 await마다 세대를 다시 보고, 바뀌었으면 세션·계정·재인증 플래그·오류·스낵바를 건드리지 않아요. 늦은 성공이 만든 서버 세션은 그 세션 ID만 세션 헤더로 실어 `DELETE /v1/session`(`endSessionById`, Google 토큰·현재 세션은 보내지 않음)으로 철회하고, 철회가 실패하면 고아로 남아 서버 만료로 정리돼요. 세대가 그대로면 지금처럼 받아들여 알리고, 타임아웃 화면이 열려 있으면 `onLate`로 성공은 원래 화면으로 돌아가고 실패는 실제 실패 안내로 바꿔요.
- **검토 반영 뒤 첫 청크.** 810.62 kB(gzip 280.50) → 811.75 kB(gzip 280.89). 늘어난 1.1 kB는 진입점의 주소 정리·리퍼러 복구, 설정 패널의 문구 분기·로그아웃 안내, 컨트롤러의 재인증 플래그예요. 재검토 반영(응답 대기 제한·늦은 결과 알림·재인증 플래그 읽기·콜백 청크 실패 안내) 뒤 813.33 kB(gzip 281.49)예요. 늦은 결과 세대 검사 뒤 814.16 kB(gzip 281.78)예요.
