import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FLOW_API, alignFlow, fetchInvestorFlow } from '../scripts/fetch-investor-flow.mjs';
import { createKisClient } from '../scripts/kis-collect.mjs';

const row = (d, f, o, p) => ({
  stck_bsop_date: d,
  frgn_ntby_tr_pbmn: String(f),
  orgn_ntby_tr_pbmn: String(o),
  prsn_ntby_tr_pbmn: String(p),
});

// 기준일(FID_INPUT_DATE_1)별 응답을 돌려주는 가짜 클라이언트
function fakeClient(pages) {
  const calls = [];
  return {
    calls,
    async get(path, trId, query, opts) {
      calls.push({ path, trId, query, opts });
      return { output2: pages[query.FID_INPUT_DATE_1] ?? [] };
    },
  };
}

test('3페이지를 넘겨 오름차순으로 합친다', async () => {
  const c = fakeClient({
    20261016: [row('20261016', 3, 3, 3), row('20261015', 2, 2, 2)],
    20261014: [row('20261014', 1, 1, 1), row('20261013', 0, 0, 0)],
    20261012: [row('20261012', -1, -1, -1), row('20261009', -2, -2, -2)],
    20261008: [],
  });
  const r = await fetchInvestorFlow(c, '005930', { from: '20260101', to: '20261016' });
  assert.deepEqual(r.map((x) => x.d), ['20261009', '20261012', '20261013', '20261014', '20261015', '20261016']);
  assert.equal(c.calls.length, 4);
  assert.equal(c.calls[0].path.endsWith('investor-trade-by-stock-daily'), true);
  assert.equal(c.calls[0].trId, FLOW_API.trId);
  assert.equal(c.calls[0].query.FID_INPUT_ISCD, '005930');
  assert.equal(c.calls[0].query.FID_COND_MRKT_DIV_CODE, 'J');
});

test('from에 닿으면 멈춘다', async () => {
  const c = fakeClient({
    20261016: [row('20261016', 1, 1, 1), row('20261014', 1, 1, 1)],
    20261013: [row('20261013', 1, 1, 1), row('20261010', 1, 1, 1)],
    20261009: [row('20261008', 9, 9, 9)],
  });
  const r = await fetchInvestorFlow(c, '005930', { from: '20261010', to: '20261016' });
  assert.equal(c.calls.length, 2);
  assert.deepEqual(r.map((x) => x.d), ['20261010', '20261013', '20261014', '20261016']);
});

test('빈 응답이면 멈춘다', async () => {
  const c = fakeClient({});
  const r = await fetchInvestorFlow(c, '005930', { from: '20260101', to: '20261016' });
  assert.deepEqual(r, []);
  assert.equal(c.calls.length, 1);
});

test('같은 날짜가 반복되면 멈춘다', async () => {
  const same = [row('20261015', 1, 1, 1)];
  const c = fakeClient({ 20261016: same, 20261014: same, 20261013: same });
  const r = await fetchInvestorFlow(c, '005930', { from: '20260101', to: '20261016' });
  assert.deepEqual(r.map((x) => x.d), ['20261015']);
  assert.equal(c.calls.length, 2);
});

test('단위를 정수로 반올림한다', async () => {
  const c = fakeClient({ 20261016: [row('20261016', '1234.6', '-0.4', '-5.5')] });
  const r = await fetchInvestorFlow(c, '005930', { from: '20261016', to: '20261016' });
  assert.equal(r[0].f, 1235);
  assert.equal(Object.is(r[0].i, -0), false);
  assert.equal(r[0].i, 0);
  assert.equal(r[0].p, -5);
});

test('기존 KIS 클라이언트로 요청한다: URL에 키가 없고 헤더에 인증이 있다', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), init });
    if (String(url).endsWith('/oauth2/tokenP')) return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'TOK' }) };
    return { ok: true, status: 200, text: async () => JSON.stringify({ rt_cd: '0', output2: [row('20261016', 1, 2, 3)] }) };
  };
  const client = createKisClient({ appKey: 'KEY123', appSecret: 'SEC456', fetchImpl, sleep: async () => {} });
  const r = await fetchInvestorFlow(client, '005930', { from: '20261016', to: '20261016' });
  assert.equal(r.length, 1);
  const call = seen.find((s) => s.url.includes('investor-trade-by-stock-daily'));
  assert.ok(call);
  assert.equal(call.url.includes('KEY123') || call.url.includes('SEC456') || call.url.includes('TOK'), false);
  assert.equal(call.init.headers.appkey, 'KEY123');
  assert.equal(call.init.headers.appsecret, 'SEC456');
  assert.equal(call.init.headers.authorization, 'Bearer TOK');
  assert.equal(call.init.headers.tr_id, FLOW_API.trId);
});

test('실패 시 오류 메시지에 키가 없다', async () => {
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/oauth2/tokenP')) return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'TOK' }) };
    throw new Error('boom KEY123 SEC456 TOK');
  };
  const client = createKisClient({ appKey: 'KEY123', appSecret: 'SEC456', fetchImpl, sleep: async () => {} });
  await assert.rejects(fetchInvestorFlow(client, '005930', { from: '20261016', to: '20261016' }), (e) => {
    assert.equal(/KEY123|SEC456|TOK/.test(String(e.message)), false);
    return true;
  });
});

const r = (d) => ({ d, f: 1, i: 2, p: 3 });

test('alignFlow: 빈 날이 없으면 from은 첫 날이다', () => {
  const a = alignFlow(['20261012', '20261013', '20261014'], [r('20261012'), r('20261013'), r('20261014')]);
  assert.deepEqual(a, { from: '20261012', f: [1, 1, 1], i: [2, 2, 2], p: [3, 3, 3] });
});

test('alignFlow: 중간에 빈 날이 있으면 from은 그 다음 날이다', () => {
  const a = alignFlow(['20261012', '20261013', '20261014', '20261015'], [r('20261012'), r('20261014'), r('20261015')]);
  assert.equal(a.from, '20261014');
  assert.equal(a.f.length, 2);
});

test('alignFlow: 끝쪽 일봉에 수급이 없으면 마지막 수급 행에서 끝난다', () => {
  const a = alignFlow(['20261012', '20261013', '20261014'], [r('20261012'), r('20261013')]);
  assert.equal(a.from, '20261012');
  assert.deepEqual(a.f, [1, 1]);
});

test('alignFlow: 일봉에 없는 수급 날짜는 버린다', () => {
  const a = alignFlow(['20261012', '20261014'], [r('20261012'), r('20261013'), r('20261014')]);
  assert.equal(a.from, '20261012');
  assert.equal(a.f.length, 2);
});

test('alignFlow: 남는 날이 없으면 null이다', () => {
  assert.equal(alignFlow(['20261012'], [r('20261001')]), null);
  assert.equal(alignFlow(['20261012'], []), null);
});

test('to 뒤의 행은 버린다', async () => {
  const c = fakeClient({ 20261015: [row('20261016', 9, 9, 9), row('20261015', 1, 1, 1)] });
  const r = await fetchInvestorFlow(c, '005930', { from: '20261015', to: '20261015' });
  assert.deepEqual(r.map((x) => x.d), ['20261015']);
});

test('from 앞의 행은 버린다', async () => {
  const c = fakeClient({ 20261016: [row('20261016', 1, 1, 1), row('20261005', 5, 5, 5)] });
  const r = await fetchInvestorFlow(c, '005930', { from: '20261010', to: '20261016' });
  assert.deepEqual(r.map((x) => x.d), ['20261016']);
});

test('필드가 빠진 행은 건너뛴다', async () => {
  const bad = { stck_bsop_date: '20261015', frgn_ntby_tr_pbmn: '1' };
  const c = fakeClient({ 20261016: [row('20261016', 1, 1, 1), bad, { frgn_ntby_tr_pbmn: '1' }] });
  const r = await fetchInvestorFlow(c, '005930', { from: '20261016', to: '20261016' });
  assert.deepEqual(r.map((x) => x.d), ['20261016']);
});

test('더 최근 행만 돌려주는 오작동 API면 1번 호출 뒤 멈춘다', async () => {
  const c = fakeClient({ 20261010: [row('20261016', 1, 1, 1)], 20261015: [row('20261016', 1, 1, 1)] });
  const r = await fetchInvestorFlow(c, '005930', { from: '20260101', to: '20261010' });
  assert.equal(c.calls.length, 1);
  assert.deepEqual(r, []);
});

test('alignFlow: 첫 일봉에 수급이 없어도 나머지는 맞춘다', () => {
  const a = alignFlow(['20261012', '20261013', '20261014'], [r('20261013'), r('20261014')]);
  assert.equal(a.from, '20261013');
  assert.equal(a.f.length, 2);
});

test('alignFlow: 중간 빈 날과 끝 빈 날이 함께 있다', () => {
  const bars = ['20261012', '20261013', '20261014', '20261015', '20261016'];
  const a = alignFlow(bars, [r('20261012'), r('20261014'), r('20261015')]);
  assert.equal(a.from, '20261014');
  assert.equal(a.f.length, 2);
});
