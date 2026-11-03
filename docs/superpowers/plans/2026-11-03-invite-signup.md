# 초대 링크 가입 구현 계획 (2026-11-03)

설계: `docs/superpowers/specs/2026-11-03-invite-signup-design.md`. 패키지(`@sch0718/firebase-session` 0.3.0, toolkit PR #24)는 배포 전까지 로컬 링크로 쓴다(`node_modules/@sch0718/firebase-session`과 `sync-worker/node_modules/@sch0718/firebase-session`을 toolkit worktree 패키지로 심볼릭 링크). 모든 단계는 TDD(실패하는 시험 → 구현 → 통과).

## 과제 A: sync-worker (`sync-worker/`)

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

1. `src/lib/state/routes.ts`: `#/join/<코드>` → `{ name: 'settings', section: 'sync', invite: <코드> }`. `hashFor`는 코드를 남기지 않는다(`#/settings`). 코드 형식 `^[A-Za-z0-9_-]{32,128}$`, 아니면 초대 없이 설정으로.
2. 앱 상태(`app.svelte.ts`)에서 `invite`가 있으면 `localStorage['gazua.invite']`에 저장하고 해시를 `#/settings`로 바꾼다. 저장 실패는 무시.
3. `src/lib/sync/api.ts`: `mapStatus`에 403 `invite-invalid`·`members-full` → `{ kind: 'invite', code }`. `listMembers()`, `removeMember(identity)` 메서드. `createSession`·`createSocialSession`에 `extra` 전달.
4. `src/lib/sync/controller.svelte.ts`: 로그인 때 저장된 코드를 `extra = { invite }`로 보내고, 성공·`not-allowed`·`invite`면 지운다. 문구(설계 3절). 소셜 `reason` 유니언(`social.ts`)에 `invite-invalid`·`members-full` 추가.
5. `src/lib/ui/settings/Members.svelte`(새 파일): `listMembers`가 200일 때만 보이는 카드, 목록과 「내보내기」(확인 뒤 DELETE). `SyncPanel.svelte`(또는 `SyncManage.svelte`)에 붙인다. 초대 코드가 저장돼 있으면 로그인 전 안내 「초대받았어요. 로그인하면 가입돼요」.
6. 시험: `routes.test.ts`, `api` 매핑, controller 초대 전달·지우기, `Members.test.ts`(관리자만 보임, 내보내기 확인).

검증: 루트 `pnpm test`(해당 파일), `pnpm check`(svelte-check·tsc).

## 과제 C: 문서와 마무리

1. `sync-worker/README.md`: `INVITE_CODE` 만들기·`wrangler secret put INVITE_CODE`, `MEMBER_LIMIT`, 코드 교체, 내보낸 사람 다시 들이기 SQL, 0007 마이그레이션 적용.
2. `docs/help/settings.md`: 초대 링크로 가입, 관리자 멤버 카드.
3. `docs/roadmap.md`: 초대 가입 구현됨, 확인 시점 2026-12-03.
4. 패키지 0.3.0 배포 뒤: 루트·`sync-worker` `package.json`을 `0.3.0`으로, `pnpm install`로 lockfile 갱신, 로컬 링크 제거, 전체 시험·타입 검사.
5. 구현 검토(cascade-fix 1회) → PR(「배포 전 사용자 작업」: 0007 원격 적용 → `INVITE_CODE` 시크릿 → Worker 배포 → 앱 배포).

순서: A와 B는 서로 파일이 겹치지 않아 나란히 한다(B는 A의 API 모양을 설계 문서대로 가정). C는 A·B 뒤.
