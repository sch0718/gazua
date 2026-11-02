import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bundle, FORBIDDEN } from '../build.mjs';
import { cleanupDirs, tempDir } from './testing';

afterEach(cleanupDirs);
/** 테스트마다 따로 임시 출력 경로에 빌드한다(병렬 실행되는 다른 테스트와 dist/gazua.mjs를 덮어쓰지 않게) */
const build = (env: Record<string, string | undefined> = {}) => bundle(join(tempDir(), 'gazua.mjs'), env);

describe('번들', () => {
  it('빌드되고 브라우저 전용 문자열이 없다', { timeout: 60_000 }, async () => {
    const out = await build();
    const text = readFileSync(out, 'utf8');
    expect(text.startsWith('#!/usr/bin/env node')).toBe(true);
    expect(text).toMatch(/from ["']node:sqlite["']/);
    expect(FORBIDDEN).toEqual(['import.meta.env', 'window.', 'navigator.locks']);
    for (const s of FORBIDDEN) expect(text, s).not.toContain(s);
    if (process.platform !== 'win32') expect(statSync(out).mode & 0o111).not.toBe(0);
  });

  it('실행하면 JSON 한 줄을 내고 종료 코드를 지킨다', { timeout: 60_000 }, async () => {
    const r = spawnSync(process.execPath, [await build(), 'bogus'], { encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, error: { code: 'invalid-args' } });
  });

  it('번들로 시세를 조회하면 SQLite 잠금 아래 토큰을 발급한다', { timeout: 60_000 }, async () => {
    const dir = tempDir();
    const preload = `globalThis.fetch = async (input) => {
      const body = new URL(String(input)).pathname === '/oauth2/token'
        ? { access_token: 'bundle-test-token', expires_in: 86400 }
        : { result: [{ symbol: '005930', lastPrice: '72000', timestamp: '2026-11-02T09:00:00+09:00' }] };
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    };`;
    const r = spawnSync(process.execPath, [
      '--import', `data:text/javascript,${encodeURIComponent(preload)}`, await build(), 'quote', '005930', '--provider', 'toss',
    ], {
      encoding: 'utf8', timeout: 5000,
      env: { ...process.env, XDG_CONFIG_HOME: dir, TOSS_CLIENT_ID: 'bundle-test-id', TOSS_CLIENT_SECRET: 'bundle-test-secret' },
    });
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: true });
    const db = join(dir, 'gazua', 'toss.lock.db');
    expect(existsSync(db)).toBe(true);
    if (process.platform !== 'win32') expect(statSync(db).mode & 0o777).toBe(0o600);
  });

  it('mcp로 띄우면 initialize → tools/list → tools/call 왕복을 하고 표준 출력은 JSON-RPC만', { timeout: 60_000 }, async () => {
    const dir = tempDir();
    const preload = `globalThis.fetch = async (input) => {
      const body = new URL(String(input)).pathname === '/oauth2/token'
        ? { access_token: 'bundle-test-token', expires_in: 86400 }
        : { result: [{ symbol: '005930', lastPrice: '72000', timestamp: '2026-11-02T09:00:00+09:00' }] };
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    };`;
    const input = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'quote', arguments: { symbols: ['005930'], provider: 'toss' } } },
    ].map((m) => JSON.stringify(m)).join('\n') + '\n';
    const r = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, await build(), 'mcp'], {
      encoding: 'utf8', timeout: 10_000, input,
      env: { ...process.env, XDG_CONFIG_HOME: dir, TOSS_CLIENT_ID: 'bundle-test-id', TOSS_CLIENT_SECRET: 'bundle-test-secret' },
    });
    expect(r.status, r.stderr).toBe(0);
    const replies = r.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    expect(replies.every((m) => m.jsonrpc === '2.0')).toBe(true);
    expect(replies.map((m) => m.id)).toEqual([1, 2, 3]);
    expect(replies[0].result.serverInfo.name).toBe('gazua');
    expect(replies[1].result.tools).toHaveLength(7);
    expect(replies[2].result.isError).toBe(false);
    expect(JSON.parse(replies[2].result.content[0].text)).toMatchObject({ ok: true, data: { provider: 'toss', quotes: [{ symbol: '005930', price: 72000 }] } });
    expect(r.stdout + r.stderr).not.toContain('bundle-test-secret');
  });
});
