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
