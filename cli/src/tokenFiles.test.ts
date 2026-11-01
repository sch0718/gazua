import { chmodSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileIssuedAtStore, fileTokenStore, keyHashOf } from './tokenFiles';
import { cleanupDirs, tempDir } from './testing';

afterEach(cleanupDirs);
const posix = it.skipIf(process.platform === 'win32');

describe('keyHashOf', () => {
  it('SHA-256 hex 앞 16자(키가 달라지면 다르다)', () => {
    expect(keyHashOf('app-key-1')).toMatch(/^[0-9a-f]{16}$/);
    expect(keyHashOf('app-key-1')).toBe(keyHashOf('app-key-1'));
    expect(keyHashOf('app-key-1')).not.toBe(keyHashOf('app-key-2'));
  });
});

describe('파일 토큰 저장소(공급자마다 파일 하나)', () => {
  it('다른 인스턴스가 매번 파일에서 읽는다. 파일은 tokens-<공급자>.json(600)', () => {
    const dir = tempDir();
    const a = fileTokenStore(dir, 'toss', 'hash1');
    const b = fileTokenStore(dir, 'toss', 'hash1');
    expect(a.load()).toBeNull();
    a.save({ accessToken: 'tok-1', expiresAt: 100 });
    expect(b.load()).toEqual({ accessToken: 'tok-1', expiresAt: 100 });
    a.save({ accessToken: 'tok-2', expiresAt: 200 });
    expect(b.load()).toEqual({ accessToken: 'tok-2', expiresAt: 200 });
    expect(readdirSync(dir)).toEqual(['tokens-toss.json']);
    if (process.platform !== 'win32') expect(statSync(join(dir, 'tokens-toss.json')).mode & 0o777).toBe(0o600);
  });

  it('키가 바뀌면 캐시를 버리고, 다른 공급자 파일은 건드리지 않는다', () => {
    const dir = tempDir();
    fileTokenStore(dir, 'toss', 'old').save({ accessToken: 'old-token', expiresAt: 1 });
    fileTokenStore(dir, 'kis', 'kh').save({ accessToken: 'kis-token', expiresAt: 2 });
    expect(fileTokenStore(dir, 'toss', 'new').load()).toBeNull();
    fileTokenStore(dir, 'toss', 'new').save({ accessToken: 'new-token', expiresAt: 3 });
    expect(JSON.parse(readFileSync(join(dir, 'tokens-toss.json'), 'utf8'))).toEqual({ v: 1, keyHash: 'new', accessToken: 'new-token', expiresAt: 3 });
    expect(JSON.parse(readFileSync(join(dir, 'tokens-kis.json'), 'utf8'))).toEqual({ v: 1, keyHash: 'kh', accessToken: 'kis-token', expiresAt: 2 });
  });

  it('두 공급자가 동시에 갱신해도 서로의 항목을 잃지 않는다', async () => {
    const dir = tempDir();
    const kis = fileTokenStore(dir, 'kis', 'k');
    const kisIssued = fileIssuedAtStore(dir, 'kis', 'k');
    const toss = fileTokenStore(dir, 'toss', 't');
    const tossIssued = fileIssuedAtStore(dir, 'toss', 't');
    const tick = () => new Promise<void>((r) => setImmediate(r));
    await Promise.all([
      (async () => {
        for (let i = 1; i <= 40; i++) {
          kisIssued.save(i);
          kis.save({ accessToken: `kis-${i}`, expiresAt: i });
          await tick();
        }
      })(),
      (async () => {
        for (let i = 1; i <= 40; i++) {
          tossIssued.save(1000 + i);
          toss.save({ accessToken: `toss-${i}`, expiresAt: 1000 + i });
          await tick();
        }
      })(),
    ]);
    expect(kis.load()).toEqual({ accessToken: 'kis-40', expiresAt: 40 });
    expect(kisIssued.load()).toBe(40);
    expect(toss.load()).toEqual({ accessToken: 'toss-40', expiresAt: 1040 });
    expect(tossIssued.load()).toBe(1040);
  });

  it('issuedAt은 같은 파일에 따로 저장하고, 토큰 저장이 지우지 않는다', () => {
    const dir = tempDir();
    const issued = fileIssuedAtStore(dir, 'kis', 'kh');
    expect(issued.load()).toBeNull();
    issued.save(1234);
    expect(fileTokenStore(dir, 'kis', 'kh').load()).toBeNull();
    fileTokenStore(dir, 'kis', 'kh').save({ accessToken: 't', expiresAt: 9 });
    expect(issued.load()).toBe(1234);
    expect(fileTokenStore(dir, 'kis', 'kh').load()).toEqual({ accessToken: 't', expiresAt: 9 });
    expect(fileIssuedAtStore(dir, 'kis', 'other').load()).toBeNull();
  });

  it('깨진 파일은 없는 것으로 보고 새로 쓴다', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'tokens-toss.json'), '{');
    const s = fileTokenStore(dir, 'toss', 'h');
    expect(s.load()).toBeNull();
    s.save({ accessToken: 'a', expiresAt: 1 });
    expect(s.load()).toEqual({ accessToken: 'a', expiresAt: 1 });
  });

  it('읽거나 저장하는 접근 토큰을 onSecret으로 알린다', () => {
    const dir = tempDir();
    const onSecret = vi.fn();
    const s = fileTokenStore(dir, 'toss', 'h', { onSecret });
    s.save({ accessToken: 'saved-token-1', expiresAt: 1 });
    expect(onSecret).toHaveBeenLastCalledWith('saved-token-1');
    onSecret.mockClear();
    fileTokenStore(dir, 'toss', 'h', { onSecret }).load();
    expect(onSecret).toHaveBeenCalledWith('saved-token-1');
  });

  posix('읽을 때 파일 권한이 644이거나 디렉터리가 755면 warn으로 알린다', () => {
    const dir = tempDir();
    fileTokenStore(dir, 'toss', 'h').save({ accessToken: 'a', expiresAt: 1 });
    const warn = vi.fn();
    fileTokenStore(dir, 'toss', 'h', { warn }).load();
    expect(warn).not.toHaveBeenCalled();
    chmodSync(join(dir, 'tokens-toss.json'), 0o644);
    chmodSync(dir, 0o755);
    fileTokenStore(dir, 'toss', 'h', { warn }).load();
    fileIssuedAtStore(dir, 'toss', 'h', { warn }).load();
    const msgs = warn.mock.calls.map((c) => String(c[0]));
    expect(msgs.some((m) => m.includes('tokens-toss.json') && m.includes('chmod 600'))).toBe(true);
    expect(msgs.some((m) => m.includes('chmod 700'))).toBe(true);
  });
});
