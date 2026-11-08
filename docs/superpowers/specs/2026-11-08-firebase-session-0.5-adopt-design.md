# firebase-session 0.5.0 적용 설계

전제: 운영자 1명·소수 지인·Cloudflare 무료. 사용자에게 보이는 동작은 바꾸지 않고, 공용 패키지로 옮긴 코드의 가즈아 사본을 걷어낸다.

## 왜 하나

`@sch0718/firebase-session@0.5.0`이 세션 API 6개 처리기(`handleSessionRoute`), 소셜 설정 조립(`socialLoginOptions`·`parseRedirectUris`), 개발·시험 도우미(`/testing`·`/testing/d1`)를 내보낸다. 가즈아·repass·랜드마크가 같은 코드를 따로 들고 있었다. 가즈아에서는 다음 문제도 함께 풀린다.

- `route()`가 `guard()` 밖에서 `decodeURIComponent`를 불러, `/v1/sessions/%ZZ` 같은 요청이 처리되지 않은 URIError가 되었다. CORS 헤더 없는 500이 났다.

## 바꾸는 것

1. **버전**
   - 루트 `@sch0718/firebase-session` 0.3.0 → 0.5.0, `@sch0718/vite-app` 0.1.0 → 0.1.1
   - `sync-worker`의 `@sch0718/firebase-session` → 0.5.0
   - vite-app 0.1.1은 `devCsp` 기본값에서 `http://[::1]:*`를 뺐다. 개발 서버 콘솔 경고가 사라진다.
2. **세션 라우트** (`sync-worker/src/handler.ts`)
   - ROUTES에서 세션 6줄을 지운다.
   - 출처가 맞고 OPTIONS가 아닌 요청은 먼저 `handleSessionRoute(req, sessions(env, deps), { onRoute, log })`에 넘긴다.
     - 응답이 오면 그것을 쓴다.
     - `null`이면 기존 `route()`로 간다.
     - 두 경우 모두 CORS 헤더를 붙인다.
     - `onRoute`는 로그 패턴(`pattern`)을 채운다.
     - `log`는 기존 형식 `METHOD pattern internal ...`으로 `deps.log`에 남긴다.
   - `route()` 호출을 `guard()` 안으로 옮기고, 매개변수 `decodeURIComponent`가 실패하면 404 `not-found`로 바꾼다. 세션 밖 경로(`/v1/profiles/%ZZ` 등)도 같은 문제를 안고 있었다.
   - 상태 코드
     - `DELETE /v1/sessions`는 쿼리가 정확히 `others=1` 하나가 아니면 400 `bad-request`다. 지금은 `others=1`만 보고 다른 쿼리가 더 붙어도 통과한다. 패키지 동작이 더 엄격하며, 앱 클라이언트는 `?others=1`만 보낸다.
     - `:id` 디코딩 실패는 404다.
     - 세션 경로에 다른 메서드가 오면 405 `method`로, 지금과 같다.
3. **소셜 설정** (`sync-worker/src/session.ts`)
   - 18-29행의 조립을 `socialLoginOptions({ allowedAccounts, kakao, naver, redirectUris: env.SOCIAL_REDIRECT_URIS, keys, fetch })`로 바꾼다.
   - `sessions()`를 export한다. `createSession`·`createSocialSession`·`listSessions`·`revokeSessions` 래퍼는 지우고 `authenticate`는 남긴다.
   - 동작 변화: 카카오는 시크릿 없이 ID만 있어도 켜진다(패키지 정책). 카카오 앱에서 클라이언트 시크릿을 켜 두었다면 시크릿을 넣어야 토큰 교환이 된다. `sync-worker/README.md`의 「시크릿이 없으면 카카오 로그인을 켜지 않아요」 문장을 고친다.
4. **개발용 가짜 공급자**
   - `sync-worker/test/devSocialEntry.ts`
     - 자체 인가·승인 화면을 지운다.
     - `createFakeSocial({ basePath: '/__dev/social' })`의 `handle(req, parseRedirectUris(env.SOCIAL_REDIRECT_URIS))`를 먼저 부른다.
     - `null`이면 `handle(req, env, { socialKeys: fake.keys, socialFetch: fake.fetch, ... })`로 넘긴다.
     - 패키지 `handle`은 로컬 요청(`isLocalRequest`)에만 응답한다. 이 진입점은 `wrangler dev` 전용이고 배포하지 않는다는 기존 조건은 그대로다.
   - 경로가 바뀐다. `/__dev/social/{provider}/authorize`는 `/__dev/social/authorize?provider=`가 된다. 계정 ID에는 `dev-` 접두가 붙는다.
   - `sync-worker/test/devSocial.ts`
     - 개발 env의 client ID·시크릿을 `FAKE_CLIENT_IDS`·`FAKE_CLIENT_SECRET`(`dev-fake-kakao`·`dev-fake-naver`·`dev-fake-secret`)로 바꾼다.
     - 기본 `ALLOWED_ACCOUNTS`는 `kakao:dev-user,naver:dev-user`로 그대로 둔다. 화면 기본값 `dev-user`는 이미 접두가 있다.
   - 안내 문구와 `sync-worker/README.md`의 `.env.local` 예시를 새 ID로 고친다.
   - 앱: `src/lib/sync/socialFlow.ts`의 개발 분기가 `@sch0718/firebase-session/testing`의 `fakeAuthorizeUrl(url, o.apiUrl + '/__dev/social')`를 동적 import한다. `import.meta.env.DEV` 분기 안이라 운영 번들에는 들어가지 않는다. `src/lib/sync/socialDev.ts`와 그 시험은 지운다.
   - `sync-worker/test/fakeSocial.ts`는 남긴다. 코드 1회 사용, 호출 기록, 키 장애처럼 서비스 시험만 쓰는 상태 있는 대역이라서다.
5. **시험 도우미**
   - `sync-worker/test/d1.ts`와 `d1.test.ts`를 지운다. `createTestD1({ migrations: new URL('../migrations', import.meta.url) })`(`/testing/d1`)를 쓴다. 기존 도우미도 FK를 켰다.
   - `sync-worker/test/harness.ts`의 RSA 서명기를 `createTestTokens({ projectId: PROJECT })`로 바꾼다.
     - `token()`은 `clock.now`와 기본 이메일 `ME`를 넘긴다.
     - `keys`·`otherKeys`·`exportJWK` export는 다른 시험이 쓰므로 유지한다. `keys`는 `createTestTokens`의 키로 바꾼다.
   - `devSocialEntry.test.ts`는 새 진입점에 맞게 줄인다. 시험할 것은 둘이다.
     - 로컬 요청에서 인가 화면 → 승인 → `/v1/session/social` 로그인이 이어진다.
     - 로컬이 아닌 요청은 가짜 공급자를 거치지 않는다.
   - 가짜 화면 자체의 세부 동작은 패키지가 시험한다.

## 바꾸지 않는 것

- 운영 Worker 진입점 `src/worker.ts`, 인증·세션 헤더 이름(`X-Gazua-Session`), 마이그레이션.
- 카카오 `prompt` 처리. 지금 방식이 맞다고 확인했다(gazua#90 보고).

## 검증

- 앱: `pnpm check`, `pnpm test`, `pnpm build`, `pnpm e2e`
- Worker: `pnpm --filter sync-worker check`, `pnpm --filter sync-worker test`
- 새 시험
  - `/v1/sessions/%ZZ`와 `/v1/profiles/%ZZ`에 404와 CORS 헤더가 오는지 본다.
  - 카카오 시크릿 없이 ID만 있으면 카카오가 켜지는지 본다. 기존 「시크릿이 비면 끈다」 시험을 바꾼다.
- 사람 확인: 배포 뒤 실제 카카오·네이버 로그인
