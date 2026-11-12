import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasMacroFormat } from '../../src/lib/marketData/format';
import { DATES, mkFile, mkFileV2, mkStock, offCriteria } from '../../src/lib/screen/testData';
import { handle } from '../src/handler';
import { createMarketHandler } from './market';

const origin = 'https://app.example';
const env = { ALLOWED_ORIGINS: origin, PROXY_TOKEN: 'test-token' };
let directory: string;
let market: ReturnType<typeof createMarketHandler>;
const file = () => mkFileV2([mkStock('000001', Array(10).fill(100))], 10, {}, [{ code: 't1', name: '테마', symbols: ['000001'] }]);
function input() {
  const criteria = offCriteria();
  criteria.period = { from: DATES[1], to: DATES[9] };
  return { criteria, strategies: [] };
}
const preview = (id = 7) => ({ type: 'preview', id, input: input() });
function req(path = '/market/meta', body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://proxy.example${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin, 'x-proxy-token': env.PROXY_TOKEN, ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const call = (r: Request, settings = env) => handle(r, settings, fetch, { market });
async function write(name = 'market-data-20261112.json.gz', data = file()) {
  await fs.writeFile(join(directory, name), gzipSync(JSON.stringify(data)));
  return join(directory, name);
}
async function error(r: Response, status: number, code: string) {
  expect(r.status).toBe(status);
  expect(await r.json()).toEqual({ error: { code } });
}
beforeEach(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), 'gazua-market-'));
  market = createMarketHandler({ directory });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(directory, { recursive: true, force: true });
});

describe('시장 경로', () => {
  it('토큰과 출처를 확인하고 사전 요청에는 같은 CORS 규칙을 쓴다', async () => {
    await error(await call(req('/market/meta', undefined, { 'x-proxy-token': 'wrong' })), 401, 'proxy-token-invalid');
    await error(await call(req('/market/meta', undefined, { origin: 'https://other.example' })), 403, 'origin-not-allowed');
    const preflight = await call(new Request('http://proxy.example/market/screen', { method: 'OPTIONS', headers: { origin } }));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-headers')).toContain('x-proxy-token');
    for (const path of ['/market/meta', '/market/screen']) {
      await error(await call(req(path), { ALLOWED_ORIGINS: origin, PROXY_TOKEN: '' }), 404, 'market-unavailable');
    }
  });
  it('없는 파일과 깨진 파일을 구분한다', async () => {
    await error(await call(req()), 404, 'market-file-missing');
    await fs.writeFile(join(directory, 'market-data-20261112.json.gz'), '깨진 파일');
    const read = vi.spyOn(fs, 'readFile');
    await error(await call(req()), 503, 'market-file-invalid');
    await error(await call(req()), 503, 'market-file-invalid');
    expect(read).toHaveBeenCalledTimes(1);
    await write();
    expect((await call(req())).status).toBe(200);
  });
  it('JSON이나 시장 형식이 잘못된 파일도 거절한다', async () => {
    const path = join(directory, 'market-data-20261112.json.gz');
    await fs.writeFile(path, gzipSync('{'));
    await error(await call(req()), 503, 'market-file-invalid');
    await fs.writeFile(path, gzipSync(JSON.stringify({ format: '다름' })));
    await error(await call(req()), 503, 'market-file-invalid');
  });
  it('가장 새 이름의 요약과 목록만 반환하고 읽기를 함께 쓴다', async () => {
    const older = file();
    older.collectedAt = '2026-11-11T00:00:00+09:00';
    await write('market-data-20261111.json.gz', older);
    await fs.writeFile(join(directory, '다른-파일.json.gz'), '무시');
    const data = file();
    data.sectors = [{ code: '00013', name: '업종', level: 1 }];
    await write(undefined, data);
    const read = vi.spyOn(fs, 'readFile');
    const [a, b] = await Promise.all([call(req()), call(req())]);
    const meta = await a.json();
    expect(meta).toEqual({
      info: { collectedAt: data.collectedAt, stocks: 1, range: data.range, version: 2, hasMacro: false, themeCount: 1, hasFlow: false, flowStocks: 0, hasFin: false, finStocks: 0, file: 'market-data-20261112.json.gz', importId: expect.any(String) },
      sectors: data.sectors, themes: hasMacroFormat(data) ? data.themes : [],
    });
    expect(await b.json()).toEqual(meta);
    expect(read).toHaveBeenCalledTimes(1);
    expect(a.headers.get('access-control-allow-origin')).toBe(origin);
  });
  it('gzip을 협상하고 알 수 없는 경로와 잘못된 메서드를 거절한다', async () => {
    await write();
    const r = await call(req('/market/meta', undefined, { 'accept-encoding': 'gzip' }));
    expect(r.headers.get('content-encoding')).toBe('gzip');
    expect(r.headers.get('vary')).toContain('Accept-Encoding');
    expect(JSON.parse(gunzipSync(Buffer.from(await r.arrayBuffer())).toString()).info.stocks).toBe(1);
    expect((await call(req('/market/meta', undefined, { 'accept-encoding': 'gzip;q=0' }))).headers.get('content-encoding')).toBeNull();
    await error(await call(req('/market/unknown')), 404, 'market-not-found');
    await error(await call(req('/market/meta', {})), 405, 'method-not-allowed');
    await error(await call(req('/market/screen')), 405, 'method-not-allowed');
    await error(await call(req('/market/screen', {})), 400, 'bad-request');
  });
  it('빈 캐시의 미리 보기와 실행을 직렬 처리해 응답을 섞지 않고 input.data는 버린다', async () => {
    await write();
    const p = preview();
    const [a, b] = await Promise.all([
      call(req('/market/screen', { ...p, input: { ...p.input, data: mkFile([], 10) } })),
      call(req('/market/screen', { type: 'run', input: input() })),
    ]);
    expect(await a.json()).toMatchObject({ type: 'preview', id: 7, selection: { picked: [{ symbol: '000001' }] } });
    expect(await b.json()).toMatchObject({ type: 'result', result: { today: { picked: [{ symbol: '000001' }] } } });
  });
  it('크기·요약이 같아도 mtime이 바뀌면 데이터와 미리 계산을 버린다', async () => {
    const data = file();
    const path = await write(undefined, data);
    const oldStat = await fs.stat(path);
    const p = preview();
    p.input.criteria.conditions.marketCap = { on: true, minEok: 0.000005 };
    const first = await call(req('/market/screen', p));
    expect(await first.json()).toMatchObject({ type: 'preview', selection: { passed: 0 } });
    // 1 → 9는 숫자 자릿수와 gzip 크기를 유지한다. 요약은 같다.
    data.stocks[0].shares = 9;
    await write(undefined, data);
    expect((await fs.stat(path)).size).toBe(oldStat.size);
    await fs.utimes(path, new Date(), new Date(oldStat.mtimeMs + 10_000));
    const second = await call(req('/market/screen', p));
    expect(await second.json()).toMatchObject({ type: 'preview', selection: { passed: 1 } });
    data.stocks.push(mkStock('000002', Array(10).fill(100)));
    await write(undefined, data);
    expect(await (await call(req())).json()).toMatchObject({ info: { stocks: 2 } });
  });
});
