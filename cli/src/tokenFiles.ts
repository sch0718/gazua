// 공급자별 파일을 각 공급자 잠금 안에서 갱신한다. load()는 잠금을 기다리는 동안
// 다른 실행이 저장한 토큰을 쓸 수 있도록 매번 파일을 읽는다.
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { IssuedAtStore, TokenStore } from '../../src/lib/providers/types';
import { permissionWarnings, readJsonFile, writeJsonFile } from './config';

type ProviderKey = 'kis' | 'toss';
interface Entry {
  v: 1;
  keyHash: string;
  accessToken?: string;
  expiresAt?: number;
  issuedAt?: number;
}

export interface StoreHooks {
  onSecret?: (accessToken: string) => void;
  warn?: (message: string) => void;
}

export const keyHashOf = (id: string): string => createHash('sha256').update(id).digest('hex').slice(0, 16);
export const tokenFileName = (provider: ProviderKey): string => `tokens-${provider}.json`;

function readEntry(dir: string, provider: ProviderKey, keyHash: string, hooks: StoreHooks): Entry | null {
  const raw = readJsonFile<Entry>(join(dir, tokenFileName(provider)));
  for (const w of permissionWarnings(dir, [tokenFileName(provider)])) hooks.warn?.(w);
  return raw !== null && raw.v === 1 && raw.keyHash === keyHash ? raw : null;
}

function update(dir: string, provider: ProviderKey, keyHash: string, hooks: StoreHooks, patch: Partial<Entry>): void {
  const base: Entry = readEntry(dir, provider, keyHash, hooks) ?? { v: 1, keyHash };
  writeJsonFile(join(dir, tokenFileName(provider)), { ...base, ...patch });
}

export function fileTokenStore(dir: string, provider: ProviderKey, keyHash: string, hooks: StoreHooks = {}): TokenStore {
  return {
    load() {
      const e = readEntry(dir, provider, keyHash, hooks);
      if (!e || typeof e.accessToken !== 'string' || typeof e.expiresAt !== 'number') return null;
      hooks.onSecret?.(e.accessToken);
      return { accessToken: e.accessToken, expiresAt: e.expiresAt };
    },
    save(t) {
      hooks.onSecret?.(t.accessToken);
      update(dir, provider, keyHash, hooks, { accessToken: t.accessToken, expiresAt: t.expiresAt });
    },
  };
}

export function fileIssuedAtStore(dir: string, provider: ProviderKey, keyHash: string, hooks: StoreHooks = {}): IssuedAtStore {
  return {
    load() {
      const e = readEntry(dir, provider, keyHash, hooks);
      return e && typeof e.issuedAt === 'number' ? e.issuedAt : null;
    },
    save(t) {
      update(dir, provider, keyHash, hooks, { issuedAt: t });
    },
  };
}
