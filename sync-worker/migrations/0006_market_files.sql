-- sync-worker/migrations/0006_market_files.sql
-- 시장 파일 Drive 전달(설계 2026-11-02-market-drive). 파일 본문은 Drive appDataFolder에만 있고 여기에는 manifest만 둔다.
ALTER TABLE cli_grants ADD COLUMN scope TEXT NOT NULL DEFAULT 'read'; -- 'read' | 'market-upload'

CREATE TABLE market_files (
  id TEXT PRIMARY KEY,                        -- uuid
  user_id TEXT NOT NULL REFERENCES users(id),
  drive_file_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sha256 TEXT NOT NULL,                       -- gzip 바이트의 SHA-256 hex
  size INTEGER NOT NULL,                      -- gzip 바이트
  format_version INTEGER NOT NULL,
  collected_at TEXT NOT NULL,                 -- 파일의 collectedAt(ISO)
  range_from TEXT NOT NULL,                   -- YYYY-MM-DD
  range_to TEXT NOT NULL,
  stocks INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, sha256)
);
CREATE INDEX market_files_user ON market_files(user_id, collected_at);
