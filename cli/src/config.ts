// ~/.config/gazua/ 저장 파일. 디렉터리 700, 파일 600, 쓰기는 임시 파일 → rename. 비밀번호·증권사 키는 두지 않는다.
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

export const DIR_MODE = 0o700;
export const FILE_MODE = 0o600;

export function configDir(env: Record<string, string | undefined>, home: string = homedir()): string {
  const xdg = env.XDG_CONFIG_HOME?.trim();
  return join(xdg ? xdg : join(home, '.config'), 'gazua');
}

/** 새로 만들 때만 700으로 한다(이미 있는 디렉터리의 권한은 바꾸지 않고, 읽을 때 경고한다) */
export function ensureDir(dir: string): void {
  if (existsSync(dir)) return;
  mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  chmodSync(dir, DIR_MODE);
}

export function readJsonFile<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function writeJsonFile(path: string, value: unknown): void {
  ensureDir(dirname(path));
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, JSON.stringify(value), { mode: FILE_MODE });
  chmodSync(tmp, FILE_MODE); // umask와 상관없이 600
  renameSync(tmp, path);
}

/** 디렉터리가 700보다, 파일이 600보다 넓으면 경고 문구를 돌려준다. Windows는 검사하지 않는다 */
export function permissionWarnings(dir: string, files: string[]): string[] {
  if (process.platform === 'win32') return [];
  const out: string[] = [];
  const loose = (p: string, allowed: number) => (statSync(p).mode & 0o777 & ~allowed) !== 0;
  if (existsSync(dir) && loose(dir, DIR_MODE)) out.push(`${basename(dir)} 디렉터리 권한이 넓어요. chmod 700으로 줄여 주세요`);
  for (const f of files) {
    const p = join(dir, f);
    if (existsSync(p) && loose(p, FILE_MODE)) out.push(`${f} 권한이 넓어요. chmod 600으로 줄여 주세요`);
  }
  return out;
}

export interface AuthFile {
  v: 1;
  server: string;
  token: string;
  tokenId: string;
  label: string;
  expiresAt: number;
}

export const authPath = (dir: string): string => join(dir, 'auth.json');

export function readAuth(dir: string): { auth: AuthFile | null; warnings: string[] } {
  const raw = readJsonFile<Partial<AuthFile>>(authPath(dir));
  const valid =
    raw !== null && raw.v === 1 && typeof raw.server === 'string' && typeof raw.token === 'string' && typeof raw.tokenId === 'string' && typeof raw.label === 'string' && typeof raw.expiresAt === 'number';
  return { auth: valid ? (raw as AuthFile) : null, warnings: permissionWarnings(dir, ['auth.json']) };
}

export const writeAuth = (dir: string, auth: AuthFile): void => writeJsonFile(authPath(dir), auth);

export function removeAuth(dir: string): boolean {
  if (!existsSync(authPath(dir))) return false;
  rmSync(authPath(dir), { force: true });
  return true;
}
