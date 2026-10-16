// 선정 기준 검증 Worker 진입점. 데이터는 메시지로 받지 않으면 IndexedDB에서 직접 읽어 Worker 메모리에 둔다.
import type { MarketDataFile } from '../marketData/format';
import { openMarketData } from '../marketData/store';
import { errorCode, preview, runValidation, type WorkerRequest, type WorkerResponse } from './runValidation';

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(msg: WorkerResponse): void;
};

// 같은 파일이면 다시 읽지 않는다. 요약(info)은 작아서 매번 확인한다
let cache: { key: string; data: MarketDataFile } | null = null;

async function loadData(): Promise<MarketDataFile | null> {
  const store = openMarketData();
  const info = await store.info();
  if (!info) return null;
  const key = `${info.collectedAt}|${info.stocks}|${info.range.from}|${info.range.to}|${info.bytes ?? ''}`;
  if (cache?.key === key) return cache.data;
  cache = null;
  const data = await store.load();
  if (data) cache = { key, data };
  return data;
}

ctx.onmessage = async (e) => {
  const msg = e.data;
  const id = msg.type === 'preview' ? { id: msg.id } : {};
  try {
    const data = msg.input.data ?? (await loadData());
    if (!data) {
      ctx.postMessage({ type: 'error', code: 'no-data', ...id });
      return;
    }
    const { criteria, strategies } = msg.input;
    if (msg.type === 'preview') {
      ctx.postMessage({ type: 'preview', id: msg.id, selection: preview(data, criteria, strategies) });
      return;
    }
    const r = runValidation({ data, criteria, strategies }, (done, total) => ctx.postMessage({ type: 'progress', done, total }));
    if (!('cancelled' in r)) ctx.postMessage({ type: 'result', result: r });
  } catch (err) {
    const code = errorCode(err);
    if (code === 'crash') console.error('선정 기준 검증 계산 실패', err);
    ctx.postMessage({ type: 'error', code, ...id });
  }
};
