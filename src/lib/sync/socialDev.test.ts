import { describe, expect, it } from 'vitest';
import { devAuthorizeUrl } from './socialDev';

describe('개발용 인가 주소', () => {
  it.each([
    ['https://kauth.kakao.com/oauth/authorize', 'kakao'],
    ['https://nid.naver.com/oauth2/authorize', 'naver'],
  ])('공급자의 쿼리를 그대로 옮긴다: %s', (url, provider) => {
    expect(devAuthorizeUrl(url + '?state=a%2Bb&code_challenge=abc', 'http://localhost:8788')).toBe(`http://localhost:8788/__dev/social/${provider}/authorize?state=a%2Bb&code_challenge=abc`);
  });
  it('카카오 재인증 요청도 가짜 인가 화면으로 옮긴다', () => {
    const url = new URL(devAuthorizeUrl('https://kauth.kakao.com/oauth/authorize?state=a%2Bb&prompt=login', 'http://localhost:8788'));
    expect(url.pathname).toBe('/__dev/social/kakao/authorize');
    expect(url.searchParams.get('prompt')).toBe('login');
    expect(url.searchParams.get('state')).toBe('a+b');
  });
  it.each(['https://other.test/oauth/authorize', 'https://kauth.kakao.com/other', 'http://kauth.kakao.com/oauth/authorize'])('다른 주소는 거절한다: %s', (url) => {
    expect(() => devAuthorizeUrl(url, 'http://localhost:8788')).toThrow();
  });
});
