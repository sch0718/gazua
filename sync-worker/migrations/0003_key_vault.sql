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
