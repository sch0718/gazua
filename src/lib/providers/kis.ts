import type { Candle } from '../data/metrics';
import type { Priority, RequestQueue } from '../data/requestQueue';
import type { SecurityType, TradingDay } from '../market/sessions';
import type { Venue } from '../market/tradable';
import { addDays, kstDate, kstEpoch, kstMinuteOfDay } from '../time/kst';
import { createTokenManager } from './auth';
import { ApiError, kisBodyCode } from './errors';
import type { ProxyClient, ProxyResponse } from './http';
import type { CandleQuery, MarketDataProvider, Quote, StockMeta, TokenInfo, TokenStore } from './types';

/**
 * `stck_cntg_hour`가 봉의 끝 시각이면 true (09:01:00 → 09:00 봉).
 * 실연결 점검(Task 21)에서 시작 시각으로 밝혀지면 false로 바꾼다. 분봉 시각 해석은 이 상수 한 곳에서만 한다.
 */
export const KIS_MINUTE_TIME_IS_BAR_END = true;

/** 지수 분봉처럼 KIS가 과거 날짜를 주지 않는 요청. */
export class UnsupportedRangeError extends Error {
  constructor(message = 'unsupported range') {
    super(message);
    this.name = 'UnsupportedRangeError';
  }
}

export interface KisDeps {
  client: ProxyClient;
  queue: RequestQueue;
  creds: { appKey: string; appSecret: string };
  tokenStore: TokenStore;
  now: () => number;
}

const QUOTATIONS = '/uapi/domestic-stock/v1/quotations';
const QUEUE_GROUP = 'kis';

const TR = {
  price: 'FHKST01010100',
  daily: 'FHKST03010100',
  minute: 'FHKST03010230',
  stockInfo: 'CTPF1002R',
  holiday: 'CTCA0903R',
  indexDaily: 'FHKUP03500100',
  indexMinute: 'FHKUP03500200',
} as const;

const MARKET_DIV: Record<Venue, string> = { KRX: 'J', NXT: 'NX', UNIFIED: 'UN' };
const INDEX_CODE = { KOSPI: '0001', KOSDAQ: '1001' } as const;

const MINUTE_FIRST_HOUR = '200000';
const MINUTE_MAX_PAGES = 10;
const DAILY_MAX_PAGES = 40;
const HOLIDAY_MAX_PAGES = 10;
const MIN_MINUTE_OF_DAY = 8 * 60;
const MAX_MINUTE_OF_DAY = 19 * 60 + 59;
const MINUTE_MS = 60_000;

type Row = Record<string, unknown>;

function isRecord(v: unknown): v is Row {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const text = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/** 첫 번째로 유한한 숫자로 읽히는 필드. */
function num(row: Row, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const s = text(row[k]).trim();
    if (s === '') continue;
    const n = Number(s);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

const compact = (date: string): string => date.replaceAll('-', '');

/** `YYYYMMDD` → `YYYY-MM-DD`, 형식이 다르면 null. */
function dashed(yyyymmdd: string): string | null {
  return /^\d{8}$/.test(yyyymmdd) ? `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6)}` : null;
}

function upstream(message: string): ApiError {
  // HTTP는 성공이었으므로 status를 달아 큐의 재시도 대상(5xx·무상태)에서 뺀다.
  return new ApiError('upstream', message, { status: 200 });
}

function outputRows(json: unknown, field: string): Row[] {
  const v = isRecord(json) ? json[field] : undefined;
  return Array.isArray(v) ? v.filter(isRecord) : [];
}

function outputObject(json: unknown, field: string): Row {
  const v = isRecord(json) ? json[field] : undefined;
  if (!isRecord(v)) throw upstream('KIS response missing output');
  return v;
}

/** rt_cd가 있고 '0'이 아니면 오류. 메시지는 msg_cd만 쓴다(키·계정 정보가 섞일 수 없게). */
function checkBody(json: unknown): void {
  if (!isRecord(json)) throw upstream('KIS response is not JSON');
  if ('rt_cd' in json && json.rt_cd !== '0') {
    const mapped = kisBodyCode(json.msg_cd);
    if (mapped !== undefined) throw new ApiError(mapped, undefined, { status: 200 });
    const code = text(json.msg_cd).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 16);
    throw upstream(code ? `KIS error ${code}` : 'KIS error');
  }
}

/** `stck_cntg_hour`(HHMMSS) → 봉 시작 epoch ms. 형식이 다르면 null. */
function minuteBarStart(date: string, hhmmss: string): number | null {
  const m = /^(\d{2})(\d{2})\d{2}$/.exec(hhmmss);
  if (!m) return null;
  const t = kstEpoch(date, `${m[1]}:${m[2]}:00`);
  return KIS_MINUTE_TIME_IS_BAR_END ? t - MINUTE_MS : t;
}

/** 봉 시작 → 응답이 `stck_cntg_hour`에 담는 시각(위 상수의 역변환). */
const minuteBarLabel = (start: number): number => (KIS_MINUTE_TIME_IS_BAR_END ? start + MINUTE_MS : start);

/** epoch ms의 KST 시각을 `HHMM00`으로. */
function hhmm00(ms: number): string {
  const m = kstMinuteOfDay(ms);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}${String(m % 60).padStart(2, '0')}00`;
}

function inSessionWindow(t: number): boolean {
  const m = kstMinuteOfDay(t);
  return m >= MIN_MINUTE_OF_DAY && m <= MAX_MINUTE_OF_DAY;
}

function marketOf(id: string): StockMeta['market'] {
  return id === 'STK' ? 'KOSPI' : id === 'KSQ' ? 'KOSDAQ' : 'KR_ETC';
}

function securityTypeOf(group: string): SecurityType {
  switch (group) {
    case 'ST':
      return 'STOCK';
    case 'EF':
      return 'ETF';
    case 'EN':
      return 'ETN';
    case 'RT':
      return 'REIT';
    default:
      return 'OTHER';
  }
}

interface DataCall {
  path: string;
  trId: string;
  query: Record<string, string>;
  priority: Priority;
  trCont?: string;
}

interface DailyRow {
  date: string;
  candle: Candle;
}

interface DailyPlan {
  path: string;
  trId: string;
  query: Record<string, string>;
  mapRow(row: Row): DailyRow | null;
}

/** 같은 날의 값이 페이지마다 다르다 — 조회 도중 데이터가 바뀐 것. */
class PageInconsistency extends Error {}

function mapDailyRow(row: Row): DailyRow | null {
  const date = dashed(text(row.stck_bsop_date));
  // 지수 응답은 bstp_nmix_* 필드를 쓴다.
  const o = num(row, 'stck_oprc', 'bstp_nmix_oprc');
  const h = num(row, 'stck_hgpr', 'bstp_nmix_hgpr');
  const l = num(row, 'stck_lwpr', 'bstp_nmix_lwpr');
  const c = num(row, 'stck_clpr', 'bstp_nmix_prpr');
  if (!date || o === undefined || h === undefined || l === undefined || c === undefined) return null;
  const candle: Candle = { t: kstEpoch(date, '00:00:00'), o, h, l, c, v: num(row, 'acml_vol') ?? 0 };
  const value = num(row, 'acml_tr_pbmn');
  if (value !== undefined) candle.value = value;
  return { date, candle };
}

function mapMinuteRow(row: Row, date: string): Candle | null {
  const t = minuteBarStart(date, text(row.stck_cntg_hour));
  const o = num(row, 'stck_oprc', 'bstp_nmix_oprc');
  const h = num(row, 'stck_hgpr', 'bstp_nmix_hgpr');
  const l = num(row, 'stck_lwpr', 'bstp_nmix_lwpr');
  const c = num(row, 'stck_prpr', 'bstp_nmix_prpr');
  if (t === null || o === undefined || h === undefined || l === undefined || c === undefined) return null;
  return { t, o, h, l, c, v: num(row, 'cntg_vol') ?? 0 };
}

function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** `/oauth2/tokenP` 응답 → 토큰. 모양이 틀리면 null. 만료 시각은 KST 문자열이다. */
export function parseKisToken(json: unknown): TokenInfo | null {
  const accessToken = isRecord(json) ? text(json.access_token) : '';
  const expired = isRecord(json) ? /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(text(json.access_token_token_expired)) : null;
  if (!accessToken || !expired) return null;
  return { accessToken, expiresAt: kstEpoch(expired[1], expired[2]) };
}

export function createKisProvider(deps: KisDeps): MarketDataProvider {
  const { client, queue, creds, now } = deps;

  async function issueToken(): Promise<TokenInfo> {
    const res = await client.request('kis', 'POST', '/oauth2/tokenP', {
      body: { grant_type: 'client_credentials', appkey: creds.appKey, appsecret: creds.appSecret },
    });
    const token = parseKisToken(res.json);
    if (!token) throw upstream('KIS token response is malformed');
    return token;
  }

  const tokens = createTokenManager(issueToken, deps.tokenStore, now);
  let lastInvalidated: string | undefined;

  /** 큐를 거치는 데이터 호출. token-expired면 토큰을 버리고 한 번만 다시 시도한다. */
  async function data(call: DataCall): Promise<ProxyResponse> {
    const key = `${call.trId}|${JSON.stringify(call.query)}|${call.trCont ?? ''}`;
    let usedToken: string | undefined;
    const attempt = (suffix: string): Promise<ProxyResponse> =>
      queue.run(QUEUE_GROUP, key + suffix, call.priority, async () => {
        const accessToken = await tokens.get();
        usedToken = accessToken;
        const headers: Record<string, string> = {
          authorization: `Bearer ${accessToken}`,
          appkey: creds.appKey,
          appsecret: creds.appSecret,
          tr_id: call.trId,
          custtype: 'P',
          'content-type': 'application/json; charset=utf-8',
        };
        if (call.trCont) headers.tr_cont = call.trCont;
        const res = await client.request('kis', 'GET', call.path, { query: call.query, headers });
        checkBody(res.json);
        return res;
      });
    try {
      return await attempt('');
    } catch (e) {
      if (!(e instanceof ApiError) || e.code !== 'token-expired') throw e;
      // 같은 토큰으로 동시에 실패한 호출들이 서로의 재발급을 지우지 않게, 토큰당 한 번만 무효화한다.
      if (usedToken === undefined || usedToken !== lastInvalidated) {
        lastInvalidated = usedToken;
        tokens.invalidate();
      }
      return attempt('|retry');
    }
  }

  async function dailyOnce(plan: DailyPlan, from: string, to: string): Promise<Map<string, DailyRow>> {
    const rows = new Map<string, DailyRow>();
    let cursor = compact(to);
    for (let page = 0; page < DAILY_MAX_PAGES; page++) {
      const res = await data({
        path: plan.path,
        trId: plan.trId,
        query: { ...plan.query, FID_INPUT_DATE_1: compact(from), FID_INPUT_DATE_2: cursor },
        priority: 1,
      });
      const parsed = outputRows(res.json, 'output2')
        .map(plan.mapRow)
        .filter((r): r is DailyRow => r !== null);
      let added = 0;
      let oldest = '';
      for (const r of parsed) {
        const prev = rows.get(r.date);
        if (prev) {
          if (prev.candle.c !== r.candle.c) throw new PageInconsistency();
        } else {
          rows.set(r.date, r);
          added++;
        }
        if (oldest === '' || r.date < oldest) oldest = r.date;
      }
      if (added === 0 || oldest <= from) break;
      cursor = compact(oldest); // 하루 겹치게 당겨서 페이지 경계의 누락을 막고 겹친 날로 정합성을 본다.
    }
    return rows;
  }

  async function dailyCandles(plan: DailyPlan, from: string, to: string): Promise<Candle[]> {
    let rows: Map<string, DailyRow>;
    try {
      rows = await dailyOnce(plan, from, to);
    } catch (e) {
      if (!(e instanceof PageInconsistency)) throw e;
      try {
        rows = await dailyOnce(plan, from, to);
      } catch (e2) {
        if (e2 instanceof PageInconsistency) throw upstream('KIS daily pages are inconsistent');
        throw e2;
      }
    }
    return [...rows.values()]
      .filter((r) => r.date >= from && r.date <= to)
      .map((r) => r.candle)
      .sort((a, b) => a.t - b.t);
  }

  async function stockMinuteCandles(q: CandleQuery): Promise<Candle[]> {
    if (q.from !== q.to) throw new UnsupportedRangeError('KIS minute candles are fetched one day at a time');
    const date = q.from;
    const byT = new Map<number, Candle>();
    let hour = MINUTE_FIRST_HOUR;
    for (let page = 0; page < MINUTE_MAX_PAGES; page++) {
      const res = await data({
        path: `${QUOTATIONS}/inquire-time-dailychartprice`,
        trId: TR.minute,
        query: {
          FID_COND_MRKT_DIV_CODE: MARKET_DIV[q.venue],
          FID_INPUT_ISCD: q.symbol,
          FID_INPUT_DATE_1: compact(date),
          FID_INPUT_HOUR_1: hour,
          FID_PW_DATA_INCU_YN: 'N',
          FID_FAKE_TICK_INCU_YN: '',
        },
        priority: 1,
      });
      const rows = outputRows(res.json, 'output2');
      const ofDate = rows.filter((r) => text(r.stck_bsop_date) === compact(date));
      let oldest: number | null = null;
      for (const r of ofDate) {
        const c = mapMinuteRow(r, date);
        if (!c) continue;
        if (oldest === null || c.t < oldest) oldest = c.t;
        if (inSessionWindow(c.t)) byT.set(c.t, c);
      }
      // 빈 페이지, 다른 날짜로 넘어간 페이지(그날 분량 끝), 08:00 이전까지 내려간 경우는 더 받을 게 없다.
      if (oldest === null || ofDate.length < rows.length || kstMinuteOfDay(oldest) < MIN_MINUTE_OF_DAY) break;
      const next = hhmm00(minuteBarLabel(oldest) - MINUTE_MS);
      if (next >= hour) break;
      hour = next;
    }
    return [...byT.values()].sort((a, b) => a.t - b.t);
  }

  const holidayCache = new Map<string, TradingDay>();
  let holidayCacheDay = '';

  async function loadCalendar(from: string, to: string): Promise<void> {
    const bassDt = compact(from);
    let ctx = { fk: '', nk: '' };
    let trCont: string | undefined;
    for (let page = 0; page < HOLIDAY_MAX_PAGES; page++) {
      const res = await data({
        path: `${QUOTATIONS}/chk-holiday`,
        trId: TR.holiday,
        query: { BASS_DT: bassDt, CTX_AREA_FK: ctx.fk, CTX_AREA_NK: ctx.nk },
        priority: 1,
        trCont,
      });
      let last = '';
      for (const r of outputRows(res.json, 'output')) {
        const date = dashed(text(r.bass_dt));
        if (!date) continue;
        holidayCache.set(date, { date, isOpen: text(r.opnd_yn) === 'Y' });
        if (date > last) last = date;
      }
      const more = ['M', 'F'].includes(res.headers.get('tr_cont') ?? '');
      if (!more || last === '' || last >= to) return;
      const json = isRecord(res.json) ? res.json : {};
      ctx = { fk: text(json.ctx_area_fk), nk: text(json.ctx_area_nk) };
      trCont = 'N';
    }
  }

  async function metaFor(symbol: string): Promise<StockMeta> {
    const [info, price] = await Promise.all([
      data({
        path: `${QUOTATIONS}/search-stock-info`,
        trId: TR.stockInfo,
        query: { PRDT_TYPE_CD: '300', PDNO: symbol },
        priority: 1,
      }),
      data({
        path: `${QUOTATIONS}/inquire-price`,
        trId: TR.price,
        query: { FID_COND_MRKT_DIV_CODE: MARKET_DIV.KRX, FID_INPUT_ISCD: symbol },
        priority: 1,
      }),
    ]);
    const o = outputObject(info.json, 'output');
    const nxtSupported = text(o.cptt_trad_tr_psbl_yn) === 'Y';
    const shares = num(outputObject(price.json, 'output'), 'lstn_stcn');
    const meta: StockMeta = {
      symbol,
      name: text(o.prdt_abrv_name) || symbol,
      market: marketOf(text(o.mket_id_cd)),
      securityType: securityTypeOf(text(o.scty_grp_id_cd)),
      nxtSupported,
      krxSuspended: text(o.tr_stop_yn) === 'Y',
      nxtSuspended: nxtSupported && text(o.nxt_tr_stop_yn) !== '' ? text(o.nxt_tr_stop_yn) === 'Y' : null,
      liquidationTrading: false, // KIS가 주지 않는 필드
    };
    if (shares !== undefined && shares > 0) meta.sharesOutstanding = shares;
    return meta;
  }

  async function quoteFor(symbol: string, venue: Venue): Promise<Quote> {
    const res = await data({
      path: `${QUOTATIONS}/inquire-price`,
      trId: TR.price,
      query: { FID_COND_MRKT_DIV_CODE: MARKET_DIV[venue], FID_INPUT_ISCD: symbol },
      priority: 0,
    });
    const price = num(outputObject(res.json, 'output'), 'stck_prpr');
    if (price === undefined) throw upstream('KIS quote has no price');
    return { symbol, venue, price, ts: now() };
  }

  const provider: MarketDataProvider = {
    id: 'kis',
    getAccessToken: () => tokens.info(),

    capabilities: {
      venues: ['KRX', 'NXT', 'UNIFIED'],
      quoteBatchSize: 1,
      hasIndexCandles: true,
      indexMinutePastDays: false,
    },

    getStockMeta: (symbols) => Promise.all(symbols.map(metaFor)),

    getQuotes: (symbols, venue) => Promise.all(symbols.map((s) => quoteFor(s, venue))),

    async getCandles(q) {
      if (q.interval === '1m') return stockMinuteCandles(q);
      return dailyCandles(
        {
          path: `${QUOTATIONS}/inquire-daily-itemchartprice`,
          trId: TR.daily,
          query: {
            FID_COND_MRKT_DIV_CODE: MARKET_DIV[q.venue],
            FID_INPUT_ISCD: q.symbol,
            FID_PERIOD_DIV_CODE: 'D',
            FID_ORG_ADJ_PRC: '0',
          },
          mapRow: mapDailyRow,
        },
        q.from,
        q.to,
      );
    },

    async getTradingDays(from, to) {
      const today = kstDate(now());
      if (today !== holidayCacheDay) {
        holidayCache.clear();
        holidayCacheDay = today;
      }
      const wanted = datesBetween(from, to);
      if (wanted.some((d) => !holidayCache.has(d))) await loadCalendar(from, to);
      return wanted.flatMap((d) => {
        const day = holidayCache.get(d);
        return day ? [{ ...day }] : [];
      });
    },

    async getIndexCandles(index, interval, from, to) {
      const iscd = INDEX_CODE[index];
      if (interval === '1d') {
        return dailyCandles(
          {
            path: `${QUOTATIONS}/inquire-daily-indexchartprice`,
            trId: TR.indexDaily,
            query: { FID_COND_MRKT_DIV_CODE: 'U', FID_INPUT_ISCD: iscd, FID_PERIOD_DIV_CODE: 'D' },
            mapRow: mapDailyRow,
          },
          from,
          to,
        );
      }
      // 지수 분봉 TR에는 날짜 파라미터가 없어 당일만 받을 수 있다.
      const today = kstDate(now());
      if (from !== today || to !== today) throw new UnsupportedRangeError('KIS index minute candles are available for today only');
      const res = await data({
        path: `${QUOTATIONS}/inquire-time-indexchartprice`,
        trId: TR.indexMinute,
        query: {
          FID_COND_MRKT_DIV_CODE: 'U',
          FID_ETC_CLS_CODE: '0',
          FID_INPUT_ISCD: iscd,
          FID_INPUT_HOUR_1: '60', // 봉 간격(초)
          FID_PW_DATA_INCU_YN: 'N',
        },
        priority: 1,
      });
      const byT = new Map<number, Candle>();
      for (const r of outputRows(res.json, 'output2')) {
        if (text(r.stck_bsop_date) !== compact(today)) continue;
        const c = mapMinuteRow(r, today);
        if (c && inSessionWindow(c.t)) byT.set(c.t, c);
      }
      return [...byT.values()].sort((a, b) => a.t - b.t);
    },
  };
  return provider;
}
