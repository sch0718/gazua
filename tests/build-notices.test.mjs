import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUNDLED_DEV, NOTICE_FILE, flatten, render, upstreamFile } from '../scripts/build-notices.mjs';

test('flatten spreads every version of a package and sorts by name', () => {
  const pkgs = flatten({
    MIT: [{ name: 'zed', versions: ['1.0.0'], paths: ['/z'] }],
    ISC: [{ name: 'abc', versions: ['2.0.0', '1.0.0'], paths: ['/a2', '/a1'] }],
  });
  assert.deepEqual(
    pkgs.map((p) => `${p.name}@${p.version}:${p.license}:${p.path}`),
    ['abc@1.0.0:ISC:/a1', 'abc@2.0.0:ISC:/a2', 'zed@1.0.0:MIT:/z'],
  );
});

test('render includes license and NOTICE text', () => {
  const out = render(
    [{ name: 'a', version: '1.0.0', license: 'Apache-2.0', path: '/a' }],
    () => [
      { file: 'LICENSE', text: 'Apache text\n' },
      { file: 'NOTICE', text: 'Notice text' },
    ],
    () => null,
  );
  assert.match(out, /PolyForm Noncommercial 1\.0\.0/);
  assert.match(out, /a 1\.0\.0 \(Apache-2\.0\)\n=+\n--- LICENSE ---\nApache text\n\n--- NOTICE ---\nNotice text/);
});

test('packages without license files use the upstream copy kept in scripts/licenses', () => {
  const read = (file) => (file === 'firebase.txt' ? 'Copyright Google LLC\nApache License' : null);
  const out = render([{ name: '@firebase/auth', version: '1.0.0', license: 'Apache-2.0', path: '/f' }], () => [], read);
  assert.match(out, /@firebase\/auth 1\.0\.0 \(Apache-2\.0\)\n=+\n--- upstream LICENSE \(scripts\/licenses\/firebase\.txt\) ---\nCopyright Google LLC/);
});

test('the same upstream text is printed once and referenced afterwards', () => {
  const read = () => 'Copyright Google LLC\nApache License';
  const pkgs = ['@firebase/app', '@firebase/auth'].map((name) => ({ name, version: '1.0.0', license: 'Apache-2.0', path: '/f' }));
  const out = render(pkgs, () => [], read);
  assert.equal(out.match(/Copyright Google LLC/g).length, 1);
  assert.match(out, /@firebase\/auth 1\.0\.0 \(Apache-2\.0\)\n=+\n--- upstream LICENSE \(scripts\/licenses\/firebase\.txt\) ---\n\(위 @firebase\/app 1\.0\.0에 실은 원문과 같아요\)/);
});

test('a package with no license text anywhere stops the build', () => {
  assert.throws(
    () => render([{ name: 'mystery', version: '1.0.0', license: 'MIT', path: '/m' }], () => [], () => null),
    /mystery@1\.0\.0/,
  );
});

test('the upstream copies exist for every mapped package', async () => {
  const { readFileSync } = await import('node:fs');
  for (const name of ['firebase', '@firebase/app', 'fancy-canvas']) {
    const text = readFileSync(new URL(`../scripts/licenses/${upstreamFile(name)}`, import.meta.url), 'utf8');
    assert.match(text, /Copyright/);
  }
});

test('bundled dev packages are kept, build-only ones are not', () => {
  for (const n of ['svelte', 'clsx', 'esm-env', 'workbox-precaching', 'workbox-window']) assert.equal(BUNDLED_DEV(n), true, n);
  for (const n of ['workbox-build', 'vite', 'typescript']) assert.equal(BUNDLED_DEV(n), false, n);
  const pkgs = flatten({ MIT: [{ name: 'svelte', versions: ['5.0.0'], paths: ['/s'] }, { name: 'vite', versions: ['6.0.0'], paths: ['/v'] }] }, BUNDLED_DEV);
  assert.deepEqual(pkgs.map((p) => p.name), ['svelte']);
});

test('hyphenated license file names are recognised', () => {
  assert.equal(NOTICE_FILE.test('LICENSE-MIT.txt'), true);
  assert.equal(NOTICE_FILE.test('LICENSE.md'), true);
  assert.equal(NOTICE_FILE.test('licenses.json'), false);
});
