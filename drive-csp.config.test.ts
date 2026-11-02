import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { driveCsp, driveCspPlugin } from './drive-csp.config';
import { kakaoCsp } from './kakao-csp.config';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const directive = (doc: string, name: string) => new RegExp(`${name} ([^;"]*)`).exec(doc)?.[1].trim().split(/\s+/) ?? null;

describe('CSP and Google Identity Services', () => {
  it('클라이언트 ID가 없으면 그대로', () => {
    expect(driveCsp(html, false)).toBe(html);
  });
  it('있으면 script-src에 GIS 스크립트 하나만 더하고 다른 지시어는 그대로', () => {
    const out = driveCsp(html, true);
    expect(directive(out, 'script-src')).toEqual(["'self'", 'https://accounts.google.com/gsi/client']);
    expect(directive(out, 'frame-src')).toBeNull();
    expect(directive(out, 'connect-src')).toEqual(["'self'", 'https:']);
  });
  it('카카오와 함께 쓴다', () => {
    expect(directive(driveCsp(kakaoCsp(html, true), true), 'script-src')).toEqual(["'self'", 'https://accounts.google.com/gsi/client', 'https://t1.kakaocdn.net']);
  });
  it('빌드 변수 VITE_GOOGLE_DRIVE_CLIENT_ID를 읽는다', () => {
    const plugin = driveCspPlugin();
    (plugin.configResolved as (c: unknown) => void)({ env: { VITE_GOOGLE_DRIVE_CLIENT_ID: 'cid' } });
    expect(directive((plugin.transformIndexHtml as (h: string) => string)(html), 'script-src')).toContain('https://accounts.google.com/gsi/client');
  });
});
