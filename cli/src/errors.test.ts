import { describe, expect, it } from 'vitest';
import { ApiError, type ErrorCode } from '../../src/lib/providers/errors';
import { CliError, exitCodeOf, fromApiError, MESSAGES, toCliError } from './errors';

describe('공급자 오류 → CLI 오류 코드', () => {
  it.each<[ErrorCode, string]>([
    ['proxy-unreachable', 'network'],
    ['offline', 'network'],
    ['ip-not-allowed', 'ip-not-allowed'],
    ['invalid-credentials', 'invalid-credentials'],
    ['token-throttled', 'token-throttled'],
    ['token-contended', 'token-contended'],
    ['upstream', 'upstream'],
    ['timeout', 'timeout'],
    ['rate-limited', 'rate-limited'],
    ['path-blocked', 'path-blocked'],
    ['token-expired', 'upstream'],
    ['proxy-redirect', 'upstream'],
    ['cors-blocked', 'upstream'],
  ])('%s → %s', (api, want) => expect(fromApiError(new ApiError(api)).code).toBe(want));

  it('toCliError는 CliError를 그대로 두고, 모르는 오류는 internal(원문 메시지를 내보내지 않는다)', () => {
    const e = new CliError('profile-not-found');
    expect(toCliError(e)).toBe(e);
    const x = toCliError(new Error('내부 비밀 KEY-123'));
    expect(x.code).toBe('internal');
    expect(x.message).toBe(MESSAGES.internal);
    expect(toCliError(new ApiError('timeout')).code).toBe('timeout');
  });

  it('메시지는 코드마다 있고 기본 메시지를 쓴다. 종료 코드는 invalid-args만 2', () => {
    for (const [code, message] of Object.entries(MESSAGES)) {
      expect(message.length).toBeGreaterThan(3);
      expect(new CliError(code as keyof typeof MESSAGES).message).toBe(message);
    }
    expect(exitCodeOf('invalid-args')).toBe(2);
    expect(exitCodeOf('network')).toBe(1);
    expect(new CliError('profile-required', undefined, { profiles: [] }).data).toEqual({ profiles: [] });
  });
});
