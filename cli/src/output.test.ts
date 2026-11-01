import { describe, expect, it } from 'vitest';
import { createRedactor, fail, HIDDEN, ok, render, SECRET_KEYS } from './output';

describe('비밀값 거르기', () => {
  it('SECRET_KEYS 이름의 키는 값을 숨긴다(대소문자 무시, 중첩·배열 안까지)', () => {
    const r = createRedactor();
    const out = r.apply({
      ok: true,
      data: { appKey: 'a', AppSecret: 'b', clientId: 'c', clientSecret: 'd', accessToken: 'e', refreshToken: 'f', token: 'g', proxyToken: 'h', accountSeq: 7, deviceCode: 'i', secrets: { x: 1 }, list: [{ TOKEN: 'z', keep: 1 }], tokenId: '3f2c', symbol: '005930' },
    });
    expect(out.data).toEqual({
      appKey: HIDDEN, AppSecret: HIDDEN, clientId: HIDDEN, clientSecret: HIDDEN, accessToken: HIDDEN, refreshToken: HIDDEN, token: HIDDEN, proxyToken: HIDDEN, accountSeq: HIDDEN, deviceCode: HIDDEN, secrets: HIDDEN,
      list: [{ TOKEN: HIDDEN, keep: 1 }], tokenId: '3f2c', symbol: '005930',
    });
    expect([...SECRET_KEYS].sort()).toEqual(['accesstoken', 'accountseq', 'appkey', 'appsecret', 'clientid', 'clientsecret', 'devicecode', 'proxytoken', 'refreshtoken', 'secrets', 'token']);
  });

  it('등록한 비밀값이 문자열 안에 있으면 그 부분만 바꾼다(긴 값 먼저, 6자 미만은 제외)', () => {
    const r = createRedactor();
    r.add('KEY-1234567890');
    r.add('KEY-12');
    r.add('abc');
    r.add(undefined);
    expect(r.apply({ message: 'bad KEY-1234567890 and KEY-12 and abc', arr: ['x KEY-12'] })).toEqual({
      message: `bad ${HIDDEN} and ${HIDDEN} and abc`,
      arr: [`x ${HIDDEN}`],
    });
  });

  it('원본을 바꾸지 않는다', () => {
    const src = { token: 'secret-token-1' };
    createRedactor().apply(src);
    expect(src.token).toBe('secret-token-1');
  });
});

describe('결과 모양', () => {
  it('ok·fail·warnings', () => {
    expect(ok({ a: 1 })).toEqual({ ok: true, data: { a: 1 } });
    expect(ok({ a: 1 }, ['경고'])).toEqual({ ok: true, data: { a: 1 }, warnings: ['경고'] });
    expect(fail('profile-required', '메시지', { profiles: [] })).toEqual({ ok: false, error: { code: 'profile-required', message: '메시지' }, data: { profiles: [] } });
    expect(fail('internal', '메시지')).toEqual({ ok: false, error: { code: 'internal', message: '메시지' } });
  });

  it('render는 JSON 한 줄 + 줄바꿈, --pretty면 들여쓴다. 오류 메시지도 거른다', () => {
    const r = createRedactor();
    r.add('SUPERSECRET-VALUE');
    const line = render(fail('upstream', '키 SUPERSECRET-VALUE 로 실패'), r, false);
    expect(line.endsWith('\n')).toBe(true);
    expect(line.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(line)).toEqual({ ok: false, error: { code: 'upstream', message: `키 ${HIDDEN} 로 실패` } });
    expect(render(ok({ a: 1 }), r, true).split('\n').length).toBeGreaterThan(3);
  });
});
