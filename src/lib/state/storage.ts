export type StorageIssue = { key: string; kind: 'corrupt' | 'write-failed' | 'proxy-cleared'; detail?: string };

export interface SafeStorage {
  get<T>(key: string, fallback: T): T;
  set(key: string, v: unknown): void;
  /**
   * 저장소(backing)에 바로 써 본다(앞서 쓰기가 실패해 persistent가 false여도 다시 시도한다).
   * 저장되면 true(이 키의 메모리 덮어쓰기는 지운다). 실패하거나 저장소가 없으면 false이고 아무것도 바꾸지 않는다.
   */
  trySet(key: string, v: unknown): boolean;
  /** 이 탭의 메모리 덮어쓰기를 건너뛰고 저장소(backing)에 지금 있는 값을 읽는다(다른 탭이 쓴 값 확인용). 없거나 읽지 못하면 fallback. */
  readBacking<T>(key: string, fallback: T): T;
  /** 저장소(backing)에서 실제로 지웠으면 true. 저장소가 없거나 removeItem이 실패하면 false(메모리에서는 지운 것으로 본다). */
  remove(key: string): boolean;
  /** false once running on the in-memory fallback (no/failed backing storage). */
  readonly persistent: boolean;
  /** 저장소(backing)가 처음부터 있는지. 없으면 아무것도 저장된 적이 없다. */
  readonly backed: boolean;
  readonly issues: StorageIssue[];
  /** 읽은 JSON의 모양·값이 틀려 기본값으로 바꿨을 때(저장소 배너로 알린다). */
  reportCorrupt(key: string): void;
  /** 저장된 프록시 주소를 지웠을 때. detail은 보여 줘도 되는 origin(없으면 이유를 말하지 않는다). */
  reportProxyCleared(key: string, detail?: string): void;
}

/** 저장소 키 앞에 붙는 접두어(storage 이벤트의 key와 비교할 때 쓴다). */
export const STORAGE_PREFIX = 'gazua:v1:';
const PREFIX = STORAGE_PREFIX;

function defaultBacking(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Never throws. Falls back to memory when the backing store is missing or a write fails.
 * Keys are relative; the `gazua:v1:` prefix is added here.
 */
export function createSafeStorage(backing: Storage | null = defaultBacking()): SafeStorage {
  // Overlay that wins over the backing store. `undefined` marks a removal the backing store did not accept.
  const memory = new Map<string, unknown>();
  const issues: StorageIssue[] = [];
  let persistent = backing !== null;

  const report = (key: string, kind: StorageIssue['kind'], detail?: string) => {
    if (!issues.some((i) => i.key === key && i.kind === kind)) {
      issues.push(detail === undefined ? { key, kind } : { key, kind, detail });
    }
  };

  return {
    get<T>(key: string, fallback: T): T {
      if (memory.has(key)) {
        const v = memory.get(key);
        return v === undefined ? fallback : (v as T);
      }
      if (!backing) return fallback;
      let raw: string | null;
      try {
        raw = backing.getItem(PREFIX + key);
      } catch {
        return fallback;
      }
      if (raw === null) return fallback;
      try {
        return JSON.parse(raw) as T;
      } catch {
        report(key, 'corrupt');
        return fallback;
      }
    },
    set(key, v) {
      if (persistent && backing) {
        try {
          backing.setItem(PREFIX + key, JSON.stringify(v));
          memory.delete(key);
          return;
        } catch {
          persistent = false;
          report(key, 'write-failed');
        }
      }
      memory.set(key, v);
    },
    readBacking<T>(key: string, fallback: T): T {
      if (!backing) return fallback;
      try {
        const raw = backing.getItem(PREFIX + key);
        return raw === null ? fallback : (JSON.parse(raw) as T);
      } catch {
        return fallback;
      }
    },
    trySet(key, v) {
      if (!backing) return false;
      try {
        backing.setItem(PREFIX + key, JSON.stringify(v));
      } catch {
        report(key, 'write-failed');
        return false;
      }
      memory.delete(key);
      return true;
    },
    remove(key) {
      let removed = false;
      if (backing) {
        try {
          backing.removeItem(PREFIX + key);
          removed = true;
        } catch {
          // handled below
        }
      }
      if (removed) memory.delete(key);
      else memory.set(key, undefined);
      return removed;
    },
    get persistent() {
      return persistent;
    },
    backed: backing !== null,
    issues,
    reportCorrupt(key) {
      report(key, 'corrupt');
    },
    reportProxyCleared(key, detail) {
      report(key, 'proxy-cleared', detail);
    },
  };
}
