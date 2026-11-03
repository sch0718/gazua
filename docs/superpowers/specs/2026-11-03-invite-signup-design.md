# 초대 링크 가입 설계 (2026-11-03)

## 전제와 목적

- 전제: 사용자 1명(관리자)과 테스트를 부탁할 지인 몇 명, 무료 운영, 공개 서비스 아님.
- 지금은 새 사람이 들어올 때마다 Worker 시크릿 `ALLOWED_EMAILS`·`ALLOWED_ACCOUNTS`를 고치고 다시 배포해야 한다.
- 이미 있는 것으로는 안 되는 이유: 허용 목록은 시크릿이라 앱 안에서 늘릴 수 없고, 바꿀 때마다 관리자가 계정 식별자(카카오 `sub` 등)를 받아 적어야 한다.
- 고른 안(2026-11-03): 공용 초대 코드 하나, 멤버 수 상한, 관리자는 기존 허용 목록 계정, 설정에서 멤버 목록·내보내기. 1인 1회용 링크는 하지 않는다.

## 범위 밖

- 1인 1회용 초대, 초대 만료 시각, 역할·권한 단계, 멤버 데이터 자동 삭제, 내보낸 멤버 다시 들이기 UI(필요하면 SQL 한 줄, README에 적음).

## 1. `@sch0718/firebase-session` (toolkit 저장소)

허용 여부를 앱이 판단하는 함수 옵션 하나를 더한다. 고정 목록 동작은 그대로다.

```ts
interface SessionAuthOptions {
  // ...기존
  /**
   * 고정 목록(allowedEmails·social.allowedAccounts)에 없는 사용자를 앱이 판단한다. 목록에 있으면 부르지 않는다.
   * identity: Google은 소문자 이메일(email_verified인 것만), 소셜은 'kakao:<sub>'·'naver:<sub>'.
   * signup: 세션을 만드는 요청(POST /v1/session·/v1/session/social)일 때만 있고, 요청 본문을 그대로 담는다.
   * HttpError를 던지면 그 상태·코드로 응답한다(예: 403 invite-invalid).
   */
  isAllowed?: (who: { identity: string; provider: 'google' | SocialProvider }, signup?: { body: unknown }) => boolean | Promise<boolean>;
}
```

적용 지점(모두 「목록에 없을 때만」 부른다):

| 경로 | 지금 | 바뀐 뒤 |
|---|---|---|
| Google 매 요청(`verifiedUser`) | `allowedEmails.has` | 없으면 `isAllowed({identity: email})` |
| Google 세션 만들기(`create`) | 같음 | 재인증 창(5분) 검사 뒤 `isAllowed(…, {body})` |
| 소셜 세션 만들기(`exchangeSocial`) | `allowedAccounts.has` | 공급자 토큰 검증 뒤 `isAllowed(…, {body})` |
| 소셜 세션 인증(`authenticate`) | `allowedAccounts.has` | 없으면 `isAllowed({identity})` |

- `verifyIdToken`에 선택 인자 `isAllowed?: (user) => boolean | Promise<boolean>`을 더한다. `email_verified`가 아니거나 이메일이 비면 부르지 않고 그대로 `not-allowed`다.
- `create`는 토큰 검사(`verifiedUser`)를 할 때부터 `signup = { body }`를 넘긴다. 그래서 목록에 없는 새 사람도 매 요청 경로(signup 없음)에서 먼저 거절되지 않고, 한 번의 `isAllowed(…, {body})`로 가입한다. 재인증 창이 지난 토큰이면 `isAllowed`를 부르기 전에 401 `reauth-required`다(가입 부수효과가 오래된 토큰으로 일어나지 않게).
- 클라이언트: `createSession(idToken, label, extra?)`, `createSocialSession(input, label, extra?)`. `extra`는 본문에 합치되 `label`과 소셜 입력 필드가 이긴다. 가즈아는 `extra = { invite }`로 쓴다.
- 서버 본문 검사: 소셜 `readBody`는 모르는 필드를 이미 통과시킨다(`nonce`만 거절). Google 본문은 `label`만 읽는다. 바꿀 것 없음.
- 마이그레이션 없음. 마이너 버전(0.3.0) changeset.
- 순서: toolkit PR 병합·0.3.0 배포 → 가즈아 루트와 `sync-worker` 두 `package.json`의 고정 버전(`0.2.1`)을 `0.3.0`으로 올림. 그 전에는 로컬 링크로 개발한다.

## 2. 가즈아 sync-worker

### D1 (`0007_members.sql`)

```sql
CREATE TABLE members (
  identity TEXT PRIMARY KEY,   -- 소문자 이메일 또는 'kakao:<sub>'·'naver:<sub>'
  joined_at INTEGER NOT NULL,
  removed_at INTEGER            -- 내보낸 시각. NULL이면 멤버
);
CREATE TABLE invite_attempts (identity TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX invite_attempts_identity ON invite_attempts(identity, at);
```

### 환경값

- `INVITE_CODE`(secret): 공용 초대 코드. 32자 미만이거나 없으면 초대 가입을 닫는다(맞는 코드가 없는 것과 같다). 추측을 막는 진짜 방어선은 이 길이(base64url 32자 = 192비트)이고, 아래 시도 제한은 덧댄 장치다.
- `MEMBER_LIMIT`(var, 기본 20): 내보내지 않은 멤버 수 상한. 관리자(고정 목록)는 세지 않는다.

### `members.ts`

`isAllowed(env, deps)`가 패키지 옵션에 들어간다.

1. `members`에 `removed_at IS NULL`인 행이 있으면 허용.
2. `signup`이 없거나 본문에 `invite` 문자열이 없으면 거절(`not-allowed`, 앱은 「초대가 필요해요」).
3. 내보낸 사람(`removed_at` 있음)이면 거절(`not-allowed`). 코드를 알아도 다시 못 들어온다.
4. 시도 제한: 먼저 `invite_attempts`에 1건을 적고, 그다음 최근 1시간 그 identity의 건수를 센다. 5건을 넘으면 429 `invite-limit`(맞는 코드여도). 「적고 나서 세기」라 동시 요청도 각자 늘어난 수를 본다. 전체 상한은 두지 않는다(아무 계정으로나 정상 가입을 막는 데 쓰일 수 있다).
5. 코드 비교: 두 값의 SHA-256을 바이트마다 XOR로 모아 비교(상수 시간). 틀리면 403 `invite-invalid`(4의 기록이 실패 1건으로 남는다).
6. 상한: `INSERT INTO members … SELECT ?, ? WHERE (SELECT COUNT(*) FROM members WHERE removed_at IS NULL) < ? ON CONFLICT(identity) DO NOTHING` 한 문장으로 넣는다(SQLite가 문장 단위로 직렬화하므로 동시 가입도 상한을 넘지 못한다). 바뀐 행이 0이면 활성 멤버인지 다시 보고(같은 사람의 동시 가입), 멤버면 허용, 아니면 403 `members-full`.
7. 성공하면 그 identity의 시도 기록을 지우고 허용.

- 시도 기록은 cron `purge`에서 하루 지난 것을 지운다.
- 코드를 바꾸면 새 가입만 막히고 기존 멤버는 1번에서 통과한다.

### 관리자와 API

- 관리자 = 지금 고정 목록에 있는 계정(Google `ctx.user.email`, 소셜 `ctx.user.sub`). 판정 함수 하나(`isAdmin`)를 두고 시험으로 고정한다.
- `GET /v1/members` → `{ members: [{ identity, joinedAt }], limit }`. 활성 멤버(`removed_at IS NULL`)만 가입일 순. 관리자(고정 목록)와 내보낸 사람은 담지 않는다. 관리자가 아니면 403 `not-admin`.
- `DELETE /v1/members/:identity` → `removed_at` 기록, 그 사람의 모든 기기 세션과 CLI 토큰을 철회(`users.firebase_sub = identity OR users.email = identity`). 관리자가 아니면 403, 멤버가 아니면 404.
- 내보낸 뒤에도 Google 매 요청·소셜 세션·CLI가 멤버 여부를 다시 보므로 철회가 늦어도 들어오지 못한다.

### CLI `stillAllowed`

- 고정 목록에 없으면 `members`에서 `removed_at IS NULL`을 본다(비동기로 바꾼다). identity는 소셜이면 `sub`, Google이면 소문자 이메일.

## 3. 가즈아 앱

- 라우트 `#/join/<코드>`: 코드를 `localStorage`의 `gazua:invite`에 두고(온보딩 전 기기에서도 관문 판단보다 먼저 저장) 해시를 지운 뒤 설정 동기화 구역으로 보낸다. 안내: 「초대받았어요. 로그인하면 가입돼요」. 코드는 해시에 남기지 않는다.
- 로그인(`createSession`·`createSocialSession`) 때 저장된 코드가 있으면 `extra = { invite }`로 보낸다. 성공하거나 `not-allowed`·`invite-invalid`·`members-full`이면 지운다(내보낸 사람의 기기에 코드가 남아 계속 보내지지 않게).
- 패키지 클라이언트는 403 중 `not-allowed`만 살리고 나머지 코드는 버리므로, 가즈아 `mapStatus`가 403 `invite-invalid`·`members-full`을 `{ kind: 'invite', code }`로 바꾼다. 소셜 결과 `reason` 유니언과 문구 표에도 두 값을 더한다. 429 `invite-limit`은 기존 `limit`으로 온다.
- 실패 문구: `not-allowed` →「초대가 필요하거나 이용이 끝난 계정이에요」, `invite-invalid` →「초대 링크가 맞지 않아요」, `members-full` →「초대 자리가 다 찼어요」, `invite-limit` →「잠시 뒤 다시 시도해 주세요」.
- 설정 동기화 구역의 관리 항목(`SyncManage`)에 「멤버」 펼침: 펼칠 때만 `GET /v1/members`를 부른다. 403이면 오류 배너 없이 「관리자만 볼 수 있어요」 한 줄, 200이면 목록(계정·가입일·상한)과 「내보내기」(확인 후 DELETE).

## 4. 시험으로 고정할 보안 경계

- 시도 제한: identity당 1시간 5회(동시 요청 포함), 6번째는 맞는 코드여도 429, 시간이 지나면 풀림, 성공하면 기록이 지워짐.
- 같은 사람의 동시 가입: 둘 다 성공(500 없음).
- 목록에 없는 새 Google 계정이 맞는 코드로 가입되고, 다음 요청부터는 코드 없이 통과.
- 상한 경쟁: 상한 1자리 남은 상태에서 서로 다른 두 사람이 동시에 가입하면 한 명만 된다.
- 관리자 판정: 멤버는 `/v1/members`에 403, 고정 목록 Google·소셜 계정은 200.
- 내보낸 멤버: 기존 세션·CLI 토큰 401/403, 코드로 다시 가입 불가.
- 코드 미설정·짧은 코드: 가입 불가.
- 패키지: 목록에 있으면 `isAllowed`를 부르지 않는다, 미검증 이메일은 부르지 않는다, 재인증 창 밖이면 가입 경로에서 부르지 않는다, `HttpError`가 그대로 응답이 된다.

## 5. 문서

- `sync-worker/README.md`: `INVITE_CODE` 만들기(`openssl rand -base64 24 | tr '+/' '-_' | tr -d '='`)와 `wrangler secret put`, `MEMBER_LIMIT`, 코드 교체, 내보낸 사람 다시 들이기 SQL.
- 도움말 `docs/help/settings.md`: 초대 링크로 가입하기, 관리자 멤버 카드.
- `docs/roadmap.md`: 초대 가입 구현됨.
- 실제로 쓰는지 확인할 시점: 2026-12-03. 그때까지 멤버가 0명이면 걷어내는 PR을 제안한다.
