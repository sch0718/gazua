import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flatten, render } from '../scripts/build-notices.mjs';

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
  assert.match(out, /b 1\.0\.0 \(MIT\)\n=+\n\(라이선스 파일 없음 — MIT\)/);
});

test('packages without license files point to one shared copy of the same license text', () => {
  const out = render(
    [
      { name: 'donor', version: '1.0.0', license: 'Apache-2.0', path: '/d' },
      { name: 'bare', version: '1.0.0', license: 'Apache-2.0', author: 'Firebase', path: '/b' },
      { name: 'bare2', version: '1.0.0', license: 'Apache-2.0', path: '/b2' },
    ],
    (dir) => (dir === '/d' ? [{ file: 'LICENSE', text: 'Apache License 2.0 full text' }] : []),
  );
  assert.match(out, /bare 1\.0\.0 \(Apache-2\.0\)\n=+\n\(패키지에 라이선스 파일이 없어요\. 맨 끝의 Apache-2\.0 전문을 따라요, 저작권자: Firebase\)/);
  assert.match(out, /Apache-2\.0 전문\n=+\nApache License 2\.0 full text\n$/);
  assert.equal(out.match(/^Apache-2\.0 전문$/gm).length, 1);
});
