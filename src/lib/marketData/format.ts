// 수집 스크립트가 만드는 시장 데이터 파일(market-data-YYYYMMDD.json.gz를 푼 JSON)의 형식과 검증.

export interface MarketDataFileV1 {
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

export interface MacroSeries {
  d: string[]; // FRED 관측일(YYYYMMDD, 미국 날짜) 오름차순, 값 있는 날만
  v: number[];
}

export interface ThemeEntry {
  code: string;
  name: string;
  symbols: string[]; // 파일에 있는 종목만
}

export interface MarketDataFileV2 extends Omit<MarketDataFileV1, 'version'> {
  version: 2;
  macro: { usdkrw: MacroSeries; wti: MacroSeries };
  themes: ThemeEntry[];
}

// 종목별 투자자 수급(순매수 대금, 백만 원 단위 정수). from부터 일봉 d와 같은 간격으로 이어진다.
// 마지막 일봉까지 닿지 않을 수 있다(수급 끝).
export interface FlowSeries {
  from: string; // YYYYMMDD, d 안에 있는 날
  f: number[]; // 외국인
  i: number[]; // 기관
  p: number[]; // 개인
}

type StockV1 = MarketDataFileV1['stocks'][number];

export interface MarketDataFileV3 extends Omit<MarketDataFileV2, 'version' | 'stocks'> {
  version: 3;
  stocks: (StockV1 & { flow?: FlowSeries })[];
}

// 종목별 분기 재무(억 원). q는 분기말 YYYYMM으로 3개월 간격으로 이어진다(빠진 분기 없음).
export interface FinSeries {
  q: string[];
  a: number[]; // 1 = 그 분기가 회계연도 마지막(연간 결산) 분기, 0 = 아님. 결산월 변경을 보존한다
  rev: number[]; // 그 분기 하나의 매출액
  op: number[]; // 그 분기 하나의 영업이익
  ni: number[]; // 그 분기 하나의 당기순이익
  eq: number[]; // 분기말 자본총계
  debt: number[]; // 분기말 부채총계
}

export interface MarketDataFileV4 extends Omit<MarketDataFileV3, 'version' | 'stocks'> {
  version: 4;
  stocks: (MarketDataFileV3['stocks'][number] & { fin?: FinSeries })[];
}

export type MarketDataFile = MarketDataFileV1 | MarketDataFileV2 | MarketDataFileV3 | MarketDataFileV4;

export const isV3 = (f: MarketDataFile): f is MarketDataFileV3 => f.version === 3;
export const isV4 = (f: MarketDataFile): f is MarketDataFileV4 => f.version === 4;
// v2 이상이면 macro와 themes가 있다.
export const hasMacroFormat = (f: MarketDataFile): f is MarketDataFileV2 | MarketDataFileV3 | MarketDataFileV4 => f.version >= 2;
// v3 이상이면 종목에 flow가 있을 수 있다.
export const hasFlowFormat = (f: MarketDataFile): f is MarketDataFileV3 | MarketDataFileV4 => f.version >= 3;

export type MarketDataCheck =
  | { ok: true; data: MarketDataFile }
  | { ok: false; reason: 'format' | 'version-newer' | 'corrupt' };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

// sign: 'pos'면 0 초과, 'nonneg'면 0 이상만 허용한다
const isNumArray = (x: unknown, len: number, sign?: 'pos' | 'nonneg'): x is number[] =>
  Array.isArray(x) &&
  x.length === len &&
  x.every((n) => typeof n === 'number' && Number.isFinite(n) && (sign === 'pos' ? n > 0 : sign === 'nonneg' ? n >= 0 : true));

// 날짜는 8자리 문자열이고 엄격하게 오름차순이어야 한다.
const isAscendingDates = (d: unknown): d is string[] =>
  Array.isArray(d) && d.every((x, i) => typeof x === 'string' && /^\d{8}$/.test(x) && (i === 0 || (d[i - 1] as string) < x));

// 수집기는 가격이 0 이하인 행(거래정지일 빈 행 등)을 버리므로 o·h·l·c는 0 초과, 거래량·대금은 0 이상이다.
function stockCorrupt(s: Record<string, unknown>): boolean {
  if (!isAscendingDates(s.d)) return true;
  const n = s.d.length;
  return !(
    isNumArray(s.o, n, 'pos') &&
    isNumArray(s.h, n, 'pos') &&
    isNumArray(s.l, n, 'pos') &&
    isNumArray(s.c, n, 'pos') &&
    isNumArray(s.v, n, 'nonneg') &&
    isNumArray(s.tv, n, 'nonneg')
  );
}

function indexCorrupt(i: Record<string, unknown>): boolean {
  if (!isAscendingDates(i.d)) return true;
  return !(isNumArray(i.o, i.d.length, 'pos') && isNumArray(i.c, i.d.length, 'pos'));
}

const MARKETS = ['KOSPI', 'KOSDAQ'];
const TYPES = ['STOCK', 'ETF', 'ETN', 'REIT', 'OTHER'];

// 최상위·종목 메타 필드의 모양을 본다(배열 내용은 corrupt 검사가 맡는다).
function metaOk(x: Record<string, unknown>): boolean {
  const range = x.range;
  if (!isObj(range) || typeof range.from !== 'string' || typeof range.to !== 'string') return false;
  if (typeof x.collectedAt !== 'string') return false;
  const sectorsOk = (x.sectors as unknown[]).every(
    (s) => isObj(s) && typeof s.code === 'string' && typeof s.name === 'string' && (s.level === 1 || s.level === 2 || s.level === 3),
  );
  if (!sectorsOk) return false;
  return (x.stocks as unknown[]).every(
    (s) =>
      isObj(s) &&
      typeof s.s === 'string' &&
      typeof s.n === 'string' &&
      MARKETS.includes(s.m as string) &&
      TYPES.includes(s.t as string) &&
      Array.isArray(s.sec) &&
      s.sec.length === 3 &&
      s.sec.every((c) => typeof c === 'string') &&
      typeof s.shares === 'number' &&
      Number.isFinite(s.shares) &&
      s.shares >= 0 &&
      typeof s.managed === 'boolean' &&
      typeof s.halted === 'boolean',
  );
}

const isStrArray = (x: unknown): x is string[] => Array.isArray(x) && x.every((s) => typeof s === 'string');

// v2의 macro·themes 모양(false면 format)
function v2ShapeOk(x: Record<string, unknown>): boolean {
  const m = x.macro;
  if (!isObj(m) || !isObj(m.usdkrw) || !isObj(m.wti)) return false;
  if (!Array.isArray(m.usdkrw.d) || !Array.isArray(m.usdkrw.v) || !Array.isArray(m.wti.d) || !Array.isArray(m.wti.v)) return false;
  if (!Array.isArray(x.themes)) return false;
  return x.themes.every((t) => isObj(t) && typeof t.code === 'string' && typeof t.name === 'string' && isStrArray(t.symbols));
}

// 환율은 > 0, WTI는 음수 허용(2020-04-20). 둘 다 유한해야 한다.
function macroCorrupt(m: Record<string, unknown>): boolean {
  for (const [key, positive] of [['usdkrw', true], ['wti', false]] as const) {
    const s = m[key] as Record<string, unknown>;
    if (!isAscendingDates(s.d)) return true;
    if (!isNumArray(s.v, s.d.length, positive ? 'pos' : undefined)) return true;
  }
  return false;
}

// v3 이상 flow: from이 d 안에 있고, 세 배열 길이가 같고 1 이상이며, 끝이 d를 넘지 않는다.
function flowCorrupt(s: Record<string, unknown>): boolean {
  if (s.flow === undefined) return false;
  const fl = s.flow;
  const d = s.d as string[];
  if (!isObj(fl) || typeof fl.from !== 'string') return true;
  const at = d.indexOf(fl.from);
  if (at < 0) return true;
  const n = Array.isArray(fl.f) ? fl.f.length : 0;
  if (n < 1 || at + n > d.length) return true;
  return !(['f', 'i', 'p'] as const).every((k) => isNumArray(fl[k], n) && (fl[k] as number[]).every(Number.isInteger));
}

// YYYYMM을 달 번호로. 형식이 틀리면 NaN
const monthIndex = (ym: unknown): number =>
  typeof ym === 'string' && /^\d{4}(0[1-9]|1[0-2])$/.test(ym) ? Number(ym.slice(0, 4)) * 12 + Number(ym.slice(4)) - 1 : NaN;

// v4 fin: q가 1개 이상이고 YYYYMM이 정확히 3개월 간격, a는 0·1, 여섯 배열 길이가 q와 같고 값이 유한하다.
function finCorrupt(s: Record<string, unknown>): boolean {
  if (s.fin === undefined) return false;
  const fin = s.fin;
  if (!isObj(fin) || !Array.isArray(fin.q) || fin.q.length < 1) return true;
  const m = fin.q.map(monthIndex);
  if (!m.every((x, i) => Number.isFinite(x) && (i === 0 || x - m[i - 1] === 3))) return true;
  const n = m.length;
  if (!isNumArray(fin.a, n) || !fin.a.every((x) => x === 0 || x === 1)) return true;
  return !(['rev', 'op', 'ni', 'eq', 'debt'] as const).every((k) => isNumArray(fin[k], n));
}

export function validateMarketData(x: unknown): MarketDataCheck {
  if (!isObj(x) || x.format !== 'gazua-market-data') return { ok: false, reason: 'format' };
  if (typeof x.version !== 'number') return { ok: false, reason: 'format' };
  if (x.version > 4) return { ok: false, reason: 'version-newer' };
  if (x.version !== 1 && x.version !== 2 && x.version !== 3 && x.version !== 4) return { ok: false, reason: 'format' };
  if (!Array.isArray(x.stocks) || !Array.isArray(x.indices) || !Array.isArray(x.sectors)) {
    return { ok: false, reason: 'format' };
  }
  if (!metaOk(x)) return { ok: false, reason: 'format' };
  if (x.version >= 2 && !v2ShapeOk(x)) return { ok: false, reason: 'format' };
  for (const s of x.stocks) if (!isObj(s) || stockCorrupt(s)) return { ok: false, reason: 'corrupt' };
  if (x.version >= 3) for (const s of x.stocks) if (flowCorrupt(s as Record<string, unknown>)) return { ok: false, reason: 'corrupt' };
  if (x.version >= 4) for (const s of x.stocks) if (finCorrupt(s as Record<string, unknown>)) return { ok: false, reason: 'corrupt' };
  for (const i of x.indices) if (!isObj(i) || indexCorrupt(i)) return { ok: false, reason: 'corrupt' };
  if (x.version >= 2 && macroCorrupt(x.macro as Record<string, unknown>)) return { ok: false, reason: 'corrupt' };
  return { ok: true, data: x as unknown as MarketDataFile };
}
