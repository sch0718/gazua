# 초대 링크 가입 구현 계획 (2026-11-03)

설계: `docs/superpowers/specs/2026-11-03-invite-signup-design.md`. 패키지(`@sch0718/firebase-session` 0.3.0, toolkit PR #24)는 배포 전까지 로컬 링크로 쓴다(`node_modules/@sch0718/firebase-session`과 `sync-worker/node_modules/@sch0718/firebase-session`을 toolkit worktree 패키지로 심볼릭 링크). 모든 단계는 TDD(실패하는 시험 → 구현 → 통과).

## 과제 A: sync-worker (`sync-worker/`) — 완료(커밋 3245e20)

`sessions`·`cli_tokens`는 패키지에 사용자 단위 철회 helper가 없어 `removeMember`가 직접 `UPDATE`한다. `purgeInviteAttempts(env, now, limit)`.

1. `migrations/0007_members.sql`: `members`, `invite_attempts`와 인덱스(설계 2절 그대로).
2. `src/env.ts`: `INVITE_CODE?`(secret), `MEMBER_LIMIT?`(var) 추가. `wrangler.toml` `[vars]`에 `MEMBER_LIMIT = "20"`.
3. `src/members.ts`(새 파일):
   - `INVITE_MIN = 32`, `ATTEMPT_LIMIT = 5`, `ATTEMPT_WINDOW = 1시간`, `memberLimit(env)`(정수 아니면 20).
   - `codeMatches(a, b)`: SHA-256 두 개를 XOR로 모아 비교.
   - `isAdmin(env, user)`: Google이면 `parseAllowList(ALLOWED_EMAILS).has(email)`, 소셜이면 `parseAccountList(ALLOWED_ACCOUNTS).has(sub)`.
   - `isActiveMember(env, identity)`.
   - `allowMember(env, deps)`: 패키지 `isAllowed` 콜백(설계 2절 1~7단계).
   - `listMembers`, `removeMember(env, deps, ctx, identity)`: 관리자만, 세션·CLI 토큰 철회.
   - `purgeInviteAttempts(env, now)`.
4. `src/session.ts`: `createSessionAuth`에 `isAllowed: allowMember(env, deps)`.
5. `src/handler.ts`: `GET /v1/members`, `DELETE /v1/members/:identity`. `src/cors.ts`의 메서드 목록은 이미 DELETE를 포함하는지 확인.
6. `src/cli.ts`: `stillAllowed`를 비동기로 바꾸고 멤버 포함.
7. `src/purge.ts`: 시도 기록 정리, 로그 줄에 `inviteAttempts=` 추가(`worker.ts`).
8. 시험 `src/members.test.ts`(harness 사용): 설계 4절 항목 전부. 기존 `cli.test.ts`에 멤버 CLI 토큰 재확인·내보낸 뒤 401/403 시험.

검증: `cd sync-worker && pnpm test && pnpm check`.

## 과제 B: 앱 (`src/`)

1. `src/lib/sync/invite.ts`(새 파일): `INVITE_KEY = 'gazua:invite'`, `saveInvite(code)`, `readInvite()`, `clearInvite()`. localStorage 접근은 try/catch로 감싸 실패해도 조용히 넘어간다. 코드 형식 `^[A-Za-z0-9_-]{32,128}$`만 저장.
2. `src/lib/state/routes.ts`: `parseHash`가 `#/join/<코드>`를 `{ name: 'settings', section: 'sync', invite: <코드> }`로 읽는다(형식이 틀리면 `invite` 없이). `hashFor`는 `#/settings`(코드를 해시에 남기지 않는다).
3. `src/lib/state/app.svelte.ts`: `enter()`·`onHashChange()`에서 `parseHash` 직후, 관문·온보딩 판단보다 앞에서 `invite`가 있으면 `saveInvite`. 그래서 처음 설치한 기기(`onboarded: false`)에서 열어도 코드가 남는다. 그다음 해시는 기존 흐름대로(`normalize`가 `invite`를 버린다).
4. `src/lib/sync/api.ts`: `GazuaFail`에 `{ kind: 'invite'; code: 'invite-invalid' | 'members-full' }`, `mapStatus`에서 403 두 코드를 바꾼다. `createSession(idToken, label, extra?)`, `createSocialSession`은 패키지 서명 그대로(extra 포함). `listMembers()`(`GET /v1/members`), `removeMember(identity)`(`DELETE /v1/members/:identity`).
5. `src/lib/sync/controller.svelte.ts`:
   - `startSession`·소셜 `createSocialSession` 호출에 `readInvite()`가 있으면 `{ invite }`를 extra로 보낸다. 성공·`not-allowed`·`invite`면 `clearInvite()`.
   - `ERRORS['not-allowed']`, `onAuthFailure` 문구 →「초대가 필요하거나 이용이 끝난 계정이에요」. `describeFail`: `invite` → 코드별 문구, `limit`+`invite-limit` →「잠시 뒤 다시 시도해 주세요」.
   - `socialSessionFailure`: `invite` → `reason`을 그 코드로.
   - `members()`: 403(`server` 403 또는 `not-allowed`가 아님)이면 오류 배너 없이 `{ ok: false, reason: 'not-admin' }`, 성공이면 목록. `removeMember(identity)`. 기존 `cliTokens` 분기와 같은 꼴.
   - `invitePending`(읽기 전용 상태): 저장된 코드가 있는지(로그인 전 안내용).
6. `src/lib/sync/social.ts` 유니언에 `invite-invalid`·`members-full`, `src/lib/sync/socialText.ts`에 두 문구와 `not-allowed` 상세 문구 교체(허용 목록 대신 초대 안내).
7. `src/lib/ui/settings/SyncPanel.svelte`: `PHASE['not-allowed']` 문구 교체, 로그인 전 `invitePending`이면 「초대받았어요. 로그인하면 가입돼요」.
8. `src/lib/ui/settings/SyncManage.svelte`: 펼침 항목 「멤버」. 펼칠 때만 `members()`를 부르고, `not-admin`이면 「관리자만 볼 수 있어요」 한 줄, 아니면 목록(계정·가입일·상한)과 「내보내기」(확인 뒤).
9. 시험: `routes.test.ts`(join 파싱·hashFor), 온보딩 전 `#/join/…`에서 코드 저장(앱 상태 시험), controller(초대 extra 전달·지우기, 문구, members 403 배너 없음), `SyncManage` 멤버 펼침(관리자 목록·내보내기, 비관리자 한 줄), socialText.

검증: 루트 `corepack pnpm test`(해당 파일), `corepack pnpm check`.

## 과제 C: 문서와 마무리

1. `sync-worker/README.md`: `INVITE_CODE` 만들기·`wrangler secret put INVITE_CODE`, `MEMBER_LIMIT`, 코드 교체, 내보낸 사람 다시 들이기 SQL, 0007 마이그레이션 적용.
2. `docs/help/settings.md`: 초대 링크로 가입, 관리자 멤버 카드.
3. `docs/roadmap.md`: 초대 가입 구현됨, 확인 시점 2026-12-03.
4. 패키지 0.3.0 배포 뒤: 루트·`sync-worker` `package.json`을 `0.3.0`으로, `pnpm install`로 lockfile 갱신, 로컬 링크 제거, 전체 시험·타입 검사.
5. 구현 검토(cascade-fix 1회) → PR(「배포 전 사용자 작업」: 0007 원격 적용 → `INVITE_CODE` 시크릿 → Worker 배포 → 앱 배포).

순서: A와 B는 서로 파일이 겹치지 않아 나란히 한다(B는 A의 API 모양을 설계 문서대로 가정). C는 A·B 뒤.
