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
