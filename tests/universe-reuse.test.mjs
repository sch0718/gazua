import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';

// 스크립트를 임시 폴더로 복사해 돌린다(저장소의 public/universe.json을 건드리지 않는다).
// fetch는 항상 실패하는 스텁으로 바꿔서, 받으려 했는지를 출력으로 구별한다.
function run({ withFile, reuse }) {
  const root = mkdtempSync(join(tmpdir(), 'universe-reuse-'));
  try {
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'public'));
    cpSync(new URL('../scripts/', import.meta.url), join(root, 'scripts'), { recursive: true });
    symlinkSync(fileURLToPath(new URL('../node_modules', import.meta.url)), join(root, 'node_modules'));
    if (withFile) writeFileSync(join(root, 'public/universe.json'), '[]');
    const stub = join(root, 'stub-fetch.mjs');
    writeFileSync(stub, "globalThis.fetch = async () => { throw new Error('offline'); };\n");
    const env = { ...process.env, NODE_OPTIONS: `--import=${pathToFileURL(stub).href}` };
    delete env.UNIVERSE_REUSE;
    if (reuse) env.UNIVERSE_REUSE = 'true';
    const r = spawnSync(process.execPath, [join(root, 'scripts/build-universe.mjs')], { env, encoding: 'utf8' });
    return { status: r.status, out: r.stdout, err: r.stderr };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('UNIVERSE_REUSE=true + 파일 있음: 받지 않고 캐시를 그대로 써요', () => {
  const r = run({ withFile: true, reuse: true });
  assert.equal(r.status, 0);
  assert.match(r.out, /\[universe\] 캐시된 파일을 그대로 써요/);
  assert.doesNotMatch(r.err, /offline|경고/);
});

test('UNIVERSE_REUSE=true + 파일 없음: 기존처럼 받으려 하고 실패하면 exit 1', () => {
  const r = run({ withFile: false, reuse: true });
  assert.equal(r.status, 1);
  assert.match(r.err, /offline/);
});

test('UNIVERSE_REUSE 없음 + 파일 있음: 받으려 하고, 실패하면 기존 파일을 유지해요', () => {
  const r = run({ withFile: true, reuse: false });
  assert.equal(r.status, 0);
  assert.match(r.err, /경고/);
  assert.match(r.err, /offline/);
});
