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
