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

  it('결과 직렬화가 실패해도 internal로 응답하고 다음 호출을 처리한다', async () => {
    COMMANDS.profiles = async () => ({ a: 1n });
    COMMANDS.watchlists = async () => ({ fine: 1 });
    const s = await serve([call(1, 'profiles'), call(2, 'watchlists')]);
    expect(s.code).toBe(0);
    expect(s.replies.map((r) => r.id)).toEqual([1, 2]);
    expect(s.byId(1).result.isError).toBe(true);
    expect(s.tool(1)).toEqual({ ok: false, error: { code: 'internal', message: '예상하지 못한 오류예요' } });
    expect(s.t.out.join('')).not.toContain('BigInt');
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
