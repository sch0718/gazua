import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUNDLED_DEV, NOTICE_FILE, flatten, render } from '../scripts/build-notices.mjs';

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

test('render includes license and NOTICE text, and marks packages without files', () => {
  const out = render(
    [
      { name: 'a', version: '1.0.0', license: 'Apache-2.0', path: '/a' },
      { name: 'b', version: '1.0.0', license: 'MIT', path: '/b' },
    ],
    (dir) =>
      dir === '/a'
        ? [
            { file: 'LICENSE', text: 'Apache text\n' },
            { file: 'NOTICE', text: 'Notice text' },
          ]
        : [],
  );
  assert.match(out, /PolyForm Noncommercial 1\.0\.0/);
  assert.match(out, /a 1\.0\.0 \(Apache-2\.0\)\n=+\n--- LICENSE ---\nApache text\n\n--- NOTICE ---\nNotice text/);
  assert.match(out, /b 1\.0\.0 \(MIT\)\n=+\n\(패키지에 라이선스 파일이 없어요\. MIT 표준 전문을 따라요: https:\/\/spdx\.org\/licenses\/MIT\.html\)/);
});

test('packages without license files link the SPDX text and name their own author', () => {
  const out = render(
    [
      { name: 'donor', version: '1.0.0', license: 'MIT', path: '/d' },
      { name: 'bare', version: '1.0.0', license: 'MIT', author: 'Firebase', path: '/b' },
    ],
    (dir) => (dir === '/d' ? [{ file: 'LICENSE', text: 'MIT License\nCopyright (c) Someone Else' }] : []),
  );
  assert.match(out, /bare 1\.0\.0 \(MIT\)\n=+\n\(패키지에 라이선스 파일이 없어요\. MIT 표준 전문을 따라요: https:\/\/spdx\.org\/licenses\/MIT\.html, 저작권자: Firebase\)/);
  assert.equal(out.match(/Someone Else/g).length, 1);
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
