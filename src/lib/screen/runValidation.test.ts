import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MarketDataFile, MarketDataFileV1, MarketDataFileV2, MarketDataFileV3, MarketDataFileV4 } from '../marketData/format';
import { newStrategy } from '../sim/defaults';
import { roundMoney } from '../sim/money';
import { simulate } from '../sim/simulate';
import type { SimResult, Strategy } from '../sim/types';
import { addDays } from '../time/kst';
import { newCriteria } from './defaults';
import { rebalanceDates, tradingAxis } from './precompute';
import { errorCode, preview, runValidation, ValidationError, type ValidationResult } from './runValidation';
import type { Basket } from './baskets';
import { macroKnownFrom } from './macro';
import { NOW } from './testData';
import type { SelectionCriteria } from './types';

vi.mock('../sim/simulate', async (orig) => {
  const m = await orig<typeof import('../sim/simulate')>();
  return { ...m, simulate: vi.fn(m.simulate) };
});

const fixture = JSON.parse(gunzipSync(readFileSync('tests/fixtures/market-data-demo.json.gz')).toString()) as MarketDataFile;
const clone = (): MarketDataFile => structuredClone(fixture);

/** 기본 기준에서 반등 조건만 끈 것: 기간 2025-10-16 ~ 2026-10-15, 매월 */
function crit(patch: (c: SelectionCriteria) => void = () => {}): SelectionCriteria {
  const c = newCriteria(NOW, fixture.range);
  c.conditions.rebound.on = false;
  patch(c);
  return c;
}

function run(c: SelectionCriteria, strategies: Strategy[] = [], data = fixture, baskets: Basket[] = []): ValidationResult {
  const r = runValidation({ data, criteria: c, strategies, baskets });
  if ('cancelled' in r) throw new Error('cancelled');
  return r;
}

const DATES = rebalanceDates(tradingAxis(fixture), { from: '2025-10-16', to: '2026-10-15' }, 'monthly');

afterEach(() => vi.mocked(simulate).mockClear());

describe('runValidation', () => {
  it('결과 모양: 재선정·오늘 선별·①·지수·비교 종목·시장별·해석 메모', () => {
    const r = run(crit());
    expect(r.rebalances.map((s) => s.date)).toEqual(DATES);
    expect(r.axis[0]).toBe(DATES[0]);
    expect(r.axis[r.axis.length - 1]).toBe('2026-10-15');
    const lastDay = tradingAxis(fixture).at(-1)!;
    expect(r.today.date).toBe(addDays(lastDay, 1));
    expect(r.today.picked.length).toBeGreaterThan(0);
    expect(r.hold.equity.map((e) => e.date)).toEqual(r.axis);
    expect(r.hold.segments).toHaveLength(DATES.length);
    expect(Number.isFinite(r.hold.stats.totalPct)).toBe(true);
    expect(r.hold.beat).toEqual({ beat: expect.any(Number), total: DATES.length });
    expect(r.trading).toBeNull();
    expect(r.indices.map((x) => x.id)).toEqual(['KOSPI']);
    expect(r.indices[0].curve).toHaveLength(r.axis.length);
    expect(r.benchmarks).toEqual([
      { symbol: '069500', name: 'KODEX 200', curve: expect.any(Array), stats: expect.any(Object) },
    ]);
    expect(r.benchmarks[0].curve).toHaveLength(r.axis.length);
    expect(r.byMarket.map((x) => x.key)).toEqual(['KOSPI', 'KOSDAQ', 'ETF']);
    expect(r.notes).toEqual(['survivorship', 'snapshot', 'dividend']);
  });

  it('②는 기준의 자본·수수료로 돈다: 전략 100만 원·0%여도 첫 자산 1,000만 원, 첫 매수에 0.015% 수수료', () => {
    const s = newStrategy(NOW, null);
    s.capital = { initial: 1_000_000, perBuyPct: 10 };
    s.costs.feePct = 0;
    s.benchmarks = { index: 'KOSDAQ', symbol: '091160' };
    s.period = { from: '2020-01-01', to: '2020-12-31' };
    const c = crit((c) => (c.trading.strategyId = s.id));
    const r = run(c, [s]);

    const call = vi.mocked(simulate).mock.calls[0][0];
    expect(call.strategy.capital).toEqual({ initial: 10_000_000, perBuyPct: 10 });
    expect(call.strategy.costs.feePct).toBe(0.015);
    expect(call.strategy.period).toEqual(c.period);
    expect(call.strategy.benchmarks).toEqual({ index: 'KOSPI', symbol: null });
    expect(call.strategy.entry).toEqual(s.entry);
    expect(call.days).toEqual(r.axis);
    // 한 번이라도 뽑힌 종목 전부, 창은 뽑힌 구간들
    const picked = new Set(r.rebalances.flatMap((x) => x.picked.map((p) => p.symbol)));
    expect(new Set(call.stocks.map((x) => x.symbol))).toEqual(picked);
    const etf = fixture.stocks.find((x) => x.s === '069500')!;
    const anyStock = call.stocks[0];
    const src = fixture.stocks.find((x) => x.s === anyStock.symbol)!;
    expect(anyStock.market).toBe(src.m);
    expect(anyStock.isEtf).toBe(src.t === 'ETF');
    expect(etf.t).toBe('ETF');
    for (const st of call.stocks) {
      const segs = r.rebalances.flatMap((x, i) => (x.picked.some((p) => p.symbol === st.symbol) ? [i] : []));
      expect(st.buyWindows!.map((w) => w.from)).toEqual(segs.map((i) => DATES[i]));
      for (const [k, i] of segs.entries()) {
        const to = i + 1 < DATES.length ? r.axis[r.axis.indexOf(DATES[i + 1]) - 1] : r.axis[r.axis.length - 1];
        expect(st.buyWindows![k].to).toBe(to);
      }
    }

    const sim = vi.mocked(simulate).mock.results[0].value as SimResult;
    expect(r.trading!.curve[0]).toEqual({ date: r.axis[0], value: 10_000_000 });
    expect(r.trading!.curve).toHaveLength(r.axis.length);
    expect(r.trading!.trades).toBe(sim.trades.length);
    expect(r.trading!.trades).toBeGreaterThan(0);
    const first = sim.trades[0];
    expect(first.kind).toBe('buy');
    expect(first.fee).toBeCloseTo(roundMoney(first.qty * first.price * 0.00015), 3);
    expect(first.fee).toBeGreaterThan(0);
    const counts: Record<string, number> = {};
    for (const k of sim.skipped) counts[k.reason] = (counts[k.reason] ?? 0) + 1;
    expect(r.trading!.skipCounts).toEqual(counts);
    expect(r.trading).not.toHaveProperty('skipped');
  });

  it('지수 곡선은 유한하고 첫 값이 자본 × 첫날 종가 / 첫날 시가', () => {
    const r = run(crit((c) => (c.benchmarks.indices = ['KOSPI', 'KOSDAQ'])));
    expect(r.indices.map((x) => x.id)).toEqual(['KOSPI', 'KOSDAQ']);
    for (const x of r.indices) {
      const idx = fixture.indices.find((i) => i.id === x.id)!;
      const k = idx.d.indexOf(r.axis[0].replaceAll('-', ''));
      expect(x.curve!.every((p) => Number.isFinite(p.value))).toBe(true);
      expect(x.curve![0]).toEqual({ date: r.axis[0], value: (10_000_000 * idx.c[k]) / idx.o[k] });
      expect(x.stats!.totalPct).toBeCloseTo((x.curve!.at(-1)!.value / 10_000_000 - 1) * 100, 9);
    }
  });

  it("반등 패턴이 'strategy'면 그 전략의 entry로 미리 계산한다(반등 일수를 바꾸면 선별이 바뀐다)", () => {
    const s = newStrategy(NOW, null);
    const withPattern = (from: 'strategy' | 'custom', entry: Strategy['entry']) =>
      crit((c) => {
        c.conditions.rebound = {
          on: true,
          withinDays: 10,
          pattern: from === 'strategy' ? { from, strategyId: s.id } : { from, entry },
        };
      });
    const a = run(withPattern('strategy', s.entry), [s]);
    expect(a.rebalances).toEqual(run(withPattern('custom', s.entry)).rebalances);
    expect(a.rebalances.some((x) => x.passed > 0)).toBe(true);

    const s2 = structuredClone(s);
    s2.entry.triggers.reboundDays.value = 1;
    const b = run(withPattern('strategy', s.entry), [s2]);
    expect(b.rebalances).not.toEqual(a.rebalances);
  });

  it('②의 매수·추가 매수는 모두 그 종목의 buyWindows 안에서만 체결된다', () => {
    const s = newStrategy(NOW, null);
    s.scaleIn = { on: true, stepPct: 3, maxAdds: 2 };
    const r = run(crit((c) => (c.trading.strategyId = s.id)), [s]);
    const sim = vi.mocked(simulate).mock.results[0].value as SimResult;
    // 창은 결과의 재선정 이력에서 직접 만든다: 뽑힌 구간 [d, 다음 재선정일 전 거래일]
    const inWindow = (symbol: string, date: string) =>
      r.rebalances.some((sel, i) => {
        const to = i + 1 < DATES.length ? r.axis[r.axis.indexOf(DATES[i + 1]) - 1] : r.axis[r.axis.length - 1];
        return sel.picked.some((p) => p.symbol === symbol) && sel.date <= date && date <= to;
      });
    const buys = sim.trades.filter((t) => t.kind === 'buy' || t.kind === 'add');
    expect(buys.length).toBeGreaterThan(0);
    for (const t of buys) expect({ ...t, inWindow: inWindow(t.symbol, t.date) }).toMatchObject({ inWindow: true });
    // 창 밖 신호가 실제로 있었다(창이 아무것도 막지 않으면 이 검사는 무의미하다)
    expect(sim.skipped.some((k) => k.reason === '선정 기간이 아니에요')).toBe(true);
  });

  it("②에서 평가액이 NaN·Infinity로 실패하면 'invalid-number' 오류", () => {
    const s = newStrategy(NOW, null);
    vi.mocked(simulate).mockImplementationOnce(() => {
      throw new Error('평가액 계산 실패: 2025-11-03');
    });
    let err: unknown;
    try {
      run(crit((c) => (c.trading.strategyId = s.id)), [s]);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect(errorCode(err)).toBe('invalid-number');
  });

  it("반등 패턴의 전략이 지워졌으면 errorCode가 'missing-strategy'", () => {
    const c = crit((c) => (c.conditions.rebound = { on: true, withinDays: 10, pattern: { from: 'strategy', strategyId: 'gone' } }));
    let err: unknown;
    try {
      run(c, [newStrategy(NOW, null)]);
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(errorCode(err)).toBe('missing-strategy');
  });

  it('② 없음이면 trading은 null이고 simulate를 부르지 않는다', () => {
    const r = run(crit((c) => (c.trading.strategyId = null)));
    expect(r.trading).toBeNull();
    expect(simulate).not.toHaveBeenCalled();
  });

  it('② 전략이 지워졌으면 missing-strategy 오류', () => {
    expect(() => run(crit((c) => (c.trading.strategyId = 'gone')))).toThrow(
      expect.objectContaining({ code: 'missing-strategy' }),
    );
  });

  // PR #11 리뷰 W2: 전략 편집 화면이 막는 오류 전략으로는 ②를 돌리지 않는다
  it.each([
    ['매수 신호가 모두 꺼진 전략', (s: Strategy) => Object.values(s.entry.triggers).forEach((t) => (t.on = false))],
    ['익절 단계가 역순인 전략', (s: Strategy) => (s.exit.takeProfit = [{ pct: 10, sellPct: 50 }, { pct: 5, sellPct: 100 }])],
  ])("② %s이면 invalid-strategy 오류이고 simulate를 부르지 않는다", (_name, patch) => {
    const s = { ...newStrategy(NOW, null), id: 's1' };
    patch(s);
    let err: unknown;
    try {
      run(crit((c) => (c.trading.strategyId = 's1')), [s]);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect(errorCode(err)).toBe('invalid-strategy');
    expect((err as Error).message).toBe('매매 규칙 전략에 고칠 곳이 있어요');
    expect(simulate).not.toHaveBeenCalled();
  });

  it('반등 패턴 전략의 매수 신호가 모두 꺼져 있어도 invalid-strategy', () => {
    const s = { ...newStrategy(NOW, null), id: 's1' };
    Object.values(s.entry.triggers).forEach((t) => (t.on = false));
    const c = crit((c) => (c.conditions.rebound = { on: true, withinDays: 10, pattern: { from: 'strategy', strategyId: 's1' } }));
    expect(() => run(c, [s])).toThrow(expect.objectContaining({ code: 'invalid-strategy' }));
  });

  it('시장별 3행: 범위만 바꿔 ①을 돌리고 inPool을 표시한다', () => {
    const r = run(crit());
    expect(r.byMarket.map((x) => [x.key, x.inPool])).toEqual([
      ['KOSPI', true],
      ['KOSDAQ', true],
      ['ETF', false],
    ]);
    for (const x of r.byMarket) {
      expect(Number.isFinite(x.stats.totalPct)).toBe(true);
      expect(x.avgPicked).toBeGreaterThan(0);
    }
    // 평균 선정 수 = 재선정마다 picked 수의 평균(못 산 것도 센다)
    const etfOnly = run(crit((c) => ((c.pool = { ...c.pool, markets: ['KOSPI', 'KOSDAQ'], types: ['ETF'] }))));
    expect(r.byMarket[2].avgPicked).toBeCloseTo(
      etfOnly.rebalances.reduce((a, s) => a + s.picked.length, 0) / etfOnly.rebalances.length,
      12,
    );
    expect(r.byMarket[2].stats).toEqual(etfOnly.hold.stats);
    expect(etfOnly.byMarket.map((x) => x.inPool)).toEqual([false, false, true]);
    const kosdaq = run(crit((c) => (c.pool.markets = ['KOSDAQ'])));
    expect(kosdaq.byMarket.map((x) => x.inPool)).toEqual([false, true, false]);
    // ETF 행은 두 시장의 ETF를 계산하므로 한 시장만 고른 범위와는 다르다
    const kosdaqEtf = run(crit((c) => (c.pool = { ...c.pool, markets: ['KOSDAQ'], types: ['ETF'] })));
    expect(kosdaqEtf.byMarket.map((x) => x.inPool)).toEqual([false, false, false]);
  });

  it("비교 종목이 데이터에 없으면 '받지 못했어요', 기간 일부만 있으면 '기간 일부만 받았어요'", () => {
    const data = clone();
    const k = data.stocks.find((x) => x.s === '091160')!;
    for (const f of ['d', 'o', 'h', 'l', 'c', 'v', 'tv'] as const) (k[f] as unknown[]).splice(-3);
    const r = run(crit((c) => (c.benchmarks.symbols = ['069500', '999999', '091160'])), [], data);
    expect(r.benchmarks.map((b) => [b.symbol, b.name, b.reason, b.curve === null, b.stats === null])).toEqual([
      ['069500', 'KODEX 200', undefined, false, false],
      ['999999', '999999', '받지 못했어요', true, true],
      ['091160', 'KODEX 반도체', '기간 일부만 받았어요', true, true],
    ]);
  });

  it("짧은 기간이면 'no-rebalance' 오류", () => {
    const c = crit((c) => (c.period = { from: '2026-10-17', to: '2026-10-30' }));
    let err: unknown;
    try {
      run(c);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).code).toBe('no-rebalance');
    expect((err as ValidationError).message).toBe('기간 안에 재선정일이 없어요');
  });

  it("곡선에 NaN·Infinity가 생기면 'invalid-number' 오류", () => {
    const data = clone();
    const kospi = data.indices.find((i) => i.id === 'KOSPI')!;
    kospi.o[kospi.d.indexOf(DATES[0].replaceAll('-', ''))] = 0;
    expect(() => run(crit(), [], data)).toThrow(expect.objectContaining({ code: 'invalid-number' }));
  });

  it('isCancelled이면 cancelled를 돌려준다', () => {
    let calls = 0;
    const r = runValidation({ data: fixture, criteria: crit(), strategies: [] }, undefined, () => ++calls > 2);
    expect(r).toEqual({ cancelled: true });
  });

  it('진행 콜백이 재선정일 수만큼 불린다', () => {
    const seen: [number, number][] = [];
    runValidation({ data: fixture, criteria: crit(), strategies: [] }, (d, t) => seen.push([d, t]));
    expect(seen).toEqual(DATES.map((_, i) => [i + 1, DATES.length]));
  });

  it('해석 메모: 구간 12개 미만, 워밍업 1년 미만, 전부 통과 0개', () => {
    const r = run(
      crit((c) => {
        c.rebalance = 'quarterly';
        c.period = { from: '2025-06-02', to: '2026-10-15' };
        c.conditions.tradingValue.minEok = 1e9;
      }),
    );
    expect(r.notes).toEqual(['survivorship', 'snapshot', 'dividend', 'fewSegments', 'warmup', 'allEmpty']);
  });

  it('재선정 전 거래일에 봉이 있는 후보가 평소의 절반 미만이면 sparseAxis', () => {
    // 한 종목에만 토요일 봉을 넣으면 축에 그날이 생기고, 다음 재선정일의 전 거래일이 된다
    const data = clone();
    // 1·2일이 월요일인 재선정일: 직전 토요일은 앞 달이라 재선정일은 그대로이고 그 전 거래일만 토요일이 된다
    const d = DATES.find((x) => new Date(`${x}T00:00:00Z`).getUTCDay() === 1 && Number(x.slice(8)) <= 2)!;
    const sat = addDays(d, -2);
    const st = data.stocks.find((x) => x.s === '100000')!;
    const at = st.d.findIndex((x) => x > sat.replaceAll('-', ''));
    st.d.splice(at, 0, sat.replaceAll('-', ''));
    for (const f of ['o', 'h', 'l', 'c', 'v', 'tv'] as const) st[f].splice(at, 0, st[f][at - 1]);
    const r = run(crit(), [], data);
    expect(r.rebalances.map((x) => x.date)).toEqual(DATES);
    expect(r.notes).toContain('sparseAxis');
    expect(run(crit()).notes).not.toContain('sparseAxis');
  });

  it('preview는 마지막 거래일 다음 날의 선별이고 runValidation의 today와 같다', () => {
    const c = crit();
    expect(preview(fixture, c, [])).toEqual(run(c).today);
  });
});

describe('runValidation: 환율·유가와 테마·내 묶음', () => {
  const v2 = fixture as MarketDataFileV2;
  const basket: Basket = { id: 'b1', name: '묶음', updatedAt: NOW, symbols: ['100000', '200000'] };

  it("테마나 내 묶음을 쓰면 'themeSnapshot' 메모", () => {
    expect(run(crit()).notes).not.toContain('themeSnapshot');
    expect(run(crit((c) => (c.pool.themes = ['001']))).notes).toContain('themeSnapshot');
    expect(run(crit((c) => (c.pool.baskets = ['b1'])), [], fixture, [basket]).notes).toContain('themeSnapshot');
  });

  it('내 묶음을 입력으로 받아 후보 범위에 쓴다(지워진 묶음은 빈 묶음)', () => {
    const c = crit((c) => ((c.pool.baskets = ['b1']), (c.conditions.tradingValue.on = false)));
    const r = run(c, [], fixture, [basket]);
    const picked = new Set(r.rebalances.flatMap((s) => s.picked.map((p) => p.symbol)));
    expect([...picked].sort()).toEqual(['100000', '200000']);
    expect(run(c, [], fixture, []).rebalances.every((s) => s.passed === 0)).toBe(true);
    expect(preview(fixture, c, [], { baskets: [basket] })).toEqual(r.today);
  });

  it("v1 데이터인데 환율·유가 조건이 켜져 있으면 'no-macro' 오류. 꺼져 있으면 그대로 돈다", () => {
    const { macro: _m, themes: _t, ...rest } = structuredClone(v2);
    const v1: MarketDataFileV1 = { ...rest, version: 1, stocks: (fixture as MarketDataFileV4).stocks.map(({ flow, fin, ...s }) => (void flow, void fin, s)) };
    const c = crit((c) => (c.conditions.macro.usdkrw.beta.on = true));
    expect(() => run(c, [], v1)).toThrow(ValidationError);
    expect(() => run(c, [], v1)).toThrow('이 데이터에는 환율·유가가 없어요');
    try {
      run(c, [], v1);
    } catch (e) {
      expect(errorCode(e)).toBe('no-macro');
    }
    expect(run(crit(), [], v1).rebalances.length).toBe(DATES.length);
  });

  it("macro 조건이 켜져 있는데 계열 값이 없거나 흐름을 계산할 수 없는 재선정일이 있으면 'macroGap'", () => {
    const beta = crit((c) => (c.conditions.macro.usdkrw.beta = { on: true, min: 0.3, max: 5 }));
    expect(run(beta).notes).not.toContain('macroGap');
    // 계열이 비어 있다
    const empty = structuredClone(v2);
    empty.macro.usdkrw = { d: [], v: [] };
    const r = run(beta, [], empty);
    expect(r.notes).toContain('macroGap');
    expect(r.rebalances.every((s) => s.passed === 0)).toBe(true);
    // 흐름의 끝값이 음수인 재선정일이 있다
    const trend = crit((c) => (c.conditions.macro.wti.trend = { on: true, lookback: 10, thresholdPct: 1, minAbsBeta: 0, whenFlat: 'pass' }));
    expect(run(trend).notes).not.toContain('macroGap');
    const neg = structuredClone(v2);
    const d = DATES[5];
    const p = tradingAxis(fixture)[tradingAxis(fixture).indexOf(d) - 1];
    // p에서 공개된 마지막 관측값과 그 앞 몇 개를 음수로
    let k = -1;
    neg.macro.wti.d.forEach((o, i) => macroKnownFrom('wti', o) <= p && (k = i));
    for (let i = k - 3; i <= k; i++) neg.macro.wti.v[i] = -10;
    const rn = run(trend, [], neg);
    expect(rn.notes).toContain('macroGap');
    expect(rn.rebalances[5].passed).toBe(0);
  });

  it("정렬이 macroBeta인데 그 계열이 비었으면 'macroGap'", () => {
    const rank = crit((c) => (c.rank = { by: 'macroBeta', take: 5, series: 'wti' }));
    expect(run(rank).notes).not.toContain('macroGap');
    const empty = structuredClone(v2);
    empty.macro.wti = { d: [], v: [] };
    expect(run(rank, [], empty).notes).toContain('macroGap');
    // 다른 계열이 빈 것은 상관없다
    const other = structuredClone(v2);
    other.macro.usdkrw = { d: [], v: [] };
    expect(run(rank, [], other).notes).not.toContain('macroGap');
  });

  it("민감도를 켰는데 계열은 있어도 후보 전체의 β가 없는 재선정일(워밍업)이 있으면 'macroGap'", () => {
    // 봉은 2024-10-16부터라 2025-06 재선정일에는 공개된 쌍이 250개에 못 미친다
    const warm = crit((c) => {
      c.period = { from: '2025-06-02', to: '2026-10-15' };
      c.conditions.tradingValue.on = false;
      c.conditions.macro.betaDays = 250;
      c.conditions.macro.usdkrw.beta = { on: true, min: -20, max: 20 };
    });
    const r = run(warm);
    expect(r.rebalances[0].passed).toBe(0);
    expect(r.rebalances.at(-1)!.passed).toBeGreaterThan(0);
    expect(r.notes).toContain('macroGap');
  });

  it("민감도 순 정렬만 써도 후보 전체의 β가 없는 재선정일(워밍업)이 있으면 'macroGap'", () => {
    const warm = crit((c) => {
      c.period = { from: '2025-06-02', to: '2026-10-15' };
      c.conditions.tradingValue.on = false;
      c.conditions.macro.betaDays = 250;
      c.rank = { by: 'macroBeta', take: 5, series: 'usdkrw' };
    });
    const r = run(warm);
    expect(r.rebalances[0].passed).toBe(0);
    expect(r.rebalances.at(-1)!.passed).toBeGreaterThan(0);
    expect(r.notes).toContain('macroGap');
  });

  it("흐름만 켰어도 흐름이 문턱 이상이면 β가 필요하다: 워밍업 재선정일에 'macroGap'", () => {
    const warm = crit((c) => {
      c.period = { from: '2025-06-02', to: '2026-10-15' };
      c.conditions.tradingValue.on = false;
      c.conditions.macro.betaDays = 250;
      // 민감도는 끄고 흐름만, 문턱을 거의 0으로 해 어느 날이든 강한 흐름이다
      c.conditions.macro.usdkrw.trend = { on: true, lookback: 10, thresholdPct: 0.0001, minAbsBeta: 0, whenFlat: 'pass' };
    });
    const r = run(warm);
    expect(r.rebalances[0].passed).toBe(0);
    expect(r.notes).toContain('macroGap');
  });
});

describe('runValidation: 투자자 수급', () => {
  const foreign = (c: SelectionCriteria) => (c.conditions.flow.amount = { on: true, who: 'foreign', days: 20, minPct: 1, maxPct: 100 });

  it("수급 조건이나 수급 정렬을 쓰면 늘 'flowLag' 메모", () => {
    expect(run(crit()).notes).not.toContain('flowLag');
    expect(run(crit(foreign)).notes).toContain('flowLag');
    expect(run(crit((c) => (c.rank = { by: 'flow', take: 5, flow: { who: 'inst', days: 20 } }))).notes).toContain('flowLag');
    expect(run(crit((c) => (c.conditions.flow.streak = { on: true, who: 'inst', minDays: 3 }))).notes).toContain('flowLag');
  });

  it("후보 전체가 수급 계산 불가인 재선정일이 있으면 'flowGap'(늦게 시작한 종목만 후보)", () => {
    // 같은 묶음 id('pool')에 담긴 종목만 바꿔 후보를 정한다
    const late: Basket[] = [{ id: 'pool', name: '늦은 수급', updatedAt: NOW, symbols: ['113332'] }];
    const full: Basket[] = [{ id: 'pool', name: '외국인', updatedAt: NOW, symbols: ['106666'] }];
    const c = crit((c) => (foreign(c), (c.pool.baskets = ['pool']), (c.conditions.tradingValue.on = false)));
    expect(run(c, [], fixture, late).notes).toContain('flowGap');
    expect(run(c, [], fixture, full).notes).not.toContain('flowGap');
    expect(run(crit((c) => ((c.pool.baskets = ['pool']), (c.conditions.tradingValue.on = false))), [], fixture, late).notes).not.toContain('flowGap');
  });

  it("수급이 없는 데이터(v1·v2, 또는 수급 있는 종목 0)인데 수급을 쓰면 'no-flow' 오류. 쓰지 않으면 그대로 돈다", () => {
    // 데모는 v4라 fin·flow를 지워 v2를 만들고, 수급 있는 종목이 0인 v3도 만든다
    const v4 = fixture as MarketDataFileV4;
    const v2: MarketDataFileV2 = { ...v4, version: 2, stocks: v4.stocks.map(({ flow, fin, ...s }) => (void flow, void fin, s)) };
    const none: MarketDataFileV3 = { ...v4, version: 3, stocks: v2.stocks };
    for (const data of [v2, none] as MarketDataFile[]) {
      for (const c of [crit(foreign), crit((c) => (c.rank = { by: 'flow', take: 5, flow: { who: 'foreign', days: 20 } }))]) {
        let caught: unknown;
        try {
          run(c, [], data);
        } catch (e) {
          caught = e;
        }
        expect(caught).toBeInstanceOf(ValidationError);
        expect(errorCode(caught)).toBe('no-flow');
        expect((caught as Error).message).toBe('이 데이터에는 투자자 매매동향이 없어요');
      }
      expect(run(crit(), [], data).rebalances.length).toBe(DATES.length);
    }
  });

  it('v4 파일의 수급도 v3와 똑같이 쓴다', () => {
    const v3 = fixture as MarketDataFileV3;
    const v4: MarketDataFileV4 = { ...v3, version: 4 };
    const c = crit(foreign);
    expect(run(c, [], v4).rebalances).toEqual(run(c, [], v3).rebalances);
  });
});

describe('runValidation: 재무', () => {
  const per = (c: SelectionCriteria) => (c.conditions.fin.per = { on: true, min: 0, max: 15 });
  const rankFin = (metric: 'per' | 'pbr' | 'roe') => (c: SelectionCriteria) => (c.rank = { by: 'fin', take: 5, fin: { metric } });

  it("재무 조건이나 재무 정렬을 쓰면 늘 'finLag' 메모", () => {
    expect(run(crit()).notes).not.toContain('finLag');
    expect(run(crit(per)).notes).toContain('finLag');
    expect(run(crit(rankFin('roe'))).notes).toContain('finLag');
    expect(run(crit((c) => (c.conditions.fin.profitable.on = true))).notes).toContain('finLag');
  });

  it("PER·PBR 조건이나 PER·PBR 정렬을 쓸 때만 'finShares' 메모", () => {
    expect(run(crit()).notes).not.toContain('finShares');
    expect(run(crit(per)).notes).toContain('finShares');
    expect(run(crit((c) => (c.conditions.fin.pbr = { on: true, min: 0, max: 1.5 }))).notes).toContain('finShares');
    expect(run(crit(rankFin('pbr'))).notes).toContain('finShares');
    expect(run(crit(rankFin('per'))).notes).toContain('finShares');
    expect(run(crit(rankFin('roe'))).notes).not.toContain('finShares');
    expect(run(crit((c) => (c.conditions.fin.roe = { on: true, min: 10 }))).notes).not.toContain('finShares');
  });

  it("후보 전체가 재무 계산 불가인 재선정일이 있으면 'finGap'(재무가 늦게 시작한 종목만 후보)", () => {
    // 같은 묶음 id('pool')에 담긴 종목만 바꿔 후보를 정한다
    const late: Basket[] = [{ id: 'pool', name: '늦은 재무', updatedAt: NOW, symbols: ['103333'] }];
    const value: Basket[] = [{ id: 'pool', name: '저PER', updatedAt: NOW, symbols: ['114443'] }];
    const base = (c: SelectionCriteria) => ((c.pool.baskets = ['pool']), (c.pool.excludeManaged = false), (c.conditions.tradingValue.on = false));
    const c = crit((c) => (base(c), per(c)));
    expect(run(c, [], fixture, late).notes).toContain('finGap');
    expect(run(c, [], fixture, value).notes).not.toContain('finGap');
    expect(run(crit(base), [], fixture, late).notes).not.toContain('finGap');
  });

  it("재무가 없는 데이터(v1~v3, 또는 재무 있는 종목 0)인데 재무를 쓰면 'no-fin' 오류. 쓰지 않으면 그대로 돈다", () => {
    const v4 = fixture as MarketDataFileV4;
    const v3: MarketDataFileV3 = { ...v4, version: 3, stocks: v4.stocks.map(({ fin, ...s }) => (void fin, s)) };
    const none: MarketDataFileV4 = { ...v4, stocks: v3.stocks };
    for (const data of [v3, none] as MarketDataFile[]) {
      for (const c of [crit(per), crit(rankFin('roe'))]) {
        let caught: unknown;
        try {
          run(c, [], data);
        } catch (e) {
          caught = e;
        }
        expect(caught).toBeInstanceOf(ValidationError);
        expect(errorCode(caught)).toBe('no-fin');
        expect((caught as Error).message).toBe('이 데이터에는 재무 정보가 없어요');
      }
      expect(run(crit(), [], data).rebalances.length).toBe(DATES.length);
    }
  });
});
