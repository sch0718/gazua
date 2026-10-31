# 키 동기화 설계

작성 2026-10-31. 기반 문서는 사용자와 합의한 「키 동기화 설계 합의 내용」(2026-10-31, 사용자 승인), [서버·DB 도입 검토](../../proposals/2026-10-25-server-and-db.md) 2절의 「증권사 키·프록시 토큰: 이후에도 사용자가 항목별로 E2EE 동기화를 직접 켠 경우에만 서버에 보관」, [동기화 1단계 계획](../plans/2026-10-25-sync-phase1.md)이다. 조사 기준은 `main` `52c1d51`이다. 검토 1~5회차(Opus) 지적을 반영했다.

## 1. 목표와 범위

### 1.1 목적
지금 동기화는 프로필 이름·분석 설정·그룹·전략·선정 기준·묶음만 맞추고 증권사 키는 올리지 않는다. 새 기기에서는 KIS·토스 키를 다시 붙여 넣어야 한다. 이번 작업으로 다음이 된다.

- 프로필마다 「키도 동기화(암호화)」를 켜면, 그 프로필에서 고른 공급자(KIS·토스)의 키가 **동기화 전용 암호로 기기에서 암호화된 뒤** 서버에 올라간다. 서버는 암호문만 본다.
- 다른 기기에서 같은 계정으로 로그인해 동기화하면 "키를 받을 수 있어요"가 뜨고, 동기화 암호를 넣어 받는다. 받은 키는 그 기기의 키 잠금 설정대로 보관한다.
- 한 기기에서 키를 고치면 다른 기기에 알린다. 조용히 덮어쓰지 않는다.

성공 기준은 다음과 같다.
- 기기 A에서 켜고, 기기 B에서 동기화 암호 한 번과 「받기」 한 번으로 같은 키가 B의 연결 설정에 들어간다.
- 서버(D1)·로그·공유 링크·프로필 문서·과거 리비전 어디에도 평문 키가 없고, 공유 경로에는 암호문도 없다.

### 1.2 지금 구조 (바꾸지 않는 것)
- 기기 키는 `gazua:v1:p:<id>:secrets`에 평문 `Secrets` 또는 잠긴 `LockedSecrets`(`src/lib/state/secrets.ts`, PBKDF2-SHA256 **310000**회, `enc/iv/salt/kdf/iter`)로 있다. 기기 키 잠금의 형식·회수는 그대로 둔다. 키 동기화는 이것과 다른 암호·다른 KDF 회수를 쓴다.
- 키 잠금은 `app.setSecrets(s, passphrase)`로만 켜고 `disableKeyLock()`으로만 끈다(`app.svelte.ts` `updateSettings`의 검사). 다른 탭이 키 항목을 바꾸면 `onStorage`(`app.svelte.ts` :553 근처)가 잠금 상태를 맞춘다.
- 동기화 엔진(`src/lib/sync/engine.ts`)은 `serial` + Web Lock `gazua-sync`(`controller.svelte.ts` `webLock`)으로 탭 사이에서도 한 번에 하나만 돈다. `syncNow`는 `run(['pull', 'push'])`다.
- 기기 세션 ID는 탭 메모리에 있다. 컨트롤러가 `attach`에서 IndexedDB `SESSION_KEY`를 한 번 읽고(`controller.svelte.ts` :358), 그 뒤에는 메모리 값(`session`)만 쓴다. `signOut`은 `endSession`이 실패해도 이 기기에서 로그아웃을 마친다.
- 동기화 저장소 `gazua-sync`는 IndexedDB 버전 1이고 `openDB`에 `blocking`·`blocked` 처리가 없다(`store.ts` `openSyncStore`). PWA는 `@sch0718/vite-app`의 `autoUpdate`·`skipWaiting`이라 옛 번들 탭과 새 번들 탭이 함께 열려 있기 쉽다.
- 프로필 문서(`ProfileDocV1`, `dto.ts`)와 공유 스냅샷(`snapshot.ts` `checkShareSnapshot`)은 `FORBIDDEN_KEYS`(`forbidden.ts`)를 어느 깊이에서든 먼저 거절한다. 이미 `secrets`·`appKey`·`appSecret`·`clientId`·`clientSecret`·`proxyToken`·`token`·`enc`·`iv`·`salt`·`kdf`·`iter`가 들어 있다.
- 프로필 삭제는 tombstone이고 30일 뒤 Cron `purge`가 지운다(`profiles.ts` `deleteProfile`, `purge.ts`). 복구는 `restoreProfile`이다. `purge` batch는 `profiles`·`revisions`·`shares`를 지운 뒤 **마지막에** `profile_index` 행을 지운다.
- 접근 토큰(`p:<id>:token:<provider>`)과 발급 시각(`p:<id>:tokenIssuedAt:kis`)은 기기 것이다. 토스는 키마다 유효한 토큰이 하나다(`docs/providers.md`).
- `readJson`(`@sch0718/firebase-session/worker`)은 본문이 없으면 400 `bad-json`을 던진다. 본문 없는 DELETE(`revokeShare`)는 `readJson`을 부르지 않는다.

### 1.3 사용자 결정 (2026-10-31)

| # | 항목 | 결정 |
|---|---|---|
| 1 | 단위 | 프로필마다 「키도 동기화(암호화)」 토글. 기본 꺼짐. 동기화가 켜져 있어야 보인다 |
| 2 | 암호 | 계정에 하나인 「동기화 전용 암호」. 기기 키 잠금 암호와 별개. 기기 저장소에 저장하지 않는다. 받은 키는 그 기기의 키 잠금 설정대로 보관 |
| 3 | 강도 | 12자 이상(확인 입력) + PBKDF2-SHA256 600000회. WebCrypto만, 새 의존성 없음 |
| 4 | 대상 | KIS·토스 키만(어느 쪽을 올릴지는 결정 9). `proxyToken`·접근 토큰(`token`·`tokenIssuedAt`)은 기기별, 동기화하지 않는다 |
| 5 | 충돌 | 알리고 고르게 한다. 서버 키가 더 새것이면 「키를 받을 수 있어요 / 다른 기기에서 키가 바뀌었어요 [받기]」, 이 기기에도 올리지 않은 변경이 있으면 「이 기기 키 올리기 / 서버 키 받기」. 조용히 덮어쓰지 않는다. 자동 받기는 하지 않는다 |
| 6 | 삭제 | 토글 끄기·프로필 삭제(tombstone) 때 그 암호문을 즉시 삭제(과거 리비전·30일 복구 없음). 설정에 「서버의 키 모두 지우기」. 다른 기기에 이미 받은 키는 남는다고 안내 |
| 7 | 암호 기억 | 탭이 열려 있는 동안 메모리(추출 불가 `CryptoKey`). 저장소에 남기지 않는다. 탭 닫기·`lock()`·로그아웃·계정 전환 때 잊는다. 기억 중에 키를 고치면 자동으로 올린다 |
| 8 | 접근 | A. 별도 「키 금고」 API. B(프로필 문서 안 암호문)·C(프로필별 독립 블롭)는 기각 |

아래 9~13번은 이 설계 초안의 질문(10절)에 사용자가 답한 것이다(2026-10-31 추가).

| # | 항목 | 결정 |
|---|---|---|
| 9 | 토스 키 | 공급자별로 고른다. 토글 아래 KIS·토스 체크를 두고 KIS는 기본 켬, 토스는 기본 끔. 토스를 켤 때 토큰 경고를 보인다. 세부는 5.5 |
| 10 | 강도 | 12자 이상 + 서로 다른 글자 4개 이상 + 128자 상한 + NFC 정규화(3.4 초안대로) |
| 11 | 기기 잠금 암호와 같은 동기화 암호 | 막지 않는다 |
| 12 | 「이 기기에서 키 삭제」 | 서버 키는 그대로 둔다. 올릴 변경으로도 치지 않는다 |
| 13 | e2e | 동기화 설정이 든 두 번째 빌드는 만들지 않는다. 키 화면은 컴포넌트 테스트 + axe로 덮는다. 기존 `pnpm e2e`는 통과해야 한다 |

### 1.4 설계에서 정한 기본값

사용자 결정 밖의 세부다.

| 항목 | 기본값 |
|---|---|
| 와이어 이름 | 금고 `keyVault`, 금고 ID `vaultId`, 블롭 목록 `keyBlobs`, AES-GCM 값 `nonce`·`ciphertext`, 확인값 `verifier`, 금고 리비전 `vaultRevision`, 내용 ID `contentId`. 이 여덟을 `FORBIDDEN_KEYS`에 더한다(2.4). KDF 값은 이미 금지된 `kdf`·`iter`·`salt`를 그대로 쓴다 |
| 금고 ID | 금고를 만들 때 기기가 정하는 무작위 16바이트. rekey에서도 그대로, 전체 삭제 뒤 새 금고는 새 ID. AAD에 들어간다(3.3) |
| 리비전이 다시 쓰이지 않음 | 한 금고 안에서 한 프로필의 블롭 리비전은 늘 오르기만 한다. 끄기·프로필 tombstone은 행을 지우지 않고 **암호문만 지운 삭제 표시 행**(리비전 + 1)으로 바꾼다(2.1, 4.6). 프로필이 정리(purge)돼도 행은 남긴다(엔진이 정리된 프로필을 같은 ID로 다시 올릴 수 있다, 2.6). 행은 금고 전체를 지울 때만 없어진다. 기기도 꺼진 프로필의 본 리비전을 잊지 않는다(2.5). 서버가 되감겨도(D1을 이전 시점으로 복구 등) **그 기기가** 본 번호를 다시 쓰지 않게, 올릴 때 새 리비전은 기기가 `max(본 리비전, 서버 리비전) + 1`로 정해 보낸다(4.5). 복구 뒤에는 다른 기기가 이미 본 번호를 이 기기가 다시 쓸 수 있어서, 기기는 리비전과 함께 마지막으로 맞춘 블롭의 내용 ID(`syncedContentId`)로 「맞춘 상태」를 가린다(5.4) |
| 내용 ID | 블롭 내용을 새로 올릴 때마다 기기가 고르는 무작위 16바이트 `contentId`. 서버는 그대로 두고 rekey도 바꾸지 않는다. AAD에 들어가 바꿔 끼우면 풀리지 않는다(3.3). nonce는 rekey 때 바뀌므로 내용을 가리는 데 쓰지 않는다 |
| 금고 조건 | 블롭 PUT·rekey는 요청에 `vaultId`를 담고, 서버의 모든 금고 조건이 `vault_id`와 `vault_revision`을 함께 본다. 그사이 다른 기기가 금고를 지우고 다시 만들었으면 409 `vault-changed`(4.5·4.7) |
| AAD | 블롭은 `gazua-keys/v1\|blob\|<vaultId>\|<profileId>\|<revision>\|<contentId>\|<vaultRevision>`, 확인값은 `gazua-keys/v1\|verifier\|<vaultId>\|<vaultRevision>`(3.3) |
| 암호 정규화 | KDF 전에 `normalize('NFC')`(결정 10). 확인 입력 비교도 정규화한 뒤에 한다 |
| 공급자 선택의 표현 | 블롭 평문에 들어 있는 공급자 집합(`kis`·`toss` 키의 있고 없음)이 곧 선택이다. 서버는 모른다. 기기는 마지막으로 맞춘 선택을 `KeySyncState.providers`에 둔다(5.5) |
| 둘 다 끄기 | 막는다. 마지막으로 켜진 체크는 끌 수 없고, "그만 올리려면 위 토글을 꺼 주세요"로 안내한다(5.5) |
| 받을 때 병합 | 블롭에 있는 공급자 중 **값이 실제로 다른 것만** 덮어쓰고, 없는 공급자와 같은 값의 로컬 키는 건드리지 않는다(5.7) |
| 자격 값 | 출력 가능한 ASCII(`0x21`~`0x7E`) 1~256자. 봉한 뒤 `ciphertext` 길이도 다시 본다(2.3) |
| 크기 | 블롭 `ciphertext` base64 2048자, 사용자당 살아 있는 블롭 50개(2.3) |
| 다룰 프로필 | 토글·받기·올리기는 **지금 프로필**에서만 한다. 키 잠금·연결 설정과 같다. 다른 프로필의 알림은 목록으로만 보이고 "그 프로필로 바꾸면 받을 수 있어요"로 안내한다(5.15) |
| 켤 수 있는 조건 | 그 프로필이 서버에 올라가 있고(`ProfileSyncState.syncedRevision > 0`, 삭제 아님), 이 기기에 KIS나 토스 키가 있다. 이 기기에 키가 없는 공급자의 체크는 끈 채 고를 수 없다 |
| 엔진 안 위치 | `syncNow`는 `['pull', 'keys', 'push']`. 키 단계의 실패는 프로필 올리기를 막지 않는다(5.3) |
| 기기 저장 | 키 동기화 상태는 **별도 IndexedDB `gazua-sync-keys`(버전 1)** 에 둔다. `gazua-sync`의 버전을 올리지 않는다(2.5) |
| 리비전 | 블롭 `revision`은 내용이 바뀌거나 지울 때만 오른다. 암호 바꾸기(rekey)는 `vaultRevision`만 올린다(4.7) |
| 다시 보내기 식별 | 같은 본문 재전송은 서버가 `nonce`로 알아본다. 응답을 잃은 뒤에는 다음 키 단계가 서버 블롭을 풀어 지금 이 기기 키와 같은지로 가린다(5.6-4) |
| 기기에서 키 삭제 | `clearSecrets()`(「이 기기에서 키 삭제」)는 이 기기 일이라 서버 블롭을 바꾸지 않고 올릴 변경으로도 치지 않는다(결정 12) |
| 데이터 공급자 설정 | 받은 키는 데이터 공급자(`settings.provider`)를 바꾸지 않는다. 기기 전용 설정이다 |
| 받을 때 토큰 | 실제로 값이 바뀐 공급자의 접근 토큰만 버린다. 토스 키가 바뀌었을 때만 주문 캐시도 버린다. 바뀐 것이 없으면 저장소에 쓰지도 않는다. 발급 시각(`tokenIssuedAt`)은 남긴다(5.2) |
| 탭 사이 알림 | `BroadcastChannel('gazua-keys')`로 로그아웃·계정 전환·전체 삭제·암호 바꾸기를 다른 탭에 알려 마스터 키를 잊게 한다. 키 단계도 잠금 안에서 저장된 세션·소유자를 메모리 값과 견준다(5.12) |
| 암호 바꾸기 | 기억 중이어도 현재 암호를 다시 묻는다 |
| 기억 표시 | 「동기화 암호: 이 탭에서 기억 중 · [잊기]」를 보인다 |

### 1.5 범위 밖
- `proxyToken`, 접근 토큰, 토큰 발급 시각, 프록시 주소, 데이터 공급자 설정(결정 4).
- 키의 과거 리비전, 지운 키의 복구(결정 6).
- 자동 받기(결정 5).
- 동기화 암호를 기기 저장소나 OS 암호 관리자에 맡기기(결정 2·7). 브라우저가 `autocomplete`로 제안하는 것은 막지 않는다.
- 계정 사이 키 옮기기, 다른 사람과 키 공유.
- 동기화 암호를 잊었을 때 서버 사본 되살리기(설계상 불가능하다).
- 주문 캐시·성과 이력의 E2EE 동기화(서버·DB 검토 2절의 다음 후보).
- Worker 쪽 복호화. Worker는 암호 연산을 하지 않는다.
- `gazua-sync` IndexedDB 버전 올리기와 그 `blocking` 처리 보강(이 작업은 그 DB를 건드리지 않는다).

## 2. 데이터

### 2.1 D1 마이그레이션 `sync-worker/migrations/0003_key_vault.sql`

```sql
-- 키 동기화(docs/superpowers/specs/2026-10-31-key-sync-design.md). 서버는 암호문만 둔다. 평문·암호는 오지 않는다.
-- 과거 리비전은 두지 않는다. 지우면 암호문을 바로 지우고 리비전만 남긴다(한 금고 안에서 리비전을 다시 쓰지 않게).

-- 계정에 하나인 금고 머리. salt·확인값은 비밀이 아니지만 암호 대입의 재료라 공유·로그로 내보내지 않는다.
CREATE TABLE key_vault (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  vault_id TEXT NOT NULL CHECK (length(vault_id) = 24),
  kdf TEXT NOT NULL CHECK (kdf = 'PBKDF2-SHA256'),
  iter INTEGER NOT NULL CHECK (iter = 600000),
  salt TEXT NOT NULL CHECK (length(salt) = 24),
  verifier_nonce TEXT NOT NULL CHECK (length(verifier_nonce) = 16),
  verifier_ciphertext TEXT NOT NULL CHECK (length(verifier_ciphertext) = 56),
  vault_revision INTEGER NOT NULL CHECK (vault_revision >= 1 AND vault_revision < 2147483648),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 프로필별 암호문. content_id·nonce·ciphertext가 NULL이면 삭제 표시(끄기·프로필 tombstone·정리). 리비전은 그대로 이어 간다.
-- 행은 금고 전체 삭제(DELETE /v1/keys) 때만 지운다. 정리된 프로필이 같은 ID로 다시 올라와도 리비전이 1로 돌아가지 않게.
-- 살아 있는 블롭은 그 프로필이 profile_index에 있고 삭제되지 않았을 때만 쓴다(Worker가 문장 안에서 확인).
CREATE TABLE key_blobs (
  user_id TEXT NOT NULL REFERENCES users(id),
  profile_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1 AND revision < 2147483648),
  vault_revision INTEGER NOT NULL CHECK (vault_revision >= 1 AND vault_revision < 2147483648),
  -- 내용 ID. PUT 때 기기가 정하고 rekey는 바꾸지 않는다. AAD에 들어간다
  content_id TEXT CHECK (content_id IS NULL OR length(content_id) = 24),
  nonce TEXT CHECK (nonce IS NULL OR length(nonce) = 16),
  ciphertext TEXT CHECK (ciphertext IS NULL OR length(ciphertext) BETWEEN 32 AND 2048),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, profile_id),
  CHECK ((nonce IS NULL) = (ciphertext IS NULL) AND (content_id IS NULL) = (ciphertext IS NULL))
);

-- 행을 넣지 않는 감시 표. batch 마지막 문장이 조건이 어긋나면 0을 넣으려다 CHECK에 걸려 batch 전체를 되돌린다(4.7).
CREATE TABLE key_guard (
  ok INTEGER NOT NULL CHECK (ok = 1)
);
```

- 이 문서에서 "살아 있는 블롭"은 `ciphertext IS NOT NULL`이고 그 프로필이 `profile_index`에 `deleted_at IS NULL`로 있는 행이다. 목록(4.2)·50개 상한(4.5)·rekey 감시(4.7)가 모두 이 같은 집합을 본다.
- `key_blobs`에 `profile_index`로 가는 외래 키를 걸지 않는다. tombstone은 색인 행을 지우지 않으므로 외래 키로는 막을 수 없고, 살아 있는지는 문장 조건으로 본다(4.5).
- `iter`는 v1에서 정확히 600000이다. 회수를 올리는 것은 새 마이그레이션·새 형식 버전으로 한다.
- 테스트 D1(`sync-worker/test/d1.ts`)은 `migrations/`의 SQL을 차례로 적용한다. `d1.test.ts`의 「마이그레이션으로 표를 만든다」는 표 이름 목록을 고정하므로 기대값에 `key_blobs`·`key_guard`·`key_vault`를 더한다. `CHECK` 실패가 batch를 되돌리는지도 같은 파일에 한 줄 더해 확인한다.
- 0002처럼 패키지에서 복사한 파일이 아니라 가즈아 고유 파일이다. 머리 주석으로 구분한다.

### 2.2 와이어 형식 (`src/lib/sync/keyWire.ts`, 앱과 Worker가 함께 쓴다)

```ts
export const KEY_KDF = 'PBKDF2-SHA256';
export const KEY_ITER = 600000;
/** AES-GCM 한 번의 결과. 모두 표준 base64(패딩 포함) */
export interface Sealed {
  nonce: string; // 12바이트 → 16자
  ciphertext: string; // 평문 + 태그 16바이트
}
/** GET /v1/keys의 금고 머리 */
export interface KeyVaultHead {
  vaultId: string; // 16바이트 → 24자
  kdf: typeof KEY_KDF;
  iter: typeof KEY_ITER;
  salt: string; // 16바이트 → 24자
  verifier: Sealed;
  vaultRevision: number;
  updatedAt: number;
}
export interface KeyBlobRow {
  profileId: string;
  revision: number;
  vaultRevision: number;
  /** 살아 있는 행의 내용 ID(16바이트 → 24자, 비밀 아님). 삭제 표시면 null. 같은 리비전이라도 내용이 다른지 가리는 데 쓴다 */
  contentId: string | null;
  /** true면 삭제 표시(끄기·프로필 tombstone). 암호문이 없다 */
  deleted: boolean;
  updatedAt: number;
}
export interface KeyBlob extends Sealed {
  revision: number;
  contentId: string;
  vaultRevision: number;
  updatedAt: number;
}

/** 블롭을 풀었을 때의 평문. 이 모양이 아니면 받지 않는다 */
export interface KeyPlainV1 {
  v: 1;
  kis?: { appKey: string; appSecret: string };
  toss?: { clientId: string; clientSecret: string };
}
```

- 요청·응답 본문 모양은 4절에 엔드포인트마다 적는다.
- `KeyPlainV1`은 서버로 가지 않는다. 기기에서 `Secrets`의 `kis`·`toss` 가운데 **고른 공급자만** 골라 만든다(`proxyToken`은 넣지 않는다). 들어 있는 공급자 집합이 곧 선택이고(결정 9), 적어도 하나가 있어야 한다. 풀 때는 정확한 키 집합(`v`, 선택 `kis`·`toss`, 그 안의 두 문자열)만 받고, 공급자가 하나도 없거나 모르는 필드·자격 값 규칙(2.3) 위반이면 "형식이 맞지 않아요"로 거절한다.
- 선택을 따로 `providers` 필드로 두지 않는 이유: 값과 선택이 어긋나는 상태(선택했는데 값이 없음)를 형식에서 없앤다. 서버에는 선택도 보이지 않는다.
- 검사 함수(`checkVaultBody`, `checkBlobBody`, `checkRekeyBody`, 그리고 앱이 서버 응답을 받을 때 쓰는 `checkVaultHead`·`checkBlobRows`·`checkBlob`)는 DOM·`import.meta.env`·저장소를 쓰지 않는다. `dto.ts`와 같은 규칙이다. Worker가 `../../src/lib/sync/keyWire`로 가져온다.
- base64는 `/^[A-Za-z0-9+/]+={0,2}$/`이고 길이가 4의 배수여야 한다. `nonce`는 정확히 16자, `salt`·`vaultId`·`contentId` 24자, 확인값 `ciphertext` 56자(고정 문구 24바이트 + 태그 16바이트 = 40바이트), 블롭 `ciphertext` 32~2048자.
- **앱도 서버 응답을 검사한다.** 금고 머리(`keyVault`)가 위 모양이 아니거나 `iter !== KEY_ITER`면 키 단계 전체를 멈추고 `서버 응답이 맞지 않아요`(서버가 회수를 낮추거나 큰 값을 주어 기기를 흔들지 못하게). `keyBlobs`의 행 하나가 모양이 틀리면(리비전 범위 4.5 포함) 그 행만 건너뛴다. `getKeyBlob` 응답이 틀리면 그 받기를 멈춘다.

### 2.3 크기 상한

| 대상 | 상한 | 근거 |
|---|---|---|
| 자격 값 하나(`appKey`·`appSecret`·`clientId`·`clientSecret`) | 출력 가능한 ASCII(`/^[\x21-\x7e]{1,256}$/`). 기기에서 올리기 전에 검사, 받을 때 다시 검사 | KIS 앱 시크릿이 가장 길다(약 180자). ASCII로 묶어야 JSON 이스케이프·여러 바이트 글자로 길이가 불어나지 않는다. 붙여넣기 실수(문단 전체)를 올리지 않게 |
| 평문 `KeyPlainV1` | 네 값 모두 256자여도 약 1.1 KB | 위 규칙에서 나온다 |
| 블롭 `ciphertext` | base64 2048자(1536바이트). `sealKeys`가 봉한 뒤 길이를 다시 보고 넘으면 올리지 않는다 | 평문 상한 + 태그 16바이트에 여유 |
| 사용자당 살아 있는 블롭 | 50개. 넘으면 새로 켜는 PUT이 422 `key-limit` | 프로필 수 상한은 없지만 키를 가진 프로필 50개는 넘지 않는다고 본다. rekey 본문을 묶어 둔다 |
| 본문 `readJson` 상한 | PUT 블롭 8 KiB, PUT 금고 4 KiB, rekey 128 KiB. **두 DELETE는 본문을 읽지 않는다** | 50 × (2048 + 머리) ≈ 110 KB |
| D1 | rekey batch는 최대 53문장(정리 1 + 금고 1 + 블롭 50 + 감시 1). 문장마다 바인딩 값은 10개 안팎, 문장 길이는 4 KB 안쪽 | [Cloudflare D1 한도 문서](https://developers.cloudflare.com/d1/platform/limits/)(2026-10-31 확인, 「Queries per Worker invocation」 행의 설명): `db.batch()`는 호출당 쿼리 한도(무료 50)에서 **한 쿼리**로 센다. 쿼리당 바인딩 100개, SQL 문장 100 KB |

### 2.4 금지 키 (`FORBIDDEN_KEYS`에 더할 것)

`forbidden.ts`에 새 묶음을 더한다.

```ts
  // 키 동기화 와이어(keyWire.ts). 금고·블롭이 프로필 문서·공유 스냅샷에 섞이면 거절한다
  'keyVault',
  'vaultId',
  'keyBlobs',
  'nonce',
  'ciphertext',
  'verifier',
  'vaultRevision',
  'contentId',
```

- 겹침 확인(2026-10-31, `52c1d51`): 여덟 이름 모두 `src/lib`·`sync-worker/src`의 테스트 밖 코드에 한 번도 나오지 않는다(`contentId`는 2026-10-31 6회차 검토 때 다시 확인)(`grep -rniw`). 프로필 문서·여섯 공유 종류의 정상 필드와 겹치지 않는다.
- 블롭 목록 행의 `profileId`·`revision`·`deleted`·`updatedAt`은 **금지하지 않는다.** `updatedAt`은 전략·기준의 정상 필드이고, `revision`·`profileId`는 동기화 API의 다른 응답에서도 쓴다. 이들은 홀로 있어서는 비밀이 아니다.
- 금지 검사는 대소문자를 가리지 않으므로 `Nonce`·`CIPHERTEXT`도 막힌다.
- 같은 이름을 테스트가 고정한다(7.6). 나중에 새 정상 필드가 이 이름과 부딪치면 테스트가 깨져 알 수 있다.

### 2.5 기기 저장 상태 (IndexedDB `gazua-sync-keys`)

`gazua-sync`의 버전을 올리면 옛 번들 탭이 연결을 쥔 채 새 탭의 업그레이드가 `blocked`로 멈출 수 있다(`openSyncStore`에 `blocking` 처리가 없고, 컨트롤러 `attach`가 그 열기를 기다리며, `completeSocialSignIn`은 `attached`를 기다린다). 그래서 키 상태는 **새 DB `gazua-sync-keys` 버전 1**에 둔다. 옛 탭은 이 DB를 열지 않으므로 막히지 않는다.

- `src/lib/sync/keyStore.ts`의 `openKeyStore(dbName = 'gazua-sync-keys')`. 저장소 `keys`(keyPath `profileId`)와 `meta`(keyPath `key`).
- 나중의 버전 올리기를 위해 지금부터 `blocking() { db.close() }`을 단다. 열기가 실패하거나 `blocked`가 3초 넘게 이어지면 메모리 저장소(`createMemoryKeyStore`)로 계속하고 `persistent = false`로 알린다(`openSyncStore`와 같은 방식).

```ts
/**
 * 프로필 하나의 키 동기화 상태. 평문·암호문·키 해시·암호는 두지 않는다.
 * 행은 지우지 않는다(끄기·프로필 삭제에도 남는다). 금고가 바뀌거나 계정이 바뀔 때 clear()로만 없어진다
 */
export interface KeySyncState {
  profileId: string;
  /** 토글 켜짐으로 본다(서버에 살아 있는 블롭이 있다고 마지막으로 확인했거나 켜는 중). false: 꺼짐·다른 기기가 끔 */
  active: boolean;
  /** 이 기기가 마지막으로 맞춘(받았거나 올린) 서버 블롭 리비전. 0: 아직 맞추지 않음(다른 기기가 켠 것을 알기만 함) */
  revision: number;
  /** 마지막으로 맞춘 블롭의 내용 ID. 리비전이 같아도 서버 행 내용 ID가 다르면 맞춘 상태가 아니다(서버 복구 뒤 다른 기기가 같은 번호로 올린 경우). rekey는 내용 ID를 바꾸지 않으므로 옮길 일이 없다. 비밀 아님 */
  syncedContentId: string | null;
  /** 이 기기가 본 서버 행 리비전 가운데 가장 큰 값(삭제 표시 포함). 줄지 않는다. 되감기 판단에 쓴다 */
  seenRevision: number;
  /** 이 기기가 끄기를 보냈지만 반영을 확인하지 못했다(응답 유실). 다음 단계에서 삭제 표시를 보면 조용히 정리한다 */
  offPending: boolean;
  /**
   * 올릴 공급자(마지막으로 올렸거나 받은 블롭의 공급자 집합, 켜는 중이면 고른 값). 비밀이 아니다.
   * revision > 0이면 비지 않는다. revision 0이면서 다른 기기가 켠 것을 알기만 한 행은 빈 배열이고 받은 뒤 채운다
   */
  providers: ('kis' | 'toss')[];
  /** 이 기기에서 고른 공급자의 키가 바뀌거나 선택을 바꿀 때마다 1씩 오른다 */
  localSeq: number;
  /** 올리기에 성공했거나 서버 것을 받았을 때 그 작업이 시작할 때 읽은 localSeq. localSeq > uploadedSeq면 올릴 변경이 있다(dirty) */
  uploadedSeq: number;
  /** 키 단계가 정한 알림. 다시 열어도 보이게 남긴다. 'rollback': 서버가 이미 본 것보다 옛 리비전을 내줌 */
  notice: null | 'available' | 'newer' | 'conflict' | 'removed' | 'missing-key' | 'rollback';
  /** notice가 가리키는 서버 블롭 리비전(받기·올리기의 기준) */
  remoteRevision?: number;
}

export interface KeyStore {
  readonly persistent: boolean;
  state(profileId: string): Promise<KeySyncState | undefined>;
  states(): Promise<KeySyncState[]>;
  /**
   * 꺼진 행(또는 없는 행)을 켠다. 한 트랜잭션에서 active = true, revision = 0, syncedContentId = null, uploadedSeq = localSeq(꺼진 동안의 수정은 올릴 변경으로 치지 않는다),
   * providers·notice·remoteRevision은 주어진 값, offPending = false. seenRevision은 그대로. 이미 켜진 행이면 notice·remoteRevision만 바꾼다
   */
  activate(profileId: string, p: { providers: ('kis' | 'toss')[]; notice: KeySyncState['notice']; remoteRevision?: number }): Promise<void>;
  /** 서버에서 본 리비전을 기록한다(더 클 때만 올린다). 행이 없으면 꺼진 행으로 만든다 */
  markSeen(profileId: string, revision: number): Promise<void>;
  /** 끄기·끄기 대기 표시·알림을 한 트랜잭션에서 바꾼다(seq·seen은 그대로) */
  setActive(profileId: string, p: { active: boolean; offPending?: boolean; notice?: KeySyncState['notice'] }): Promise<void>;
  /**
   * localSeq만 한 트랜잭션에서 올린다(탭 사이에서도 잃지 않게). 행이 없거나 꺼진 행이거나, providers가 주어졌는데
   * 행의 providers와 겹치지 않으면(고르지 않은 공급자만 바뀜) 아무것도 하지 않는다
   */
  bumpSeq(profileId: string, providers?: ('kis' | 'toss')[]): Promise<void>;
  /** 켜진 행의 선택을 바꾸고 localSeq를 올린다(한 트랜잭션). 빈 배열·꺼진 행은 거절한다 */
  setProviders(profileId: string, providers: ('kis' | 'toss')[]): Promise<void>;
  /**
   * 서버와 맞춘 결과를 한 트랜잭션에서 쓴다. 읽은 행의 localSeq는 그대로 둔다(그사이 bumpSeq가 올린 값을 잃지 않게).
   * uploadedSeq는 작업 시작 때 읽은 값을 받는다
   */
  markSynced(profileId: string, p: { revision: number; contentId: string; uploadedSeq: number; providers?: ('kis' | 'toss')[]; notice: KeySyncState['notice']; remoteRevision?: number }): Promise<void>;
  /** notice·remoteRevision만 바꾼다(localSeq·uploadedSeq는 그대로) */
  setNotice(profileId: string, notice: KeySyncState['notice'], remoteRevision?: number): Promise<void>;
  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
  /** keys·meta를 모두 지운다(계정 전환·전체 삭제) */
  clear(): Promise<void>;
}
```

- 행을 통째로 덮어쓰는 `put`도, 행 하나를 지우는 `delete`도 두지 않는다. 쓰기는 모두 읽기-고치기-쓰기를 한 `readwrite` 트랜잭션에서 하는 위 메서드다.
- 꺼진 행은 본 리비전과 `localSeq`만 쓸모가 있다. `bumpSeq`·`setProviders`·키 타이머는 꺼진 행을 건드리지 않고, 다시 켤 때는 `activate`가 리비전·dirty를 처음 상태로 돌린다(꺼진 동안의 수정이 다시 켠 뒤 「이 기기 키 올리기」로 다른 기기 키를 덮는 선택지가 되지 않게).
- 행을 지우지 않는 이유: 꺼진 뒤에도 본 리비전(`seenRevision`)을 기억해야, 서버가 끄기 직전의 살아 있는 행(같은 금고 ID·리비전이라 AAD가 맞는다)을 되돌려 주어도 「받을 수 있어요」로 받지 않는다. 행은 프로필 수만큼만 쌓인다.
- 금고 리비전은 상태 행에 두지 않고 `meta.keyVault` 하나로 본다. 블롭마다 금고 리비전이 다를 일이 없기 때문이다(rekey는 모든 블롭을 한꺼번에 바꾼다, 4.7).

`meta`에 두는 값:

| 키 | 값 | 쓰임 |
|---|---|---|
| `keyVault` | `{ vaultId: string; vaultRevision: number; salt: string } \| null` | 마지막으로 본 금고. 바뀌었으면 메모리 마스터 키를 잊는다(5.12) |
| `keyNotice` | `null \| 'vault-changed' \| 'vault-gone'` | 계정 단위 알림 |
| `keySupport` | `boolean` | 서버가 `/v1/keys`를 아는가. `listKeys`가 404면 false, 200이면 true(키 단계마다 다시 정한다). false면 토글을 숨긴다(12절) |

- 동기화 암호, 마스터 키, `KeyPlainV1`, 블롭 암호문, 키 해시는 어디에도 두지 않는다. salt·`vaultId`·`contentId`는 서버에서 늘 받는 공개 값이고 금고·내용이 바뀌었는지 알아보는 데만 쓴다.
- `engine.reset()`(계정 전환)이 키 저장소의 `clear()`도 부른다(5.3).

### 2.6 프로필 tombstone·purge·restore와의 관계

| 일 | 블롭 |
|---|---|
| `DELETE /v1/profiles/:id`(tombstone)가 반영됨 | **같은 batch**에서 그 행을 삭제 표시로 바꾼다(암호문 NULL, 리비전 + 1). 조건은 `profile_index`의 `last_op_id = 이 작업 AND deleted_at IS NOT NULL`(4.9). 409(다른 기기가 먼저 고침)로 끝난 삭제는 바꾸지 않는다 |
| 삭제된 프로필에 PUT 블롭 | 410 `gone`(4.5). 삭제된 프로필에는 살아 있는 블롭이 생기지 않는다 |
| `restoreProfile` | 같은 batch에서 그 프로필 행이 아직 살아 있으면(되돌린 Worker 기간에 남은 것 등) 삭제 표시로 바꾼다. 블롭은 되살아나지 않는다. 토글은 꺼진 채이고 복구한 기기에서 다시 켜야 한다 |
| 30일 뒤 Cron `purge` | **행을 지우지 않는다.** 같은 batch에서 암호문이 남은 행(되돌린 Worker 기간의 고아)만 삭제 표시로 바꾼다. 이 문장은 `STILL_DUE`를 조건으로 쓰므로 **`profile_index` 삭제 문장보다 앞에** 둔다(그 뒤면 늘 거짓이라 0행이 된다). 엔진은 정리된 프로필을 같은 ID로 다시 올린다(`engine.ts` pull의 `deleted` 충돌, `resolve('restore')`에서 `gone`·`not-found`면 `setSynced(profileId, 0, '')` 뒤 올리기). 행을 지우면 그때 다시 켠 블롭이 리비전 1부터 시작해 옛 리비전 1 암호문과 AAD가 같아진다 |
| 충돌 해결 `keep-both`·`restoreRevision`으로 생긴 새 프로필 | 새 ID라 블롭이 없다. 토글은 꺼짐 |
| 이 기기에서 프로필 삭제 | 그 `KeySyncState`는 지우지 않고 `active: false`로 둔다(같은 ID로 되살아날 때 본 리비전이 필요하다) |
| 다른 기기의 삭제를 pull이 적용 | 같다. `app.removeSyncedProfile`은 `onSyncableChange('deleted')`를 부르지 않으므로 키 단계가 로컬에 없는 프로필의 켜진 행을 `setActive(false)`로 끈다(5.4) |

## 3. 암호화

모두 `src/lib/sync/keyCrypto.ts`(순수 모듈, `globalThis.crypto.subtle`만 쓴다)에 둔다. `secrets.ts`의 `toBase64`·`fromBase64`·`randomBytes`는 내보내 같이 쓴다(동작은 바꾸지 않는다).

### 3.1 마스터 키

```ts
export async function deriveVaultKey(passphrase: string, salt: string, iter: number): Promise<CryptoKey>;
```

- `PBKDF2(SHA-256, iterations = iter, salt = 금고 salt 16바이트, password = UTF-8(passphrase.normalize('NFC')))` → `deriveKey`로 AES-GCM 256, `extractable: false`, 용도 `['encrypt', 'decrypt']`.
- `iter !== KEY_ITER`면 KDF를 돌기 전에 거절한다. 서버가 회수를 낮추거나(대입이 쉬워짐) 키워서(기기가 멈춤) 기기를 흔들지 못하게 한다. 앱의 응답 검사(2.2)와 같은 규칙이다.
- 금고를 처음 만들 때 salt와 `vaultId`는 각각 `randomBytes(16)`.
- 600000회는 휴대폰에서 1초 안팎 걸릴 수 있다. 암호를 넣는 순간에만 한 번 돈다(키 단계·자동 올리기에서는 돌지 않는다).
- 컨트롤러는 마스터 키를 `{ key, vaultId, salt, vaultRevision }`로 둔다. 쓰기 직전마다 이 셋을 서버 머리와 견준다(5.12).

### 3.2 확인값(verifier)

```ts
export const VERIFIER_TEXT = 'gazua-key-vault-check/v1'; // 24바이트
export async function makeVerifier(key: CryptoKey, vaultId: string, vaultRevision: number): Promise<Sealed>;
export async function checkVerifier(key: CryptoKey, v: Sealed, vaultId: string, vaultRevision: number): Promise<boolean>;
```

- 고정 문구를 무작위 12바이트 IV로 AES-GCM 암호화한다. AAD는 `gazua-keys/v1|verifier|<vaultId>|<vaultRevision>`.
- 복호화가 실패하거나 결과가 `VERIFIER_TEXT`와 다르면 `false`(틀린 암호). 예외를 밖으로 던지지 않는다.
- 블롭이 하나도 없어도 암호를 확인할 수 있게 둔다.

### 3.3 프로필 블롭과 AAD

```ts
export interface BlobContext { vaultId: string; profileId: string; revision: number; contentId: string; vaultRevision: number }
export async function sealKeys(key: CryptoKey, ctx: BlobContext, plain: KeyPlainV1): Promise<Sealed>;
export async function openKeys(key: CryptoKey, ctx: BlobContext, s: Sealed): Promise<KeyPlainV1>; // 실패: KeyOpenError
/** rekey 전용: 평문 모양을 보지 않고 바이트만 푼다(새 버전 앱이 만든 블롭도 옛 앱이 다시 봉할 수 있게) */
export async function openRaw(key: CryptoKey, ctx: BlobContext, s: Sealed): Promise<Uint8Array>;
export async function sealRaw(key: CryptoKey, ctx: BlobContext, bytes: Uint8Array): Promise<Sealed>;
```

- 평문은 `JSON.stringify(plain)`의 UTF-8, IV는 매번 `randomBytes(12)`.
- **AAD = UTF-8 `gazua-keys/v1|blob|<vaultId>|<profileId>|<revision>|<contentId>|<vaultRevision>`.**
  - `vaultId`: 금고를 지우고 다시 만든 뒤(새 ID) 옛 금고 시절 암호문을 내주면 풀리지 않는다.
  - `profileId`: 서버가 블롭을 다른 프로필 자리에 바꿔 끼우면 풀리지 않는다.
  - `revision`: 서버가 옛 리비전의 암호문을 다른 리비전 번호로 내주면 풀리지 않는다. 같은 번호 그대로 옛 암호문을 내주는 되감기는 AAD로 막지 못하므로 기기의 본 리비전·`syncedContentId`가 가린다(5.4). 서버 복구 뒤에는 기기 사이에서 번호가 겹칠 수 있다(6절 한계). 새 리비전은 기기가 정해 보내므로(4.5 `newRevision`) 봉하기 전에 알 수 있다.
  - `contentId`: 목록이 알려 준 내용 ID와 다른 내용의 암호문을 끼우면 풀리지 않는다. 그래서 목록의 `contentId`만 보고 「맞춘 상태」를 정해도 받은 내용과 어긋나지 않는다.
  - `vaultRevision`: 암호를 바꾼 뒤 옛 금고 리비전 시절 암호문을 섞어 내주면 풀리지 않는다.
  - 계정 경계는 넣지 않는다. 계정마다 salt·암호가 달라 다른 계정 블롭은 애초에 풀리지 않는다. 기기는 서버의 사용자 ID를 모른다.
- `openKeys`는 복호화 실패와 평문 모양 오류를 구분해 `KeyOpenError('auth' | 'shape')`로 던진다. 메시지에 값을 넣지 않는다.
- `sealKeys`는 봉한 `ciphertext`가 2048자를 넘으면 `KeyOpenError('shape')`로 던진다(2.3).
- rekey(4.7)는 블롭 `revision`을 바꾸지 않고 새 `vaultRevision`으로 다시 봉한다. AAD가 달라지므로 같은 평문이라도 새 암호문이다.

### 3.4 암호 강도 검사 (`keyCrypto.ts` `checkSyncPassphrase`)

```ts
export type PassphraseProblem = 'short' | 'long' | 'plain' | 'mismatch';
export function checkSyncPassphrase(pass: string, confirm: string): PassphraseProblem | null;
```

`p = pass.normalize('NFC')`, `c = confirm.normalize('NFC')`로 본다.

| 순서 | 규칙 | 문구 |
|---|---|---|
| 1 | `[...p].length >= 12` | `동기화 암호를 12자 이상 입력해 주세요` |
| 2 | `[...p].length <= 128` | `동기화 암호는 128자까지예요` |
| 3 | 서로 다른 글자가 4개 이상(`new Set([...p]).size >= 4`) | `같은 글자를 되풀이한 암호는 쓸 수 없어요` |
| 4 | `p === c` | `암호가 서로 달라요` |

- 규칙 1~3과 NFC는 결정 10이다.
- 앞뒤 공백을 자르지 않는다(기기 키 잠금 `KeyLock.svelte`도 자르지 않는다). 대신 앞뒤가 공백이면 `앞이나 뒤에 공백이 있어요`를 오류가 아닌 안내로 보인다.
- 기기 키 잠금 암호와 같은지는 검사하지 않는다(결정 11). 같으면 생기는 위험은 5.16 안내에 한 줄로 알린다.
- 강도 점수 라이브러리는 쓰지 않는다(결정 3, 새 의존성 없음).

### 3.5 모듈 경계

| 파일 | 내용 | 어디서 |
|---|---|---|
| `src/lib/sync/keyWire.ts` | 와이어 타입, 상한, 본문·응답 검사 | 앱·Worker |
| `src/lib/sync/keyCrypto.ts` | KDF, 확인값, 봉하기·풀기, 강도 검사 | 앱(Worker가 가져와도 되게 순수하게 둔다) |
| `src/lib/sync/keyStore.ts` | IndexedDB `gazua-sync-keys`, 메모리 저장소 | 컨트롤러 |
| `src/lib/sync/keySync.ts` | 키 단계·켜기·받기·올리기·끄기·rekey·전체 삭제. Svelte·Firebase 없음 | 컨트롤러 |
| `sync-worker/src/keys.ts` | 키 API | Worker |

## 4. API·Worker

### 4.1 라우팅 (`handler.ts` `ROUTES`에 더함)

같은 경로·메서드는 먼저 나온 행이 이긴다. `vault`·`rekey` 행을 `:profileId` 행보다 앞에 둔다.

| 메서드 | 경로 | 패턴(로그) | 본문 | 처리 |
|---|---|---|---|---|
| GET | `/v1/keys` | `/v1/keys` | – | `listKeys` |
| DELETE | `/v1/keys` | `/v1/keys` | 읽지 않음 | `wipeKeys` |
| PUT | `/v1/keys/vault` | `/v1/keys/vault` | `readJson` 4 KiB | `createVault` |
| POST | `/v1/keys/rekey` | `/v1/keys/rekey` | `readJson` 128 KiB | `rekey` |
| GET | `/v1/keys/([^/]+)` | `/v1/keys/:id` | – | `getKeyBlob` |
| PUT | `/v1/keys/([^/]+)` | `/v1/keys/:id` | `readJson` 8 KiB | `putKeyBlob` |
| DELETE | `/v1/keys/([^/]+)` | `/v1/keys/:id` | 읽지 않음 | `deleteKeyBlob` |

- 모두 `authed`다. CORS 메서드(`cors.ts`)는 이미 GET·POST·PUT·DELETE를 허용한다.
- 두 DELETE는 `revokeShare`처럼 본문을 읽지 않는다(`readJson`은 본문이 없으면 400 `bad-json`이라 본문 없는 클라이언트 호출이 서버 오류로 보인다).
- `:profileId`는 `checkId`(`profiles.ts`)를 지나야 하고, `vault`·`rekey`는 404 `not-found`로 막는다(앱 프로필 ID는 `crypto.randomUUID()`라 부딪치지 않는다).
- 로그는 지금처럼 `deps.log`에 메서드·패턴·상태·시간만 남긴다. 본문·암호문·salt는 넘기지 않는다.

### 4.2 `GET /v1/keys`

응답 200:
```ts
{ keyVault: KeyVaultHead | null; keyBlobs: KeyBlobRow[] }
```
- `keyBlobs`는 `key_blobs JOIN profile_index`에서 `deleted_at IS NULL`인 프로필의 행만, `profile_id` 순서. 삭제 표시 행은 `deleted: true`, `contentId: null`로 함께 준다(다른 기기가 껐다는 것을 알리려고). 암호문·nonce는 담지 않는다(목록은 가볍게).
- 금고가 없으면 `keyVault: null`, `keyBlobs: []`.

### 4.3 `GET /v1/keys/:profileId`

응답 200: `KeyBlob`(`{ revision, contentId, vaultRevision, nonce, ciphertext, updatedAt }`). 리비전과 암호문을 한 문장으로 읽는다(`getProfile`과 같은 이유).

| 상태 | 본문 | 언제 |
|---|---|---|
| 404 `not-found` | – | 살아 있는 블롭이 없다(행 없음·삭제 표시), 또는 프로필이 없거나 삭제됐다(있는지 구분해 알려 주지 않는다) |

### 4.4 `PUT /v1/keys/vault` (처음 만들기)

요청:
```ts
{ vaultId: string; kdf: 'PBKDF2-SHA256'; iter: 600000; salt: string; verifier: Sealed }
```
- 확인값은 기기가 `vaultRevision = 1`과 이 `vaultId`로 봉해 보낸다.
- 문장: `INSERT INTO key_vault (…, vault_revision, …) VALUES (…, 1, …) ON CONFLICT (user_id) DO NOTHING`. 그다음 머리를 읽어 `vault_id`가 요청과 같으면(다시 보낸 같은 요청 포함) 성공.

| 상태 | 본문 | 언제 |
|---|---|---|
| 200 | `{ vaultRevision: 1, updatedAt }` | 만들었다 |
| 409 `vault-exists` | `{ keyVault: KeyVaultHead }` | 이미 금고가 있다(다른 기기가 먼저 만들었다) |
| 422 `unknown-field` / `invalid` | `{ path }` | 허용 필드 밖, 값 모양·길이·`iter !== 600000` |

### 4.5 `PUT /v1/keys/:profileId`

요청:
```ts
{ expectedRevision: number; newRevision: number; contentId: string; vaultId: string; vaultRevision: number; nonce: string; ciphertext: string }
```
- `expectedRevision`은 서버의 지금 행 리비전이다. 행이 없으면 0, 삭제 표시 행이면 그 리비전(다시 켜기).
- `contentId`는 이번에 올리는 내용에 기기가 새로 고른 무작위 16바이트다(같은 본문을 다시 보낼 때만 같은 값). 기기는 이 값을 AAD에 넣어 봉하고, 서버는 `content_id`에 그대로 둔다.
- `newRevision`은 기기가 정한 새 리비전이고 `max(seenRevision, expectedRevision) + 1`이다(보통은 `expectedRevision + 1`과 같다). 기기는 그 값으로 AAD를 만든다. 서버가 되감긴 뒤(지금 행 리비전 < 그 기기가 본 리비전)에도 그 기기가 이미 본 번호를 다시 쓰지 않는다.
- 서버는 `newRevision > expectedRevision`이고 `newRevision ≤ 2^31 − 2`인 정수만 받는다(아니면 422 `invalid`). 서버가 스스로 +1 하는 경우(끄기·tombstone·정리·복구·rekey 0단계)는 모두 암호문이 남은 행만 바꿔 한 번뿐이라 D1 CHECK(`< 2^31`) 안에 든다. 금고 리비전도 같은 상한이다(rekey가 `2^31 − 1`을 넘기려 하면 CHECK가 batch를 되돌려 409가 된다).
- 리비전이 상한에 닿은 프로필(끈 행이 `2^31 − 1`이면 다시 켤 `newRevision`이 없다)은 422로 더 올릴 수 없다. 21억 번 바꿔야 닿으므로 따로 다루지 않고, 닿으면 「서버의 키 모두 지우기」 뒤 새 금고로 시작한다(새 금고는 리비전이 처음부터다). 8절 표의 422 문구로 알린다.
- 앱은 서버가 준 리비전(`revision`·`vaultRevision`)이 `Number.isSafeInteger`이고 `0 ≤ 값 < 2^31`이 아니면 응답 모양이 틀린 것으로 본다(2.2). 서버가 아주 큰 리비전을 한 번 보여 본 리비전을 영구히 끌어올리는 일을 막는다.
- `vaultId`·`vaultRevision`은 기기가 봉할 때 쓴 금고다. 기기의 머리 비교(5.12 #8)는 `listKeys` 시점 기준이라, 그 직후 다른 기기가 금고를 지우고 다시 만들면(새 금고도 `vault_revision` 1) 리비전만으로는 가려지지 않는다. 그래서 서버 조건이 둘을 함께 본다.
- 조건은 모두 한 문장 안에 둔다(사이에 다른 요청이 끼어도 어긋나지 않게). 아래 "금고 맞음"은 `EXISTS (SELECT 1 FROM key_vault WHERE user_id = ? AND vault_id = ? AND vault_revision = ?)`다.
  - 행이 없을 때(`expectedRevision` 0): `INSERT INTO key_blobs (…) SELECT ?(user_id), ?(profile_id), ?(newRevision), ?(vaultRevision), ?(contentId), ?(nonce), ?(ciphertext), ?(updated_at) WHERE 금고 맞음 AND EXISTS (profile_index 그 프로필, deleted_at IS NULL) AND (살아 있는 블롭 수) < 50 ON CONFLICT (user_id, profile_id) DO NOTHING`
  - 행이 있을 때: `UPDATE key_blobs SET revision = ?, vault_revision = ?, content_id = ?, nonce = ?, ciphertext = ?, updated_at = ? WHERE user_id = ? AND profile_id = ? AND revision = ? AND 금고 맞음 AND EXISTS (프로필 살아 있음) AND (ciphertext IS NOT NULL OR (살아 있는 블롭 수) < 50)`
- 쓴 뒤 행을 읽어 `revision = newRevision AND nonce = 요청 nonce`면 성공이다. 응답을 잃고 같은 본문을 다시 보내도(패키지 재시도) 같은 결과를 돌려준다.
- 실패 이유는 쓴 뒤 다시 읽어 아래 순서로 정한다.

| 순서 | 상태 | 본문 | 언제 |
|---|---|---|---|
| 1 | 422 `unknown-field` / `invalid` | `{ path }` | 본문 검사 실패 |
| 2 | 404 `not-found` | – | `profile_index`에 그 프로필이 없다(아직 올라가지 않았다) |
| 3 | 410 `gone` | `{ deletedAt, purgeAt, revision }` | 프로필이 삭제(tombstone)됐다. 프로필 API와 같은 모양 |
| 4 | 409 `no-vault` | `{ vaultRevision: null }` | 금고가 없다(다른 기기가 모두 지웠다) |
| 5 | 409 `vault-changed` | `{ vaultRevision }` | 금고 ID나 금고 리비전이 다르다(다른 기기가 암호를 바꿨거나, 지우고 다시 만들었다) |
| 6 | 409 `conflict` | `{ revision, vaultRevision, deleted }` | 블롭 리비전이 다르다. `revision`은 서버의 지금 행 리비전(행 없음 0), `deleted`는 삭제 표시인지 |
| 7 | 422 `key-limit` | – | 살아 있는 블롭이 이미 50개인데 새로 켜려 했다 |

### 4.6 `DELETE /v1/keys/:profileId` (끄기)

- 조건 없이 그 행을 삭제 표시로 바꾼다(결정 6. 끄기는 이 프로필에서 키 동기화를 그만두겠다는 뜻이라 사이에 다른 기기가 고쳤어도 지운다): `UPDATE key_blobs SET content_id = NULL, nonce = NULL, ciphertext = NULL, revision = revision + 1, updated_at = ? WHERE user_id = ? AND profile_id = ? AND ciphertext IS NOT NULL`.
- 암호문은 이 문장으로 바로 사라진다. 남는 것은 리비전 번호뿐이다.
- 응답은 늘 200 `{ deleted: boolean; revision: number }`다. `deleted`는 이 요청이 암호문을 지웠는지, `revision`은 쓴 뒤의 지금 행 리비전(행이 없으면 0)이다. 이미 삭제 표시거나 행이 없으면 `deleted: false`와 그 리비전(다시 보내도 같다).

### 4.7 `POST /v1/keys/rekey` (암호 바꾸기, 원자적)

요청:
```ts
{
  expectedVaultId: string; // 바뀌지 않는다. 그사이 다시 만든 금고를 덮지 않게
  expectedVaultRevision: number;
  salt: string; // 새 salt
  verifier: Sealed; // 새 키로 (vaultId, expectedVaultRevision + 1)을 AAD로
  keyBlobs: { profileId: string; revision: number; contentId: string; nonce: string; ciphertext: string }[];
}
```
- `keyBlobs`는 지금 서버의 **살아 있는 블롭 전부**여야 한다(목록 4.2의 `deleted: false` 행과 같은 집합). 각 `revision`은 서버의 지금 리비전이고 그대로 유지된다. 암호문은 새 키와 AAD(같은 `vaultId`·`profileId`·`revision`·`contentId`, 새 `vaultRevision`)로 봉한 것이다. `vaultId`와 각 블롭의 `content_id`는 바뀌지 않는다(서버가 그대로 둔다).
- 같은 `profileId`가 두 번 나오면 422 `invalid`. 50개를 넘으면 422 `invalid`.
- batch 한 번(D1 batch는 한 트랜잭션이고 한도에서 한 쿼리로 센다, 2.3):
  0. 정리: 프로필이 없거나 삭제된 행 중 암호문이 남은 것(되돌린 Worker 기간의 고아)을 삭제 표시(`content_id`·`nonce`·`ciphertext` NULL, 리비전 + 1)로 바꾼다. 살아 있는 집합 밖이라 요청에 넣을 수 없는 행이 rekey를 영원히 막지 않게 한다.
  1. `UPDATE key_vault SET salt = ?, verifier_nonce = ?, verifier_ciphertext = ?, vault_revision = ? + 1, updated_at = ? WHERE user_id = ? AND vault_id = ? AND vault_revision = ?`
  2. 블롭마다 `UPDATE key_blobs SET vault_revision = ?, nonce = ?, ciphertext = ?, updated_at = ? WHERE user_id = ? AND profile_id = ? AND revision = ? AND content_id = ? AND ciphertext IS NOT NULL AND EXISTS (SELECT 1 FROM key_vault WHERE user_id = ? AND vault_id = ? AND vault_revision = ? AND salt = ?)` (같은 금고 ID에 새 리비전·새 salt가 있어야 적용. `content_id`가 요청과 다르면 이 블롭은 바뀌지 않아 3의 개수 비교로 batch 전체가 되돌아가 409가 된다. 복구 뒤 번호만 같고 내용이 다른 블롭을 옛 내용으로 덮지 않게)
  3. 감시 문장: `INSERT INTO key_guard (ok) SELECT 0 WHERE NOT EXISTS (같은 금고 ID·새 리비전·새 salt) OR (살아 있는 블롭 중 vault_revision <> 새 값인 수) > 0 OR (살아 있는 블롭 중 vault_revision = 새 값인 수) <> 요청 블롭 수`
- 3이 행을 넣으려 하면 `CHECK (ok = 1)`에 걸려 batch 전체(0 포함)가 되돌아간다. 그래서 다음 중 하나라도 있으면 아무것도 바뀌지 않는다.
  - 그사이 금고가 바뀌었다(다른 기기의 rekey·전체 삭제, 지우고 다시 만든 금고).
  - 요청에 빠진 블롭이 있다, 또는 그사이 다른 기기가 블롭을 새로 켰다(옛 금고 리비전으로 남는다).
  - 요청한 블롭 하나가 그사이 고쳐졌거나 꺼졌다(리비전·암호문 조건이 맞지 않아 새 리비전으로 바뀐 수가 모자란다).
- 정상 경로에서 `key_guard`에는 행이 생기지 않는다.
- 블롭 문장 하나의 바인딩 값은 12개라 쿼리당 100개 한도 안이다. 문장을 `json_each` 한 문장으로 합치지 않는다(D1이 batch를 한 쿼리로 세므로 문장 수 위험이 없고, 블롭마다 리비전 조건을 분명히 둘 수 있다).
- batch가 예외로 끝나면 머리를 다시 읽는다. 금고 ID가 같고 salt가 요청 salt면 앞선 같은 요청이 이미 반영된 것이라 200. 금고 ID가 다르면 409 `vault-changed`. 아니면 409 `conflict` + `{ keyVault, keyBlobs }`(지금 목록). 그 밖의 예외(머리 읽기도 실패)는 500으로 둔다.

| 상태 | 본문 | 언제 |
|---|---|---|
| 200 | `{ vaultRevision, updatedAt }` | 바꿨다 |
| 409 `no-vault` | – | 금고가 없다 |
| 409 `vault-changed` | `{ vaultRevision }` | 금고 ID가 다르다(그사이 지우고 다시 만들었다). 기기는 마스터 키를 잊고 멈춘다 |
| 409 `conflict` | `{ keyVault, keyBlobs }` | 위 경합. 기기는 목록을 다시 받아 한 번 더 시도한다(5.10) |
| 422 | `{ path }` | 본문 검사 실패 |

### 4.8 `DELETE /v1/keys` (서버의 키 모두 지우기)

- batch: `DELETE FROM key_blobs WHERE user_id = ?`, `DELETE FROM key_vault WHERE user_id = ?`. 행을 지워도 다음 금고는 새 `vaultId`라 리비전이 다시 쓰여도 옛 암호문이 풀리지 않는다(3.3).
- 응답 200 `{ deleted: { vault: boolean; blobs: number } }`. 다시 보내도 200.

### 4.9 프로필 삭제·복구·정리 batch 변경

- `profiles.ts` `deleteProfile`의 batch 끝에 더한다.
  ```sql
  UPDATE key_blobs SET content_id = NULL, nonce = NULL, ciphertext = NULL, revision = revision + 1, updated_at = ?
  WHERE user_id = ? AND profile_id = ? AND ciphertext IS NOT NULL
    AND EXISTS (SELECT 1 FROM profile_index WHERE user_id = ? AND profile_id = ? AND last_op_id = ? AND deleted_at IS NOT NULL)
  ```
  - 지금 `APPLIED` 조건에 `deleted_at IS NOT NULL`을 더한 것이다. 같은 opId를 다시 보내 `replayed`로 건너뛸 때는 이미 바꿨으므로 문장을 넣지 않아도 된다.
- `restoreProfile`의 batch에 같은 모양의 삭제 표시 문장을 더한다(조건은 그 batch의 `APPLIED`). 보통 0행이다.
- `purge.ts`의 프로필 batch에 `UPDATE key_blobs SET content_id = NULL, nonce = NULL, ciphertext = NULL, revision = revision + 1, updated_at = ? WHERE user_id = ? AND profile_id = ? AND ciphertext IS NOT NULL AND ${STILL_DUE}`를 **`DELETE FROM profile_index …` 문장보다 앞에** 더한다. 행은 지우지 않는다(2.6).
- `shares.ts`는 바꾸지 않는다. 공유 API는 `key_` 표를 읽지도 쓰지도 않는다(7.6에서 고정).

### 4.10 클라이언트 `api.ts` 변경

- `GazuaFail`의 `conflict`에 선택 필드를 더한다. 프로필 충돌의 모양은 그대로다.
  ```ts
  | { ok: false; kind: 'conflict'; revision: number; doc: ProfileDocV1 | null; code?: string; vaultRevision?: number | null; deleted?: boolean; keyVault?: unknown; keyBlobs?: unknown }
  ```
  `mapStatus`의 409는 `body.error`를 `code`로 담는다(`conflict`·`vault-exists`·`no-vault`·`vault-changed`·`not-deleted`). `keyVault`·`keyBlobs`는 `unknown`으로 받아 `keySync.ts`가 `checkVaultHead`·`checkBlobRows`로 검사한 뒤 쓴다.
- `SyncApi`에 더한다.
  ```ts
  listKeys(): Promise<ApiResult<{ keyVault: unknown; keyBlobs: unknown }>>;
  getKeyBlob(id: string): Promise<ApiResult<unknown>>;
  createKeyVault(body: { vaultId: string; kdf: 'PBKDF2-SHA256'; iter: number; salt: string; verifier: Sealed }): Promise<ApiResult<{ vaultRevision: number; updatedAt: number }>>;
  putKeyBlob(id: string, body: { expectedRevision: number; newRevision: number; contentId: string; vaultId: string; vaultRevision: number } & Sealed): Promise<ApiResult<{ revision: number; updatedAt: number }>>;
  deleteKeyBlob(id: string): Promise<ApiResult<{ deleted: boolean; revision: number }>>; // 본문 없음
  rekey(body: RekeyBody /* 4.7, 블롭 항목에 contentId */): Promise<ApiResult<{ vaultRevision: number; updatedAt: number }>>;
  wipeKeys(): Promise<ApiResult<{ deleted: { vault: boolean; blobs: number } }>>; // 본문 없음
  ```
- 422 `key-limit`은 공통 매핑대로 `{ kind: 'invalid', code: 'key-limit' }`이 된다.

### 4.11 오류 코드 요약

| 코드 | 상태 | 엔드포인트 | 기기 처리 |
|---|---|---|---|
| `not-found` | 404 | GET·PUT 블롭, 그리고 옛 Worker의 모든 `/v1/keys*` | GET 블롭: "서버에 키가 없어요". PUT: 프로필이 아직 올라가지 않음, 다음 동기화에서 다시. `listKeys`의 404: `keySupport = false` |
| `gone` | 410 | PUT 블롭 | 그 상태 행을 `active: false`로 두고 알림 없음(프로필 삭제는 프로필 동기화가 알린다) |
| `vault-exists` | 409 | PUT 금고 | 「암호 입력」으로 바꾼다 |
| `no-vault` | 409 | PUT 블롭, rekey | 마스터 키를 잊고 `keyNotice = 'vault-gone'` |
| `vault-changed` | 409 | PUT 블롭, rekey | 마스터 키를 잊고 다음 키 단계로 금고를 다시 본다(암호 변경이면 `keyNotice = 'vault-changed'`, 다른 금고면 5.4의 `vault-gone`) |
| `conflict` | 409 | PUT 블롭, rekey | 블롭: 먼저 "서버 것이 이 기기 키와 같은가"를 본다(5.6-4). 아니면 `notice 'conflict'`(로컬 dirty)·`'newer'`·`'removed'`(서버가 삭제 표시). rekey: 다시 받아 한 번 더 |
| `key-limit` | 422 | PUT 블롭(새로 켬) | `서버에 키를 올린 프로필이 50개라 더 켤 수 없어요` |
| `invalid`·`unknown-field` | 422 | 모두 | `서버가 이 데이터를 받지 않았어요`(앱·Worker 버전 차이) |
| `too-large` | 413 | 본문이 있는 셋 | 같은 문구 |

## 5. 동작 (클라이언트 흐름)

### 5.1 구성 요소와 파일

| 파일 | 바뀌는 것 |
|---|---|
| `src/lib/state/app.svelte.ts` | `AppDeps.onSecretsChange`·`onLock`, `App.applySyncedSecrets`·`syncableSecrets`, 내부 `storeSecrets`·`forgetToken`, 공급자별 비교 `sameProviderKeys` (5.2) |
| `src/App.svelte` | `createApp`에 `onSecretsChange: (e) => sync.onSecretsChange(e)`, `onLock: () => sync.onLock()`를 넘긴다 |
| `src/lib/sync/keyStore.ts` | 새 파일. IndexedDB `gazua-sync-keys` (2.5) |
| `src/lib/sync/engine.ts` | `keys` 의존성(`step`·`reset`), `'keys'` 단계, `keysNow()`, `exclusive()`, `reset()`이 키 상태도 지움 (5.3) |
| `src/lib/sync/keySync.ts` | 새 파일. `createKeySync({ store: KeyStore, api, app, now, profileState })` |
| `src/lib/sync/controller.svelte.ts` | 마스터 키 보관, `keys` 상태 노출, 키 메서드, 키 변경 디바운스 타이머, 잊는 시점, `BroadcastChannel('gazua-keys')` (5.12) |
| `src/lib/sync/api.ts`·`forbidden.ts` | 4.10·2.4 |
| `src/lib/ui/settings/KeySync.svelte` | 새 컴포넌트. `SyncPanel.svelte` 안, 동기화 켜짐일 때만 |
| `src/lib/ui/settings/SyncPanel.svelte` | 로그인 전 안내 문구의 "키…는 올리지 않아요"를 고친다(5.15) |
| `src/lib/ui/settings/Profiles.svelte` | 삭제 확인 문구에 서버 키도 지워진다는 말을 더한다 |

### 5.2 앱 변경 (`app.svelte.ts`)

```ts
export interface AppDeps {
  // …
  /** 지금 프로필의 KIS·토스 키가 바뀌었다. providers는 값이 바뀐 공급자(proxyToken만 바뀐 경우·잠금 켜고 끄기·기기에서 삭제·동기화로 받은 키는 부르지 않는다) */
  onSecretsChange?: (e: { profileId: string; providers: ('kis' | 'toss')[] }) => void;
  /** lock()이 실제로 키를 버렸다 */
  onLock?: () => void;
}

export interface App {
  // …
  /**
   * 동기화 전용: 받은 KIS·토스 키를 지금 프로필에 병합한다. keys에 있고 로컬 값과 실제로 다른 공급자만 덮어쓰고,
   * 없는 공급자·같은 값의 로컬 키와 proxyToken은 그대로 둔다. 바뀐 것이 없으면 아무것도 쓰지 않는다.
   * 이 기기 키 잠금 설정대로 저장한다: 잠금이면 passphrase가 필요하다(호출 쪽이 verifyPassphrase로 먼저 확인한다, 5.7).
   * 바뀐 공급자의 접근 토큰만 버리고 토스가 바뀌었을 때만 주문 캐시도 버린다. onSecretsChange는 부르지 않는다.
   * 돌려주는 값은 실제로 바뀐 공급자.
   * profileId가 지금 프로필이 아니면, 잠겨 있고 풀리지 않았으면 던진다. 저장 실패는 setSecrets와 같은 오류(KeyLockNotSavedError·KeyLockedElsewhereError·StoredKeysNotRemovedError).
   */
  applySyncedSecrets(profileId: string, keys: Pick<Secrets, 'kis' | 'toss'>, passphrase?: string): Promise<('kis' | 'toss')[]>;
  /**
   * 동기화 전용: 올릴 키. 지금 프로필이 아니거나 잠겨서 풀리지 않았으면 null.
   * 잠금이 꺼져 있으면 저장소에서 새로 읽는다(다른 탭이 방금 쓴 값). 잠금이면 메모리 값이 저장소의 잠긴 키와 같은 것일 때만 돌려준다.
   */
  syncableSecrets(profileId: string): Pick<Secrets, 'kis' | 'toss'> | null;
}
```

- 공급자 하나의 값 비교는 새 함수 `sameProviderKeys(p, a, b)`로 한다. 지금 `sameCredentials`(`app.svelte.ts` :206)는 `proxyToken`까지 같아야 참이라(공급자 재구성 판단용) 여기에 쓰지 않는다.
- `setSecrets(s, passphrase)`는 쓰기에 성공한 뒤(던지기 전 포함, 이 탭 상태가 바뀐 경우) 이전 값과 `kis`·`toss`를 `sameProviderKeys`로 공급자마다 비교해, 바뀐 공급자가 있으면 `onSecretsChange({ profileId, providers })`를 부른다. 컨트롤러는 그 공급자가 선택(`KeySyncState.providers`)에 들어 있을 때만 dirty로 친다. `KeyLock.svelte`의 `lock()`은 같은 키를 다시 봉하므로 부르지 않는다.
- 부르지 않는 경우: `disableKeyLock`, `clearSecrets`(결정 12), `importData`(새 프로필이라 토글이 꺼져 있다), `applySyncedSecrets`, 다른 탭 `onStorage`(그 탭이 이미 불렀다).
- 저장 경로는 `setSecrets` 본문을 내부 함수 `storeSecrets(s, passphrase, { notify, forget })`로 빼서 함께 쓴다. `forget: 'all' | ('kis' | 'toss')[]`.
  - `setSecrets`는 `forget: 'all'`로 지금 동작(평문 경로 `forgetTokens(id)` 두 공급자, 잠금 경로 `forgetTokens` + `forgetOrders`)을 그대로 지킨다.
  - `applySyncedSecrets`는 `forget: 바뀐 공급자`. 그 공급자 토큰만 `forgetToken(id, p)`(저장소 `profileKeys.token(id, p)`와 `memoryTokens`의 `${id}:${p}`)로 지우고, `toss`가 들어 있을 때만 `forgetOrders(id)`를 부른다. 토스는 키마다 토큰이 하나라, KIS만 바뀌었는데 토스 토큰까지 버리면 이 기기가 토스 토큰을 다시 받아 다른 기기의 토스 토큰을 끊는다.
- `applySyncedSecrets`는 비밀번호를 확인하지 않는다. 호출 쪽(`keySync.ts`)이 잠금 밖에서 `verifyPassphrase`를 먼저 부른다(5.7). 310000회 KDF를 잠금 안에서 두 번 돌리지 않게 하기 위해서다.
- **저장 직전 다시 보기.** `ConnectionForm.svelte`의 저장(:130 → `setSecrets`)은 동기화 Web Lock을 잡지 않는다. 그래서 동기화 잠금만으로는 다른 탭이 같은 프로필 키를 바꾸는 것을 막지 못한다. `applySyncedSecrets`는 시작할 때 `JSON.stringify(storage.readBacking(profileKeys.secrets(id), null))`(`readBacking`은 파싱한 값을 돌려준다, `storage.ts` :90 근처)을 읽어 두고, 병합·다시 봉하기(잠금 프로필이면 `lockSecrets` 310000회)를 마친 **쓰기 직전에** 원문을 다시 읽는다. 다르면 아무것도 쓰지 않고 `SecretsChangedError`를 던진다(호출 쪽은 `그사이 이 기기 키가 바뀌었어요. 다시 받아 주세요`). 쓰기 직전의 비교와 쓰기를 같은 동기 구간에 두어 경합 창을 아주 짧게 만든다(브라우저 탭 사이 `localStorage`는 원자적 비교-쓰기를 주지 않으므로 완전히 없애지는 못한다. 남은 경우는 다른 탭의 `onStorage`가 따라가고, 이 기기 수정이 덮였다면 사용자가 다시 넣으면 된다).
- `lock()`은 `if (!locked) return;` 뒤, 키를 버린 다음 `deps.onLock?.()`을 부른다.

### 5.3 엔진 안의 키 단계 위치

```ts
export interface SyncEngineDeps {
  // …
  /** 키 동기화. 없으면 단계를 건너뛴다 */
  keys?: {
    /** 실패는 스스로 상태에 남기고 'idle'을 돌려준다(auth·not-allowed만 그 단계 값) */
    step(): Promise<SyncPhase>;
    /** 계정 전환: 키 저장소를 비운다 */
    reset(): Promise<void>;
  };
}
export interface SyncEngine {
  // …
  /** 키 단계만(이 기기 키 변경 직후, 받기·올리기 뒤) */
  keysNow(): Promise<void>;
  /** 엔진과 같은 직렬화(탭 안 chain + Web Lock) 안에서 fn을 돈다. 켜기·받기·끄기·rekey·전체 삭제가 쓴다 */
  exclusive<T>(fn: () => Promise<T>): Promise<T>;
}
```

- `syncNow`는 `run(['pull', 'keys', 'push'])`, `keysNow`는 `run(['keys'])`, `flush`·`pull`은 그대로다. `run`의 단계 반복은 지금처럼 단계 사이에 꺼짐·저장 실패를 다시 본다.
- **pull 다음에 두는 이유:** pull이 다른 기기의 tombstone을 먼저 적용해 지운 프로필의 블롭을 올리려 하지 않는다. 다른 기기가 만든 프로필도 먼저 로컬에 생겨 "받을 수 있어요"를 바로 보일 수 있다.
- **push 앞이라 생기는 일:** 이 기기에서 방금 만든 프로필은 아직 서버에 없어 블롭 PUT이 404다. 켤 수 있는 조건(1.4)이 `syncedRevision > 0`이라 보통 생기지 않고, 생기면 dirty로 두고 다음 동기화에서 다시 한다.
- 키 단계의 네트워크 실패(`offline`·`limit`·`server`)는 키 상태에만 남기고 `'idle'`을 돌려 프로필 올리기를 막지 않는다. `auth`·`not-allowed`는 지금 `failed()`와 같이 그 단계 값을 돌려 로그인 정리를 탄다.
- `exclusive`는 지금의 `serial`을 그대로 내보낸 것이다. 켜기·받기 같은 사용자 동작이 다른 탭의 키 단계와 겹치지 않는다. 동기화 암호 KDF(600000회)는 **잠금 밖**에서 먼저 하고, 네트워크·저장 단계만 잠금 안에서 한다.
- `reset()`은 지금 지우는 것에 더해 `keys.reset()`(키 저장소 `clear()`)을 부른다.
- 키 변경 디바운스(5.6)는 엔진의 `debounce` 변수(`profileChanged`용, 하나뿐)를 쓰지 않는다. 컨트롤러가 따로 타이머를 두고 `reset`·`destroy`·마스터 키 잊기·동기화 끄기에서 지운다.

### 5.4 키 단계 판정표 (`keySync.ts` `step()`)

잠금 안에서 먼저 저장된 세션·소유자를 메모리 값과 견준다(5.12 #5). 그다음 `listKeys()`를 한 번 부르고 응답을 검사한 뒤(2.2), 로컬 프로필 목록(`app.meta.profiles`)과 `states()`로 아래를 정한다.

**계정 단위(먼저):**

| 서버 금고 | 저장한 `keyVault` | 처리 |
|---|---|---|
| 404(옛 Worker) | – | `keySupport = false`, 끝 |
| 응답 모양이 틀림 | – | 끝. `서버 응답이 맞지 않아요`. 아무것도 쓰지 않는다 |
| 없음 | 있음 | 마스터 키를 잊는다. 키 저장소 `clear()`(서버 행도 모두 지워졌으므로 본 리비전도 버린다) 뒤 `keyNotice = 'vault-gone'`, `keyVault = null` |
| 있음 | 없음 | `keyVault` 저장 |
| 있음, `vaultId`가 다름 | 있음 | 다른 금고다(전체 삭제 뒤 새로 만듦). 새 금고는 새 `vaultId`라 옛 리비전과 AAD가 겹치지 않으므로 본 리비전을 버려도 된다. 마스터 키를 잊고 `clear()` 뒤 `keyVault` 저장, `keyNotice = 'vault-gone'`(이 기기가 만든 것이면 제외) |
| 있음, `vaultId` 같고 `salt`나 `vaultRevision`이 다름 | 있음 | 암호가 바뀌었다. 기억 중인 마스터 키가 옛 것이면 잊는다. `keyNotice = 'vault-changed'`(이 탭이 바꾼 것이면 제외). `keyVault`를 새 값으로 쓴다. rekey는 블롭 리비전과 내용 ID를 바꾸지 않으므로 상태 행은 그대로다 |
| 같음 | 같음 | 할 일 없음 |

- 마지막에 `keySupport = true`.

**프로필 단위(로컬에 있는 프로필만, 서버 행은 4.2 목록):**

목록에서 모양이 틀려 걸러낸 행(2.2)의 프로필은 이번 단계에서 건너뛰고 상태 행을 건드리지 않는다(「목록에 없음」으로 치지 않는다). 키 영역에 `서버 응답이 맞지 않아요`를 보인다.

먼저 로컬에 없는 프로필의 켜진 행을 `setActive(false)`로 끈다(다른 기기의 삭제를 pull이 적용한 경우. `app.removeSyncedProfile`은 `onSyncableChange('deleted')`를 부르지 않으므로 키 단계가 맡는다). 서버에만 있는 프로필의 블롭은 무시한다(pull이 아직 들이지 않은 프로필).

이 절에서 **맞춘 상태**는 켜진 행이고 `revision = r`이며 `syncedContentId = 서버 행 contentId`인 것이다. 리비전만 보지 않는 이유: D1을 이전 시점으로 복구한 뒤에는 다른 기기가 이 기기가 이미 맞춘 번호로 다른 내용을 올릴 수 있다(각 기기는 자기가 본 번호만 피한다, 4.5). 내용 ID는 올릴 때마다 무작위로 새로 고르고 rekey가 바꾸지 않으므로, 같은 번호의 다른 내용을 마스터 키 없이 가린다.

다음으로 서버 행이 **살아 있을 때만** 되감기를 가린다. 상태 행이 있고 `r < seenRevision`이며 맞춘 상태가 아니면 서버가 되감긴 것이다. 켜진 행이면 받지도 올리지도 않고 `setNotice('rollback', r)`로 알리고 고르게 한다(5.8). 꺼진 행이면 알리지 않고 꺼진 채 둔다(다시 켜면 이 기기 키가 본 번호보다 큰 리비전으로 올라간다, 5.5). 되감기 알림에서 「서버 키 받기」를 고르면 맞춘 상태가 되어 같은 행은 다시 되감기가 아니다. 삭제 표시 행은 되감기로 보지 않고 아래 표대로 쓴다(복구 뒤 다른 기기가 끈 것도 「껐어요」로 알린다). 되감기가 아니면 `markSeen(id, r)` 뒤 아래 표로 간다.

- 삭제 표시 뒤의 같은 리비전으로 살아 있는 행이 오는 경우는 따로 가리지 않는다. 그 리비전 AAD로 봉한 암호문은 거절된 PUT(그사이 끄기가 그 번호를 차지해 409가 난 요청)으로만 서버에 갔을 수 있고, 내용은 사용자가 올리려던 자기 키다. 서버가 그것을 살아 있는 행으로 내주면 받을 수 있는 것으로 보이지만 피해가 작아 상태를 늘리지 않는다(6절 한계).

| 상태 행 | 서버 행 | dirty(`localSeq > uploadedSeq`) | 처리 |
|---|---|---|---|
| 없음·꺼짐 | 없음·삭제 표시 | – | 없음(토글 꺼짐). 삭제 표시면 `markSeen`이 본 리비전만 남긴다 |
| 없음·꺼짐 | 살아 있음 | – | `activate(id, { providers: [], notice: 'available', remoteRevision: r })`. 「키를 받을 수 있어요 [받기]」 |
| 켜짐, `revision 0` | 삭제 표시 | – | 알기만 하던 것이 꺼졌다. 조용히 `setActive(false, notice: null)` |
| 켜짐, `revision > 0` | 삭제 표시 | – | `offPending`이면 내 끄기가 반영된 것이라 조용히 `setActive(false, offPending: false)`. 아니면 「다른 기기에서 키 동기화를 껐어요. 이 기기의 키는 그대로예요」(`setActive(false, notice: 'removed')`, 닫으면 `notice null`). dirty여도 올리지 않는다(다시 켜는 것은 사용자가) |
| 있음 | 목록에 없음(그 프로필이 서버에서 삭제·정리됐거나 아직 없음) | – | 알리지 않는다. 켜진 행이면 `setActive(false)`(본 리비전은 남는다) |
| 맞춘 상태 | 살아 있음 | 아님 | 할 일 없음. `notice`가 `newer`·`conflict`·`rollback`이었으면 지움 |
| 맞춘 상태 | 살아 있음 | 맞음 | 자동 올리기(5.6). 마스터 키가 없으면 「올릴 키 변경이 있어요. 동기화 암호를 넣으면 올려요」 |
| 켜짐, 맞춘 상태 아님(`revision < r`, 또는 `revision = r`인데 내용 ID가 다름) | 살아 있음 | 아님 | `setNotice('newer', r)`: 「다른 기기에서 키가 바뀌었어요 [받기]」. `revision 0`이면 `setNotice('available', r)` |
| 켜짐, 맞춘 상태 아님 | 살아 있음 | 맞음 | 먼저 5.6-4(서버 것이 이 기기 키와 같으면 충돌이 아니다). 아니면 `setNotice('conflict', r)`: 「이 기기에도 올리지 않은 키 변경이 있어요 [이 기기 키 올리기] [서버 키 받기]」. `revision 0`(켜기가 다른 기기와 겹친 행, 5.5-4)도 dirty면 여기다 |

- 서버 행이 살아 있으면 어느 행에서든 `offPending`을 내린다(끄기가 실패했다). 삭제 표시일 때만 위 표대로 쓴다.
- `newer`·`conflict`·`available`·`rollback`의 `remoteRevision`은 키 단계마다 지금 `r`로 맞춘다. 받기·올리기는 이 값을 기준으로 한다(5.7·5.8).
- 받기는 늘 사용자가 누른다(결정 5).
- 상태 행의 쓰기는 모두 `activate`·`markSeen`·`setActive`·`setNotice`·`markSynced`·`bumpSeq`·`setProviders`다(2.5). 행을 통째로 다시 쓰거나 지우지 않는다.

### 5.5 켜기

1. 토글은 `KeySync.svelte`에서 지금 프로필 한 줄이다. 꺼짐→켬을 누르면 위험 안내 시트(5.16)를 연다. 시트 안에 공급자 체크(아래 「공급자 고르기」)가 있고, 「이해했어요」 체크와 공급자 하나 이상이 있어야 「계속」이 켜진다.
2. 금고 상태로 나뉜다(`listKeys`를 다시 부른다).
   - **금고 없음:** 「동기화 암호 정하기」(암호, 암호 확인, 3.4 검사). 잠금 밖에서 salt·`vaultId`를 만들고 `deriveVaultKey` → `makeVerifier(key, vaultId, 1)`. 잠금 안에서 `createKeyVault`. 409 `vault-exists`면 "다른 기기에서 먼저 암호를 정했어요. 그 암호를 입력해 주세요"로 바꿔 아래로 간다.
   - **금고 있음, 마스터 키 없음(또는 기억 중인 키가 이 금고 것이 아님):** 「동기화 암호 입력」. `deriveVaultKey(pass, salt, iter)` → `checkVerifier`. 틀리면 `동기화 암호가 맞지 않아요`.
   - **이 금고의 마스터 키 있음:** 바로 3.
3. 잠금 안에서:
   1. **상태 행을 먼저 켠다**: `activate(id, { providers, notice: null })`(본 리비전은 둔 채 `revision 0`, dirty 없음). 이때부터 다른 탭의 키 변경(`bumpSeq`)이 무시되지 않는다.
   2. `seq = localSeq`를 읽는다.
   3. `syncableSecrets(id)`로 키를 읽어 고른 공급자만 담은 `KeyPlainV1`을 만들고(2.3 검사), 서버 행의 지금 리비전 `r`(행 없음 0, 삭제 표시면 그 리비전)와 `n = max(seenRevision, r) + 1`로 새 `contentId = randomBytes(16)`로 `sealKeys(key, { vaultId, profileId, revision: n, contentId, vaultRevision }, plain)` → `putKeyBlob(id, { expectedRevision: r, newRevision: n, contentId, vaultId, vaultRevision, … })`. 서버가 되감겼어도(`r < seenRevision`) 켜는 것은 이 기기 키를 새로 올리겠다는 뜻이라 그대로 올린다. `n`이 본 번호보다 커서 번호가 다시 쓰이지 않는다.
   4. 성공하면 `markSynced(id, { revision: n, contentId: 보낸 contentId, uploadedSeq: seq, providers, notice: null })`, `markSeen(id, n)`.
4. 실패 처리:
   - 409 `conflict`: 먼저 5.6-4를 본다. 아니면(다른 기기가 그사이 켰다) `bumpSeq(id)`로 이 기기 키를 올릴 변경으로 남기고 `setNotice('conflict', 서버 리비전)`. 행은 `active` 그대로다. 다음 키 단계도 dirty라 판정표의 「`revision < r` + dirty = conflict」로 같은 알림을 지킨다(「이 기기 키 올리기」가 사라지지 않는다).
   - 404: `먼저 동기화가 끝나야 켤 수 있어요`. 그 밖의 실패(오프라인·5xx·`vault-changed` 등)도 같은 꼴로 알리고, 두 경우 모두 행을 `setActive(false)`로 되돌린다(행은 지우지 않는다. 본 리비전을 지킨다).
5. 마스터 키는 컨트롤러 메모리에 `{ key, vaultId, salt, vaultRevision }`로 둔다.

**공급자 고르기 (결정 9)**

| 항목 | 규칙 |
|---|---|
| 자리 | 토글 아래 체크 두 개 `KIS 키`·`토스 키`. 켤 때 시트에도, 켠 뒤 토글 아래에도 같은 체크가 있다 |
| 기본값 | 켤 때 KIS 켬, 토스 끔. 이 기기에 KIS 키가 없으면 KIS도 끈 채로 시작한다(토스만 있는 기기는 토스를 직접 켜야 한다) |
| 고를 수 없음 | 이 기기에 그 공급자 키가 없으면 체크를 끈 채 `disabled`, 옆에 `이 기기에 키가 없어요` |
| 둘 다 끄기 | 막는다. 하나만 켜져 있으면 그 체크는 `disabled`이고 `그만 올리려면 위 토글을 꺼 주세요`. 공급자 없는 블롭(`{v:1}`)을 두지 않아, "꺼짐 = 살아 있는 블롭 없음"이라는 한 가지 뜻과 즉시 삭제 경로(5.9)를 지킨다 |
| 토스 경고 | 토스 체크를 켜는 순간 그 아래에 `토스 키는 키마다 토큰이 하나라 동시에 한 기기에서만 잘 돼요. 다른 기기에서 쓰면 이 기기의 토큰이 끊길 수 있어요`(`role="status"`). 켠 동안 계속 보인다 |
| 선택 바꾸기 | 켠 뒤 체크를 바꾸면 `setProviders(id, providers)`(선택 저장 + `localSeq` 올림) → 5.6 자동 올리기로 **새 블롭**(새 공급자 집합)을 올린다. 마스터 키가 없으면 `올릴 키 변경이 있어요` 안내 |
| 받는 쪽 | 블롭에 있는 공급자만 덮어쓰고 없는 공급자의 로컬 키는 건드리지 않는다(5.7). 받은 뒤 `providers`를 블롭의 집합으로 맞춘다 |
| 선택에서 뺀 공급자 | 서버에서는 그 값이 다음 블롭에서 빠진다. 다른 기기에 이미 받은 그 키는 남는다(병합이라 지우지 않는다). 받는 기기에 `토스 키는 더 이상 동기화하지 않아요. 이 기기의 토스 키는 그대로예요` 스낵바(받기 전 `providers`보다 줄었을 때) |
| 고른 공급자의 키가 이 기기에서 없어짐 | 예: 「이 기기에서 키 삭제」 뒤. 올리지 않는다(빠진 값으로 올리면 선택이 몰래 바뀐다). `notice 'missing-key'`: `KIS 키가 이 기기에 없어 올리지 못했어요. 키를 넣거나 선택을 바꿔 주세요` |

- 공급자 집합을 평문 안에 두는 안을 고른 근거: 서버(D1·로그)가 어느 공급자 키를 가졌는지조차 모르고, 값과 선택이 어긋날 수 없다. 공급자마다 블롭을 따로 두는 안은 서버가 공급자 수를 알게 되고, 행·리비전·AAD가 공급자 수만큼 늘어 rekey와 충돌 판정이 복잡해져 고르지 않았다.
- 받는 쪽 병합은 받는 기기만 쓰는 공급자(예: 그 기기에서만 쓰는 토스 키)를 지키기 위해서다. 그래서 "서버 블롭 = 이 프로필 키 전체"가 아니라 "고른 공급자의 최신 값"이다.

### 5.6 이 기기 키 변경과 자동 올리기

1. `ConnectionForm.svelte`의 저장이 `app.setSecrets`를 부르면 `onSecretsChange({ profileId, providers })` → 컨트롤러 `onSecretsChange` → `keyStore.bumpSeq(profileId, providers)`(행이 없거나 꺼진 행이면 무시. 고르지 않은 공급자만 바뀌었으면 무시). 선택 바꾸기(5.5)도 같은 dirty를 만든다.
2. 켜진 행이면 컨트롤러의 키 타이머로 3초 뒤 `engine.keysNow()`를 부른다(5.3).
3. 키 단계에서 dirty이고 맞춘 상태(5.4)이며 이 금고의 마스터 키가 있으면, 잠금 안에서:
   - `seq = localSeq`를 먼저 읽고, 다음에 `syncableSecrets(id)`로 평문을 읽는다(순서가 중요하다, 5.13).
   - `null`(지금 프로필이 아님·잠김)이면 dirty로 둔다.
   - 행의 `providers`에 든 공급자만 담는다. 그 가운데 이 기기에 값이 없는 것이 있으면 올리지 않고 `notice 'missing-key'`.
   - `n = max(seenRevision, revision) + 1`과 새 `contentId`로 `sealKeys(…)` → `putKeyBlob({ expectedRevision: revision, newRevision: n, contentId, … })`. 방금 봉한 평문은 이 단계가 끝날 때까지만 메모리에 둔다.
   - 성공: `markSynced({ revision: n, contentId: 보낸 contentId, uploadedSeq: seq, notice: null, … })`, `markSeen(n)`(그사이 오른 `localSeq`는 남아 다음에 또 올린다).
   - 409 `conflict` → 판정표(다음 단계의 「`revision < r` + dirty」가 아래 4를 본다), 409 `vault-changed`·`no-vault` → 5.12, 410 → `setActive(false)`.
4. **서버 것이 이 기기 키와 같은가(응답 유실 포함):** 올리기의 응답을 잃으면 상태 행은 옛 리비전·dirty로 남고, 다음 키 단계는 서버의 새 리비전(내가 보낸 것)을 「`revision < r` + dirty」로 본다. 이때 PUT을 다시 보내지 않으므로 409에 기대지 않는다. 대신 이 행에 닿으면 잠금 안에서 `seq`를 읽고 `getKeyBlob` → `openKeys`로 서버 평문을 얻어, 지금 이 기기의 고른 공급자 키와 같으면(공급자 집합과 값 모두) 충돌이 아니다: `markSynced({ revision: r, contentId: 서버 contentId, uploadedSeq: seq, notice: null })`. 내 업로드였든 다른 기기가 같은 키를 올렸든 결과가 같으므로 따로 기록할 상태가 없다. 다르면 `conflict`. 비교할 수 없으면 판정을 미룬다: 이 금고의 마스터 키가 없으면 「올릴 키 변경이 있어요. 동기화 암호를 넣으면 올려요」(암호를 넣으면 이 확인부터 한다), 지금 프로필이 아니거나 잠겨서 `syncableSecrets`가 null이면 알림을 바꾸지 않는다(그 프로필을 열 때 다시 본다). 셋 다 `conflict`로 떨어뜨리지 않는다. 켜기(5.5-4)와 「이 기기 키 올리기」(5.8)의 409·응답 유실도 같은 확인으로 끝난다.

### 5.7 받기

1. 「받기」(또는 충돌의 「서버 키 받기」)를 누른다. 지금 프로필이어야 한다.
2. 마스터 키가 없거나 이 금고 것이 아니면 「동기화 암호 입력」 시트.
3. 이 기기 키 잠금이 켜져 있으면(`app.settings.keyLock`) 같은 시트에 「이 기기 잠금 암호」 칸을 더 둔다. **잠금 밖에서** `app.verifyPassphrase(lockPass)`로 먼저 확인하고, 틀리면 `이 기기 잠금 암호가 맞지 않아요`.
4. 잠금 안에서:
   1. `seq = localSeq`를 먼저 읽는다.
   2. `getKeyBlob(id)` → 응답 검사(2.2). `blob.revision`이 알림의 `remoteRevision`과 다르면(그사이 바뀜) 쓰지 않고 판정표로 돌아간다. 되감기 알림에서 「서버 키 받기」를 고른 경우가 아니면, `seenRevision`보다 작은 리비전도 쓰지 않는다(`notice 'rollback'`).
   3. `openKeys(key, { vaultId, profileId, revision: blob.revision, contentId: blob.contentId, vaultRevision: blob.vaultRevision }, blob)`. `contentId`는 AAD로 확인되므로 풀리면 받은 내용과 맞다. 받은 뒤 이 값을 `syncedContentId`로 남긴다. 실패(`auth`)면 8절 「블롭이 풀리지 않음」으로 가고 아무것도 쓰지 않는다.
   4. 덮어쓸 공급자 가운데 이 기기에 다른 값이 있으면(특히 `available` 받기) 잠금을 놓기 전에 확인을 한 번 받는다: `이 기기의 KIS 키가 서버 키로 바뀌어요`. 취소하면 아무것도 쓰지 않는다. (확인 시트를 띄우려고 잠금을 오래 쥐지 않도록, 실제 구현은 4-2·4-3을 잠금 안에서 하고 결과를 들고 나와 확인을 받은 뒤 다시 잠금을 잡아 `revision`이 그대로인지 보고 5로 간다.)
   5. `changed = await app.applySyncedSecrets(id, plain에 있는 공급자만, lockPass)`. 블롭에 없는 공급자, 같은 값의 공급자는 그대로다(병합). 잠금 프로필이면 다시 봉하는 310000회 KDF 한 번이 돈다. 연결 설정 저장은 동기화 잠금을 잡지 않으므로, 그사이 다른 탭이 키를 바꿨으면 `applySyncedSecrets`가 쓰기 직전 원문 비교로 알아보고 쓰지 않는다(5.2 「저장 직전 다시 보기」). 그때는 `SecretsChangedError` 문구를 보이고 상태 행은 그대로 둔다(다시 받을 수 있게). 잠금 확인 KDF는 3에서 이미 밖으로 뺐다.
   6. `markSynced(id, { revision: blob.revision, contentId: blob.contentId, providers: 블롭의 공급자 집합, uploadedSeq: seq, notice: null })`, `markSeen(id, blob.revision)`. `uploadedSeq`는 1에서 읽은 값이라 그 뒤 다른 탭이 바꾼 키는 dirty로 남는다.
5. 스낵바 `키를 받았어요`(바뀐 것이 없으면 `이미 같은 키예요`). 지금 데이터 공급자에 맞는 키가 없으면(예: 공급자는 토스인데 KIS만 받음) `연결 설정에서 공급자를 확인해 주세요`를 함께 보인다. 지금 공급자가 데모면 그대로 둔다(1.4). 선택이 줄었으면 5.5의 스낵바.

### 5.8 충돌 고르기
- **되감기(`rollback`) 알림**도 같은 두 단추를 보인다. 알림 문구 `서버 키가 예전 것으로 돌아갔어요(서버 복구 등). 받지 않았어요`. 「서버 키 받기」는 `이 기기 키가 서버의 예전 키로 바뀌어요`를 확인받고 5.7로 받는다(받은 뒤 맞춘 상태가 되어 같은 행은 다시 되감기로 보지 않는다. `seenRevision`은 내리지 않으므로 다음 올리기는 본 번호보다 큰 리비전을 쓴다). 「이 기기 키 올리기」는 아래와 같다. 이 기기에 키가 없으면 그 단추는 끈다. 끄기(5.9)도 언제든 된다.
- 「서버 키 받기」 = 5.7(이 기기 변경을 버린다고 시트에 적는다: `이 기기에서 바꾼 키는 서버 키로 바뀌어요`).
- 「이 기기 키 올리기」 = 마스터 키(없으면 암호 입력) → `seq` 읽기 → 새 `contentId`를 골라 봉하고 `putKeyBlob({ expectedRevision: remoteRevision, newRevision: max(seenRevision, remoteRevision) + 1, contentId, … })`(5.5·5.6과 같다). 다른 기기 변경을 덮는다고 확인을 한 번 받는다(`다른 기기에서 바꾼 서버 키를 이 기기 키로 바꿔요`). 성공하면 `markSynced`(보낸 `contentId`). 다시 409면 판정표로 돌아간다.

### 5.9 끄기·서버 키 모두 지우기
- **끄기:** 확인 `서버에서 이 프로필의 키를 지울까요? 이미 받은 다른 기기의 키는 그대로 남아요.` → 잠금 안에서 `setActive(id, { active: true, offPending: true })` → `deleteKeyBlob(id)`.
  - 성공(200)했을 때만 `markSeen(id, 응답 revision)`, `setActive(id, { active: false, offPending: false, notice: null })`로 토글을 끈다. 행은 지우지 않는다(본 리비전을 지켜, 서버가 끄기 직전의 살아 있는 행을 되돌려 주어도 받지 않게, 5.4). 마스터 키는 그대로 둔다(다른 프로필이 쓸 수 있다). 로컬 키는 그대로다.
  - 실패(오프라인·5xx·한도)면 토글을 **켜진 채** 두고 `서버에서 키를 지우지 못했어요. 연결을 확인하고 다시 꺼 주세요`를 보인다. 꺼진 것처럼 보이는데 서버에 암호문이 남는 일을 만들지 않는다(결정 6). 다시 시도는 사용자가 한다. 응답만 잃었고 서버에는 반영됐다면 다음 키 단계가 `offPending`을 보고 「다른 기기에서 껐어요」 대신 조용히 끈다. 서버 행이 살아 있으면(리비전과 상관없이) 끄기가 실패한 것이라 `offPending`을 내린다(5.4). 켜기의 응답을 잃은 경우는 `setActive(false)` 뒤 다음 단계에서 자기 업로드가 「받을 수 있어요」로 다시 보이는데, 받으면 같은 키라 해가 없어 따로 표시하지 않는다.
  - `revision 0`(다른 기기가 켠 것을 알기만 한) 행에서 끄기도 같다. 이 프로필의 서버 키를 지우는 것이라 확인 문구에 `다른 기기에서 켠 키 동기화도 꺼져요`를 더한다.
- **서버의 키 모두 지우기:** 금고가 있을 때만 보인다. 확인 `서버에 올린 모든 프로필의 키와 동기화 암호 정보를 지울까요? 되돌릴 수 없어요. 이미 받은 기기의 키는 남아요.` → `wipeKeys()`. 성공하면 키 저장소 `clear()`, 마스터 키 잊음, `BroadcastChannel`로 알림. 실패면 아무것도 지우지 않고 오류 문구.
- 프로필 삭제는 tombstone이 서버에서 암호문을 지운다(2.6). `Profiles.svelte` 확인 문구: `'<이름>' 프로필을 지울까요? 이 프로필의 관심종목과 키도 함께 지워져요. 서버에 올린 키도 지워져요.`(키 동기화가 켜진 프로필일 때만 뒷문장).

### 5.10 암호 바꾸기
1. 「동기화 암호 바꾸기」: 현재 암호, 새 암호, 새 암호 확인. 현재 암호로 `deriveVaultKey` → `checkVerifier`(틀리면 멈춤). 새 암호 3.4 검사, 현재와 같으면(NFC 뒤) `지금 암호와 같아요`.
2. 잠금 밖에서 새 salt로 새 키를 만든다.
3. 잠금 안에서 `listKeys()` → 살아 있는 블롭마다 `getKeyBlob` → 옛 키로 `openRaw`(평문 모양은 보지 않는다. 새 버전 앱이 만든 블롭도 다시 봉할 수 있게). 하나라도 풀리지 않으면 멈추고 `풀 수 없는 키가 있어 암호를 바꾸지 못했어요`(서버에 쓰지 않는다).
4. 새 키로 `makeVerifier(newKey, vaultId, v + 1)`, 블롭마다 `sealRaw(newKey, { vaultId, profileId, revision, contentId, vaultRevision: v + 1 }, bytes)`(`contentId`는 그 블롭의 것을 그대로) → `rekey`(블롭 항목마다 `profileId`·`revision`·`contentId`를 함께 보내 서버가 같은 내용인지 확인한다, 4.7).
5. 409 `conflict`면 3부터 한 번 더 한다. 두 번째도 409면 `다른 기기에서 키를 바꾸는 중이에요. 잠시 뒤 다시 해 주세요`.
6. 응답을 잃었으면(오프라인) 머리를 다시 읽어 salt가 보낸 새 salt면 성공으로 본다. 아니면 실패로 알린다.
7. 성공하면 메모리 마스터 키를 새 키로 바꾸고 `meta.keyVault`를 맞춘다. `BroadcastChannel`로 다른 탭에 알려 옛 키를 잊게 한다. 다른 기기는 다음 키 단계에서 `vault-changed`로 옛 키를 잊는다. 블롭 `revision`·`contentId`는 그대로라 「키가 바뀌었어요」는 뜨지 않는다.
- 블롭 50개를 풀고 다시 봉하는 일은 AES-GCM이라 짧다. KDF는 두 번(현재·새)이다.

### 5.11 암호 분실
- 「동기화 암호 입력」 시트에 `암호를 잊었어요` 글자 단추를 둔다. 누르면 5.9의 「서버의 키 모두 지우기」 확인으로 간다. 지운 뒤에는 토글을 다시 켜서 새 암호를 정한다(새 금고 ID). 다른 기기는 `vault-gone` 안내를 받는다.

### 5.12 메모리 마스터 키를 잊는 모든 시점

컨트롤러의 `forgetVaultKey()`가 `vaultKey = null`로 만든다. 부르는 곳:

| # | 시점 | 어디서 |
|---|---|---|
| 1 | 탭 닫기·새로고침 | 메모리라 저절로 |
| 2 | `pagehide`(bfcache로 되살아나도 남지 않게) | 컨트롤러 `attach`에서 듣는다 |
| 3 | `app.lock()`이 키를 버림 | `AppDeps.onLock` → `sync.onLock()` |
| 4 | 로그아웃·세션을 잃음(철회·만료·허용 목록 밖) | `signOut`·`forget()`. `BroadcastChannel('gazua-keys')`에 `{ type: 'forget' }`을 보낸다 |
| 5 | 다른 탭의 로그아웃·계정 전환 | 위 채널 메시지를 받으면 잊는다. 채널이 없는 브라우저를 위해 키 단계와 모든 키 동작이 잠금 안에서 IndexedDB `SESSION_KEY`의 ID와 `OWNER_KEY`를 메모리의 `session.id`·`owner`와 견주고, 다르면 잊고 멈춘다. 지금 컨트롤러에는 메모리 소유자가 없으므로(`OWNER_KEY`는 `startSession` :224·`acceptSocialSession` :277에서 저장소로만 읽고 쓴다) 변수 `owner`를 더한다: `attach`에서 `OWNER_KEY`를 읽어 정하고, 두 함수가 `setMeta(OWNER_KEY, …)` 뒤 같은 값으로 바꾼다. 로그아웃·`forget()`은 `owner`를 비우지 않는다(저장소의 값도 그대로라 비교가 맞는다). 마스터 키가 메모리에 있을 때 `owner`가 없을 수는 없다(로그인 뒤에만 키를 만든다) |
| 6 | 이 탭의 계정 전환 | `startSession`·`acceptSocialSession`에서 owner가 달라 `engine.reset()`을 부를 때. 채널에도 보낸다 |
| 7 | 동기화 끄기 | `setEnabled(false)` |
| 8 | 서버 금고가 사라짐·바뀜(`vaultId`·`salt`·`vaultRevision`) | 키 단계 판정표, PUT의 409 `no-vault`·`vault-changed`. 그리고 키를 **쓰기 직전마다** 메모리 키의 `{ vaultId, salt, vaultRevision }`을 방금 받은 머리와 견준다 |
| 9 | 이 기기·다른 탭에서 「서버의 키 모두 지우기」·암호 바꾸기 | 5.9·5.10, 채널 `{ type: 'forget' }` |
| 10 | 사용자가 「잊기」 | `KeySync.svelte` |
| 11 | 컨트롤러 `destroy` | `destroy` |

- 다른 탭의 `lock()`은 이 탭의 마스터 키를 잊게 하지 않는다(각 탭 메모리, 결정 7의 `lock()`은 그 탭의 동작이다).
- 세션 ID는 탭 메모리에 있어서(1.2), 다른 탭이 로그아웃해도 이 탭의 요청은 그대로 나갈 수 있다. 그래서 #5의 채널·저장값 비교를 둔다.
- 마스터 키는 `CryptoKey`(`extractable: false`)라 `exportKey`로 꺼낼 수 없다. 암호 문자열은 KDF가 끝나면 컴포넌트 상태에서 바로 비운다(`pass = ''`).

### 5.13 탭 사이 경쟁

| 경우 | 처리 |
|---|---|
| 두 탭이 같은 dirty를 올림 | Web Lock으로 차례로 돈다. 뒤 탭은 잠금 안에서 상태를 다시 읽어 dirty가 아니면 올리지 않는다 |
| 올리는 중에 다른 탭이 키를 또 고침 | 올리기 전에 `seq`를 먼저 읽고 평문을 나중에 읽는다. 끝나면 `markSynced`가 `uploadedSeq = seq`만 쓰고 `localSeq`는 그대로 두므로(한 트랜잭션) 그 뒤의 `bumpSeq`는 dirty로 남는다 |
| 다른 탭이 쓴 키를 이 탭 메모리가 아직 모름 | `syncableSecrets`가 잠금 꺼짐이면 저장소에서 새로 읽고, 잠금이면 메모리가 저장된 잠긴 키와 같을 때만 쓴다(다르면 null, 그 탭이 올린다) |
| 켜는 중에 다른 탭이 키를 고침 | 켜기는 PUT 전에 `activate`로 행을 먼저 켜고 그다음 `seq`, 그다음 평문을 읽는다(5.5-3) |
| 두 탭이 동시에 켜기(금고 만들기) | 하나는 409 `vault-exists` → 암호 입력으로 |
| 같은 기기 다른 탭이 암호를 바꿈 | 채널 알림으로 잊는다. 알림을 놓쳐도 키를 쓰기 직전 머리 비교(5.12 #8)로 옛 키를 알아본다. 그래서 받기가 `auth` 실패로 끝나 멀쩡한 서버 키를 지우라고 권하는 일이 없다(8절) |
| A 탭 rekey 중 B 탭 자동 올리기 | 같은 Web Lock이라 차례로 돈다. 다른 기기라면 B의 PUT이 409 `vault-changed`가 되거나 A의 rekey가 409로 다시 시도한다 |
| 받기와 자동 올리기가 겹침 | 같은 잠금. 받기가 시작할 때 읽은 `seq`로 `uploadedSeq`를 맞추므로 받은 뒤 옛 키를 올리지 않고, 받는 사이 다른 탭이 바꾼 키는 잃지 않는다 |
| 한 탭이 받은 키를 저장 | 다른 탭은 지금처럼 `onStorage`(키 항목)로 따라간다. `onSecretsChange`를 부르지 않으므로 다시 올리지 않는다 |

### 5.14 계정 전환·로그아웃
- 계정 전환: `engine.reset()`이 키 상태를 지운다(5.3). 서버 블롭은 그 계정 것이라 남는다. 로컬 키는 남는다.
- 로그아웃: 키 상태는 남긴다(같은 계정으로 다시 로그인하면 이어 간다). 마스터 키만 잊는다(이 탭과 채널로 다른 탭).

### 5.15 화면 (`KeySync.svelte`)

`SyncPanel.svelte`의 로그인됨 + `status.enabled` + `keySupport` 일 때, 동기화 줄 아래에 둔다.

```
키 동기화 (암호화)
[토글] 이 프로필의 키도 동기화        ← 지금 프로필 「<이름>」
  안내 한 줄: 고른 키를 동기화 암호로 잠가 올려요. 프록시 토큰은 올리지 않아요.
  (꺼진 이유가 있으면) 먼저 동기화가 끝나야 켤 수 있어요 / 이 기기에 올릴 키가 없어요
  ☑ KIS 키   ☐ 토스 키                 ← 켰을 때만. 규칙은 5.5 「공급자 고르기」
    (토스를 켜면) 토스 키는 키마다 토큰이 하나라 동시에 한 기기에서만 잘 돼요. …
알림(있으면): 키를 받을 수 있어요 [받기] …
동기화 암호: 이 탭에서 기억 중 [잊기]  /  기억하지 않음 [입력]
[동기화 암호 바꾸기]  [서버의 키 모두 지우기]   ← 금고가 있을 때만
다른 프로필: 「프로필 B」 받을 키가 있어요 — 그 프로필로 바꾸면 받을 수 있어요
```

- 토글 상태는 "서버에 이 프로필의 살아 있는 블롭이 있다"(`KeySyncState.active`)다. 다른 기기가 켠 것을 알기만 한 `revision 0` 행도 켜짐으로 보이고, 체크는 받은 뒤에 보인다.
- 옛 Worker(`keySupport = false`)면 `서버를 새로 배포해야 키 동기화를 쓸 수 있어요` 한 줄만.
- `SyncPanel.svelte` 로그인 전 안내를 바꾼다: `키·계좌·주문 내역·성과·프록시 주소·테마는 올리지 않아요.` → `계좌·주문 내역·성과·프록시 주소·테마는 올리지 않아요. 키는 「키도 동기화」를 켠 프로필만 동기화 암호로 잠가 올려요.` 나머지(「올린 데이터는 암호화하지 않은 채…」)는 프로필 문서 이야기라 그대로 둔다.
- 「동기화 암호」 시트의 입력은 `type="password"`, 정하기·바꾸기의 새 암호는 `autocomplete="new-password"`, 입력은 `current-password`. 키 잠금 암호 칸은 이름 `이 기기 잠금 암호`.
- KDF 중에는 단추 글이 `확인하는 중…`이고 시트를 닫을 수 없다(`KeyLock.svelte`의 `busy`와 같은 방식).

### 5.16 위험 안내 문구 초안 (켤 때 시트)

> **키를 서버에 올리기 전에 확인해 주세요**
> - KIS 앱 키는 계좌를 연결하면 주문 API도 부를 수 있어요. 토스 키도 주문 권한이 있어요.
> - 서버(Cloudflare)에는 동기화 암호로 잠근 암호문만 올라가요. 암호는 서버로 보내지 않아요. 그래도 서버 자료가 새어 나가면 암호를 하나씩 대입해 풀어 볼 수 있어요. 짧거나 다른 곳에서 쓰는 암호는 피해 주세요. 이 기기 잠금 암호와 같은 암호를 쓰면, 키를 담아 내보낸 파일이나 이 기기 저장소에서 잠금 암호를 알아낸 사람이 서버 키도 풀 수 있어요.
> - 동기화 암호를 잊으면 서버 사본은 아무도 되살릴 수 없어요. 그때는 서버의 키를 모두 지우고 새 암호로 다시 시작해요.
> - 받은 기기는 그 기기의 키 잠금 설정대로 키를 보관해요. 여기서 끄거나 지워도 이미 받은 기기의 키는 남아요.
>
> 올릴 키: ☑ KIS 키   ☐ 토스 키
> (토스를 켜면) 토스 키는 키마다 토큰이 하나라 동시에 한 기기에서만 잘 돼요. 다른 기기에서 쓰면 이 기기의 토큰이 끊길 수 있어요.
>
> ☐ 위 내용을 이해했어요   [취소] [계속]

- 기기 잠금 암호와 같은 암호는 막지 않는다(결정 11). 둘째 항목의 끝 문장은 그 위험만 알린다. 기기 잠금(310000회)이 동기화 암호(600000회)보다 대입이 쉽기 때문이다.
- 토스 문장은 `docs/providers.md`의 확인된 제약이고, 토스를 고를 때만 보인다(결정 9). KIS에 같은 제약이 있는지는 **확인 필요**라 문구에 넣지 않는다(11절 ㉛). 확인되면 KIS 체크에도 같은 경고를 단다.

## 6. 보안

| 위협 | 막는 것 |
|---|---|
| D1·백업 유출 | 암호문·salt·확인값만 있다. 오프라인 대입은 PBKDF2 600000회 + 12자 이상 + 서로 다른 글자 4개로 늦춘다. 약한 암호·기기 잠금 암호 재사용의 위험은 안내 문구로 알린다(결정 3·11) |
| 서버(또는 Worker 변조)가 블롭을 바꿔 끼움·되감음 | AAD에 `vaultId`·`profileId`·`revision`·`contentId`·`vaultRevision`(3.3). 서버는 행을 금고 전체 삭제 때만 없애고 끄기·tombstone·정리는 삭제 표시로 리비전을 잇는다(2.1). 기기는 꺼진 뒤에도 본 리비전을 잊지 않아, 본 것보다 옛 리비전의 살아 있는 행은 맞춘 상태가 아니면 받지 않고 알린다(5.4·5.7). 같은 리비전이라도 `contentId`가 다르면 맞춘 상태로 보지 않는다. `contentId`는 AAD에 있어 목록과 다른 내용을 끼울 수 없다 |
| 되감기 방어의 한계 | (1) D1을 이전 시점으로 복구한 뒤에는 높은 본 리비전을 가진 **꺼진** 기기가, 다른 기기가 정상으로 새로 켠 블롭(낮은 리비전)도 되감기로 보고 알리지 않는다. 그 기기는 토글을 켜면 된다(이 기기 키로 올라간다). 켜진 기기는 같은 경우 `rollback` 알림을 받고 두 단추로 고른다. (2) 삭제 표시와 같은 리비전의 살아 있는 행은 가리지 않는다(5.4, 내용은 사용자 자기 키). (3) 복구 뒤에는 기기마다 자기가 본 번호만 피하므로 다른 기기가 본 번호로 새 블롭이 올라갈 수 있다. 이것은 `syncedContentId`가 가려 「바뀌었어요」·되감기 알림으로 고르게 하고, 조용히 덮거나 놓치지 않는다(5.4). (4) 본 리비전은 한 금고 ID 안에서만 기억한다. 서버가 다른 `vaultId`의 금고를 한 번 보여 주면 기기는 상태를 비우므로(5.4), 그 뒤 원래 금고와 되돌린 행을 다시 보이면 막지 못한다. 이때도 기기는 `vault-gone` 알림을 띄우고 암호를 다시 묻는다. 은퇴한 금고 ID 목록은 두지 않는다(악의적인 서버만 할 수 있는 일이고, 상태가 커진다) |
| 지우고 다시 만든 금고에 옛 키로 씀 | 블롭 PUT·rekey의 서버 조건이 `vault_id`까지 본다(4.5·4.7) |
| 금고를 지우고 다시 만든 뒤 옛 암호문을 섞음 | 새 금고는 새 `vaultId`라 옛 암호문은 풀리지 않는다. 기기는 `vaultId`가 바뀌면 상태를 모두 버린다(5.4) |
| 서버가 KDF 회수를 바꾼 금고를 줌 | `iter !== 600000`이면 거절(2.2·3.1) |
| 서버가 다른 금고로 바꿔치기 | 확인값이 새 암호로만 맞으므로 기존 암호로는 실패한다. 받은 블롭도 풀리지 않는다 |
| 서버가 이상한 응답으로 기기를 흔듦 | 앱이 `listKeys`·409 본문·블롭 응답을 모양 검사한 뒤에만 쓴다(2.2) |
| 공유·프로필 문서로 새어 나감 | 금고·블롭은 별도 표·API. `FORBIDDEN_KEYS`가 와이어 이름을 막는다(2.4). 공유 API는 `key_` 표를 읽지 않는다. 7.6 테스트로 고정 |
| 로그·오류 응답 | `deps.log`는 메서드·패턴·상태·시간만. 오류 응답에 **블롭 암호문은 담지 않는다**. rekey 409의 `keyVault`·`keyBlobs`에는 salt·확인값·리비전이 있지만, 이는 `GET /v1/keys`가 같은 사용자에게 늘 주는 값이다 |
| 기기 저장소 | 암호·마스터 키·평문 블롭을 쓰지 않는다. 받은 키는 기기 키 잠금 설정대로(평문 또는 310000회 잠금) |
| 메모리의 마스터 키 | 추출 불가 `CryptoKey`. 잊는 시점 11가지(5.12), 다른 탭 로그아웃도 채널·저장값 비교로 따라간다 |
| 같은 출처 XSS | 키 동기화가 새로 막지는 못한다. XSS는 지금도 평문 키(잠금 해제 상태)를 읽을 수 있다. CSP는 그대로 둔다 |
| 기기 잠금 암호를 실수로 바꿈 | 받기는 `verifyPassphrase`로 먼저 확인한 뒤에만 `applySyncedSecrets`를 부른다(5.7) |
| 받기가 다른 기기의 토스 토큰을 끊음 | 값이 실제로 바뀐 공급자의 토큰만 버린다(5.2) |
| 붙여넣은 큰 문자열 | 자격 값 ASCII 256자, 봉한 뒤 2048자 상한(2.3) |
| Workers CPU | Worker는 암호 연산을 하지 않는다. 검사는 문자열 길이·정규식뿐이다 |

## 7. 테스트

### 7.1 암호화 (`src/lib/sync/keyCrypto.test.ts`)
- `deriveVaultKey` 결과의 `extractable`이 false이고 알고리즘이 AES-GCM 256. `subtle.deriveKey`에 넘긴 `iterations`가 600000(가짜로 감싸 확인). `iter` 599999·600001은 KDF 전에 거절.
- NFC: `'한'`과 `'한'.normalize('NFD')`가 같은 키를 만든다(같은 블롭이 풀린다). 확인 입력이 NFD여도 `mismatch`가 아니다.
- 확인값: 맞는 암호 true, 틀린 암호 false, 다른 `vaultId`·`vaultRevision`이면 false, 위조된 `ciphertext` false(예외 없이).
- AAD: 프로필 A로 봉한 것을 B 문맥, 다른 `vaultId`, 다른 `revision`, 다른 `vaultRevision`으로 풀면 `KeyOpenError('auth')`.
- 평문 모양: 공급자가 하나도 없는 `{v:1}`, 모르는 필드, 빈 문자열, 257자, 공백·한글이 든 값, `proxyToken`이 든 평문은 `KeyOpenError('shape')`. `sealKeys`도 공급자 없는 평문을 거절하고, 봉한 결과가 2048자를 넘으면 거절한다. `sealKeys`는 `proxyToken`을 받지 않는다(타입과 실행 모두).
- `openRaw`·`sealRaw`: 모르는 필드가 든 평문(새 버전 블롭)도 바이트 그대로 다시 봉해진다.
- 강도: 11자 `short`, 12자 통과, 129자 `long`, `aaaaaaaaaaaa`·`121212121212` `plain`, 확인 불일치 `mismatch`, 이모지 12개(서로게이트 쌍)는 12자로 센다.

### 7.2 와이어 검사 (`src/lib/sync/keyWire.test.ts`)
- 각 본문의 허용 필드 밖 → `unknown-field`, 빠진 필드·틀린 길이·base64 아님 → `invalid`(경로 포함). rekey 중복 프로필·51개 → `invalid`.
- 응답 검사: `iter` 1000·10억, `vaultId` 길이 틀림, `keyBlobs`가 배열이 아님, 리비전이 음수·`2^31` 이상·정수 아님인 응답은 `checkVaultHead`·`checkBlobRows`·`checkBlob`이 거절한다. 목록에서 행 하나만 틀리면 그 행만 빠지고 나머지 행은 쓴다. 금고 머리가 틀리면 전체가 거절된다.

### 7.3 앱 (`src/lib/state/app.test.ts`)
- `onSecretsChange`: KIS 키를 바꾸면 `providers: ['kis']`로 한 번, 두 키를 한 번에 바꾸면 둘 다, `proxyToken`만 바꾸면 안 부름, `KeyLock`의 잠그기(같은 키 + 암호)·`disableKeyLock`·`clearSecrets`·`importData`·`applySyncedSecrets`는 안 부름.
- `onLock`: 잠긴 프로필에서 `lock()` 때 한 번, 잠금이 아니면 안 부름.
- `applySyncedSecrets`: 평문 프로필에 쓰고 `proxyToken` 유지, **병합** — 받은 값에 `toss`가 없으면 로컬 토스 키는 그대로이고 그 토큰도 남음, KIS만 바뀌면 KIS 토큰만 지워지고 토스 토큰·주문 캐시는 남음, 토스가 바뀌면 토스 토큰과 주문 캐시가 지워짐, 받은 값이 로컬과 같으면 저장소 쓰기도 토큰 삭제도 없고 `[]`를 돌려줌, 잠금 프로필은 주어진 암호로 다시 봉해 같은 암호로 풀림, 다른 프로필 ID·잠겨서 풀리지 않음은 던짐, `tokenIssuedAt`은 남음, `setSecrets`의 토큰·주문 캐시 동작은 바뀌지 않음(회귀).
- `syncableSecrets`: 다른 탭이 저장소에 쓴 평문을 읽음, 잠금이면 메모리와 저장된 잠긴 키가 다를 때 null.

### 7.4 키 저장소·엔진 (`keyStore.test.ts`, `engine.test.ts`, 새 `keySync.test.ts`)
- `keyStore`: `bumpSeq`와 `markSynced`가 겹쳐도 `localSeq`를 잃지 않는다(fake-indexeddb에서 두 연결로). `activate`가 꺼진 행을 켜면 `revision 0`·dirty 없음이 되고 `seenRevision`은 그대로다. 꺼진 행에는 `bumpSeq`·`setProviders`가 아무것도 하지 않는다. `setProviders([])` 거절. `blocked`가 3초 넘으면 메모리 저장소. `gazua-sync`의 버전은 1 그대로다.
- `syncNow` 순서가 pull → keys → push. 키 단계가 `offline`이어도 push가 돈다. `keysNow`는 키 단계만. `reset`이 키 저장소를 비운다. 키 타이머는 `reset`·`destroy` 뒤 돌지 않는다.
- 판정표(5.4)의 행마다 하나씩: 가짜 API로 `listKeys` 응답을 만들어 `notice`·자동 올리기·잊기·`active`를 확인한다. 특히 `vaultId`가 바뀌면 상태가 비고, 삭제 표시 + dirty면 올리지 않고 `removed`, `offPending`이면 `removed` 없이 조용히 꺼지고, 목록에 프로필이 없으면 행이 그대로다. 되감기: 켜진 행에 살아 있는 `r < seenRevision`이 오고 맞춘 상태가 아니면 `rollback`이고 받기·올리기를 하지 않는다. 삭제 표시 `r < seenRevision`은 되감기가 아니고 `removed`다. 꺼진 행에 옛 리비전의 살아 있는 행이 오면 알림 없이 꺼진 채다. `rollback`에서 「서버 키 받기」 뒤 같은 `r`은 다시 되감기가 아니고, 「이 기기 키 올리기」와 켜기는 `newRevision = max(seenRevision, r) + 1`을 보내 성공한다(본 번호를 다시 쓰지 않는다). 켜기 409 충돌 행은 다음 단계에서도 `conflict`로 남는다. 로컬에 없는 프로필의 켜진 행은 꺼진다.
- `syncedContentId`: 리비전이 같고 내용 ID가 다르면 dirty 아님은 `newer`, dirty는 5.6-4 뒤 `conflict`이고 자동 올리기를 하지 않는다. 다른 기기의 rekey(같은 `vaultId`, 금고 리비전 상승) 뒤에도 내용 ID가 그대로라 `newer`가 뜨지 않는다.
- 걸러낸 목록 행: 모양이 틀린 행 하나는 그 프로필의 상태(`active` 포함)를 바꾸지 않고 `서버 응답이 맞지 않아요`만 보인다.
- 5.6-4 미루기: 마스터 키 없음·지금 프로필 아님·잠김(`syncableSecrets` null) 셋 모두 `conflict`로 떨어지지 않는다.
- 꺼진 프로필: 끈 뒤 이 기기에서 키를 고쳐도 dirty·타이머가 생기지 않고, 그 뒤 다른 기기가 켜면 `available`(「이 기기 키 올리기」·`newer`가 아니다).
- dirty 번호: 올리는 중(`putKeyBlob` 대기)에 `bumpSeq`가 오면 끝난 뒤에도 dirty, 다음 단계에서 다시 올린다. 받는 중에 `bumpSeq`가 와도 받은 뒤 dirty.
- 응답 유실: 첫 `putKeyBlob`의 응답을 잃으면 다음 키 단계가 PUT 없이 「`revision < r` + dirty」에서 서버 블롭을 풀어 같은 평문이라 `conflict` 없이 맞춘다(`revision = r`, dirty 해제). 다른 평문이면 `conflict`. 마스터 키가 없으면 「올릴 키 변경이 있어요」. 켜기·「이 기기 키 올리기」의 응답 유실도 같다.
- `offPending`: 끄기 실패 뒤 서버 행이 살아 있으면 dirty·`revision < r` 행에서도 풀린다.
- Worker: `newRevision` `2^31 − 1`은 422, `2^31 − 2`인 행을 끄면 `2^31 − 1`로 CHECK 안이다.
- 자동 올리기는 이 금고의 마스터 키가 있을 때만, 지금 프로필일 때만.
- 공급자 선택: 고르지 않은 공급자(토스)만 바뀌면 `bumpSeq`가 dirty를 만들지 않음, `setProviders`가 dirty를 만들고 올린 평문에 고른 공급자만 있음, 고른 공급자 값이 이 기기에 없으면 올리지 않고 `missing-key`.
- 409 `conflict`·`vault-changed`·`no-vault`, 410의 처리.
- 세션 비교: 저장된 `SESSION_KEY`가 메모리와 다르면 키 단계가 아무 요청 없이 마스터 키를 잊고 멈춘다. 채널 `forget`을 받으면 잊는다.
- 끄기 실패: `deleteKeyBlob`이 오프라인이면 `active` 그대로 오류 문구. 응답만 잃은 경우(서버 반영) 다음 단계가 조용히 끈다.
- rekey: 한 블롭이 풀리지 않으면 서버 호출 없음, 첫 409 뒤 다시 받아 성공, 두 번 409면 오류 문구, 응답 유실 뒤 머리의 salt가 새 salt면 성공.

### 7.5 Worker (`sync-worker/src/keys.test.ts`, `profiles.test.ts`, `purge.test.ts`, `test/d1.test.ts`)
- `d1.test.ts`: 표 목록에 `key_blobs`·`key_guard`·`key_vault`가 더해짐, `key_guard`에 0을 넣는 batch가 앞 문장까지 되돌림.
- 라우팅: `PUT /v1/keys/vault`가 금고로 가고, `GET /v1/keys/vault`·`PUT /v1/keys/rekey`는 404, 로그 패턴이 `/v1/keys/:id`. 두 DELETE는 본문 없이 200(400 `bad-json`이 아님).
- 금고: 만들기 200, 같은 요청 다시 200, 다른 `vaultId` 409 `vault-exists`(머리 포함), `iter` 310000 422.
- 다시 만든 금고: 금고를 지우고 새로 만든 뒤(새 금고도 `vault_revision` 1) 옛 `vaultId`로 보낸 블롭 PUT과 옛 `expectedVaultId`로 보낸 rekey가 모두 409 `vault-changed`이고 새 금고·블롭이 하나도 바뀌지 않음.
- `newRevision`: `≤ expectedRevision`·`2^31 − 1` 이상은 422. 되감긴 행(지금 3)에 `expectedRevision 3, newRevision 6`은 받아 리비전 6이 된다. 목록 행에 `contentId`가 있고 nonce·암호문은 없으며, 삭제 표시 행은 `contentId: null`. rekey 뒤 `content_id`가 그대로다.
- 블롭: 프로필 없음 404, tombstone 410(`deletedAt`·`purgeAt`), 금고 없음 409 `no-vault`, 금고 리비전 다름 409 `vault-changed`, 리비전 다름 409 `conflict`(`revision`·`deleted` 포함), 같은 본문 다시 보내기 200 같은 리비전, 살아 있는 블롭 51번째 422 `key-limit`(삭제 표시 행은 세지 않음), 2049자 422, 8 KiB 넘는 본문 413.
- 끄기: 암호문이 NULL이 되고 리비전 + 1, 다시 켜면 그다음 리비전(1로 돌아가지 않음), 다시 보내기 200 `deleted: false`.
- 목록: 삭제된 프로필의 행은 목록에 없고, 끈 행은 `deleted: true`, 응답에 `ciphertext` 문자열이 없다.
- rekey: 성공하면 모든 살아 있는 블롭 `vault_revision`이 새 값이고 `revision`은 그대로, `vault_id` 그대로. 경합 넷(그사이 블롭 고침, 요청에 하나 빠짐, 그사이 새 블롭 켜짐, 리비전은 같고 `content_id`가 다름)마다 409이고 **금고·블롭이 하나도 바뀌지 않음**(SELECT로 확인). 삭제된 프로필에 암호문이 남은 고아 행이 있어도 rekey가 성공하고 그 행은 삭제 표시가 됨. `key_guard`에 행이 없음. 같은 요청 다시 200. 블롭 50개 rekey가 통과한다.
- 전체 삭제: 금고·블롭이 모두 지워지고 다시 보내도 200. 다른 사용자 것은 남는다.
- 사용자 경계: 다른 계정 세션으로 GET·PUT·DELETE 해도 내 블롭이 보이거나 바뀌지 않는다.
- `profiles.test.ts`: tombstone이 블롭을 삭제 표시로 바꿈, 409로 끝난 삭제는 바꾸지 않음, 복원해도 살아 있는 블롭 없음(고아 행이 있었어도). `purge.test.ts`: 정리 batch가 암호문이 남은 키 행을 삭제 표시로 바꾸고 행은 남김(`profile_index` 삭제 앞에 있어야 통과하는 테스트). 정리된 프로필을 같은 ID로 다시 올려 키를 켜면 리비전이 이어진다(1로 돌아가지 않는다).
- 로그: 모든 키 요청 뒤 `h.logs` 어느 줄에도 요청 `ciphertext`·`salt`·`nonce`·`vaultId`·`contentId` 문자열이 없다.

### 7.6 새지 않음 고정 (금지 검사)
- `forbidden.test.ts`: 새 여덟 이름이 `FORBIDDEN_KEYS`에 있다. `checkProfileDoc`에 `watchlists.groups[0].keyVault`, `strategies[0].nonce` 같은 깊은 자리에 넣으면 `forbidden-field`와 그 경로. `checkShareSnapshot` 여섯 종류마다 깊은 자리에 `ciphertext`·`verifier`를 넣으면 `forbidden-field`.
- 겹침: 정상 고정 데이터(프로필 문서 하나, 여섯 공유 종류 `testFixtures.ts`)의 모든 키 경로(`checkResult.test.ts`의 `allKeys`를 공용으로 옮긴다)가 `FORBIDDEN_KEYS`와 겹치지 않는다. 지금 sim·validation만 보는 테스트를 여섯 종류 + 프로필 문서로 넓힌다.
- 왕복(`src/lib/sync/keys.roundtrip.test.ts`, `testServer`·`deviceApi`): 기기 A가 지어낸 KIS 키로 키 동기화를 켠 뒤
  - 그 프로필로 여섯 종류 공유 스냅샷을 만들어 `POST /v1/shares` → 요청 본문, `GET /v1/public/share` 응답, `GET /v1/shares` 응답 JSON에 평문 키 값, 올린 `ciphertext`·`nonce`·salt·`vaultId`·`contentId` 문자열이 없다.
  - `GET /v1/profiles/:id`, `GET /v1/profiles/:id/revisions/:rev` 응답에도 없다.
  - `stashImport`(`pendingImport.ts`)로 sessionStorage에 넣은 값에도 없다.
  - 가짜 D1에서 `shares`·`profiles`·`revisions` 표의 모든 행을 문자열로 이어 붙여도 없다.
- 공유 API가 키 표를 읽지 않음: `sync-worker/src/shares.ts` 원문에 `key_vault`·`key_blobs`가 나오지 않는다(파일을 읽어 확인하는 테스트). 공유 읽기 SQL이 바뀌면 깨진다.

### 7.7 두 기기 왕복 (`keys.roundtrip.test.ts`)
- A 켬 → B 키 단계 `available` → B 받기 → B의 `app.secrets.kis`가 A와 같음, B의 `proxyToken`은 B 것 그대로.
- A가 키를 고침(기억 중) → 자동으로 올라감 → B `newer` → 받기.
- A·B 둘 다 고침 → 늦은 쪽 `conflict` → 「이 기기 키 올리기」와 「서버 키 받기」 각각.
- 기본 선택(KIS만)으로 켬 → B가 받아도 B의 토스 키·토스 토큰은 그대로. A가 토스를 더 고름 → B `newer` → 받으면 토스도 바뀜. A가 토스를 다시 뺌 → B `newer` → 받아도 B의 토스 키는 남고 "더 이상 동기화하지 않아요" 스낵바.
- A 끔 → B `removed`, B 키 남음. B가 그사이 dirty였어도 올라가지 않는다. A가 다시 켜면 리비전이 이어지고 B `available`.
- A 끄기 직전의 블롭 리비전을 서버가 다시 내줘도(가짜 D1에서 행을 옛 값으로 되돌림) 받지 않는다(`rollback`). 세 경우를 모두 본다: B가 `removed` 알림을 아직 닫지 않음, B가 알림을 닫은 뒤, 끈 기기 A 자신.
- D1 되감기(가짜 D1의 키 행 전체를 이전 시점으로 되돌림): 켜진 기기는 `rollback` 알림을 받고, 「서버 키 받기」 또는 「이 기기 키 올리기」 어느 쪽으로도 빠져나온다. 끄고 다시 켜도 된다.
- 복구 뒤 번호 겹침: D1을 리비전 3으로 되돌린 뒤 본 리비전 3인 C가 리비전 4로 올림 → 복구 전 리비전 4(다른 내용)를 맞춰 둔 D는 내용 ID가 달라 `newer`(D가 dirty면 `conflict`)를 받고, C의 키를 조용히 덮거나 놓치지 않는다. 그 뒤 누군가 암호를 바꿔도(rekey) D는 여전히 `newer`(dirty면 `conflict`)다. 복구 뒤 A가 끄면(삭제 표시 리비전이 B의 본 리비전보다 작음) B는 `rollback`이 아니라 `removed`를 받는다.
- 정리(purge)된 프로필을 같은 ID로 다시 올리고 키를 켜면 리비전이 이어지고, 정리 전 리비전 1 암호문을 서버가 내줘도 받지 않는다.
- A가 프로필 삭제 → 서버 암호문 없음 → B pull이 프로필을 지우고 키 상태 행은 `active: false`로 남음.
- A 전체 삭제 → B `vault-gone`, 마스터 키 잊음. A가 새 암호로 다시 켬 → B는 상태를 비우고 새 금고로 `available`.
- A 암호 바꿈 → B `vault-changed`, 옛 키 잊음, `newer`는 뜨지 않음, B가 새 암호로 받으면 같은 키.
- B 키 잠금 켬 상태에서 받기: 잠금 암호를 물어 다시 봉하고, 다시 열면 같은 잠금 암호로 풀림.
- 계정 전환(B에서 다른 계정 로그인) → 키 상태 비고 마스터 키 잊음.

### 7.8 컴포넌트 (`KeySync.test.ts`, `SyncPanel.test.ts`, `Profiles.test.ts`)
- 동기화 꺼짐·로그아웃·`keySupport` false면 토글이 없다(옛 Worker 문구).
- 토글이 꺼진 이유 두 가지 문구와 `disabled`. `revision 0` 행이면 토글이 켜짐으로 보이고 「받기」.
- 위험 안내: 체크 전 「계속」 꺼짐, 네 항목이 보이고 둘째 항목에 기기 잠금 암호 문장이 있음.
- 공급자 체크: 기본 KIS 켬·토스 끔, KIS 키가 없는 기기는 둘 다 끈 채라 「계속」 꺼짐, 키 없는 공급자 체크는 `disabled`와 `이 기기에 키가 없어요`, 토스를 켜면 토큰 경고(`role="status"`), 하나만 켜져 있으면 그 체크가 `disabled`이고 토글 안내 문구.
- 암호 정하기: 3.4 문구 네 가지가 `role="alert"`로 나오고 해당 칸에 `aria-invalid`·`aria-describedby`. 암호 입력: 틀리면 문구, KDF 중 `확인하는 중…`이고 닫기 막힘.
- 받기: 키 잠금이면 잠금 암호 칸이 함께 보임, 틀리면 문구. 로컬에 다른 값이 있으면 덮어쓰기 확인.
- 끄기 실패면 토글이 켜진 채 오류 문구.
- 충돌 두 단추와 확인, 「잊기」, 다른 프로필 알림 목록, 「서버의 키 모두 지우기」 확인.
- `SyncPanel` 로그인 전 안내 문구가 바뀐 문장. `Profiles` 삭제 확인에 서버 키 문장(켜진 프로필만).
- 위 화면마다 axe 위반 0(`src/lib/share/testAxe.ts` 방식).

### 7.9 e2e
- e2e 빌드에는 동기화 설정이 없다(공유 확장 1.5-10 결정과 같다). 그래서 설정 화면에 키 동기화 영역이 **없고** 키 잠금 영역이 지금과 같은지만 `tests/e2e/a11y.spec.ts`의 설정 화면 검사로 본다. 토글·공급자 체크·암호 입력 화면은 7.8 컴포넌트 테스트와 axe로 덮는다(결정 13). 두 번째 빌드는 만들지 않는다. 기존 `pnpm e2e`는 모두 통과해야 한다(키 동기화가 기존 화면의 문구·배치를 바꾸는 곳은 `SyncPanel` 로그인 전 안내뿐이고, e2e 빌드에서는 그 문단도 그려지지 않는다).

## 8. 오류 처리

| 상황 | 처리 |
|---|---|
| 옛 Worker(`listKeys` 404) | 키 영역에 `서버를 새로 배포해야 키 동기화를 쓸 수 있어요`. 프로필 동기화는 그대로. 다음 키 단계에서 200이면 다시 보인다 |
| 서버 응답 모양이 틀림 | 금고 머리면 `서버 응답이 맞지 않아요. 앱을 새로 고쳐 주세요`로 키 단계를 멈추고 아무것도 쓰지 않는다. 블롭 행 하나면 그 행만 건너뛴다 |
| 오프라인·서버 오류·한도 | 키 영역에 `서버에 연결할 수 없어요. 연결되면 다시 확인해요` 등 지금 `describeFail` 문구. 프로필 동기화를 막지 않는다 |
| 동기화 암호 틀림 | `동기화 암호가 맞지 않아요`. 횟수 제한은 두지 않는다(기기 안 KDF라 서버가 셀 수 없고, 시간이 막는다) |
| 이 기기 잠금 암호 틀림 | `이 기기 잠금 암호가 맞지 않아요`. 아무것도 쓰지 않는다 |
| 블롭이 풀리지 않음(`auth`) | 먼저 머리를 다시 읽는다. 메모리 키가 낡았으면(`vaultId`·`salt`·`vaultRevision` 다름) 키를 잊고 `동기화 암호가 바뀌었어요. 새 암호를 입력해 주세요`로 암호 입력 시트를 연다. 머리가 같은데도 풀리지 않을 때만 `서버의 키를 풀 수 없어요. 서버 자료가 손상됐을 수 있어요`와 「서버 키 지우기(이 프로필)」를 보인다. 어느 쪽이든 쓰지 않는다 |
| 블롭 평문 모양이 다름(`shape`) | `서버의 키 형식이 맞지 않아요. 앱을 새로 고쳐 주세요` |
| 서버 블롭이 되감김(살아 있는 행의 리비전이 본 것보다 작고 맞춘 상태가 아님) | 쓰지 않고 `notice 'rollback'`: `서버 키가 예전 것으로 돌아갔어요(서버 복구 등). 받지 않았어요` [이 기기 키 올리기] [서버 키 받기](5.8) |
| 받는 사이 이 기기 키가 바뀜(`SecretsChangedError`) | `그사이 이 기기 키가 바뀌었어요. 다시 받아 주세요`. 쓰지 않았다. 상태 행은 그대로 |
| 고른 공급자의 키가 이 기기에 없음 | `notice 'missing-key'`: `KIS 키가 이 기기에 없어 올리지 못했어요. 키를 넣거나 선택을 바꿔 주세요`(토스면 토스). dirty로 둔다 |
| 받은 뒤 선택이 줄었음 | `토스 키는 더 이상 동기화하지 않아요. 이 기기의 토스 키는 그대로예요`(KIS면 KIS) |
| 올릴 키가 상한 넘음 | `키 값이 맞지 않아요(영문·숫자·기호 256자까지). 연결 설정에서 다시 붙여 넣어 주세요`. 올리지 않는다 |
| 켜기 404(프로필이 서버에 없음) | `먼저 동기화가 끝나야 켤 수 있어요` |
| 410(프로필 삭제됨) | 상태 행을 `active: false`로 두고 조용히 넘어간다 |
| 409 `vault-exists` | 암호 입력 시트로 바꾸고 `다른 기기에서 먼저 암호를 정했어요. 그 암호를 입력해 주세요` |
| 409 `vault-changed` | `다른 기기에서 동기화 암호를 바꿨어요. 새 암호를 입력해 주세요`. 마스터 키를 잊는다 |
| 409 `no-vault` | `서버의 키가 모두 지워졌어요(다른 기기). 이 기기의 키는 그대로예요` |
| 409 `conflict`(블롭) | "서버 것이 이 기기 키와 같은가"(5.6-4)를 먼저 보고, 아니면 판정표의 `conflict`·`newer`·`removed` 알림 |
| 끄기 실패 | 상태 행·토글을 그대로 두고 `서버에서 키를 지우지 못했어요. 연결을 확인하고 다시 꺼 주세요` |
| 전체 삭제 실패 | 아무것도 지우지 않고 같은 꼴의 문구 |
| rekey 두 번 409 | `다른 기기에서 키를 바꾸는 중이에요. 잠시 뒤 다시 해 주세요` |
| 422 `key-limit` | `서버에 키를 올린 프로필이 50개라 더 켤 수 없어요` |
| 422 기타·413 | `서버가 이 데이터를 받지 않았어요.` |
| 받은 키 저장 실패 `KeyLockNotSavedError` | `keyLockFailureText`(`KeyLock.svelte`) 문구를 그대로 쓴다. 상태 행의 `revision`은 올리지 않는다(다시 받을 수 있게) |
| 받은 키 저장 실패 `KeyLockedElsewhereError` | `다른 탭에서 키를 잠갔어요. 잠금 암호로 다시 받아 주세요`. 쓰지 않았다 |
| 받은 키 저장 실패 `StoredKeysNotRemovedError` | `KEYS_NOT_REMOVED`(`KeyLock.svelte`) 문구. 쓰지 않았다 |
| 지금 프로필이 아닌 알림 | 받기 단추 대신 `그 프로필로 바꾸면 받을 수 있어요` |
| 잠긴 프로필이 아직 풀리지 않음 | 관문(`unlock`)이 먼저라 설정에 오지 못한다. 자동 올리기는 `syncableSecrets` null로 미룬다 |
| 키 저장소 IndexedDB 없음(`persistent = false`) | 키 상태도 메모리. 지금 `volatile` 경고 문구에 `키 변경 알림도`를 더한다 |

## 9. 접근성
- 토글은 `@sch0718/ui-svelte` `Toggle`, `label="이 프로필의 키도 동기화"`. 꺼진 이유는 토글 옆 글로 보이고 `aria-describedby`로 잇는다.
- 시트는 기존 `Sheet`(포커스 가둠, Esc 닫기). 열리면 첫 입력(`data-autofocus`)으로, 닫히면 연 단추로 돌아간다. KDF 중에는 Esc·바깥 누르기로 닫히지 않는다.
- 암호 칸은 모두 `<label for>`. 오류는 `role="alert"` 문단 하나에 두고 해당 칸에 `aria-invalid`·`aria-describedby`(`KeyLock.svelte`의 `invalid()` 방식).
- 위험 안내의 체크 상자는 `<label>`로 감싼다. 안내는 목록(`<ul>`)이다.
- 공급자 체크 둘은 `<fieldset>`·`<legend>올릴 키</legend>`로 묶는다. 고를 수 없는 이유(`이 기기에 키가 없어요`, `그만 올리려면 위 토글을 꺼 주세요`)는 체크의 `aria-describedby`로 잇는다. 토스 경고는 `role="status"`라 켤 때 읽힌다.
- 알림 줄(`available`·`newer`·`conflict`·`removed`·`missing-key`·`rollback`, 계정 알림)은 `role="status"`. 단추는 글자 단추이고 `--touch` 높이 이상.
- `확인하는 중…`·`올리는 중…` 상태 글은 `aria-live="polite"`.
- 색만으로 상태를 알리지 않는다(경고 색 + 글).

## 10. 사용자 결정 (2026-10-31 추가)
초안의 다섯 질문에 사용자가 답했고, 1.3의 9~13번으로 옮겼다.

| 질문 | 답 | 반영한 곳 |
|---|---|---|
| 토스 키도 동기화 대상으로 둘까 | 공급자별로 고른다. KIS 기본 켬, 토스 기본 끔, 토스를 켤 때 토큰 경고(결정 9). 선택은 블롭 평문의 공급자 집합, 받는 쪽은 병합, 둘 다 끄기는 막음, 선택을 바꾸면 새 블롭 | 1.4, 2.2, 2.5, 5.2, 5.5 「공급자 고르기」, 5.6, 5.7, 5.15, 5.16, 7, 8, 9 |
| 강도 규칙에 "서로 다른 글자 4개 이상"을 더할까 | 12자 + 서로 다른 글자 4개 + 128자 상한 + NFC로 확정(결정 10) | 3.4 |
| 기기 잠금 암호와 같은 동기화 암호를 막을까 | 막지 않는다(결정 11). 위험은 안내 한 줄로 알린다 | 3.4, 5.16 |
| 「이 기기에서 키 삭제」가 서버 키를 그대로 둘까 | 그대로 둔다(결정 12) | 1.4, 5.2 |
| e2e를 동기화 설정 빌드로 따로 돌릴까 | 두 번째 빌드 없이 컴포넌트 테스트 + axe. 기존 `pnpm e2e`는 통과(결정 13) | 7.9 |

남은 질문은 없다.

## 11. 실연결 점검

`docs/live-check.md`에 ㉛을 더한다(문서 수정은 구현 계획에서). 초안:

```markdown
## ㉛ 키 동기화: 같은 KIS 키를 두 기기에서 쓸 때의 토큰

- **무엇을**: 키 동기화(docs/superpowers/specs/2026-10-31-key-sync-design.md)로 같은 KIS 앱 키가 두 기기에 들어간 뒤를 실제 계정으로 봐요.
  - 기기 A가 토큰을 받은 뒤 기기 B가 같은 키로 토큰을 받으면, A의 앞 토큰이 무효가 되는지(토스처럼 키마다 하나인지) 아니면 둘 다 유효한지. **지금은 모른다. 추측으로 단정하지 않는다.**
  - 무효가 된다면 A에서 어떤 오류 코드·문구로 오는지, 앱이 1분 간격 재발급(`tokenIssuedAt`)과 배너로 견디는지.
  - 같은 키의 발급 한도(1분에 1회 등)가 기기마다인지 키마다인지.
  - 두 기기에서 번갈아 시세를 받아도 「다른 기기나 탭에서 같은 키로 토큰을 받고 있어요」류 배너가 계속 뜨지 않는지.
- **함께 볼 것**: 휴대폰(안드로이드 Chrome·아이폰 Safari)에서 동기화 암호 입력(PBKDF2 600000회)이 몇 초 걸리는지, 확인하는 중 표시가 나오는지. 운영 D1 `key_blobs`에 평문이 없고 끈 행은 암호문이 비었는지, Cloudflare 로그에 본문이 남지 않는지. 받은 기기에서 키 잠금을 켠 상태로 받기가 되는지. KIS만 받은 기기에서 토스 토큰이 다시 발급되지 않는지. 블롭 여러 개로 암호 바꾸기를 했을 때 Worker CPU 시간.
- **어떻게**: 운영 Worker에 0003을 적용하고 배포한 뒤, 두 기기에서 같은 계정으로 로그인해 한 기기에서 키 동기화를 켜고 다른 기기에서 받아요. 두 기기에서 번갈아 연결 진단과 비교 화면을 열어요. D1을 이전 시점으로 복구할 일이 생기면, 복구 뒤 켜진 기기에 「서버 키가 예전 것으로 돌아갔어요」가 뜨고 두 단추로 빠져나오는지 봐요. 키·토큰·동기화 암호는 여기에 적지 않아요.
- **바꿀 곳**: 앞 토큰이 무효가 되면 설계 5.16 위험 안내와 KIS 체크에 토스와 같은 경고를 더하고(`KeySync.svelte`), `docs/providers.md`의 토스 문단 옆에 KIS도 적어요. 토큰 재발급 처리는 `src/lib/providers/`의 KIS 토큰 경로.
- 결과: 앞 토큰 __ / 오류 코드 __ / 발급 한도 단위 __ / 배너 __ / 휴대폰 KDF 시간 __ / D1·로그 __ / 토스 토큰 유지 __ / rekey CPU __
```

## 12. 배포 순서

1. **원격 D1에 `0003_key_vault` 적용**(`corepack pnpm --filter sync-worker migrate:remote`). 미적용 파일만 적용된다. 표를 더하기만 하므로 지금 Worker·앱은 영향이 없다.
2. **Worker 배포.** 이 Worker의 `deleteProfile`·`restoreProfile`·`purge` batch가 `key_blobs`를 쓰므로, **0003 없이 배포하면 프로필 삭제·복구가 `no such table`로 500이 된다.** 반드시 1 다음이다.
3. **앱 배포.** 앱이 `/v1/keys`를 부르기 시작한다.

호환:

| 조합 | 동작 |
|---|---|
| 새 Worker + 옛 앱 | 옛 앱은 키 API를 부르지 않는다. 다른 기기의 새 앱이 켠 프로필을 옛 앱이 지우면 tombstone이 암호문도 지운다. 문제 없음 |
| 옛 Worker + 새 앱 | `listKeys`가 404 → `keySupport = false`, 키 영역에 배포 안내만. 프로필 동기화는 그대로 |
| 새 앱, 서비스 워커가 옛 번들을 띄움 | 옛 앱과 같다. 새로 고침 뒤 새 번들(㉙ 배포 기록과 같다). 키 상태는 새 DB `gazua-sync-keys`라 옛 탭이 `gazua-sync`를 쥐고 있어도 막히지 않는다 |
| Worker만 되돌림 | 표는 남고 옛 Worker는 읽지 않는다. 되돌린 동안 지운 프로필의 블롭은 암호문이 남은 고아가 된다(목록·상한·rekey 감시는 살아 있는 프로필만 보므로 보이지 않고 세지 않는다). 다시 배포한 뒤 첫 rekey가 고아를 삭제 표시로 바꾸고, 그 프로필을 복구하면 `restoreProfile`이, 30일 뒤에는 `purge`가 정리한다. 바로 지우려면 고아 행의 `content_id`·`nonce`·`ciphertext`를 NULL로 바꾸는 SQL 한 번을 운영자가 돌린다 |
| D1을 이전 시점으로 복구(Time Travel 등) | 키 행이 되감긴다. 켜진 기기는 「서버 키가 예전 것으로 돌아갔어요」 알림에서 「이 기기 키 올리기」·「서버 키 받기」를 고르거나 끄고 다시 켠다. 올리는 기기는 자기가 본 번호보다 큰 리비전을 쓰고, 다른 기기가 본 번호와 겹치면 `syncedContentId`가 가려 알린다(5.4·5.8). 다른 기기가 끈 것은 `removed`로 알린다. 꺼진 기기는 알림 없이 꺼진 채다(6절 한계) |

- 운영 배포는 이 작업에서 하지 않는다. PR 본문에 위 순서를 적는다.
- 함께 고칠 문서(구현 계획에서): `sync-worker/README.md`(API 표·0003 적용 순서), `README.md` 59행의 "키…는 올리지 않고", `src/lib/help/content.ts`의 키 안내, `docs/live-check.md` ㉛.
