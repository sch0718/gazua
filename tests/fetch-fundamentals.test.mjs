import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIN_API, buildFin, fetchFundamentals } from '../scripts/fetch-fundamentals.mjs';
import { createKisClient } from '../scripts/kis-collect.mjs';

// 손익 행: 매출·영업이익·순이익을 같은 값으로 둔다(차분 확인이 쉽게)
const is = (ym, rev, op = rev, ni = rev) => ({ stac_yymm: ym, sale_account: String(rev), bsop_prti: String(op), thtr_ntin: String(ni) });
const bs = (ym, eq, debt) => ({ stac_yymm: ym, total_cptl: String(eq), total_lblt: String(debt) });
// 분기마다 대차 행(자본 1000+i, 부채 500+i)
const bsFor = (yms) => yms.map((ym, i) => bs(ym, 1000 + i, 500 + i));

test('FIN_API: 가정값(확인 필요 ㉕)이 한 상수에 있다', () => {
  assert.equal(FIN_API.unit, '억 원');
  assert.equal(FIN_API.cumulative, true);
  assert.equal(FIN_API.incomeStatement.trId, 'FHKST66430200');
  assert.equal(FIN_API.balanceSheet.trId, 'FHKST66430100');
  assert.equal(FIN_API.incomeStatement.path, '/uapi/domestic-stock/v1/finance/income-statement');
  assert.equal(FIN_API.balanceSheet.path, '/uapi/domestic-stock/v1/finance/balance-sheet');
  assert.equal(FIN_API.output, 'output');
});

test('buildFin: 12월 결산 누적 [100, 250, 420]과 연간 600이면 분기는 [100, 150, 170, 180]이다', () => {
  const q = ['202403', '202406', '202409'];
  const f = buildFin({
    annualIS: [is('202412', 600)],
    quarterIS: [is('202403', 100), is('202406', 250), is('202409', 420)],
    quarterBS: bsFor([...q, '202412']),
  });
  assert.deepEqual(f.q, ['202403', '202406', '202409', '202412']);
  assert.deepEqual(f.a, [0, 0, 0, 1]);
  assert.deepEqual(f.rev, [100, 150, 170, 180]);
  assert.deepEqual(f.op, [100, 150, 170, 180]);
  assert.deepEqual(f.ni, [100, 150, 170, 180]);
});

test('buildFin: 결산 분기의 분기 누적과 연간이 다르면 연간에서 뺀 값을 쓴다', () => {
  const f = buildFin({
    annualIS: [is('202412', 600)],
    quarterIS: [is('202403', 100), is('202406', 250), is('202409', 420), is('202412', 590)],
    quarterBS: bsFor(['202403', '202406', '202409', '202412']),
  });
  assert.deepEqual(f.rev, [100, 150, 170, 180]);
});

test('buildFin: 응답 순서와 상관없이 오름차순이고, 손익 세 항목을 따로 차분한다', () => {
  const f = buildFin({
    annualIS: [is('202412', 600, 60, 40)],
    quarterIS: [is('202409', 420, 30, 20), is('202403', 100, 10, -5), is('202406', 250, 15, 5)],
    quarterBS: bsFor(['202412', '202409', '202406', '202403']).reverse(),
  });
  assert.deepEqual(f.q, ['202403', '202406', '202409', '202412']);
  assert.deepEqual(f.rev, [100, 150, 170, 180]);
  assert.deepEqual(f.op, [10, 5, 15, 30]);
  assert.deepEqual(f.ni, [-5, 10, 15, 20]);
});

test('buildFin: 회계연도 경계에서는 이전 해 누적값을 빼지 않는다', () => {
  const f = buildFin({
    annualIS: [is('202312', 400), is('202412', 600)],
    quarterIS: [is('202306', 120), is('202309', 300), is('202403', 100), is('202406', 250), is('202409', 420), is('202503', 90), is('202506', 200)],
    quarterBS: bsFor(['202306', '202309', '202312', '202403', '202406', '202409', '202412', '202503', '202506']),
  });
  // 202306은 같은 회계연도 직전 누적(202303)이 없어 구할 수 없으므로 202309부터 남는다
  assert.deepEqual(f.q, ['202309', '202312', '202403', '202406', '202409', '202412', '202503', '202506']);
  assert.deepEqual(f.a, [0, 1, 0, 0, 0, 1, 0, 0]);
  assert.deepEqual(f.rev, [180, 100, 100, 150, 170, 180, 90, 110]);
});

test('buildFin: 3월 결산도 같은 규칙이다', () => {
  const qs = ['202406', '202409', '202412', '202503', '202506'];
  const f = buildFin({
    annualIS: [is('202503', 1000)],
    quarterIS: [is('202406', 200), is('202409', 450), is('202412', 700), is('202506', 260)],
    quarterBS: bsFor(qs),
  });
  assert.deepEqual(f.q, qs);
  assert.deepEqual(f.a, [0, 0, 0, 1, 0]);
  assert.deepEqual(f.rev, [200, 250, 250, 300, 260]);
});

test('buildFin: 3월 결산에서 12월 결산으로 바뀌어도(9개월 회계연도) a와 차분이 연간 행을 따른다', () => {
  const qs = ['202306', '202309', '202312', '202403', '202406', '202409', '202412', '202503', '202506'];
  const f = buildFin({
    annualIS: [is('202403', 70), is('202412', 50)],
    quarterIS: [
      is('202306', 10),
      is('202309', 25),
      is('202312', 45),
      is('202406', 12),
      is('202409', 30),
      is('202503', 8),
      is('202506', 20),
    ],
    quarterBS: bsFor(qs),
  });
  assert.deepEqual(f.q, qs);
  // 옛 3월 결산 분기(202403)도 a = 1로 남는다
  assert.deepEqual(f.a, [0, 0, 0, 1, 0, 0, 1, 0, 0]);
  // 202406은 짧은 회계연도의 첫 분기라 202403 누적을 빼지 않는다. 202503은 새 12월 회계연도의 첫 분기다
  assert.deepEqual(f.rev, [10, 15, 20, 25, 12, 18, 20, 8, 12]);
});

test('buildFin: 마지막 연간 행 뒤 12개월째 분기는 연간 행이 아직 없어도 결산 분기로 본다', () => {
  const qs = ['202503', '202506', '202509', '202512', '202603'];
  const f = buildFin({
    annualIS: [is('202412', 600)],
    quarterIS: [is('202503', 100), is('202506', 210), is('202509', 330), is('202512', 460), is('202603', 120)],
    quarterBS: bsFor(qs),
  });
  assert.deepEqual(f.q, qs);
  assert.deepEqual(f.a, [0, 0, 0, 1, 0]);
  // 202603은 새 회계연도 첫 분기라 202512 누적을 빼지 않는다
  assert.deepEqual(f.rev, [100, 110, 120, 130, 120]);
});

test('buildFin: 대차는 차분하지 않고 분기말 값을 그대로 쓴다', () => {
  const f = buildFin({
    annualIS: [is('202412', 600)],
    quarterIS: [is('202403', 100), is('202406', 250), is('202409', 420)],
    quarterBS: [bs('202403', 1000, 500), bs('202406', 1100, 520), bs('202409', 1150, 480), bs('202412', -20, 900)],
  });
  assert.deepEqual(f.eq, [1000, 1100, 1150, -20]);
  assert.deepEqual(f.debt, [500, 520, 480, 900]);
});

test('buildFin: 분기 대차에 결산 분기가 없으면 연간 대차로 채운다', () => {
  const f = buildFin({
    annualIS: [is('202412', 600)],
    quarterIS: [is('202403', 100), is('202406', 250), is('202409', 420)],
    quarterBS: bsFor(['202403', '202406', '202409']),
    annualBS: [bs('202412', 1234, 567)],
  });
  assert.deepEqual(f.q, ['202403', '202406', '202409', '202412']);
  assert.deepEqual(f.eq, [1000, 1001, 1002, 1234]);
  assert.deepEqual(f.debt, [500, 501, 502, 567]);
});

test('buildFin: 중간 분기가 빠지면 그 앞은 버린다(손익)', () => {
  const qs = ['202403', '202406', '202409', '202412', '202503', '202506'];
  const f = buildFin({
    annualIS: [is('202412', 600)],
    // 202406 손익이 없다: 202406은 빠지고, 202409도 직전 누적이 없어 구할 수 없다
    quarterIS: [is('202403', 100), is('202409', 420), is('202503', 90), is('202506', 200)],
    quarterBS: bsFor(qs),
  });
  assert.deepEqual(f.q, ['202412', '202503', '202506']);
  assert.deepEqual(f.rev, [180, 90, 110]);
});

test('buildFin: 대차가 빠진 분기도 빈 분기다', () => {
  const f = buildFin({
    annualIS: [is('202412', 600)],
    quarterIS: [is('202403', 100), is('202406', 250), is('202409', 420), is('202503', 90)],
    quarterBS: bsFor(['202403', '202409', '202412', '202503']),
  });
  assert.deepEqual(f.q, ['202409', '202412', '202503']);
  assert.deepEqual(f.rev, [170, 180, 90]);
  assert.deepEqual(f.eq, [1001, 1002, 1003]);
});

test('buildFin: 결산월 변경으로 3개월 간격이 깨지면(12월 → 2월) 그 앞은 버린다', () => {
  const f = buildFin({
    annualIS: [is('202412', 600), is('202502', 90)],
    quarterIS: [is('202409', 420), is('202505', 30), is('202508', 70)],
    quarterBS: bsFor(['202409', '202412', '202502', '202505', '202508']),
  });
  assert.deepEqual(f.q, ['202502', '202505', '202508']);
  assert.deepEqual(f.a, [1, 0, 0]);
  assert.deepEqual(f.rev, [90, 30, 40]);
});

test('buildFin: 값이 숫자가 아닌 행은 빈 분기다', () => {
  const qs = ['202403', '202406', '202409', '202412'];
  const f = buildFin({
    annualIS: [is('202412', 600)],
    quarterIS: [is('202403', 100), is('202406', 250), { ...is('202409', 420), thtr_ntin: '' }],
    quarterBS: bsFor(qs),
  });
  // 202409 순이익이 없어 202409와 202412(직전 누적 필요) 모두 구할 수 없다
  assert.deepEqual(f.q, ['202403', '202406']);
  assert.deepEqual(f.ni, [100, 150]);
});

test('buildFin: cumulative:false면 분기 값을 그대로 쓰고, 결산 분기가 없으면 연간에서 앞 분기 합을 뺀다', () => {
  const qs = ['202403', '202406', '202409', '202412', '202503'];
  const raw = {
    annualIS: [is('202412', 600)],
    quarterIS: [is('202403', 100), is('202406', 150), is('202409', 170), is('202503', 90)],
    quarterBS: bsFor(qs),
  };
  const f = buildFin(raw, { cumulative: false });
  assert.deepEqual(f.q, qs);
  assert.deepEqual(f.a, [0, 0, 0, 1, 0]);
  assert.deepEqual(f.rev, [100, 150, 170, 180, 90]);
  // 결산 분기 값이 분기 응답에 있으면 그대로 쓴다
  const g = buildFin({ ...raw, quarterIS: [...raw.quarterIS, is('202412', 175)] }, { cumulative: false });
  assert.deepEqual(g.rev, [100, 150, 170, 175, 90]);
});

test('buildFin: 소수 둘째 자리로 반올림한다', () => {
  const f = buildFin({
    annualIS: [is('202412', 10.1)],
    quarterIS: [is('202403', 1.234), is('202406', 3.3), is('202409', 7.009)],
    quarterBS: [bs('202403', 1.005, 2.999), ...bsFor(['202406', '202409', '202412'])],
  });
  assert.deepEqual(f.rev, [1.23, 2.07, 3.71, 3.09]);
  assert.equal(f.eq[0], 1); // 1.005는 이진수로 1.00499…
  assert.equal(f.debt[0], 3);
  for (const k of ['rev', 'op', 'ni', 'eq', 'debt']) for (const v of f[k]) assert.equal(Object.is(v, -0), false);
});

test('buildFin: 남는 분기가 없으면 null이다', () => {
  assert.equal(buildFin({ annualIS: [], quarterIS: [], quarterBS: [] }), null);
  // 대차가 하나도 없다
  assert.equal(buildFin({ annualIS: [is('202412', 600)], quarterIS: [is('202403', 100)], quarterBS: [] }), null);
  // 연간 행이 없으면 회계연도를 알 수 없다
  assert.equal(buildFin({ annualIS: [], quarterIS: [is('202403', 100)], quarterBS: bsFor(['202403']) }), null);
  // stac_yymm 형식이 틀린 행만 있다
  assert.equal(buildFin({ annualIS: [is('2024', 1)], quarterIS: [is('20240331', 1)], quarterBS: [bs('2024-03', 1, 1)] }), null);
});

// 구분 코드(0 연간, 1 분기)와 TR로 응답을 돌려주는 가짜 클라이언트
function fakeClient(byKey) {
  const calls = [];
  return {
    calls,
    async get(path, trId, query, opts) {
      calls.push({ path, trId, query, opts });
      return { output: byKey[`${trId}:${query.FID_DIV_CLS_CODE}`] ?? [] };
    },
  };
}

test('fetchFundamentals: 손익·대차를 연간·분기로 4번 받는다', async () => {
  const IS = FIN_API.incomeStatement.trId;
  const BS = FIN_API.balanceSheet.trId;
  const c = fakeClient({
    [`${IS}:0`]: [is('202412', 600)],
    [`${IS}:1`]: [is('202409', 420)],
    [`${BS}:0`]: [bs('202412', 1, 2)],
    [`${BS}:1`]: [bs('202409', 3, 4)],
  });
  const r = await fetchFundamentals(c, '005930');
  assert.equal(c.calls.length, 4);
  assert.deepEqual(r.annualIS, [is('202412', 600)]);
  assert.deepEqual(r.quarterIS, [is('202409', 420)]);
  assert.deepEqual(r.annualBS, [bs('202412', 1, 2)]);
  assert.deepEqual(r.quarterBS, [bs('202409', 3, 4)]);
  for (const call of c.calls) {
    assert.equal(call.query.fid_cond_mrkt_div_code, 'J');
    assert.equal(call.query.fid_input_iscd, '005930');
    assert.deepEqual(call.opts, { expectArray: 'output' });
  }
  const sig = c.calls.map((x) => `${x.path.split('/').pop()}:${x.trId}:${x.query.FID_DIV_CLS_CODE}`).sort();
  assert.deepEqual(sig, [
    `balance-sheet:${BS}:0`,
    `balance-sheet:${BS}:1`,
    `income-statement:${IS}:0`,
    `income-statement:${IS}:1`,
  ]);
});

test('fetchFundamentals: 기존 KIS 클라이언트로 요청한다. URL에 키가 없고 헤더에 인증이 있다', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), init });
    if (String(url).endsWith('/oauth2/tokenP')) return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'TOK' }) };
    return { ok: true, status: 200, text: async () => JSON.stringify({ rt_cd: '0', output: [is('202412', 600)] }) };
  };
  const client = createKisClient({ appKey: 'KEY123', appSecret: 'SEC456', fetchImpl, sleep: async () => {} });
  const r = await fetchFundamentals(client, '005930');
  assert.equal(r.annualIS.length, 1);
  const calls = seen.filter((s) => s.url.includes('/finance/'));
  assert.equal(calls.length, 4);
  for (const call of calls) {
    assert.equal(/KEY123|SEC456|TOK/.test(call.url), false);
    assert.equal(call.init.headers.appkey, 'KEY123');
    assert.equal(call.init.headers.authorization, 'Bearer TOK');
  }
});

test('fetchFundamentals: 실패 시 오류 메시지에 키가 없다', async () => {
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/oauth2/tokenP')) return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'TOK' }) };
    throw new Error('boom KEY123 SEC456 TOK');
  };
  const client = createKisClient({ appKey: 'KEY123', appSecret: 'SEC456', fetchImpl, sleep: async () => {} });
  await assert.rejects(fetchFundamentals(client, '005930'), (e) => {
    assert.equal(/KEY123|SEC456|TOK/.test(String(e.message)), false);
    return true;
  });
});
