import type { Ctx } from './context';

export const NAVER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';
export interface Bar10 { end: number; close: number }
export interface DayBar { date: string; open: number; close: number }
export interface IndexQuote { changePct: number | null; changeAbs: number | null; tradedAt: number | null }

type Row = Record<string, unknown>;
const row = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);
const number = (v: unknown): number | null => {
  if (typeof v !== 'number' && (typeof v !== 'string' || !v.trim())) return null;
  const n = typeof v === 'string' ? Number(v.replaceAll(',', '')) : v;
  return Number.isFinite(n) ? n : null;
};

/** 현지 달력 시각을 Intl의 실제 UTC 오프셋으로 변환한다(미국 서머타임 포함). */
function localEpoch(value: unknown, fmt: Intl.DateTimeFormat): number | null {
  if (typeof value !== 'string' || !/^\d{14}$/.test(value)) return null;
  const parts = [value.slice(0, 4), value.slice(4, 6), value.slice(6, 8), value.slice(8, 10), value.slice(10, 12), value.slice(12, 14)].map(Number);
  const [y, m, d, h, min, sec] = parts;
  const wall = Date.UTC(y, m - 1, d, h, min, sec);
  let utc = wall;
  const localParts = (ms: number) => {
    const p = Object.fromEntries(fmt.formatToParts(ms).map((p) => [p.type, p.value]));
    return [p.year, p.month, p.day, p.hour, p.minute, p.second].map(Number);
  };
  for (let i = 0; i < 3; i++) {
    const [yy, mm, dd, hh, mi, ss] = localParts(utc);
    utc += wall - Date.UTC(yy, mm - 1, dd, hh, mi, ss);
  }
  return localParts(utc).every((p, i) => p === parts[i]) ? utc : null;
}

function parseWeek(json: unknown, fallback: string): Bar10[] {
  if (!row(json) || !row(json.priceInfos)) return [];
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: typeof json.zoneId === 'string' ? json.zoneId : fallback,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    const bars = new Map<number, Bar10>();
    for (const group of Object.values(json.priceInfos)) {
      if (!Array.isArray(group)) continue;
      for (const b of group) {
        if (!row(b)) continue;
        const start = localEpoch(b.localDateTime, fmt);
        const close = number(b.currentPrice);
        if (start === null || close === null || close <= 0) continue;
        const end = start + 600_000;
        bars.set(end, { end, close });
      }
    }
    return [...bars.values()].sort((a, b) => a.end - b.end);
  } catch {
    return [];
  }
}

export const parseFuturesWeek = (json: unknown): Bar10[] => parseWeek(json, 'CST6CDT');
export const parseDomesticWeek = (json: unknown): Bar10[] => parseWeek(json, 'Asia/Seoul');

export function parseDayBars(json: unknown): DayBar[] {
  if (!Array.isArray(json)) return [];
  const bars: DayBar[] = [];
  for (const b of json) {
    if (!row(b) || typeof b.localDate !== 'string' || !/^\d{8}$/.test(b.localDate)) continue;
    const date = `${b.localDate.slice(0, 4)}-${b.localDate.slice(4, 6)}-${b.localDate.slice(6, 8)}`;
    const ms = Date.parse(`${date}T00:00:00Z`);
    const open = number(b.openPrice), close = number(b.closePrice);
    if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== date || open === null || close === null || open <= 0 || close <= 0) continue;
    bars.push({ date, open, close });
  }
  return bars.sort((a, b) => a.date.localeCompare(b.date));
}

export function parseIndexQuote(json: unknown): IndexQuote {
  if (!row(json)) return { changePct: null, changeAbs: null, tradedAt: null };
  const at = typeof json.localTradedAt === 'string' ? Date.parse(json.localTradedAt) : NaN;
  return { changePct: number(json.fluctuationsRatio), changeAbs: number(json.fluctuations) ?? number(json.compareToPreviousClosePrice), tradedAt: Number.isFinite(at) ? at : null };
}

export function parseMarketStatus(json: unknown): string | null {
  if (!row(json) || !Array.isArray(json.datas) || !row(json.datas[0])) return null;
  return typeof json.datas[0].marketStatus === 'string' ? json.datas[0].marketStatus : null;
}

export async function naverGet(ctx: Pick<Ctx, 'fetch' | 'sleep'>, url: string): Promise<unknown> {
  await ctx.sleep(100);
  const res = await ctx.fetch(url, { headers: { 'User-Agent': NAVER_UA } });
  if (!res.ok) throw new Error(`naver ${res.status}`);
  return res.json();
}

const BASE = 'https://api.stock.naver.com';
const dayQuery = (from: string, to: string) => `startDateTime=${encodeURIComponent(from)}&endDateTime=${encodeURIComponent(to)}`;
export const NAVER = {
  futuresWeek: (sym: 'ES' | 'NQ'): string => `${BASE}/chart/foreign/futures/${sym}cv1?periodType=week`,
  futuresDay: (sym: 'ES' | 'NQ', from: string, to: string): string => `${BASE}/chart/foreign/futures/${sym}cv1/day?${dayQuery(from, to)}`,
  itemWeek: (code: string): string => `${BASE}/chart/domestic/item/${encodeURIComponent(code)}?periodType=week`,
  itemDay: (code: string, from: string, to: string): string => `${BASE}/chart/domestic/item/${encodeURIComponent(code)}/day?${dayQuery(from, to)}`,
  marketIndex: (kind: 'oil' | 'rate' | 'dollar'): string => `${BASE}/marketindex/${({ oil: 'energy/CLcv1', rate: 'bond/US10YT=RR', dollar: 'exchange/.DXY' })[kind]}`,
  kospiStatus: 'https://polling.finance.naver.com/api/realtime/domestic/index/KOSPI',
};
