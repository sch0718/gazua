import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
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
    expect(FORBIDDEN).toEqual(['import.meta.env', 'window.', 'navigator.locks']);
    for (const s of FORBIDDEN) expect(text, s).not.toContain(s);
    if (process.platform !== 'win32') expect(statSync(out).mode & 0o111).not.toBe(0);
  });

  it('실행하면 JSON 한 줄을 내고 종료 코드를 지킨다', { timeout: 60_000 }, async () => {
    const r = spawnSync(process.execPath, [await build(), 'bogus'], { encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, error: { code: 'invalid-args' } });
  });
});
