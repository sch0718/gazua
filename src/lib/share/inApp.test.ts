import { describe, expect, it } from 'vitest';
import { isIos, isKakaoInApp, openExternalHref } from './inApp';

const ANDROID_KAKAO = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 KAKAOTALK 10.8.0';
const IOS_KAKAO = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 KAKAOTALK 10.8.0';

describe('인앱 판정', () => {
  it('UA에 KAKAOTALK이 있으면 인앱, iPhone·iPad면 iOS', () => {
    expect(isKakaoInApp(ANDROID_KAKAO)).toBe(true);
    expect(isKakaoInApp('Mozilla/5.0 Chrome/120')).toBe(false);
    expect(isIos(IOS_KAKAO)).toBe(true);
    expect(isIos(ANDROID_KAKAO)).toBe(false);
  });
  it('기본 브라우저로 여는 주소', () => {
    expect(openExternalHref('https://a.test/#/s/abc')).toBe('kakaotalk://web/openExternal?url=https%3A%2F%2Fa.test%2F%23%2Fs%2Fabc');
  });
});
