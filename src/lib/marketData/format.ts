// 수집 스크립트가 만드는 시장 데이터 파일(market-data-YYYYMMDD.json.gz를 푼 JSON)의 형식과 검증.

export interface MarketDataFile {
  format: 'gazua-market-data';
  version: 1;
  collectedAt: string; // ISO, KST
  source: 'kis';
  adjusted: true; // 수정주가
  range: { from: string; to: string }; // YYYY-MM-DD
  sectors: { code: string; name: string; level: 1 | 2 | 3 }[];
  stocks: {
    s: string;
    n: string; // 코드, 이름
    m: 'KOSPI' | 'KOSDAQ';
    t: 'STOCK' | 'ETF' | 'ETN' | 'REIT' | 'OTHER';
    sec: [string, string, string]; // 업종 대·중·소 코드 ('' = 없음)
    shares: number; // 상장주식수(주). 수집일 기준
    managed: boolean;
    halted: boolean; // 수집일 기준
    d: string[]; // 날짜(YYYYMMDD) 오름차순
    o: number[];
    h: number[];
    l: number[];
    c: number[];
    v: number[];
    tv: number[]; // 거래대금(원)
  }[];
  // 시가는 비교 곡선의 첫날 기준값(indexCurve)에 쓴다
  indices: { id: 'KOSPI' | 'KOSDAQ'; d: string[]; o: number[]; c: number[] }[];
}

export type MarketDataCheck =
  | { ok: true; data: MarketDataFile }
  | { ok: false; reason: 'format' | 'version-newer' | 'corrupt' };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

const isNumArray = (x: unknown, len: number, positive = false): x is number[] =>
  Array.isArray(x) && x.length === len && x.every((n) => typeof n === 'number' && Number.isFinite(n) && (!positive || n > 0));

// 날짜는 8자리 문자열이고 엄격하게 오름차순이어야 한다.
const isAscendingDates = (d: unknown): d is string[] =>
  Array.isArray(d) && d.every((x, i) => typeof x === 'string' && /^\d{8}$/.test(x) && (i === 0 || (d[i - 1] as string) < x));

function stockCorrupt(s: Record<string, unknown>): boolean {
  if (!isAscendingDates(s.d)) return true;
  const n = s.d.length;
  return !(
    isNumArray(s.o, n) &&
    isNumArray(s.h, n) &&
    isNumArray(s.l, n) &&
    isNumArray(s.c, n, true) &&
    isNumArray(s.v, n) &&
    isNumArray(s.tv, n)
  );
}

function indexCorrupt(i: Record<string, unknown>): boolean {
  if (!isAscendingDates(i.d)) return true;
  return !(isNumArray(i.o, i.d.length, true) && isNumArray(i.c, i.d.length, true));
}

export function validateMarketData(x: unknown): MarketDataCheck {
  if (!isObj(x) || x.format !== 'gazua-market-data') return { ok: false, reason: 'format' };
  if (typeof x.version !== 'number') return { ok: false, reason: 'format' };
  if (x.version > 1) return { ok: false, reason: 'version-newer' };
  if (x.version !== 1) return { ok: false, reason: 'format' };
  if (!Array.isArray(x.stocks) || !Array.isArray(x.indices) || !Array.isArray(x.sectors)) {
    return { ok: false, reason: 'format' };
  }
  for (const s of x.stocks) if (!isObj(s) || stockCorrupt(s)) return { ok: false, reason: 'corrupt' };
  for (const i of x.indices) if (!isObj(i) || indexCorrupt(i)) return { ok: false, reason: 'corrupt' };
  return { ok: true, data: x as unknown as MarketDataFile };
}
