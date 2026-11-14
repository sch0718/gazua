import assert from 'node:assert/strict';
import test from 'node:test';
import { SCENES, VOICE } from '../scripts/demo-narrated/scenes.mjs';

const IDS = ['intro', 'demo', 'compare', 'groups', 'simulate', 'criteria', 'performance', 'settings', 'outro'];
const lines = SCENES.flatMap((s) => s.lines);

test('장 9개가 정해진 순서예요', () => {
  assert.deepEqual(SCENES.map((s) => s.id), IDS);
  for (const s of SCENES) assert.ok(s.title && s.note && s.lines.length > 0, s.id);
});

test('문장은 한 문장씩, 조작은 함수예요', () => {
  for (const l of lines) {
    assert.match(l.t, /\S[.?!]$/, l.t);
    assert.doesNotMatch(l.t.slice(0, -1), /[.?!]\s/, l.t);
    if ('do' in l) assert.equal(typeof l.do, 'function', l.t);
    if ('say' in l) assert.ok(typeof l.say === 'string' && l.say.trim(), l.t);
  }
});

test('분량은 900~1,400자이고 마무리에 주소와 안내가 있어요', () => {
  const n = lines.reduce((a, l) => a + l.t.length, 0);
  assert.ok(n >= 900 && n <= 1400, `${n}자`);
  const outro = SCENES.at(-1).lines.map((l) => l.t).join(' ');
  assert.match(outro, /투자 조언이 아니에요/);
  assert.match(outro, /gazua\.sch0718\.dev/);
  assert.equal(VOICE.provider, 'edge');
});
