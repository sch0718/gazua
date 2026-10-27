import { readFileSync } from 'node:fs';
import { applyFirebaseCsp } from '@sch0718/firebase-session/vite';
import { describe, expect, it } from 'vitest';
import { kakaoCsp, kakaoCspPlugin } from './kakao-csp.config';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const connectSrc = (doc: string) => /connect-src ([^;"]*)/.exec(doc)?.[1].trim().split(/\s+/) ?? [];
const directive = (doc: string, name: string) => new RegExp(`${name} ([^;"]*)`).exec(doc)?.[1].trim().split(/\s+/) ?? null;

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
    const out = kakaoCsp(applyFirebaseCsp(html, 'gazua-test.firebaseapp.com'), true);
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
