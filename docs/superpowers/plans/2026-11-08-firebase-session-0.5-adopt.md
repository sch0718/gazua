# firebase-session 0.5.0 적용 계획

설계: `docs/superpowers/specs/2026-11-08-firebase-session-0.5-adopt-design.md`

## 순서

1. **버전 올리기**
   - 루트 `package.json`: `@sch0718/firebase-session` 0.5.0, `@sch0718/vite-app` 0.1.1
   - `sync-worker/package.json`: `@sch0718/firebase-session` 0.5.0
   - `pnpm install`로 `pnpm-lock.yaml`을 갱신한다.
   - `/testing/d1`은 Node 22.16 이상이 필요하다(`statement.columns()`).
     - 루트 `engines.node`를 `>=22.16`으로 올린다.
     - `docs/development.md`의 「Node 22 이상」을 「Node 22.16 이상」으로 고친다.
     - CI와 배포의 `node-version: 22`는 최신 22.x를 받으므로 그대로 둔다.
2. **`sync-worker/src/session.ts`**
   - `socialLoginOptions`로 조립한다.
   - `export const sessions`로 내보낸다.
   - 래퍼 넷을 지우고 `authenticate`는 남긴다.
3. **`sync-worker/src/handler.ts`**
   - 세션 6줄과 래퍼 import를 지운다. `handleSessionRoute`와 `sessions`를 import한다.
   - `handle()`의 출처 통과 분기를 바꾼다.
     ```ts
     res = (await handleSessionRoute(req, sessions(env, deps), {
       onRoute: (p) => { pattern = p; },
       log: (m) => deps.log(`${req.method} ${pattern} ${legacyInternal(m)}`),
     })) ?? await guard(req, deps, () => pattern, async () => {
       const r = route(req.method, url.pathname);
       // ...
     });
     ```
     `route()`는 guard 안에서 부른다.
   - `legacyInternal(m)`은 패키지 로그를 기존 형식으로 바꾼다. 일반 오류 `@sch0718/firebase-session: internal <Name>`은 `internal <Name>`이 된다. 그 밖의 패키지 안내 문구 `@sch0718/firebase-session: ...`은 `internal Error <문구>`가 된다. 기존 `sync-worker/src/social.test.ts`의 177·184행 로그 시험이 그대로 통과해야 한다.
   - `route()`의 `decodeURIComponent`는 실패하면 `HttpError(404, 'not-found')`를 던진다.
4. **시험 도우미**
   - `sync-worker/test/harness.ts`: `createTestD1`을 `@sch0718/firebase-session/testing/d1`에서 `migrations`와 함께 받는다. 토큰은 `createTestTokens({ projectId: PROJECT })`로 만든다. 기존 `token(claims, o)` 인터페이스는 그대로 두고, 호출마다 `tokens.token({ email: ME, ...claims }, { ...o, now: clock.now })`를 부른다. 가상 시계를 쓰므로 `Date.now`로 서명하지 않는다.
   - `sync-worker/test/d1.ts`와 `sync-worker/test/d1.test.ts`를 지운다.
   - 다른 시험이 `./d1`이나 `../test/d1`을 import하면 패키지로 바꾼다.
5. **시험 갱신**
   - `sync-worker/src/social.test.ts`: 「시크릿이 비면 해당 공급자를 끈다」 시험을 둘로 나눈다. 카카오는 시크릿이 없어도 켜지고 토큰 요청에 `client_secret`이 없다. 네이버는 시크릿이 없으면 꺼진다.
   - 이 변화 때문에 `fakeSocial.ts`가 시크릿 없는 카카오 교환을 거절하면, 카카오 시크릿이 없을 때 `client_secret` 없이도 받도록 고친다.
   - `sync-worker/src/session.test.ts` 등에 시험을 더한다. 로그인한 세션(`h.login()`의 `as`)으로 허용 Origin을 붙여 보낸다.
     - `DELETE /v1/sessions/%ZZ`와 `GET /v1/profiles/%ZZ`: 404 `not-found`와 `Access-Control-Allow-Origin`
     - `DELETE /v1/sessions?others=1&x=1`: 400 `bad-request`
     - 패키지는 인증을 먼저 하므로, 인증이 없으면 401이 맞다.
6. **개발용 가짜 공급자**
   - `sync-worker/test/devSocialEntry.ts`를 패키지 `createFakeSocial({ basePath: '/__dev/social' })`로 다시 쓴다.
   - `sync-worker/test/devSocial.ts`의 vars와 안내 문구를 `dev-fake-*`로 바꾼다.
   - `sync-worker/test/devSocialEntry.test.ts`를 두 시험으로 줄인다.
     - 로컬 요청(`http://localhost:8788`): 인가 화면 → 승인 → 허용 Origin을 붙인 `/v1/session/social` 로그인 200
     - 비로컬 요청(`https://sync.example.test`)에 허용 Origin을 붙이면 가짜 경로가 서비스 라우터로 넘어가 404가 된다.
7. **앱**
   - `src/lib/sync/socialFlow.ts`의 개발 분기를 `await import('@sch0718/firebase-session/testing')`의 `fakeAuthorizeUrl(url, o.apiUrl + '/__dev/social')`로 바꾼다.
   - `src/lib/sync/socialDev.ts`와 `socialDev.test.ts`를 지운다.
   - `src/lib/sync/socialFlow.test.ts`의 개발 분기 기대값을 고친다. 새 경로는 `/__dev/social/authorize`이고, 쿼리에 `provider=kakao`가 붙으며 기존 쿼리는 그대로 남아야 한다.
   - 운영 빌드 결과물에 `dev-fake`·`createFakeSocial` 문자열이 없는지 확인한다.
8. **문서** (`sync-worker/README.md`)
   - 개발 `.env.local` 예시를 `dev-fake-kakao`·`dev-fake-naver`로 고친다.
   - 카카오 시크릿 문장을 고친다.
   - 오류 재현 안내(`error-503`·`error-code`·`no-id-token` 계정)를 새 화면의 「로그인 결과」 선택으로 바꾼다. 선택지는 정상, 취소, 공급자 오류, 코드 거절, 공급자 장애다. 토큰 누락은 개발 화면에서 지원하지 않는다고 적는다(서비스 시험의 `fakeSocial.ts`가 맡는다).

## 검증

- `pnpm --filter sync-worker check`, `pnpm --filter sync-worker test`
- `pnpm check`, `pnpm test`, `pnpm build`, `pnpm e2e`
- `grep -r "dev-fake\|createFakeSocial" dist` 결과가 비어야 한다.
- 사람 확인(배포 뒤): 실제 카카오·네이버 로그인
