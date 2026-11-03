-- 초대 링크 가입(설계 2026-11-03-invite-signup). 관리자(ALLOWED_EMAILS·ALLOWED_ACCOUNTS)는 이 표에 없다.
CREATE TABLE members (
  identity TEXT PRIMARY KEY,   -- 소문자 이메일(Google) 또는 'kakao:<sub>'·'naver:<sub>'
  joined_at INTEGER NOT NULL,
  removed_at INTEGER            -- 내보낸 시각. NULL이면 멤버. 내보낸 사람은 코드로 다시 가입하지 못한다
);
-- 초대 코드 시도 기록(계정당 1시간 5회). 코드 원문은 두지 않는다. 가입하면 그 계정 것을 지우고, cron이 하루 지난 것을 지운다.
CREATE TABLE invite_attempts (identity TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX invite_attempts_identity ON invite_attempts(identity, at);
CREATE INDEX invite_attempts_at ON invite_attempts(at);
