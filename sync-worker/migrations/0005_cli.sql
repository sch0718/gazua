-- 읽기 전용 CLI(설계 2026-11-01-readonly-cli). 기기 코드 승인 대기와 CLI 토큰. 원문 코드·토큰은 저장하지 않는다(SHA-256 hex만).
CREATE TABLE cli_grants (
  id TEXT PRIMARY KEY,                -- uuid
  device_hash TEXT NOT NULL UNIQUE,   -- 기기 코드의 SHA-256 hex
  user_code TEXT NOT NULL UNIQUE,     -- 사람이 치는 코드(정규화한 8자, 하이픈 없음)
  label TEXT NOT NULL,                -- CLI가 보낸 이름(예: 'gazua@macbook'), 64자
  ip_hash TEXT NOT NULL,              -- 요청 IP의 HMAC-SHA256 hex(시크릿 CLI_IP_SALT, IPv6는 /64로 줄인 뒤). 횟수 제한용, 원 IP는 두지 않음
  status TEXT NOT NULL,               -- 'pending' | 'approved' | 'denied' | 'consumed'
  user_id TEXT REFERENCES users(id),  -- 승인한 사용자
  interval_ms INTEGER NOT NULL,       -- 폴링 간격(slow_down이면 늘린다)
  last_polled_at INTEGER,
  consumed_token_hash TEXT,           -- 폴링이 토큰을 만들 때 그 토큰의 해시(한 번만 주기)
  geo TEXT,                           -- 요청 위치 '국가 · 도시'(request.cf, 승인 화면용). 없으면 NULL
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL         -- created_at + 10분
);
CREATE INDEX cli_grants_expires ON cli_grants(expires_at);
CREATE INDEX cli_grants_ip ON cli_grants(ip_hash, created_at);

CREATE TABLE cli_tokens (
  id TEXT PRIMARY KEY,                -- uuid(목록·철회에 쓰는 공개 ID)
  token_hash TEXT NOT NULL UNIQUE,    -- 토큰의 SHA-256 hex
  user_id TEXT NOT NULL REFERENCES users(id),
  label TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'read', -- 지금은 'read'만
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,        -- created_at + 90일(고정, 쓰는 동안 늘지 않음)
  revoked_at INTEGER
);
CREATE INDEX cli_tokens_user ON cli_tokens(user_id);
