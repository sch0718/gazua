// 내 성과 불러오기(스펙 4.1·4.2): 주문 → 보유 수량 → 시세. 계산은 화면이 고른 벤치마크·기간으로 바로 한다.
// 결과는 이 컨트롤러 메모리에만 둔다(주문은 앱의 주문 캐시가 따로 기억한다).
import type { Candle } from '../../data/metrics';
import { benchIdsFor, benchShell } from '../../perf/compose';
import { normalizeOrders } from '../../perf/ledger';
import { splitFactors } from '../../perf/portfolio';
import { createMemoryOrderCache, orderCacheKey, syncOrders, type OrderCache } from '../../perf/orderCache';
import { reconcile, type Reconciliation } from '../../perf/reconcile';
import type { BenchChoice, BenchSeries, StockSeries, Trade } from '../../perf/types';
import type { AccountHolding, MarketDataProvider, StockMeta } from '../../providers/types';
import { kstDate } from '../../time/kst';

export interface PerfData {
  demo: boolean;
  trades: Trade[];
  /** 해외(KRW가 아닌) 주문 수 */
  foreign: number;
  metas: Map<string, StockMeta>;
  /** 종목 → 이름(메타, 보유, 코드 순) */
  names: Map<string, string>;
  /** 시세를 받은 종목만 */
  stocks: Map<string, StockSeries>;
  /** 받은 벤치마크 시리즈(id → 시리즈) */
  series: Map<string, BenchSeries>;
  /** 받지 못한 벤치마크 id */
  failedBench: string[];
  holdings: AccountHolding[] | null;
  reconcile: Reconciliation;
  syncedAt: number;
  /** 지금 받는 중인 벤치마크 id(없으면 null) */
  pendingBench: string | null;
}

export type PerfState =
  | { kind: 'idle' }
  | { kind: 'unsupported' }
  | { kind: 'loading'; stage: 'orders'; rows: number }
  | { kind: 'loading'; stage: 'prices'; done: number; total: number }
  | { kind: 'error'; error: unknown }
  | { kind: 'empty'; foreign: number }
  | { kind: 'done'; data: PerfData };

export interface PerfController {
  readonly state: PerfState;
  /** full이면 캐시를 버리고 주문을 처음부터 받는다 */
  load(choice: BenchChoice, opts?: { full?: boolean }): void;
  /** 고른 벤치마크의 시리즈가 없으면 받는다 */
  useBench(choice: BenchChoice): void;
  cancel(): void;
}

export interface PerfApp {
  readonly provider: MarketDataProvider;
  readonly orderCache: OrderCache;
  readonly profileId: string;
}

const PRIORITY = 2;

/** 시·고·저·종가가 모두 유한한 양수인 봉만 쓴다(loadSimData와 같은 규칙) */
const validBar = (c: Candle) => [c.o, c.h, c.l, c.c].every((p) => Number.isFinite(p) && p > 0);

class Cancelled extends Error {}

export function createPerfController(app: PerfApp, opts: { now?: () => number } = {}): PerfController {
  const now = opts.now ?? Date.now;
  let state = $state.raw<PerfState>({ kind: 'idle' });
  let runId = 0;
  // 화면을 다시 열기 전까지 받는 중이던 벤치마크(같은 시리즈를 두 번 받지 않게)
  let benchRun = 0;

  function venueOf(p: MarketDataProvider) {
    const v = p.capabilities.venues;
    return v.length === 0 || v.includes('KRX') ? 'KRX' : v[0];
  }

  async function fetchBench(p: MarketDataProvider, id: string, from: string, to: string): Promise<BenchSeries | null> {
    const shell = benchShell(id);
    try {
      const candles =
        shell.kind === 'index'
          ? p.getIndexCandles
            ? await p.getIndexCandles(id as 'KOSPI' | 'KOSDAQ', '1d', from, to, PRIORITY)
            : []
          : await p.getCandles({ symbol: id, venue: venueOf(p), interval: '1d', from, to, priority: PRIORITY });
      const valid = candles.filter(validBar);
      return valid.length > 0 ? { ...shell, candles: valid } : null;
    } catch {
      return null;
    }
  }

  async function run(id: number, choice: BenchChoice, full: boolean): Promise<void> {
    const provider = app.provider;
    const account = provider.account;
    if (!account) {
      state = { kind: 'unsupported' };
      return;
    }
    const alive = () => {
      if (id !== runId) throw new Cancelled();
    };
    const demo = provider.id === 'demo';
    try {
      state = { kind: 'loading', stage: 'orders', rows: 0 };
      const accountId = await account.accountId();
      alive();
      const synced = await syncOrders({
        source: account,
        // 데모 계좌는 저장하지 않는다
        cache: demo ? createMemoryOrderCache() : app.orderCache,
        key: orderCacheKey(app.profileId, provider.id, accountId),
        now: now(),
        full,
        onPage: (rows) => {
          if (id === runId) state = { kind: 'loading', stage: 'orders', rows };
        },
        // 받는 사이 화면을 떠났으면(취소) 계좌 내역을 저장하지 않는다
        persist: () => id === runId,
      });
      alive();
      const { trades, foreign } = normalizeOrders(synced.orders);
      if (trades.length === 0) {
        state = { kind: 'empty', foreign };
        return;
      }
      let holdings: AccountHolding[] | null = null;
      try {
        holdings = await account.holdings();
      } catch {
        holdings = null;
      }
      alive();

      const symbols = [...new Set(trades.map((t) => t.symbol))];
      const benchIds = benchIdsFor(choice);
      const total = 1 + symbols.length + benchIds.length;
      let done = 0;
      const step = () => {
        done++;
        if (id === runId) state = { kind: 'loading', stage: 'prices', done, total };
      };
      state = { kind: 'loading', stage: 'prices', done, total };
      const metas = new Map((await provider.getStockMeta(symbols)).map((m) => [m.symbol, m]));
      alive();
      step();

      const from = trades[0].date;
      const to = kstDate(now());
      const venue = venueOf(provider);
      const stocks = new Map<string, StockSeries>();
      const names = new Map<string, string>();
      const heldName = new Map((holdings ?? []).map((h) => [h.symbol, h.name]));
      for (const symbol of symbols) {
        const name = metas.get(symbol)?.name ?? heldName.get(symbol) ?? symbol;
        names.set(symbol, name);
        try {
          const candles = (await provider.getCandles({ symbol, venue, interval: '1d', from, to, priority: PRIORITY })).filter(validBar);
          if (candles.length > 0) stocks.set(symbol, { name, candles });
        } catch (e) {
          if (e instanceof Cancelled) throw e;
        }
        alive();
        step();
      }

      const series = new Map<string, BenchSeries>();
      const failedBench: string[] = [];
      for (const b of benchIds) {
        const s = await fetchBench(provider, b, from, to);
        alive();
        if (s) series.set(b, s);
        else failedBench.push(b);
        step();
      }

      state = {
        kind: 'done',
        data: {
          demo,
          trades,
          foreign,
          metas,
          names,
          stocks,
          series,
          failedBench,
          holdings,
          reconcile: reconcile(trades, holdings, splitFactors(trades, stocks)),
          syncedAt: synced.syncedAt,
          pendingBench: null,
        },
      };
    } catch (e) {
      if (e instanceof Cancelled) return;
      if (id === runId) state = { kind: 'error', error: e };
    }
  }

  return {
    get state() {
      return state;
    },
    load(choice, o = {}) {
      const id = ++runId;
      benchRun++;
      void run(id, choice, o.full ?? false);
    },
    useBench(choice) {
      const s = state;
      if (s.kind !== 'done') return;
      const missing = benchIdsFor(choice).filter((b) => !s.data.series.has(b) && !s.data.failedBench.includes(b));
      if (missing.length === 0 || s.data.pendingBench !== null) return;
      const id = runId;
      const my = ++benchRun;
      const provider = app.provider;
      const from = s.data.trades[0].date;
      const to = kstDate(now());
      state = { kind: 'done', data: { ...s.data, pendingBench: missing[0] } };
      void (async () => {
        const got = await Promise.all(missing.map((b) => fetchBench(provider, b, from, to)));
        const cur = state;
        if (id !== runId || my !== benchRun || cur.kind !== 'done') return;
        const series = new Map(cur.data.series);
        const failedBench = [...cur.data.failedBench];
        missing.forEach((b, i) => {
          const g = got[i];
          if (g) series.set(b, g);
          else failedBench.push(b);
        });
        state = { kind: 'done', data: { ...cur.data, series, failedBench, pendingBench: null } };
      })();
    },
    cancel() {
      runId++;
      benchRun++;
      state = { kind: 'idle' };
    },
  };
}
