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
