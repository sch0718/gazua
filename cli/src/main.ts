// gazua 진입점: 인자 해석 → 명령 분기 → JSON 한 줄. 읽기 전용이라 쓰기·주문 명령은 없다.
import { readFileSync, realpathSync } from 'node:fs';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { parseArgv } from './args';
import { configDir } from './config';
import type { Command, Ctx, Io } from './context';
import { CliError, exitCodeOf, toCliError } from './errors';
import { createRedactor, fail, ok, render, type Result } from './output';

export const COMMANDS: Record<string, Command> = {
  // 명령은 Task마다 여기에 더한다
};

/** 증권사 키를 담는 환경변수. 명령 검증보다 먼저 출력 거르기에 등록해, 인자 오류 메시지가 입력을 되풀이해도 키가 나가지 않게 한다 */
const SECRET_ENV = ['KIS_APP_KEY', 'KIS_APP_SECRET', 'TOSS_CLIENT_ID', 'TOSS_CLIENT_SECRET'] as const;

function loadEnvFile(path: string, env: Io['env']): void {
  try {
    for (const [name, value] of Object.entries(parseEnv(readFileSync(path, 'utf8')))) {
      if (env[name] === undefined) env[name] = value; // 이미 있는 환경변수는 덮어쓰지 않는다
    }
  } catch {
    throw new CliError('invalid-args', '--env-file을 읽을 수 없어요');
  }
}

export async function run(argv: string[], io: Io): Promise<number> {
  const redact = createRedactor();
  const warnings: string[] = [];
  let pretty = false;
  let verbose = false;
  const emit = (r: Result) => io.stdout(render(r, redact, pretty));
  const registerEnvSecrets = () => {
    for (const name of SECRET_ENV) redact.add(io.env[name]?.trim());
  };
  registerEnvSecrets();
  try {
    const args = parseArgv(argv);
    pretty = args.pretty;
    verbose = args.verbose;
    if (args.envFile) {
      loadEnvFile(args.envFile, io.env);
      registerEnvSecrets(); // --env-file로 들어온 키도
    }
    const cmd = Object.hasOwn(COMMANDS, args.command) ? COMMANDS[args.command] : undefined;
    if (!cmd) {
      const names = Object.keys(COMMANDS).join(' · ');
      throw new CliError('invalid-args', args.command ? `알 수 없는 명령이에요: ${args.command} (${names})` : `명령이 필요해요: ${names}`);
    }
    const ctx: Ctx = {
      args,
      env: io.env,
      fetch: io.fetch,
      now: io.now,
      sleep: io.sleep,
      hostname: io.hostname,
      dir: io.dir ?? configDir(io.env),
      say: (line) => io.stderr(`${redact.apply(line)}\n`),
      log: (line) => {
        if (verbose) io.stderr(`${redact.apply(line)}\n`);
      },
      warn: (message) => {
        if (!warnings.includes(message)) warnings.push(message); // 같은 경고는 한 번만
      },
      redact,
    };
    emit(ok(await cmd(ctx), warnings));
    return 0;
  } catch (e) {
    const err = toCliError(e);
    if (verbose && !(e instanceof CliError)) io.stderr(`${redact.apply(e instanceof Error ? (e.stack ?? e.message) : String(e))}\n`);
    emit(fail(err.code, err.message, err.data, warnings));
    return exitCodeOf(err.code);
  }
}

/** bin으로 실행됐을 때만 돈다(테스트가 import해도 실행되지 않게). 링크로 실행해도 실제 경로로 비교한다 */
function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMain()) {
  run(process.argv.slice(2), {
    stdout: (s) => void process.stdout.write(s),
    stderr: (s) => void process.stderr.write(s),
    env: process.env,
    fetch: (...a) => fetch(...a),
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    hostname,
  }).then((code) => {
    process.exitCode = code;
  });
}
