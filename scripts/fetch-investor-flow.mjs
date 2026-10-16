// 종목별 투자자(외국인·기관·개인) 일별 순매수 대금을 받아 일봉 날짜에 맞춘다.
import { prevDay } from './kis-collect.mjs';

const QUOTATIONS = '/uapi/domestic-stock/v1/quotations';

// 주의: 아래 값은 아직 실제 응답으로 확인하지 못했다. live-check ㉓에서 확인한다
// (경로·TR·쿼리 이름·응답 필드 이름·금액 단위 "백만 원" 가정).
export const FLOW_API = {
  path: `${QUOTATIONS}/investor-trade-by-stock-daily`,
  trId: 'FHPTJ04160001',
  // 기준일은 FID_INPUT_DATE_1에 넣는다
  query: (symbol, date) => ({
    FID_COND_MRKT_DIV_CODE: 'J',
    FID_INPUT_ISCD: symbol,
    FID_INPUT_DATE_1: date,
    FID_ORG_ADJ_PRC: '',
    FID_ETC_CLS_CODE: '',
  }),
  output: 'output2',
  fields: { date: 'stck_bsop_date', f: 'frgn_ntby_tr_pbmn', i: 'orgn_ntby_tr_pbmn', p: 'prsn_ntby_tr_pbmn' },
  unit: '백만 원', // 가정
};

const MAX_PAGES = 200;

// 숫자가 아니면 undefined. -0은 0으로 만든다.
function toInt(v) {
  if (v === undefined || v === null || String(v).trim() === '') return undefined;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n) + 0 : undefined;
}

/**
 * 기준일을 to로 두고 과거로 넘기며 from까지 받는다. 날짜 오름차순.
 * @param {{ get: (path: string, trId: string, query: Record<string,string>, o?: object) => Promise<any> }} client
 * @param {string} symbol
 * @param {{ from: string; to: string }} range YYYYMMDD
 * @returns {Promise<{ d: string; f: number; i: number; p: number }[]>}
 */
export async function fetchInvestorFlow(client, symbol, { from, to }) {
  const F = FLOW_API.fields;
  const rows = new Map();
  let cursor = to;
  let prevOldest = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const json = await client.get(FLOW_API.path, FLOW_API.trId, FLOW_API.query(symbol, cursor), { expectArray: FLOW_API.output });
    const out = Array.isArray(json?.[FLOW_API.output]) ? json[FLOW_API.output] : [];
    if (out.length === 0) break;
    let oldest = '';
    for (const raw of out) {
      const d = typeof raw?.[F.date] === 'string' && /^\d{8}$/.test(raw[F.date]) ? raw[F.date] : '';
      if (!d) continue;
      if (oldest === '' || d < oldest) oldest = d;
      const [f, i, p] = [toInt(raw[F.f]), toInt(raw[F.i]), toInt(raw[F.p])];
      if (f === undefined || i === undefined || p === undefined) continue;
      if (!rows.has(d)) rows.set(d, { d, f, i, p });
    }
    // 가장 오래된 날이 커서보다 과거가 아니면(되풀이·오작동) 멈춘다
    if (oldest === '' || oldest >= cursor || oldest === prevOldest || oldest <= from) break;
    prevOldest = oldest;
    cursor = prevDay(oldest);
  }
  return [...rows.values()].filter((r) => r.d >= from && r.d <= to).sort((a, b) => (a.d < b.d ? -1 : 1));
}

/**
 * 수급 행을 일봉 날짜에 맞춘다. 마지막 수급 행에서 거꾸로 이어지는 구간만 남긴다:
 * 중간에 빈 날이 있으면 from을 그 다음으로 옮기고, 마지막 수급 행 뒤의 일봉은 구간 밖으로 둔다.
 * @param {string[]} barDates 오름차순
 * @param {{ d: string; f: number; i: number; p: number }[]} rows
 * @returns {{ from: string; f: number[]; i: number[]; p: number[] } | null}
 */
export function alignFlow(barDates, rows) {
  const byDate = new Map(rows.map((r) => [r.d, r]));
  let last = -1;
  for (let k = barDates.length - 1; k >= 0; k--) {
    if (byDate.has(barDates[k])) {
      last = k;
      break;
    }
  }
  if (last < 0) return null;
  let first = last;
  while (first > 0 && byDate.has(barDates[first - 1])) first--;
  const seg = barDates.slice(first, last + 1).map((d) => byDate.get(d));
  return { from: barDates[first], f: seg.map((r) => r.f), i: seg.map((r) => r.i), p: seg.map((r) => r.p) };
}
