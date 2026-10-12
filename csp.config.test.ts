import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEV_LOCAL_PROXY_SOURCES, devCsp, devCspPlugin } from './csp.config';

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
