import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEV_LOCAL_PROXY_SOURCES, devCsp, devCspPlugin, firebaseCsp, firebaseCspPlugin, kakaoCsp, kakaoCspPlugin } from './csp.config';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const connectSrc = (doc: string) => /connect-src ([^;"]*)/.exec(doc)?.[1].trim().split(/\s+/) ?? [];

describe('CSP and local http proxies', () => {
  it('the built page only connects to itself and https (no plain http)', () => {
    expect(connectSrc(html)).toEqual(["'self'", 'https:']);
  });

  it('the dev server additionally allows http://localhost / 127.0.0.1 / [::1] proxies', () => {
    expect(connectSrc(devCsp(html))).toEqual(["'self'", 'https:', ...DEV_LOCAL_PROXY_SOURCES]);
  });

  it('the relaxation applies to the dev server only, never to builds', () => {
    expect(devCspPlugin.apply).toBe('serve');
  });

  it('fails loudly if index.html no longer has the expected connect-src', () => {
    expect(() => devCsp('<meta content="default-src \'self\'">')).toThrow();
  });
});

const directive = (doc: string, name: string) => new RegExp(`${name} ([^;"]*)`).exec(doc)?.[1].trim().split(/\s+/) ?? null;

describe('CSP and Firebase Auth (sync)', () => {
  it('without sync config the page CSP is byte-for-byte unchanged', () => {
    expect(firebaseCsp(html, undefined)).toBe(html);
    expect(firebaseCsp(html, '')).toBe(html);
  });

  it('with an auth domain it allows only gapi scripts and that auth frame; connect-src stays the same', () => {
    const out = firebaseCsp(html, 'gazua-test.firebaseapp.com');
    expect(directive(out, 'script-src')).toEqual(["'self'", 'https://apis.google.com']);
    expect(directive(out, 'frame-src')).toEqual(['https://gazua-test.firebaseapp.com']);
    expect(connectSrc(out)).toEqual(["'self'", 'https:']);
    expect(directive(out, 'default-src')).toEqual(["'self'"]);
  });

  it('rejects an auth domain that could inject CSP tokens', () => {
    expect(() => firebaseCsp(html, "x.com; script-src *")).toThrow();
    expect(() => firebaseCsp(html, 'https://x.firebaseapp.com')).toThrow();
  });

  it('applies to builds and the dev server', () => {
    expect(firebaseCspPlugin().apply).toBeUndefined();
  });
});

describe('CSP and Kakao share SDK', () => {
  it('without a Kakao key the page CSP is byte-for-byte unchanged', () => {
    expect(kakaoCsp(html, false)).toBe(html);
  });

  it('with a key it allows only the Kakao SDK script host; nothing else changes', () => {
    const out = kakaoCsp(html, true);
    expect(directive(out, 'script-src')).toEqual(["'self'", 'https://t1.kakaocdn.net']);
    expect(directive(out, 'frame-src')).toBeNull();
    expect(connectSrc(out)).toEqual(["'self'", 'https:']);
    expect(directive(out, 'default-src')).toEqual(["'self'"]);
  });

  it('combines with the Firebase sources', () => {
    const out = kakaoCsp(firebaseCsp(html, 'gazua-test.firebaseapp.com'), true);
    expect(directive(out, 'script-src')).toEqual(["'self'", 'https://t1.kakaocdn.net', 'https://apis.google.com']);
  });

  it('reads the key from the build env (VITE_KAKAO_JS_KEY) and applies to builds and the dev server', () => {
    const plugin = kakaoCspPlugin();
    expect(plugin.apply).toBeUndefined();
    const run = (env: Record<string, unknown>) => {
      (plugin.configResolved as (c: unknown) => void)({ env });
      return (plugin.transformIndexHtml as (h: string) => string)(html);
    };
    expect(run({})).toBe(html);
    expect(run({ VITE_KAKAO_JS_KEY: '  ' })).toBe(html);
    expect(directive(run({ VITE_KAKAO_JS_KEY: 'k' }), 'script-src')).toEqual(["'self'", 'https://t1.kakaocdn.net']);
  });
});
