import { describe, expect, it } from 'vitest';
import { readSocialConfig } from '@sch0718/firebase-session/client';
import { readSyncConfig } from './config';

const GOOGLE = {
  VITE_SYNC_API_URL: ' https://sync.example.test/// ',
  VITE_FIREBASE_API_KEY: 'key',
  VITE_FIREBASE_AUTH_DOMAIN: 'app.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'app',
  VITE_FIREBASE_APP_ID: 'id',
};

describe('동기화 설정', () => {
  it.each([
    {},
    { VITE_KAKAO_LOGIN_CLIENT_ID: ' ', VITE_NAVER_LOGIN_CLIENT_ID: '\t\n' },
    { VITE_KAKAO_LOGIN_CLIENT_ID: ' kakao ' },
    { VITE_NAVER_LOGIN_CLIENT_ID: ' naver ' },
    { VITE_KAKAO_LOGIN_CLIENT_ID: '\tkakao\n', VITE_NAVER_LOGIN_CLIENT_ID: ' naver ' },
    { VITE_KAKAO_LOGIN_CLIENT_ID: true, VITE_NAVER_LOGIN_CLIENT_ID: false },
    { VITE_KAKAO_LOGIN_CLIENT_ID: undefined, VITE_NAVER_LOGIN_CLIENT_ID: ' naver ' },
  ])('소셜 설정을 패키지와 같은 규칙으로 읽는다: %j', (env) => {
    expect(readSyncConfig({ ...GOOGLE, ...env })?.social).toEqual(readSocialConfig(env));
  });

  it('Google 설정에 소셜 설정을 함께 읽는다', () => {
    expect(readSyncConfig({ ...GOOGLE, VITE_KAKAO_LOGIN_CLIENT_ID: ' kakao ' })).toMatchObject({
      apiUrl: 'https://sync.example.test', firebase: { apiKey: 'key' }, social: { kakao: { clientId: 'kakao' } },
    });
    expect(readSyncConfig(GOOGLE)?.social).toBeNull();
  });

  it('서버와 소셜 키만 있어도 Firebase 없이 켠다', () => {
    expect(readSyncConfig({ VITE_SYNC_API_URL: GOOGLE.VITE_SYNC_API_URL, VITE_NAVER_LOGIN_CLIENT_ID: ' naver ' })).toEqual({
      apiUrl: 'https://sync.example.test', firebase: null, social: { naver: { clientId: 'naver' } },
    });
  });

  it.each(['http://localhost:8788', 'http://127.0.0.1:8788', 'http://[::1]:8788'])('개발 서버에서만 로컬 HTTP를 허용한다: %s', (url) => {
    const env = { VITE_SYNC_API_URL: url, VITE_KAKAO_LOGIN_CLIENT_ID: 'key' };
    expect(readSyncConfig({ ...env, DEV: true })?.apiUrl).toBe(url);
    expect(readSyncConfig({ ...env, DEV: 'true' })).toBeNull();
    expect(readSyncConfig(env)).toBeNull();
  });

  it.each(['', '주소 아님', 'http://remote.test', 'ftp://localhost'])('올바른 서버 주소가 없으면 끈다: %s', (url) => {
    expect(readSyncConfig({ DEV: true, VITE_SYNC_API_URL: url, VITE_KAKAO_LOGIN_CLIENT_ID: 'key' })).toBeNull();
  });

  it('로그인 설정이 없으면 끈다', () => {
    expect(readSyncConfig({ VITE_SYNC_API_URL: 'https://sync.test', VITE_KAKAO_LOGIN_CLIENT_ID: ' ' })).toBeNull();
  });
});
