// 토스 실연결 점검(docs/live-check.md ⑤·⑩·⑫·⑭)에 쓸 응답을 받아 요약해요. 앱 코드는 바꾸지 않아요.
// 키는 환경변수로만 받아요: node --env-file=.env.toss scripts/toss-live-check.mjs
// 토스는 허용 IP에서만 호출되니 허용 IP로 등록한 기기에서 돌려요. 원본 응답은 data/live-check/(커밋 안 됨)에 남겨요.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'https://openapi.tossinvest.com';
const OUT = join(import.meta.dirname, '..', 'data', 'live-check', `toss-${new Date().toISOString().slice(0, 10)}`);

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
    // 응답 본문에 토큰이 없을 때만 그대로 보여 줘요(오류 메시지 확인용).
    console.error(`토큰 발급 실패: ${res.status}`, JSON.stringify(json));
    process.exit(1);
  }
  return json.access_token;
}

const access = await token();

async function get(path, query) {
  // 가장 빡빡한 한도 그룹(MARKET_INFO 초당 3건)에 맞춰 천천히 불러요.
  await sleep(400);
  const url = `${BASE}${path}?${new URLSearchParams(query)}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${access}` } });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

const bars = (r) => (Array.isArray(r.json?.result?.candles) ? r.json.result.candles : []);
const brief = (b) => b && { t: b.timestamp, o: b.openPrice, h: b.highPrice, l: b.lowPrice, c: b.closePrice, v: b.volume };
const report = {};

// ⑤ 캘린더: 평일·주말·공휴일·연말 휴장·새해 첫 거래일(10시 개장)
report.calendar = {};
for (const date of ['2026-10-16', '2026-10-17', '2026-10-18', '2026-10-09', '2026-12-31', '2027-01-04']) {
  const r = await get('/api/v1/market-calendar/KR', { date });
  save(`calendar-${date}`, r.json);
  report.calendar[date] = { status: r.status, result: r.json?.result ?? r.json };
}

// ⑫ 1분봉 두 페이지: 첫 페이지의 가장 오래된 봉과 둘째 페이지의 가장 새 봉, nextBefore
{
  const q = { symbol: '005930', interval: '1m', count: '200' };
  const p1 = await get('/api/v1/candles', q);
  const next = p1.json?.result?.nextBefore;
  const p2 = next ? await get('/api/v1/candles', { ...q, before: next }) : null;
  save('minute-page1', p1.json);
  if (p2) save('minute-page2', p2.json);
  const b1 = bars(p1);
  const b2 = p2 ? bars(p2) : [];
  report.minutePaging = {
    status: [p1.status, p2?.status],
    page1: { count: b1.length, first: brief(b1[0]), last: brief(b1.at(-1)) },
    nextBefore: next ?? null,
    page2: { count: b2.length, first: brief(b2[0]), last: brief(b2.at(-1)) },
  };
}

// ⑩ ETN 코드(Q + 6자리): 시세·종목 정보·일봉·분봉
{
  const symbol = 'Q500023';
  const price = await get('/api/v1/prices', { symbols: symbol });
  const stock = await get('/api/v1/stocks', { symbols: symbol });
  const day = await get('/api/v1/candles', { symbol, interval: '1d', count: '3', adjusted: 'true' });
  const min = await get('/api/v1/candles', { symbol, interval: '1m', count: '3' });
  save('etn', { price: price.json, stock: stock.json, day: day.json, min: min.json });
  report.etn = {
    symbol,
    price: { status: price.status, result: price.json?.result ?? price.json },
    stock: { status: stock.status, result: stock.json?.result ?? stock.json },
    day: { status: day.status, count: bars(day).length, first: brief(bars(day)[0]) },
    minute: { status: min.status, count: bars(min).length, first: brief(bars(min)[0]) },
  };
}

// ⑭ 일봉이 얼마나 오래전까지 오는가: 각 경계 이전 5개 봉을 요청해 가장 오래된 날짜를 봐요.
report.dailyDepth = {};
for (const [name, path, extra] of [
  ['005930', '/api/v1/candles', { symbol: '005930', adjusted: 'true' }],
  ['KOSPI', '/api/v1/market-indicators/KOSPI/candles', {}],
]) {
  report.dailyDepth[name] = {};
  for (const y of ['2000', '2005', '2010', '2015', '2020']) {
    const r = await get(path, { ...extra, interval: '1d', count: '5', before: `${y}-01-10T23:59:59+09:00` });
    const b = bars(r);
    report.dailyDepth[name][`before ${y}-01-10`] = {
      status: r.status,
      count: b.length,
      newest: b[0]?.timestamp ?? null,
      oldest: b.at(-1)?.timestamp ?? null,
      ...(r.status !== 200 ? { error: r.json } : {}),
    };
  }
}

save('report', report);
console.log(JSON.stringify(report, null, 2));
console.log(`\n원본 응답: ${OUT}`);
