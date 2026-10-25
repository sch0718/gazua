import { describe, expect, it } from 'vitest';
import { AUTH_HELPER_FILES, authHelperPlugin, fetchAuthHelper, selfHostsAuthHelper } from './auth-helper.config';

const HANDLER = '<script src="handler.js"></script><script>fireauth.oauthhelper.widget.initialize();</script>';
const IFRAME = '<script src="iframe.js"></script><script>fireauth.iframe.AuthRelay.initialize();</script>';

function fakeFetch(overrides: Record<string, { status?: number; body?: string }> = {}) {
  const calls: string[] = [];
  const fn = async (url: string) => {
    calls.push(url);
    const name = url.split('/').pop()!;
    const o = overrides[name] ?? {};
    const body = o.body ?? (name === 'handler' ? HANDLER : name === 'iframe' ? IFRAME : `/* ${name} */`);
    return new Response(body, { status: o.status ?? 200 });
  };
  return { fn, calls };
}

describe('selfHostsAuthHelper', () => {
  it('Firebase-hosted auth domains keep using Firebase helpers', () => {
    expect(selfHostsAuthHelper('gazua-test.firebaseapp.com')).toBe(false);
    expect(selfHostsAuthHelper('gazua-test.web.app')).toBe(false);
    expect(selfHostsAuthHelper(undefined)).toBe(false);
    expect(selfHostsAuthHelper('')).toBe(false);
  });

  // 앱 도메인을 authDomain으로 쓰면 리다이렉트·팝업이 같은 출처 저장소를 써서 서드파티 저장소 차단(Safari 등)을 피한다.
  it('an app-owned auth domain means the build serves the helpers itself', () => {
    expect(selfHostsAuthHelper('gazua.sch0718.dev')).toBe(true);
  });
});

describe('fetchAuthHelper', () => {
  it('downloads the five helper files from the project firebaseapp.com and maps them to /__/auth/', async () => {
    const { fn, calls } = fakeFetch();
    const files = await fetchAuthHelper('gazua-test', fn);
    expect(calls).toEqual(AUTH_HELPER_FILES.map((f) => `https://gazua-test.firebaseapp.com/__/auth/${f.src}`));
    expect(files.map((f) => f.fileName)).toEqual([
      '__/auth/handler.html',
      '__/auth/handler.js',
      '__/auth/experiments.js',
      '__/auth/iframe.html',
      '__/auth/iframe.js',
    ]);
    expect(files[0].source).toBe(HANDLER);
  });

  it('fails the build when a helper file cannot be downloaded', async () => {
    const { fn } = fakeFetch({ 'handler.js': { status: 404 } });
    await expect(fetchAuthHelper('gazua-test', fn)).rejects.toThrow(/handler\.js/);
  });

  it('fails the build when the helper pages no longer look like Firebase helpers', async () => {
    const { fn } = fakeFetch({ handler: { body: '<html>Site Not Found</html>' } });
    await expect(fetchAuthHelper('gazua-test', fn)).rejects.toThrow(/handler/);
  });

  it('rejects project ids that are not plain Firebase ids', async () => {
    const { fn } = fakeFetch();
    await expect(fetchAuthHelper('evil.com/x', fn)).rejects.toThrow();
  });
});

describe('authHelperPlugin', () => {
  it('runs only for builds', () => {
    expect(authHelperPlugin().apply).toBe('build');
  });
});
