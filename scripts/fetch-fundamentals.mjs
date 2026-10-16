// 종목별 재무(손익계산서·대차대조표)를 받아 분기 재무 FinSeries로 만든다(스펙 2.1·2.2).

const FINANCE = '/uapi/domestic-stock/v1/finance';

// 주의: 아래 값은 아직 실제 응답으로 확인하지 못했다(확인 필요 ㉕).
// 경로·TR·쿼리 이름·응답 필드 이름, 금액 단위 "억 원", 분기 손익이 회계연도 누적값이라는 가정,
// 과거 깊이(몇 분기까지 주는지)를 실연결 점검에서 확인하고 여기만 고친다.
export const FIN_API = {
  incomeStatement: { path: `${FINANCE}/income-statement`, trId: 'FHKST66430200' },
  balanceSheet: { path: `${FINANCE}/balance-sheet`, trId: 'FHKST66430100' },
  div: { annual: '0', quarter: '1' }, // FID_DIV_CLS_CODE
  query: (symbol, div) => ({ FID_DIV_CLS_CODE: div, fid_cond_mrkt_div_code: 'J', fid_input_iscd: symbol }),
  output: 'output',
  fields: { ym: 'stac_yymm', rev: 'sale_account', op: 'bsop_prti', ni: 'thtr_ntin', eq: 'total_cptl', debt: 'total_lblt' },
  unit: '억 원', // 가정
  cumulative: true, // 가정: 분기 손익은 회계연도 첫날부터의 누적값
};

const IS_KEYS = ['rev', 'op', 'ni'];
const BS_KEYS = ['eq', 'debt'];

/**
 * 손익·대차를 연간·분기로 한 번씩, 모두 4번 받는다. 응답 행은 그대로 돌려준다.
 * 연간 손익은 회계연도 경계와 결산 분기 값, 연간 대차는 분기 응답에 결산 분기가 없을 때의 대차 값에 쓴다.
 * @param {{ get: (path: string, trId: string, query: Record<string,string>, o?: object) => Promise<any> }} client
 * @param {string} symbol
 */
export async function fetchFundamentals(client, symbol) {
  const get = async ({ path, trId }, div) => {
    const json = await client.get(path, trId, FIN_API.query(symbol, div), { expectArray: FIN_API.output });
    return Array.isArray(json?.[FIN_API.output]) ? json[FIN_API.output] : [];
  };
  const { incomeStatement: IS, balanceSheet: BS, div } = FIN_API;
  const annualIS = await get(IS, div.annual);
  const quarterIS = await get(IS, div.quarter);
  const annualBS = await get(BS, div.annual);
  const quarterBS = await get(BS, div.quarter);
  return { annualIS, quarterIS, annualBS, quarterBS };
}

// YYYYMM ↔ 달 번호
const toMonth = (ym) =>
  typeof ym === 'string' && /^\d{4}(0[1-9]|1[0-2])$/.test(ym) ? Number(ym.slice(0, 4)) * 12 + Number(ym.slice(4)) - 1 : undefined;
const toYm = (m) => `${Math.floor(m / 12)}${String((m % 12) + 1).padStart(2, '0')}`;

function toNum(v) {
  if (v === undefined || v === null || String(v).trim() === '') return undefined;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

// 행 목록 → Map(달 번호 → { key: 값 }). 같은 달이 반복되면 앞 행을 쓴다. 숫자가 아닌 항목은 빠진다.
function byMonth(rows, keys) {
  const F = FIN_API.fields;
  const out = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const m = toMonth(row?.[F.ym]);
    if (m === undefined || out.has(m)) continue;
    const v = {};
    for (const k of keys) v[k] = toNum(row[F[k]]);
    out.set(m, v);
  }
  return out;
}

const round2 = (x) => Math.round(x * 100) / 100 + 0;

/**
 * 손익·대차 응답 행을 분기 재무로 바꾼다.
 * - 회계연도 경계는 연간 손익 행의 stac_yymm(결산 분기)이다. 그 분기는 a = 1.
 * - 연간 행으로 확인된 회계연도만 내보낸다(D10). 가장 이른 연간 행까지, 그리고 12개월 넘게 떨어진
 *   두 연간 행(사이 연간 행이 빠짐)의 뒤 행까지는 버린다. 마지막 연간 행 뒤로는 12개월만 남기고,
 *   그 12개월째 분기를 a = 1(연간 행이 아직 없는 결산 분기)로 둔다.
 * - 결산월 변경으로 회계연도 첫 분기가 3개월보다 짧으면 빈 분기다.
 * - cumulative이면 같은 회계연도 안에서 직전 누적을 빼고, 회계연도 첫 분기는 누적 그대로다.
 *   연간 행이 있는 결산 분기는 연간 값에서 같은 회계연도 직전 누적을 뺀다(분기 응답에 그 분기 누적이 있어도 연간이 우선).
 * - cumulative가 아니면 분기 값을 그대로 쓰고, 결산 분기가 분기 응답에 없으면 연간에서 같은 회계연도 앞 분기 합을 뺀다.
 * - 대차는 분기말 값을 그대로 쓴다. 결산 분기가 분기 대차에 없으면 연간 대차를 쓴다.
 * - 값이 하나라도 없는 분기는 빈 분기다. 3개월 간격으로 이어지는 마지막 구간만 남긴다.
 * @returns {{ q: string[]; a: number[]; rev: number[]; op: number[]; ni: number[]; eq: number[]; debt: number[] } | null}
 */
export function buildFin({ annualIS, quarterIS, quarterBS, annualBS = [] }, { cumulative = FIN_API.cumulative } = {}) {
  const aIS = byMonth(annualIS, IS_KEYS);
  const qIS = byMonth(quarterIS, IS_KEYS);
  const qBS = byMonth(quarterBS, BS_KEYS);
  const aBS = byMonth(annualBS, BS_KEYS);
  const ends = [...aIS.keys()].sort((x, y) => x - y);
  if (ends.length === 0) return null;
  // 확인된 회계연도만 쓴다(D10): 연이은 두 연간 행 사이 (앞, 뒤]가 12개월 이하일 때만 한 회계연도다.
  // 가장 이른 연간 행, 또는 12개월 넘게 떨어진(연간 행이 빠진) 마지막 자리의 뒤 연간 행이 시작 경계다.
  let k0 = 0;
  for (let k = 1; k < ends.length; k++) if (ends[k] - ends[k - 1] > 12) k0 = k;
  const start = ends[k0];
  const last = ends[ends.length - 1];
  const open = last + 12; // 마지막 연간 행 뒤 12개월을 열린 회계연도로 둔다

  // 분기 m(start < m <= open)이 속한 회계연도의 결산 분기(end)와 직전 회계연도의 결산 분기(prevEnd)
  const fyOf = (m) => {
    if (m > last) return { end: open, prevEnd: last };
    const k = ends.findIndex((e) => e >= m);
    return { end: ends[k], prevEnd: ends[k - 1] };
  };

  // 분기 하나의 손익. 구할 수 없으면 undefined
  const income = (m, key) => {
    const { end, prevEnd } = fyOf(m);
    const firstOfFy = m - 3 <= prevEnd;
    const annual = m === end ? aIS.get(m)?.[key] : undefined;
    const q = (x) => qIS.get(x)?.[key];
    if (cumulative) {
      const cum = annual ?? q(m);
      if (cum === undefined) return undefined;
      if (firstOfFy) return cum;
      const prev = q(m - 3);
      return prev === undefined ? undefined : cum - prev;
    }
    if (q(m) !== undefined) return q(m);
    if (annual === undefined) return undefined;
    let rest = annual;
    for (let x = m - 3; x > prevEnd; x -= 3) {
      if (q(x) === undefined) return undefined;
      rest -= q(x);
    }
    return rest;
  };

  const months = [...new Set([...qIS.keys(), ...aIS.keys()])].filter((m) => m > start && m <= open).sort((x, y) => x - y);
  const rows = [];
  for (const m of months) {
    const { end, prevEnd } = fyOf(m);
    // 결산월과 3개월 단위로 맞지 않는 분기, 결산월 변경으로 3개월보다 짧아진 첫 분기는 빈 분기다
    if ((end - m) % 3 !== 0 || m - prevEnd < 3) continue;
    const bsRow = qBS.get(m) ?? (m === end ? aBS.get(m) : undefined);
    const v = {};
    for (const k of IS_KEYS) v[k] = income(m, k);
    for (const k of BS_KEYS) v[k] = bsRow?.[k];
    if ([...IS_KEYS, ...BS_KEYS].some((k) => v[k] === undefined)) continue;
    rows.push({ m, a: m === end ? 1 : 0, ...v });
  }
  if (rows.length === 0) return null;

  let from = rows.length - 1;
  while (from > 0 && rows[from - 1].m === rows[from].m - 3) from--;
  const seg = rows.slice(from);
  const col = (k) => seg.map((r) => round2(r[k]));
  return { q: seg.map((r) => toYm(r.m)), a: seg.map((r) => r.a), rev: col('rev'), op: col('op'), ni: col('ni'), eq: col('eq'), debt: col('debt') };
}
