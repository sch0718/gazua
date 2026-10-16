import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { REPO_ROOT, assertOutAllowed, collect, mergeUpdate, parseArgs, resolveSectors, validateCreds, writeGzipJson } from '../scripts/collect-market-data.mjs';
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
  // 10년이 넘으면 앱이 가져올 때 V8 문자열 한도를 넘을 수 있다
  assert.equal(parseArgs(['--years', '10']).years, 10);
  assert.throws(() => parseArgs(['--years', '11']), /1~10/);
  assert.throws(() => parseArgs(['--nope']));
});

// ── 수정 1차 ──────────────────────────────────────────────────────────
const haltRows = (normal, halted) =>
  Array.from({ length: normal + halted }, (_, i) =>
    i < normal
      ? { stck_bsop_date: dateStr(i), stck_oprc: '100', stck_hgpr: '110', stck_lwpr: '90', stck_clpr: '105', acml_vol: '1', acml_tr_pbmn: '105' }
      : { stck_bsop_date: dateStr(i), stck_oprc: '0', stck_hgpr: '0', stck_lwpr: '0', stck_clpr: '105', acml_vol: '0', acml_tr_pbmn: '0' },
  );

test('(I1) 100일 넘는 거래정지(가격 0 행)가 있어도 앞의 기록을 끝까지 받는다', async () => {
  const fake = fakeKis({ symbols: { X: haltRows(130, 120) }, indices: {} });
  const r = await clientFor(fake).dailyCandles('X', dateStr(0), dateStr(249));
  assert.equal(r.d.length, 130);
  assert.equal(r.d[0], dateStr(0));
  assert.ok(fake.calls.get.length >= 3);
});

test('(I1b) 같은 페이지만 되풀이해 주는 서버에서도 곧 끝나고, 자르지 않고 실패로 알린다', async () => {
  const rows = stockRows(250).slice(150);
  const fake = fakeKis({ symbols: {}, indices: {} }, { onGet: () => json({ rt_cd: '0', output2: rows.slice().reverse() }) });
  await assert.rejects(clientFor(fake).dailyCandles('X', dateStr(0), dateStr(249)), (e) => e.name === 'KisError' && !e.fatal && /진행되지 않아요/.test(e.message));
  assert.ok(fake.calls.get.length <= 3);
});

test('(I1c) --update: 다시 받은 결과가 비면 기존 기록을 지우지 않고 실패로 알린다', async () => {
  const dir = tmpDir();
  try {
    const opts = { years: 2, master: master3(), now: () => WINDOW, log: () => {}, repoRoot: join(dir, 'repo') };
    const run1 = await collect({ ...opts, out: join(dir, 'a'), client: clientFor(fakeKis(dataFor(100))) });
    const next = dataFor(100);
    next.symbols['000020'] = haltRows(0, 100); // 전부 가격 0 → 받은 행이 비어 있다
    const run2 = await collect({ ...opts, out: join(dir, 'b'), update: run1.file, client: clientFor(fakeKis(next)) });
    assert.deepEqual(run2.summary.failed, ['000020']);
    const kept = run2.file.stocks.find((s) => s.s === '000020');
    assert.deepEqual(kept.c, run1.file.stocks.find((s) => s.s === '000020').c);
    assert.equal(run2.summary.refetched, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('(I2) fetch가 키·시크릿을 담은 일반 Error를 던져도 로그·오류·요약·파일에 없다', async () => {
  const dir = tmpDir();
  try {
    const base = fakeKis(dataFor(30));
    const fetchImpl = async (url, init) => {
      if (new URL(url).searchParams.get('FID_INPUT_ISCD') === '000030') {
        throw new TypeError(`Headers.append: "${KEY}\n${SECRET} Bearer ${TOKEN}" is an invalid header value.`);
      }
      return base.fetchImpl(url, init);
    };
    const logs = [];
    const client = createKisClient({ appKey: KEY, appSecret: SECRET, fetchImpl, now: clock().now, sleep: clock().sleep });
    const { summary } = await collect({ years: 2, out: join(dir, 'o'), client, master: master3(), now: clock().now, log: (l) => logs.push(l), repoRoot: join(dir, 'repo') });
    assert.deepEqual(summary.failed, ['000030']);
    // client가 없는 쪽에서 던진 일반 Error도 collect가 걸러낸다
    const stub = { indexDaily: client.indexDaily, dailyCandles: async () => { throw new Error(`boom ${KEY} ${SECRET} Bearer ${TOKEN}`); } };
    const logs2 = [];
    await collect({ years: 2, out: join(dir, 'o2'), client: stub, master: master3(), now: clock().now, log: (l) => logs2.push(l), repoRoot: join(dir, 'repo'), secrets: [KEY, SECRET, TOKEN] }).catch((e) => logs2.push(e.message));
    const texts = [...logs, ...logs2, JSON.stringify(summary)];
    for (const d of ['o', 'o2']) for (const f of existsSync(join(dir, d)) ? readdirSync(join(dir, d)) : []) texts.push(readFileSync(join(dir, d, f)).toString('latin1'));
    for (const needle of [KEY, SECRET, TOKEN]) for (const t of texts) assert.ok(!t.includes(needle), `${needle} 노출`);
    assert.ok(logs.some((l) => l.includes('000030')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('(I2b) 키·시크릿 형식이 틀리면 값을 되풀이하지 않고 거부한다', () => {
  for (const bad of ['abc\ndef', 'a b', 'han글', '']) {
    try {
      validateCreds(bad, 'ok');
      assert.fail('거부해야 해요');
    } catch (e) {
      assert.ok(!String(e.message).includes('abc') && !String(e.message).includes('han'));
    }
    assert.throws(() => validateCreds('ok', bad));
  }
  assert.doesNotThrow(() => validateCreds('PSabc123+/=', 'secret/+=='));
  // CLI에서도 값이 출력에 나오지 않는다
  const r = spawnSync(process.execPath, [join(REPO_ROOT, 'scripts/collect-market-data.mjs'), '--out', join(tmpdir(), 'x')], {
    env: { ...process.env, KIS_APP_KEY: 'BADKEY\nVALUE', KIS_APP_SECRET: 'SECRETXYZ' },
    encoding: 'utf8',
  });
  assert.equal(r.status, 1);
  assert.ok(!(r.stdout + r.stderr).includes('BADKEY') && !(r.stdout + r.stderr).includes('SECRETXYZ'));
});

test('(M3) 끊긴 마지막 줄이 있는 .partial은 정리한 뒤 이어 붙인다', async () => {
  const dir = tmpDir();
  try {
    const out = join(dir, 'out');
    mkdirSync(out);
    const partial = join(out, 'market-data-20261016.json.gz.partial');
    const stockLine = JSON.stringify({ kind: 'stock', s: '000010', refetched: false, ...Object.fromEntries(['d', 'o', 'h', 'l', 'c', 'v', 'tv'].map((k) => [k, k === 'd' ? [dateStr(0)] : [1]])) });
    const header = JSON.stringify({ kind: 'header', from: '20241016', to: '20261015', updateFrom: null });
    writeFileSync(partial, `${header}\n${stockLine}\n{"kind":"stock","s":"0000`);
    const real = clientFor(fakeKis(dataFor(40)));
    const calls = [];
    const flaky = {
      indexDaily: real.indexDaily,
      dailyCandles: async (...a) => {
        calls.push(a[0]);
        if (calls.length === 2) throw Object.assign(new Error('중단'), { fatal: true });
        return real.dailyCandles(...a);
      },
    };
    await assert.rejects(collect({ years: 2, out, client: flaky, master: master3(), now: () => WINDOW, log: () => {}, repoRoot: join(dir, 'repo') }), /중단/);
    const lines = readFileSync(partial, 'utf8').split('\n').filter(Boolean);
    for (const l of lines) JSON.parse(l); // 모두 온전한 줄
    assert.equal(lines.length, 5); // 헤더, 지수 2, 기존 종목 1, 새로 끝난 종목 1
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('(M4) 저장소 안의 ..foo, 심볼릭 링크로 들어간 경로를 거부한다', () => {
  assert.throws(() => assertOutAllowed(join(REPO_ROOT, '..foo')), /data\//);
  const dir = tmpDir();
  try {
    const link = join(dir, 'link');
    symlinkSync(join(REPO_ROOT, 'src'), link);
    assert.throws(() => assertOutAllowed(join(link, 'x')), /data\//);
    assert.doesNotThrow(() => assertOutAllowed(join(dir, 'plain')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('(M5) --update 원본이 다른 .partial은 이어 받지 않는다', async () => {
  const dir = tmpDir();
  try {
    const opts = { years: 2, master: master3(), now: () => WINDOW, log: () => {}, repoRoot: join(dir, 'repo') };
    const run1 = await collect({ ...opts, out: join(dir, 'a'), client: clientFor(fakeKis(dataFor(60))) });
    const A = join(dir, 'A.json.gz');
    const B = join(dir, 'B.json.gz');
    writeFileSync(A, gzipSync(JSON.stringify(run1.file)));
    writeFileSync(B, gzipSync(JSON.stringify(run1.file)));
    const real = clientFor(fakeKis(dataFor(70)));
    let n = 0;
    const flaky = { indexDaily: real.indexDaily, dailyCandles: async (...a) => { if (++n === 3) throw Object.assign(new Error('중단'), { fatal: true }); return real.dailyCandles(...a); } };
    const out = join(dir, 'u');
    await assert.rejects(collect({ ...opts, out, update: A, client: flaky }), /중단/);
    const logs = [];
    await collect({ ...opts, out, update: B, client: clientFor(fakeKis(dataFor(70))), log: (l) => logs.push(l) });
    assert.ok(!logs.some((l) => l.includes('이어서')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('(M6) 장 마감 전(KST 18시 이전 평일)이면 어제까지만 받는다', async () => {
  const to = async (ms) => {
    const dir = tmpDir();
    try {
      const fake = fakeKis(dataFor(10));
      await collect({ years: 2, out: join(dir, 'o'), client: clientFor(fake), master: master3(), now: () => ms, log: () => {}, repoRoot: join(dir, 'repo') });
      return fake.calls.get[0].q.FID_INPUT_DATE_2;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  assert.equal(await to(Date.UTC(2026, 9, 16, 3, 0)), '20261015'); // 금 12:00 KST
  assert.equal(await to(Date.UTC(2026, 9, 16, 10, 0)), '20261016'); // 금 19:00 KST
  assert.equal(await to(Date.UTC(2026, 9, 17, 3, 0)), '20261017'); // 토 12:00 KST
});

test('(M7) 요청에 20초 제한 신호를 붙이고, 네트워크 오류는 다시 시도한다', async () => {
  const base = fakeKis({ symbols: { A: stockRows(5) }, indices: {} });
  let n = 0;
  const signals = [];
  const fetchImpl = async (url, init) => {
    if (!String(url).includes('tokenP')) {
      signals.push(init.signal);
      if (++n === 1) throw new TypeError('fetch failed');
    }
    return base.fetchImpl(url, init);
  };
  const c = clock();
  const r = await createKisClient({ appKey: KEY, appSecret: SECRET, fetchImpl, now: c.now, sleep: c.sleep }).dailyCandles('A', dateStr(0), dateStr(4));
  assert.equal(r.d.length, 5);
  assert.ok(signals.every((x) => x instanceof AbortSignal));
});

test('(M7b) 스트리밍으로 쓴 파일이 반환값과 같은 JSON이다', async () => {
  const dir = tmpDir();
  try {
    const { file, summary } = await collect({ years: 2, out: join(dir, 'o'), client: clientFor(fakeKis(dataFor(30))), master: master3(), now: () => WINDOW, log: () => {}, repoRoot: join(dir, 'repo') });
    assert.deepEqual(readGz(summary.path), JSON.parse(JSON.stringify(file)));
    assert.ok(!existsSync(`${summary.path}.tmp`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 수정 2차 ──────────────────────────────────────────────────────────
const bodyFail = () => ({ status: 200, ok: true, text: async () => { throw new DOMException('timed out', 'TimeoutError'); } });

test('(N1) 두 번째 페이지 본문 읽기가 한 번 끊겨도 다시 받아 250행을 채운다', async () => {
  let page = 0;
  const fake = fakeKis({ symbols: { A: stockRows(250) }, indices: {} }, { onGet: () => (++page === 2 ? bodyFail() : undefined) });
  const r = await clientFor(fake).dailyCandles('A', dateStr(0), dateStr(249));
  assert.equal(r.d.length, 250);
});

test('(N1b) 본문 읽기가 계속 실패하면 잘라 내지 않고 실패로 알린다', async () => {
  const dir = tmpDir();
  try {
    let page = 0;
    const onGet = (n, q) => (q.FID_INPUT_ISCD === '000030' && ++page >= 2 ? bodyFail() : undefined);
    const data = dataFor(250);
    const fake = fakeKis(data, { onGet });
    await assert.rejects(clientFor(fake).dailyCandles('000030', dateStr(0), dateStr(249)), (e) => e.name === 'KisError');
    page = 0;
    const { summary, file } = await collect({ years: 2, out: join(dir, 'o'), client: clientFor(fakeKis(data, { onGet })), master: master3(), now: () => WINDOW, log: () => {}, repoRoot: join(dir, 'repo') });
    assert.deepEqual(summary.failed, ['000030']);
    assert.ok(!file.stocks.some((x) => x.s === '000030'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('(N1c) 200인데 JSON이 아니거나 output2가 배열이 아니면 다시 시도하고, 끝까지 그러면 던진다', async () => {
  const bad = [() => new Response('<html>', { status: 200 }), () => json({ rt_cd: '0', output2: null }), () => json({ rt_cd: '0' })];
  for (const mk of bad) {
    const fake = fakeKis({ symbols: {}, indices: {} }, { onGet: () => mk() });
    await assert.rejects(clientFor(fake).dailyCandles('A', dateStr(0), dateStr(9)), (e) => e.name === 'KisError');
    assert.equal(fake.calls.get.length, 4);
  }
  let n = 0;
  const once = fakeKis({ symbols: { A: stockRows(5) }, indices: {} }, { onGet: () => (++n === 1 ? json({ rt_cd: '0' }) : undefined) });
  assert.equal((await clientFor(once).dailyCandles('A', dateStr(0), dateStr(4))).d.length, 5);
});

test('(N2) 최종 파일을 쓰다 실패하면 처리되지 않은 거부 없이 던지고 .partial은 남긴다', async () => {
  const dir = tmpDir();
  try {
    const out = join(dir, 'o');
    mkdirSync(join(out, 'market-data-20261016.json.gz.tmp'), { recursive: true }); // 쓸 수 없는 자리
    await assert.rejects(collect({ years: 2, out, client: clientFor(fakeKis(dataFor(20))), master: master3(), now: () => WINDOW, log: () => {}, repoRoot: join(dir, 'repo') }));
    assert.ok(readdirSync(out).some((f) => f.endsWith('.partial')));
    assert.ok(!readdirSync(out).some((f) => f.endsWith('.json.gz')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 마지막 수정 ───────────────────────────────────────────────────────
test('(F1) 쓰는 도중 대상이 실패하면 멈추지 않고 거부한다(큰 본문, 백프레셔 중)', async () => {
  const dir = tmpDir();
  try {
    // 압축이 안 되는 큰 본문이라 gzip 버퍼가 차서 drain을 기다리는 중에 실패가 난다
    const stocks = Array.from({ length: 200 }, (_, i) => ({ s: String(i), blob: randomBytes(40_000).toString('base64') }));
    let written = 0;
    const sink = new Writable({
      highWaterMark: 1024,
      write(chunk, _enc, cb) {
        written += chunk.length;
        setImmediate(() => cb(written > 256 * 1024 ? new Error('disk gone') : null));
      },
    });
    const path = join(dir, 'x.json.gz.tmp');
    const hang = new Promise((r) => setTimeout(() => r('hang'), 5000).unref());
    const res = await Promise.race([writeGzipJson(path, { a: 1, stocks, indices: [] }, { sink }).then(() => 'ok', (e) => e), hang]);
    assert.ok(res instanceof Error, `거부되어야 해요: ${res}`);
    assert.match(res.message, /disk gone/);
    assert.ok(!existsSync(path));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('(F2) 일봉 페이지 한도에 닿으면 자르지 않고 실패로 알린다(그 종목은 실패 목록으로)', async () => {
  // 하루씩만 주는 서버: from에 닿기 전에 한도(80쪽)에 닿는다
  let day = 0;
  const fake = fakeKis({ symbols: {}, indices: {} }, {
    onGet: (_n, q) => {
      const d = prevDayStr(q.FID_INPUT_DATE_2);
      day++;
      return json({ rt_cd: '0', output2: [{ stck_bsop_date: q.FID_INPUT_DATE_2, stck_oprc: '100', stck_hgpr: '100', stck_lwpr: '100', stck_clpr: '100', acml_vol: '1', acml_tr_pbmn: '100', _: d }] });
    },
  });
  await assert.rejects(clientFor(fake).dailyCandles('X', dateStr(0), dateStr(300)), (e) => e.name === 'KisError' && !e.fatal && /페이지/.test(e.message));
  assert.ok(day <= 80);
});
const prevDayStr = (d) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)) - 86_400_000).toISOString().slice(0, 10).replaceAll('-', '');

// ── PR #11 리뷰 W1: 진행하지 않는 페이지 ───────────────────────────────
// 그 종목 요청에는 최신 100행 페이지만 되풀이해 준다(커서를 무시하는 서버)
const repeatLatest = (code, rows) => (_n, q) =>
  q.FID_INPUT_ISCD === code ? json({ rt_cd: '0', msg_cd: 'MCA00000', output2: rows.slice(-100).reverse() }) : undefined;

test('(W1a) --update 재수집에서 같은 페이지만 되풀이되면 250일 이력을 유지하고 실패로 알린다', async () => {
  const dir = tmpDir();
  try {
    const opts = { years: 2, master: master3(), now: () => WINDOW, log: () => {}, repoRoot: join(dir, 'repo') };
    const run1 = await collect({ ...opts, out: join(dir, 'a'), client: clientFor(fakeKis(dataFor(250))) });
    const old = run1.file.stocks.find((s) => s.s === '000020');
    assert.equal(old.d.length, 250);
    const next = dataFor(250);
    next.symbols['000020'] = stockRows(250, 7); // 수정주가 변경 → 전체 재수집
    const fake = fakeKis(next, { onGet: repeatLatest('000020', next.symbols['000020']) });
    const run2 = await collect({ ...opts, out: join(dir, 'b'), update: run1.file, client: clientFor(fake) });
    assert.deepEqual(run2.summary.failed, ['000020']);
    assert.equal(run2.summary.refetched, 0);
    const kept = run2.file.stocks.find((s) => s.s === '000020');
    assert.equal(kept.d.length, 250);
    assert.deepEqual(kept.c, old.c);
    assertValidFile(run2.file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('(W1a2) --update 재수집 결과가 기존 이력보다 늦게 시작하면(빈 페이지로 일찍 끝남) 기존 이력을 유지하고 실패로 알린다', async () => {
  const dir = tmpDir();
  try {
    const opts = { years: 2, master: master3(), now: () => WINDOW, log: () => {}, repoRoot: join(dir, 'repo') };
    const run1 = await collect({ ...opts, out: join(dir, 'a'), client: clientFor(fakeKis(dataFor(250))) });
    const old = run1.file.stocks.find((s) => s.s === '000020');
    const next = dataFor(250);
    next.symbols['000020'] = stockRows(250, 7).slice(150); // 서버가 최근 100일만 준다(이전은 빈 페이지)
    const run2 = await collect({ ...opts, out: join(dir, 'b'), update: run1.file, client: clientFor(fakeKis(next)) });
    assert.deepEqual(run2.summary.failed, ['000020']);
    assert.equal(run2.summary.refetched, 0);
    assert.deepEqual(run2.file.stocks.find((s) => s.s === '000020').c, old.c);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('(W1a3) 기존 첫 날짜가 요청 범위 시작보다 앞이면 요청 범위 안의 첫 날짜와 비교한다(범위 밖이 잘린 것은 실패 아님)', async () => {
  const dir = tmpDir();
  try {
    const opts = { years: 2, master: master3(), now: () => WINDOW, log: () => {}, repoRoot: join(dir, 'repo') };
    // 지수가 100일 늦게 시작한다 → 파일 범위(=다음 --update의 요청 시작)는 dateStr(100), 종목 이력은 dateStr(0)부터
    const first = dataFor(250);
    first.indices = { '0001': indexRows(250).slice(100), '1001': indexRows(250).slice(100) };
    const run1 = await collect({ ...opts, out: join(dir, 'a'), client: clientFor(fakeKis(first)) });
    assert.equal(run1.file.range.from, `${dateStr(100).slice(0, 4)}-${dateStr(100).slice(4, 6)}-${dateStr(100).slice(6)}`);
    assert.equal(run1.file.stocks.find((s) => s.s === '000020').d[0], dateStr(0));
    const next = structuredClone(first);
    next.symbols['000020'] = stockRows(250, 7);
    const run2 = await collect({ ...opts, out: join(dir, 'b'), update: run1.file, client: clientFor(fakeKis(next)) });
    assert.deepEqual(run2.summary.failed, []);
    assert.equal(run2.summary.refetched, 1);
    const s = run2.file.stocks.find((x) => x.s === '000020');
    assert.equal(s.d[0], dateStr(100));
    assert.equal(s.c[0], 1005 + 100 + 7);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('(W1b) 신규 수집에서 같은 페이지만 되풀이되는 종목은 실패, 다른 종목은 정상', async () => {
  const dir = tmpDir();
  try {
    const data = dataFor(250);
    const fake = fakeKis(data, { onGet: repeatLatest('000020', data.symbols['000020']) });
    const run = await collect({ years: 2, out: join(dir, 'a'), client: clientFor(fake), master: master3(), now: () => WINDOW, log: () => {}, repoRoot: join(dir, 'repo') });
    assert.deepEqual(run.summary.failed, ['000020']);
    assert.deepEqual(run.file.stocks.map((s) => s.s).sort(), ['000010', '000030']);
    for (const s of run.file.stocks) assert.equal(s.d.length, 250);
    assert.ok(fake.calls.get.filter((g) => g.q.FID_INPUT_ISCD === '000020').length <= 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('(W1c) 진짜 빈 페이지(최근 상장)는 실패가 아니다', async () => {
  const dir = tmpDir();
  try {
    const data = dataFor(250);
    data.symbols['000020'] = stockRows(250).slice(220); // 30일 전에 상장
    const run = await collect({ years: 2, out: join(dir, 'a'), client: clientFor(fakeKis(data)), master: master3(), now: () => WINDOW, log: () => {}, repoRoot: join(dir, 'repo') });
    assert.deepEqual(run.summary.failed, []);
    assert.equal(run.file.stocks.find((s) => s.s === '000020').d.length, 30);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
