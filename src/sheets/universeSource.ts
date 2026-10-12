// 종목 목록(universe.json)은 앱 세션마다 한 번만 받는다. 실패하면 다음 호출에서 다시 받는다.
import { loadUniverse, type UniverseItem } from '../lib/data/universe';

export function createUniverseSource(load: () => Promise<UniverseItem[]>): () => Promise<UniverseItem[]> {
  let cached: Promise<UniverseItem[]> | null = null;
  return () => {
    if (cached) return cached;
    const p = load();
    cached = p;
    p.catch(() => {
      if (cached === p) cached = null;
    });
    return p;
  };
}

/** 앱 전체가 함께 쓰는 종목 목록 */
export const sharedUniverse = createUniverseSource(() => loadUniverse());
