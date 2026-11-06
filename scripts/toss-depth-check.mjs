// 토스로 시장 파일을 수집할 수 있는지 보려고 과거 깊이를 재요(docs/live-check.md ㉝). 앱 코드는 바꾸지 않아요.
// 키는 환경변수로만 받아요: node --env-file=.env.toss scripts/toss-depth-check.mjs
// 토스는 허용 IP에서만 호출되니 허용 IP로 등록한 기기에서 돌려요. 원본 응답 일부는 data/live-check/(커밋 안 됨)에 남겨요.
// 앱과 같은 키로 토큰을 받으면 앱의 토큰이 무효가 돼요. 끝나면 앱에서 다시 연결해요.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'https://openapi.tossinvest.com';
const OUT = join(import.meta.dirname, '..', 'data', 'live-check', `toss-depth-${new Date().toISOString().slice(0, 10)}`);
// 일봉 200개 × 15쪽 ≈ 12년, 매매동향 100일 × 20쪽 ≈ 8년. 5년 수집에 필요한 깊이를 넉넉히 넘게 잡아요.
const CANDLE_PAGES = 15;
const FLOW_PAGES = 20;

const { TOSS_CLIENT_ID: id, TOSS_CLIENT_SECRET: secret } = process.env;
if (!id || !secret) {
  console.error('TOSS_CLIENT_ID와 TOSS_CLIENT_SECRET을 환경변수로 넣어 주세요(.env.toss + --env-file).');
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
const save = (name, json) => writeFileSync(join(OUT, `${name}.json`), JSON.stringify(json, null, 2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function token() {
  const res = await fetch(`${BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.access_token) {
    console.error(`토큰 발급 실패: ${res.status}`, JSON.stringify(json));
    process.exit(1);
  }
  return json.access_token;
}

const access = await token();

const retries = { count: 0, waits: [] };

async function get(path, query) {
  const url = `${BASE}${path}?${new URLSearchParams(query)}`;
  for (let attempt = 0; ; attempt++) {
    await sleep(400);
    const res = await fetch(url, { headers: { authorization: `Bearer ${access}` } });
    const json = await res.json().catch(() => null);
    // 429면 Retry-After(없으면 2초씩 늘려)만큼 기다렸다 다시 해요. 깊이를 재는 게 목적이라 한도에서 멈추면 안 돼요.
    if (res.status === 429 && attempt < 6) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 2000 * (attempt + 1);
      retries.count++;
      retries.waits.push(wait);
      await sleep(wait);
      continue;
    }
    return { status: res.status, json };
  }
}

const years = (from, to) => (from && to ? Math.round(((Date.parse(to) - Date.parse(from)) / 864e5 / 365.25) * 10) / 10 : null);

/** before 페이지네이션으로 일봉을 끝까지(또는 maxPages까지) 거슬러 받아요. */
async function candleDepth(name, path, query) {
  let before;
  let total = 0;
  let newest = null;
  let oldest = null;
  let pages = 0;
  let stop = 'page-limit';
  const statuses = new Set();
  for (; pages < CANDLE_PAGES; pages++) {
    const r = await get(path, { ...query, interval: '1d', count: '200', ...(before ? { before } : {}) });
    statuses.add(r.status);
    if (pages === 0) save(`${name}-page1`, r.json);
    if (r.status !== 200) { stop = `http-${r.status}`; break; }
    const candles = Array.isArray(r.json?.result?.candles) ? r.json.result.candles : [];
    if (candles.length === 0) { stop = 'empty'; break; }
    total += candles.length;
    newest ??= candles[0].timestamp;
    oldest = candles.at(-1).timestamp;
    before = r.json.result.nextBefore;
    if (!before) { stop = 'no-nextBefore'; pages++; break; }
  }
  return { statuses: [...statuses], pages, bars: total, newest, oldest, years: years(oldest, newest), stop };
}

/** until 페이지네이션으로 투자자별 매매동향을 거슬러 받아요. */
async function flowDepth(symbol) {
  let until;
  let total = 0;
  let newest = null;
  let oldest = null;
  let sample = null;
  let pages = 0;
  let stop = 'page-limit';
  const statuses = new Set();
  for (; pages < FLOW_PAGES; pages++) {
    const r = await get(`/api/v1/stocks/${symbol}/investor-trading`, { count: '100', ...(until ? { until } : {}) });
    statuses.add(r.status);
    if (pages === 0) save(`flow-${symbol}-page1`, r.json);
    if (r.status !== 200) { stop = `http-${r.status}`; break; }
    const records = Array.isArray(r.json?.result?.records) ? r.json.result.records : [];
    if (records.length === 0) { stop = 'empty'; break; }
    total += records.length;
    newest ??= records[0].date;
    oldest = records.at(-1).date;
    // 마지막 기록이 아닌, 확정된 하루치를 단위 확인용으로 남겨요.
    sample ??= records[1] ?? records[0];
    until = r.json.result.nextUntil;
    if (!until) { stop = 'no-nextUntil'; pages++; break; }
  }
  return { statuses: [...statuses], pages, days: total, newest, oldest, years: years(oldest, newest), stop, sample };
}

const report = { checkedAt: new Date().toISOString() };

// 오래된 대형주, 2022년 상장주(상장일 앞에서 어떻게 끝나는지), 수정주가 끈 경우
report.candles = {
  '005930': await candleDepth('candles-005930', '/api/v1/candles', { symbol: '005930' }),
  '373220': await candleDepth('candles-373220', '/api/v1/candles', { symbol: '373220' }),
  '005930-unadjusted': await candleDepth('candles-005930-unadj', '/api/v1/candles', { symbol: '005930', adjusted: 'false' }),
};
report.indexCandles = {
  KOSPI: await candleDepth('index-KOSPI', '/api/v1/market-indicators/KOSPI/candles', {}),
  KOSDAQ: await candleDepth('index-KOSDAQ', '/api/v1/market-indicators/KOSDAQ/candles', {}),
};
report.investorTrading = { '005930': await flowDepth('005930') };
report.retries429 = retries;

save('summary', report);
console.log(JSON.stringify(report, null, 2));
console.log(`\n원본 일부와 요약: ${OUT}`);
