-- 개인 동기화·읽기 공유 1단계 스키마(docs/superpowers/plans/2026-10-25-sync-phase1.md).
-- 시각은 모두 서버 epoch ms다. 기기 시계로 덮어쓰지 않는다.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  firebase_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

-- 세션 원문은 기기에만 있다. 여기에는 SHA-256 hex만 둔다.
CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  label TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX sessions_user ON sessions(user_id);

-- 프로필 색인. revision은 1부터, deleted_at이 있으면 tombstone이다.
CREATE TABLE profile_index (
  user_id TEXT NOT NULL REFERENCES users(id),
  profile_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  last_op_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  purge_at INTEGER,
  PRIMARY KEY (user_id, profile_id)
);
CREATE INDEX profile_index_purge ON profile_index(purge_at) WHERE purge_at IS NOT NULL;

-- 현재 본문.
CREATE TABLE profiles (
  user_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  body TEXT NOT NULL,
  size INTEGER NOT NULL,
  PRIMARY KEY (user_id, profile_id)
);

-- 현재 리비전과 과거 10개. 삭제 리비전은 body가 NULL이다. op_id로 재시도를 알아본다.
CREATE TABLE revisions (
  user_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  op_id TEXT NOT NULL,
  body TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, profile_id, revision),
  UNIQUE (user_id, op_id)
);

-- 읽기 전용 공유. capability 원문은 저장하지 않고 SHA-256 hex만 둔다.
CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  source_profile_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX shares_user ON shares(user_id);
CREATE INDEX shares_expires ON shares(expires_at);
