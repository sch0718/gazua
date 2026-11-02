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
    // 명령 실행뿐 아니라 비밀값 거르기·직렬화 실패도 호출 안에서 끝낸다.
    // 오류의 data도 직렬화할 수 없을 수 있으므로 대체 결과에는 원래 데이터를 넣지 않는다.
    try {
      return { content: [{ type: 'text', text: JSON.stringify(redact.apply(result)) }], isError: !result.ok };
    } catch (e) {
      if (verbose) io.stderr(`${redact.apply(e instanceof Error ? (e.stack ?? e.message) : String(e))}\n`);
      const internal = fail('internal', new CliError('internal').message);
      return { content: [{ type: 'text', text: JSON.stringify(redact.apply(internal)) }], isError: true };
    }
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
