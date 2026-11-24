import assert from 'node:assert/strict';
import test from 'node:test';
import { MENU_SCENES } from '../scripts/demo-video.mjs';
import { HELP_PAGES } from '../scripts/motion/help.mjs';

test('메뉴 장면 8개의 키와 순서가 도움말 id와 같아요', () => {
  const ids = Object.keys(MENU_SCENES);
  assert.equal(ids.length, 8);
  assert.deepEqual(ids, HELP_PAGES.map(({ id }) => id));
});
