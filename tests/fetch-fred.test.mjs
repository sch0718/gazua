import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchFredSeries } from '../scripts/fetch-fred.mjs';

const NEW = 'observation_date,DEXKOUS\n2026-10-05,1341.70\n2026-10-06,.\n2026-10-07,1339.12\n2026-10-08,1343.34\n';
const OLD = 'DATE,DEXKOUS\n2026-10-05,1341.70\n2026-10-06,.\n';
const ok = (body) => async () => ({ ok: true, status: 200, text: async () => body });
const noSleep = async () => {};

test('observation_date 헤더를 읽고 . 값을 버린다', async () => {
  const r = await fetchFredSeries('DEXKOUS', { fetchImpl: ok(NEW), sleep: noSleep });
  assert.deepEqual(r, { d: ['20261005', '20261007', '20261008'], v: [1341.7, 1339.12, 1343.34] });
});

test('예전 DATE 헤더도 받는다', async () => {
  const r = await fetchFredSeries('DEXKOUS', { fetchImpl: ok(OLD), sleep: noSleep });
  assert.deepEqual(r, { d: ['20261005'], v: [1341.7] });
});

test('from/to로 기간을 거르고 URL에 cosd/coed를 붙인다', async () => {
  let url = '';
  const fetchImpl = async (u) => {
    url = u;
    return ok(NEW)();
  };
  const r = await fetchFredSeries('DEXKOUS', { fetchImpl, from: '2026-10-07', to: '2026-10-07', sleep: noSleep });
  assert.deepEqual(r.d, ['20261007']);
  assert.match(url, /id=DEXKOUS/);
  assert.match(url, /cosd=2026-10-07/);
  assert.match(url, /coed=2026-10-07/);
});

test('실패 뒤 재시도하면 성공한다', async () => {
  let n = 0;
  const fetchImpl = async () => {
    n += 1;
    if (n < 3) throw new Error('boom');
    return ok(NEW)();
  };
  const r = await fetchFredSeries('DEXKOUS', { fetchImpl, sleep: noSleep });
  assert.equal(n, 3);
  assert.equal(r.d.length, 3);
});

test('3번 모두 실패하면 throw한다', async () => {
  let n = 0;
  const fetchImpl = async () => {
    n += 1;
    return { ok: false, status: 503, text: async () => '' };
  };
  await assert.rejects(fetchFredSeries('DEXKOUS', { fetchImpl, sleep: noSleep }), /FRED DEXKOUS/);
  assert.equal(n, 3);
});

test('헤더가 다르면 throw한다', async () => {
  await assert.rejects(fetchFredSeries('DEXKOUS', { fetchImpl: ok('<html>\n'), sleep: noSleep }));
});

test('4xx는 다시 보내지 않고 바로 throw한다', async () => {
  let n = 0;
  const fetchImpl = async () => {
    n += 1;
    return { ok: false, status: 404, text: async () => '' };
  };
  await assert.rejects(fetchFredSeries('DEXKOUS', { fetchImpl, sleep: noSleep }), /HTTP 404/);
  assert.equal(n, 1);
});

test('429는 다시 보낸다', async () => {
  let n = 0;
  const fetchImpl = async () => {
    n += 1;
    return n < 2 ? { ok: false, status: 429, text: async () => '' } : ok(NEW)();
  };
  const r = await fetchFredSeries('DEXKOUS', { fetchImpl, sleep: noSleep });
  assert.equal(n, 2);
  assert.equal(r.d.length, 3);
});

test('시간 초과면 다시 보내고 3번 모두 넘기면 throw한다', async () => {
  let n = 0;
  // 응답하지 않고 signal이 끊기기를 기다린다
  const fetchImpl = (_u, { signal }) => {
    n += 1;
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  };
  // AbortSignal.timeout의 타이머는 이벤트 루프를 붙잡지 않아(Node 22) 기다리는 동안 루프가 끝나지 않게 붙잡아 둔다
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await assert.rejects(fetchFredSeries('DEXKOUS', { fetchImpl, sleep: noSleep, timeoutMs: 5 }), /FRED DEXKOUS 요청 실패/);
  } finally {
    clearInterval(keepAlive);
  }
  assert.equal(n, 3);
});
