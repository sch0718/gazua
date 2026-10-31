// 키 동기화 기기 상태(IndexedDB `gazua-sync-keys` 버전 1, 설계 2.5). 평문·암호문·암호·키 해시는 두지 않는다.
// gazua-sync와 다른 DB라 옛 번들 탭이 gazua-sync를 쥐고 있어도 막히지 않는다. 쓰기는 모두 한 readwrite 트랜잭션의 읽기-고치기-쓰기다.
// 행은 지우지 않는다(끄기·프로필 삭제에도 남는다). 금고가 바뀌거나 계정이 바뀔 때 clear()로만 없어진다.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { KeyProvider } from './keyWire';

/** 프로필 하나의 키 동기화 상태. 평문·암호문·키 해시·암호는 두지 않는다 */
export interface KeySyncState {
  profileId: string;
  /** 토글 켜짐으로 본다(서버에 살아 있는 블롭이 있다고 마지막으로 확인했거나 켜는 중). false: 꺼짐·다른 기기가 끔 */
  active: boolean;
  /** 이 기기가 마지막으로 맞춘(받았거나 올린) 서버 블롭 리비전. 0: 아직 맞추지 않음 */
  revision: number;
  /** 마지막으로 맞춘 블롭의 내용 ID. 비밀 아님 */
  syncedContentId: string | null;
  /** 이 기기가 본 서버 행 리비전 가운데 가장 큰 값(삭제 표시 포함). 줄지 않는다 */
  seenRevision: number;
  /** 끄기를 보냈지만 반영을 확인하지 못했다 */
  offPending: boolean;
  /** 올릴 공급자. revision > 0이면 비지 않는다 */
  providers: KeyProvider[];
  /** 이 기기에서 고른 공급자의 키가 바뀌거나 선택을 바꿀 때마다 1씩 오른다 */
  localSeq: number;
  /** 올렸거나 받았을 때 그 작업이 시작할 때 읽은 localSeq. localSeq > uploadedSeq면 dirty */
  uploadedSeq: number;
  /** 키 단계가 정한 알림. 'rollback': 서버가 이미 본 것보다 옛 리비전을 내줌 */
  notice: null | 'available' | 'newer' | 'conflict' | 'removed' | 'missing-key' | 'rollback';
  /** notice가 가리키는 서버 블롭 리비전(받기·올리기의 기준) */
  remoteRevision?: number;
}

export interface KeyStore {
  readonly persistent: boolean;
  state(profileId: string): Promise<KeySyncState | undefined>;
  states(): Promise<KeySyncState[]>;
  /** 꺼진 행(또는 없는 행)을 켠다. 이미 켜진 행이면 notice·remoteRevision만 바꾼다 */
  activate(profileId: string, p: { providers: KeyProvider[]; notice: KeySyncState['notice']; remoteRevision?: number }): Promise<void>;
  /** 서버에서 본 리비전을 기록한다(더 클 때만). 행이 없으면 꺼진 행으로 만든다 */
  markSeen(profileId: string, revision: number): Promise<void>;
  /** 켜짐·끄기 대기·알림을 한 트랜잭션에서 바꾼다(seq·seen은 그대로) */
  setActive(profileId: string, p: { active: boolean; offPending?: boolean; notice?: KeySyncState['notice'] }): Promise<void>;
  /** localSeq만 올린다. 행이 없거나 꺼졌거나, providers가 행의 선택과 겹치지 않으면 아무것도 하지 않는다 */
  bumpSeq(profileId: string, providers?: KeyProvider[]): Promise<void>;
  /** 켜진 행의 선택을 바꾸고 localSeq를 올린다. 빈 배열·꺼진 행은 던진다 */
  setProviders(profileId: string, providers: KeyProvider[]): Promise<void>;
  /** 맞춘 결과를 쓴다. localSeq는 그대로 둔다. 행이 없으면 아무것도 하지 않는다 */
  markSynced(
    profileId: string,
    p: { revision: number; contentId: string; uploadedSeq: number; providers?: KeyProvider[]; notice: KeySyncState['notice']; remoteRevision?: number },
  ): Promise<void>;
  /** notice·remoteRevision만 바꾼다 */
  setNotice(profileId: string, notice: KeySyncState['notice'], remoteRevision?: number): Promise<void>;
  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
  /** keys·meta를 모두 지운다(계정 전환·전체 삭제·다른 금고) */
  clear(): Promise<void>;
}

/** blocked가 이보다 길면 메모리 저장소로 계속한다 */
export const KEY_STORE_BLOCKED_MS = 3000;

type Row = KeySyncState;
/** 행을 받아 새 행(쓸 것) 또는 undefined(쓰지 않음)를 돌려준다. 던지면 아무것도 쓰지 않는다 */
type Mut = (row: Row | undefined) => Row | undefined;

const blank = (profileId: string): Row => ({
  profileId,
  active: false,
  revision: 0,
  syncedContentId: null,
  seenRevision: 0,
  offPending: false,
  providers: [],
  localSeq: 0,
  uploadedSeq: 0,
  notice: null,
});

function withNotice(r: Row, notice: Row['notice'], remoteRevision?: number): Row {
  const out: Row = { ...r, notice };
  if (notice === null || remoteRevision === undefined) delete out.remoteRevision;
  else out.remoteRevision = remoteRevision;
  return out;
}

const MUT = {
  activate:
    (id: string, p: { providers: KeyProvider[]; notice: Row['notice']; remoteRevision?: number }): Mut =>
    (row) => {
      const r = row ?? blank(id);
      if (r.active) return withNotice(r, p.notice, p.remoteRevision);
      // 꺼진 동안의 수정은 올릴 변경으로 치지 않는다(uploadedSeq = localSeq)
      const on: Row = { ...r, active: true, revision: 0, syncedContentId: null, uploadedSeq: r.localSeq, providers: [...p.providers], offPending: false };
      return withNotice(on, p.notice, p.remoteRevision);
    },
  markSeen:
    (id: string, revision: number): Mut =>
    (row) => {
      if (row && revision <= row.seenRevision) return undefined;
      const r = row ?? blank(id);
      return { ...r, seenRevision: Math.max(r.seenRevision, revision) };
    },
  setActive:
    (id: string, p: { active: boolean; offPending?: boolean; notice?: Row['notice'] }): Mut =>
    (row) => {
      const r: Row = { ...(row ?? blank(id)), active: p.active, ...(p.offPending !== undefined && { offPending: p.offPending }) };
      return p.notice === undefined ? r : withNotice(r, p.notice);
    },
  bumpSeq:
    (providers?: KeyProvider[]): Mut =>
    (row) => {
      if (!row || !row.active) return undefined;
      if (providers && !providers.some((p) => row.providers.includes(p))) return undefined;
      return { ...row, localSeq: row.localSeq + 1 };
    },
  setProviders:
    (providers: KeyProvider[]): Mut =>
    (row) => {
      if (providers.length === 0 || !row || !row.active) throw new Error('setProviders needs an active row and at least one provider');
      return { ...row, providers: [...providers], localSeq: row.localSeq + 1 };
    },
  markSynced:
    (p: { revision: number; contentId: string; uploadedSeq: number; providers?: KeyProvider[]; notice: Row['notice']; remoteRevision?: number }): Mut =>
    (row) => {
      if (!row) return undefined;
      const r: Row = { ...row, revision: p.revision, syncedContentId: p.contentId, uploadedSeq: p.uploadedSeq, ...(p.providers && { providers: [...p.providers] }) };
      return withNotice(r, p.notice, p.remoteRevision);
    },
  setNotice:
    (id: string, notice: Row['notice'], remoteRevision?: number): Mut =>
    (row) =>
      withNotice(row ?? blank(id), notice, remoteRevision),
};

function store(persistent: boolean, mutate: (id: string, fn: Mut) => Promise<void>, rest: Pick<KeyStore, 'state' | 'states' | 'getMeta' | 'setMeta' | 'clear'>): KeyStore {
  return {
    persistent,
    ...rest,
    activate: (id, p) => mutate(id, MUT.activate(id, p)),
    markSeen: (id, r) => mutate(id, MUT.markSeen(id, r)),
    setActive: (id, p) => mutate(id, MUT.setActive(id, p)),
    bumpSeq: (id, providers) => mutate(id, MUT.bumpSeq(providers)),
    setProviders: (id, providers) => mutate(id, MUT.setProviders(providers)),
    markSynced: (id, p) => mutate(id, MUT.markSynced(p)),
    setNotice: (id, notice, rr) => mutate(id, MUT.setNotice(id, notice, rr)),
  };
}

export function createMemoryKeyStore(): KeyStore {
  const keys = new Map<string, Row>();
  const meta = new Map<string, unknown>();
  const clone = <T>(v: T): T => structuredClone(v);
  return store(
    false,
    async (id, fn) => {
      const next = fn(keys.has(id) ? clone(keys.get(id)!) : undefined);
      if (next) keys.set(id, clone(next));
    },
    {
      state: async (id) => (keys.has(id) ? clone(keys.get(id)!) : undefined),
      states: async () => [...keys.values()].map(clone),
      getMeta: async <T>(k: string) => (meta.has(k) ? (clone(meta.get(k)) as T) : undefined),
      setMeta: async (k, v) => void meta.set(k, clone(v)),
      clear: async () => {
        keys.clear();
        meta.clear();
      },
    },
  );
}

interface Schema extends DBSchema {
  keys: { key: string; value: KeySyncState };
  meta: { key: string; value: { key: string; value: unknown } };
}

/** IndexedDB를 열지 못하거나 blocked가 blockedMs를 넘으면 메모리 저장소를 돌려준다(persistent = false) */
export async function openKeyStore(dbName = 'gazua-sync-keys', opts: { blockedMs?: number; version?: number } = {}): Promise<KeyStore> {
  let opened: IDBPDatabase<Schema> | undefined;
  let db: IDBPDatabase<Schema>;
  try {
    db = await new Promise<IDBPDatabase<Schema>>((resolve, reject) => {
      let gaveUp = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      openDB<Schema>(dbName, opts.version ?? 1, {
        upgrade(d) {
          if (!d.objectStoreNames.contains('keys')) d.createObjectStore('keys', { keyPath: 'profileId' });
          if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
        },
        blocked() {
          timer ??= setTimeout(() => {
            gaveUp = true;
            reject(new Error('blocked'));
          }, opts.blockedMs ?? KEY_STORE_BLOCKED_MS);
        },
        // 나중의 버전 올리기를 막지 않게 지금부터 연결을 놓는다
        blocking() {
          opened?.close();
        },
      }).then(
        (d) => {
          clearTimeout(timer);
          if (gaveUp) d.close();
          else {
            opened = d;
            resolve(d);
          }
        },
        reject,
      );
    });
  } catch {
    return createMemoryKeyStore();
  }
  return store(
    true,
    async (id, fn) => {
      const tx = db.transaction('keys', 'readwrite');
      try {
        const next = fn(await tx.store.get(id));
        if (next) await tx.store.put(next);
        await tx.done;
      } catch (e) {
        try {
          tx.abort();
        } catch {
          // 이미 끝난 트랜잭션
        }
        await tx.done.catch(() => {});
        throw e;
      }
    },
    {
      state: (id) => db.get('keys', id),
      states: () => db.getAll('keys'),
      getMeta: async <T>(k: string) => (await db.get('meta', k))?.value as T | undefined,
      setMeta: async (k, v) => void (await db.put('meta', { key: k, value: v })),
      clear: async () => {
        const tx = db.transaction(['keys', 'meta'], 'readwrite');
        await Promise.all([tx.objectStore('keys').clear(), tx.objectStore('meta').clear(), tx.done]);
      },
    },
  );
}
