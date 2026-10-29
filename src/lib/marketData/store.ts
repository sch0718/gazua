// 시장 데이터 파일(수집 스크립트 산출물)을 브라우저 IndexedDB에 하나만 보관한다. 기기 단위 데이터다(스펙 4).
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { hasFlowFormat, hasMacroFormat, isV4, validateMarketData, type MarketDataFile } from './format';

export type MarketSector = MarketDataFile['sectors'][number];
/** 테마 선택 화면용 요약. 종목 목록은 본문에만 둔다. */
export interface MarketThemeSummary {
  code: string;
  name: string;
  count: number;
}

export interface MarketDataInfo {
  collectedAt: string;
  stocks: number;
  range: { from: string; to: string };
  /** 저장된 파일이 풀린 크기(바이트). 교체할 때 여유 공간에 되돌려 셈한다. */
  bytes?: number;
  /** 파일 형식 버전. 이 필드가 생기기 전에 가져온 데이터는 1로 본다. */
  version?: 1 | 2 | 3 | 4;
  /** v2이고 환율·유가 계열 중 하나라도 값이 있다 */
  hasMacro?: boolean;
  /** 파일에 든 테마 수. 없던 시절의 요약은 0으로 읽는다. */
  themeCount?: number;
  /** v3이고 투자자별 매매동향이 있는 종목이 하나라도 있다. 없던 시절의 요약은 false로 읽는다. */
  hasFlow?: boolean;
  /** 매매동향이 있는 종목 수. 없던 시절의 요약은 0으로 읽는다. */
  flowStocks?: number;
  /** v4이고 재무가 있는 종목이 하나라도 있다. 없던 시절의 요약은 false로 읽는다. */
  hasFin?: boolean;
  /** 재무가 있는 종목 수. 없던 시절의 요약은 0으로 읽는다. */
  finStocks?: number;
  /** 가져올 때마다 새로 정하는 표. 테마별 종목 키가 이 요약과 같은 가져오기에서 쓰였는지 가린다. */
  importId?: string;
}

export type ImportResult =
  | { ok: true; info: MarketDataInfo; persisted?: boolean }
  | { ok: false; reason: 'format' | 'version-newer' | 'corrupt' | 'quota'; neededMb?: number };

export interface ImportDeps {
  estimate?: () => Promise<{ quota?: number; usage?: number }>;
  /** gzip을 풀어 JSON 텍스트를 돌려준다. 풀린 바이트 수를 함께 주면 그 값을 쓴다. 기본값은 브라우저의 DecompressionStream. */
  decompress?: (file: Blob) => Promise<string | { text: string; bytes: number }>;
}

export interface MarketDataStore {
  info(): Promise<MarketDataInfo | null>;
  load(): Promise<MarketDataFile | null>;
  /** 업종 목록만. 수십 MB 본문을 읽지 않는다(없으면 빈 배열). */
  sectors(): Promise<MarketSector[]>;
  /** 테마 요약만(없으면 빈 배열). v1 파일은 테마가 없다. */
  themes(): Promise<MarketThemeSummary[]>;
  /** 테마 하나의 종목만. 본문을 읽지 않는다(없는 테마·v1이면 빈 배열). */
  themeSymbols(code: string): Promise<string[]>;
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
// 테마 선택 화면용 요약(code, name, 종목 수). 같은 방식으로 가져올 때 함께 쓴다.
const THEMES_KEY = 'current-themes';
// 테마별 종목(묶음을 테마에서 가져올 때). 같은 방식으로 가져올 때 함께 쓴다.
// 이 키를 모르는 이전 앱이 새 파일을 가져오면 남은 값이 낡으므로, 요약의 importId와 같을 때만 쓴다.
const THEME_SYMBOLS_KEY = 'current-theme-symbols';
interface ThemeSymbols {
  importId?: string;
  symbols: Record<string, string[]>;
}
const NEED_FACTOR = 1.2;

// 풀리는 바이트를 흘려보내며 센다. 본문을 다시 인코딩하면 실제 규모에서 수백 MB를 한 번 더 잡는다
async function defaultDecompress(file: Blob): Promise<{ text: string; bytes: number }> {
  let bytes = 0;
  const count = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) {
      bytes += chunk.byteLength;
      ctl.enqueue(chunk);
    },
  });
  const text = await new Response(file.stream().pipeThrough(new DecompressionStream('gzip')).pipeThrough(count)).text();
  return { text, bytes };
}

// 문자열의 UTF-8 바이트 수. 새 버퍼를 만들지 않는다
function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

const summarizeThemes = (t: { code: string; name: string; symbols: string[] }[]): MarketThemeSummary[] =>
  t.map((x) => ({ code: x.code, name: x.name, count: x.symbols.length }));

const themeSymbolsOf = (t: { code: string; symbols: string[] }[]): Record<string, string[]> =>
  Object.fromEntries(t.map((x) => [x.code, x.symbols]));

const newImportId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

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
      const got = (await d.get(STORE, INFO_KEY)) as MarketDataInfo | undefined;
      // 버전 필드가 생기기 전의 요약은 v1이다
      return got ? { ...got, version: got.version ?? 1, hasMacro: got.hasMacro ?? false, themeCount: got.themeCount ?? 0, hasFlow: got.hasFlow ?? false, flowStocks: got.flowStocks ?? 0, hasFin: got.hasFin ?? false, finStocks: got.finStocks ?? 0 } : null;
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

  // 테마 요약·테마별 종목 키가 생기기 전에 가져온 데이터: 본문을 한 번 읽어 두 키를 채워 둔다(v1이면 빈 목록).
  // 한 readwrite 트랜잭션에서 읽고 써서, 그 사이에 가져오기가 끼어들어 다른 파일의 요약이 남는 일이 없다.
  // 요약에 importId가 없으면 여기서 정해 함께 쓴다. 이전 앱이 다시 가져오면 요약에서 빠져 낡은 값을 가린다
  async function fillThemes(d: IDBPDatabase<Schema>): Promise<{ summary: MarketThemeSummary[]; symbols: ThemeSymbols['symbols'] } | null> {
    const tx = d.transaction(STORE, 'readwrite');
    tx.done.catch(() => {});
    const [body, got] = (await Promise.all([tx.store.get(KEY), tx.store.get(INFO_KEY)])) as [MarketDataFile | undefined, MarketDataInfo | undefined];
    if (!body || !got) return null;
    const list = hasMacroFormat(body) ? body.themes : [];
    const summary = summarizeThemes(list);
    const symbols = themeSymbolsOf(list);
    const importId = got.importId ?? newImportId();
    try {
      const pending: Promise<unknown>[] = [tx.done];
      const puts: [unknown, string][] = [[summary, THEMES_KEY], [{ importId, symbols } satisfies ThemeSymbols, THEME_SYMBOLS_KEY]];
      if (!got.importId) puts.push([{ ...got, importId }, INFO_KEY]);
      for (const [v, k] of puts) {
        const req = tx.store.put(v, k);
        req.catch(() => {});
        pending.push(req);
      }
      await Promise.all(pending);
    } catch {
      // 채워 두지 못해도(용량 등) 이번에 읽은 값은 돌려준다. 다음에 다시 채운다
      try {
        tx.abort();
      } catch {
        // 이미 끝난 트랜잭션
      }
    }
    return { summary, symbols };
  }

  async function themes(): Promise<MarketThemeSummary[]> {
    const d = await db();
    try {
      const own = (await d.get(STORE, THEMES_KEY)) as MarketThemeSummary[] | undefined;
      if (own) return own;
      return (await fillThemes(d))?.summary ?? [];
    } finally {
      d.close();
    }
  }

  async function themeSymbols(code: string): Promise<string[]> {
    const d = await db();
    try {
      const tx = d.transaction(STORE, 'readonly');
      const [got, own] = (await Promise.all([tx.store.get(INFO_KEY), tx.store.get(THEME_SYMBOLS_KEY), tx.done])) as [MarketDataInfo | undefined, ThemeSymbols | undefined, void];
      if (!got) return [];
      const symbols = own && own.importId === got.importId ? own.symbols : (await fillThemes(d))?.symbols;
      return symbols && Object.hasOwn(symbols, code) ? symbols[code] : [];
    } finally {
      d.close();
    }
  }

  async function importFile(file: Blob, deps: ImportDeps = {}): Promise<ImportResult> {
    let parsed: unknown;
    let rawBytes: number;
    try {
      const out = await (deps.decompress ?? defaultDecompress)(file);
      const text = typeof out === 'string' ? out : out.text;
      rawBytes = typeof out === 'string' ? utf8Length(out) : out.bytes;
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
    const v2 = hasMacroFormat(data);
    const flowStocks = hasFlowFormat(data) ? data.stocks.filter((s) => s.flow !== undefined).length : 0;
    const finStocks = isV4(data) ? data.stocks.filter((s) => s.fin !== undefined).length : 0;
    const next: MarketDataInfo = {
      collectedAt: data.collectedAt,
      stocks: data.stocks.length,
      range: data.range,
      bytes: rawBytes,
      version: data.version,
      themeCount: v2 ? data.themes.length : 0,
      hasFlow: flowStocks > 0,
      flowStocks,
      hasFin: finStocks > 0,
      finStocks,
      importId: newImportId(),
      hasMacro: v2 && (data.macro.usdkrw.d.length > 0 || data.macro.wti.d.length > 0),
    };
    const d = await db();
    const tx = d.transaction(STORE, 'readwrite');
    try {
      // 한 트랜잭션에서 바꿔치기한다. 요청과 완료를 함께 기다려 거부가 떠돌지 않게 한다.
      // 만든 즉시 처리기를 달아, 뒤의 put이 동기로 던져 취소될 때 앞 요청의 거부가 떠돌지 않게 한다
      const pending: Promise<unknown>[] = [tx.done];
      tx.done.catch(() => {});
      for (const [v, k] of [[data, KEY], [next, INFO_KEY], [data.sectors, SECTORS_KEY], [v2 ? summarizeThemes(data.themes) : [], THEMES_KEY], [{ importId: next.importId, symbols: themeSymbolsOf(v2 ? data.themes : []) } satisfies ThemeSymbols, THEME_SYMBOLS_KEY]] as const) {
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

  return { info, load, sectors, themes, themeSymbols, importFile, clear };
}
