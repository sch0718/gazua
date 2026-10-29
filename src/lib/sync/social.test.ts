import { describe, expect, it } from 'vitest';
import { callbackPath, isInAppBrowser, PROVIDER_NAMES, SOCIAL_RETURN_TTL, type SocialOutcome } from './social';
import { socialFailureText } from './socialText';

describe('소셜 로그인 안내', () => {
  it('배포 경로 아래에 콜백 주소를 만든다', () => {
    expect(callbackPath('/')).toBe('/auth/callback/');
    expect(callbackPath('/gazua/')).toBe('/gazua/auth/callback/');
    expect(SOCIAL_RETURN_TTL).toBe(600_000);
    expect(PROVIDER_NAMES).toEqual({ google: 'Google', kakao: '카카오', naver: '네이버' });
  });
  it.each(['KAKAOTALK 12', 'kakaotalk', 'Mozilla NAVER(inapp; search)'])('인앱 브라우저를 알아본다: %s', (ua) => {
    expect(isInAppBrowser(ua)).toBe(true);
  });
  it.each(['Chrome/130', 'NAVER', 'Safari'])('일반 브라우저와 구분한다: %s', (ua) => {
    expect(isInAppBrowser(ua)).toBe(false);
  });
  it.each([
    ['cancelled', '로그인을 취소했어요', '다시 하려면 아래 단추를 눌러 주세요.'],
    ['mismatch', '로그인 요청을 확인하지 못했어요', '다른 탭이나 창에서'],
    ['expired', '로그인 시간이 지났어요', '10분'],
    ['provider-error', '카카오가 로그인을 마치지 못했어요', 'Redirect URI·OpenID Connect'],
    ['no-pending', '이 브라우저에서 시작한 로그인이 아니에요', '다른 브라우저로 돌아오면'],
    ['not-configured', '이 빌드에는 카카오 로그인이 설정되지 않았어요', '동기화 서버 주소'],
    ['not-allowed', '이 카카오 계정은 아직 허용 목록에 없어요', 'ALLOWED_ACCOUNTS'],
    ['limit', '카카오 서버에 잠시 연결할 수 없어요', '잠시 뒤 다시 시도해 주세요.'],
    ['offline', '동기화 서버에 연결할 수 없어요', '인터넷 연결'],
    ['invalid-code', '로그인 코드가 만료됐거나 이미 쓰였어요', '다시 로그인해 주세요.'],
    ['invalid-token', '카카오 로그인 응답을 확인하지 못했어요', 'OpenID Connect'],
    ['not-enabled', '동기화 서버에 카카오 로그인이 켜져 있지 않아요', '클라이언트 ID와 시크릿'],
    ['bad-request', '동기화 서버가 로그인 요청을 받지 않았어요', 'SOCIAL_REDIRECT_URIS'],
    ['storage', '이 브라우저에서는 로그인을 시작할 수 없어요', '사생활 보호 모드'],
    ['server', '서버 오류예요', '잠시 뒤 다시 시도해 주세요.'],
  ] as const)('실패 이유를 안내한다: %s', (reason, title, detail) => {
    const text = socialFailureText({ ok: false, provider: 'kakao', reason });
    expect(text.title).toBe(title);
    expect(text.detail).toContain(detail);
  });
  it('공급자 이름과 공급자 오류 코드를 표시한다', () => {
    expect(socialFailureText({ ok: false, provider: 'naver', reason: 'provider-error', error: 'invalid_request' }).detail).toContain('(invalid_request)');
    const o: SocialOutcome = { ok: true, provider: 'naver' };
    expect(o.ok).toBe(true);
  });
  it.each(['provider-error', 'not-configured', 'not-allowed', 'limit', 'invalid-token', 'not-enabled'] as const)('공급자를 모르면 카카오·네이버로 안내한다: %s', (reason) => {
    const text = socialFailureText({ ok: false, provider: null, reason });
    expect(text.title).toContain('카카오·네이버');
    expect(text.title + text.detail).not.toContain('공급자');
  });
});
