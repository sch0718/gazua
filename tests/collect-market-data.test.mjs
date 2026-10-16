import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { REPO_ROOT, assertOutAllowed, collect, mergeUpdate, parseArgs, resolveSectors } from '../scripts/collect-market-data.mjs';
import { createKisClient } from '../scripts/kis-collect.mjs';

const KEY = 'KEYSECRET-app-key-123';
const SECRET = 'SECRETVALUE-app-secret-456';
const TOKEN = 'TOKEN-bearer-789';

// ── 가짜 시간·fetch ──────────────────────────────────────────────────
function clock(start = Date.UTC(2026, 9, 16, 3, 0, 0)) {
  let t = start;
  return { now: () => t, sleep: async (ms) => void (t += ms), advance: (ms) => void (t += ms) };
}

const dateStr = (i) => {
  const t = Date.UTC(2025, 0, 1) + i * 86_400_000; // 달력일을 거래일로 쓴다
  return new Date(t).toISOString().slice(0, 10).replaceAll('-', '');
};
// i번째 거래일의 행. adj가 있으면 종가를 그만큼 바꾼다(수정주가 변경 흉내)
const stockRows = (n, adj = 0) =>
  Array.from({ length: n }, (_, i) => ({
    stck_bsop_date: dateStr(i),
    stck_oprc: String(1000 + i),
    stck_hgpr: String(1010 + i),
    stck_lwpr: String(990 + i),
    stck_clpr: String(1005 + i + adj),
    acml_vol: String(100 + i),
    acml_tr_pbmn: String((1005 + i) * (100 + i)),
  }));
const indexRows = (n) =>
  Array.from({ length: n }, (_, i) => ({
    stck_bsop_date: dateStr(i),
    bstp_nmix_oprc: `${2500 + i}.10`,
    bstp_nmix_hgpr: `${2510 + i}.10`,
    bstp_nmix_lwpr: `${2490 + i}.10`,
    bstp_nmix_prpr: `${2505 + i}.20`,
  }));

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** data: { symbols: {code: rows}, indices: {'0001': rows, '1001': rows} }. 페이지는 최대 100행, 요청 DATE_2 이하만 최신순 */
function fakeKis(data, { onGet } = {}) {
  const calls = { token: 0, get: [] };
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    if (u.pathname === '/oauth2/tokenP') {
      calls.token++;
      assert.equal(init.method, 'POST');
      const body = JSON.parse(init.body);
      assert.deepEqual(Object.keys(body).sort(), ['appkey', 'appsecret', 'grant_type']);
      assert.equal(body.grant_type, 'client_credentials');
      return json({ access_token: TOKEN, access_token_token_expired: '2099-01-01 00:00:00' });
    }
    assert.equal(init.headers.authorization, `Bearer ${TOKEN}`);
    assert.equal(init.headers.appkey, KEY);
    assert.equal(init.headers.custtype, 'P');
    const q = Object.fromEntries(u.searchParams);
    calls.get.push({ path: u.pathname, trId: init.headers.tr_id, q });
    const injected = onGet?.(calls.get.length, q);
    if (injected) return injected;
    const isIndex = u.pathname.endsWith('inquire-daily-indexchartprice');
    if (isIndex) {
      assert.equal(init.headers.tr_id, 'FHKUP03500100');
      assert.equal(q.FID_COND_MRKT_DIV_CODE, 'U');
    } else {
      assert.equal(init.headers.tr_id, 'FHKST03010100');
      assert.equal(q.FID_COND_MRKT_DIV_CODE, 'J');
      assert.equal(q.FID_PERIOD_DIV_CODE, 'D');
      assert.equal(q.FID_ORG_ADJ_PRC, '0');
    }
    const rows = (isIndex ? data.indices[q.FID_INPUT_ISCD] : data.symbols[q.FID_INPUT_ISCD]) ?? [];
    const page = rows
      .filter((r) => r.stck_bsop_date >= q.FID_INPUT_DATE_1 && r.stck_bsop_date <= q.FID_INPUT_DATE_2)
      .sort((a, b) => (a.stck_bsop_date < b.stck_bsop_date ? 1 : -1))
      .slice(0, 100);
    return json({ rt_cd: '0', msg_cd: 'MCA00000', output2: page });
  };
  return { fetchImpl, calls };
}

const clientFor = (fake, c = clock()) => createKisClient({ appKey: KEY, appSecret: SECRET, fetchImpl: fake.fetchImpl, now: c.now, sleep: c.sleep });

// ── 마스터·검증 도우미 ────────────────────────────────────────────────
const IDX = [
  { code: '00013', name: '전기·전자' },
  { code: '00027', name: '제조' },
  { code: '11009', name: '제조' },
  { code: '11028', name: '전기·전자' },
];
const stk = (s, m, sec, extra = {}) => ({ s, n: `종목${s}`, m, t: 'STOCK', sec, shares: 1_000_000, managed: false, halted: false, ...extra });
const master3 = () => ({
  stocks: [stk('000030', 'KOSPI', ['0027', '0013', '0000']), stk('000010', 'KOSPI', ['0027', '0013', '0000']), stk('000020', 'KOSDAQ', ['1009', '1028', '0000'])],
  idxcode: IDX,
});
const WINDOW = Date.UTC(2026, 9, 16, 3, 0, 0);

// 앱의 validateMarketData와 같은 규칙을 손으로 확인한다(TS라 여기서는 못 부른다)
function assertValidFile(f) {
  assert.equal(f.format, 'gazua-market-data');
  assert.equal(f.version, 1);
  assert.equal(f.source, 'kis');
  assert.equal(f.adjusted, true);
  assert.match(f.collectedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(f.range.from, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(f.range.to, /^\d{4}-\d{2}-\d{2}$/);
  for (const s of f.sectors) {
    assert.equal(typeof s.code, 'string');
    assert.equal(typeof s.name, 'string');
    assert.ok([1, 2, 3].includes(s.level));
  }
  const asc = (d) => d.every((x, i) => /^\d{8}$/.test(x) && (i === 0 || d[i - 1] < x));
  const nums = (a, n, pos) => a.length === n && a.every((x) => typeof x === 'number' && Number.isFinite(x) && (!pos || x > 0));
  for (const s of f.stocks) {
    assert.ok(['KOSPI', 'KOSDAQ'].includes(s.m));
    assert.ok(['STOCK', 'ETF', 'ETN', 'REIT', 'OTHER'].includes(s.t));
    assert.equal(s.sec.length, 3);
    assert.ok(s.sec.every((c) => typeof c === 'string'));
    assert.ok(Number.isFinite(s.shares) && s.shares >= 0);
    assert.ok(asc(s.d));
    for (const k of ['o', 'h', 'l', 'v', 'tv']) assert.ok(nums(s[k], s.d.length, false), k);
    assert.ok(nums(s.c, s.d.length, true));
  }
  for (const i of f.indices) {
    assert.ok(['KOSPI', 'KOSDAQ'].includes(i.id));
    assert.ok(asc(i.d));
    assert.ok(nums(i.o, i.d.length, true) && nums(i.c, i.d.length, true));
  }
}

function tmpDir() {
  return mkdtempSync(join(tmpdir(), 'collect-test-'));
}
const readGz = (p) => JSON.parse(gunzipSync(readFileSync(p)).toString('utf8'));
const dataFor = (n = 250) => ({
  symbols: { '000010': stockRows(n), '000020': stockRows(n), '000030': stockRows(n) },
  indices: { '0001': indexRows(n), '1001': indexRows(n) },
});

// ── (a) 250일을 100행씩 3페이지 ───────────────────────────────────────
test('(a) 250일을 100행씩 3페이지로 받는다', async () => {
  const fake = fakeKis({ symbols: { '005930': stockRows(250) }, indices: {} });
  const r = await clientFor(fake).dailyCandles('005930', dateStr(0), dateStr(249));
  assert.equal(r.d.length, 250);
  assert.equal(fake.calls.get.length, 3);
  assert.equal(r.d[0], dateStr(0));
  assert.equal(r.d[249], dateStr(249));
  // 오름차순, 열 길이 같음, 숫자
  for (const k of ['o', 'h', 'l', 'c', 'v', 'tv']) assert.equal(r[k].length, 250);
  assert.equal(r.c[0], 1005);
  assert.equal(r.tv[1], 1006 * 101);
  // 두 번째 페이지는 첫 페이지의 가장 오래된 날 전날부터 거슬러 받는다
  assert.equal(fake.calls.get[1].q.FID_INPUT_DATE_2, dateStr(150 - 1));
});

// ── (b) 429 후 성공 ───────────────────────────────────────────────────
test('(b) 429를 한 번 받으면 1초 쉬고 다시 시도해 성공한다', async () => {
  const c = clock();
  const fake = fakeKis({ symbols: { '005930': stockRows(10) }, indices: {} }, { onGet: (n) => (n === 1 ? json({ msg_cd: 'X' }, 429) : undefined) });
  const t0 = c.now();
  const r = await clientFor(fake, c).dailyCandles('005930', dateStr(0), dateStr(9));
  assert.equal(r.d.length, 10);
  assert.ok(c.now() - t0 >= 1000);
});

test('(b2) EGW00201은 200 응답이어도 다시 시도하고, 4번째에도 실패하면 던진다', async () => {
  const fake = fakeKis({ symbols: {}, indices: {} }, { onGet: () => json({ rt_cd: '1', msg_cd: 'EGW00201', msg1: 'too many' }) });
  await assert.rejects(clientFor(fake).dailyCandles('005930', dateStr(0), dateStr(9)), /호출 한도/);
  assert.equal(fake.calls.get.length, 4);
});

test('(b3) 초당 18건을 넘지 않는다', async () => {
  const c = clock();
  const stamps = [];
  const base = fakeKis({ symbols: { '005930': stockRows(5) }, indices: {} });
  const fetchImpl = async (url, init) => {
    if (!String(url).includes('tokenP')) stamps.push(c.now());
    return base.fetchImpl(url, init);
  };
  const client = createKisClient({ appKey: KEY, appSecret: SECRET, fetchImpl, now: c.now, sleep: c.sleep });
  for (let i = 0; i < 60; i++) await client.dailyCandles('005930', dateStr(0), dateStr(4));
  for (let i = 18; i < stamps.length; i++) assert.ok(stamps[i] - stamps[i - 18] >= 1000, `요청 ${i}`);
});

// ── (c) 토큰은 실행당 1번 ─────────────────────────────────────────────
test('(c) 토큰 발급은 실행당 1번이다', async () => {
  const fake = fakeKis(dataFor(10));
  const client = clientFor(fake);
  await client.indexDaily('KOSPI', dateStr(0), dateStr(9));
  await client.dailyCandles('000010', dateStr(0), dateStr(9));
  await client.dailyCandles('000020', dateStr(0), dateStr(9));
  assert.equal(fake.calls.token, 1);
});

// ── (d) 키·토큰 비노출 ────────────────────────────────────────────────
test('(d) 키와 토큰이 로그·오류·파일 어디에도 없다', async () => {
  const dir = tmpDir();
  try {
    // 모든 요청 본문에 키를 되돌려 주는 서버: 오류 메시지에 본문을 옮기면 걸린다
    const echo = (n, q) => (q.FID_INPUT_ISCD === '000030' ? json({ rt_cd: '1', msg_cd: 'EGW99999', msg1: `bad ${KEY} ${SECRET} ${TOKEN}` }, 500) : undefined);
    const fake = fakeKis(dataFor(30), { onGet: echo });
    const logs = [];
    const { summary } = await collect({
      years: 2,
      out: join(dir, 'out'),
      client: clientFor(fake),
      master: master3(),
      now: clock().now,
      log: (l) => logs.push(l),
      repoRoot: join(dir, 'repo'),
    });
    assert.deepEqual(summary.failed, ['000030']);
    // 직접 호출 오류도 확인한다
    const err = await clientFor(fakeKis({ symbols: {}, indices: {} }, { onGet: echo })).dailyCandles('000030', dateStr(0), dateStr(9)).catch((e) => e);
    assert.ok(err instanceof Error);
    // 토큰 발급 실패 오류
    const badToken = createKisClient({ appKey: KEY, appSecret: SECRET, fetchImpl: async () => json({ error_description: `${KEY} ${SECRET}` }, 403) });
    const tokErr = await badToken.dailyCandles('000010', dateStr(0), dateStr(9)).catch((e) => e);
    assert.ok(tokErr instanceof Error);

    const texts = [...logs, err.message, String(err.stack), tokErr.message, JSON.stringify(summary)];
    const outDir = join(dir, 'out');
    for (const f of readdirSync(outDir)) {
      const raw = readFileSync(join(outDir, f));
      texts.push(raw.toString('latin1'), f.endsWith('.gz') ? gunzipSync(raw).toString('utf8') : '');
    }
    assert.ok(texts.join('\n').length > 100);
    for (const needle of [KEY, SECRET, TOKEN, 'Bearer']) {
      for (const t of texts) assert.ok(!t.includes(needle), `${needle} 노출`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── (e) --update ──────────────────────────────────────────────────────
test('(e) 겹치는 5일이 같으면 새 날짜만 붙이고, 한 종목만 다르면 그 종목만 다시 받는다', async () => {
  const dir = tmpDir();
  try {
    const run1 = await collect({
      years: 2,
      out: join(dir, 'a'),
      client: clientFor(fakeKis(dataFor(100))),
      master: master3(),
      now: () => WINDOW,
      log: () => {},
      repoRoot: join(dir, 'repo'),
    });
    const old = run1.file;
    assertValidFile(old);
    assert.equal(old.stocks[0].d.length, 100);

    // 새로 받는 쪽: 20일 더. 000020만 과거 종가가 달라졌다(액면분할 등)
    const next = dataFor(120);
    next.symbols['000020'] = stockRows(120, 7);
    const fake = fakeKis(next);
    const run2 = await collect({
      years: 2,
      out: join(dir, 'b'),
      update: old,
      client: clientFor(fake),
      master: master3(),
      now: () => WINDOW,
      log: () => {},
      repoRoot: join(dir, 'repo'),
    });
    assertValidFile(run2.file);
    assert.equal(run2.summary.refetched, 1);
    const by = (f, s) => f.stocks.find((x) => x.s === s);
    // 같은 종목: 새 날짜 20일만 붙고 앞부분 값은 같다
    assert.equal(by(run2.file, '000010').d.length, 120);
    assert.deepEqual(by(run2.file, '000010').c.slice(0, 100), by(old, '000010').c);
    assert.deepEqual(by(run2.file, '000030').c.slice(0, 100), by(old, '000030').c);
    // 다른 종목: 전체를 다시 받아 새 값이다
    assert.equal(by(run2.file, '000020').d.length, 120);
    assert.equal(by(run2.file, '000020').c[0], 1005 + 7);
    // 다시 받은 종목만 전체 기간 요청이 있었다: 나머지는 겹침 구간부터 한 번씩
    const fullFetches = fake.calls.get.filter((g) => g.q.FID_INPUT_ISCD === '000020' && g.q.FID_INPUT_DATE_1 === dateStr(0));
    assert.ok(fullFetches.length >= 1);
    assert.equal(fake.calls.get.filter((g) => g.q.FID_INPUT_ISCD === '000010' && g.q.FID_INPUT_DATE_1 === dateStr(0)).length, 0);
    // 변화 없는 지수도 이어 붙는다
    assert.equal(run2.file.indices[0].d.length, 120);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('(e2) mergeUpdate: 같은 값이면 같은 참조, 새 날짜 없으면 그대로', async () => {
  const mk = (n, adj = 0) => ({
    d: Array.from({ length: n }, (_, i) => dateStr(i)),
    o: Array.from({ length: n }, (_, i) => 10 + i),
    h: Array.from({ length: n }, (_, i) => 11 + i),
    l: Array.from({ length: n }, (_, i) => 9 + i),
    c: Array.from({ length: n }, (_, i) => 10 + i + adj),
    v: Array.from({ length: n }, () => 1),
    tv: Array.from({ length: n }, () => 1),
  });
  const old = mk(30);
  const fresh5 = (() => {
    const f = mk(30);
    const cut = (a) => a.slice(25);
    return Object.fromEntries(Object.entries(f).map(([k, v]) => [k, cut(v)]));
  })();
  let refetched = 0;
  const same = await mergeUpdate(old, fresh5, async () => (refetched++, mk(30)));
  assert.equal(same.refetched, false);
  assert.equal(same.cols.c, old.c);
  assert.equal(refetched, 0);
  const diff = await mergeUpdate(old, { ...fresh5, c: fresh5.c.map((x) => x + 1) }, async () => (refetched++, mk(31)));
  assert.equal(diff.refetched, true);
  assert.equal(diff.cols.d.length, 31);
});

// ── (f) 마스터에서 빠진 종목 ──────────────────────────────────────────
test('(f) 마스터에서 빠진 종목은 결과에서 빠진다', async () => {
  const dir = tmpDir();
  try {
    const run1 = await collect({ years: 2, out: join(dir, 'a'), client: clientFor(fakeKis(dataFor(50))), master: master3(), now: () => WINDOW, log: () => {}, repoRoot: join(dir, 'repo') });
    const m = master3();
    m.stocks = m.stocks.filter((s) => s.s !== '000020');
    const run2 = await collect({ years: 2, out: join(dir, 'b'), update: run1.file, client: clientFor(fakeKis(dataFor(50))), master: m, now: () => WINDOW, log: () => {}, repoRoot: join(dir, 'repo') });
    assert.deepEqual(run2.file.stocks.map((s) => s.s), ['000010', '000030']);
    assert.ok(run2.file.sectors.every((s) => !s.code.startsWith('1'))); // KOSDAQ 업종은 쓰는 종목이 없어 빠진다
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── (g) .partial 이어 받기 ────────────────────────────────────────────
test('(g) 중간에 끊겨도 .partial로 이어 받고, 끝난 종목은 다시 요청하지 않는다', async () => {
  const dir = tmpDir();
  try {
    const out = join(dir, 'out');
    const real = clientFor(fakeKis(dataFor(40)));
    let n = 0;
    const flaky = {
      indexDaily: real.indexDaily,
      dailyCandles: async (...a) => {
        if (++n === 3) throw Object.assign(new Error('중단'), { fatal: true });
        return real.dailyCandles(...a);
      },
    };
    const opts = { years: 2, out, master: master3(), now: () => WINDOW, log: () => {}, repoRoot: join(dir, 'repo') };
    await assert.rejects(collect({ ...opts, client: flaky }), /중단/);
    const partial = readdirSync(out).filter((f) => f.endsWith('.partial'));
    assert.equal(partial.length, 1);
    assert.ok(!readdirSync(out).some((f) => f.endsWith('.json.gz')));

    const fake = fakeKis(dataFor(40));
    const logs = [];
    const { file } = await collect({ ...opts, log: (l) => logs.push(l), client: clientFor(fake) });
    assertValidFile(file);
    assert.equal(file.stocks.length, 3);
    const requested = new Set(fake.calls.get.map((g) => g.q.FID_INPUT_ISCD));
    assert.ok(!requested.has('000010') && !requested.has('000020'), '끝난 종목을 다시 요청했어요');
    assert.ok(requested.has('000030'));
    assert.ok(!requested.has('0001') && !requested.has('1001'), '끝난 지수를 다시 요청했어요');
    assert.ok(logs.some((l) => l.includes('이어서')));
    assert.ok(!readdirSync(out).some((f) => f.endsWith('.partial')));
    assert.ok(readdirSync(out).some((f) => /^market-data-20261016\.json\.gz$/.test(f)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── (h) 출력 경로 ─────────────────────────────────────────────────────
test('(h) 저장소 안 경로는 거부하고, data/와 저장소 밖은 허용한다', async () => {
  assert.throws(() => assertOutAllowed(join(REPO_ROOT, 'src/out')), /data\//);
  assert.throws(() => assertOutAllowed(REPO_ROOT), /data\//);
  assert.throws(() => assertOutAllowed(join(REPO_ROOT, 'database')), /data\//);
  assert.doesNotThrow(() => assertOutAllowed(join(REPO_ROOT, 'data')));
  assert.doesNotThrow(() => assertOutAllowed(join(REPO_ROOT, 'data/run1')));
  assert.doesNotThrow(() => assertOutAllowed(join(tmpdir(), 'x')));
  // collect도 아무것도 쓰기 전에 거부한다
  const fake = fakeKis(dataFor(10));
  await assert.rejects(
    collect({ out: join(REPO_ROOT, 'src/out'), client: clientFor(fake), master: master3(), now: () => WINDOW, log: () => {} }),
    /data\//,
  );
  assert.equal(fake.calls.get.length, 0);
  assert.equal(existsSync(join(REPO_ROOT, 'src/out')), false);
});

// ── (i) 지수 o·c ──────────────────────────────────────────────────────
test('(i) 지수 파일에 o·c가 같은 길이로 들어간다', async () => {
  const dir = tmpDir();
  try {
    const { file } = await collect({ years: 2, out: join(dir, 'o'), client: clientFor(fakeKis(dataFor(120))), master: master3(), now: () => WINDOW, log: () => {}, repoRoot: join(dir, 'repo') });
    assert.deepEqual(file.indices.map((i) => i.id), ['KOSPI', 'KOSDAQ']);
    for (const i of file.indices) {
      assert.equal(i.d.length, 120);
      assert.equal(i.o.length, 120);
      assert.equal(i.c.length, 120);
      assert.equal(i.o[0], 2500.1);
      assert.equal(i.c[0], 2505.2);
      assert.deepEqual(Object.keys(i).sort(), ['c', 'd', 'id', 'o']);
    }
    assertValidFile(file);
    // 디스크의 파일도 같다
    const disk = readGz(join(dir, 'o', 'market-data-20261016.json.gz'));
    assert.deepEqual(disk.indices[0].o, file.indices[0].o);
    assert.equal(disk.range.from, '2025-01-01');
    assert.equal(disk.range.to, dateStr(119).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 업종 코드 해석 (R3) ───────────────────────────────────────────────
test('업종 코드: 시장 숫자를 붙이고, 0000·없는 코드는 빈 문자열, 레벨은 가장 낮은 슬롯', () => {
  const stocks = [
    stk('005930', 'KOSPI', ['0027', '0013', '0000']),
    stk('247540', 'KOSDAQ', ['1009', '1028', '0000']),
    stk('000001', 'KOSPI', ['0013', '0027', '9999']), // 0013은 슬롯 1에도 나온다 → 레벨 1
  ];
  const { sec, sectors } = resolveSectors(stocks, IDX);
  assert.deepEqual(sec[0], ['00027', '00013', '']);
  assert.deepEqual(sec[1], ['11009', '11028', '']);
  assert.deepEqual(sec[2], ['00013', '00027', '']);
  const lv = Object.fromEntries(sectors.map((s) => [s.code, s.level]));
  assert.deepEqual(lv, { '00013': 1, '00027': 1, '11009': 1, '11028': 2 });
  assert.equal(sectors.find((s) => s.code === '00013').name, '전기·전자');
});

test('CLI 옵션', () => {
  const o = parseArgs(['--', '--years', '3', '--out', '/tmp/x', '--paper']);
  assert.equal(o.years, 3);
  assert.equal(o.out, '/tmp/x');
  assert.equal(o.paper, true);
  assert.equal(parseArgs([]).years, 5);
  assert.throws(() => parseArgs(['--years', 'x']));
  assert.throws(() => parseArgs(['--nope']));
});
