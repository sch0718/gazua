// 선정 기준 검증 Worker 진입점. 데이터는 메시지로 받지 않으면 IndexedDB에서 직접 읽어 Worker 메모리에 둔다.
import { openMarketData } from '../marketData/store';
import type { WorkerRequest, WorkerResponse } from './runValidation';
import { createWorkerHandler } from './workerHandler';

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(msg: WorkerResponse): void;
};

const handle = createWorkerHandler({ store: openMarketData(), post: (m) => ctx.postMessage(m) });
ctx.onmessage = (e) => void handle(e.data);
