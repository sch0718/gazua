import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gzipSync, gunzipSync } from 'node:zlib';
import * as collector from '../scripts/collect-market-data.mjs';
import { createTossClient } from '../scripts/toss-collect.mjs';

const { collect, parseArgs, REPO_ROOT } = collector;
const NOW = Date.UTC(2026, 10, 12, 12);
const dates = ['20241112', '20241113', '20251112', '20251113', '20251114', '20251117', '20251118', '20251119', '20261111'];
const cols = (ds) => ({ d: ds, ...Object.fromEntries(['o', 'h', 'l', 'c', 'v', 'tv'].map((k, j) => [k, ds.map((d) => Number(d.slice(4)) + j)])) });
const meta = (s) => ({ s, n: `종목${s}`, m: 'KOSPI', t: 'STOCK', sec: ['', '', ''], shares: 100, managed: false, halted: false });
const oldFile = (ds = dates.slice(2)) => ({
  format: 'gazua-market-data', version: 4, source: 'toss', adjusted: true,
  range: { from: `${ds[0].slice(0, 4)}-${ds[0].slice(4, 6)}-${ds[0].slice(6)}`, to: '2026-11-11' },
  stocks: ['A', 'B', 'C'].map((s) => ({ ...meta(s), ...cols(ds) })),
  indices: ['KOSPI', 'KOSDAQ'].map((id) => { const c = cols(ds); return { id, d: c.d, o: c.o, c: c.c }; }),
  macro: { usdkrw: { d: ['20240101'], v: [1300] } },
});
const master = { stocks: ['A', 'B', 'C', 'NEW'].map(meta), idxcode: [], themes: [] };
const save = (p, v) => writeFileSync(p, gzipSync(JSON.stringify(v)));
const read = (p) => JSON.parse(gunzipSync(readFileSync(p)));
const fred = async (url) => new Response(`observation_date,${new URL(url).searchParams.get('id')}\n2024-01-01,1300\n`);

// 최신순 페이지·nextBefore 모양을 실제 토스 응답과 맞춰요.
function fakeToss({ symbols = {}, indices = {}, fail } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (u.pathname === '/oauth2/token') return Response.json({ access_token: '가짜토큰', expires_in: 86400 });
    const id = u.pathname.match(/market-indicators\/(\w+)\/candles/)?.[1];
    const symbol = id ?? u.searchParams.get('symbol');
    calls.push({ symbol, before: u.searchParams.get('before') });
    if (fail?.(symbol)) return Response.json({}, { status: 403 });
    const data = (id ? indices : symbols)[symbol] ?? cols(dates);
    const before = u.searchParams.get('before').slice(0, 10).replaceAll('-', '');
    const rows = data.d.map((d, i) => ({ d, i })).filter((r) => r.d <= before).reverse();
    const count = Number(u.searchParams.get('count'));
    const timestamp = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}T00:00:00+09:00`;
    const candles = rows.slice(0, count).map(({ d, i }) => ({ timestamp: timestamp(d), openPrice: data.o[i], highPrice: data.h[i], lowPrice: data.l[i], closePrice: data.c[i], volume: data.v[i], currency: 'KRW' }));
    return Response.json({ result: { candles, ...(rows[count] ? { nextBefore: timestamp(rows[count].d) } : {}) } });
  };
  let ms = NOW;
  const client = createTossClient({ clientId: 'fake-id', clientSecret: 'fake-secret', fetchImpl, now: () => ms, sleep: async (n) => { ms += n; } });
  return { calls, client };
}
async function fixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'extend-back-'));
  const path = join(dir, 'market-data-20261111.json.gz');
  save(path, oldFile());
  const run = (fake, opts = {}) => collect({ extendBack: path, years: 1, maxYears: 5, source: 'toss', out: dir, client: fake.client, master, now: () => NOW, sleep: async () => {}, fredFetch: fred, ...opts });
  try { await fn({ dir, path, run }); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('계획: 목표일·14일 여유·연도 하한을 계산해요', () => {
  assert.equal(typeof collector.planExtendBack, 'function');
  const p = collector.planExtendBack(oldFile(), { years: 10, maxYears: 5, today: '20261112' });
  assert.deepEqual(p, { reached: false, from: '20211112', to: '20261111' });
  const prev = oldFile(['20211126', '20261111']);
  assert.equal(collector.planExtendBack(prev, { years: 1, maxYears: 5, today: '20261112' }).reached, true);
  prev.range.from = '2021-11-27';
  assert.equal(collector.planExtendBack(prev, { years: 1, maxYears: 5, today: '20261112' }).reached, false);
  assert.throws(() => collector.planExtendBack({}, { years: 1, maxYears: 5, today: '20261112' }), /시장 데이터/);
});

test('1: 지수·종목 앞에 붙이고 겹친 날과 끝 날짜·v4·이름을 지키며 백업 하나를 덮어써요', async () => fixture(async ({ dir, path, run }) => {
  const before = read(path);
  const backup = join(dir, 'market-data-backup.json.gz.bak');
  writeFileSync(backup, '이전 백업');
  const result = await run(fakeToss());
  assert.equal(result.file.version, 4);
  assert.equal(result.file.format, 'gazua-market-data');
  assert.deepEqual(result.file.range, { from: '2024-11-12', to: '2026-11-11' });
  assert.deepEqual(result.file.indices[0].d, dates);
  assert.deepEqual(result.file.stocks.map((s) => s.s), ['A', 'B', 'C']);
  assert.deepEqual(result.file.stocks[0].d, dates);
  assert.deepEqual(result.file.stocks[0].tv.slice(2), before.stocks[0].tv);
  assert.equal(result.summary.path, join(dir, 'market-data-20261112.json.gz'));
  assert.deepEqual(read(backup), before);
  assert.equal(existsSync(path), false);
  // 같은 날 다시 늘려도 원본을 먼저 백업해요.
  const current = read(result.summary.path);
  await run(fakeToss({ symbols: { A: cols(['20231112', ...dates]) }, indices: { KOSPI: cols(['20231112', ...dates]), KOSDAQ: cols(['20231112', ...dates]) } }), { extendBack: result.summary.path });
  assert.deepEqual(read(backup), current);
  assert.equal(readdirSync(dir).filter((n) => n.endsWith('.bak')).length, 1);
  assert.equal(readdirSync(dir).some((n) => /partial|tmp$/.test(n)), false);
}));

test('2: 상장일 종목도 한 번 요청하고, 지난 실패로 늦게 시작한 종목은 채워요', async () => fixture(async ({ path, run }) => {
  const prev = read(path);
  prev.stocks[0] = { ...meta('A'), ...cols(dates.slice(2)) };
  prev.stocks[1] = { ...meta('B'), ...cols(dates.slice(4)) };
  save(path, prev);
  const fake = fakeToss({ symbols: { A: cols(dates.slice(2)) } });
  const { file } = await run(fake);
  assert.equal(fake.calls.filter((r) => r.symbol === 'A').length, 1);
  assert.deepEqual(file.stocks[0], prev.stocks[0]);
  assert.deepEqual(file.stocks[1].d, dates);
  assert.equal(fake.calls.some((r) => r.symbol === 'NEW'), false);
}));

test('3: mergeBack은 가격 불일치·공통 날짜 없음이면 붙이지 않고, 공통 날짜가 같으면 기존 값을 지켜요', () => {
  assert.equal(typeof collector.mergeBack, 'function');
  const old = cols(dates.slice(2));
  for (const fresh of [cols(dates.slice(0, 2)), { ...cols(dates), o: dates.map(() => 1) }]) {
    const result = collector.mergeBack(old, fresh);
    assert.equal(result.cols, old);
    assert.equal(result.mismatch, true);
  }
  assert.deepEqual(collector.mergeBack(old, cols(dates)).cols.d, dates);
  assert.equal(collector.mergeBack(old, cols(dates.slice(2))).cols, old);
  const index = { d: old.d, o: old.o, c: old.c };
  assert.equal(collector.mergeBack(index, { d: old.d.slice(0, 1), o: old.o.slice(0, 1), c: old.c.slice(0, 1) }).mismatch, false);
});

test('3: 수정주가가 다른 종목은 지키고 로그에 남겨요', async () => fixture(async ({ path, run }) => {
  const logs = [];
  const fresh = cols(dates); fresh.c[2]++;
  const { file } = await run(fakeToss({ symbols: { A: fresh } }), { log: (s) => logs.push(s) });
  assert.deepEqual(file.stocks[0], read(join(path, '..', 'market-data-backup.json.gz.bak')).stocks[0]);
  assert.ok(logs.some((s) => s.includes('수정주가가 달라 늘리지 않았어요: A')));
}));

test('4: 다음 날 재실행해도 진행분 기간을 쓰고 끝난 종목은 다시 받지 않아요', async () => fixture(async ({ dir, path, run }) => {
  const prev = oldFile(dates.slice(2)); save(path, prev);
  await assert.rejects(run(fakeToss({ fail: (s) => s === 'B' }), { maxYears: 2 }), /403/);
  const partial = join(dir, 'market-data-extend-back.partial');
  const header = JSON.parse(readFileSync(partial, 'utf8').split('\n')[0]);
  assert.equal(header.from, '20241112');
  assert.equal(header.extendFrom, path);
  const fake = fakeToss();
  const { file } = await run(fake, { maxYears: 2, now: () => NOW + 86400000 });
  assert.equal(fake.calls.some((r) => ['A', 'KOSPI', 'KOSDAQ'].includes(r.symbol)), false);
  assert.equal(file.range.from, '2024-11-12');
  assert.equal(existsSync(partial), false);
}));

test('5: 목표 도달은 owner·마스터·토큰 전에 끝나고 파일을 쓰지 않아요', async () => fixture(async ({ dir, path }) => {
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const from = `${Number(today.slice(0, 4)) - 5}${today.slice(4).replaceAll('-', '')}`;
  save(path, oldFile([from, '20261111']));
  const before = readFileSync(path);
  const r = spawnSync(process.execPath, [join(REPO_ROOT, 'scripts/collect-market-data.mjs'), '--provider', 'toss', '--extend-back', path], {
    encoding: 'utf8', timeout: 3000,
    env: { ...process.env, TOSS_CLIENT_ID: 'fake-id', TOSS_CLIENT_SECRET: 'fake-secret' },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /이미 5년치예요/);
  assert.deepEqual(readFileSync(path), before);
  assert.equal(readdirSync(dir).length, 1);
}));

test('6: 옵션 충돌·공급자·상한을 검사하고 늘리기 기본은 1년·초당 1건이에요', () => {
  const o = parseArgs(['--provider', 'toss', '--extend-back', '/tmp/old.json.gz']);
  assert.equal(o.extendBack, '/tmp/old.json.gz');
  assert.equal(o.years, 1); assert.equal(o.rate, 1); assert.equal(o.maxYears, 5); assert.equal(o.out, '/tmp');
  assert.equal(parseArgs(['--provider', 'toss', '--years', '2', '--extend-back', '/tmp/old.json.gz', '--rate', '0.5']).years, 2);
  assert.equal(parseArgs([]).years, 5);
  assert.throws(() => parseArgs(['--provider', 'toss', '--extend-back', 'a', '--update', 'b']), /함께/);
  assert.throws(() => parseArgs(['--extend-back', 'a']), /toss/);
  for (const n of ['0', '11', '1.5']) assert.throws(() => parseArgs(['--provider', 'toss', '--extend-back', 'a', '--max-years', n]), /--max-years/);
});

test('KOSPI가 늘지 않으면 종목·매크로를 받지 않고 원본을 지켜요', async () => fixture(async ({ dir, path, run }) => {
  const fake = fakeToss({ indices: { KOSPI: cols(dates.slice(2)) } });
  const logs = [];
  const before = readFileSync(path);
  await run(fake, { log: (s) => logs.push(s), fredFetch: () => { assert.fail('매크로를 요청했어요'); } });
  assert.equal(fake.calls.length, 1);
  assert.ok(logs.some((s) => s.includes('더 오래된 지수가 없어요')));
  assert.deepEqual(readFileSync(path), before);
  assert.deepEqual(readdirSync(dir), ['market-data-20261111.json.gz']);
}));

test('종목 실패는 이전 값을 지키고, 매크로 실패는 이전 계열을 지켜요', async () => fixture(async ({ run }) => {
  const fake = fakeToss();
  const daily = fake.client.dailyCandles;
  fake.client.dailyCandles = (s, ...rest) => s === 'A' ? Promise.reject(new Error('받지 못했어요')) : daily(s, ...rest);
  const { file, summary } = await run(fake, { fredFetch: async () => { throw new Error('받지 못했어요'); } });
  assert.deepEqual(summary.failed, ['A']);
  assert.deepEqual(file.stocks[0].d, dates.slice(2));
  assert.deepEqual(file.macro.usdkrw, oldFile().macro.usdkrw);
}));
