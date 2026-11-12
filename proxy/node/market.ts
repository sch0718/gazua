// Node 전용 시장 파일 저장소와 경로. 계산기는 웹 Worker와 같은 순수 함수를 쓴다.
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { hasFlowFormat, hasMacroFormat, isV4, validateMarketData, type MarketDataFile } from '../../src/lib/marketData/format';
import type { MarketDataInfo } from '../../src/lib/marketData/store';
import type { WorkerRequest, WorkerResponse } from '../../src/lib/screen/runValidation';
import { createWorkerHandler } from '../../src/lib/screen/workerHandler';
import type { MarketHandler } from '../src/handler';

class MarketFileError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
interface Entry {
  data: MarketDataFile;
  info: MarketDataInfo & { file: string };
}

export function createMarketHandler({ directory = join(homedir(), 'gazua-data') }: { directory?: string } = {}): MarketHandler {
  const dir = directory.startsWith('~') ? join(homedir(), directory.slice(1)) : directory;
  let cache: { key: string; value: Promise<Entry> } | null = null;
  async function latest(): Promise<Entry> {
    let names: string[];
    try { names = await fs.readdir(dir); }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new MarketFileError(404, 'market-file-missing');
      throw new MarketFileError(503, 'market-file-invalid');
    }
    const file = names.filter((n) => /^market-data-\d{8}\.json\.gz$/.test(n)).sort().at(-1);
    if (!file) throw new MarketFileError(404, 'market-file-missing');
    let stat;
    try { stat = await fs.stat(join(dir, file)); }
    catch (err) {
      throw new MarketFileError((err as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 503,
        (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'market-file-missing' : 'market-file-invalid');
    }
    const key = `${file}|${stat.mtimeMs}|${stat.size}`;
    if (cache?.key !== key) {
      // 실패도 같은 키로 기억해 파일이 바뀔 때까지 다시 풀지 않는다.
      const value = fs.readFile(join(dir, file)).then((raw): Entry => {
        const check = validateMarketData(JSON.parse(gunzipSync(raw).toString('utf8')));
        if (!check.ok) throw new Error('시장 파일 형식이 맞지 않는다');
        const data = check.data;
        const v2 = hasMacroFormat(data);
        const flowStocks = hasFlowFormat(data) ? data.stocks.filter((s) => s.flow !== undefined).length : 0;
        const finStocks = isV4(data) ? data.stocks.filter((s) => s.fin !== undefined).length : 0;
        return { data, info: {
          file, importId: key, collectedAt: data.collectedAt, stocks: data.stocks.length, range: data.range,
          version: data.version, hasMacro: v2 && (data.macro.usdkrw.d.length > 0 || data.macro.wti.d.length > 0),
          themeCount: v2 ? data.themes.length : 0, hasFlow: flowStocks > 0, flowStocks, hasFin: finStocks > 0, finStocks,
        } };
      }).catch(() => { throw new MarketFileError(503, 'market-file-invalid'); });
      cache = { key, value };
    }
    return cache.value;
  }

  // run에는 요청 id가 없다. 한 계산기가 낸 메시지는 현재 요청 한 곳에만 보낸다.
  let receive: ((msg: WorkerResponse) => void) | null = null;
  let active: Entry | null = null;
  const worker = createWorkerHandler({
    store: { info: async () => active?.info ?? null, load: async () => active?.data ?? null },
    post: (msg) => receive?.(msg),
  });
  let queue = Promise.resolve();
  function screen(msg: WorkerRequest): Promise<WorkerResponse> {
    const result = queue.then(async () => {
      active = await latest();
      let last: WorkerResponse = { type: 'error', code: 'crash' };
      receive = (m) => { if (m.type !== 'progress') last = m; };
      try { await worker(msg); return last; }
      finally { receive = null; active = null; }
    });
    queue = result.then(() => {}, () => {});
    return result;
  }

  return async (req) => {
    const headers = new Headers({ 'content-type': 'application/json', vary: 'Accept-Encoding' });
    const gzip = (req.headers.get('accept-encoding') ?? '').split(',').some((part) => {
      const [name, ...params] = part.trim().toLowerCase().split(';');
      return name === 'gzip' && !params.some((p) => /^\s*q\s*=\s*0(?:\.0*)?\s*$/.test(p));
    });
    function json(body: unknown, status = 200): Response {
      const text = JSON.stringify(body);
      if (gzip) {
        headers.set('content-encoding', 'gzip');
        return new Response(new Uint8Array(gzipSync(text)).buffer, { status, headers });
      }
      return new Response(text, { status, headers });
    }
    const fail = (status: number, code: string) => json({ error: { code } }, status);
    const path = new URL(req.url).pathname;
    if (path !== '/market/meta' && path !== '/market/screen') return fail(404, 'market-not-found');
    if (req.method !== (path === '/market/meta' ? 'GET' : 'POST')) return fail(405, 'method-not-allowed');
    try {
      if (path === '/market/meta') {
        const { data, info } = await latest();
        return json({ info, sectors: data.sectors, themes: hasMacroFormat(data) ? data.themes : [] });
      }
      let msg: WorkerRequest;
      try {
        const body = await req.json();
        if (!body || (body.type !== 'preview' && body.type !== 'run') || !body.input ||
          !body.input.criteria || !Array.isArray(body.input.strategies) ||
          (body.type === 'preview' && !Number.isFinite(body.id))) return fail(400, 'bad-request');
        // 요청에 담긴 시장 데이터는 버리고 이 맥의 파일로 계산한다.
        const { data: _ignored, ...input } = body.input;
        msg = body.type === 'preview' ? { type: 'preview', id: body.id, input } : { type: 'run', input };
      } catch { return fail(400, 'bad-request'); }
      return json(await screen(msg));
    } catch (err) {
      if (err instanceof MarketFileError) return fail(err.status, err.code);
      return fail(503, 'market-file-invalid');
    }
  };
}
