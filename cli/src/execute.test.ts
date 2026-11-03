import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parseArgv } from './args';
import { CliError } from './errors';
import { COMMANDS, execute, registerEnvSecrets, SECRET_ENV } from './execute';
import { createRedactor } from './output';
import { cleanupDirs, makeIo } from './testing';

afterEach(cleanupDirs);

describe('execute', () => {
  it('명령 결과를 Result로 돌려주고 표준 출력에는 쓰지 않는다', async () => {
    const t = makeIo();
    const r = await execute(async (ctx) => {
      ctx.warn('경고');
      ctx.warn('경고');
      return { dir: ctx.dir, positionals: ctx.args.positionals };
    }, parseArgv(['x', 'a']), t.io, createRedactor());
    expect(r).toEqual({ ok: true, data: { dir: t.dir, positionals: ['a'] }, warnings: ['경고'] });
    expect(t.out).toEqual([]);
  });

  it('CliError는 코드·데이터를, 모르는 오류는 원문 없이 internal을 돌려준다', async () => {
    const t = makeIo();
    expect(await execute(async () => {
      throw new CliError('profile-required', undefined, { profiles: [] });
    }, parseArgv(['x']), t.io, createRedactor())).toMatchObject({ ok: false, error: { code: 'profile-required' }, data: { profiles: [] } });
    const r = await execute(async () => {
      throw new Error('SECRET-INSIDE');
    }, parseArgv(['x']), t.io, createRedactor());
    expect(r).toMatchObject({ ok: false, error: { code: 'internal' } });
    expect(JSON.stringify(r)).not.toContain('SECRET-INSIDE');
  });

  it('verbose일 때만 ctx.log와 모르는 오류 스택이 거른 뒤 표준 오류로 나간다', async () => {
    const SECRET = 'verbose-secret-1';
    const cmd = async (ctx: Parameters<(typeof COMMANDS)[string]>[0]) => {
      ctx.log(`로그 ${SECRET}`);
      throw new Error(`스택 ${SECRET}`);
    };
    const quiet = makeIo();
    const r1 = createRedactor();
    r1.add(SECRET);
    await execute(cmd, parseArgv(['x']), quiet.io, r1);
    expect(quiet.err).toEqual([]);
    const loud = makeIo();
    const r2 = createRedactor();
    r2.add(SECRET);
    await execute(cmd, parseArgv(['x', '--verbose']), loud.io, r2);
    const err = loud.err.join('');
    expect(err).toContain('로그 [숨김]');
    expect(err).toContain('스택 [숨김]');
    expect(err).not.toContain(SECRET);
  });

  it('registerEnvSecrets는 증권사 키 넷과 Drive 클라이언트 시크릿을 거르기에 등록한다', () => {
    expect(SECRET_ENV).toEqual(['KIS_APP_KEY', 'KIS_APP_SECRET', 'TOSS_CLIENT_ID', 'TOSS_CLIENT_SECRET', 'GAZUA_DRIVE_CLIENT_SECRET']);
    const r = createRedactor();
    registerEnvSecrets(r, { KIS_APP_KEY: 'kis-key-123', TOSS_CLIENT_SECRET: ' toss-secret-1 ' });
    expect(r.apply('a kis-key-123 b toss-secret-1')).toBe('a [숨김] b [숨김]');
  });

  it('COMMANDS에 CLI 명령 열 개가 있다', () => {
    expect(Object.keys(COMMANDS).sort()).toEqual(['drive', 'holdings', 'login', 'logout', 'owner', 'profiles', 'quote', 'signals', 'simulate', 'strategies', 'watchlists']);
  });
});

describe('순환 import 방지', () => {
  it('execute.ts와 mcp/*.ts(테스트 제외)는 main.ts를 import하지 않는다', () => {
    const src = fileURLToPath(new URL('.', import.meta.url));
    const mcpDir = `${src}mcp`; // Task 1 시점에는 아직 없다
    const files = ['execute.ts', ...(existsSync(mcpDir) ? readdirSync(mcpDir) : []).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).map((f) => `mcp/${f}`)];
    for (const f of files) expect(readFileSync(`${src}${f}`, 'utf8'), f).not.toMatch(/from ['"](\.\.?\/)+main['"]/);
  });
});
