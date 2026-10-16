import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

afterEach(() => vi.restoreAllMocks());

describe('market data store', () => {
  // B는 A와 달라야 바뀌었는지 가려낼 수 있다
  async function fileB() {
    const j = JSON.parse(await decompress(file()));
    j.collectedAt = '2026-11-01T09:00:00+09:00';
    j.stocks = j.stocks.slice(0, 5);
    return JSON.stringify(j);
  }
  // 두 번째 put(요약 쓰기)이 첫 put 뒤에 실패하게 한다
  function failSecondPut(err: Error) {
    const real = IDBObjectStore.prototype.put;
    let calls = 0;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...a: [unknown, IDBValidKey?]) {
      if (++calls === 2) throw err;
      return real.apply(this, a);
    });
  }

  it('counts the decompressed bytes while streaming instead of re-encoding the text', async () => {
    const store = openMarketData();
    const enc = vi.spyOn(TextEncoder.prototype, 'encode');
    const res = await store.importFile(file(), { estimate: roomy });
    expect(enc).not.toHaveBeenCalled();
    expect(res).toMatchObject({ ok: true, info: { bytes: gunzipSync(gz).byteLength } });
  });

  it('takes the byte count from the decompress dependency when it gives one, and counts UTF-8 bytes of a plain string', async () => {
    const store = openMarketData();
    const text = await decompress(file());
    const given = await store.importFile(new Blob(['x']), { decompress: async () => ({ text, bytes: 1234 }), estimate: roomy });
    expect(given).toMatchObject({ ok: true, info: { bytes: 1234 } });
    const blob = new Blob(['x']); // Blob 생성자도 encode를 부르므로 감시 전에 만든다
    const enc = vi.spyOn(TextEncoder.prototype, 'encode');
    const counted = await store.importFile(blob, { decompress: async () => text, estimate: roomy });
    expect(enc).not.toHaveBeenCalled();
    expect(counted).toMatchObject({ ok: true, info: { bytes: Buffer.byteLength(text, 'utf8') } });
  });

  it('mid-write failure: result is not ok and info() and load() still return A', async () => {
    const store = openMarketData();
    await store.importFile(file(), { decompress, estimate: roomy });
    const infoA = await store.info();
    const dataA = await store.load();
    failSecondPut(new Error('boom'));
    const text = await fileB();
    await expect(store.importFile(new Blob(['x']), { decompress: async () => text, estimate: roomy })).rejects.toThrow('boom');
    vi.restoreAllMocks();
    expect(await store.info()).toEqual(infoA);
    expect(await store.load()).toEqual(dataA);
  });

  it('QuotaExceededError on write: reason quota, and info() and load() still return A', async () => {
    const store = openMarketData();
    await store.importFile(file(), { decompress, estimate: roomy });
    const infoA = await store.info();
    const dataA = await store.load();
    failSecondPut(new DOMException('full', 'QuotaExceededError'));
    const text = await fileB();
    const res = await store.importFile(new Blob(['x']), { decompress: async () => text, estimate: roomy });
    expect(res).toMatchObject({ ok: false, reason: 'quota' });
    vi.restoreAllMocks();
    expect(await store.info()).toEqual(infoA);
    expect(await store.load()).toEqual(dataA);
  });

  it('same-size re-import is accepted when the stored file is credited as free space', async () => {
    const store = openMarketData();
    await store.importFile(file(), { decompress, estimate: roomy });
    const raw = new TextEncoder().encode(await decompress(file())).byteLength;
    // 남은 공간은 A 크기의 1.2배보다 작지만, 교체로 돌려받는 몫을 더하면 충분하다
    const tight = async () => ({ quota: raw * 1.2 * 0.5, usage: 0 });
    expect(await store.importFile(file(), { decompress, estimate: tight })).toMatchObject({ ok: true });
  });


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
    const newer = await store.importFile(new Blob(['x']), { estimate: roomy, decompress: async () => JSON.stringify({ ...j, version: 4 }) });
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

  it('failing the third put (sectors) rolls back all three keys', async () => {
    const store = openMarketData();
    await store.importFile(file(), { decompress, estimate: roomy });
    const infoA = await store.info();
    const dataA = await store.load();
    const sectorsA = await store.sectors();
    const real = IDBObjectStore.prototype.put;
    let calls = 0;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...a: [unknown, IDBValidKey?]) {
      if (++calls === 3) throw new Error('boom');
      return real.apply(this, a);
    });
    const j = JSON.parse(await decompress(file()));
    j.collectedAt = '2026-11-01T09:00:00+09:00';
    j.sectors = [...j.sectors].reverse();
    const text = JSON.stringify(j);
    await expect(store.importFile(new Blob(['x']), { decompress: async () => text, estimate: roomy })).rejects.toThrow('boom');
    vi.restoreAllMocks();
    expect(await store.info()).toEqual(infoA);
    expect(await store.load()).toEqual(dataA);
    expect(await store.sectors()).toEqual(sectorsA);
  });

  // v1 파일: v2에만 있는 두 필드를 뺀다
  const asV1 = async () => {
    const j = JSON.parse(await decompress(file()));
    j.version = 1;
    delete j.macro;
    delete j.themes;
    return JSON.stringify(j);
  };

  it('v3 demo import: themes() lists code, name and symbol count; info() says version 3 with macro', async () => {
    const store = openMarketData();
    await store.importFile(file(), { decompress, estimate: roomy });
    const body = (await store.load())!;
    if (body.version === 1) throw new Error('fixture is not v2 or later');
    expect(body.themes.length).toBeGreaterThan(0);
    expect(await store.themes()).toEqual(body.themes.map((t) => ({ code: t.code, name: t.name, count: t.symbols.length })));
    expect(await store.info()).toMatchObject({ version: 3, hasMacro: true });
  });

  it('info() carries themeCount, and reads 0 on old data without it', async () => {
    const store = openMarketData();
    await store.importFile(file(), { decompress, estimate: roomy });
    const n = (await store.themes()).length;
    expect(n).toBeGreaterThan(0);
    expect((await store.info())?.themeCount).toBe(n);
    const db = await openDB('gazua-market-data', 1);
    const old = await db.get('files', 'current-info');
    delete old.themeCount;
    await db.put('files', old, 'current-info');
    db.close();
    expect((await store.info())?.themeCount).toBe(0);
  });

  it('hasMacro is false for a v3 file whose macro series are both empty', async () => {
    const store = openMarketData();
    const j = JSON.parse(await decompress(file()));
    j.macro = { usdkrw: { d: [], v: [] }, wti: { d: [], v: [] } };
    const text = JSON.stringify(j);
    await store.importFile(new Blob(['x']), { decompress: async () => text, estimate: roomy });
    expect(await store.info()).toMatchObject({ version: 3, hasMacro: false });
  });

  it('v1 import: themes() is [] and info() says version 1 without macro', async () => {
    const store = openMarketData();
    const text = await asV1();
    const res = await store.importFile(new Blob(['x']), { decompress: async () => text, estimate: roomy });
    expect(res).toMatchObject({ ok: true, info: { version: 1, hasMacro: false } });
    expect(await store.themes()).toEqual([]);
    expect(await store.info()).toMatchObject({ version: 1, hasMacro: false });
  });

  it('info() of data imported before version existed reads as version 1 without macro', async () => {
    const store = openMarketData();
    await store.importFile(file(), { decompress, estimate: roomy });
    const db = await openDB('gazua-market-data', 1);
    const old = await db.get('files', 'current-info');
    delete old.version;
    delete old.hasMacro;
    await db.put('files', old, 'current-info');
    db.close();
    expect(await store.info()).toMatchObject({ version: 1, hasMacro: false });
  });

  it('themes() falls back to the file body when current-themes is missing, and reads only the summary key otherwise', async () => {
    const store = openMarketData();
    await store.importFile(file(), { decompress, estimate: roomy });
    const expected = await store.themes();
    expect(expected.length).toBeGreaterThan(0);
    const getSpy = vi.spyOn(IDBObjectStore.prototype, 'get');
    expect(await store.themes()).toEqual(expected);
    expect(getSpy.mock.calls.map((c) => c[0])).not.toContain('current');
    vi.restoreAllMocks();
    const db = await openDB('gazua-market-data', 1);
    await db.delete('files', 'current-themes');
    db.close();
    expect(await store.themes()).toEqual(expected);
  });

  it('failing the fourth put (themes) rolls back all four keys', async () => {
    const store = openMarketData();
    await store.importFile(file(), { decompress, estimate: roomy });
    const infoA = await store.info();
    const dataA = await store.load();
    const sectorsA = await store.sectors();
    const themesA = await store.themes();
    const real = IDBObjectStore.prototype.put;
    let calls = 0;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...a: [unknown, IDBValidKey?]) {
      if (++calls === 4) throw new Error('boom');
      return real.apply(this, a);
    });
    const j = JSON.parse(await decompress(file()));
    j.collectedAt = '2026-11-01T09:00:00+09:00';
    j.themes = j.themes.slice(1);
    const text = JSON.stringify(j);
    await expect(store.importFile(new Blob(['x']), { decompress: async () => text, estimate: roomy })).rejects.toThrow('boom');
    vi.restoreAllMocks();
    expect(await store.info()).toEqual(infoA);
    expect(await store.load()).toEqual(dataA);
    expect(await store.sectors()).toEqual(sectorsA);
    expect(await store.themes()).toEqual(themesA);
  });

  it('clear() makes themes() return an empty list', async () => {
    const store = openMarketData();
    await store.importFile(file(), { decompress, estimate: roomy });
    await store.clear();
    expect(await store.themes()).toEqual([]);
  });

  it('clear() makes sectors() return an empty list', async () => {
    const store = openMarketData();
    await store.importFile(file(), { decompress, estimate: roomy });
    await store.clear();
    expect(await store.sectors()).toEqual([]);
  });

  it('sectors() returns only the sector list, without loading the file body', async () => {
    const store = openMarketData();
    expect(await store.sectors()).toEqual([]);
    await store.importFile(file(), { decompress, estimate: roomy });
    const expected = (await store.load())!.sectors;
    expect(expected.length).toBeGreaterThan(0);
    const getSpy = vi.spyOn(IDBObjectStore.prototype, 'get');
    expect(await store.sectors()).toEqual(expected);
    // 본문('current') 키는 읽지 않는다
    expect(getSpy.mock.calls.map((c) => c[0])).not.toContain('current');
  });

  it('sectors() falls back to the file body for data imported before the sector summary existed', async () => {
    const store = openMarketData();
    await store.importFile(file(), { decompress, estimate: roomy });
    const expected = (await store.load())!.sectors;
    const db = await openDB('gazua-market-data', 1);
    await db.delete('files', 'current-sectors');
    db.close();
    expect(await store.sectors()).toEqual(expected);
  });

  it('clears the data', async () => {
    const store = openMarketData();
    await store.importFile(file(), { decompress, estimate: roomy });
    await store.clear();
    expect(await store.info()).toBeNull();
    expect(await store.load()).toBeNull();
  });
});
