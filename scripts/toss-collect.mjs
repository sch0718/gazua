// 수집 스크립트용 토스 클라이언트(종목·지수 일봉만). 설계: docs/superpowers/specs/2026-11-06-toss-collect-design.md
// 키·토큰은 메모리에만 두고, 오류 메시지·로그에는 상태 코드만 쓴다(응답 본문은 옮기지 않는다).
// 응답 모양은 docs/live-check.md ㉝, src/lib/providers/toss.ts와 같다.
import { KisError as CollectError } from './kis-collect.mjs';

export const BASE_URL = 'https://openapi.tossinvest.com';
// 실측(㉝)에서 초당 약 2.5건에도 429가 났다. 첫 수집 전이라 그보다 낮게 시작하고 --rate로 바꾼다
export const RATE_PER_SEC = 2;
const MAX_ATTEMPTS = 6;
const BACKOFF_MS = [2000, 4000, 8000, 16000, 30000];
const REQUEST_TIMEOUT_MS = 20_000;
const PAGE_SIZE = '200';
const MAX_PAGES = 30; // 200개 × 30쪽 ≈ 24년. 10년 상한을 넉넉히 넘는다
const INDEX_IDS = new Set(['KOSPI', 'KOSDAQ']);
const KST_MS = 9 * 3_600_000;

const compact = (d) => d.replaceAll('-', '');
const dashed = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
const kstDate = (ms) => new Date(ms + KST_MS).toISOString().slice(0, 10).replaceAll('-', '');
const num = (v) => (v === undefined || v === null || v === '' ? undefined : Number.isFinite(Number(v)) ? Number(v) : undefined);

/**
 * @param {{ clientId: string; clientSecret: string; fetchImpl?: typeof fetch; now?: () => number;
 *   sleep?: (ms: number) => Promise<void>; perSecond?: number }} o
 */
export function createTossClient({ clientId, clientSecret, fetchImpl = fetch, now = Date.now, sleep, perSecond = RATE_PER_SEC }) {
  const wait = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const gap = 1000 / perSecond;
  let lastAt = -Infinity;
  let tokenPromise = null;
  let tokenValue = '';

  const scrub = (msg) => {
    let out = String(msg);
    for (const secret of [clientId, clientSecret, tokenValue]) if (secret) out = out.split(secret).join('***');
    return out.replace(/Bearer\s+\S+/gi, 'Bearer ***');
  };
  // fetch가 던진 오류는 메시지에 헤더 값이 들어 있을 수 있어 이름만 남긴다
  const netFail = (e, fatal) => new CollectError(`요청 실패 (${scrub(e instanceof Error ? e.name : 'Error')})`, { fatal });

  // 요청 사이를 1/perSecond초 이상 띄운다
  async function pace() {
    const t = now();
    if (t < lastAt + gap) await wait(lastAt + gap - t);
    lastAt = now();
  }

  async function readJson(res) {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  // 토스는 키 하나에 토큰 하나라 실행당 한 번만 받는다(앱과 같은 키면 앱의 토큰이 무효가 된다)
  async function issueToken() {
    await pace();
    let res;
    try {
      res = await fetchImpl(`${BASE_URL}/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      throw netFail(e, true);
    }
    const json = await readJson(res);
    const token = json && typeof json.access_token === 'string' ? json.access_token : '';
    if (!res.ok || !token) throw new CollectError(`토스 토큰 발급 실패 (응답 ${res.status}). 허용 IP에서 실행했는지, 키가 맞는지 확인해 주세요`, { fatal: true });
    tokenValue = token;
    return token;
  }
  const getToken = () => (tokenPromise ??= issueToken());

  async function get(path, query) {
    let token = await getToken();
    let reissued = false;
    const url = `${BASE_URL}${path}?${new URLSearchParams(query)}`;
    for (let attempt = 1; ; attempt++) {
      await pace();
      let res;
      let json;
      try {
        res = await fetchImpl(url, { method: 'GET', headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
        json = await readJson(res);
      } catch (e) {
        if (attempt >= MAX_ATTEMPTS) throw netFail(e, false);
        await wait(BACKOFF_MS[0]);
        continue;
      }
      if (res.status === 429) {
        if (attempt >= MAX_ATTEMPTS) throw new CollectError(`호출 한도 초과 (${attempt}번 시도). --rate를 낮춰 보세요`);
        // Retry-After가 없는 경우가 많아(㉝) 점점 길게 기다린다
        const after = Number(res.headers.get('retry-after')) * 1000;
        await wait(after > 0 ? after : BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)]);
        continue;
      }
      // 긴 수집 중 토큰이 만료됐을 수 있어 401이면 한 번만 새로 받아 다시 한다
      if (res.status === 401 && !reissued) {
        reissued = true;
        if (tokenPromise && (await tokenPromise) === token) tokenPromise = null;
        token = await getToken();
        continue;
      }
      // 5xx는 일시적일 수 있어 네트워크 오류처럼 다시 시도한다
      if (res.status >= 500 && attempt < MAX_ATTEMPTS) {
        await wait(BACKOFF_MS[0]);
        continue;
      }
      if (!res.ok) throw new CollectError(`토스 응답 ${res.status}`, { fatal: res.status === 401 || res.status === 403 });
      // 200인데 목록이 없으면 빈 페이지로 오해하지 않고 다시 받는다
      if (!Array.isArray(json?.result?.candles)) {
        if (attempt >= MAX_ATTEMPTS) throw new CollectError('응답 형식이 올바르지 않아요');
        await wait(BACKOFF_MS[0]);
        continue;
      }
      return json.result;
    }
  }

  // 최신순 페이지를 nextBefore(다음 페이지 첫 봉 시각, 포함)로 넘기며 from에 닿을 때까지 받는다
  async function paged(path, baseQuery, from, to) {
    const f = compact(from);
    const t = compact(to);
    const rows = new Map();
    let before = `${dashed(t)}T23:59:59+09:00`;
    let finished = false;
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = await get(path, { ...baseQuery, interval: '1d', count: PAGE_SIZE, before });
      let added = 0;
      let oldest = '';
      for (const raw of body.candles) {
        const ms = Date.parse(raw?.timestamp);
        if (Number.isNaN(ms)) continue;
        const d = kstDate(ms);
        if (oldest === '' || d < oldest) oldest = d;
        if (rows.has(d)) continue;
        added++;
        const [o, h, l, c, v] = [num(raw.openPrice), num(raw.highPrice), num(raw.lowPrice), num(raw.closePrice), num(raw.volume)];
        // 가격이 0 이하이거나 숫자가 아닌 행(거래정지일 등)은 날짜만 세고 버린다
        rows.set(d, [o, h, l, c].some((x) => x === undefined || x <= 0) ? null : { d, o, h, l, c, v: v ?? 0 });
      }
      const next = typeof body.nextBefore === 'string' && body.nextBefore !== '' ? body.nextBefore : null;
      // 빈 페이지·nextBefore 없음(상장일)·from 도달이면 끝
      if (body.candles.length === 0 || next === null || (oldest !== '' && oldest <= f)) {
        finished = true;
        break;
      }
      // 행은 있는데 새 날짜가 없으면 같은 페이지가 되풀이된 것: 앞 기록을 자르지 않고 그 종목을 실패로 둔다
      if (added === 0) throw new CollectError('일봉 페이지가 더 진행되지 않아요');
      before = next;
    }
    if (!finished) throw new CollectError(`일봉 페이지 한도(${MAX_PAGES})에 닿았어요`);
    return [...rows.values()].filter((r) => r && r.d >= f && r.d <= t).sort((a, b) => (a.d < b.d ? -1 : 1));
  }

  const columns = (rows, keys) => Object.fromEntries(keys.map((k) => [k, rows.map((r) => r[k])]));

  return {
    scrub,
    /** 종목 일봉(수정주가) → 열 지향 { d,o,h,l,c,v,tv }. 토스에는 거래대금이 없어 종가×거래량으로 근사한다 */
    async dailyCandles(symbol, from, to) {
      const rows = await paged('/api/v1/candles', { symbol, adjusted: 'true' }, from, to);
      for (const r of rows) r.tv = Math.round(r.c * r.v);
      return columns(rows, ['d', 'o', 'h', 'l', 'c', 'v', 'tv']);
    },
    /** 지수 일봉 → 열 지향 { d,o,c } */
    async indexDaily(id, from, to) {
      if (!INDEX_IDS.has(id)) throw new CollectError(`알 수 없는 지수: ${id}`);
      const rows = await paged(`/api/v1/market-indicators/${id}/candles`, {}, from, to);
      return columns(rows, ['d', 'o', 'c']);
    },
  };
}
