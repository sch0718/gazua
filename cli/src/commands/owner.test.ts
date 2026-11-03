import { afterEach, describe, expect, it } from 'vitest';
import { writeAuth, writeDriveAuth } from '../config';
import { run } from '../main';
import { cleanupDirs, fakeFetch, makeIo, type FakeCall } from '../testing';

afterEach(cleanupDirs);
const SERVER = 'https://sync.test';
const DRIVE_TOKEN = 'gzc_' + 'd'.repeat(43);
const READ_TOKEN = 'gzc_' + 'r'.repeat(43);
const OWNER = '0123456789abcdef'.repeat(2);

const auth = (token: string, expiresAt: number) => ({ v: 1 as const, server: SERVER, token, tokenId: 't', label: 'gazua@testhost', expiresAt });
/** 토큰별 응답을 정해 둔 가짜 서버 */
const server = (replies: Record<string, { status: number; body: unknown }>) =>
  fakeFetch((c: FakeCall) => {
    if (c.url.origin !== SERVER || c.url.pathname !== '/v1/cli/owner') return undefined;
    const token = c.headers.get('authorization')?.replace('Gazua-CLI ', '') ?? '';
    return replies[token] ?? { status: 401, body: { error: 'cli-token-revoked' } };
  });
const tokensOf = (f: { calls: FakeCall[] }) => f.calls.map((c) => c.headers.get('authorization'));

describe('gazua owner', () => {
  it('drive-auth.json을 먼저 쓰고 { owner }를 낸다. 토큰은 출력에 나오지 않는다', async () => {
    const f = server({ [DRIVE_TOKEN]: { status: 200, body: { owner: OWNER } }, [READ_TOKEN]: { status: 200, body: { owner: 'f'.repeat(32) } } });
    const { io, dir, clock, out, result } = makeIo({ fetch: f });
    writeDriveAuth(dir, auth(DRIVE_TOKEN, clock.now + 1e9));
    writeAuth(dir, auth(READ_TOKEN, clock.now + 1e9));
    expect(await run(['owner'], io)).toBe(0);
    expect(result()).toEqual({ ok: true, data: { owner: OWNER } });
    expect(tokensOf(f)).toEqual([`Gazua-CLI ${DRIVE_TOKEN}`]);
    expect(out.join('')).not.toContain(DRIVE_TOKEN);
  });

  it('만료된 drive-auth.json은 건너뛰고 auth.json을 쓴다', async () => {
    const f = server({ [READ_TOKEN]: { status: 200, body: { owner: OWNER } } });
    const { io, dir, clock, result } = makeIo({ fetch: f });
    writeDriveAuth(dir, auth(DRIVE_TOKEN, clock.now));
    writeAuth(dir, auth(READ_TOKEN, clock.now + 1e9));
    expect(await run(['owner'], io)).toBe(0);
    expect(result().data.owner).toBe(OWNER);
    expect(tokensOf(f)).toEqual([`Gazua-CLI ${READ_TOKEN}`]);
  });

  it('첫 토큰이 401이면 다음 파일로 한 번 더 시도한다', async () => {
    const f = server({ [DRIVE_TOKEN]: { status: 401, body: { error: 'cli-token-expired' } }, [READ_TOKEN]: { status: 200, body: { owner: OWNER } } });
    const { io, dir, clock, result } = makeIo({ fetch: f });
    writeDriveAuth(dir, auth(DRIVE_TOKEN, clock.now + 1e9));
    writeAuth(dir, auth(READ_TOKEN, clock.now + 1e9));
    expect(await run(['owner'], io)).toBe(0);
    expect(result().data.owner).toBe(OWNER);
    expect(tokensOf(f)).toEqual([`Gazua-CLI ${DRIVE_TOKEN}`, `Gazua-CLI ${READ_TOKEN}`]);
  });

  it('남은 파일 없이 401이면 그 토큰 오류를 낸다', async () => {
    const f = server({});
    const { io, dir, clock, result } = makeIo({ fetch: f });
    writeAuth(dir, auth(READ_TOKEN, clock.now + 1e9));
    expect(await run(['owner'], io)).toBe(1);
    expect(result().error.code).toBe('cli-token-revoked');
  });

  it('drive 401에 auth.json이 없으면 not-logged-in이 아니라 그 401 오류를 낸다', async () => {
    const f = server({ [DRIVE_TOKEN]: { status: 401, body: { error: 'cli-token-expired' } } });
    const { io, dir, clock, result } = makeIo({ fetch: f });
    writeDriveAuth(dir, auth(DRIVE_TOKEN, clock.now + 1e9));
    expect(await run(['owner'], io)).toBe(1);
    expect(result().error.code).toBe('cli-token-expired');
  });

  it('두 토큰이 모두 401이면 마지막 401 오류를 낸다', async () => {
    const f = server({ [DRIVE_TOKEN]: { status: 401, body: { error: 'cli-token-expired' } }, [READ_TOKEN]: { status: 401, body: { error: 'cli-token-revoked' } } });
    const { io, dir, clock, result } = makeIo({ fetch: f });
    writeDriveAuth(dir, auth(DRIVE_TOKEN, clock.now + 1e9));
    writeAuth(dir, auth(READ_TOKEN, clock.now + 1e9));
    expect(await run(['owner'], io)).toBe(1);
    expect(result().error.code).toBe('cli-token-revoked');
    expect(f.calls).toHaveLength(2);
  });

  it('쓸 파일이 없으면(없거나 모두 만료) not-logged-in, 서버를 부르지 않는다', async () => {
    const f = server({});
    const { io, dir, clock, result } = makeIo({ fetch: f });
    writeAuth(dir, auth(READ_TOKEN, clock.now - 1));
    expect(await run(['owner'], io)).toBe(1);
    expect(result().error.code).toBe('not-logged-in');
    expect(result().error.message).toContain('gazua drive login');
    expect(f.calls).toHaveLength(0);
  });

  it('서버가 403 cli-scope면 서버 업데이트 안내, 다른 파일로 다시 시도하지 않는다', async () => {
    const f = server({ [DRIVE_TOKEN]: { status: 403, body: { error: 'cli-scope' } }, [READ_TOKEN]: { status: 200, body: { owner: OWNER } } });
    const { io, dir, clock, result } = makeIo({ fetch: f });
    writeDriveAuth(dir, auth(DRIVE_TOKEN, clock.now + 1e9));
    writeAuth(dir, auth(READ_TOKEN, clock.now + 1e9));
    expect(await run(['owner'], io)).toBe(1);
    expect(result().error.code).toBe('server-outdated');
    expect(result().error.message).toContain('서버 업데이트가 필요해요(sync-worker 배포)');
    expect(f.calls).toHaveLength(1);
  });
});
