import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
// src/lib/share/kinds.ts의 SHARE_KINDS와 같아야 한다(카카오 카드 고정 이미지 이름)
const kindsSource = readFileSync(new URL('src/lib/share/kinds.ts', root), 'utf8');
const KINDS = JSON.parse(kindsSource.match(/SHARE_KINDS = (\[[^\]]+\])/)[1].replaceAll("'", '"'));

test('종류마다 public/share/<kind>.png가 800×400 PNG로 있다', () => {
  assert.deepEqual(KINDS, ['group', 'strategy', 'criteria', 'compare', 'simResult', 'validation']);
  for (const kind of KINDS) {
    const png = readFileSync(new URL(`public/share/${kind}.png`, root));
    assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG', kind);
    // IHDR: 16~19 폭, 20~23 높이(빅 엔디언)
    assert.equal(png.readUInt32BE(16), 800, `${kind} width`);
    assert.equal(png.readUInt32BE(20), 400, `${kind} height`);
  }
});
