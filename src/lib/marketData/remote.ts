import type { WorkerRequest, WorkerResponse } from '../screen/runValidation';
import type { WorkerLike } from '../screen/validationController.svelte';
import type { MarketDataInfo, MarketSector } from './store';

export interface RemoteMarketMeta {
  info: MarketDataInfo & { file?: string };
  sectors: MarketSector[];
  themes: { code: string; name: string; symbols: string[] }[];
}
export interface RemoteMarketData {
  meta(): Promise<RemoteMarketMeta>;
  screen(msg: WorkerRequest, signal?: AbortSignal): Promise<WorkerResponse>;
}

export function createRemoteMarketData({ baseUrl, token, fetchImpl = fetch }: { baseUrl: string; token?: string; fetchImpl?: typeof fetch }): RemoteMarketData {
  const base = baseUrl.replace(/\/+$/, '');
  const headers = { ...(token ? { 'x-proxy-token': token } : {}) };
  let cached: RemoteMarketMeta | undefined;
  let expires = 0;
  let pending: Promise<RemoteMarketMeta> | undefined;
  async function request(path: string, init: RequestInit): Promise<unknown> {
    const res = await fetchImpl(`${base}/market/${path}`, { ...init, redirect: 'manual', headers: { ...headers, ...init.headers } });
    if (!res.ok) throw new Error('맥 데이터에 닿지 않아요');
    return res.json();
  }
  return {
    meta() {
      if (cached && Date.now() < expires) return Promise.resolve(cached);
      if (!pending) pending = request('meta', {}).then((value) => {
        cached = value as RemoteMarketMeta;
        expires = Date.now() + 10 * 60_000;
        return cached;
      }).finally(() => { pending = undefined; });
      return pending;
    },
    async screen(msg, signal) {
      const ctl = new AbortController();
      const abort = () => ctl.abort();
      if (signal?.aborted) ctl.abort();
      else signal?.addEventListener('abort', abort, { once: true });
      // Cloudflare Tunnel은 원 서버 응답을 약 100초까지만 기다린다. 그보다 먼저 끊어 「닿지 않아요」로 보인다
      const timer = setTimeout(abort, 90_000);
      try {
        // 전 종목 파일은 전송하지 않는다. 계산기는 맥의 파일을 읽는다.
        const { data: _data, ...input } = msg.input;
        const response = await request('screen', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...msg, input }), signal: ctl.signal }) as WorkerResponse;
        if (!response || !['preview', 'result', 'error'].includes(response.type)) throw new Error('맥 데이터에 닿지 않아요');
        return response;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      }
    },
  };
}

export function makeRemoteWorker(remote: RemoteMarketData): WorkerLike {
  const active = new Set<AbortController>();
  let terminated = false;
  const worker: WorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage(msg) {
      if (terminated) return;
      const ctl = new AbortController(); active.add(ctl);
      void remote.screen(msg, ctl.signal).then(
        (data) => { if (!terminated) worker.onmessage?.({ data }); },
        () => { if (!terminated) worker.onmessage?.({ data: { type: 'error', code: 'remote', ...('id' in msg ? { id: msg.id } : {}) } }); },
      ).finally(() => active.delete(ctl));
    },
    terminate() {
      terminated = true;
      for (const ctl of active) ctl.abort();
      active.clear();
    },
  };
  return worker;
}
