// 시장 데이터 파일(수집 스크립트 산출물)을 브라우저 IndexedDB에 하나만 보관한다. 기기 단위 데이터다(스펙 4).
import { openDB, type DBSchema } from 'idb';
import { validateMarketData, type MarketDataFile } from './format';

export type MarketSector = MarketDataFile['sectors'][number];

export interface MarketDataInfo {
  collectedAt: string;
  stocks: number;
  range: { from: string; to: string };
  /** 저장된 파일이 풀린 크기(바이트). 교체할 때 여유 공간에 되돌려 셈한다. */
  bytes?: number;
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
  /** 업종 목록만. 수십 MB 본문을 읽지 않는다(없으면 빈 배열). */
  sectors(): Promise<MarketSector[]>;
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
// 업종 선택 화면용 목록. 본문을 풀지 않고 읽으려고 가져올 때 함께 쓴다.
const SECTORS_KEY = 'current-sectors';
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

  async function sectors(): Promise<MarketSector[]> {
    const d = await db();
    try {
      const own = (await d.get(STORE, SECTORS_KEY)) as MarketSector[] | undefined;
      if (own) return own;
      // 업종 요약이 생기기 전에 가져온 데이터: 본문에서 읽는다
      return ((await d.get(STORE, KEY)) as MarketDataFile | undefined)?.sectors ?? [];
    } finally {
      d.close();
    }
  }

  async function importFile(file: Blob, deps: ImportDeps = {}): Promise<ImportResult> {
    let parsed: unknown;
    let rawBytes: number;
    try {
      const text = await (deps.decompress ?? defaultDecompress)(file);
      rawBytes = new TextEncoder().encode(text).byteLength;
      parsed = JSON.parse(text); // text는 여기서 범위를 벗어나 풀려난다
    } catch {
      return { ok: false, reason: 'corrupt' };
    }
    const check = validateMarketData(parsed);
    if (!check.ok) return { ok: false, reason: check.reason };

    // 풀린 크기의 1.2배가 여유 공간보다 크면 쓰기 전에 거절한다. 지금 저장된 파일은 교체되니 그 크기는 되돌려 셈한다.
    const needed = rawBytes * NEED_FACTOR;
    const neededMb = Math.ceil(needed / 1024 / 1024);
    try {
      const { quota, usage } = await (deps.estimate ?? defaultEstimate)();
      if (typeof quota === 'number') {
        const stored = ((await info())?.bytes ?? 0) * NEED_FACTOR;
        if (quota - (usage ?? 0) + stored < needed) return { ok: false, reason: 'quota', neededMb };
      }
    } catch {
      // 추정이 안 되면 그냥 시도한다. 실제 쓰기 실패는 아래에서 잡는다.
    }

    const data = check.data;
    const next: MarketDataInfo = { collectedAt: data.collectedAt, stocks: data.stocks.length, range: data.range, bytes: rawBytes };
    const d = await db();
    const tx = d.transaction(STORE, 'readwrite');
    try {
      // 한 트랜잭션에서 바꿔치기한다. 요청과 완료를 함께 기다려 거부가 떠돌지 않게 한다.
      // 만든 즉시 처리기를 달아, 뒤의 put이 동기로 던져 취소될 때 앞 요청의 거부가 떠돌지 않게 한다
      const pending: Promise<unknown>[] = [tx.done];
      tx.done.catch(() => {});
      for (const [v, k] of [[data, KEY], [next, INFO_KEY], [data.sectors, SECTORS_KEY]] as const) {
        const req = tx.store.put(v, k);
        req.catch(() => {});
        pending.push(req);
      }
      await Promise.all(pending);
    } catch (e) {
      // 동기로 던져진 경우 트랜잭션이 남아 앞의 put만 커밋되지 않도록 취소한다
      try {
        tx.abort();
      } catch {
        // 이미 끝난 트랜잭션
      }
      if (e instanceof DOMException && e.name === 'QuotaExceededError') return { ok: false, reason: 'quota', neededMb };
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

  return { info, load, sectors, importFile, clear };
}
