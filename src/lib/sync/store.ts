// 동기화 로컬 상태(IndexedDB `gazua-sync`): 보낼 작업(outbox), 프로필별 마지막 확인 리비전·해시, 충돌 사본, 세션 등.
// IndexedDB를 열 수 없으면 메모리로 계속하고 persistent=false로 알린다(앱을 닫으면 대기 작업이 사라진다).
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ProfileDocV1 } from './dto';

export interface OutboxOp {
  opId: string;
  profileId: string;
  kind: 'put' | 'delete';
  /** put만. 큐에 넣을 때의 문서. 한 번 보낸 뒤에는 바꾸지 않는다(같은 opId 재시도는 같은 본문). */
  doc?: ProfileDocV1;
  hash?: string;
  createdAt: number;
  /** 처음 보낸 시각과 그때의 기준 리비전. 이후 재시도는 같은 값을 쓴다. */
  sentAt?: number;
  baseRevision?: number;
}

export interface ProfileSyncState {
  profileId: string;
  /** 서버에서 마지막으로 확인한 리비전(0: 서버에 없음). */
  syncedRevision: number;
  /** 그 리비전 문서의 해시. 로컬 문서 해시와 다르면 보낼 변경이 있다. */
  syncedHash: string;
  /** 서버에서 삭제됨(tombstone)을 확인했다. */
  deleted?: boolean;
  /** 서버가 거절한 문서의 해시와 이유. 같은 문서를 다시 보내지 않는다. */
  rejectedHash?: string;
  rejectedCode?: string;
}

export type Conflict =
  | { profileId: string; kind: 'edit'; local: ProfileDocV1; remote: ProfileDocV1; remoteRevision: number; detectedAt: number }
  | {
      profileId: string;
      kind: 'deleted';
      local: ProfileDocV1;
      /** null이면 30일이 지나 서버에서 정리됐다(복구 불가, 새로 올리기만 가능). */
      deletedAt: number | null;
      purgeAt: number | null;
      remoteRevision: number;
      detectedAt: number;
    };

export interface SyncStore {
  readonly persistent: boolean;
  ops(): Promise<OutboxOp[]>;
  putOp(op: OutboxOp): Promise<void>;
  deleteOp(opId: string): Promise<void>;
  state(profileId: string): Promise<ProfileSyncState | undefined>;
  states(): Promise<ProfileSyncState[]>;
  putState(s: ProfileSyncState): Promise<void>;
  deleteState(profileId: string): Promise<void>;
  conflicts(): Promise<Conflict[]>;
  putConflict(c: Conflict): Promise<void>;
  deleteConflict(profileId: string): Promise<void>;
  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
  deleteMeta(key: string): Promise<void>;
}

type Stores = {
  outbox: OutboxOp;
  profiles: ProfileSyncState;
  conflicts: Conflict;
  meta: { key: string; value: unknown };
};

export function createMemorySyncStore(): SyncStore {
  const m = {
    outbox: new Map<string, OutboxOp>(),
    profiles: new Map<string, ProfileSyncState>(),
    conflicts: new Map<string, Conflict>(),
    meta: new Map<string, unknown>(),
  };
  const clone = <T>(v: T): T => structuredClone(v);
  return {
    persistent: false,
    ops: async () => [...m.outbox.values()].map(clone).sort((a, b) => a.createdAt - b.createdAt),
    putOp: async (op) => void m.outbox.set(op.opId, clone(op)),
    deleteOp: async (id) => void m.outbox.delete(id),
    state: async (id) => (m.profiles.has(id) ? clone(m.profiles.get(id)!) : undefined),
    states: async () => [...m.profiles.values()].map(clone),
    putState: async (s) => void m.profiles.set(s.profileId, clone(s)),
    deleteState: async (id) => void m.profiles.delete(id),
    conflicts: async () => [...m.conflicts.values()].map(clone),
    putConflict: async (c) => void m.conflicts.set(c.profileId, clone(c)),
    deleteConflict: async (id) => void m.conflicts.delete(id),
    getMeta: async <T>(k: string) => (m.meta.has(k) ? (clone(m.meta.get(k)) as T) : undefined),
    setMeta: async (k, v) => void m.meta.set(k, clone(v)),
    deleteMeta: async (k) => void m.meta.delete(k),
  };
}

interface Schema extends DBSchema {
  outbox: { key: string; value: OutboxOp };
  profiles: { key: string; value: ProfileSyncState };
  conflicts: { key: string; value: Conflict };
  meta: { key: string; value: { key: string; value: unknown } };
}

/** IndexedDB를 열지 못하면 메모리 저장소를 돌려준다. */
export async function openSyncStore(dbName = 'gazua-sync'): Promise<SyncStore> {
  let db: IDBPDatabase<Schema>;
  try {
    db = await openDB<Schema>(dbName, 1, {
      upgrade(d) {
        d.createObjectStore('outbox', { keyPath: 'opId' });
        d.createObjectStore('profiles', { keyPath: 'profileId' });
        d.createObjectStore('conflicts', { keyPath: 'profileId' });
        d.createObjectStore('meta', { keyPath: 'key' });
      },
    });
  } catch {
    return createMemorySyncStore();
  }
  const all = async <K extends keyof Stores>(s: K) => (await db.getAll(s as 'outbox')) as unknown as Stores[K][];
  return {
    persistent: true,
    ops: async () => (await all('outbox')).sort((a, b) => a.createdAt - b.createdAt),
    putOp: async (op) => void (await db.put('outbox', op)),
    deleteOp: async (id) => db.delete('outbox', id),
    state: (id) => db.get('profiles', id),
    states: () => all('profiles'),
    putState: async (s) => void (await db.put('profiles', s)),
    deleteState: (id) => db.delete('profiles', id),
    conflicts: () => all('conflicts'),
    putConflict: async (c) => void (await db.put('conflicts', c)),
    deleteConflict: (id) => db.delete('conflicts', id),
    getMeta: async <T>(k: string) => (await db.get('meta', k))?.value as T | undefined,
    setMeta: async (k, v) => void (await db.put('meta', { key: k, value: v })),
    deleteMeta: (k) => db.delete('meta', k),
  };
}
