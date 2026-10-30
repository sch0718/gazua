// 가져오기 대기 값(설계 4.8). SharedView가 넣고, 관문·온보딩을 지난 뒤 ImportHost가 읽는다.
// sessionStorage는 같은 탭의 다른 스크립트도 쓸 수 있으므로 읽을 때마다 다시 검사하고 30분 뒤 버린다(설계 1.5-7).
import { isShareKind, type ShareKind } from './kinds';
import { checkShareSnapshot, type CompareSnapshot, type CriteriaSnapshot, type GroupSnapshot, type ShareSnapshot, type StrategySnapshot } from './snapshot';

export const IMPORT_KEY = 'gazua:v1:share-import';
export const IMPORT_DONE_KEY = 'gazua:v1:share-import-done';
export const IMPORT_TTL_MS = 30 * 60 * 1000;
const DONE_MAX = 20;

/** 가져올 수 있는 종류만 둔다. simResult는 strategy로, validation은 criteria로 바꿔 넣는다 */
export type ImportSnapshot = GroupSnapshot | StrategySnapshot | CriteriaSnapshot | CompareSnapshot;
export interface PendingImport {
  /** 이 가져오기를 구별하는 무작위 값(탭 복제로 두 번 저장되지 않게) */
  id: string;
  /** 원래 받은 종류(확인 창 안내에 쓴다) */
  from: ShareKind;
  snapshot: ImportSnapshot;
  at: number;
}

/** 저장소를 쓸 수 없는 환경(사생활 보호 등)에서 같은 탭 안 이동을 잇는 값 */
let memory: string | null = null;

const session = (): Storage | null => {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
};
const local = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

const EXPECT: Record<ShareKind, ImportSnapshot['kind']> = {
  group: 'group',
  strategy: 'strategy',
  criteria: 'criteria',
  compare: 'compare',
  simResult: 'strategy',
  validation: 'criteria',
};

/** 결과 종류는 결과 부분을 버리고 규칙 부분만 남긴다(설계 1.5-14) */
export function importPart(s: ShareSnapshot): ImportSnapshot {
  switch (s.kind) {
    case 'simResult':
      return { kind: 'strategy', v: 1, title: s.title, strategy: s.strategy, capitalHidden: s.capitalHidden };
    case 'validation':
      return { kind: 'criteria', v: 1, title: s.title, criteria: s.criteria, baskets: s.baskets, capitalHidden: s.capitalHidden };
    default:
      return s;
  }
}

/** sessionStorage에 둔다. 쓰지 못하면 false(그때는 메모리 값으로 같은 탭 안에서만 이어 간다) */
export function stashImport(snapshot: ShareSnapshot, now: number, store: Storage | null = session()): boolean {
  const value: PendingImport = { id: crypto.randomUUID(), from: snapshot.kind, snapshot: importPart(snapshot), at: now };
  const json = JSON.stringify(value);
  memory = json;
  if (!store) return false;
  try {
    store.setItem(IMPORT_KEY, json);
    return true;
  } catch {
    return false;
  }
}

function parse(raw: string, now: number): PendingImport | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  const { id, from, snapshot, at } = v as Record<string, unknown>;
  if (typeof id !== 'string' || id === '' || id.length > 64) return null;
  if (!isShareKind(from) || typeof at !== 'number' || !(now - at >= 0 && now - at <= IMPORT_TTL_MS)) return null;
  const want = EXPECT[from];
  if (typeof snapshot !== 'object' || snapshot === null || (snapshot as { kind?: unknown }).kind !== want) return null;
  const c = checkShareSnapshot(snapshot, want, now, 'read');
  return c.ok ? { id, from, snapshot: c.snapshot as ImportSnapshot, at } : null;
}

/** 지우지 않고 읽는다. 30분이 지났거나 종류가 맞지 않거나 검사에 실패하면 지우고 null */
export function peekImport(now: number, store: Storage | null = session()): PendingImport | null {
  let raw: string | null = null;
  try {
    raw = store ? store.getItem(IMPORT_KEY) : null;
  } catch {
    raw = null;
  }
  raw ??= memory;
  if (raw === null) return null;
  const p = parse(raw, now);
  if (!p) clearImport(store);
  return p;
}

/** 저장하거나 닫을 때 지운다 */
export function clearImport(store: Storage | null = session()): void {
  memory = null;
  try {
    store?.removeItem(IMPORT_KEY);
  } catch {
    // 지우지 못해도 30분 뒤 버린다
  }
}

function doneIds(store: Storage | null): string[] {
  try {
    const v: unknown = JSON.parse(store?.getItem(IMPORT_DONE_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function wasImported(id: string, store: Storage | null = local()): boolean {
  return doneIds(store).includes(id);
}

export function markImported(id: string, store: Storage | null = local()): void {
  try {
    store?.setItem(IMPORT_DONE_KEY, JSON.stringify([...doneIds(store).filter((x) => x !== id), id].slice(-DONE_MAX)));
  } catch {
    // 기록하지 못하면 탭 복제 방지만 빠진다
  }
}
