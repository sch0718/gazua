// 수집 스크립트용 KIS 클라이언트. 프록시 없이 직접 호출한다.
// 키·토큰은 메모리에만 두고, 오류 메시지·로그에는 상태 코드와 msg_cd만 쓴다(응답 본문은 옮기지 않는다).

export const BASE_URL = {
  real: 'https://openapi.koreainvestment.com:9443',
  paper: 'https://openapivts.koreainvestment.com:29443',
};
const QUOTATIONS = '/uapi/domestic-stock/v1/quotations';
const TR = { daily: 'FHKST03010100', indexDaily: 'FHKUP03500100' };
const INDEX_CODE = { KOSPI: '0001', KOSDAQ: '1001' };

export const RATE_PER_SEC = 18; // KIS 한도 20건에 여유
const MAX_ATTEMPTS = 4;
const RATE_WAIT_MS = 1000;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_PAGES = 80;
// 토큰이 틀렸거나 만료된 경우. 다시 시도해도 소용없으니 실행을 멈춘다.
const FATAL_MSG_CD = new Set(['EGW00121', 'EGW00123', 'EGW00102', 'EGW00103', 'EGW00133']);

export class KisError extends Error {
  constructor(message, { fatal = false } = {}) {
    super(message);
    this.name = 'KisError';
    this.fatal = fatal;
  }
}

const compact = (d) => d.replaceAll('-', '');
const safeCode = (x) => (typeof x === 'string' && /^[A-Za-z0-9_]{1,16}$/.test(x) ? x : '');

export function prevDay(yyyymmdd) {
  const t = Date.UTC(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8)) - 86_400_000;
  return new Date(t).toISOString().slice(0, 10).replaceAll('-', '');
}

const num = (row, ...keys) => {
  for (const k of keys) {
    const v = row?.[k];
    if (v === undefined || v === null || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
};

/**
 * @param {{ appKey: string; appSecret: string; paper?: boolean; fetchImpl?: typeof fetch;
 *   now?: () => number; sleep?: (ms: number) => Promise<void>; perSecond?: number }} o
 */
export function createKisClient({ appKey, appSecret, paper = false, fetchImpl = fetch, now = Date.now, sleep, perSecond = RATE_PER_SEC }) {
  const wait = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const base = paper ? BASE_URL.paper : BASE_URL.real;
  const stamps = []; // 최근 1초 안에 나간 요청 시각
  let tokenPromise = null;
  let tokenValue = '';

  // 키·시크릿·토큰과 Bearer 값을 가린다. 로그에 나가는 모든 오류 문구가 거친다.
  const scrub = (msg) => {
    let out = String(msg);
    for (const secret of [appKey, appSecret, tokenValue]) if (secret) out = out.split(secret).join('***');
    return out.replace(/Bearer\s+\S+/gi, 'Bearer ***');
  };
  // fetch가 던진 오류는 메시지에 헤더 값이 들어 있을 수 있어 이름만 남긴다.
  const netFail = (e, fatal) => new KisError(`요청 실패 (${scrub(e instanceof Error ? e.name : 'Error')})`, { fatal });

  // 어떤 1초 구간에도 perSecond건을 넘지 않게 한다.
  async function acquire() {
    for (;;) {
      const t = now();
      while (stamps.length && stamps[0] <= t - 1000) stamps.shift();
      if (stamps.length < perSecond) {
        stamps.push(t);
        return;
      }
      await wait(Math.max(1, stamps[0] + 1000 - t));
    }
  }

  // 본문 읽기가 끊기면(시간 초과 등) 그대로 던져 재시도 경로로 보낸다. 형식이 틀린 본문만 null이다.
  async function readJson(res) {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  async function issueToken() {
    await acquire();
    let res;
    try {
      res = await fetchImpl(`${base}/oauth2/tokenP`, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ grant_type: 'client_credentials', appkey: appKey, appsecret: appSecret }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      throw netFail(e, true);
    }
    const json = await readJson(res);
    const token = json && typeof json.access_token === 'string' ? json.access_token : '';
    if (!res.ok || !token) throw new KisError(`토큰 발급 실패 (응답 ${res.status} ${safeCode(json?.error_code)})`.trim(), { fatal: true });
    tokenValue = token;
    return token;
  }

  // 토큰은 실행당 한 번만 발급한다(KIS는 1분에 1회로 제한).
  const getToken = () => (tokenPromise ??= issueToken());

  async function get(path, trId, query, { expectArray = false } = {}) {
    const token = await getToken();
    const url = `${base}${path}?${new URLSearchParams(query)}`;
    for (let attempt = 1; ; attempt++) {
      await acquire();
      let res;
      let json;
      try {
        res = await fetchImpl(url, {
          method: 'GET',
          headers: {
            authorization: `Bearer ${token}`,
            appkey: appKey,
            appsecret: appSecret,
            tr_id: trId,
            custtype: 'P',
            'content-type': 'application/json; charset=utf-8',
          },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        json = await readJson(res);
      } catch (e) {
        // 시간 초과·네트워크 오류는 다시 시도할 수 있는 실패다.
        if (attempt >= MAX_ATTEMPTS) throw netFail(e, false);
        await wait(RATE_WAIT_MS);
        continue;
      }
      const msgCd = safeCode(json?.msg_cd);
      if (res.status === 429 || msgCd === 'EGW00201') {
        if (attempt >= MAX_ATTEMPTS) throw new KisError(`호출 한도 초과 (${attempt}번 시도)`);
        await wait(RATE_WAIT_MS);
        continue;
      }
      if (!res.ok) throw new KisError(`KIS 응답 ${res.status} ${msgCd}`.trim(), { fatal: res.status === 401 || res.status === 403 });
      if (json && json.rt_cd !== undefined && String(json.rt_cd) !== '0') {
        throw new KisError(`KIS 오류 ${msgCd || json.rt_cd}`, { fatal: FATAL_MSG_CD.has(msgCd) });
      }
      // 200인데 본문이 비었거나 목록이 없으면 빈 페이지로 오해하지 않고 다시 받는다.
      if (expectArray && !Array.isArray(json?.[expectArray])) {
        if (attempt >= MAX_ATTEMPTS) throw new KisError('응답 형식이 올바르지 않아요');
        await wait(RATE_WAIT_MS);
        continue;
      }
      return json;
    }
  }

  // 가장 오래된 날짜의 전날로 옮기며 from에 닿을 때까지 받는다. 날짜별로 한 건만 남긴다.
  async function paged(path, trId, baseQuery, from, to, mapRow) {
    const f = compact(from);
    const rows = new Map();
    const seen = new Set();
    let cursor = compact(to);
    let finished = false;
    for (let page = 0; page < MAX_PAGES; page++) {
      const json = await get(path, trId, { ...baseQuery, FID_INPUT_DATE_1: f, FID_INPUT_DATE_2: cursor }, { expectArray: 'output2' });
      const out = Array.isArray(json?.output2) ? json.output2 : [];
      // 진행 여부와 다음 커서는 가격이 유효한지와 무관하게 받은 모든 행의 날짜로 정한다
      // (긴 거래정지로 가격 0인 행만 있는 페이지에서 멈추지 않게).
      let added = 0;
      let oldest = '';
      for (const raw of out) {
        const d = typeof raw?.stck_bsop_date === 'string' && /^\d{8}$/.test(raw.stck_bsop_date) ? raw.stck_bsop_date : '';
        if (!d) continue;
        if (!seen.has(d)) {
          seen.add(d);
          added++;
        }
        if (oldest === '' || d < oldest) oldest = d;
        const r = mapRow(raw);
        if (r && !rows.has(r.d)) rows.set(r.d, r);
      }
      if (added === 0 || oldest <= f) {
        finished = true;
        break;
      }
      cursor = prevDay(oldest);
    }
    // 한도에 닿았는데 from까지 못 받았으면 앞 기록을 조용히 자르지 않고 그 종목을 실패로 둔다
    if (!finished) throw new KisError(`일봉 페이지 한도(${MAX_PAGES})에 닿았어요`);
    return [...rows.values()].filter((r) => r.d >= f && r.d <= compact(to)).sort((a, b) => (a.d < b.d ? -1 : 1));
  }

  // 가격이 0 이하이거나 숫자가 아닌 행(거래정지일 빈 행 등)은 버린다.
  const stockRow = (r) => {
    const d = typeof r?.stck_bsop_date === 'string' ? r.stck_bsop_date : '';
    const [o, h, l, c] = [num(r, 'stck_oprc'), num(r, 'stck_hgpr'), num(r, 'stck_lwpr'), num(r, 'stck_clpr')];
    if (!/^\d{8}$/.test(d) || [o, h, l, c].some((x) => x === undefined || x <= 0)) return null;
    return { d, o, h, l, c, v: num(r, 'acml_vol') ?? 0, tv: num(r, 'acml_tr_pbmn') ?? 0 };
  };
  // 지수 응답은 bstp_nmix_* 필드를 쓴다(kis.ts mapDailyRow와 같다).
  const indexRow = (r) => {
    const d = typeof r?.stck_bsop_date === 'string' ? r.stck_bsop_date : '';
    const [o, c] = [num(r, 'bstp_nmix_oprc'), num(r, 'bstp_nmix_prpr')];
    if (!/^\d{8}$/.test(d) || [o, c].some((x) => x === undefined || x <= 0)) return null;
    return { d, o, c };
  };
  const columns = (rows, keys) => Object.fromEntries(keys.map((k) => [k, rows.map((r) => r[k])]));

  return {
    scrub,
    /** 종목 일봉(수정주가) → 열 지향 { d,o,h,l,c,v,tv } */
    async dailyCandles(symbol, from, to) {
      const rows = await paged(
        `${QUOTATIONS}/inquire-daily-itemchartprice`,
        TR.daily,
        { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: symbol, FID_PERIOD_DIV_CODE: 'D', FID_ORG_ADJ_PRC: '0' },
        from,
        to,
        stockRow,
      );
      return columns(rows, ['d', 'o', 'h', 'l', 'c', 'v', 'tv']);
    },
    /** 지수 일봉 → 열 지향 { d,o,c } */
    async indexDaily(id, from, to) {
      const iscd = INDEX_CODE[id];
      if (!iscd) throw new KisError(`알 수 없는 지수: ${id}`);
      const rows = await paged(
        `${QUOTATIONS}/inquire-daily-indexchartprice`,
        TR.indexDaily,
        { FID_COND_MRKT_DIV_CODE: 'U', FID_INPUT_ISCD: iscd, FID_PERIOD_DIV_CODE: 'D' },
        from,
        to,
        indexRow,
      );
      return columns(rows, ['d', 'o', 'c']);
    },
  };
}
