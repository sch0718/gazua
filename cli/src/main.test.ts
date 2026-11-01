import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseArgv } from './args';
import { CliError } from './errors';
import { COMMANDS, run } from './main';
import { cleanupDirs, makeIo, tempDir } from './testing';

afterEach(() => {
  cleanupDirs();
  delete COMMANDS.__echo;
  delete process.env.GAZUA_TEST_FROM_ENV_FILE;
});

describe('parseArgv', () => {
  it('명령·위치 인자·옵션', () => {
    expect(parseArgv(['quote', '005930', '000660', '--provider', 'kis', '--pretty'])).toMatchObject({ command: 'quote', positionals: ['005930', '000660'], provider: 'kis', pretty: true, verbose: false, today: false, raw: false });
    expect(parseArgv(['signals', '--strategy', '전략', '--today', '--from', '2025-01-01', '--to', '2025-12-31', '--env-file', '.env', '--profile', 'p', '--label', 'l', '--server', 'https://s', '--raw', '--verbose'])).toMatchObject({
      command: 'signals', strategy: '전략', today: true, from: '2025-01-01', to: '2025-12-31', envFile: '.env', profile: 'p', label: 'l', server: 'https://s', raw: true, verbose: true,
    });
    expect(parseArgv([]).command).toBe('');
  });

  it.each([['--nope'], ['--provider', 'x'], ['--from', '2025/01/01'], ['--to', '내일'], ['--from', '2026-02-29'], ['--to', '2026-13-01'], ['--from', '2026-04-31'], ['--profile']])('틀린 인자 %j는 invalid-args', (...argv) => {
    expect(() => parseArgv(argv)).toThrow(CliError);
    try {
      parseArgv(argv);
    } catch (e) {
      expect((e as CliError).code).toBe('invalid-args');
    }
  });
});

describe('날짜 인자는 실제 달력으로 검사한다', () => {
  it('윤년: 2028-02-29는 통과, 2026-02-29는 거절(종료 코드 2)', async () => {
    expect(parseArgv(['simulate', '--from', '2028-02-29', '--to', '2028-12-31'])).toMatchObject({ from: '2028-02-29', to: '2028-12-31' });
    COMMANDS.__echo = async () => ({});
    const t = makeIo();
    expect(await run(['__echo', '--from', '2026-02-29'], t.io)).toBe(2);
    expect(t.result().error.code).toBe('invalid-args');
  });
});

describe('run', () => {
  it('성공은 JSON 한 줄 + 종료 코드 0', async () => {
    COMMANDS.__echo = async (ctx) => ({ positionals: ctx.args.positionals, dir: ctx.dir });
    const t = makeIo();
    expect(await run(['__echo', 'a', 'b'], t.io)).toBe(0);
    expect(t.out.join('').trim().split('\n')).toHaveLength(1);
    expect(t.result()).toEqual({ ok: true, data: { positionals: ['a', 'b'], dir: t.dir } });
    expect(t.err).toEqual([]);
  });

  it('모르는 명령·빈 명령·틀린 인자는 invalid-args + 종료 코드 2', async () => {
    for (const argv of [['bogus'], [], ['--nope']]) {
      const t = makeIo();
      expect(await run(argv, t.io)).toBe(2);
      expect(t.result()).toMatchObject({ ok: false, error: { code: 'invalid-args' } });
    }
  });

  it('CliError는 코드·데이터와 함께 종료 코드 1, 모르는 오류는 internal(메시지 원문 없음)', async () => {
    COMMANDS.__echo = async () => {
      throw new CliError('profile-required', undefined, { profiles: [{ id: '1', name: 'a' }] });
    };
    const t = makeIo();
    expect(await run(['__echo'], t.io)).toBe(1);
    expect(t.result()).toMatchObject({ ok: false, error: { code: 'profile-required' }, data: { profiles: [{ id: '1', name: 'a' }] } });
    COMMANDS.__echo = async () => {
      throw new Error('SECRET-INSIDE-ERROR');
    };
    const u = makeIo();
    expect(await run(['__echo'], u.io)).toBe(1);
    expect(u.result().error.code).toBe('internal');
    expect(u.out.join('')).not.toContain('SECRET-INSIDE-ERROR');
  });

  it('출력 직전에 비밀값을 거르고, warnings를 붙인다', async () => {
    COMMANDS.__echo = async (ctx) => {
      ctx.redact.add('SUPERSECRET123');
      ctx.warn('경고 하나');
      return { token: 'x', accountSeq: '7', note: 'has SUPERSECRET123 inside', fine: 1 };
    };
    const t = makeIo();
    await run(['__echo'], t.io);
    expect(t.result()).toEqual({ ok: true, data: { token: '[숨김]', accountSeq: '[숨김]', note: 'has [숨김] inside', fine: 1 }, warnings: ['경고 하나'] });
  });

  it('진행 로그는 --verbose일 때만 표준 오류로, say는 늘 표준 오류로 나간다', async () => {
    COMMANDS.__echo = async (ctx) => {
      ctx.log('자세히');
      ctx.say('안내');
      return {};
    };
    const quiet = makeIo();
    await run(['__echo'], quiet.io);
    expect(quiet.err.join('')).toBe('안내\n');
    const loud = makeIo();
    await run(['__echo', '--verbose'], loud.io);
    expect(loud.err.join('')).toBe('자세히\n안내\n');
    expect(loud.out.join('')).not.toContain('자세히');
  });

  it('환경변수 키는 명령 검증보다 먼저 등록돼, 틀린 명령·표준 오류 출력에서도 나가지 않는다', async () => {
    const SECRET = 'super-secret-key-1';
    const env = { TOSS_CLIENT_SECRET: SECRET };
    const a = makeIo({ env });
    expect(await run([SECRET], a.io)).toBe(2); // 명령 이름 자리에 키가 들어온 경우
    expect(a.out.join('')).not.toContain(SECRET);
    expect(a.out.join('')).toContain('[숨김]');
    COMMANDS.__echo = async (ctx) => {
      ctx.log(`로그 ${SECRET}`);
      ctx.say(`안내 ${SECRET}`);
      return { note: SECRET };
    };
    const b = makeIo({ env });
    await run(['__echo', '--verbose'], b.io);
    expect(b.out.join('') + b.err.join('')).not.toContain(SECRET);
  });

  it('같은 경고는 한 번만 붙는다', async () => {
    COMMANDS.__echo = async (ctx) => {
      ctx.warn('같은 경고');
      ctx.warn('같은 경고');
      return {};
    };
    const t = makeIo();
    await run(['__echo'], t.io);
    expect(t.result().warnings).toEqual(['같은 경고']);
  });

  it('--pretty는 들여쓴 JSON', async () => {
    COMMANDS.__echo = async () => ({ a: 1 });
    const t = makeIo();
    await run(['__echo', '--pretty'], t.io);
    expect(t.out.join('').split('\n').length).toBeGreaterThan(3);
  });

  it('--env-file을 읽어 환경변수로 쓴다(이미 있는 값은 덮어쓰지 않는다). 없는 파일은 invalid-args', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, '.env'), 'GAZUA_TEST_FROM_ENV_FILE=hello\n');
    COMMANDS.__echo = async (ctx) => ({ v: ctx.env.GAZUA_TEST_FROM_ENV_FILE });
    const t = makeIo({ env: process.env });
    await run(['__echo', '--env-file', join(dir, '.env')], t.io);
    expect(t.result().data).toEqual({ v: 'hello' });
    const u = makeIo({ env: process.env });
    expect(await run(['__echo', '--env-file', join(dir, 'missing.env')], u.io)).toBe(2);
  });

  it('--env-file을 주입된 환경에도 적용하고 기존 값은 보존하며 파일의 비밀값도 거른다', async () => {
    const dir = tempDir();
    const path = join(dir, '.env');
    writeFileSync(path, 'GAZUA_TEST_FROM_ENV_FILE=file-value\nTOSS_CLIENT_SECRET=file-secret-123\n');
    COMMANDS.__echo = async (ctx) => {
      ctx.say(`안내 ${ctx.env.TOSS_CLIENT_SECRET}`);
      return { v: ctx.env.GAZUA_TEST_FROM_ENV_FILE, note: ctx.env.TOSS_CLIENT_SECRET };
    };
    const t = makeIo({ env: { GAZUA_TEST_FROM_ENV_FILE: 'existing-value' } });
    expect(await run(['__echo', '--env-file', path], t.io)).toBe(0);
    expect(t.result().data).toEqual({ v: 'existing-value', note: '[숨김]' });
    expect(t.err.join('')).toBe('안내 [숨김]\n');
  });
});
