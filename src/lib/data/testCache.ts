import type { CandleCache } from './candleCache';
import type { Candle } from './metrics';

/** 테스트용 메모리 봉 캐시(IndexedDB 없이). TTL·용량은 보지 않는다. */
export function memoryCache(): CandleCache {
  const m = new Map<string, Candle[]>();
  return {
    get: async (k) => m.get(k),
    put: async (k, v) => {
      m.set(k, v);
    },
    evict: async () => {},
    clear: async () => m.clear(),
    estimateBytes: async () => 0,
  };
}
