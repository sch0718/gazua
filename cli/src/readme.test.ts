import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from './errors';
import { COMMANDS } from './main';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const readme = read('../README.md');
const workerReadme = read('../../sync-worker/README.md');

describe('cli/README.md', () => {
  it('토스 키 분리 경고와 토스 허용 IP 등록 안내가 있다', () => {
    expect(readme).toContain('CLI용 토스 앱을 따로 만드세요. 앱과 같은 토스 키를 쓰면 토큰이 서로 무효가 돼요');
    expect(readme).toContain('허용 IP');
  });

  it('환경변수 이름과 옵션이 모두 적혀 있다', () => {
    for (const name of ['KIS_APP_KEY', 'KIS_APP_SECRET', 'TOSS_CLIENT_ID', 'TOSS_CLIENT_SECRET', 'GAZUA_SYNC_URL', 'XDG_CONFIG_HOME', '--env-file', '--profile', '--provider', '--strategy', '--today', '--from', '--to', '--raw', '--pretty', '--verbose', '--server', '--label']) {
      expect(readme, name).toContain(name);
    }
  });

  it('등록된 모든 명령과 모든 오류 코드가 표에 있다', () => {
    for (const name of Object.keys(COMMANDS)) expect(readme, `gazua ${name}`).toContain(`gazua ${name}`);
    for (const code of Object.keys(MESSAGES)) expect(readme, code).toContain(`\`${code}\``);
  });

  it('배포 순서(병합 → 0005 → CLI_IP_SALT → Worker 배포)가 있다', () => {
    const order = ['병합', '0005_cli.sql', 'CLI_IP_SALT', 'wrangler deploy'].map((s) => readme.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('읽기 전용(주문 없음)과 비밀값 출력 금지를 밝힌다', () => {
    expect(readme).toContain('주문');
    expect(readme).toContain('[숨김]');
  });
});

describe('.github/workflows/ci.yml', () => {
  it('ci 잡이 CLI 패키지(gazua-cli)의 check·test·build를 돌린다', () => {
    const ci = read('../../.github/workflows/ci.yml');
    for (const cmd of ['pnpm --filter gazua-cli check', 'pnpm --filter gazua-cli test', 'pnpm --filter gazua-cli build']) expect(ci, cmd).toContain(cmd);
  });
});

describe('sync-worker/README.md', () => {
  it('CLI 경로와 0005, CLI_IP_SALT를 적는다', () => {
    for (const s of ['/v1/cli/device', '/v1/cli/token', '/v1/cli/approve', '/v1/cli/tokens', '0005_cli.sql', 'CLI_IP_SALT', 'Gazua-CLI']) expect(workerReadme, s).toContain(s);
  });
});
