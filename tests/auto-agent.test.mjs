import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const agent = join(repo, 'scripts/macos/auto-agent');
const macOnly = { skip: process.platform !== 'darwin' };
const temporary = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'gazua-auto-agent-'));
  try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};
const dryInstall = (dir, extra = {}) => spawnSync('/bin/bash', [join(agent, 'install.sh')], {
  encoding: 'utf8', env: { ...process.env, HOME: join(dir, '집 & 테스트'), XDG_CONFIG_HOME: join(dir, '설정'), GAZUA_AUTO_DRY: '1', GAZUA_AUTO_DRY_DIR: join(dir, 'plist'), AUTO_STRATEGY: '시험 전략', ...extra },
});

test('예약 자동 실행: DRY 설치는 분 간격 plist만 만들어요', macOnly, () => temporary((dir) => {
  const result = dryInstall(dir, { AUTO_INTERVAL_MIN: '3' });
  assert.equal(result.status, 0, result.stderr);
  const path = join(dir, 'plist', 'com.gazua.auto.plist');
  assert.equal(spawnSync('plutil', ['-lint', path]).status, 0);
  const xml = readFileSync(path, 'utf8');
  assert.match(xml, /<key>StartInterval<\/key>\s*<integer>180<\/integer>/);
  assert.ok(xml.includes(join(agent, 'run.sh')));
  assert.match(xml, /<key>XDG_CONFIG_HOME<\/key>/);
  assert.ok(xml.includes(join(dir, '설정')));
  assert.match(xml, /집 &amp; 테스트\/Library\/Logs\/gazua\/auto\.log/);
  assert.ok(!existsSync(join(dir, '집 & 테스트')));
  assert.ok(!existsSync(join(dir, '설정')));
}));

test('예약 자동 실행: 범위 밖 간격과 빈 전략은 설치하지 않아요', macOnly, () => temporary((dir) => {
  for (const extra of [{ AUTO_INTERVAL_MIN: '9' }, { AUTO_STRATEGY: '' }]) {
    const result = dryInstall(dir, extra);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /AUTO_INTERVAL_MIN|AUTO_STRATEGY/);
    assert.ok(!existsSync(join(dir, 'plist', 'com.gazua.auto.plist')));
  }
}));

function runner(dir) {
  const cfg = join(dir, '설정', 'gazua');
  mkdirSync(cfg, { recursive: true });
  const auto = join(cfg, 'auto.env'), alert = join(cfg, 'alert.env');
  writeFileSync(auto, 'AUTO_MODE=dry\nAUTO_STRATEGY=시험\n', { mode: 0o600 });
  writeFileSync(alert, '', { mode: 0o600 });
  const called = join(dir, '호출');
  const node = join(dir, '가짜 node');
  writeFileSync(node, '#!/bin/bash\nprintf "%s\\n" "$PWD" "$@" > "$GAZUA_TEST_CALLED"\n', { mode: 0o755 });
  const run = (at, extra = {}) => spawnSync('/bin/bash', [join(agent, 'run.sh')], { cwd: dir, encoding: 'utf8', env: { ...process.env, XDG_CONFIG_HOME: dirname(cfg), GAZUA_AUTO_ENV: auto, GAZUA_AUTO_ALERT_ENV: alert, GAZUA_AUTO_NODE: node, GAZUA_TEST_CALLED: called, GAZUA_AUTO_NOW: String(Date.parse(at) / 1000), ...extra } });
  return { cfg, auto, alert, called, run };
}

test('예약 자동 실행: 평일 장 밖과 주말에는 node를 띄우지 않아요', macOnly, () => temporary((dir) => {
  const { called, run } = runner(dir);
  for (const at of ['2026-11-13T09:04:59+09:00', '2026-11-13T15:21:00+09:00', '2026-11-14T10:00:00+09:00']) {
    const result = run(at);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!existsSync(called));
  }
}));

test('예약 자동 실행: 장중에는 두 설정 파일과 auto 명령을 절대 경로로 넘겨요', macOnly, () => temporary((dir) => {
  const { auto, alert, called, run } = runner(dir);
  const result = run('2026-11-13T09:05:00+09:00');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readFileSync(called, 'utf8').trim().split('\n'), [repo, `--env-file=${alert}`, `--env-file=${auto}`, join(repo, 'cli/dist/gazua.mjs'), 'auto']);
}));

test('예약 자동 실행: 다른 실행이 잠금을 잡고 있으면 node를 띄우지 않아요', macOnly, () => temporary((dir) => {
  const { cfg, called, run } = runner(dir);
  const ready = join(dir, '준비');
  const holder = spawn('/usr/bin/lockf', [join(cfg, '.auto.lock'), '/bin/bash', '-c', 'touch "$0"; sleep 3', ready]);
  try {
    const until = Date.now() + 5000;
    while (!existsSync(ready) && Date.now() < until) spawnSync('/bin/sleep', ['0.05']);
    const result = run('2026-11-13T15:20:00+09:00');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /다른 실행이 돌고 있어요/);
    assert.ok(!existsSync(called));
  } finally { holder.kill(); }
}));


test('예약 자동 실행: 다른 환경 파일도 같은 원장 잠금을 공유해요', macOnly, () => temporary((dir) => {
  const { cfg, called, run } = runner(dir);
  const other = join(dir, '다른 설정');
  mkdirSync(other);
  const auto = join(other, 'auto.env');
  writeFileSync(auto, 'AUTO_MODE=dry\nAUTO_STRATEGY=시험\n', { mode: 0o600 });
  const ready = join(dir, '준비');
  const holder = spawn('/usr/bin/lockf', [join(cfg, '.auto.lock'), '/bin/bash', '-c', 'touch "$0"; sleep 3', ready]);
  try {
    const until = Date.now() + 5000;
    while (!existsSync(ready) && Date.now() < until) spawnSync('/bin/sleep', ['0.05']);
    const result = run('2026-11-13T10:00:00+09:00', { GAZUA_AUTO_ENV: auto });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /다른 실행이 돌고 있어요/);
    assert.ok(!existsSync(called));
  } finally { holder.kill(); }
}));
