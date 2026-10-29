// 개발 서버에서만 지연 로드한다.
export function devAuthorizeUrl(url: string, apiUrl: string): string {
  const u = new URL(url);
  const path = u.origin + u.pathname;
  const provider = path === 'https://kauth.kakao.com/oauth/authorize' ? 'kakao' : path === 'https://nid.naver.com/oauth2/authorize' ? 'naver' : null;
  if (!provider) throw new Error('소셜 인가 주소가 아니에요');
  return `${apiUrl}/__dev/social/${provider}/authorize${u.search}`;
}
