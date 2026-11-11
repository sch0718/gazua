// CLI와 MCP 서버가 같이 쓰는 명령 실행 코어. main.ts와 mcp/*가 이 모듈만 import해 순환 import가 없다.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import type { Args } from './args';
import { profiles, strategies, watchlists } from './commands/data';
import { login, logout } from './commands/login';
import { holdings, quote } from './commands/market';
import { signals } from './commands/signals';
import { simulateCmd } from './commands/simulate';
import { drive } from './commands/drive';
import { owner } from './commands/owner';
import { alert } from './commands/alert';
import { configDir } from './config';
import type { Command, Ctx, Io } from './context';
import { CliError, toCliError } from './errors';
import { fail, ok, type Redactor, type Result } from './output';

export const COMMANDS: Record<string, Command> = {
  login,
  logout,
  profiles,
  watchlists,
  strategies,
  quote,
  holdings,
  signals,
  simulate: simulateCmd,
  drive,
  owner,
  alert,
};

/** 증권사 키·클라이언트 시크릿·알람 토픽을 담는 환경변수. 명령 검증보다 먼저 출력 거르기에 등록해, 인자 오류 메시지가 입력을 되풀이해도 키가 나가지 않게 한다 */
export const SECRET_ENV = ['KIS_APP_KEY', 'KIS_APP_SECRET', 'TOSS_CLIENT_ID', 'TOSS_CLIENT_SECRET', 'GAZUA_DRIVE_CLIENT_SECRET', 'GAZUA_ALERT_NTFY_TOPIC'] as const;

export function registerEnvSecrets(redact: Redactor, env: Io['env']): void {
  for (const name of SECRET_ENV) redact.add(env[name]?.trim());
}

export function loadEnvFile(path: string, env: Io['env']): void {
  try {
    for (const [name, value] of Object.entries(parseEnv(readFileSync(path, 'utf8')))) {
      if (env[name] === undefined) env[name] = value; // 이미 있는 환경변수는 덮어쓰지 않는다
    }
  } catch {
    throw new CliError('invalid-args', '--env-file을 읽을 수 없어요');
  }
}

/** 명령 하나를 실행해 Result로 돌려준다. 던지지 않고 표준 출력에 쓰지 않는다. args.verbose가 진행 로그와 모르는 오류 스택을 켠다 */
export async function execute(cmd: Command, args: Args, io: Io, redact: Redactor): Promise<Result> {
  const warnings: string[] = [];
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
      if (args.verbose) io.stderr(`${redact.apply(line)}\n`);
    },
    warn: (message) => {
      if (!warnings.includes(message)) warnings.push(message); // 같은 경고는 한 번만
    },
    redact,
  };
  try {
    return ok(await cmd(ctx), warnings);
  } catch (e) {
    const err = toCliError(e);
    if (args.verbose && !(e instanceof CliError)) io.stderr(`${redact.apply(e instanceof Error ? (e.stack ?? e.message) : String(e))}\n`);
    return fail(err.code, err.message, err.data, warnings);
  }
}
