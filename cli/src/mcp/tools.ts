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
