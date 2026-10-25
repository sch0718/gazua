// 읽기 전용 공유 스냅샷(제안서 6절 「공유 링크는 전용 스냅샷으로」). exportData()를 재사용하지 않고 필요한 필드만 새로 만든다.
// 원본 객체 ID·프로필 이름·키·계좌·프록시·최근 종목은 넣지 않는다. 다른 객체 참조(그룹·전략·바구니)는 스냅샷 안에서 풀어 넣는다.
// sync-worker가 같은 검사 함수를 쓴다(DOM·저장소 의존 금지).
import { newCriteria } from '../screen/defaults';
import type { SelectionCriteria } from '../screen/types';
import { sanitizeCriteria } from '../screen/validate';
import type { Basket } from '../screen/baskets';
import { newStrategy } from '../sim/defaults';
import type { Strategy } from '../sim/types';
import { resolveSymbols, sanitizeStrategies } from '../sim/validate';
import type { Group, Watchlists } from '../state/schema';
import { findForbidden, jsonBytes, jsonDiff } from '../sync/forbidden';

export const SHARE_VERSION = 1;
/** 제안서 7절: 공유 스냅샷 100 KiB. */
export const SHARE_MAX_BYTES = 100 * 1024;
export const SHARE_TITLE_MAX = 30;
export const SHARE_GROUP_MAX = 50;
export const SHARE_TTL_DEFAULT_DAYS = 7;
export const SHARE_TTL_MAX_DAYS = 30;
/** 공유 안에서 쓰는 고정 ID. 원본 ID를 옮기지 않는다. */
export const SHARED_ID = 'shared';

export type ShareKind = 'group' | 'strategy' | 'criteria';

export interface GroupSnapshot {
  kind: 'group';
  v: 1;
  title: string;
  symbols: string[];
}
export interface StrategySnapshot {
  kind: 'strategy';
  v: 1;
  title: string;
  /** id·name·updatedAt은 고정값(SHARED_ID·title·0). 종목은 symbols로 풀어 넣는다. */
  strategy: Strategy;
  /** true면 capital.initial은 기본값으로 바꿔 둔 것이고 화면에 '비공개'로 보인다. */
  capitalHidden: boolean;
}
export interface CriteriaSnapshot {
  kind: 'criteria';
  v: 1;
  title: string;
  /** pool.baskets는 아래 baskets의 id(`b0`…)를 가리킨다. 반등 패턴은 직접 정한 entry, 실행 전략(trading)은 null. */
  criteria: SelectionCriteria;
  baskets: { id: string; name: string; symbols: string[] }[];
  capitalHidden: boolean;
}
export type ShareSnapshot = GroupSnapshot | StrategySnapshot | CriteriaSnapshot;

export type ShareError = 'invalid' | 'unknown-field' | 'forbidden-field' | 'too-large' | 'reference';
export type ShareCheck = { ok: true; snapshot: ShareSnapshot } | { ok: false; code: ShareError; path?: string };

type Row = Record<string, unknown>;
const isRecord = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);
const SYMBOL_RE = /^[0-9A-Z]{6}$/;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const basketId = (i: number) => `b${i}`;

export function shareTitle(name: string): string {
  return [...name.trim()].slice(0, SHARE_TITLE_MAX).join('').trim() || '공유';
}

// ── 만들기(클라이언트) ─────────────────────────────────────

/** 숨긴 종목은 뺀다. 색·추가 시각·그룹 ID는 넣지 않는다. */
export function groupSnapshot(g: Group): GroupSnapshot {
  return { kind: 'group', v: 1, title: shareTitle(g.name), symbols: g.items.filter((i) => !i.hidden).map((i) => i.symbol) };
}

export function strategySnapshot(s: Strategy, w: Watchlists, opts: { hideCapital: boolean; now?: number }): StrategySnapshot {
  const title = shareTitle(s.name);
  const strategy: Strategy = structuredClone({ ...s, id: SHARED_ID, name: title, updatedAt: 0 });
  strategy.universe = { kind: 'symbols', symbols: resolveSymbols(s, w) };
  if (opts.hideCapital) strategy.capital.initial = newStrategy(opts.now ?? 0, null).capital.initial;
  return { kind: 'strategy', v: 1, title, strategy, capitalHidden: opts.hideCapital };
}

export function criteriaSnapshot(
  c: SelectionCriteria,
  refs: { baskets: Basket[]; strategies: Strategy[] },
  opts: { hideCapital: boolean; now?: number },
): CriteriaSnapshot {
  const title = shareTitle(c.name);
  const criteria: SelectionCriteria = structuredClone({ ...c, id: SHARED_ID, name: title, updatedAt: 0 });
  const baskets: CriteriaSnapshot['baskets'] = [];
  const ids: string[] = [];
  for (const id of c.pool.baskets) {
    const b = refs.baskets.find((x) => x.id === id);
    if (!b) continue;
    const sid = basketId(baskets.length);
    baskets.push({ id: sid, name: shareTitle(b.name), symbols: [...b.symbols] });
    ids.push(sid);
  }
  criteria.pool.baskets = ids;
  const pattern = c.conditions.rebound.pattern;
  if (pattern.from === 'strategy') {
    const ref = refs.strategies.find((x) => x.id === pattern.strategyId);
    criteria.conditions.rebound.pattern = { from: 'custom', entry: structuredClone((ref ?? newStrategy(opts.now ?? 0, null)).entry) };
  }
  criteria.trading = { strategyId: null };
  if (opts.hideCapital) criteria.capital = newCriteria(opts.now ?? 0, null).capital;
  return { kind: 'criteria', v: 1, title, criteria, baskets, capitalHidden: opts.hideCapital };
}

// ── 검사(클라이언트·서버 공용) ──────────────────────────────

const fail = (code: ShareError, path?: string): ShareCheck => (path === undefined ? { ok: false, code } : { ok: false, code, path });

function exactKeys(v: Row, keys: string[], path: string): ShareCheck | null {
  for (const k of Object.keys(v)) if (!keys.includes(k)) return fail('unknown-field', path ? `${path}.${k}` : k);
  for (const k of keys) if (!Object.hasOwn(v, k)) return fail('invalid', path ? `${path}.${k}` : k);
  return null;
}

const validTitle = (t: unknown): t is string =>
  typeof t === 'string' && t !== '' && t === t.trim() && [...t].length <= SHARE_TITLE_MAX;

function sameAs(input: unknown, cleaned: unknown, path: string): ShareCheck | null {
  const d = jsonDiff(input, cleaned, path);
  return d ? fail(d.kind === 'extra' ? 'unknown-field' : 'invalid', d.path) : null;
}

/**
 * 스냅샷을 검사한다. 금지 키 → 크기 → 원본 ID 모양(UUID) → 필드·값 순서. 고칠 것이 있으면 거절한다.
 * kind는 요청의 kind와 같아야 한다.
 */
export function checkShareSnapshot(raw: unknown, kind: unknown, now = Date.now()): ShareCheck {
  if (!isRecord(raw)) return fail('invalid');
  const forbidden = findForbidden(raw);
  if (forbidden) return fail('forbidden-field', forbidden);
  if (jsonBytes(raw) > SHARE_MAX_BYTES) return fail('too-large');
  if (UUID_RE.test(JSON.stringify(raw))) return fail('reference');
  if (raw.kind !== kind) return fail('invalid', 'kind');
  if (raw.v !== SHARE_VERSION) return fail('invalid', 'v');
  if (!validTitle(raw.title)) return fail('invalid', 'title');

  switch (raw.kind) {
    case 'group': {
      const k = exactKeys(raw, ['kind', 'v', 'title', 'symbols'], '');
      if (k) return k;
      const s = raw.symbols;
      if (!Array.isArray(s) || s.length > SHARE_GROUP_MAX || s.some((x) => typeof x !== 'string' || !SYMBOL_RE.test(x)) || new Set(s).size !== s.length)
        return fail('invalid', 'symbols');
      return { ok: true, snapshot: raw as unknown as GroupSnapshot };
    }
    case 'strategy': {
      const k = exactKeys(raw, ['kind', 'v', 'title', 'strategy', 'capitalHidden'], '');
      if (k) return k;
      if (typeof raw.capitalHidden !== 'boolean') return fail('invalid', 'capitalHidden');
      const s = raw.strategy;
      if (!isRecord(s) || s.id !== SHARED_ID || s.name !== raw.title || s.updatedAt !== 0) return fail('invalid', 'strategy');
      if (!isRecord(s.universe) || s.universe.kind !== 'symbols') return fail('reference', 'strategy.universe');
      const cleaned = sanitizeStrategies({ strategies: [s] }, now).strategies[0];
      return sameAs(s, cleaned, 'strategy') ?? { ok: true, snapshot: raw as unknown as StrategySnapshot };
    }
    case 'criteria': {
      const k = exactKeys(raw, ['kind', 'v', 'title', 'criteria', 'baskets', 'capitalHidden'], '');
      if (k) return k;
      if (typeof raw.capitalHidden !== 'boolean') return fail('invalid', 'capitalHidden');
      if (!Array.isArray(raw.baskets) || raw.baskets.length > 30) return fail('invalid', 'baskets');
      const ids: string[] = [];
      for (const [i, b] of raw.baskets.entries()) {
        const path = `baskets[${i}]`;
        if (!isRecord(b)) return fail('invalid', path);
        const bk = exactKeys(b, ['id', 'name', 'symbols'], path);
        if (bk) return bk;
        if (b.id !== basketId(i) || !validTitle(b.name)) return fail('invalid', path);
        const s = b.symbols;
        if (!Array.isArray(s) || s.length === 0 || s.length > 300 || s.some((x) => typeof x !== 'string' || !SYMBOL_RE.test(x)) || new Set(s).size !== s.length)
          return fail('invalid', `${path}.symbols`);
        ids.push(b.id);
      }
      const c = raw.criteria;
      if (!isRecord(c) || c.id !== SHARED_ID || c.name !== raw.title || c.updatedAt !== 0) return fail('invalid', 'criteria');
      const cleaned = sanitizeCriteria({ criteria: [c] }, now).criteria[0];
      const diff = sameAs(c, cleaned, 'criteria');
      if (diff) return diff;
      const sc = c as unknown as SelectionCriteria;
      if (sc.pool.baskets.some((id) => !ids.includes(id))) return fail('reference', 'criteria.pool.baskets');
      if (sc.conditions.rebound.pattern.from !== 'custom') return fail('reference', 'criteria.conditions.rebound.pattern');
      if (sc.trading.strategyId !== null) return fail('reference', 'criteria.trading.strategyId');
      return { ok: true, snapshot: raw as unknown as CriteriaSnapshot };
    }
    default:
      return fail('invalid', 'kind');
  }
}
