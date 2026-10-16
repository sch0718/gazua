// 선정 기준 검증 실행(스펙 7.4): Worker에 맡기고 진행·결과만 받는다. 취소는 Worker 종료다.
import type { Selection } from './select';
import type { ValidationResult, WorkerErrorCode, WorkerInput, WorkerRequest, WorkerResponse } from './runValidation';

/** Worker에서 컨트롤러가 쓰는 부분. 테스트는 같은 스레드에서 도는 가짜를 넣는다 */
export interface WorkerLike {
  postMessage(msg: WorkerRequest): void;
  terminate(): void;
  onmessage: ((e: { data: WorkerResponse }) => void) | null;
  onerror: ((e: unknown) => void) | null;
}

export type ValidationState = 'idle' | 'running' | 'done' | 'error';

export interface ValidationController {
  readonly state: ValidationState;
  readonly progress: { done: number; total: number };
  readonly result: ValidationResult | null;
  readonly error: WorkerErrorCode | null;
  /** data를 빼면 Worker가 IndexedDB에서 직접 읽는다(수십 MB를 메인 스레드에서 복사하지 않게) */
  run(input: WorkerInput): void;
  cancel(): void;
  preview(input: WorkerInput): Promise<Selection>;
}

export class PreviewError extends Error {
  constructor(readonly code: WorkerErrorCode | 'cancelled') {
    super(code);
    this.name = 'PreviewError';
  }
}

export const makeValidationWorker = (): WorkerLike =>
  new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;

export function createValidationController(opts: { makeWorker?: () => WorkerLike } = {}): ValidationController {
  const makeWorker = opts.makeWorker ?? makeValidationWorker;
  let state = $state<ValidationState>('idle');
  let progress = $state.raw({ done: 0, total: 0 });
  let result = $state.raw<ValidationResult | null>(null);
  let error = $state<WorkerErrorCode | null>(null);
  let worker: WorkerLike | null = null;
  let previewSeq = 0;
  const pending = new Map<number, { resolve: (s: Selection) => void; reject: (e: PreviewError) => void }>();

  function stop(code: 'cancelled' | 'crash' = 'cancelled') {
    worker?.terminate();
    worker = null;
    for (const p of pending.values()) p.reject(new PreviewError(code));
    pending.clear();
  }

  function onMessage(msg: WorkerResponse) {
    if (msg.type === 'preview') {
      pending.get(msg.id)?.resolve(msg.selection);
      pending.delete(msg.id);
      return;
    }
    if (msg.type === 'error' && msg.id !== undefined) {
      pending.get(msg.id)?.reject(new PreviewError(msg.code));
      pending.delete(msg.id);
      return;
    }
    if (state !== 'running') return;
    if (msg.type === 'progress') progress = { done: msg.done, total: msg.total };
    else if (msg.type === 'result') {
      result = msg.result;
      state = 'done';
    } else {
      error = msg.code;
      state = 'error';
    }
  }

  function ensure(): WorkerLike {
    if (worker) return worker;
    const w = makeWorker();
    w.onmessage = (e) => {
      if (w === worker) onMessage(e.data);
    };
    w.onerror = () => {
      if (w !== worker) return;
      stop('crash');
      if (state === 'running') {
        error = 'crash';
        state = 'error';
      }
    };
    worker = w;
    return w;
  }

  // Svelte 프록시는 구조화 복제가 안 되므로 평범한 값으로 넘긴다
  const plain = (input: WorkerInput): WorkerInput => $state.snapshot(input) as WorkerInput;

  return {
    get state() {
      return state;
    },
    get progress() {
      return progress;
    },
    get result() {
      return result;
    },
    get error() {
      return error;
    },
    run(input) {
      if (state === 'running') stop(); // 앞 실행은 버린다
      progress = { done: 0, total: 0 };
      result = null;
      error = null;
      state = 'running';
      ensure().postMessage({ type: 'run', input: plain(input) });
    },
    cancel() {
      stop();
      progress = { done: 0, total: 0 };
      result = null;
      error = null;
      state = 'idle';
    },
    preview(input) {
      const id = ++previewSeq;
      return new Promise<Selection>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ensure().postMessage({ type: 'preview', id, input: plain(input) });
      });
    },
  };
}
