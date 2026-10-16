// 검증 Worker의 메시지 처리. worker.ts가 self에 연결하고, 테스트는 가짜 저장소로 직접 부른다.
import type { MarketDataFile } from '../marketData/format';
import type { MarketDataStore } from '../marketData/store';
import { precompute, precomputeParams, stableJson, type Precomputed } from './precompute';
import { errorCode, preview, runValidation, type PrecomputeFn, type WorkerRequest, type WorkerResponse } from './runValidation';

export interface WorkerHandlerDeps {
  store: Pick<MarketDataStore, 'info' | 'load'>;
  post: (msg: WorkerResponse) => void;
}

export function createWorkerHandler({ store, post }: WorkerHandlerDeps): (msg: WorkerRequest) => Promise<void> {
  // 같은 파일이면 다시 읽지 않는다. 요약(info)은 작아서 매번 확인한다. 읽는 중에 온 메시지는 같은 읽기를 기다린다
  let cache: { key: string; data: Promise<MarketDataFile | null> } | null = null;
  // 마지막 미리 계산. 같은 파일·같은 기준 값(precomputeParams)이면 미리 보기와 실행이 함께 쓴다
  let preCache: { key: string; pre: Precomputed } | null = null;

  async function loadData(): Promise<{ key: string; data: MarketDataFile } | null> {
    const info = await store.info();
    if (!info) return null;
    const key = `${info.collectedAt}|${info.stocks}|${info.range.from}|${info.range.to}|${info.bytes ?? ''}`;
    if (cache?.key !== key) {
      const entry = { key, data: store.load() };
      cache = entry;
      entry.data.then(
        (d) => !d && cache === entry && (cache = null),
        () => cache === entry && (cache = null),
      );
    }
    const data = await cache.data;
    return data ? { key, data } : null;
  }

  // 저장소에서 읽은 파일에만 쓴다(메시지로 온 파일은 매번 다를 수 있다)
  const cachedPrecompute =
    (dataKey: string): PrecomputeFn =>
    (data, criteria, entry) => {
      const key = `${dataKey}|${stableJson(precomputeParams(criteria, entry))}`;
      if (preCache?.key === key) return preCache.pre;
      const pre = precompute(data, criteria, entry);
      preCache = { key, pre };
      return pre;
    };

  return async (msg) => {
    const id = msg.type === 'preview' ? { id: msg.id } : {};
    try {
      const loaded = msg.input.data ? { key: null, data: msg.input.data } : await loadData();
      if (!loaded) {
        post({ type: 'error', code: 'no-data', ...id });
        return;
      }
      const { data } = loaded;
      const opts = loaded.key !== null ? { precompute: cachedPrecompute(loaded.key) } : {};
      const { criteria, strategies, baskets = [] } = msg.input;
      if (msg.type === 'preview') {
        post({ type: 'preview', id: msg.id, selection: preview(data, criteria, strategies, { ...opts, baskets }) });
        return;
      }
      const r = runValidation({ data, criteria, strategies, baskets }, (done, total) => post({ type: 'progress', done, total }), undefined, opts);
      if (!('cancelled' in r)) post({ type: 'result', result: r });
    } catch (err) {
      const code = errorCode(err);
      if (code === 'crash') console.error('선정 기준 검증 계산 실패', err);
      post({ type: 'error', code, ...id });
    }
  };
}
