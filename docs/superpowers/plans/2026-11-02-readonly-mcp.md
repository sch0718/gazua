# 읽기 전용 MCP 서버 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 읽기 전용 CLI(`cli/`)와 같은 코어를 감싸는 stdio MCP 서버 `gazua mcp`를 만든다. 도구 7개(`profiles`·`watchlists`·`strategies`·`quote`·`holdings`·`signals`·`simulate`)는 CLI 명령과 일대일이고, 결과는 CLI의 JSON과 같다.
**Architecture:** `cli/src/main.ts`의 명령 실행부를 `cli/src/execute.ts`로 떼어 CLI와 MCP가 같이 쓴다(순환 import 없음). `cli/src/mcp/`에 줄 단위 JSON-RPC 해석(`protocol.ts`), 도구 정의와 인자 → argv 변환(`tools.ts`), 서버 루프(`server.ts`)를 둔다. 도구 인자는 argv로 바꿔 CLI의 `parseArgv`를 그대로 거친다. 인증·토큰 잠금·증권사 허용 목록·비밀값 거르기는 CLI 코드를 그대로 쓴다.
**Tech Stack:** TypeScript, Node ≥ 22.13.0, vitest 3, esbuild 0.25.12 단일 번들, `corepack pnpm`. 런타임 의존성은 더하지 않는다.

스펙: `docs/superpowers/specs/2026-11-02-readonly-mcp-design.md`. 한 PR로 낸다.

## Global Constraints

- 런타임 의존성 0개 유지. `cli/package.json`의 `dependencies`를 만들지 않는다. MCP SDK를 쓰지 않는다. lockfile을 바꾸지 않는다.
- 명령: `cd cli && corepack pnpm test`(= `TZ=America/New_York vitest run`), `corepack pnpm check`(= `tsc --noEmit`), `corepack pnpm build`. 루트에서는 `corepack pnpm --filter gazua-cli <스크립트>`.
- 도구 이름은 CLI 명령 이름 그대로: `profiles`·`watchlists`·`strategies`·`quote`·`holdings`·`signals`·`simulate`. `login`·`logout`은 도구가 아니다.
- 도구 이름은 `Object.hasOwn`으로 도구 표에서 먼저 찾고, 표에 없으면 JSON-RPC `-32602`(명령 실행 없음).
- 도구 결과 = `{ content: [{ type: 'text', text: JSON.stringify(redact.apply(result)) }], isError: !result.ok }`. `result`는 CLI와 같은 `Result`(`cli/src/output.ts`).
- 지원 프로토콜 버전: `['2025-06-18', '2024-11-05']`. 그 밖은 `'2025-06-18'`로 답한다. 배열 묶음은 `-32600`.
- JSON-RPC 오류 코드: `-32700`(해석 불가, `id: null`), `-32600`(모양 틀림·배열), `-32601`(모르는 메서드), `-32602`(`tools/call`의 `params`가 없거나 객체가 아님, `name`이 문자열이 아님, 모르는 도구).
- 표준 출력에는 JSON-RPC 메시지만 한 줄씩 쓴다. 진행 안내·로그·시작 실패 JSON은 표준 오류.
- 서버 시작: `gazua mcp [--env-file <경로>] [--verbose]`. 옵션은 `mcp` 뒤. 다른 옵션·위치 인자는 시작 실패(표준 오류 JSON, 종료 코드 2).
- 호출은 한 번에 하나씩 받은 차례대로 실행한다. 입력이 닫히면 받은 요청을 모두 처리한 뒤 0으로 끝난다.
- `mcp/*`·`execute.ts`는 `main.ts`를 import하지 않는다.
- 문서·주석·사용자에게 보이는 문구는 한국어(해요체 문서, 기존 CLI 문구와 같은 말투).

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `cli/src/execute.ts`(새) | `COMMANDS`, `SECRET_ENV`, `registerEnvSecrets`, `loadEnvFile`, `execute(cmd, args, io, redact): Promise<Result>` |
| `cli/src/execute.test.ts`(새) | `execute` 단위 테스트, 순환 import 검사 |
| `cli/src/main.ts` | `run`이 `execute`를 쓰게 줄임. `COMMANDS` 다시 내보냄. `isMain` 블록에서 `mcp` 분기 |
| `cli/src/mcp/protocol.ts`(새) | `parseLine`, `rpcResult`, `rpcError`, 오류 코드 상수 |
| `cli/src/mcp/protocol.test.ts`(새) | |
| `cli/src/mcp/tools.ts`(새) | `TOOLS`, `findTool`, `listTools`, `toArgv` |
| `cli/src/mcp/tools.test.ts`(새) | |
| `cli/src/mcp/server.ts`(새) | `serveMcp(argv, io, input): Promise<number>`, `PROTOCOL_VERSIONS`, `INSTRUCTIONS` |
| `cli/src/mcp/server.test.ts`(새) | |
| `cli/src/bundle.test.ts` | 번들 `mcp` 왕복 |
| `cli/src/readme.test.ts` | README MCP 절 검사 |
| `cli/README.md` | MCP 절 |
| `docs/roadmap.md` | 최우선 2 상태 갱신 |

---

### Task 1: 명령 실행 코어를 `execute.ts`로 떼어 내기

**Files:**
- Create: `cli/src/execute.ts`, `cli/src/execute.test.ts`
- Modify: `cli/src/main.ts`

**Interfaces:**
- Produces:
  - `export const COMMANDS: Record<string, Command>` (`login`·`logout`·`profiles`·`watchlists`·`strategies`·`quote`·`holdings`·`signals`·`simulate`)
  - `export const SECRET_ENV: readonly ['KIS_APP_KEY', 'KIS_APP_SECRET', 'TOSS_CLIENT_ID', 'TOSS_CLIENT_SECRET']`
  - `export function registerEnvSecrets(redact: Redactor, env: Io['env']): void`
  - `export function loadEnvFile(path: string, env: Io['env']): void` (실패하면 `CliError('invalid-args', '--env-file을 읽을 수 없어요')`)
  - `export async function execute(cmd: Command, args: Args, io: Io, redact: Redactor): Promise<Result>` — 던지지 않는다. 표준 출력에 쓰지 않는다. `args.verbose`가 `ctx.log`와 모르는 오류 스택(표준 오류, 거른 뒤)을 켠다.
  - `main.ts`는 `export { COMMANDS } from './execute'`로 같은 객체를 다시 내보낸다(기존 테스트가 `COMMANDS.__echo = …`로 바꿔 끼운다).

- [ ] **Step 1: 실패하는 테스트 쓰기** — `cli/src/execute.test.ts`

```ts
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

  it('registerEnvSecrets는 증권사 키 환경변수 넷을 거르기에 등록한다', () => {
    expect(SECRET_ENV).toEqual(['KIS_APP_KEY', 'KIS_APP_SECRET', 'TOSS_CLIENT_ID', 'TOSS_CLIENT_SECRET']);
    const r = createRedactor();
    registerEnvSecrets(r, { KIS_APP_KEY: 'kis-key-123', TOSS_CLIENT_SECRET: ' toss-secret-1 ' });
    expect(r.apply('a kis-key-123 b toss-secret-1')).toBe('a [숨김] b [숨김]');
  });

  it('COMMANDS에 CLI 명령 아홉 개가 있다', () => {
    expect(Object.keys(COMMANDS).sort()).toEqual(['holdings', 'login', 'logout', 'profiles', 'quote', 'signals', 'simulate', 'strategies', 'watchlists']);
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
```

- [ ] **Step 2: 실패 확인**

Run: `cd cli && corepack pnpm exec vitest run src/execute.test.ts`
Expected: FAIL — `Failed to resolve import "./execute"`.

- [ ] **Step 3: `cli/src/execute.ts` 만들기**

```ts
// CLI와 MCP 서버가 같이 쓰는 명령 실행 코어. main.ts와 mcp/*가 이 모듈만 import해 순환 import가 없다.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import type { Args } from './args';
import { profiles, strategies, watchlists } from './commands/data';
import { login, logout } from './commands/login';
import { holdings, quote } from './commands/market';
import { signals } from './commands/signals';
import { simulateCmd } from './commands/simulate';
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
};

/** 증권사 키를 담는 환경변수. 명령 검증보다 먼저 출력 거르기에 등록해, 인자 오류 메시지가 입력을 되풀이해도 키가 나가지 않게 한다 */
export const SECRET_ENV = ['KIS_APP_KEY', 'KIS_APP_SECRET', 'TOSS_CLIENT_ID', 'TOSS_CLIENT_SECRET'] as const;

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
```

- [ ] **Step 4: `cli/src/main.ts`의 `run`을 `execute`로 줄이기**

`main.ts`에서 `COMMANDS`·`SECRET_ENV`·`loadEnvFile` 정의와 그 import(`readFileSync`·`parseEnv`·명령 모듈·`configDir`·`Ctx`)를 지우고, 파일 위쪽을 아래로 바꾼다(`isMain`·`if (isMain())` 블록은 Task 4까지 그대로 둔다):

```ts
// gazua 진입점: 인자 해석 → 명령 분기 → JSON 한 줄. 읽기 전용이라 쓰기·주문 명령은 없다.
import { realpathSync } from 'node:fs';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgv } from './args';
import type { Io } from './context';
import { CliError, exitCodeOf, toCliError, type CliErrorCode } from './errors';
import { COMMANDS, execute, loadEnvFile, registerEnvSecrets } from './execute';
import { createRedactor, fail, render, type Result } from './output';

export { COMMANDS } from './execute';

export async function run(argv: string[], io: Io): Promise<number> {
  const redact = createRedactor();
  let pretty = false;
  const emit = (r: Result) => io.stdout(render(r, redact, pretty));
  registerEnvSecrets(redact, io.env);
  try {
    const args = parseArgv(argv);
    pretty = args.pretty;
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
    const err = toCliError(e); // 여기 오는 것은 인자·--env-file 오류(CliError)뿐이다
    emit(fail(err.code, err.message, err.data));
    return exitCodeOf(err.code);
  }
}
```

`import { COMMANDS, … } from './execute'`와 `export { COMMANDS } from './execute'`를 함께 두면 같은 객체를 쓰고 다시 내보낸다.

- [ ] **Step 5: 통과 확인**

Run: `cd cli && corepack pnpm exec vitest run src/execute.test.ts src/main.test.ts src/commands && corepack pnpm check`
Expected: 모두 PASS, `tsc` 오류 없음. 기존 `main.test.ts`(verbose·env-file·비밀값 거르기)가 동작 변화가 없다는 증거다.

- [ ] **Step 6: 커밋**

```bash
git add cli/src/execute.ts cli/src/execute.test.ts cli/src/main.ts
git commit -m "refactor(cli): 명령 실행 코어를 execute.ts로 떼어 냄"
```

---

### Task 2: 줄 단위 JSON-RPC 해석 (`mcp/protocol.ts`)

**Files:**
- Create: `cli/src/mcp/protocol.ts`, `cli/src/mcp/protocol.test.ts`

**Interfaces:**
- Produces:
  - `export type RpcId = string | number`
  - `export const PARSE_ERROR = -32700, INVALID_REQUEST = -32600, METHOD_NOT_FOUND = -32601, INVALID_PARAMS = -32602`
  - `export type Incoming = { kind: 'request'; id: RpcId; method: string; params: unknown } | { kind: 'notification'; method: string } | { kind: 'response' } | { kind: 'invalid'; reply: RpcMessage }`
  - `export type RpcMessage = { jsonrpc: '2.0'; id: RpcId | null; result: unknown } | { jsonrpc: '2.0'; id: RpcId | null; error: { code: number; message: string } }`
  - `export function parseLine(line: string): Incoming | null` — 빈 줄이면 `null`
  - `export const rpcResult = (id: RpcId, result: unknown): RpcMessage`
  - `export const rpcError = (id: RpcId | null, code: number, message: string): RpcMessage`

- [ ] **Step 1: 실패하는 테스트** — `cli/src/mcp/protocol.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { INVALID_REQUEST, parseLine, PARSE_ERROR, rpcError, rpcResult } from './protocol';

describe('parseLine', () => {
  it('빈 줄은 null', () => {
    expect(parseLine('')).toBeNull();
    expect(parseLine('   \r')).toBeNull();
  });

  it('요청은 id·method·params를 그대로 돌려준다(문자열·숫자 id)', () => {
    expect(parseLine('{"jsonrpc":"2.0","id":1,"method":"ping"}')).toEqual({ kind: 'request', id: 1, method: 'ping', params: undefined });
    expect(parseLine('{"jsonrpc":"2.0","id":"a","method":"tools/call","params":{"name":"x"}}')).toEqual({ kind: 'request', id: 'a', method: 'tools/call', params: { name: 'x' } });
  });

  it('id가 없으면 알림', () => {
    expect(parseLine('{"jsonrpc":"2.0","method":"notifications/initialized"}')).toEqual({ kind: 'notification', method: 'notifications/initialized' });
  });

  it('result나 error만 있는 메시지는 클라이언트 응답이라 무시 대상', () => {
    expect(parseLine('{"jsonrpc":"2.0","id":3,"result":{}}')).toEqual({ kind: 'response' });
    expect(parseLine('{"jsonrpc":"2.0","id":3,"error":{"code":1,"message":"x"}}')).toEqual({ kind: 'response' });
  });

  it('해석할 수 없는 줄은 -32700, id null', () => {
    expect(parseLine('{nope')).toEqual({ kind: 'invalid', reply: { jsonrpc: '2.0', id: null, error: { code: PARSE_ERROR, message: expect.any(String) } } });
  });

  it.each([
    ['배열 묶음', '[{"jsonrpc":"2.0","id":1,"method":"ping"}]', null],
    ['숫자', '5', null],
    ['jsonrpc 없음', '{"id":1,"method":"ping"}', 1],
    ['method가 문자열 아님', '{"jsonrpc":"2.0","id":2,"method":5}', 2],
    ['id가 null', '{"jsonrpc":"2.0","id":null,"method":"ping"}', null],
    ['id가 객체', '{"jsonrpc":"2.0","id":{},"method":"ping"}', null],
  ])('%s는 -32600', (_name, line, id) => {
    expect(parseLine(line)).toEqual({ kind: 'invalid', reply: { jsonrpc: '2.0', id, error: { code: INVALID_REQUEST, message: expect.any(String) } } });
  });
});

describe('응답 만들기', () => {
  it('rpcResult·rpcError', () => {
    expect(rpcResult(7, { a: 1 })).toEqual({ jsonrpc: '2.0', id: 7, result: { a: 1 } });
    expect(rpcError('x', -32601, '없음')).toEqual({ jsonrpc: '2.0', id: 'x', error: { code: -32601, message: '없음' } });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd cli && corepack pnpm exec vitest run src/mcp/protocol.test.ts`
Expected: FAIL — `Failed to resolve import "./protocol"`.

- [ ] **Step 3: 구현** — `cli/src/mcp/protocol.ts`

```ts
// 줄 단위 JSON-RPC 2.0 해석(MCP stdio). 한 줄 = 메시지 하나. 배열 묶음은 받지 않는다(2025-06-18).
export type RpcId = string | number;

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;

export type RpcMessage =
  | { jsonrpc: '2.0'; id: RpcId | null; result: unknown }
  | { jsonrpc: '2.0'; id: RpcId | null; error: { code: number; message: string } };

export type Incoming =
  | { kind: 'request'; id: RpcId; method: string; params: unknown }
  | { kind: 'notification'; method: string }
  | { kind: 'response' }
  | { kind: 'invalid'; reply: RpcMessage };

export const rpcResult = (id: RpcId, result: unknown): RpcMessage => ({ jsonrpc: '2.0', id, result });
export const rpcError = (id: RpcId | null, code: number, message: string): RpcMessage => ({ jsonrpc: '2.0', id, error: { code, message } });

const isId = (v: unknown): v is RpcId => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));
const invalid = (id: RpcId | null): Incoming => ({ kind: 'invalid', reply: rpcError(id, INVALID_REQUEST, 'JSON-RPC 요청 모양이 아니에요') });

export function parseLine(line: string): Incoming | null {
  if (line.trim() === '') return null;
  let msg: unknown;
  try {
    msg = JSON.parse(line);
  } catch {
    return { kind: 'invalid', reply: rpcError(null, PARSE_ERROR, 'JSON으로 읽을 수 없어요') };
  }
  if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) return invalid(null);
  const m = msg as Record<string, unknown>;
  const id = isId(m.id) ? m.id : null;
  if (m.jsonrpc !== '2.0') return invalid(id);
  if (typeof m.method === 'string') {
    if (!('id' in m)) return { kind: 'notification', method: m.method };
    if (id === null) return invalid(null);
    return { kind: 'request', id, method: m.method, params: m.params };
  }
  if ('method' in m) return invalid(id);
  if ('result' in m || 'error' in m) return { kind: 'response' };
  return invalid(id);
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd cli && corepack pnpm exec vitest run src/mcp/protocol.test.ts src/execute.test.ts && corepack pnpm check`
Expected: PASS(순환 검사도 `mcp/protocol.ts`를 보고 통과).

- [ ] **Step 5: 커밋**

```bash
git add cli/src/mcp/protocol.ts cli/src/mcp/protocol.test.ts
git commit -m "feat(cli): MCP stdio용 줄 단위 JSON-RPC 해석"
```

---

### Task 3: 도구 정의와 인자 → argv 변환 (`mcp/tools.ts`)

**Files:**
- Create: `cli/src/mcp/tools.ts`, `cli/src/mcp/tools.test.ts`

**Interfaces:**
- Consumes: `COMMANDS`(Task 1), `parseArgv`(`cli/src/args.ts`), `CliError`.
- Produces:
  - `export interface ToolField { name: string; type: 'string' | 'boolean' | 'strings'; required?: boolean; enum?: readonly string[]; pattern?: string; description: string }`
  - `export interface ToolDef { name: string; description: string; fields: readonly ToolField[] }`
  - `export const TOOLS: readonly ToolDef[]` (이름 순서: `profiles`·`watchlists`·`strategies`·`quote`·`holdings`·`signals`·`simulate`)
  - `export function findTool(name: string): ToolDef | undefined` — `Object.hasOwn`으로 찾는다
  - `export function listTools(): { name: string; description: string; inputSchema: object; annotations: { readOnlyHint: true; openWorldHint: true } }[]`
  - `export function toArgv(tool: ToolDef, input: unknown): string[]` — 실패하면 `CliError('invalid-args', …)`

- [ ] **Step 1: 실패하는 테스트** — `cli/src/mcp/tools.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { parseArgv } from '../args';
import { CliError } from '../errors';
import { COMMANDS } from '../execute';
import { findTool, listTools, toArgv, TOOLS } from './tools';

const tool = (name: string) => {
  const t = findTool(name);
  if (!t) throw new Error(name);
  return t;
};
const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return e instanceof CliError ? e.code : 'other';
  }
  return undefined;
};

describe('도구 표', () => {
  it('도구 이름은 COMMANDS에서 login·logout을 뺀 것과 정확히 같다', () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual(Object.keys(COMMANDS).filter((n) => n !== 'login' && n !== 'logout').sort());
  });

  it('findTool은 표에 있는 이름만 찾는다', () => {
    for (const n of ['login', 'logout', '__proto__', 'constructor', 'toString', 'nope']) expect(findTool(n), n).toBeUndefined();
    expect(findTool('quote')?.name).toBe('quote');
  });

  it('모든 도구가 readOnlyHint·openWorldHint이고 inputSchema가 필드 표와 같다', () => {
    for (const t of listTools()) {
      const def = tool(t.name);
      expect(t.annotations).toEqual({ readOnlyHint: true, openWorldHint: true });
      const s = t.inputSchema as { type: string; properties: Record<string, { type: string }>; required: string[]; additionalProperties: boolean };
      expect(s.type).toBe('object');
      expect(s.additionalProperties).toBe(false);
      expect(Object.keys(s.properties)).toEqual(def.fields.map((f) => f.name));
      expect(s.required).toEqual(def.fields.filter((f) => f.required).map((f) => f.name));
      for (const f of def.fields) expect(s.properties[f.name].type, `${t.name}.${f.name}`).toBe(f.type === 'strings' ? 'array' : f.type);
      expect(t.description.length).toBeGreaterThan(10);
    }
  });

  it('CLI 옵션과 같은 이름만 쓴다(symbols는 위치 인자)', () => {
    const options = new Set(['profile', 'provider', 'strategy', 'from', 'to', 'today', 'raw']);
    for (const t of TOOLS) for (const f of t.fields) expect(f.name === 'symbols' || options.has(f.name), `${t.name}.${f.name}`).toBe(true);
  });
});

describe('toArgv', () => {
  it('값은 --이름=값, 불리언은 true일 때만, 종목은 -- 뒤', () => {
    expect(toArgv(tool('profiles'), undefined)).toEqual(['profiles']);
    expect(toArgv(tool('quote'), { symbols: ['005930', '000660'], provider: 'kis' })).toEqual(['quote', '--provider=kis', '--', '005930', '000660']);
    expect(toArgv(tool('signals'), { strategy: '-눌림목', today: true })).toEqual(['signals', '--strategy=-눌림목', '--today']);
    expect(toArgv(tool('strategies'), { raw: false })).toEqual(['strategies']);
  });

  it('parseArgv를 거치면 CLI와 같은 Args가 된다(값이 -로 시작해도 옵션으로 읽히지 않음)', () => {
    expect(parseArgv(toArgv(tool('quote'), { symbols: ['--env-file', 'x'] }))).toMatchObject({ command: 'quote', positionals: ['--env-file', 'x'] });
    expect(parseArgv(toArgv(tool('quote'), { symbols: ['--env-file', 'x'] })).envFile).toBeUndefined();
    expect(parseArgv(toArgv(tool('simulate'), { strategy: 's', from: '2025-01-01', to: '2025-12-31', profile: '--pretty' }))).toMatchObject({
      command: 'simulate', strategy: 's', from: '2025-01-01', to: '2025-12-31', profile: '--pretty', pretty: false,
    });
  });

  it.each([
    ['arguments가 null', 'profiles', null],
    ['arguments가 배열', 'profiles', []],
    ['arguments가 숫자', 'quote', 5],
    ['모르는 키', 'profiles', { envFile: 'x' }],
    ['서버 옵션 키', 'watchlists', { verbose: true }],
    ['틀린 형(문자열 자리에 숫자)', 'watchlists', { profile: 1 }],
    ['틀린 형(불리언 자리에 문자열)', 'signals', { strategy: 's', today: 'yes' }],
    ['null 값', 'watchlists', { profile: null }],
    ['빠진 필수', 'signals', {}],
    ['빈 종목 배열', 'quote', { symbols: [] }],
    ['종목에 숫자', 'quote', { symbols: [5930] }],
  ])('%s는 invalid-args', (_n, name, input) => {
    expect(code(() => toArgv(tool(name), input))).toBe('invalid-args');
  });

  it('틀린 날짜·provider는 parseArgv가 CLI와 같이 invalid-args로 거른다', () => {
    expect(code(() => parseArgv(toArgv(tool('simulate'), { strategy: 's', from: '2026-02-29' })))).toBe('invalid-args');
    expect(code(() => parseArgv(toArgv(tool('quote'), { symbols: ['005930'], provider: 'nh' })))).toBe('invalid-args');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd cli && corepack pnpm exec vitest run src/mcp/tools.test.ts`
Expected: FAIL — `Failed to resolve import "./tools"`.

- [ ] **Step 3: 구현** — `cli/src/mcp/tools.ts`

```ts
// MCP 도구 정의. CLI 읽기 명령과 일대일이고, 인자 이름은 CLI 옵션과 같다. 인자는 argv로 바꿔 CLI의 parseArgv를 그대로 거친다.
import { CliError } from '../errors';

export interface ToolField {
  name: string;
  /** strings = 문자열 배열(1개 이상, 위치 인자) */
  type: 'string' | 'boolean' | 'strings';
  required?: boolean;
  enum?: readonly string[];
  pattern?: string;
  description: string;
}

export interface ToolDef {
  name: string;
  description: string;
  fields: readonly ToolField[];
}

const PROFILE: ToolField = { name: 'profile', type: 'string', description: '프로필 이름 또는 ID. 프로필이 하나면 생략해요' };
const PROVIDER: ToolField = { name: 'provider', type: 'string', enum: ['kis', 'toss'], description: '증권사. 생략하면 키가 있는 쪽, 둘 다면 toss' };
const STRATEGY: ToolField = { name: 'strategy', type: 'string', required: true, description: '전략 이름 또는 ID' };
const DATE = '^\\d{4}-\\d{2}-\\d{2}$';
const SAME = '결과는 gazua CLI의 JSON({ok,data,warnings} 또는 {ok:false,error})과 같아요. 인자 이름은 CLI 옵션과 같아요.';

export const TOOLS: readonly ToolDef[] = [
  { name: 'profiles', description: `동기화한 프로필 목록(ID·이름·리비전·그룹 수·전략 수). ${SAME}`, fields: [] },
  { name: 'watchlists', description: `관심 그룹과 종목. ${SAME}`, fields: [PROFILE] },
  {
    name: 'strategies',
    description: `전략 목록과 매수·매도·비중 요약. ${SAME}`,
    fields: [PROFILE, { name: 'raw', type: 'boolean', description: 'true면 원 규칙(rules)도 함께' }],
  },
  {
    name: 'quote',
    description: `종목 현재가. ${SAME}`,
    fields: [{ name: 'symbols', type: 'strings', required: true, description: '종목 코드 6자리(예: 005930). ETN은 Q로 시작해도 돼요' }, PROVIDER],
  },
  { name: 'holdings', description: `토스 국내 보유(수량·평단). 토스만 돼요. ${SAME}`, fields: [PROVIDER] },
  {
    name: 'signals',
    description: `전략의 조건 신호와 (토스) 보유 기준 매도 판정. 주문하지 않아요. ${SAME}`,
    fields: [STRATEGY, PROFILE, PROVIDER, { name: 'today', type: 'boolean', description: 'true면 장 마감 뒤 오늘 봉까지 써요' }],
  },
  {
    name: 'simulate',
    description: `전략 시뮬레이션 요약(수익률·MDD·승률 등). ${SAME}`,
    fields: [
      STRATEGY,
      PROFILE,
      PROVIDER,
      { name: 'from', type: 'string', pattern: DATE, description: '시작일 YYYY-MM-DD. 생략하면 전략의 기간' },
      { name: 'to', type: 'string', pattern: DATE, description: '종료일 YYYY-MM-DD. 생략하면 전략의 기간' },
    ],
  },
];

const BY_NAME: Record<string, ToolDef> = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

/** 표에 있는 이름만 찾는다(__proto__·constructor 같은 이름이 Object.prototype으로 새지 않게) */
export function findTool(name: string): ToolDef | undefined {
  return Object.hasOwn(BY_NAME, name) ? BY_NAME[name] : undefined;
}

const fieldSchema = (f: ToolField) => ({
  ...(f.type === 'strings' ? { type: 'array', items: { type: 'string' }, minItems: 1 } : { type: f.type }),
  ...(f.enum ? { enum: [...f.enum] } : {}),
  ...(f.pattern ? { pattern: f.pattern } : {}),
  description: f.description,
});

export function listTools() {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: {
      type: 'object',
      properties: Object.fromEntries(t.fields.map((f) => [f.name, fieldSchema(f)])),
      required: t.fields.filter((f) => f.required).map((f) => f.name),
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true as const, openWorldHint: true as const },
  }));
}

const bad = (message: string) => new CliError('invalid-args', message);

/** 도구 인자 → CLI argv. 값은 `--이름=값` 한 토큰(값이 -로 시작해도 옵션이 되지 않게), 종목은 `--` 뒤 */
export function toArgv(tool: ToolDef, input: unknown): string[] {
  const raw = input === undefined ? {} : input;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw bad('arguments는 JSON 객체여야 해요');
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) if (!tool.fields.some((f) => f.name === key)) throw bad(`${tool.name}이(가) 받지 않는 인자예요: ${key}`);
  const argv = [tool.name];
  let rest: string[] = [];
  for (const f of tool.fields) {
    if (!Object.hasOwn(obj, f.name)) {
      if (f.required) throw bad(`${f.name} 인자가 필요해요`);
      continue;
    }
    const v = obj[f.name];
    if (f.type === 'string') {
      if (typeof v !== 'string') throw bad(`${f.name}은(는) 문자열이어야 해요`);
      argv.push(`--${f.name}=${v}`);
    } else if (f.type === 'boolean') {
      if (typeof v !== 'boolean') throw bad(`${f.name}은(는) true 또는 false여야 해요`);
      if (v) argv.push(`--${f.name}`);
    } else {
      if (!Array.isArray(v) || v.length === 0 || !v.every((x) => typeof x === 'string')) throw bad(`${f.name}은(는) 문자열 1개 이상의 배열이어야 해요`);
      rest = v as string[];
    }
  }
  return rest.length ? [...argv, '--', ...rest] : argv;
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd cli && corepack pnpm exec vitest run src/mcp && corepack pnpm check`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add cli/src/mcp/tools.ts cli/src/mcp/tools.test.ts
git commit -m "feat(cli): MCP 도구 정의와 인자를 CLI argv로 바꾸는 변환"
```

---

### Task 4: MCP 서버 루프와 `gazua mcp` 진입 (`mcp/server.ts`, `main.ts`)

**Files:**
- Create: `cli/src/mcp/server.ts`, `cli/src/mcp/server.test.ts`
- Modify: `cli/src/main.ts`(`isMain` 블록)

**Interfaces:**
- Consumes: Task 1 `COMMANDS`·`execute`·`loadEnvFile`·`registerEnvSecrets`, Task 2 `parseLine`·`rpcResult`·`rpcError`·상수, Task 3 `findTool`·`listTools`·`toArgv`, `parseArgv`, `createRedactor`·`fail`·`render`·`Result`, `toCliError`·`exitCodeOf`, `Io`.
- Produces:
  - `export const PROTOCOL_VERSIONS = ['2025-06-18', '2024-11-05'] as const`
  - `export const INSTRUCTIONS: string`
  - `export async function serveMcp(argv: string[], io: Io, input: AsyncIterable<string>): Promise<number>` — `argv[0]`은 `'mcp'`. 입력이 끝나면 받은 요청을 모두 처리하고 0, 시작 실패면 2.

- [ ] **Step 1: 실패하는 테스트** — `cli/src/mcp/server.test.ts`

```ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import pkg from '../../package.json';
import { writeAuth } from '../config';
import type { Command } from '../context';
import { COMMANDS } from '../execute';
import { run } from '../main';
import { cleanupDirs, fakeFetch, makeIo, profileDoc, syncServer, tempDir } from '../testing';
import { INSTRUCTIONS, serveMcp } from './server';

const saved = { ...COMMANDS };
afterEach(() => {
  Object.assign(COMMANDS, saved);
  cleanupDirs();
});

const TOKEN = `gzc_${'A'.repeat(43)}`;
const AUTH = { v: 1 as const, server: 'https://sync.example', token: TOKEN, tokenId: 't1', label: 'gazua@mac', expiresAt: Date.UTC(2027, 0, 1) };
const TOSS_ENV = { TOSS_CLIENT_ID: 'toss-client-id-1', TOSS_CLIENT_SECRET: 'toss-client-secret-1' };

async function* lines(xs: unknown[]) {
  for (const x of xs) yield typeof x === 'string' ? x : JSON.stringify(x);
}
const req = (id: number, method: string, params?: unknown) => ({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
const call = (id: number, name: string, args?: unknown) => req(id, 'tools/call', { name, ...(args === undefined ? {} : { arguments: args }) });

async function serve(input: unknown[], o: Parameters<typeof makeIo>[0] & { argv?: string[] } = {}) {
  const t = makeIo(o);
  const code = await serveMcp(o.argv ?? ['mcp'], t.io, lines(input));
  const replies = t.out.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const byId = (id: number) => replies.find((r) => r.id === id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tool = (id: number): any => JSON.parse(byId(id).result.content[0].text);
  return { t, code, replies, byId, tool };
}

describe('initialize·ping·tools/list', () => {
  it('지원하는 버전은 그대로, 아니면 2025-06-18. 서버 정보·안내를 준다', async () => {
    const s = await serve([
      req(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } }),
      req(2, 'initialize', { protocolVersion: '2025-03-26' }),
      req(3, 'initialize', {}),
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      req(4, 'ping'),
    ]);
    expect(s.code).toBe(0);
    expect(s.byId(1).result).toEqual({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'gazua', version: pkg.version }, instructions: INSTRUCTIONS });
    expect(s.byId(2).result.protocolVersion).toBe('2025-06-18');
    expect(s.byId(3).result.protocolVersion).toBe('2025-06-18');
    expect(s.byId(4).result).toEqual({});
    expect(s.replies).toHaveLength(4); // 알림에는 응답하지 않는다
    expect(INSTRUCTIONS).toContain('읽기 전용');
  });

  it('tools/list는 도구 7개', async () => {
    const s = await serve([req(1, 'tools/list')]);
    expect(s.byId(1).result.tools.map((t: { name: string }) => t.name)).toEqual(['profiles', 'watchlists', 'strategies', 'quote', 'holdings', 'signals', 'simulate']);
    expect(s.byId(1).result.nextCursor).toBeUndefined();
  });

  it('모르는 메서드 -32601, 해석 불가 -32700, 배열 -32600', async () => {
    const s = await serve([req(1, 'resources/list'), '{nope', '[1]']);
    expect(s.byId(1).error.code).toBe(-32601);
    expect(s.replies.filter((r) => r.id === null).map((r) => r.error.code)).toEqual([-32700, -32600]);
  });
});

describe('tools/call', () => {
  it('결과 텍스트가 같은 인자의 CLI 출력과 같다(profiles, 가짜 동기화 서버)', async () => {
    const docs = { p1: { doc: profileDoc(2, '내 프로필'), revision: 12 } };
    const cli = makeIo({ fetch: syncServer(docs) });
    writeAuth(cli.dir, AUTH);
    await run(['profiles'], cli.io);
    const dir = tempDir();
    writeAuth(dir, AUTH);
    const s = await serve([call(1, 'profiles')], { fetch: syncServer(docs), dir });
    expect(s.byId(1).result.isError).toBe(false);
    expect(s.tool(1)).toEqual(JSON.parse(cli.out.join('')));
    expect(s.tool(1).ok).toBe(true);
  });

  it('quote(토스, 가짜 증권사)도 CLI와 같고 키는 나오지 않는다', async () => {
    const toss = () => fakeFetch((c) => {
      if (c.url.pathname === '/oauth2/token') return { body: { access_token: 'tok-1', expires_in: 86_400 } };
      if (c.url.pathname === '/api/v1/prices') return { body: { result: [{ symbol: '005930', lastPrice: '71200', timestamp: '2026-11-02T09:00:00+09:00' }] } };
      return undefined;
    });
    const cli = makeIo({ fetch: toss(), env: { ...TOSS_ENV } });
    await run(['quote', '005930'], cli.io);
    const s = await serve([call(1, 'quote', { symbols: ['005930'] })], { fetch: toss(), env: { ...TOSS_ENV } });
    expect(s.tool(1)).toEqual(JSON.parse(cli.out.join('')));
    expect(s.t.out.join('') + s.t.err.join('')).not.toContain(TOSS_ENV.TOSS_CLIENT_SECRET);
  });

  it('실패는 isError와 CLI와 같은 오류 JSON(not-logged-in, profile-required의 data)', async () => {
    const a = await serve([call(1, 'profiles')]);
    expect(a.byId(1).result.isError).toBe(true);
    expect(a.tool(1)).toMatchObject({ ok: false, error: { code: 'not-logged-in' } });
    const dir = tempDir();
    writeAuth(dir, AUTH);
    const b = await serve([call(1, 'watchlists')], { fetch: syncServer({ p1: { doc: profileDoc(2, 'A') }, p2: { doc: profileDoc(2, 'B') } }), dir });
    expect(b.tool(1)).toMatchObject({ ok: false, error: { code: 'profile-required' }, data: { profiles: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }] } });
  });

  it('params·name이 틀리면 -32602, arguments가 틀리면 invalid-args 도구 결과', async () => {
    const s = await serve([
      req(1, 'tools/call'),
      req(2, 'tools/call', 5),
      req(3, 'tools/call', { arguments: {} }),
      req(4, 'tools/call', { name: 7 }),
      call(5, 'quote', 5),
      call(6, 'profiles', null),
      call(7, 'profiles', []),
      call(8, 'quote'),
    ]);
    for (const id of [1, 2, 3, 4]) expect(s.byId(id).error.code, String(id)).toBe(-32602);
    for (const id of [5, 6, 7, 8]) {
      expect(s.byId(id).result.isError, String(id)).toBe(true);
      expect(s.tool(id).error.code, String(id)).toBe('invalid-args');
    }
  });

  it('arguments를 생략하면 {}로 검증한다(profiles는 실행된다)', async () => {
    COMMANDS.profiles = async () => ({ ran: true });
    const s = await serve([call(1, 'profiles')]);
    expect(s.tool(1)).toEqual({ ok: true, data: { ran: true } });
  });

  it('login·logout·__proto__·constructor·없는 이름은 -32602이고 아무것도 실행하지 않는다', async () => {
    const f = fakeFetch(() => undefined);
    let ran = 0;
    COMMANDS.login = async () => ++ran;
    COMMANDS.logout = async () => ++ran;
    const dir = tempDir();
    writeAuth(dir, AUTH);
    const s = await serve([call(1, 'login'), call(2, 'logout'), call(3, '__proto__'), call(4, 'constructor'), call(5, 'nope')], { fetch: f, dir });
    for (const id of [1, 2, 3, 4, 5]) expect(s.byId(id).error.code, String(id)).toBe(-32602);
    expect(ran).toBe(0);
    expect(f.calls).toHaveLength(0);
    const again = await serve([call(1, 'profiles')], { fetch: syncServer({ p1: { doc: profileDoc(2) } }), dir });
    expect(again.tool(1).ok).toBe(true); // auth.json이 그대로 있다
  });

  it('호출은 겹치지 않고 받은 차례대로 돈다. 입력이 닫혀도 줄 선 호출까지 모두 응답한다', async () => {
    let active = 0;
    let maxActive = 0;
    const order: string[] = [];
    COMMANDS.watchlists = async (ctx) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 20));
      order.push(ctx.args.profile ?? '');
      active--;
      return { p: ctx.args.profile };
    };
    const s = await serve([call(1, 'watchlists', { profile: 'a' }), call(2, 'watchlists', { profile: 'b' }), req(3, 'ping')]);
    expect(s.code).toBe(0);
    expect(maxActive).toBe(1);
    expect(order).toEqual(['a', 'b']);
    expect(s.tool(1).data).toEqual({ p: 'a' });
    expect(s.tool(2).data).toEqual({ p: 'b' });
    expect(s.replies.map((r) => r.id)).toContain(3);
  });

  it('모르는 오류는 internal로 돌려주고 다음 호출을 받는다', async () => {
    COMMANDS.profiles = async () => {
      throw new Error('SECRET-INSIDE');
    };
    COMMANDS.watchlists = async () => ({ fine: 1 });
    const s = await serve([call(1, 'profiles'), call(2, 'watchlists')]);
    expect(s.tool(1).error.code).toBe('internal');
    expect(s.t.out.join('')).not.toContain('SECRET-INSIDE');
    expect(s.tool(2)).toEqual({ ok: true, data: { fine: 1 } });
  });

  it('호출마다 증권사 키 환경변수를 거른다', async () => {
    COMMANDS.profiles = async (ctx) => ({ note: `key ${ctx.env.TOSS_CLIENT_SECRET}` });
    const s = await serve([call(1, 'profiles'), call(2, 'profiles')], { env: { ...TOSS_ENV } });
    expect(s.tool(1).data.note).toBe('key [숨김]');
    expect(s.tool(2).data.note).toBe('key [숨김]');
  });
});

describe('표준 출력·오류', () => {
  it('--verbose면 도구의 로그·모르는 오류 스택이 거른 뒤 표준 오류로, 아니면 나오지 않는다. 표준 출력은 JSON-RPC만', async () => {
    const cmd: Command = async (ctx) => {
      ctx.log(`자세히 ${ctx.env.TOSS_CLIENT_SECRET}`);
      throw new Error(`스택 ${ctx.env.TOSS_CLIENT_SECRET}`);
    };
    COMMANDS.profiles = cmd;
    const quiet = await serve([call(1, 'profiles')], { env: { ...TOSS_ENV } });
    expect(quiet.t.err.join('')).toBe('');
    const loud = await serve([call(1, 'profiles')], { env: { ...TOSS_ENV }, argv: ['mcp', '--verbose'] });
    const err = loud.t.err.join('');
    expect(err).toContain('자세히 [숨김]');
    expect(err).toContain('스택 [숨김]');
    expect(err).not.toContain(TOSS_ENV.TOSS_CLIENT_SECRET);
    for (const l of loud.t.out.join('').split('\n').filter(Boolean)) expect(JSON.parse(l).jsonrpc).toBe('2.0');
  });

  it('서버가 도는 동안 console.log·info·debug는 표준 오류로 가고, 끝나면 원래대로', async () => {
    const before = console.log;
    COMMANDS.profiles = async () => {
      console.log('콘솔 로그');
      console.info('콘솔 정보');
      console.debug('콘솔 디버그');
      return {};
    };
    const s = await serve([call(1, 'profiles')]);
    expect(s.t.out.join('')).not.toContain('콘솔');
    expect(s.t.err.join('')).toBe('콘솔 로그\n콘솔 정보\n콘솔 디버그\n');
    expect(console.log).toBe(before);
  });
});

describe('시작 옵션', () => {
  it.each([[['mcp', '--profile', 'x']], [['mcp', 'extra']], [['mcp', '--pretty']], [['mcp', '--nope']], [['mcp', '--env-file', '/nonexistent/gazua.env']]])('%j는 종료 코드 2, 표준 오류 JSON, 표준 출력 없음', async (argv) => {
    const s = await serve([req(1, 'ping')], { argv });
    expect(s.code).toBe(2);
    expect(s.t.out).toEqual([]);
    expect(JSON.parse(s.t.err.join(''))).toMatchObject({ ok: false, error: { code: 'invalid-args' } });
  });

  it('--env-file의 키를 쓰고(있는 값은 덮어쓰지 않음) 거른다', async () => {
    const dir = tempDir();
    const path = join(dir, 'broker.env');
    writeFileSync(path, 'TOSS_CLIENT_SECRET=file-secret-123\nKIS_APP_KEY=file-kis-key-1\n');
    COMMANDS.profiles = async (ctx) => ({ a: ctx.env.TOSS_CLIENT_SECRET, b: ctx.env.KIS_APP_KEY });
    const s = await serve([call(1, 'profiles')], { argv: ['mcp', '--env-file', path], env: { KIS_APP_KEY: 'existing-kis-1' } });
    expect(s.code).toBe(0);
    expect(s.tool(1).data).toEqual({ a: '[숨김]', b: '[숨김]' });
    expect(s.t.io.env.KIS_APP_KEY).toBe('existing-kis-1');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd cli && corepack pnpm exec vitest run src/mcp/server.test.ts`
Expected: FAIL — `Failed to resolve import "./server"`.

- [ ] **Step 3: 구현** — `cli/src/mcp/server.ts`

```ts
// gazua mcp: 읽기 전용 MCP 서버(stdio). 도구는 CLI 읽기 명령과 일대일이고 결과는 CLI와 같은 JSON이다.
// 표준 출력에는 JSON-RPC 메시지만 쓴다. 호출은 한 번에 하나씩 받은 차례대로 돈다.
import { format } from 'node:util';
import pkg from '../../package.json';
import { parseArgv } from '../args';
import type { Io } from '../context';
import { CliError, exitCodeOf, toCliError } from '../errors';
import { COMMANDS, execute, loadEnvFile, registerEnvSecrets } from '../execute';
import { createRedactor, fail, render, type Result } from '../output';
import { INVALID_PARAMS, METHOD_NOT_FOUND, parseLine, rpcError, rpcResult, type RpcId, type RpcMessage } from './protocol';
import { findTool, listTools, toArgv, type ToolDef } from './tools';

/** 2025-03-26은 뺐다: 그 버전은 JSON-RPC 배치 수신이 필수인데 이 서버는 배열을 -32600으로 거절한다 */
export const PROTOCOL_VERSIONS = ['2025-06-18', '2024-11-05'] as const;
const LATEST = PROTOCOL_VERSIONS[0];

export const INSTRUCTIONS = '가즈아 읽기 전용 도구예요. 주문·쓰기는 없어요. 로그인은 사람이 터미널에서 gazua login으로 해요. 결과는 gazua CLI의 JSON과 같아요.';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 서버 옵션 해석. --env-file·--verbose 말고는 받지 않는다 */
function startOptions(argv: string[], io: Io): { verbose: boolean } {
  const { command, positionals, envFile, verbose, ...rest } = parseArgv(argv);
  const extra = Object.entries(rest).filter(([, v]) => v !== undefined && v !== false);
  if (command !== 'mcp' || positionals.length > 0 || extra.length > 0) {
    throw new CliError('invalid-args', 'gazua mcp는 --env-file <경로>와 --verbose만 받아요');
  }
  if (envFile) loadEnvFile(envFile, io.env);
  return { verbose };
}

export async function serveMcp(argv: string[], io: Io, input: AsyncIterable<string>): Promise<number> {
  let verbose: boolean;
  try {
    ({ verbose } = startOptions(argv, io));
  } catch (e) {
    const err = toCliError(e);
    const redact = createRedactor();
    registerEnvSecrets(redact, io.env);
    io.stderr(render(fail(err.code, err.message, err.data), redact, false));
    return exitCodeOf(err.code);
  }

  const send = (m: RpcMessage) => io.stdout(`${JSON.stringify(m)}\n`);

  const runTool = async (tool: ToolDef, raw: unknown): Promise<unknown> => {
    const redact = createRedactor();
    registerEnvSecrets(redact, io.env);
    let result: Result;
    try {
      const args = { ...parseArgv(toArgv(tool, raw)), verbose };
      result = await execute(COMMANDS[tool.name], args, io, redact);
    } catch (e) {
      const err = toCliError(e);
      result = fail(err.code, err.message, err.data);
    }
    return { content: [{ type: 'text', text: JSON.stringify(redact.apply(result)) }], isError: !result.ok };
  };

  const handle = (id: RpcId, method: string, params: unknown): RpcMessage => {
    if (method === 'initialize') {
      const asked = isRecord(params) ? params.protocolVersion : undefined;
      const protocolVersion = (PROTOCOL_VERSIONS as readonly unknown[]).includes(asked) ? (asked as string) : LATEST;
      return rpcResult(id, { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'gazua', version: pkg.version }, instructions: INSTRUCTIONS });
    }
    if (method === 'ping') return rpcResult(id, {});
    if (method === 'tools/list') return rpcResult(id, { tools: listTools() });
    return rpcError(id, METHOD_NOT_FOUND, `모르는 메서드예요: ${method}`);
  };

  const original = { log: console.log, info: console.info, debug: console.debug };
  const toStderr = (...a: unknown[]) => io.stderr(`${format(...a)}\n`);
  console.log = toStderr;
  console.info = toStderr;
  console.debug = toStderr;
  let queue: Promise<void> = Promise.resolve();
  try {
    for await (const line of input) {
      const m = parseLine(line);
      if (m === null || m.kind === 'notification' || m.kind === 'response') continue;
      if (m.kind === 'invalid') {
        send(m.reply);
        continue;
      }
      if (m.method !== 'tools/call') {
        send(handle(m.id, m.method, m.params));
        continue;
      }
      const name = isRecord(m.params) ? m.params.name : undefined;
      const tool = typeof name === 'string' ? findTool(name) : undefined;
      if (!isRecord(m.params) || typeof name !== 'string' || !tool) {
        send(rpcError(m.id, INVALID_PARAMS, typeof name === 'string' ? '모르는 도구예요' : 'params.name이 필요해요'));
        continue;
      }
      const { id, params } = m;
      queue = queue.then(async () => send(rpcResult(id, await runTool(tool, params.arguments))));
    }
    await queue;
  } finally {
    Object.assign(console, original);
  }
  return 0;
}
```

`package.json`을 default import로 읽는다. `tsc`가 거절하면(`allowSyntheticDefaultImports`) `cli/tsconfig.json`의 `compilerOptions`에 `"allowSyntheticDefaultImports": true`를 더한다. esbuild·vitest는 JSON default import를 그대로 받는다.

- [ ] **Step 4: `main.ts`의 `isMain` 블록에 `mcp` 분기 더하기**

`main.ts` 맨 위 import에 `import { createInterface } from 'node:readline';`과 `import { serveMcp } from './mcp/server';`를 더하고, 맨 아래 블록을 바꾼다:

```ts
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
```

- [ ] **Step 5: 통과 확인**

Run: `cd cli && corepack pnpm test && corepack pnpm check`
Expected: 전체 PASS, `tsc` 오류 없음(순환 검사가 `mcp/server.ts`·`mcp/tools.ts`도 본다).

- [ ] **Step 6: 커밋**

```bash
git add cli/src/mcp/server.ts cli/src/mcp/server.test.ts cli/src/main.ts cli/tsconfig.json
git commit -m "feat(cli): gazua mcp — 읽기 전용 MCP 서버(stdio)"
```

(`cli/tsconfig.json`을 바꾸지 않았으면 `git add`에서 뺀다.)

---

### Task 5: 번들 왕복 테스트, README, 로드맵

**Files:**
- Modify: `cli/src/bundle.test.ts`, `cli/src/readme.test.ts`, `cli/README.md`, `docs/roadmap.md`

**Interfaces:**
- Consumes: Task 3 `TOOLS`(README 검사), Task 4 번들 진입.

- [ ] **Step 1: 실패하는 테스트 더하기**

`cli/src/bundle.test.ts`의 `describe('번들', …)` 안 끝에 더한다:

```ts
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
```

`cli/src/readme.test.ts`에 import `import { TOOLS } from './mcp/tools';`를 더하고 `describe('cli/README.md', …)` 안 끝에 더한다:

```ts
  it('MCP 절: gazua mcp, Claude Code 등록 명령, 도구 7개, login 제외 안내', () => {
    for (const s of ['## MCP 서버', 'gazua mcp', 'claude mcp add', '--env-file', '-32602']) expect(readme, s).toContain(s);
    for (const t of TOOLS) expect(readme, t.name).toContain(`\`${t.name}\``);
    expect(readme).toContain('gazua login');
  });
```

- [ ] **Step 2: 실패 확인**

Run: `cd cli && corepack pnpm exec vitest run src/readme.test.ts src/bundle.test.ts`
Expected: README 테스트 FAIL(`## MCP 서버` 없음). 번들 테스트는 Task 4 덕분에 PASS일 수 있다(그래도 남겨 둔다 — 번들 진입 회귀 방지).

- [ ] **Step 3: `cli/README.md` 고치기**

첫 목록의 「할 수 없는 것」 줄 끝 문장 `주문·MCP는 다음 단계예요.`를 `주문은 다음 단계예요.`로 바꾼다. 「## 출력」 절 앞에(「## 명령」 절 뒤) 아래 절을 넣는다:

````markdown
## MCP 서버

Claude Code 같은 MCP 클라이언트가 셸 대신 도구 호출로 같은 데이터를 읽게 해요. CLI와 같은 번들이고, 결과는 CLI의 JSON과 같아요. 읽기 전용이라 주문·쓰기 도구는 없어요.

```bash
gazua mcp [--env-file <경로>] [--verbose]
```

| 도구 | 인자 | CLI 대응 |
|---|---|---|
| `profiles` | 없음 | `gazua profiles` |
| `watchlists` | `profile?` | `gazua watchlists` |
| `strategies` | `profile?`, `raw?` | `gazua strategies` |
| `quote` | `symbols`(필수, 문자열 배열), `provider?` | `gazua quote` |
| `holdings` | `provider?` | `gazua holdings` |
| `signals` | `strategy`(필수), `profile?`, `provider?`, `today?` | `gazua signals` |
| `simulate` | `strategy`(필수), `profile?`, `provider?`, `from?`, `to?` | `gazua simulate` |

- 인자 이름은 CLI 옵션과 같아요. 오류 코드·메시지도 CLI 그대로예요(예: 「--profile로 골라 주세요」는 `profile` 인자를 주라는 뜻).
- 실패한 도구 호출은 `isError: true`와 CLI의 `{"ok":false,"error":…}`를 돌려줘요. 모르는 도구 이름(`login`·`logout` 포함)은 JSON-RPC 오류 `-32602`예요.
- 로그인은 도구가 아니에요. 사람이 터미널에서 `gazua login`을 한 번 해 두면, 서버를 다시 띄우지 않아도 다음 호출부터 통해요.
- 증권사 키는 서버를 띄울 때의 환경변수나 `--env-file`로만 받아요. 키를 바꾸면 서버를 다시 띄워요.
- 호출은 한 번에 하나씩 차례로 돌아요. 진행 로그(`--verbose`)는 표준 오류로 나가요.
- 지원하는 MCP 프로토콜 버전은 `2025-06-18`·`2024-11-05`예요.

### Claude Code에 등록

```bash
corepack pnpm --filter gazua-cli build
claude mcp add gazua -- node /절대/경로/gazua/cli/dist/gazua.mjs mcp --env-file /절대/경로/broker.env
```

- `broker.env`에는 `KIS_APP_KEY=…`처럼 위 「증권사 키」 표의 환경변수를 적어요. 파일 권한은 600으로 두세요.
- `claude mcp add gazua -e TOSS_CLIENT_ID=… -e TOSS_CLIENT_SECRET=… -- …`로도 넘길 수 있지만, 그러면 키가 Claude Code 설정 파일에 들어가요. `--env-file`을 권해요.
- `gazua`를 전역 링크했다면 `claude mcp add gazua -- gazua mcp --env-file /절대/경로/broker.env`.
- 등록을 확인하려면 `claude mcp list`. 지우려면 `claude mcp remove gazua`.
- CLI용 토스 키 분리 경고는 MCP에도 그대로예요. MCP 서버와 CLI는 같은 토큰 파일·잠금을 써서 서로의 토큰을 무효로 만들지 않아요.
````

「## 출력」 절의 첫 문장 앞에 `CLI 명령의 출력이에요. MCP 서버는 같은 JSON을 도구 결과의 텍스트로 돌려줘요.`를 한 줄 더한다.

- [ ] **Step 4: `docs/roadmap.md` 고치기**

「## 최우선 2: AI가 쓰는 가즈아 CLI」의 「### 지금」 목록 네 줄(`- CLI 진입점이 없어요.`부터 `- 프록시는 주문 경로를 막아요(…). 주문 코드는 없어요.`까지)을 아래로 바꾼다(「주문 없음」 줄은 그대로 둔다):

```markdown
- 단계 A 완료: 읽기 전용 CLI `gazua`(`cli/`, #63)와 같은 코어를 감싸는 읽기 전용 MCP 서버 `gazua mcp`(stdio, 도구 7개, `docs/superpowers/specs/2026-11-02-readonly-mcp-design.md`). 사용법은 `cli/README.md`.
- CLI 로그인은 기기 코드 방식이고, CLI 토큰은 서버에서 읽기 전용이에요. 증권사 호출은 프록시와 같은 허용 목록으로 주문 경로를 막아요(`proxy/src/allowlist.ts`). 주문 코드는 없어요.
```

「### 단계 A: 읽기 전용 CLI (먼저)」 제목을 「### 단계 A: 읽기 전용 CLI·MCP (완료)」로 바꾸고, 그 아래 목록 끝 줄 `- CLI 로그인 방식(루프백 리다이렉트 또는 기기 코드)을 설계해야 해요.`를 `- CLI 로그인: 기기 코드 방식(앱에서 승인).`으로, 목록 끝에 `- MCP 서버(\`gazua mcp\`): CLI 읽기 명령과 일대일인 도구 7개.`를 더한다.

- [ ] **Step 5: 전체 확인**

Run: `cd cli && corepack pnpm test && corepack pnpm check && corepack pnpm build`
Expected: 전체 PASS, `built …/cli/dist/gazua.mjs`.

손으로 한 번 띄워 본다:

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node cli/dist/gazua.mjs mcp
```

Expected: JSON 두 줄(`id` 1·2), 종료 코드 0.

- [ ] **Step 6: 커밋**

```bash
git add cli/src/bundle.test.ts cli/src/readme.test.ts cli/README.md docs/roadmap.md
git commit -m "docs(cli): MCP 서버 사용법·Claude Code 등록 방법을 적고 로드맵을 갱신"
```

---

## 스펙 대조

| 스펙 | Task |
|---|---|
| §1.1 진입점 `gazua mcp`, 의존성 0, 도구 7개, 인자→`parseArgv`, 결과 JSON, 차례 실행 | 1·3·4 |
| §3.1 `execute.ts`·순환 없음, `isMain` 분기·readline | 1·4 |
| §3.2 인자 변환·검증·`verbose` 덮어쓰기 | 3·4 |
| §3.3 `login`·`logout` 제외 | 3·4 |
| §3.4 프로토콜(버전 협상, 알림, 오류 코드, 입력 종료) | 2·4 |
| §3.5 도구 실행(`hasOwn`, 호출별 Redactor, 결과 모양, internal) | 4 |
| §3.6 서버 옵션·시작 실패·`--env-file` | 4 |
| §3.7 Claude Code 등록 | 5 |
| §5 테스트 목록 | 1~5 |
