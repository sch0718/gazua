# 역할 토론형 전략 비판 스킬 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `gazua` MCP 결과(전략·시뮬레이션·신호)로 강세·약세·리스크 역할이 전략을 따지고 정리자가 전략 빌더 조건식 아이디어를 내는 프로젝트 스킬 `.claude/skills/strategy-critique/`를 만든다.

**Architecture:** 스킬은 마크다운(`SKILL.md`·`reference/conditions.md`)과 데모 입력(`examples/demo/*.json`)·데모 출력(`examples/demo-run.md`)뿐이다. 데모 입력은 손으로 쓰지 않고 테스트가 가짜 동기화 서버·가짜 공급자로 MCP 서버(`serveMcp`)를 띄워 만든다. `cli/src/skill.test.ts`가 스킬 문서와 엔진(`sanitizeStrategiesV2`·`COND_KINDS`·`TOOLS`)이 어긋나지 않는지 고정한다.

**Tech Stack:** TypeScript, vitest(`cli` 워크스페이스, `TZ=America/New_York`), Claude Code 프로젝트 스킬.

**Spec:** `docs/superpowers/specs/2026-11-03-strategy-critique-skill-design.md`

## Global Constraints

- 고정 문구(그대로): `⚠️ 참고 의견이며 매매 신호가 아니에요. 개선 아이디어의 효과는 가즈아 전략 빌더에서 바꿔 시뮬레이션으로만 확인하세요.`
- 부르는 MCP 도구: `strategies`·`simulate`·`signals`, 그리고 프로필이 여럿일 때만 `profiles`. 주문·쓰기·파일 쓰기 없음.
- 추가 `simulate`는 원래 전략의 앞·뒤 반 기간 분할(365일 이상일 때) 2번까지.
- 런타임 의존성·lockfile 변경 없음. 새 코드는 테스트 파일 하나(`cli/src/skill.test.ts`)뿐이고 번들(`cli/src/main.ts`)에 들어가지 않는다.
- 사용자에게 보이는 글은 한국어(해요체 문서, 스킬 지시문은 해라체도 됨). 실계정 로그인·외부 서버 연결 없음.
- 검증 명령: `corepack pnpm --filter gazua-cli test`, `corepack pnpm --filter gazua-cli check`.

## 파일

| 파일 | 책임 |
|---|---|
| `cli/src/skill.test.ts`(새) | 데모 입력 생성·비교, 조건표·SKILL.md·demo-run.md 검사 |
| `.claude/skills/strategy-critique/examples/demo/{strategies,simulate,simulate-first-half,simulate-second-half,signals}.json`(새, 생성물) | MCP `tools/call` 결과(`{ok,data,…}`) |
| `.claude/skills/strategy-critique/reference/conditions.md`(새) | 조건 종류·숫자 범위·고르는 값·묶음 한도·매도 규칙 |
| `.claude/skills/strategy-critique/SKILL.md`(새) | 스킬 본문 |
| `.claude/skills/strategy-critique/examples/demo-run.md`(새) | 데모 실행 출력 |
| `cli/README.md`, `cli/src/readme.test.ts` | 「전략 비판 스킬」 절과 검사 |
| `docs/roadmap.md`, `docs/proposals/2026-11-02-external-tools.md` | 상태 갱신 |

---

### Task 1: 데모 입력 생성과 고정

**Files:**
- Create: `cli/src/skill.test.ts`
- Create(생성물): `.claude/skills/strategy-critique/examples/demo/*.json`

**Interfaces:**
- Produces: `skill.test.ts` 안의 `demoStrategy(): StrategyV2`, `assembled(): StrategyV2`(데모 `strategies.json` 첫 전략을 `{v:2,id,name,rules}`로 조립), `repaired(s): boolean`, `section(md, title): string`, `FIXED` 상수, `read(rel)`. 뒤 태스크가 같은 파일에 `describe`를 더한다.

- [ ] **Step 1: 실패하는 테스트 작성** — `cli/src/skill.test.ts`:

```ts
// .claude/skills/strategy-critique 스킬 문서·데모가 엔진·MCP 도구와 어긋나지 않는지 본다(스펙 2026-11-03-strategy-critique-skill-design §5)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { MarketDataProvider, StockMeta } from '../../src/lib/providers/types';
import { type Cond, defaultCond, MAX_CONDS, MAX_GROUPS, sanitizeStrategiesV2, type StrategyV2 } from '../../src/lib/sim/strategyV2';
import { tradingDates } from '../../src/lib/sim/testBars';
import { randomWalk } from '../../src/lib/sim/testInputs';
import { fullStrategyV2 } from '../../src/lib/sim/testStrategyV2';
import { addDays, kstDate } from '../../src/lib/time/kst';
import { COND_KINDS } from '../../src/lib/ui/simulate/editor/condKinds';
import { makeSignals } from './commands/signals';
import { makeSimulate } from './commands/simulate';
import { writeAuth } from './config';
import { COMMANDS } from './execute';
import { serveMcp } from './mcp/server';
import { TOOLS } from './mcp/tools';
import type { Built } from './providers';
import { cleanupDirs, makeIo, profileDoc, syncServer } from './testing';

const SKILL = '../../.claude/skills/strategy-critique/';
const path = (rel: string) => fileURLToPath(new URL(SKILL + rel, import.meta.url));
const read = (rel: string) => readFileSync(path(rel), 'utf8');
const FIXED = '⚠️ 참고 의견이며 매매 신호가 아니에요. 개선 아이디어의 효과는 가즈아 전략 빌더에서 바꿔 시뮬레이션으로만 확인하세요.';

const saved = { ...COMMANDS };
afterEach(() => {
  Object.assign(COMMANDS, saved);
  cleanupDirs();
});

/** 데모 전략: RSI 반등 매수, 15% 익절만 켜고 손절·트레일링은 끔(리스크 역할이 따질 거리) */
function demoStrategy(): StrategyV2 {
  const s = fullStrategyV2();
  s.id = 'demo1';
  s.name = '데모 RSI 반등';
  s.period = { from: '2023-01-02', to: '2025-12-30' };
  s.sizing = { mode: 'equityPct', pct: 30 };
  s.rules.buy = [{ conds: [{ kind: 'rsi', period: 14, level: 30, op: 'crossUp' }] }];
  s.rules.sell = {
    takeProfit: { on: true, stages: [{ pct: 15, sellPct: 100 }], afterFirstTake: 'keep' },
    stopLoss: { on: false, pct: 7, basis: 'avgAlways' },
    trailing: { on: false, pct: 10 },
    timeExit: { on: false, days: 20 },
    signal: { on: false, groups: [] },
  };
  s.scaleIn = { on: false, stepPct: 3, maxAdds: 2 };
  s.benchmarks = { index: 'KOSPI', symbol: null };
  return s;
}

const AUTH = { v: 1 as const, server: 'https://sync.example', token: `gzc_${'A'.repeat(43)}`, tokenId: 't1', label: 'gazua@mac', expiresAt: Date.UTC(2027, 0, 1) };
const DATES = tradingDates('2022-01-03', 1260);
const WALKS: Record<string, ReturnType<typeof randomWalk>> = { '005930': randomWalk(DATES, 11), '000660': randomWalk(DATES, 22), KOSPI: randomWalk(DATES, 33) };

function stubProvider(): MarketDataProvider {
  const meta = (symbol: string): StockMeta => ({ symbol, name: symbol === '005930' ? '삼성전자' : 'SK하이닉스', market: 'KOSPI', securityType: 'STOCK', nxtSupported: false, krxSuspended: false, nxtSuspended: null, liquidationTrading: false });
  return {
    id: 'kis',
    capabilities: { venues: ['KRX'], quoteBatchSize: 1, hasIndexCandles: true, indexMinutePastDays: false },
    getStockMeta: async (symbols: string[]) => symbols.filter((s) => WALKS[s]).map(meta),
    getCandles: async (q: { symbol: string; from: string; to: string }) => (WALKS[q.symbol] ?? []).filter((c) => kstDate(c.t) >= q.from && kstDate(c.t) <= q.to),
    getIndexCandles: async (_i: string, _iv: string, from: string, to: string) => WALKS.KOSPI.filter((c) => kstDate(c.t) >= from && kstDate(c.t) <= to),
    getTradingDays: async () => [],
  } as unknown as MarketDataProvider;
}

async function* lines(xs: unknown[]) {
  for (const x of xs) yield JSON.stringify(x);
}

/** 가짜 동기화 서버·공급자로 MCP 서버를 띄워 도구를 부른다. 결과는 tools/call 텍스트를 해석한 JSON */
async function callTools(calls: { name: string; arguments?: Record<string, unknown> }[]): Promise<unknown[]> {
  const t = makeIo({ fetch: syncServer({ p1: { doc: { ...profileDoc(2, '데모 프로필'), strategies: [demoStrategy()] } } }), env: { KIS_APP_KEY: 'k', KIS_APP_SECRET: 's' } });
  writeAuth(t.dir, AUTH);
  const built: Built = { id: 'kis', provider: stubProvider(), keyHash: 'kh' };
  COMMANDS.simulate = makeSimulate(() => built);
  COMMANDS.signals = makeSignals(() => built);
  await serveMcp(['mcp'], t.io, lines(calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 1, method: 'tools/call', params: c }))));
  const replies = t.out.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return calls.map((_, i) => JSON.parse(replies.find((r) => r.id === i + 1).result.content[0].text));
}

/** 스킬 절차 4단계와 같은 분할: 일수의 절반 날짜까지가 앞 반, 그다음 날부터가 뒤 반 */
function halves(p: { from: string; to: string }) {
  const days = Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86_400_000);
  const mid = addDays(p.from, Math.floor(days / 2));
  return [{ from: p.from, to: mid }, { from: addDays(mid, 1), to: p.to }];
}

async function demoResults(): Promise<Record<string, unknown>> {
  const strategy = '데모 RSI 반등';
  const [strategies, simulate, signals] = await callTools([
    { name: 'strategies', arguments: { raw: true } },
    { name: 'simulate', arguments: { strategy } },
    { name: 'signals', arguments: { strategy } },
  ]);
  const [first, second] = halves((simulate as { data: { period: { from: string; to: string } } }).data.period);
  const [firstHalf, secondHalf] = await callTools([
    { name: 'simulate', arguments: { strategy, ...first } },
    { name: 'simulate', arguments: { strategy, ...second } },
  ]);
  return { strategies, simulate, 'simulate-first-half': firstHalf, 'simulate-second-half': secondHalf, signals };
}

describe('데모 입력', () => {
  it('examples/demo/*.json이 지금 MCP 서버가 내는 결과와 같다(UPDATE_DEMO=1이면 다시 씀)', async () => {
    const got = await demoResults();
    for (const [name, value] of Object.entries(got)) {
      expect((value as { ok: boolean }).ok, name).toBe(true);
      const file = path(`examples/demo/${name}.json`);
      const text = `${JSON.stringify(value, null, 2)}\n`;
      if (process.env.UPDATE_DEMO) {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, text);
      }
      expect(readFileSync(file, 'utf8'), name).toBe(text);
    }
  });

  it('데모 시뮬레이션은 거래가 있고 기간이 1년 이상이다(역할 토론에 쓸 거리)', () => {
    const sim = JSON.parse(read('examples/demo/simulate.json')).data;
    expect(sim.summary.roundTrips).toBeGreaterThan(0);
    expect(Date.parse(sim.period.to) - Date.parse(sim.period.from)).toBeGreaterThanOrEqual(365 * 86_400_000);
  });

  it('데모 strategies.json의 첫 전략을 {v:2,id,name,rules}로 조립하면 고침 없이 통과한다', () => {
    expect(repaired(assembled())).toBe(false);
  });
});

/** 스펙 §4: MCP 출력 전체가 아니라 id·name·rules만 꺼내 v:2를 붙인다 */
function assembled(): StrategyV2 {
  const raw = JSON.parse(read('examples/demo/strategies.json')).data.strategies[0];
  return { v: 2, id: raw.id, name: raw.name, rules: raw.rules } as StrategyV2;
}
const repaired = (s: StrategyV2) => sanitizeStrategiesV2({ strategies: [s] }).repaired;
/** `## 제목`부터 다음 `## ` 제목 전까지 */
function section(md: string, title: string): string {
  const start = md.indexOf(`\n## ${title}\n`);
  if (start < 0) return '';
  const rest = md.slice(start + title.length + 5);
  const end = rest.search(/\n## /);
  return end < 0 ? rest : rest.slice(0, end);
}
```

(`Cond`·`defaultCond`·`MAX_*`·`COND_KINDS`·`TOOLS`·`section`은 Task 2·3에서 쓴다. `cli/tsconfig.json`에 `noUnusedLocals`가 없어 이 단계의 `check`는 통과한다.)

- [ ] **Step 2: 실패 확인** — `corepack pnpm --filter gazua-cli exec vitest run src/skill.test.ts` → 데모 파일이 없어 `ENOENT`로 FAIL.

- [ ] **Step 3: 생성** — `UPDATE_DEMO=1 corepack pnpm --filter gazua-cli exec vitest run src/skill.test.ts` (TZ는 패키지 스크립트 밖이라 `TZ=America/New_York`를 앞에 붙인다) → PASS, 파일 5개 생김. `simulate.json`의 `summary.roundTrips`가 0이면 `demoStrategy`의 조건(예: RSI `level` 35)을 바꿔 다시 생성한다.

- [ ] **Step 4: 다시 확인** — `corepack pnpm --filter gazua-cli test -- src/skill.test.ts` → PASS(생성 없이 같음).

- [ ] **Step 5: 커밋** — `git add cli/src/skill.test.ts .claude/skills/strategy-critique/examples/demo && git commit -m "test(skill): 전략 비판 스킬 데모 입력을 가짜 서버의 MCP 결과로 만들고 고정함"`

### Task 2: 조건식 참조표와 엔진 대조

**Files:**
- Create: `.claude/skills/strategy-critique/reference/conditions.md`
- Modify: `cli/src/skill.test.ts`(describe 추가)

**Interfaces:**
- Consumes: Task 1의 `demoStrategy`·`repaired`·`section`·`read`.
- Produces: `conditions.md`의 절 이름 `조건 종류`·`숫자 범위`·`묶음 한도`와 표 행 형식(아래). Task 3 SKILL.md가 이 파일을 가리킨다.

- [ ] **Step 1: 실패하는 테스트 추가** — `skill.test.ts` 끝에:

```ts
describe('reference/conditions.md', () => {
  const md = () => read('reference/conditions.md');
  const kindRows = () => [...section(md(), '조건 종류').matchAll(/^\| `(\w+)` \| ([^|]+?) \|/gm)].map((m) => ({ kind: m[1], label: m[2] }));
  const rangeRows = () =>
    [...section(md(), '숫자 범위').matchAll(/^\| `([\w.[\]]+)` \| `(\w+)` \| (정수|소수) \| (-?[\d.]+) \| (-?[\d.]+) \|/gm)].map((m) => ({ target: m[1], param: m[2], int: m[3] === '정수', min: Number(m[4]), max: Number(m[5]) }));
  const isKind = (t: string) => COND_KINDS.some((k) => k.kind === t);

  /** 데모 전략 하나의 한 값만 바꾼다. 조건은 매수 묶음 하나에 그 조건만 둔다 */
  function withValue(target: string, param: string, v: number): StrategyV2 {
    const s = demoStrategy();
    if (isKind(target)) s.rules.buy = [{ conds: [{ ...defaultCond(target as Cond['kind']), [param]: v } as Cond] }];
    else if (target === 'takeProfit.stages[]') s.rules.sell.takeProfit.stages = param === 'sellPct' ? [{ pct: 10, sellPct: v }, { pct: 20, sellPct: 100 }] : [{ pct: v, sellPct: 100 }];
    else (s.rules.sell as unknown as Record<string, Record<string, number>>)[target][param] = v;
    return s;
  }

  it('조건 종류와 편집기 이름이 COND_KINDS와 같다(순서 포함)', () => {
    expect(kindRows()).toEqual(COND_KINDS.map((k) => ({ kind: k.kind, label: k.label })));
  });

  it('pattern을 뺀 조건의 숫자 인자가 모두 표에 있다', () => {
    for (const { kind } of COND_KINDS.filter((k) => k.kind !== 'pattern')) {
      const numeric = Object.entries(defaultCond(kind)).filter(([, v]) => typeof v === 'number').map(([k]) => k).sort();
      expect(rangeRows().filter((r) => r.target === kind).map((r) => r.param).sort(), kind).toEqual(numeric);
    }
    for (const t of ['takeProfit.stages[]', 'stopLoss', 'trailing', 'timeExit']) expect(rangeRows().some((r) => r.target === t), t).toBe(true);
  });

  it('표의 최소·최대는 엔진이 고치지 않고, 그 밖은 고친다', () => {
    expect(repaired(demoStrategy())).toBe(false);
    for (const r of rangeRows()) {
      const step = r.int ? 1 : 0.5;
      expect(repaired(withValue(r.target, r.param, r.min)), `${r.target}.${r.param}=${r.min}`).toBe(false);
      expect(repaired(withValue(r.target, r.param, r.max)), `${r.target}.${r.param}=${r.max}`).toBe(false);
      expect(repaired(withValue(r.target, r.param, r.min - step)), `${r.target}.${r.param}=${r.min - step}`).toBe(true);
      expect(repaired(withValue(r.target, r.param, r.max + step)), `${r.target}.${r.param}=${r.max + step}`).toBe(true);
    }
  });

  it('묶음 한도가 엔진과 같다', () => {
    expect(section(md(), '묶음 한도')).toContain(`묶음은 최대 ${MAX_GROUPS}개, 묶음마다 조건은 최대 ${MAX_CONDS}개`);
  });
});
```

- [ ] **Step 2: 실패 확인** — `TZ=America/New_York corepack pnpm --filter gazua-cli exec vitest run src/skill.test.ts` → `conditions.md` ENOENT로 FAIL.

- [ ] **Step 3: `conditions.md` 작성**

```markdown
# 전략 빌더 조건식 (엔진 기준)

`src/lib/sim/strategyV2.ts`의 `Cond`와 `sanitizeStrategiesV2` 기준이에요. 범위 밖 값은 전략을 읽을 때 조용히 기본값으로 바뀌어 다른 전략이 돼요. `cli/src/skill.test.ts`가 이 표와 엔진이 같은지 검사해요.

## 조건 종류

| kind | 편집기 이름 | 맞는 때 | JSON 예 |
|---|---|---|---|
| `maPrice` | 이동평균 위·아래 | 종가가 `period`일 이동평균보다 위(`above`)·아래(`below`) | `{"kind":"maPrice","period":20,"side":"above"}` |
| `maCross` | 이평 교차 | `short`일선이 `long`일선을 위로(`golden`)·아래로(`dead`) 뚫은 날 | `{"kind":"maCross","short":20,"long":60,"dir":"golden"}` |
| `rsi` | RSI | `period`일 RSI가 `level`보다 위·아래(`above`·`below`), 또는 위로·아래로 지난 날(`crossUp`·`crossDown`) | `{"kind":"rsi","period":14,"level":30,"op":"crossUp"}` |
| `volume` | 거래량 | 거래량이 `days`일 평균의 `ratio`배 이상 | `{"kind":"volume","days":20,"ratio":1.5}` |
| `change` | N일 등락률 | `days`일 전 종가 대비 등락률이 `pct`% 이상(`above`)·이하(`below`) | `{"kind":"change","days":5,"pct":-10,"op":"below"}` |
| `fromHigh` | 고점 대비 하락 | 종가가 `days`일 최고 종가보다 `pct`% 이상 낮음 | `{"kind":"fromHigh","days":60,"pct":20}` |
| `newHigh` | 신고가 돌파 | 종가가 직전 `days`일 최고 종가를 넘음 | `{"kind":"newHigh","days":60}` |
| `pattern` | 반등 패턴 | 기존 반등 패턴(인자는 `entry` 안, 검증은 따로). 새로 제안하지 않고, 매도 조건에는 못 써요 | — |

## 숫자 범위

| 대상 | 인자 | 형 | 최소 | 최대 |
|---|---|---|---|---|
| `maPrice` | `period` | 정수 | 2 | 250 |
| `maCross` | `short` | 정수 | 2 | 250 |
| `maCross` | `long` | 정수 | 2 | 250 |
| `rsi` | `period` | 정수 | 2 | 50 |
| `rsi` | `level` | 소수 | 1 | 99 |
| `volume` | `days` | 정수 | 2 | 120 |
| `volume` | `ratio` | 소수 | 1 | 20 |
| `change` | `days` | 정수 | 1 | 250 |
| `change` | `pct` | 소수 | -90 | 500 |
| `fromHigh` | `days` | 정수 | 2 | 250 |
| `fromHigh` | `pct` | 소수 | 1 | 90 |
| `newHigh` | `days` | 정수 | 2 | 250 |
| `takeProfit.stages[]` | `pct` | 소수 | 0.5 | 500 |
| `takeProfit.stages[]` | `sellPct` | 소수 | 1 | 100 |
| `stopLoss` | `pct` | 소수 | 0.5 | 50 |
| `trailing` | `pct` | 소수 | 1 | 50 |
| `timeExit` | `days` | 정수 | 1 | 250 |

- 익절 단계는 1~3개이고 **마지막 단계의 `sellPct`는 항상 100**이에요(엔진이 강제). 위 `sellPct` 범위는 마지막이 아닌 단계에만 해당해요.
- `maCross`는 `short`가 `long`보다 작아야 뜻이 있어요(엔진은 검사하지 않아요).

## 고르는 값

| 자리 | 값 |
|---|---|
| `maPrice.side`, `change.op` | `above`, `below` |
| `maCross.dir` | `golden`, `dead` |
| `rsi.op` | `above`, `below`, `crossUp`, `crossDown` |
| `stopLoss.basis` | `avgAfterScaleIn`(분할 매수 뒤 평단), `avgAlways`(늘 평단), `firstBuy`(첫 매수가) |
| `takeProfit.afterFirstTake` | `keep`(손절선 유지), `breakeven`(1단계 익절 뒤 본전 손절) |
| 각 매도 규칙의 `on` | `true`, `false` |

## 묶음 한도

묶음은 최대 4개, 묶음마다 조건은 최대 5개예요. 묶음 안 조건은 모두 맞아야 하고(AND), 묶음끼리는 하나만 맞으면 돼요(OR). 매수(`rules.buy`)와 조건 매도(`rules.sell.signal.groups`)가 같은 한도예요.

## 매도 규칙 모양

| 필드 | 모양 | 편집기 |
|---|---|---|
| `rules.sell.takeProfit` | `{"on":true,"stages":[{"pct":15,"sellPct":100}],"afterFirstTake":"keep"}` | 익절 사용 |
| `rules.sell.stopLoss` | `{"on":true,"pct":7,"basis":"avgAlways"}` | 손절 사용 |
| `rules.sell.trailing` | `{"on":true,"pct":10}` | 트레일링 스톱 |
| `rules.sell.timeExit` | `{"on":true,"days":20}` | 기간 청산 |
| `rules.sell.signal` | `{"on":true,"groups":[{"conds":[…]}]}` | 조건 매도 사용 › 조건 매도 묶음 |
```

- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS.
- [ ] **Step 5: 커밋** — `git add .claude/skills/strategy-critique/reference cli/src/skill.test.ts && git commit -m "feat(skill): 전략 빌더 조건식 참조표를 쓰고 엔진 범위와 맞춤"`

### Task 3: 기준선 관찰(RED)과 SKILL.md(GREEN)

writing-skills의 RED-GREEN을 따른다.

**Files:**
- Create: `.claude/skills/strategy-critique/SKILL.md`
- Modify: `cli/src/skill.test.ts`
- 기준선 기록: 공유 노트 폴더 `strategy-critique-baseline.md`(저장소 밖)

**Interfaces:**
- Consumes: `conditions.md`의 절 이름, 데모 JSON 파일 이름.
- Produces: SKILL.md 절 `## 부르는 도구`, 출력 틀의 `### 아이디어 N:`·`- **바꿀 곳:** \`경로\` 동작`·```json 한 줄 형식(Task 4가 파싱).

- [ ] **Step 1: 기준선(스킬 없이)** — 서브에이전트(general-purpose, Sonnet)에 데모 JSON 5개 경로만 주고 「이 전략의 약점을 강세·약세·리스크 역할로 따지고 개선 아이디어를 내 줘」라고 시킨다. 결과에서 다음을 기록한다: 매매 권유 문구, 입력에 없는 숫자, 사전 지식 사용, 엔진 범위 밖·편집기로 옮길 수 없는 아이디어, 효과 예측, 고정 문구 없음, 쓰기 시도.
- [ ] **Step 2: 실패하는 테스트 추가**

```ts
describe('SKILL.md', () => {
  const md = () => read('SKILL.md');
  it('frontmatter name이 strategy-critique이고 description이 있다', () => {
    expect(md()).toMatch(/^---\nname: strategy-critique\ndescription: .+\n---\n/);
  });
  it('고정 문구가 그대로 있다', () => {
    expect(md()).toContain(FIXED);
  });
  it('「부르는 도구」 절의 MCP 도구 이름이 strategies·simulate·signals·profiles뿐이다', () => {
    const names = new Set(TOOLS.map((t) => t.name));
    const used = new Set([...section(md(), '부르는 도구').matchAll(/`([^`]+)`/g)].map((m) => m[1]).filter((n) => names.has(n)));
    expect([...used].sort()).toEqual(['profiles', 'signals', 'simulate', 'strategies']);
  });
  it('조건식 참조표를 가리킨다', () => {
    expect(md()).toContain('reference/conditions.md');
  });
});
```

- [ ] **Step 3: 실패 확인** — ENOENT로 FAIL.
- [ ] **Step 4: SKILL.md 작성** — 스펙 §3.2~§3.7을 지시문으로 옮긴다. 절: `## 부르는 도구`(네 이름만 백틱), `## 부르지 않는 도구`, `## 절차`(1~6, 기간 분할 식 `mid = from + floor(일수/2)`), `## 오류`(스펙 §2의 코드별 안내), `## 모든 역할의 규칙`, `## 역할`, `## 개선 아이디어`(바꿀 곳 경로·동작 목록: `rules.buy[n]` 조건 추가 / `rules.buy` 새 묶음 / `rules.buy[n].conds[m]` 조건 교체 / `rules.sell.signal.groups[n]`·`rules.sell.signal.groups`·`rules.sell.signal.groups[n].conds[m]` 같은 동작 / `rules.sell.takeProfit|stopLoss|trailing|timeExit|signal` 값 바꾸기(적은 키만 바뀜), `n`은 0부터·편집기 「묶음 k」= n+1), `## 출력 틀`(첫·끝 줄 `> ` + 고정 문구), `## 하지 않는 것`, `## 빠지기 쉬운 것`(Step 1에서 관찰한 실패와 막는 규칙).
- [ ] **Step 5: 통과 확인** — PASS.
- [ ] **Step 6: 커밋** — `git commit -m "feat(skill): 역할 토론형 전략 비판 스킬을 씀"`

### Task 4: 데모 실행(GREEN 확인)과 출력 검사

**Files:**
- Create: `.claude/skills/strategy-critique/examples/demo-run.md`
- Modify: `cli/src/skill.test.ts`

- [ ] **Step 1: 실패하는 테스트 추가**

```ts
describe('examples/demo-run.md', () => {
  const md = () => read('examples/demo-run.md');
  const strip = (l: string) => l.replace(/^>\s?/, '').trim();

  it('첫 줄과 마지막 줄이 고정 문구다', () => {
    const ls = md().split('\n').filter((l) => l.trim() !== '');
    expect(strip(ls[0])).toBe(FIXED);
    expect(strip(ls[ls.length - 1])).toBe(FIXED);
  });

  it('강세·약세·리스크·정리 절이 차례로 있다', () => {
    const at = ['## 강세', '## 약세', '## 리스크', '## 정리'].map((h) => md().indexOf(`\n${h}`));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  /** 아이디어 하나를 데모 전략 조립본에 적용한다(스펙 §5 추출 규칙) */
  function apply(where: string, action: string, value: Record<string, unknown>): StrategyV2 {
    const s = structuredClone(assembled());
    const groupsOf = (side: string) => (side === 'buy' ? s.rules.buy : s.rules.sell.signal.groups);
    let m: RegExpExecArray | null;
    if ((m = /^rules\.(buy|sell\.signal\.groups)\[(\d+)\]\.conds\[(\d+)\]$/.exec(where)) && action === '조건 교체') {
      const g = groupsOf(m[1] === 'buy' ? 'buy' : 'sell')[Number(m[2])];
      if (!g || Number(m[3]) >= g.conds.length) throw new Error(`없는 자리: ${where}`);
      g.conds[Number(m[3])] = value as Cond;
    } else if ((m = /^rules\.(buy|sell\.signal\.groups)\[(\d+)\]$/.exec(where)) && action === '조건 추가') {
      const g = groupsOf(m[1] === 'buy' ? 'buy' : 'sell')[Number(m[2])];
      if (!g) throw new Error(`없는 묶음: ${where}`);
      g.conds.push(value as Cond);
    } else if ((m = /^rules\.(buy|sell\.signal\.groups)$/.exec(where)) && action === '새 묶음') {
      groupsOf(m[1] === 'buy' ? 'buy' : 'sell').push({ conds: [value as Cond] });
    } else if ((m = /^rules\.sell\.(takeProfit|stopLoss|trailing|timeExit|signal)$/.exec(where)) && action === '값 바꾸기') {
      const sell = s.rules.sell as unknown as Record<string, Record<string, unknown>>;
      sell[m[1]] = { ...sell[m[1]], ...value };
    } else {
      throw new Error(`알 수 없는 바꿀 곳: ${where} ${action}`);
    }
    return s;
  }

  it('아이디어가 2~4개이고, 각 조건식을 데모 전략에 넣어도 엔진이 고치지 않는다', () => {
    const ideas = md().split(/\n### 아이디어 \d+/).slice(1);
    expect(ideas.length).toBeGreaterThanOrEqual(2);
    expect(ideas.length).toBeLessThanOrEqual(4);
    for (const idea of ideas) {
      const where = /\*\*바꿀 곳:\*\* `([^`]+)` (조건 추가|새 묶음|조건 교체|값 바꾸기)/.exec(idea);
      const fences = [...idea.matchAll(/```json\n(.+)\n```/g)];
      expect(where, idea.slice(0, 80)).not.toBeNull();
      expect(fences.length, idea.slice(0, 80)).toBe(1);
      const s = apply(where![1], where![2], JSON.parse(fences[0][1]));
      expect(repaired(s), `${where![1]} ${fences[0][1]}`).toBe(false);
    }
  });
});
```

- [ ] **Step 2: 실패 확인** — ENOENT로 FAIL.
- [ ] **Step 3: 데모 실행** — 서브에이전트(general-purpose, Sonnet)에게 `SKILL.md`를 Read해 그대로 따르라고 하고, MCP 대신 `examples/demo/*.json`을 각 도구의 결과로 쓰라고 한다(파일 쓰기 금지, 출력은 답으로만). 답을 그대로 `examples/demo-run.md`에 저장한다. 맨 위에 출처 주석을 달지 않는다(첫 줄 검사).
- [ ] **Step 4: 통과 확인** — PASS. 실패하면 SKILL.md의 해당 지시를 고치고(REFACTOR) 데모를 다시 돌린다. 기준선 기록과 비교해 막은 실패를 공유 노트에 적는다.
- [ ] **Step 5: 커밋** — `git commit -m "docs(skill): 데모 입력으로 전략 비판 스킬을 돌린 결과를 넣고 출력 형식을 검사함"`

### Task 5: 사용법·로드맵·검토 문서 갱신

**Files:**
- Modify: `cli/README.md`(「MCP 서버」 절 뒤에 `## 전략 비판 스킬`), `cli/src/readme.test.ts`, `docs/roadmap.md`(최우선 2 「지금」과 「검토만 한 외부 도구」), `docs/proposals/2026-11-02-external-tools.md`(3절 (a)에 「구현됨」과 경로)

- [ ] **Step 1: 실패하는 테스트** — `readme.test.ts`의 `describe('cli/README.md')` 안에:

```ts
  it('전략 비판 스킬 절: 위치·고정 문구 뜻·부르는 도구가 있다', () => {
    for (const s of ['## 전략 비판 스킬', '.claude/skills/strategy-critique', '매매 신호가 아니', '`strategies`', '`simulate`', '`signals`']) expect(readme, s).toContain(s);
  });
```

- [ ] **Step 2: 실패 확인** — `corepack pnpm --filter gazua-cli test -- src/readme.test.ts` → FAIL.
- [ ] **Step 3: 문서 작성** — README 절: 무엇을 하는지, 「참고 의견이며 매매 신호가 아니에요」, 쓰는 법(저장소에서 Claude Code를 열고 MCP 등록 뒤 「‘전략 이름’ 약점 따져 줘」), 부르는 도구 3+1, 쓰지 않는 것(주문·쓰기·파일), 아이디어 검증은 전략 빌더에서 복사해 한 가지씩, 데모(`examples/demo-run.md`)와 데모 재생성 명령 `UPDATE_DEMO=1`. 로드맵 최우선 2 「지금」에 한 줄, 「검토만 한 외부 도구」에 (a) 구현 표시. 검토 문서 3절 (a)에 「2026-11-03 구현됨: …」.
- [ ] **Step 4: 전체 확인** — `corepack pnpm --filter gazua-cli test`와 `corepack pnpm --filter gazua-cli check` → PASS.
- [ ] **Step 5: 커밋** — `git commit -m "docs: 전략 비판 스킬 사용법을 README에 쓰고 로드맵·외부 도구 검토 상태를 갱신함"`
