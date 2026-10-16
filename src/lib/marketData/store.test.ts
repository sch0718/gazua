import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateMarketData } from './format';
import { openMarketData } from './store';

const gz = readFileSync('tests/fixtures/market-data-demo.json.gz');
const file = () => new Blob([gz]);
// jsdom에는 DecompressionStream이 없어 node zlib로 대신 푼다
const decompress = async (b: Blob) => gunzipSync(Buffer.from(await b.arrayBuffer())).toString('utf8');
const roomy = async () => ({ quota: 10 ** 12, usage: 0 });

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('market data fixture', () => {
  it('is a valid demo file with 30 stocks and both indices', async () => {
    const res = validateMarketData(JSON.parse(await decompress(file())));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { stocks, indices } = res.data;
    expect(stocks).toHaveLength(30);
    expect(stocks.filter((s) => s.m === 'KOSPI' && s.t === 'STOCK')).toHaveLength(15);
    expect(stocks.filter((s) => s.m === 'KOSDAQ' && s.t === 'STOCK')).toHaveLength(10);
    expect(stocks.filter((s) => s.t === 'ETF')).toHaveLength(5);
    expect(stocks.some((s) => s.s === '069500')).toBe(true);
    expect(stocks.some((s) => s.managed) && stocks.some((s) => s.halted)).toBe(true);
    expect(indices.map((i) => i.id).sort()).toEqual(['KOSDAQ', 'KOSPI']);
    expect(stocks.some((s) => s.d.length < indices[0].d.length)).toBe(true);
  });
});

describe('market data store', () => {
  it('imports a file and reports info and data', async () => {
    const store = openMarketData();
    expect(await store.info()).toBeNull();
    const persist = vi.fn(async () => true);
    Object.defineProperty(navigator, 'storage', { value: { persist }, configurable: true });
    const res = await store.importFile(file(), { decompress, estimate: roomy });
    expect(res).toMatchObject({ ok: true, info: { stocks: 30, collectedAt: '2026-10-16T09:00:00+09:00' }, persisted: true });
    expect(persist).toHaveBeenCalled();
    expect(await store.info()).toMatchObject({ stocks: 30, range: { from: '2024-10-16', to: '2026-10-15' } });
    expect((await store.load())?.stocks).toHaveLength(30);
  });

  it('rejects a corrupt file and keeps the previous data', async () => {
    const store = openMarketData();
    await store.importFile(file(), { decompress, estimate: roomy });
    const bad = await store.importFile(new Blob(['not gzip']), { estimate: roomy, decompress: async () => '{oops' });
    expect(bad).toEqual({ ok: false, reason: 'corrupt' });
    const broken = JSON.parse(await decompress(file()));
    broken.stocks[0].c[0] = 0;
    const bad2 = await store.importFile(new Blob(['x']), { estimate: roomy, decompress: async () => JSON.stringify(broken) });
    expect(bad2).toEqual({ ok: false, reason: 'corrupt' });
    expect((await store.info())?.stocks).toBe(30);
  });

  it('tells a newer version and a wrong format apart', async () => {
    const store = openMarketData();
    const j = JSON.parse(await decompress(file()));
    const newer = await store.importFile(new Blob(['x']), { estimate: roomy, decompress: async () => JSON.stringify({ ...j, version: 2 }) });
    expect(newer).toEqual({ ok: false, reason: 'version-newer' });
    const other = await store.importFile(new Blob(['x']), { estimate: roomy, decompress: async () => '{"a":1}' });
    expect(other).toEqual({ ok: false, reason: 'format' });
  });

  it('rejects when free space is short, with the needed MB, and keeps the previous data', async () => {
    const store = openMarketData();
    await store.importFile(file(), { decompress, estimate: roomy });
    // A보다 5MB 큰 파일. 교체로 돌려받는 A의 크기를 더해도 모자란다
    const j = JSON.parse(await decompress(file()));
    j.stocks[0].n = 'x'.repeat(5 * 1024 * 1024);
    const text = JSON.stringify(j);
    const res = await store.importFile(new Blob(['x']), { decompress: async () => text, estimate: async () => ({ quota: 1010, usage: 1000 }) });
    expect(res).toMatchObject({ ok: false, reason: 'quota' });
    if (!res.ok) expect(res.neededMb).toBe(Math.ceil((new TextEncoder().encode(text).byteLength * 1.2) / 1024 / 1024));
    expect((await store.info())?.stocks).toBe(30);
  });

  it('clears the data', async () => {
    const store = openMarketData();
    await store.importFile(file(), { decompress, estimate: roomy });
    await store.clear();
    expect(await store.info()).toBeNull();
    expect(await store.load()).toBeNull();
  });
});
