// gazua 진입점: 인자 해석 → 명령 분기 → JSON 한 줄. 읽기 전용이라 쓰기·주문 명령은 없다.
import { realpathSync } from 'node:fs';
import { hostname } from 'node:os';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseArgv } from './args';
import type { Io } from './context';
import { CliError, exitCodeOf, toCliError, type CliErrorCode } from './errors';
import { COMMANDS, execute, loadEnvFile, registerEnvSecrets } from './execute';
import { serveMcp } from './mcp/server';
import { createRedactor, fail, render, type Result } from './output';

export { COMMANDS } from './execute';

export async function run(argv: string[], io: Io): Promise<number> {
  const redact = createRedactor();
  let pretty = false;
  let verbose = false;
  const emit = (r: Result) => io.stdout(render(r, redact, pretty));
  registerEnvSecrets(redact, io.env);
  try {
    const args = parseArgv(argv);
    pretty = args.pretty;
    verbose = args.verbose;
    if (args.envFile) {
      loadEnvFile(args.envFile, io.env);
      registerEnvSecrets(redact, io.env); // --env-file로 들어온 키도
    }
    const cmd = Object.hasOwn(COMMANDS, args.command) ? COMMANDS[args.command] : undefined;
    if (!cmd) {
      const names = Object.keys(COMMANDS).join(' · ');
      throw new CliError('invalid-args', args.command ? `알 수 없는 명령이에요: ${args.command} (${names})` : `명령이 필요해요: ${names}`);
    }
    const result = await execute(cmd, args, io, redact);
    emit(result);
    return result.ok ? 0 : exitCodeOf(result.error.code as CliErrorCode);
  } catch (e) {
    const err = toCliError(e); // 인자·--env-file 오류(CliError) 말고도, 결과를 출력하다 던진 예외가 올 수 있다
    if (verbose && !(e instanceof CliError)) io.stderr(`${redact.apply(e instanceof Error ? (e.stack ?? e.message) : String(e))}\n`);
    emit(fail(err.code, err.message, err.data));
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
  const argv = process.argv.slice(2);
  const io: Io = {
    stdout: (s) => void process.stdout.write(s),
    stderr: (s) => void process.stderr.write(s),
    env: process.env,
    fetch: (...a) => fetch(...a),
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    hostname,
  };
  // 서버 옵션은 mcp 뒤에만 온다. 옵션이 앞에 오면 run이 받아 invalid-args로 끝난다.
  const done = argv[0] === 'mcp' ? serveMcp(argv, io, createInterface({ input: process.stdin, crlfDelay: Infinity })) : run(argv, io);
  done.then((code) => {
    process.exitCode = code;
  });
}
