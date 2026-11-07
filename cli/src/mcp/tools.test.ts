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
  // drive는 사람이 터미널에서 하는 로그인·업로드라 login·logout처럼 도구로 내보내지 않는다. owner는 수집 스크립트 전용이다
  it('도구 이름은 COMMANDS에서 login·logout·drive·owner를 뺀 것과 정확히 같다', () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual(Object.keys(COMMANDS).filter((n) => !['login', 'logout', 'drive', 'owner'].includes(n)).sort());
  });

  it('findTool은 표에 있는 이름만 찾는다', () => {
    for (const n of ['login', 'logout', 'drive', 'owner', '__proto__', 'constructor', 'toString', 'nope']) expect(findTool(n), n).toBeUndefined();
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
    const options = new Set(['profile', 'provider', 'strategy', 'from', 'to', 'today', 'raw', 'propose']);
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
