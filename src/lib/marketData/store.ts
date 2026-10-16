// 시장 데이터 파일(수집 스크립트 산출물)을 브라우저 IndexedDB에 하나만 보관한다. 기기 단위 데이터다(스펙 4).
import { openDB, type DBSchema } from 'idb';
import { validateMarketData, type MarketDataFile } from './format';

export interface MarketDataInfo {
  collectedAt: string;
  stocks: number;
  range: { from: string; to: string };
}

export type ImportResult =
  | { ok: true; info: MarketDataInfo; persisted?: boolean }
  | { ok: false; reason: 'format' | 'version-newer' | 'corrupt' | 'quota'; neededMb?: number };

export interface ImportDeps {
  estimate?: () => Promise<{ quota?: number; usage?: number }>;
  /** gzip을 풀어 JSON 텍스트를 돌려준다. 기본값은 브라우저의 DecompressionStream. */
  decompress?: (file: Blob) => Promise<string>;
}

export interface MarketDataStore {
  info(): Promise<MarketDataInfo | null>;
  load(): Promise<MarketDataFile | null>;
  importFile(file: Blob, deps?: ImportDeps): Promise<ImportResult>;
  clear(): Promise<void>;
}

interface Schema extends DBSchema {
  files: { key: string; value: unknown };
}

const DB_NAME = 'gazua-market-data';
const STORE = 'files';
const KEY = 'current';
// 목록 표시용 요약. 수십 MB짜리 본문을 읽지 않고 info()만 부르려고 같은 트랜잭션에서 함께 쓴다.
const INFO_KEY = 'current-info';
const NEED_FACTOR = 1.2;

const defaultDecompress = (file: Blob): Promise<string> =>
  new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text();

const defaultEstimate = async () => (await navigator.storage?.estimate?.()) ?? {};

export function openMarketData(): MarketDataStore {
  const db = () =>
    openDB<Schema>(DB_NAME, 1, {
      upgrade(d) {
        d.createObjectStore(STORE);
      },
    });

  async function info(): Promise<MarketDataInfo | null> {
    const d = await db();
    try {
      return ((await d.get(STORE, INFO_KEY)) as MarketDataInfo | undefined) ?? null;
    } finally {
      d.close();
    }
  }

  async function load(): Promise<MarketDataFile | null> {
    const d = await db();
    try {
      return ((await d.get(STORE, KEY)) as MarketDataFile | undefined) ?? null;
    } finally {
      d.close();
    }
  }

  async function importFile(file: Blob, deps: ImportDeps = {}): Promise<ImportResult> {
    let text: string;
    let parsed: unknown;
    try {
      text = await (deps.decompress ?? defaultDecompress)(file);
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, reason: 'corrupt' };
    }
    const check = validateMarketData(parsed);
    if (!check.ok) return { ok: false, reason: check.reason };

    // 풀린 크기의 1.2배가 여유 공간보다 크면 쓰기 전에 거절한다
    const needed = new Blob([text]).size * NEED_FACTOR;
    try {
      const { quota, usage } = await (deps.estimate ?? defaultEstimate)();
      if (typeof quota === 'number' && quota - (usage ?? 0) < needed) {
        return { ok: false, reason: 'quota', neededMb: Math.ceil(needed / 1024 / 1024) };
      }
    } catch {
      // 추정이 안 되면 그냥 시도한다. 실제 쓰기 실패는 아래에서 잡는다.
    }

    const data = check.data;
    const next: MarketDataInfo = { collectedAt: data.collectedAt, stocks: data.stocks.length, range: data.range };
    const d = await db();
    try {
      // 한 트랜잭션에서 바꿔치기한다. 실패하면 트랜잭션이 취소되어 이전 값이 남는다.
      const tx = d.transaction(STORE, 'readwrite');
      void tx.store.put(data, KEY);
      void tx.store.put(next, INFO_KEY);
      await tx.done;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'QuotaExceededError') {
        return { ok: false, reason: 'quota', neededMb: Math.ceil(needed / 1024 / 1024) };
      }
      throw e;
    } finally {
      d.close();
    }

    let persisted: boolean | undefined;
    try {
      persisted = await navigator.storage?.persist?.();
    } catch {
      persisted = undefined;
    }
    return { ok: true, info: next, persisted };
  }

  async function clear(): Promise<void> {
    const d = await db();
    try {
      await d.clear(STORE);
    } finally {
      d.close();
    }
  }

  return { info, load, importFile, clear };
}
