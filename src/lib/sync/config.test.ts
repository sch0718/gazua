import { describe, expect, it } from 'vitest';
import { readSyncConfig } from './config';

const FULL = {
  VITE_SYNC_API_URL: 'https://gazua-sync.example.workers.dev/',
  VITE_FIREBASE_API_KEY: 'fake-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'gazua-test.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'gazua-test',
  VITE_FIREBASE_APP_ID: '1:0:web:fake',
  DEV: false,
};

describe('readSyncConfig', () => {
  it('모두 있으면 설정을 돌려주고 주소 끝 슬래시를 지운다', () => {
    expect(readSyncConfig(FULL)).toEqual({
      apiUrl: 'https://gazua-sync.example.workers.dev',
      firebase: { apiKey: 'fake-api-key', authDomain: 'gazua-test.firebaseapp.com', projectId: 'gazua-test', appId: '1:0:web:fake' },
    });
  });

  it.each(Object.keys(FULL).filter((k) => k !== 'DEV'))('%s가 비면 동기화를 끈다', (k) => {
    expect(readSyncConfig({ ...FULL, [k]: '' })).toBeNull();
    expect(readSyncConfig({ ...FULL, [k]: undefined })).toBeNull();
  });

  it('http 주소는 개발 서버의 localhost에서만 받는다', () => {
    expect(readSyncConfig({ ...FULL, VITE_SYNC_API_URL: 'http://localhost:8788' })).toBeNull();
    expect(readSyncConfig({ ...FULL, VITE_SYNC_API_URL: 'http://localhost:8788', DEV: true })?.apiUrl).toBe('http://localhost:8788');
    expect(readSyncConfig({ ...FULL, VITE_SYNC_API_URL: 'http://evil.example.test', DEV: true })).toBeNull();
  });

  it('CSP에 넣을 인증 도메인 모양이 틀리면 끈다', () => {
    expect(readSyncConfig({ ...FULL, VITE_FIREBASE_AUTH_DOMAIN: 'x.com; script-src *' })).toBeNull();
  });
});
