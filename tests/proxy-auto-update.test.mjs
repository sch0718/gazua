// .githooks의 프록시 자동 반영: git pull로 proxy 코드가 바뀌면, 프록시가 설치된 기기에서만 install.sh를 다시 돌린다.
// 임시 저장소에서 실제 git merge·rebase로 hook을 부르고, install.sh 대신 호출 기록만 남기는 스크립트를 쓴다.
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const HOOKS = new URL('../.githooks', import.meta.url).pathname;
const dirs = [];

function repo({ installed = true, installerFails = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gazua-hook-'));
  dirs.push(dir);
  const work = join(dir, 'repo');
  const log = join(dir, 'install.log');
  const plist = join(dir, 'dev.gazua.proxy.plist');
  const installer = join(dir, 'install.sh');
  writeFileSync(installer, `#!/bin/sh\necho run >> "${log}"\nexit ${installerFails ? 1 : 0}\n`);
  chmodSync(installer, 0o755);
  if (installed) writeFileSync(plist, '<plist/>');
  mkdirSync(work);
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@example.com',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@example.com',
    GAZUA_PROXY_PLIST: plist,
    GAZUA_PROXY_INSTALL: installer,
  };
  const git = (...args) => execFileSync('git', args, { cwd: work, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const write = (path, text) => {
    mkdirSync(join(work, path, '..'), { recursive: true });
    writeFileSync(join(work, path), text);
  };
  const commit = (path, text) => {
    write(path, text);
    git('add', '-A');
    git('commit', '-q', '-m', path);
  };
  git('init', '-q', '-b', 'main');
  cpSync(HOOKS, join(work, '.githooks'), { recursive: true });
  git('config', 'core.hooksPath', '.githooks');
  commit('proxy/src/handler.ts', 'v1');
  commit('README.md', 'v1');
  const runs = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').length : 0);
  return { git, commit, runs };
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('proxy auto-update hook', () => {
  it('a merge that changes proxy code re-runs install.sh once', () => {
    const r = repo();
    r.git('switch', '-q', '-c', 'feat');
    r.commit('proxy/src/handler.ts', 'v2');
    r.git('switch', '-q', 'main');
    r.commit('README.md', 'v2'); // 앞으로 감기가 아닌 병합도 확인
    r.git('merge', '-q', '--no-edit', 'feat');
    assert.equal(r.runs(), 1);
  });

  it('a fast-forward that changes proxy code re-runs install.sh once', () => {
    const r = repo();
    r.git('switch', '-q', '-c', 'feat');
    r.commit('proxy/src/handler.ts', 'v2');
    r.git('switch', '-q', 'main');
    r.git('merge', '-q', '--ff-only', 'feat');
    assert.equal(r.runs(), 1);
  });

  it('a fast-forward that changes only other files does nothing', () => {
    const r = repo();
    r.git('switch', '-q', '-c', 'feat');
    r.commit('src/app.ts', 'x');
    r.git('switch', '-q', 'main');
    r.git('merge', '-q', '--ff-only', 'feat');
    assert.equal(r.runs(), 0);
  });

  it('does nothing on a machine without the proxy LaunchAgent', () => {
    const r = repo({ installed: false });
    r.git('switch', '-q', '-c', 'feat');
    r.commit('proxy/node/server.ts', 'v2');
    r.git('switch', '-q', 'main');
    r.git('merge', '-q', '--ff-only', 'feat');
    assert.equal(r.runs(), 0);
  });

  it('a rebase that brings in proxy code re-runs install.sh; an amend does not', () => {
    const r = repo();
    r.git('switch', '-q', '-c', 'feat');
    r.commit('docs/a.md', 'mine');
    r.git('switch', '-q', 'main');
    r.commit('proxy/macos/install.sh', 'v2');
    r.git('switch', '-q', 'feat');
    r.git('rebase', '-q', 'main');
    assert.equal(r.runs(), 1);
    r.git('commit', '-q', '--amend', '-m', 'amended');
    assert.equal(r.runs(), 1);
  });

  it('git pull --rebase with a local commit re-runs install.sh once', () => {
    const r = repo();
    r.git('switch', '-q', '-c', 'feat');
    r.commit('docs/a.md', 'mine');
    r.git('switch', '-q', 'main');
    r.commit('proxy/src/handler.ts', 'v2');
    r.git('switch', '-q', 'feat');
    r.git('pull', '-q', '--rebase', '.', 'main');
    assert.equal(r.runs(), 1);
  });

  it('a rebase whose local proxy commits are replayed still re-runs install.sh only once', () => {
    const r = repo();
    r.git('switch', '-q', '-c', 'feat');
    r.commit('proxy/node/server.ts', 'mine');
    r.git('switch', '-q', 'main');
    r.commit('proxy/src/handler.ts', 'v2');
    r.git('switch', '-q', 'feat');
    r.git('pull', '-q', '--rebase', '.', 'main');
    assert.equal(r.runs(), 1);
  });

  // 로컬 커밋이 이미 상대 쪽에 있어 전부 생략되면 post-rewrite가 불리지 않는다(리뷰 재현).
  it('git pull --rebase that skips every local commit re-runs install.sh once', () => {
    const r = repo();
    r.git('switch', '-q', '-c', 'feat');
    r.commit('docs/a.md', 'mine');
    r.git('switch', '-q', 'main');
    r.commit('proxy/src/handler.ts', 'v2');
    r.git('cherry-pick', 'feat');
    r.git('switch', '-q', 'feat');
    r.git('pull', '-q', '--rebase', '.', 'main');
    assert.equal(r.git('rev-parse', 'HEAD'), r.git('rev-parse', 'main'));
    assert.equal(r.runs(), 1);
  });

  it('git rebase·pull --rebase with nothing to rewrite (branch behind upstream) re-runs install.sh once each', () => {
    const r = repo();
    r.git('switch', '-q', '-c', 'feat');
    r.git('switch', '-q', 'main');
    r.commit('proxy/tsconfig.json', '{}');
    r.git('switch', '-q', 'feat');
    r.git('rebase', '-q', 'main');
    assert.equal(r.runs(), 1);
    r.git('switch', '-q', 'main');
    r.commit('proxy/src/handler.ts', 'v3');
    r.git('switch', '-q', 'feat');
    r.git('pull', '-q', '--rebase', '.', 'main');
    assert.equal(r.runs(), 2);
  });

  it('switching branches does not re-run install.sh', () => {
    const r = repo();
    r.git('switch', '-q', '-c', 'feat');
    r.commit('proxy/src/handler.ts', 'v2');
    r.git('switch', '-q', 'main');
    r.git('switch', '-q', 'feat');
    assert.equal(r.runs(), 0);
  });

  it('a failing install.sh does not fail the merge', () => {
    const r = repo({ installerFails: true });
    r.git('switch', '-q', '-c', 'feat');
    r.commit('proxy/package.json', '{}');
    r.git('switch', '-q', 'main');
    assert.doesNotThrow(() => r.git('merge', '-q', '--ff-only', 'feat'));
    assert.equal(r.runs(), 1);
  });
});

// install.sh가 끝에 부르는 hook 켜기. .git/hooks에 사용자 hook이 있으면 core.hooksPath를 바꿔 끄지 않는다.
describe('enable-hooks.sh', () => {
  const ENABLE = new URL('../proxy/macos/enable-hooks.sh', import.meta.url).pathname;

  function plainRepo() {
    const dir = mkdtempSync(join(tmpdir(), 'gazua-enable-'));
    dirs.push(dir);
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
    git('init', '-q');
    const hooks = git('rev-parse', '--path-format=absolute', '--git-path', 'hooks');
    mkdirSync(hooks, { recursive: true });
    const run = () => execFileSync('sh', [ENABLE, dir], { encoding: 'utf8' });
    const hooksPath = () => {
      try {
        return git('config', '--get', 'core.hooksPath');
      } catch {
        return '';
      }
    };
    return { git, hooks, run, hooksPath };
  }

  it('turns on .githooks when .git/hooks has only samples', () => {
    const r = plainRepo();
    writeFileSync(join(r.hooks, 'pre-commit.sample'), '#!/bin/sh\n');
    chmodSync(join(r.hooks, 'pre-commit.sample'), 0o755);
    writeFileSync(join(r.hooks, 'notes.txt'), 'not executable');
    r.run();
    assert.equal(r.hooksPath(), '.githooks');
  });

  it('leaves core.hooksPath alone and explains how when a user hook exists', () => {
    const r = plainRepo();
    writeFileSync(join(r.hooks, 'pre-commit'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(r.hooks, 'pre-commit'), 0o755);
    const out = r.run();
    assert.equal(r.hooksPath(), '');
    assert.match(out, /pre-commit/);
    assert.match(out, /core\.hooksPath \.githooks/);
  });

  it('does not touch a hook path that is already set', () => {
    const r = plainRepo();
    r.git('config', 'core.hooksPath', 'my-hooks');
    r.run();
    assert.equal(r.hooksPath(), 'my-hooks');
  });
});
