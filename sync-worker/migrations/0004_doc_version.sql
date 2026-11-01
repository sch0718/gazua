-- 전략 빌더 PR①: 저장된 프로필 문서의 버전(v). 지금 행은 모두 v1 문서라 기본값 1이 맞다.
-- Worker가 본문을 파싱하지 않고 옛 앱(버전 1)에 v2 문서를 주지 않거나, v2 위에 v1이 올라오는 것을 막는 데 쓴다.
ALTER TABLE profile_index ADD COLUMN doc_v INTEGER NOT NULL DEFAULT 1;
