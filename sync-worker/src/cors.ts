// 가즈아 sync-worker의 CORS 값. 출처 검사와 preflight 응답은 @sch0718/firebase-session/worker가 한다.
// CORS는 브라우저 보호일 뿐 인증을 대신하지 않는다(모든 개인 API는 토큰·세션을 따로 검사).

export const ALLOWED_METHODS = 'GET, POST, PUT, DELETE';
export const ALLOWED_HEADERS = 'Authorization, Content-Type, X-Gazua-Session, X-Share-Token';
