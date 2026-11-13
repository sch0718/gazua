import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { collect, parseArgs } from '../scripts/collect-market-data.mjs';
import { createTossClient } from '../scripts/toss-collect.mjs';

const ID = 'TOSSID-client-123';
const SECRET = 'TOSSSECRET-456';
const TOKEN = 'TOSSTOKEN-789';

function clock(start = Date.UTC(2026, 9, 16, 3, 0, 0)) {
  let t = start;
  return { now: () => t, sleep: async (ms) => void (t += ms) };
}
const day = (i) => new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
const bars = (n, base = 1000) =>
  Array.from({ length: n }, (_, i) => ({ date: day(i), o: base + i, h: base + 10 + i, l: base - 10 + i, c: base + 5 + i, v: 100 + i }));
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/**
 * 토스 흉내: 최신순으로 before(포함) 이하 봉을 count개씩 주고, 더 있으면 nextBefore에 다음 봉 시각을 준다.
 * data: { symbols: { code: bars }, indices: { KOSPI: bars, KOSDAQ: bars } }
 */
function fakeToss(data, { onData } = {}) {
  const calls = { token: 0, data: [] };
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname === '/oauth2/token') {
      calls.token++;
      return json({ access_token: TOKEN, expires_in: 86400 });
    }
    calls.data.push({ url: u, headers: init.headers });
    const hit = onData?.(u, calls.data.length);
    if (hit) return hit;
    const m = u.pathname.match(/^\/api\/v1\/market-indicators\/(\w+)\/candles$/);
    const rows = m ? data.indices[m[1]] : data.symbols[u.searchParams.get('symbol')];
    if (!rows) return json({ error: 'not found' }, 404);
    const ts = (b) => `${b.date}T00:00:00.000+09:00`;
    const before = u.searchParams.get('before');
    const older = rows.filter((b) => !before || Date.parse(ts(b)) <= Date.parse(before)).reverse();
    const count = Number(u.searchParams.get('count'));
    const page = older.slice(0, count);
    const candles = page.map((b) => ({ timestamp: ts(b), openPrice: String(b.o), highPrice: String(b.h), lowPrice: String(b.l), closePrice: String(b.c), volume: String(b.v), currency: 'KRW' }));
    const next = older[count];
    return json({ result: { candles, ...(next ? { nextBefore: ts(next) } : {}) } });
  };
  return { fetchImpl, calls };
}
const clientFor = (fake, c = clock(), extra = {}) => createTossClient({ clientId: ID, clientSecret: SECRET, fetchImpl: fake.fetchImpl, now: c.now, sleep: c.sleep, ...extra });

test('종목 일봉: 200개씩 넘겨 받고 수정주가로 요청하며, 거래대금은 종가×거래량으로 채운다', async () => {
  const fake = fakeToss({ symbols: { '005930': bars(450) }, indices: {} });
  const r = await clientFor(fake).dailyCandles('005930', day(10).replaceAll('-', ''), day(449).replaceAll('-', ''));
  assert.equal(r.d.length, 440);
  assert.equal(r.d[0], day(10).replaceAll('-', ''));
  assert.equal(r.d.at(-1), day(449).replaceAll('-', ''));
  assert.deepEqual([r.o[0], r.h[0], r.l[0], r.c[0], r.v[0]], [1010, 1020, 1000, 1015, 110]);
  assert.equal(r.tv[0], 1015 * 110);
  assert.equal(fake.calls.data.length, 3);
  assert.equal(fake.calls.token, 1);
  for (const c of fake.calls.data) {
    assert.equal(c.url.pathname, '/api/v1/candles');
    assert.equal(c.url.searchParams.get('adjusted'), 'true');
    assert.equal(c.url.searchParams.get('interval'), '1d');
    assert.equal(c.headers.authorization, `Bearer ${TOKEN}`);
  }
  assert.equal(fake.calls.data[0].url.searchParams.get('before'), `${day(449)}T23:59:59+09:00`);
});

test('지수 일봉: 지수 경로로 받고 { d, o, c }만 돌려준다', async () => {
  const fake = fakeToss({ symbols: {}, indices: { KOSDAQ: bars(30, 800) } });
  const r = await clientFor(fake).indexDaily('KOSDAQ', day(0), day(29));
  assert.deepEqual(Object.keys(r), ['d', 'o', 'c']);
  assert.equal(r.d.length, 30);
  assert.equal(fake.calls.data[0].url.pathname, '/api/v1/market-indicators/KOSDAQ/candles');
});

test('상장일에서 nextBefore 없이 끝나면 받은 만큼만 돌려준다', async () => {
  const fake = fakeToss({ symbols: { A: bars(50) }, indices: {} });
  const r = await clientFor(fake).dailyCandles('A', '20200101', day(49));
  assert.equal(r.d.length, 50);
});

test('429면 기다렸다 다시 시도하고, 계속 429면 그 종목만 실패로 던진다', async () => {
  const c = clock();
  let first = true;
  const fake = fakeToss({ symbols: { A: bars(5) }, indices: {} }, { onData: () => (first ? ((first = false), json({}, 429)) : null) });
  const t0 = c.now();
  const r = await clientFor(fake, c).dailyCandles('A', day(0), day(4));
  assert.equal(r.d.length, 5);
  assert.ok(c.now() - t0 >= 2000, '429 뒤 2초 이상 쉰다');

  const always = fakeToss({ symbols: { A: bars(5) }, indices: {} }, { onData: () => json({}, 429) });
  await assert.rejects(clientFor(always).dailyCandles('A', day(0), day(4)), (e) => e.fatal === false && /호출 한도/.test(e.message));
  assert.equal(always.calls.data.length, 6);
});

test('Retry-After가 있으면 그만큼 기다린다', async () => {
  const c = clock();
  let first = true;
  const fake = fakeToss({ symbols: { A: bars(5) }, indices: {} }, { onData: () => (first ? ((first = false), json({}, 429, { 'retry-after': '7' })) : null) });
  const t0 = c.now();
  await clientFor(fake, c).dailyCandles('A', day(0), day(4));
  assert.ok(c.now() - t0 >= 7000);
});

test('요청 간격이 설정한 초당 건수를 넘지 않는다', async () => {
  const c = clock();
  const stamps = [];
  const fake = fakeToss({ symbols: { A: bars(5) }, indices: {} }, { onData: () => void stamps.push(c.now()) });
  const client = clientFor(fake, c, { perSecond: 0.5 });
  for (let i = 0; i < 4; i++) await client.dailyCandles('A', day(0), day(4));
  for (let i = 1; i < stamps.length; i++) assert.ok(stamps[i] - stamps[i - 1] >= 2000, `간격 ${stamps[i] - stamps[i - 1]}ms`);
});

test('401은 치명 오류이고, 키·토큰은 오류 문구에 없다', async () => {
  const fake = fakeToss({ symbols: {}, indices: {} }, { onData: () => json({ error: `${ID} ${SECRET} ${TOKEN}` }, 401) });
  const client = clientFor(fake);
  await assert.rejects(client.dailyCandles('A', day(0), day(4)), (e) => {
    assert.equal(e.fatal, true);
    for (const s of [ID, SECRET, TOKEN]) assert.ok(!e.message.includes(s));
    return true;
  });
  assert.equal(client.scrub(`x ${TOKEN} ${SECRET}`), 'x *** ***');

  const badToken = createTossClient({ clientId: ID, clientSecret: SECRET, fetchImpl: async () => json({ error: ID }, 400), sleep: async () => {} });
  await assert.rejects(badToken.indexDaily('KOSPI', day(0), day(4)), (e) => e.fatal === true && !e.message.includes(ID));
});

test('401이 한 번 오면 토큰을 다시 받아 이어 가고, 5xx는 다시 시도한다', async () => {
  let n = 0;
  const fake = fakeToss({ symbols: { A: bars(5) }, indices: {} }, { onData: () => (++n === 1 ? json({}, 401) : n === 2 ? json({}, 502) : null) });
  const r = await clientFor(fake).dailyCandles('A', day(0), day(4));
  assert.equal(r.d.length, 5);
  assert.equal(fake.calls.token, 2);
});

test('같은 페이지만 되풀이되면 자르지 않고 실패로 던진다', async () => {
  const page = { result: { candles: [{ timestamp: `${day(9)}T00:00:00.000+09:00`, openPrice: '1', highPrice: '1', lowPrice: '1', closePrice: '1', volume: '1' }], nextBefore: `${day(9)}T00:00:00.000+09:00` } };
  const fake = fakeToss({ symbols: {}, indices: {} }, { onData: () => json(page) });
  await assert.rejects(clientFor(fake).dailyCandles('A', day(0), day(9)), /진행되지 않아요/);
});

test('CLI: --provider·--rate', () => {
  assert.equal(parseArgs([]).provider, 'kis');
  const o = parseArgs(['--provider', 'toss', '--rate', '1.5']);
  assert.equal(o.provider, 'toss');
  assert.equal(o.rate, 1.5);
  assert.throws(() => parseArgs(['--provider', 'naver']), /--provider/);
  assert.throws(() => parseArgs(['--provider', 'toss', '--rate', '0']), /--rate/);
  assert.throws(() => parseArgs(['--rate', '1']), /--rate/);
});

// collect에 토스 클라이언트를 넣는다(FRED·테마는 가짜)
const fred = async (url) => {
  const id = new URL(url).searchParams.get('id');
  return new Response(`observation_date,${id}\n2025-01-02,1300\n2025-01-03,1301`, { status: 200 });
};
const stk = (s) => ({ s, n: `종목${s}`, m: 'KOSPI', t: 'STOCK', sec: ['0027', '0000', '0000'], shares: 1_000_000, managed: false, halted: false });
const master = { stocks: [stk('000010'), stk('000020')], idxcode: [{ code: '00027', name: '제조' }], themes: [] };

test('collect: 토스로 받으면 source가 toss이고 매매동향·재무를 요청하지 않으며, --update의 이전 flow·fin을 지운다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'toss-collect-'));
  try {
    const data = { symbols: { '000010': bars(60), '000020': bars(60) }, indices: { KOSPI: bars(60), KOSDAQ: bars(60) } };
    const c = clock();
    const fake = fakeToss(data);
    const logs = [];
    const { file } = await collect({ out: dir, client: clientFor(fake, c), master, source: 'toss', now: c.now, sleep: c.sleep, fredFetch: fred, log: (l) => logs.push(l) });
    assert.equal(file.source, 'toss');
    assert.equal(file.stocks.length, 2);
    assert.ok(file.stocks.every((s) => s.tv.every((x, i) => x === Math.round(s.c[i] * s.v[i]))));
    assert.ok(fake.calls.data.every((x) => /\/candles$/.test(x.url.pathname)), '일봉 말고는 요청하지 않는다');
    assert.ok(logs.some((l) => l.includes('토스')));

    // 이전 파일에 flow·fin이 있어도 결과에는 없다
    const prev = structuredClone(file);
    prev.source = 'kis';
    for (const s of prev.stocks) {
      s.flow = { from: s.d[0], f: [1], i: [2], p: [3] };
      s.fin = { q: ['202406'], a: [0], rev: [1], op: [1], ni: [1], eq: [1], debt: [1] };
    }
    const c2 = clock(Date.UTC(2026, 9, 17, 3, 0, 0));
    const { file: next } = await collect({ out: dir, update: prev, client: clientFor(fakeToss(data), c2), master, source: 'toss', now: c2.now, sleep: c2.sleep, fredFetch: fred });
    assert.equal(next.source, 'toss');
    assert.ok(next.stocks.every((s) => !('flow' in s) && !('fin' in s)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('관리 수집은 키·발급 없이 프록시 헤더만 사용하고 전달된 인증 헤더도 버린다', async () => {
  const calls = [];
  const c = clock();
  const client = createTossClient({ baseUrl: 'https://proxy.example/toss/', proxyManaged: true,
    headers: { origin: 'https://app.example', 'x-proxy-token': 'test-proxy-token', Authorization: 'Bearer test-client-token' },
    now: c.now, sleep: c.sleep, fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return json({ result: { candles: [{ timestamp: `${day(0)}T00:00:00+09:00`, openPrice: '10', highPrice: '11', lowPrice: '9', closePrice: '10', volume: '100' }] } });
    } });
  assert.deepEqual((await client.dailyCandles('005930', day(0), day(0))).c, [10]);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.startsWith('https://proxy.example/toss/api/v1/candles?'));
  const headers = new Headers(calls[0].init.headers);
  assert.equal(headers.get('origin'), 'https://app.example');
  assert.equal(headers.get('x-proxy-token'), 'test-proxy-token');
  assert.equal(headers.has('authorization'), false);
  assert.equal(calls[0].init.redirect, 'manual');
  assert.equal(client.scrub('test-proxy-token'), '***');
});

test('관리 수집 401은 한 번만 요청하고 발급 없이 치명 실패다', async () => {
  let count = 0;
  const client = createTossClient({ proxyManaged: true, sleep: async () => {}, fetchImpl: async () => {
    count++;
    return json({ error: 'test-proxy-token' }, 401);
  } });
  await assert.rejects(client.dailyCandles('005930', day(0), day(0)), (error) => error.fatal === true);
  assert.equal(count, 1);
});

for (const kind of [301, 302, 307, 308, 'opaque']) {
  test(`프록시 수집 리다이렉트 ${kind}는 다른 출처로 보내거나 재시도하지 않는다`, async () => {
    const calls = [];
    const client = createTossClient({ proxyManaged: true, baseUrl: 'https://proxy.example/toss', sleep: async () => {},
      headers: { 'x-proxy-token': 'test-proxy-token' }, fetchImpl: async (url, init) => {
        calls.push({ url, init });
        const response = new Response(null, kind === 'opaque' ? {} : { status: kind, headers: { location: 'https://other.example/candles' } });
        if (kind === 'opaque') Object.defineProperty(response, 'type', { value: 'opaqueredirect' });
        return response;
      } });
    await assert.rejects(client.dailyCandles('005930', day(0), day(0)), (error) => error.fatal === true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.redirect, 'manual');
    assert.equal(new URL(calls[0].url).origin, 'https://proxy.example');
  });
}

test('직접 발급도 수동 리다이렉트를 사용하고 전달 헤더를 유지한다', async () => {
  const calls = [];
  const client = createTossClient({ clientId: ID, clientSecret: SECRET, headers: { origin: 'https://app.example' }, sleep: async () => {},
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return String(url).endsWith('/oauth2/token') ? json({ access_token: TOKEN }) : json({ result: { candles: [] } });
    } });
  await client.dailyCandles('005930', day(0), day(0));
  assert.equal(calls.length, 2);
  for (const call of calls) { assert.equal(call.init.redirect, 'manual'); assert.equal(new Headers(call.init.headers).get('origin'), 'https://app.example'); }
});

test('수집 오류와 로그에서 프록시 토큰을 가린다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'toss-proxy-scrub-'));
  try {
    const c = clock();
    const logs = [];
    const client = createTossClient({ proxyManaged: true, headers: { 'X-Proxy-Token': 'test-proxy-token' }, now: c.now, sleep: c.sleep,
      fetchImpl: async () => { const error = new Error('test-proxy-token'); error.name = 'test-proxy-token'; throw error; } });
    await assert.rejects(collect({ out: dir, client, master, source: 'toss', now: c.now, sleep: c.sleep, fredFetch: fred, log: (line) => logs.push(line) }), (error) => !error.message.includes('test-proxy-token'));
    assert.ok(!logs.join('\n').includes('test-proxy-token'));
    assert.equal(client.scrub('test-proxy-token'), '***');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('관리 401은 본문 전송이 끊겨도 읽거나 다시 요청하지 않고 치명 실패한다', async () => {
  let count = 0;
  let reads = 0;
  const client = createTossClient({ proxyManaged: true, sleep: async () => {}, fetchImpl: async () => {
    count++;
    const response = json({}, 401);
    response.text = async () => { reads++; throw new Error('가짜 본문 전송 실패'); };
    return response;
  } });
  await assert.rejects(client.dailyCandles('005930', day(0), day(0)), (error) => {
    assert.equal(count, 1);
    assert.equal(error.fatal, true);
    assert.equal(reads, 0);
    return true;
  });
});
