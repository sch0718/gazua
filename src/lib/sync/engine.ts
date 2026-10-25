// 동기화 엔진(제안서 7절 「동기화 규칙」). Svelte·Firebase에 기대지 않는다.
// - 로컬 저장이 먼저다. 문서 해시가 마지막 확인 해시와 다를 때만 작업 ID와 함께 큐에 넣고, 서버가 확인해야 끝난다.
// - 서버는 expectedRevision이 맞을 때만 갱신한다. 기준이 다르면 덮어쓰지 않고 충돌 사본을 남겨 사용자가 고른다.
// - 삭제는 tombstone이다. 오래 오프라인이던 기기가 지운 프로필을 되살리지 못한다.
// - 원격 적용은 같은 ID를 쓰고, 이 기기의 기존 프로필을 동의 없이 덮어쓰지 않는다.
import type { ApiFail, SyncApi } from './api';
import { docName } from './profileDoc';
import type { ProfileDocV1 } from './dto';
import { docHash } from './hash';
import type { Conflict, OutboxOp, ProfileSyncState, SyncStore } from './store';

/** 앱의 프로필 저장소. 원격 적용·삭제는 변경 알림을 내지 않는다(다시 올리지 않게). */
export interface LocalProfiles {
  list(): { id: string; name: string }[];
  read(id: string): ProfileDocV1;
  /** 같은 ID에 쓴다. 없으면 추가한다. */
  write(id: string, doc: ProfileDocV1): void;
  /** 지운다. 마지막 프로필이면 빈 기본 프로필을 먼저 만든다. */
  remove(id: string): void;
  /** 새 ID 프로필을 만든다(충돌 사본·복원). */
  create(doc: ProfileDocV1): string;
}

export type SyncPhase = 'off' | 'idle' | 'syncing' | 'offline' | 'auth' | 'not-allowed' | 'limit' | 'error';

export interface SyncStatus {
  enabled: boolean;
  phase: SyncPhase;
  /** 서버 확인을 기다리는 작업 수 */
  pending: number;
  conflicts: Conflict[];
  /** 서버가 거절한 프로필(크기 초과 등). 문서가 바뀌면 다시 보낸다. */
  rejected: { profileId: string; code: string }[];
  lastSyncAt: number | null;
  /** 사용자에게 한 번 알릴 일(예: 다른 기기가 고친 프로필이라 지우지 않았어요). */
  notices: string[];
  /** IndexedDB 없이 메모리로 돌고 있다. */
  volatile: boolean;
}

export type Resolution = 'keep-local' | 'take-remote' | 'keep-both' | 'restore' | 'delete-local';

export interface SyncEngineDeps {
  local: LocalProfiles;
  store: SyncStore;
  api: SyncApi;
  now: () => number;
  uuid?: () => string;
  /** 탭 사이 한 번에 하나만(Web Locks). 없으면 그냥 실행한다. */
  lock?: <T>(fn: () => Promise<T>) => Promise<T>;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  debounceMs?: number;
  /** 다시 로그인해야 할 때(세션 철회·만료 등). */
  onAuthFailure?: (code: string) => void;
}

export interface SyncEngine {
  status(): SyncStatus;
  subscribe(fn: (s: SyncStatus) => void): () => void;
  /** 저장된 enabled·상태를 읽는다. 처음 한 번 부른다. */
  init(): Promise<void>;
  setEnabled(on: boolean): Promise<void>;
  /** 처음 켤 때 확인용: 올릴 로컬 프로필 이름과 받을 원격 프로필 수. */
  preview(): Promise<{ upload: string[]; download: number } | ApiFail>;
  /** 동기화 대상 데이터가 바뀌었다(디바운스 후 올린다). */
  profileChanged(id: string): void;
  /** 이 기기에서 프로필을 지웠다. tombstone 작업을 바로 큐에 넣는다. */
  profileDeleted(id: string): Promise<void>;
  /** 받기 → 보내기. */
  syncNow(): Promise<void>;
  pull(): Promise<void>;
  flush(): Promise<void>;
  resolve(profileId: string, choice: Resolution): Promise<void>;
  /** 서버의 과거 리비전을 새 로컬 프로필 `이름 (복원)`으로 만든다(원래 프로필은 그대로). 새 프로필 ID를 돌려준다. */
  restoreRevision(profileId: string, revision: number): Promise<{ ok: true; profileId: string } | ApiFail>;
  /** 다른 계정으로 로그인했다: 이 기기의 동기화 상태(켜짐·대기 작업·리비전·충돌)를 모두 버린다. 로컬 프로필은 그대로다. */
  reset(): Promise<void>;
  /** 공지를 비운다. */
  clearNotices(): void;
  destroy(): void;
}

export const CONFLICT_COPY_SUFFIX = ' (충돌 사본)';
export const RESTORED_SUFFIX = ' (복원)';

/** 이름 뒤에 붙임말을 붙이되 30자를 넘지 않게 앞부분을 줄인다. */
export function suffixed(name: string, suffix: string): string {
  const room = 30 - [...suffix].length;
  return docName(`${[...docName(name)].slice(0, room).join('').trim()}${suffix}`);
}
const MAX_BACKOFF = 5 * 60 * 1000;
const BASE_BACKOFF = 5000;

export function createSyncEngine(deps: SyncEngineDeps): SyncEngine {
  const { local, store, api, now } = deps;
  const uuid = deps.uuid ?? (() => crypto.randomUUID());
  const lock = deps.lock ?? (<T>(fn: () => Promise<T>) => fn());
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const debounceMs = deps.debounceMs ?? 3000;

  let status: SyncStatus = {
    enabled: false,
    phase: 'off',
    pending: 0,
    conflicts: [],
    rejected: [],
    lastSyncAt: null,
    notices: [],
    volatile: !store.persistent,
  };
  const listeners = new Set<(s: SyncStatus) => void>();
  let debounce: unknown = null;
  let retry: unknown = null;
  let failures = 0;
  let destroyed = false;
  // 이 탭 안에서도 한 번에 하나만
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(() => lock(fn));
    chain = run.catch(() => {});
    return run;
  };

  function emit(patch: Partial<SyncStatus>) {
    status = { ...status, ...patch };
    for (const l of listeners) l(status);
  }

  async function refresh(patch: Partial<SyncStatus> = {}) {
    const [ops, conflicts, states] = await Promise.all([store.ops(), store.conflicts(), store.states()]);
    emit({
      pending: ops.length,
      conflicts,
      rejected: states.filter((s) => s.rejectedCode).map((s) => ({ profileId: s.profileId, code: s.rejectedCode! })),
      ...patch,
    });
  }

  /** 실패를 상태로 바꾼다. 네트워크·서버·한도는 잠시 뒤 다시 시도한다. */
  function failed(f: ApiFail) {
    const phase: SyncPhase =
      f.kind === 'offline' ? 'offline' : f.kind === 'auth' ? 'auth' : f.kind === 'not-allowed' ? 'not-allowed' : f.kind === 'limit' ? 'limit' : 'error';
    if (f.kind === 'auth') deps.onAuthFailure?.(f.code);
    if (f.kind === 'not-allowed') deps.onAuthFailure?.('not-allowed');
    if (phase === 'offline' || phase === 'limit' || phase === 'error') {
      failures++;
      if (retry !== null) clearTimer(retry);
      retry = setTimer(() => {
        retry = null;
        void engine.syncNow();
      }, Math.min(MAX_BACKOFF, BASE_BACKOFF * 2 ** (failures - 1)));
    }
    return phase;
  }

  async function dropOps(profileId: string) {
    for (const op of await store.ops()) if (op.profileId === profileId) await store.deleteOp(op.opId);
  }

  async function setSynced(profileId: string, revision: number, hash: string, extra: Partial<ProfileSyncState> = {}) {
    await store.putState({ profileId, syncedRevision: revision, syncedHash: hash, ...extra });
  }

  // ── 큐에 넣기 ──────────────────────────────────────────

  async function enqueueChanged(): Promise<void> {
    const conflicts = new Set((await store.conflicts()).map((c) => c.profileId));
    const ops = await store.ops();
    for (const p of local.list()) {
      if (conflicts.has(p.id)) continue;
      const doc = local.read(p.id);
      const hash = await docHash(doc);
      const st = await store.state(p.id);
      const unsent = ops.filter((o) => o.profileId === p.id && o.sentAt === undefined);
      if (st && !st.deleted && st.syncedHash === hash) {
        for (const o of unsent) await store.deleteOp(o.opId);
        continue;
      }
      if (st?.rejectedHash === hash) continue;
      if (st?.deleted) continue; // 서버에서 지워진 것을 알고 있다: pull·충돌 처리에 맡긴다
      if (ops.some((o) => o.profileId === p.id && o.kind === 'put' && o.sentAt !== undefined && o.hash === hash)) continue;
      for (const o of unsent) await store.deleteOp(o.opId);
      await store.putOp({ opId: uuid(), profileId: p.id, kind: 'put', doc, hash, createdAt: now() });
    }
  }

  // ── 보내기 ─────────────────────────────────────────────

  async function push(): Promise<SyncPhase> {
    const conflicts = new Set((await store.conflicts()).map((c) => c.profileId));
    for (const op of await store.ops()) {
      if (conflicts.has(op.profileId)) {
        await store.deleteOp(op.opId); // 충돌 사본이 로컬 문서를 들고 있다
        continue;
      }
      const st = await store.state(op.profileId);
      if (op.sentAt === undefined) {
        op.sentAt = now();
        op.baseRevision = st?.syncedRevision ?? 0;
        await store.putOp(op);
      }
      const base = op.baseRevision ?? 0;
      if (op.kind === 'put') {
        const r = await api.putProfile(op.profileId, { opId: op.opId, expectedRevision: base, doc: op.doc! });
        if (r.ok) {
          await setSynced(op.profileId, r.data.revision, op.hash!);
        } else if (r.kind === 'conflict') {
          if (r.doc && (await docHash(r.doc)) === op.hash) await setSynced(op.profileId, r.revision, op.hash!);
          else if (r.doc)
            await store.putConflict({ profileId: op.profileId, kind: 'edit', local: op.doc!, remote: r.doc, remoteRevision: r.revision, detectedAt: now() });
        } else if (r.kind === 'gone') {
          await store.putConflict({
            profileId: op.profileId,
            kind: 'deleted',
            local: op.doc!,
            deletedAt: r.deletedAt,
            purgeAt: r.purgeAt,
            remoteRevision: r.revision ?? 0,
            detectedAt: now(),
          });
        } else if (r.kind === 'invalid') {
          await store.putState({ ...(st ?? { profileId: op.profileId, syncedRevision: 0, syncedHash: '' }), rejectedHash: op.hash, rejectedCode: r.code });
        } else {
          return failed(r);
        }
        await store.deleteOp(op.opId);
      } else {
        const r = await api.deleteProfile(op.profileId, { opId: op.opId, expectedRevision: base });
        if (r.ok) await setSynced(op.profileId, r.data.revision, '', { deleted: true });
        else if (r.kind === 'gone') await setSynced(op.profileId, r.revision ?? base, '', { deleted: true });
        else if (r.kind === 'conflict') {
          // 다른 기기가 먼저 고쳤다: 지우지 않고, 다음 받기에서 서버 것을 다시 들인다
          await store.deleteState(op.profileId);
          emit({ notices: [...status.notices, '다른 기기에서 고친 프로필이라 서버에서는 지우지 않았어요. 서버 것을 다시 받아요.'] });
        } else if (r.kind !== 'invalid' && r.kind !== 'not-found') return failed(r);
        await store.deleteOp(op.opId);
      }
    }
    return 'idle';
  }

  // ── 받기 ───────────────────────────────────────────────

  async function pull(): Promise<SyncPhase> {
    const list = await api.listProfiles();
    if (!list.ok) return failed(list);
    const localIds = new Set(local.list().map((p) => p.id));
    const remoteIds = new Set<string>();
    const conflicts = new Set((await store.conflicts()).map((c) => c.profileId));
    const ops = await store.ops();
    for (const row of list.data.profiles) {
      const id = row.profileId;
      remoteIds.add(id);
      if (conflicts.has(id) || ops.some((o) => o.profileId === id && o.kind === 'delete')) continue;
      const st = await store.state(id);

      if (row.deletedAt !== null) {
        if (st?.deleted && st.syncedRevision >= row.revision) continue;
        if (localIds.has(id)) {
          const doc = local.read(id);
          const dirty = !st || st.syncedHash !== (await docHash(doc));
          await dropOps(id);
          if (dirty) {
            await store.putConflict({ profileId: id, kind: 'deleted', local: doc, deletedAt: row.deletedAt, purgeAt: row.purgeAt, remoteRevision: row.revision, detectedAt: now() });
            continue;
          }
          local.remove(id);
        }
        await setSynced(id, row.revision, '', { deleted: true });
        continue;
      }

      if (st && !st.deleted && st.syncedRevision === row.revision && localIds.has(id)) continue;
      const got = await api.getProfile(id);
      if (!got.ok) {
        if (got.kind === 'gone' || got.kind === 'not-found') continue;
        return failed(got);
      }
      const remoteHash = await docHash(got.data.doc);
      if (!localIds.has(id)) {
        local.write(id, got.data.doc);
        await setSynced(id, got.data.revision, remoteHash);
        continue;
      }
      const doc = local.read(id);
      const localHash = await docHash(doc);
      if (localHash === remoteHash || (st && !st.deleted && st.syncedHash === localHash)) {
        if (localHash !== remoteHash) local.write(id, got.data.doc);
        await dropOps(id);
        await setSynced(id, got.data.revision, remoteHash);
        continue;
      }
      await dropOps(id);
      await store.putConflict({ profileId: id, kind: 'edit', local: doc, remote: got.data.doc, remoteRevision: got.data.revision, detectedAt: now() });
    }
    // 동기화했던 프로필이 서버에서 정리돼 사라졌다(다른 기기에서 지운 지 30일이 지났다)
    for (const id of localIds) {
      if (remoteIds.has(id) || conflicts.has(id)) continue;
      const st = await store.state(id);
      if (!st || st.syncedRevision === 0 || st.deleted) continue;
      if (ops.some((o) => o.profileId === id)) continue;
      await store.putConflict({ profileId: id, kind: 'deleted', local: local.read(id), deletedAt: null, purgeAt: null, remoteRevision: 0, detectedAt: now() });
    }
    return 'idle';
  }

  async function run(steps: ('pull' | 'push')[]): Promise<void> {
    if (!status.enabled || destroyed) return;
    await serial(async () => {
      emit({ phase: 'syncing' });
      let phase: SyncPhase = 'idle';
      for (const s of steps) {
        if (s === 'pull') phase = await pull();
        else {
          await enqueueChanged();
          phase = await push();
        }
        if (phase !== 'idle') break;
      }
      if (phase === 'idle') {
        failures = 0;
        await refresh({ phase, lastSyncAt: now() });
      } else await refresh({ phase });
    });
  }

  const engine: SyncEngine = {
    status: () => status,
    subscribe(fn) {
      listeners.add(fn);
      fn(status);
      return () => listeners.delete(fn);
    },
    async init() {
      const enabled = (await store.getMeta<boolean>('enabled')) === true;
      const lastSyncAt = (await store.getMeta<number>('lastSyncAt')) ?? null;
      await refresh({ enabled, phase: enabled ? 'idle' : 'off', lastSyncAt });
    },
    async setEnabled(on) {
      await store.setMeta('enabled', on);
      await refresh({ enabled: on, phase: on ? 'idle' : 'off' });
      if (on) await engine.syncNow();
    },
    async preview() {
      const list = await api.listProfiles();
      if (!list.ok) return list;
      const remote = new Set(list.data.profiles.filter((p) => p.deletedAt === null).map((p) => p.profileId));
      const localList = local.list();
      return {
        upload: localList.filter((p) => !remote.has(p.id)).map((p) => docName(p.name)),
        download: [...remote].filter((id) => !localList.some((p) => p.id === id)).length,
      };
    },
    profileChanged() {
      if (!status.enabled) return;
      if (debounce !== null) clearTimer(debounce);
      debounce = setTimer(() => {
        debounce = null;
        void engine.flush();
      }, debounceMs);
    },
    async profileDeleted(id) {
      await serial(async () => {
        const st = await store.state(id);
        const ops = await store.ops();
        // 보냈지만 응답을 못 받은 첫 업로드는 서버에 만들어졌을 수 있다. 그 작업은 남겨(같은 opId로 다시 보내 리비전을 확인) 뒤에 지우기를 이어 붙인다.
        const sentPut = ops.some((o) => o.profileId === id && o.kind === 'put' && o.sentAt !== undefined);
        for (const o of ops) if (o.profileId === id && (o.sentAt === undefined || !sentPut)) await store.deleteOp(o.opId);
        await store.deleteConflict(id);
        if ((st && st.syncedRevision > 0 && !st.deleted) || sentPut) {
          await store.putOp({ opId: uuid(), profileId: id, kind: 'delete', createdAt: now() });
        } else {
          await store.deleteState(id);
        }
        await refresh();
      });
      engine.profileChanged(id);
    },
    syncNow: () => run(['pull', 'push']),
    pull: () => run(['pull']),
    flush: () => run(['push']),
    async resolve(profileId, choice) {
      let push = false;
      await serial(async () => {
        const c = (await store.conflicts()).find((x) => x.profileId === profileId);
        if (!c) return;
        if (c.kind === 'edit') {
          const remoteHash = await docHash(c.remote);
          if (choice === 'keep-local') {
            await setSynced(profileId, c.remoteRevision, remoteHash);
            push = true;
          } else if (choice === 'take-remote' || choice === 'keep-both') {
            if (choice === 'keep-both') {
              const mine = local.list().some((p) => p.id === profileId) ? local.read(profileId) : c.local;
              local.create({ ...mine, name: suffixed(mine.name, CONFLICT_COPY_SUFFIX) });
              push = true;
            }
            local.write(profileId, c.remote);
            await setSynced(profileId, c.remoteRevision, remoteHash);
          } else return;
        } else {
          if (choice === 'restore') {
            if (c.deletedAt !== null) {
              const r = await api.restoreProfile(profileId, uuid());
              if (r.ok) await setSynced(profileId, r.data.revision, await docHash(r.data.doc));
              else if (r.kind === 'gone') await setSynced(profileId, 0, '');
              else if (r.kind === 'conflict') await store.deleteState(profileId); // 이미 복구됐다: 다음 받기에서 맞춘다
              else {
                await refresh({ phase: failed(r) });
                return;
              }
            } else await setSynced(profileId, 0, '');
            if (!local.list().some((p) => p.id === profileId)) local.write(profileId, c.local);
            push = true;
          } else if (choice === 'delete-local') {
            if (local.list().some((p) => p.id === profileId)) local.remove(profileId);
            await setSynced(profileId, c.remoteRevision, '', { deleted: true });
          } else return;
        }
        await store.deleteConflict(profileId);
        await refresh();
      });
      if (push) await engine.syncNow();
    },
    async restoreRevision(profileId, revision) {
      const r = await api.getRevision(profileId, revision);
      if (!r.ok) return r;
      const id = local.create({ ...r.data.doc, name: suffixed(r.data.doc.name, RESTORED_SUFFIX) });
      engine.profileChanged(id);
      return { ok: true, profileId: id };
    },
    async reset() {
      await serial(async () => {
        if (debounce !== null) clearTimer(debounce);
        if (retry !== null) clearTimer(retry);
        debounce = retry = null;
        failures = 0;
        for (const o of await store.ops()) await store.deleteOp(o.opId);
        for (const st of await store.states()) await store.deleteState(st.profileId);
        for (const c of await store.conflicts()) await store.deleteConflict(c.profileId);
        await store.setMeta('enabled', false);
        await store.deleteMeta('lastSyncAt');
        await refresh({ enabled: false, phase: 'off', lastSyncAt: null, notices: [] });
      });
    },
    clearNotices() {
      emit({ notices: [] });
    },
    destroy() {
      destroyed = true;
      if (debounce !== null) clearTimer(debounce);
      if (retry !== null) clearTimer(retry);
      listeners.clear();
    },
  };
  // 마지막 동기화 시각은 저장해 두고 다음 실행에서 보여 준다
  let savedSyncAt: number | null = null;
  engine.subscribe((s) => {
    if (s.lastSyncAt === null || s.lastSyncAt === savedSyncAt) return;
    savedSyncAt = s.lastSyncAt;
    void store.setMeta('lastSyncAt', s.lastSyncAt);
  });
  return engine;
}

export type { OutboxOp };
