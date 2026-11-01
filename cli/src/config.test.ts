import { chmodSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { authPath, configDir, ensureDir, permissionWarnings, readAuth, readJsonFile, removeAuth, writeAuth, writeJsonFile } from './config';
import { cleanupDirs, tempDir } from './testing';

afterEach(cleanupDirs);
const posix = it.skipIf(process.platform === 'win32');
const mode = (p: string) => statSync(p).mode & 0o777;
const AUTH = { v: 1 as const, server: 'https://sync.example', token: 'gzc_x', tokenId: 'id1', label: 'gazua@mac', expiresAt: 1770000000000 };

describe('configDir', () => {
  it('XDG_CONFIG_HOME이 있으면 거기의 gazua, 없으면 ~/.config/gazua', () => {
    expect(configDir({ XDG_CONFIG_HOME: '/x/cfg' }, '/home/u')).toBe('/x/cfg/gazua');
    expect(configDir({}, '/home/u')).toBe('/home/u/.config/gazua');
    expect(configDir({ XDG_CONFIG_HOME: '  ' }, '/home/u')).toBe('/home/u/.config/gazua');
  });
});

describe('파일 쓰기·읽기', () => {
  posix('새 디렉터리는 700, 파일은 600이고 rename으로 쓴다(임시 파일이 남지 않는다)', () => {
    const dir = join(tempDir(), 'a', 'gazua');
    writeJsonFile(join(dir, 'x.json'), { v: 1 });
    expect(mode(dir)).toBe(0o700);
    expect(mode(join(dir, 'x.json'))).toBe(0o600);
    expect(readdirSync(dir)).toEqual(['x.json']);
    expect(readJsonFile(join(dir, 'x.json'))).toEqual({ v: 1 });
    writeJsonFile(join(dir, 'x.json'), { v: 2 });
    expect(readJsonFile(join(dir, 'x.json'))).toEqual({ v: 2 });
    expect(readdirSync(dir)).toEqual(['x.json']);
  });

  it('없거나 깨진 파일은 null', () => {
    const dir = tempDir();
    expect(readJsonFile(join(dir, 'none.json'))).toBeNull();
    writeFileSync(join(dir, 'bad.json'), '{');
    expect(readJsonFile(join(dir, 'bad.json'))).toBeNull();
  });

  posix('이미 있는 디렉터리 권한은 바꾸지 않는다', () => {
    const dir = join(tempDir(), 'existing');
    mkdirSync(dir, { mode: 0o755 });
    chmodSync(dir, 0o755);
    ensureDir(dir);
    expect(mode(dir)).toBe(0o755);
  });

  posix('권한이 넓으면 경고한다(파일 600·디렉터리 700 기준)', () => {
    const dir = tempDir();
    chmodSync(dir, 0o755);
    writeAuth(dir, AUTH);
    chmodSync(authPath(dir), 0o644);
    const { auth, warnings } = readAuth(dir);
    expect(auth).toEqual(AUTH);
    expect(warnings).toHaveLength(2);
    expect(warnings.join('\n')).toContain('auth.json');
    chmodSync(authPath(dir), 0o600);
    chmodSync(dir, 0o700);
    expect(readAuth(dir).warnings).toEqual([]);
    expect(permissionWarnings(dir, ['nope.json'])).toEqual([]);
  });

  posix('파일 소유자 실행 권한도 600보다 넓은 권한으로 경고한다', () => {
    const dir = tempDir();
    writeAuth(dir, AUTH);
    chmodSync(authPath(dir), 0o700);
    expect(readAuth(dir).warnings).toHaveLength(1);
  });

  posix('모양이 틀린 auth.json을 읽어도 넓은 권한은 경고한다', () => {
    const dir = tempDir();
    writeJsonFile(authPath(dir), { v: 2 });
    chmodSync(authPath(dir), 0o644);
    expect(readAuth(dir)).toMatchObject({ auth: null, warnings: [expect.stringContaining('auth.json')] });
  });
});

describe('auth.json', () => {
  it('쓰기·읽기·지우기', () => {
    const dir = tempDir();
    expect(readAuth(dir)).toEqual({ auth: null, warnings: [] });
    writeAuth(dir, AUTH);
    expect(readAuth(dir).auth).toEqual(AUTH);
    expect(removeAuth(dir)).toBe(true);
    expect(existsSync(authPath(dir))).toBe(false);
    expect(removeAuth(dir)).toBe(false);
  });

  it('모양이 틀리면 없는 것으로 본다', () => {
    const dir = tempDir();
    writeJsonFile(authPath(dir), { v: 1, server: 'https://x', token: 5 });
    expect(readAuth(dir).auth).toBeNull();
    writeJsonFile(authPath(dir), { ...AUTH, v: 2 });
    expect(readAuth(dir).auth).toBeNull();
  });
});
