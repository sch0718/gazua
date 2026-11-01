import { describe, expect, it } from 'vitest';
import { chooseProvider, readCreds } from './env';

describe('readCreds', () => {
  it('환경변수 이름 네 개를 읽는다(앞뒤 공백은 뗀다). 한쪽만 있으면 그 공급자는 없는 것', () => {
    expect(readCreds({ KIS_APP_KEY: ' k ', KIS_APP_SECRET: 's', TOSS_CLIENT_ID: 'id', TOSS_CLIENT_SECRET: 'sec' })).toEqual({
      kis: { appKey: 'k', appSecret: 's' },
      toss: { clientId: 'id', clientSecret: 'sec' },
    });
    expect(readCreds({ KIS_APP_KEY: 'k' })).toEqual({});
    expect(readCreds({ TOSS_CLIENT_ID: 'id', TOSS_CLIENT_SECRET: '  ' })).toEqual({});
  });
});

describe('chooseProvider', () => {
  const both = readCreds({ KIS_APP_KEY: 'k', KIS_APP_SECRET: 's', TOSS_CLIENT_ID: 'id', TOSS_CLIENT_SECRET: 'sec' });
  const kisOnly = readCreds({ KIS_APP_KEY: 'k', KIS_APP_SECRET: 's' });

  it('--provider가 없으면 키가 있는 쪽, 둘 다면 toss', () => {
    expect(chooseProvider(both)).toBe('toss');
    expect(chooseProvider(kisOnly)).toBe('kis');
  });

  it('--provider를 주면 그 키가 있어야 한다(no-credentials)', () => {
    expect(chooseProvider(both, 'kis')).toBe('kis');
    expect(() => chooseProvider(kisOnly, 'toss')).toThrow(expect.objectContaining({ code: 'no-credentials' }));
    expect(() => chooseProvider({})).toThrow(expect.objectContaining({ code: 'no-credentials' }));
  });
});
