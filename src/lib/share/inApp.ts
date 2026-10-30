// 카카오톡 인앱 브라우저 안내(사용자 결정 8, 설계 4.7). 인앱에서도 가져오기는 막지 않는다.
export const isKakaoInApp = (ua: string): boolean => /KAKAOTALK/i.test(ua);
export const isIos = (ua: string): boolean => /iPhone|iPad/.test(ua);
/** 카카오 공식 문서에는 없고 개발자 포럼·여러 서비스가 쓰는 관용 스킴이다. 동작은 docs/live-check.md에서 확인한다 */
export const openExternalHref = (href: string): string => `kakaotalk://web/openExternal?url=${encodeURIComponent(href)}`;
