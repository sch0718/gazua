// 보유 화면의 데이터: 계좌 보유, 보유 종목의 전일 종가(오늘 손익용), 코스피·코스닥 등락률.
// 실시간 가격·차트는 비교 화면(Compare)의 컨트롤러가 맡는다.
import type { AccountHolding, MarketDataProvider } from '../../providers/types';
import { kstDate } from '../../time/kst';

export interface IndexMove {
  name: '코스피' | '코스닥';
  pct: number;
  /** 등락률의 거래일(KST `YYYY-MM-DD`). 오늘이 아니면(장 전·쉬는 날) 화면에 날짜를 붙인다 */
  date: string;
}

const DAY_MS = 86_400_000;

export function createHoldingsController(deps: { now: () => number }) {
  let account = $state.raw<AccountHolding[]>([]);
  let accountFailed = $state(false);
  let loading = $state(false);
  let prevClose = $state.raw<Record<string, number>>({});
  let indexes = $state.raw<IndexMove[]>([]);
  let gen = 0;
  let lastProvider: MarketDataProvider | null = null;

  /** 같은 공급자로 다시 부르면(직접 넣은 종목 변경·새로고침·날짜 변경) 새 응답까지 지금 값을 그대로 보여 준다. */
  async function load(provider: MarketDataProvider, manualSymbols: string[]) {
    const id = ++gen;
    loading = true;
    accountFailed = false;
    // 공급자가 바뀌면 이전 계좌의 보유를 새 응답 전까지 보이지 않게 비운다.
    if (provider !== lastProvider) {
      lastProvider = provider;
      account = [];
      prevClose = {};
    }
    let held: AccountHolding[] = [];
    if (provider.account) {
      try {
        held = await provider.account.holdings();
      } catch {
        accountFailed = true;
      }
    }
    if (id !== gen) return;
    account = held;
    loading = false;

    const symbols = [...new Set([...held.map((h) => h.symbol), ...manualSymbols])];
    const today = kstDate(deps.now());
    const from = kstDate(deps.now() - 10 * DAY_MS);
    const venue = provider.capabilities.venues.includes('KRX') ? 'KRX' : provider.capabilities.venues[0];
    const closeBefore = async (symbol: string) => {
      const candles = await provider.getCandles({ symbol, venue, interval: '1d', from, to: today, priority: 2 });
      const before = candles.filter((c) => kstDate(c.t) < today);
      return before.at(-1)?.c ?? null;
    };
    const indexMove = async (idx: 'KOSPI' | 'KOSDAQ', name: IndexMove['name']): Promise<IndexMove | null> => {
      const candles = (await provider.getIndexCandles?.(idx, '1d', from, today, 2)) ?? [];
      if (candles.length < 2) return null;
      const [prev, last] = candles.slice(-2);
      return prev.c > 0 ? { name, pct: (last.c / prev.c - 1) * 100, date: kstDate(last.t) } : null;
    };

    const [prevs, moves] = await Promise.all([
      Promise.allSettled(symbols.map(closeBefore)),
      provider.capabilities.hasIndexCandles
        ? Promise.allSettled([indexMove('KOSPI', '코스피'), indexMove('KOSDAQ', '코스닥')])
        : Promise.resolve([]),
    ]);
    if (id !== gen) return;
    const next: Record<string, number> = {};
    prevs.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value !== null) next[symbols[i]] = r.value;
    });
    prevClose = next;
    indexes = moves.flatMap((m) => (m.status === 'fulfilled' && m.value ? [m.value] : []));
  }

  return {
    get account() {
      return account;
    },
    get accountFailed() {
      return accountFailed;
    },
    get loading() {
      return loading;
    },
    get prevClose() {
      return prevClose;
    },
    get indexes() {
      return indexes;
    },
    load,
    destroy() {
      gen++;
    },
  };
}
