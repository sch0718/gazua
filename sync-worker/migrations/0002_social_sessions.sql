-- @sch0718/firebase-session 0.2.0 migrations/firebase-session-0002_social_sessions.sql에서 복사한 파일이다. 직접 고치지 않는다. 새 패키지 마이그레이션은 새 번호 파일로 더한다.
-- 카카오·네이버 로그인 세션. identity는 그 세션을 만든 공급자 계정('kakao:<sub>' 등), Google 세션은 NULL.
-- NULL이 아닌 세션만 Firebase ID 토큰 없이(세션만으로) 인증할 수 있다.
ALTER TABLE sessions ADD COLUMN identity TEXT;
