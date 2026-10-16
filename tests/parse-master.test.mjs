import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseIdxcode } from '../scripts/parse-idxcode.mjs';
import { parseMaster } from '../scripts/parse-master.mjs';

// CP949 한글 바이트(삼성전자, 관리종목, 종합, 전기·전자)
const SAMSUNG = [0xbb, 0xef, 0xbc, 0xba, 0xc0, 0xfc, 0xc0, 0xda];
const MANAGED = [0xb0, 0xfc, 0xb8, 0xae];
const JONGHAP = [0xc1, 0xbe, 0xc7, 0xd5];
const ELEC = [0xc0, 0xfc, 0xb1, 0xe2, 0xa1, 0xa4, 0xc0, 0xfc, 0xc0, 0xda];

const pad = (bytes, len) => Buffer.concat([Buffer.from(bytes), Buffer.alloc(len - bytes.length, 0x20)]);
const text = (s) => Buffer.from(s, 'ascii');

const OFFSETS = {
  KOSPI: { tail: 227, shares: 113, managed: 62, halted: 60 },
  KOSDAQ: { tail: 221, shares: 108, managed: 57, halted: 55 },
};

function line(market, code, nameBytes, { sec, shares, managed, halted }) {
  const o = OFFSETS[market];
  const tail = Buffer.alloc(o.tail, 0x20);
  tail.write('ST', 0, 'ascii');
  sec.forEach((c, i) => tail.write(c, 3 + i * 4, 'ascii'));
  tail.write(shares, o.shares, 'ascii');
  tail.write(managed, o.managed, 'ascii');
  tail.write(halted, o.halted, 'ascii');
  return Buffer.concat([pad(text(code), 9), text('KR7' + code + '003'), Buffer.from(nameBytes), tail]);
}
// 앞부분: 코드 9 + ISIN 12 + 이름(가변)
const file = (market, lines) => Buffer.concat(lines.flatMap((l) => [l, Buffer.from('\n')]));

const A = { sec: ['0013', '0000', '0000'], shares: '000000005846278', managed: 'N', halted: 'N' };
const B = { sec: ['0027', '0028', '0029'], shares: '000000000012345', managed: 'Y', halted: 'N' };
const C = { sec: ['0001', '0002', '0003'], shares: '000000000000777', managed: 'N', halted: 'Y' };

for (const market of ['KOSPI', 'KOSDAQ']) {
  const bytes = file(market, [line(market, '005930', SAMSUNG, A), line(market, '000020', MANAGED, B), line(market, '000030', MANAGED, C)]);

  test(`${market}: detail 없이는 기존 키만 낸다`, () => {
    const rows = parseMaster(bytes, market);
    assert.equal(rows.length, 3);
    for (const r of rows) assert.deepEqual(Object.keys(r), ['s', 'n', 'm', 't']);
  });

  test(`${market}: detail이면 업종·상장주수·관리·거래정지를 읽는다`, () => {
    const rows = parseMaster(bytes, market, { detail: true });
    const samsung = rows.find((r) => r.s === '005930');
    assert.equal(samsung.n, '삼성전자');
    assert.equal(samsung.shares, 5846278000);
    assert.equal(samsung.sec[0], '0013');
    assert.deepEqual(samsung.sec, ['0013', '0000', '0000']);
    assert.equal(samsung.managed, false);
    assert.equal(samsung.halted, false);
    const odd = rows.find((r) => r.s === '000020');
    assert.deepEqual(odd.sec, ['0027', '0028', '0029']);
    assert.equal(odd.shares, 12345000);
    assert.equal(odd.managed, true);
    assert.equal(odd.halted, false);
    const halted = rows.find((r) => r.s === '000030');
    assert.equal(halted.managed, false);
    assert.equal(halted.halted, true);
    assert.equal(halted.shares, 777000);
  });
}

test('parseIdxcode: 코드 5바이트, 이름 나머지(CP949)', () => {
  const l1 = Buffer.concat([text('00001'), pad(JONGHAP, 40)]);
  const l2 = Buffer.concat([text('00013'), pad(ELEC, 40)]);
  const bytes = Buffer.concat([l1, Buffer.from('\n'), l2, Buffer.from('\r\n')]);
  assert.deepEqual(parseIdxcode(bytes), [
    { code: '00001', name: '종합' },
    { code: '00013', name: '전기·전자' },
  ]);
});

// 실제 마스터에서 뗀 표본으로 오프셋을 고정한다.
const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

test('실제 표본(KOSPI): 삼성전자 상장주수·업종', () => {
  const rows = parseMaster(fixture('kospi_code.sample.mst'), 'KOSPI', { detail: true });
  const samsung = rows.find((r) => r.s === '005930');
  assert.equal(samsung.shares, 5846278000);
  assert.equal(samsung.sec[1], '0013');
});

test('실제 표본(KOSDAQ): 에코프로비엠 상장주수', () => {
  const rows = parseMaster(fixture('kosdaq_code.sample.mst'), 'KOSDAQ', { detail: true });
  assert.equal(rows.find((r) => r.s === '247540').shares, 97830000);
});
