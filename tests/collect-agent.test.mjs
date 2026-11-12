import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const agent = join(repo, 'scripts/macos/collect-agent');
// run.sh·install.sh는 맥 전용(/usr/bin/lockf, plutil, launchd)이라 맥에서만 시험해요
const macOnly = { skip: process.platform !== 'darwin' };
const temporary = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'gazua-collect-agent-'));
  try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

test('예약 수집: DRY 설치는 03:30 일정의 plist만 만들어요', macOnly, () => temporary((dir) => {
  const home = join(dir, '집 & 테스트');
  const dest = join(dir, 'plist');
  const result = spawnSync('/bin/bash', [join(agent, 'install.sh')], {
    encoding: 'utf8', env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), GAZUA_COLLECT_DRY: '1', GAZUA_COLLECT_DRY_DIR: dest },
  });
  assert.equal(result.status, 0, result.stderr);
  const plist = join(dest, 'com.gazua.collect.extend.plist');
  assert.equal(spawnSync('plutil', ['-lint', plist]).status, 0);
  const xml = readFileSync(plist, 'utf8');
  assert.match(xml, /<key>Hour<\/key>\s*<integer>3<\/integer>/);
  assert.match(xml, /<key>Minute<\/key>\s*<integer>30<\/integer>/);
  assert.match(xml, /집 &amp; 테스트\/Library\/Logs\/gazua\/collect\.log/);
  assert.ok(xml.includes(join(agent, 'run.sh')));
  assert.match(xml, /GAZUA_COLLECT_NODE/);
  assert.match(xml, /GAZUA_COLLECT_ENV/);
  assert.ok(!existsSync(home), '설정·로그·LaunchAgents는 만들지 않아요');
}));

function runner(dir) {
  const data = join(dir, '시장 파일');
  mkdirSync(data);
  const envFile = join(dir, 'collect.env');
  writeFileSync(envFile, `GAZUA_COLLECT_DIR='${data}'\nGAZUA_COLLECT_MAX_YEARS=7\nGAZUA_COLLECT_RATE=0.5\n`);
  const called = join(dir, 'called');
  const node = join(dir, '가짜 node');
  writeFileSync(node, '#!/bin/bash\nprintf "%s\\n" "$PWD" "$@" > "$GAZUA_TEST_CALLED"\n', { mode: 0o755 });
  const run = () => spawnSync('/bin/bash', [join(agent, 'run.sh')], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, GAZUA_COLLECT_ENV: envFile, GAZUA_COLLECT_NODE: node, GAZUA_TEST_CALLED: called },
  });
  return { data, called, run };
}

test('예약 수집: 저장소 밖에서 실행해도 절대 경로로 가장 새 파일을 받아요', macOnly, () => temporary((dir) => {
  const { data, called, run } = runner(dir);
  writeFileSync(join(data, 'market-data-20261110.json.gz'), '이전');
  const latest = join(data, 'market-data-20261111.json.gz');
  writeFileSync(latest, '최신');
  writeFileSync(join(data, 'market-data-backup.json.gz.bak'), '백업');
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readFileSync(called, 'utf8').trim().split('\n'), [
    repo, `--env-file=${repo}/.env.toss`, join(repo, 'scripts/collect-market-data.mjs'), '--provider', 'toss', '--extend-back', latest,
    '--years', '1', '--max-years', '7', '--rate', '0.5', '--out', data,
  ]);
}));

test('예약 수집: 다른 실행이 잠금을 잡고 있으면 node를 부르지 않아요', macOnly, () => temporary((dir) => {
  const { data, called, run } = runner(dir);
  writeFileSync(join(data, 'market-data-20261111.json.gz'), '최신');
  const lock = join(data, '.collect-extend.lock');
  const ready = join(dir, 'ready');
  // 다른 실행처럼 잠금을 잡고 잠깐 기다려요
  const holder = spawn('/usr/bin/lockf', [lock, '/bin/bash', '-c', 'touch "$0"; sleep 3', ready]);
  try {
    const until = Date.now() + 5000;
    while (!existsSync(ready) && Date.now() < until) spawnSync('/bin/sleep', ['0.05']);
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /다른 실행이 돌고 있어요/);
    assert.ok(!existsSync(called));
  } finally {
    holder.kill();
  }
}));

test('예약 수집: 이전 파일이 없으면 먼저 수집하라고 알려 줘요', macOnly, () => temporary((dir) => {
  const { data, called, run } = runner(dir);
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /먼저 수집해 주세요/);
  assert.ok(!existsSync(called));
}));
