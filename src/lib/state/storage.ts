export type StorageIssue = { key: string; kind: 'corrupt' | 'write-failed' };

export interface SafeStorage {
  get<T>(key: string, fallback: T): T;
  set(key: string, v: unknown): void;
  remove(key: string): void;
  /** false once running on the in-memory fallback (no/failed backing storage). */
  readonly persistent: boolean;
  readonly issues: StorageIssue[];
  /** 읽은 JSON의 모양·값이 틀려 기본값으로 바꿨을 때(저장소 배너로 알린다). */
  reportCorrupt(key: string): void;
}

const PREFIX = 'gazua:v1:';

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

  const report = (key: string, kind: StorageIssue['kind']) => {
    if (!issues.some((i) => i.key === key && i.kind === kind)) issues.push({ key, kind });
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
    },
    get persistent() {
      return persistent;
    },
    issues,
    reportCorrupt(key) {
      report(key, 'corrupt');
    },
  };
}
