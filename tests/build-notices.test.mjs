import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { BUNDLED_DEV, upstreamFile } from '../scripts/build-notices.mjs';

// 고지 생성(flatten·render·readTexts)은 @sch0718/license-notices의 시험이 확인한다. 여기서는 가즈아 설정만 본다.

test('the upstream copies exist for every mapped package', () => {
  for (const name of ['firebase', '@firebase/app', 'fancy-canvas']) {
    const text = readFileSync(
      new URL(`../scripts/licenses/${upstreamFile(name)}`, import.meta.url),
      'utf8',
    );
    assert.match(text, /Copyright/);
  }
  assert.equal(upstreamFile('svelte'), null);
});

test('bundled dev packages are kept, build-only ones are not', () => {
  for (const n of [
    'svelte',
    'clsx',
    'esm-env',
    'workbox-precaching',
    'workbox-window',
    '@sch0718/firebase-session',
    '@sch0718/ui-svelte',
  ])
    assert.equal(BUNDLED_DEV(n), true, n);
  for (const n of [
    'workbox-build',
    'vite',
    'typescript',
    '@sch0718/vite-app',
    '@sch0718/license-notices',
  ])
    assert.equal(BUNDLED_DEV(n), false, n);
});
