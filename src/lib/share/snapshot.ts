// 읽기 전용 공유 스냅샷(제안서 6절, 확장 설계 2절). exportData()를 재사용하지 않고 필요한 필드만 새로 만든다.
// 원본 객체 ID·프로필 이름·키·계좌·프록시·최근 종목은 넣지 않는다. 다른 객체 참조(그룹·전략·바구니)는 스냅샷 안에서 풀어 넣는다.
// sync-worker가 같은 검사 함수를 쓴다(DOM·저장소 의존 금지).
import { newCriteria } from '../screen/defaults';
import type { Market, SelectionCriteria } from '../screen/types';
import type { NotBoughtReason } from '../screen/holdSelection';
import type { ByMarketKey, MissingReason, ValidationNote } from '../screen/runValidation';
import { sanitizeCriteria } from '../screen/validate';
import type { Basket } from '../screen/baskets';
import { newStrategy } from '../sim/defaults';
import type { SimResult, Skip, Strategy, Trade } from '../sim/types';
import type { SimFailureReason } from '../sim/loadSimData';
import { resolveSymbols, sanitizeStrategies } from '../sim/validate';
import type { Group, Settings, Watchlists } from '../state/schema';
import { SETTING_OK } from '../sync/dto';
import { exceedsDepth, findForbidden, jsonBytes, jsonDiff } from '../sync/forbidden';
import { isShareKind } from './kinds';
import { SHARE_SYMBOL_RE } from './resultEnums';
import { checkRun, checkSimResult, checkValidation, type ResultFail } from './checkResult';

export type { ShareKind } from './kinds';

export const SHARE_VERSION = 1;
/** 제안서 7절: 공유 스냅샷 100 KiB. */
export const SHARE_MAX_BYTES = 100 * 1024;
export const SHARE_TITLE_MAX = 30;
export const SHARE_GROUP_MAX = 50;
/** 그룹 한 개의 종목 한도(MAX_ITEMS)와 같다. watchlist.ts를 Worker 번들에 끌어오지 않으려고 따로 둔다(테스트가 같은지 확인한다). */
export const COMPARE_SYMBOLS_MAX = 10;
export const SHARE_TTL_DEFAULT_DAYS = 7;
export const SHARE_TTL_MAX_DAYS = 30;
/** 공유 안에서 쓰는 고정 ID. 원본 ID를 옮기지 않는다. */
export const SHARED_ID = 'shared';
/** 앱 묶음 규칙(src/lib/screen/baskets.ts)과 같은 6자리. 묶음에는 ETN을 받지 않는다(설계 2.7). */
export const BASKET_SYMBOL_RE = /^[0-9A-Z]{6}$/;

/** create: 서버 저장·만든 쪽 보내기 전(엄격). read: 받은 화면·가져오기 대기 값(전략·기준의 빠진 필드를 기본값으로 채움). */
export type CheckMode = 'create' | 'read';

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

export interface CompareSnapshot {
  kind: 'compare';
  v: 1;
  title: string;
  /** 보이는 종목만, 그룹 순서. 1~10개(MAX_ITEMS) */
  symbols: string[];
  view: {
    period: Settings['period'];
    metric: Settings['metric'];
    benchmark: Settings['benchmark'];
    boardOrder: Settings['boardOrder'];
  };
}

/** 공유 날짜 축. offsets는 start(KST YYYY-MM-DD)로부터 지난 달력 일수. offsets[0] = 0, 엄격히 오름차순 */
export interface ShareAxis {
  start: string;
  offsets: number[];
}
/** 곡선을 솎았으면 솎기 전 점 수. 솎지 않았으면 null */
export type ShareSampled = { from: number } | null;

/** 결과를 만든 실행. 받은 화면 머리줄(기간 · 시세 출처 · 받은 시각 · 데모 배지)에 쓴다 */
export interface ShareRun {
  /** 실제 계산 축의 첫날·마지막 날(KST YYYY-MM-DD) */
  from: string;
  to: string;
  /** 시세 출처 라벨. 시뮬레이션은 DoneMeta.venueLabel, 검증은 '시장 데이터 파일'. 30자 이내 */
  source: string;
  /** 시뮬레이션은 DoneMeta.demo. 검증은 늘 false(아래 설명) */
  demo: boolean;
  /** 시세를 받은 시각(검증은 시장 파일 수집 시각), epoch ms */
  fetchedAt: number;
}

export interface SimResultSnapshot {
  kind: 'simResult';
  v: 1;
  title: string;
  /** strategySnapshot 규칙: id 'shared', name = title, updatedAt 0. universe는 실행한 종목(DoneMeta.symbols, 요청 순서) */
  strategy: Strategy;
  /** true면 strategy.capital.initial은 기본값이고, 결과의 원 단위 금액·수량은 들어 있지 않다 */
  capitalHidden: boolean;
  run: ShareRun;
  result: SharedSimResult;
}

export interface SharedSimResult {
  axis: ShareAxis;
  sampled: ShareSampled;
  /** 초기 자금 대비 수익률(%). 길이는 axis.offsets와 같다. 지수·지정 종목이 없으면 null, 그날 값이 없으면 원소가 null */
  curves: {
    strategy: number[];
    hold: number[];
    index: (number | null)[] | null;
    benchmark: (number | null)[] | null;
  };
  /** 반올림만 한 원본 요약·비교 값(곡선을 솎아도 이 값은 전체 기간으로 계산한 것이다) */
  summary: SimResult['summary'];
  benchmarks: SimResult['benchmarks'];
  indexFailed: null | '받지 못했어요' | '기간 일부만 받았어요';
  benchmarkFailed: boolean;
  /** 거래·종목별·건너뜀 행의 종목 위치가 가리키는 코드. 실행한 종목(DoneMeta.symbols)이고 strategy.universe.symbols와 같다 */
  symbols: string[];
  trades: SharedTrade[];
  perSymbol: SharedPerSymbol[];
  skipped: {
    /** 이유별 개수(늘 있다). SKIP_REASONS 순서 */
    counts: [reason: Skip['reason'], n: number][];
    /** 목록. 크기를 줄일 때 null이 된다(3.4) */
    rows: [day: number, symbol: number, reason: number][] | null;
  };
  nearMiss: SimResult['nearMiss'];
  /** 받지 못한 종목(종목별 탭 안내). symbols의 부분 집합이고 perSymbol과 겹치지 않는다. perSymbol ∪ failed = symbols */
  failed: { symbol: string; reason: SimFailureReason }[];
}

/**
 * 거래 한 줄. day는 axis.start로부터의 달력 일수, symbol은 symbols의 위치.
 * 자금 숨김이면 qty는 null(가격은 시세라 남긴다, 사용자 결정 6). 수수료·세금은 받은 화면에 보이지 않아 늘 뺀다.
 * 매수 줄의 pattern은 거래 차트 시트에만 쓰여 뺀다.
 */
export type SharedTrade = [
  day: number,
  symbol: number,
  kind: Trade['kind'],
  stage: number | null,
  price: number,
  qty: number | null,
  reason: string,
  pnlPct: number | null,
];

/** pnl은 원(자금 숨김이면 null), pnlPct는 초기 자금 대비 %(늘 있다). firstDay는 axis 기준 일수 */
export type SharedPerSymbol = [symbol: number, pnl: number | null, pnlPct: number, roundTrips: number, firstDay: number | null];

export interface ValidationSnapshot {
  kind: 'validation';
  v: 1;
  title: string;
  /** criteriaSnapshot 규칙(묶음 b0…, 반등 패턴 직접 정함, trading.strategyId null). 실행할 때의 기준이다 */
  criteria: SelectionCriteria;
  baskets: { id: string; name: string; symbols: string[] }[];
  capitalHidden: boolean;
  run: ShareRun;
  result: SharedValidation;
}

/** 소수 둘째 자리 */
export interface SharedStats {
  totalPct: number;
  cagrPct: number;
  mddPct: number;
  volPct: number;
}

export interface SharedValidation {
  axis: ShareAxis;
  sampled: ShareSampled;
  /** 곡선은 시작 자본 대비 수익률(%). 길이는 axis.offsets와 같다 */
  hold: { curve: number[]; stats: SharedStats; beat: { beat: number; total: number } | null };
  trading: { curve: number[]; stats: SharedStats; trades: number; skipCounts: [reason: Skip['reason'], n: number][] } | null;
  indices: { id: Market; curve: number[] | null; reason: MissingReason | null; stats: SharedStats | null }[];
  benchmarks: { symbol: string; name: string; curve: number[] | null; reason: MissingReason | null; stats: SharedStats | null }[];
  byMarket: { key: ByMarketKey; inPool: boolean; stats: SharedStats; avgPicked: number }[];
  /** 선정 이력을 얼마나 담았나: 전부 / 조건 계산값 뺌 / 종목 코드만 */
  history: 'full' | 'noValues' | 'codes';
  /** ValuePairs의 키 위치가 가리키는 이름(선정 이력·오늘 선정 공용). VALUE_KEYS에 있는 이름만, 서로 다르게 */
  valueKeys: string[];
  rebalances: SharedRebalance[];
  /** 오늘 기준 선별은 늘 조건 계산값까지 담는다(많아야 30종목) */
  today: { date: string; passed: number; picks: { symbol: string; values: ValuePairs }[] };
  notes: ValidationNote[];
}

/** [키 위치, 값, 키 위치, 값, …]. 키가 없는 값은 쌍을 두지 않는다(`k in values` 판단이 그대로 맞는다) */
export type ValuePairs = (number | boolean | null)[];

export interface SharedRebalance {
  /** 재선정일, axis.start로부터의 일수 */
  day: number;
  passed: number;
  /** history가 'codes'면 종목 코드 배열, 아니면 SharedPick 배열 */
  picks: SharedPick[] | string[];
}

/**
 * 선정 종목 한 줄. retPct는 그 구간 수익률(%).
 * mark: 0 표시 없음, 1 마지막 종가에 판 것으로 셈(soldAtLastClose), 문자열이면 사지 못한 이유(notBought).
 * values는 history가 'noValues'면 null
 */
export type SharedPick = [symbol: string, retPct: number | null, mark: 0 | 1 | NotBoughtReason, values: ValuePairs | null];

export type ShareSnapshot = GroupSnapshot | StrategySnapshot | CriteriaSnapshot | CompareSnapshot | SimResultSnapshot | ValidationSnapshot;

export type ShareError = 'invalid' | 'unknown-field' | 'forbidden-field' | 'too-large' | 'reference' | 'unsupported';
export type ShareCheck = { ok: true; snapshot: ShareSnapshot } | { ok: false; code: ShareError; path?: string };
type PartFail = { ok: false; code: ShareError; path?: string };

/** 결과 스냅샷을 줄인 단계(설계 3.4) */
export type ShareReduction = 'skipped-counts' | 'no-values' | 'codes-only' | 'thinned';
export type ShareBuild<S extends ShareSnapshot = ShareSnapshot> =
  | { ok: true; snapshot: S; reduced: ShareReduction[] }
  | { ok: false; code: 'too-large'; bytes: number }
  | { ok: false; code: 'invalid'; path?: string };
/** 줄일 일이 없는 종류(group·strategy·criteria·compare)의 만들기 결과 */
export const built = <S extends ShareSnapshot>(snapshot: S): ShareBuild<S> => ({ ok: true, snapshot, reduced: [] });

type Row = Record<string, unknown>;
const isRecord = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);
const isShareSymbol = (x: unknown): x is string => typeof x === 'string' && SHARE_SYMBOL_RE.test(x);
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const basketId = (i: number) => `b${i}`;

/** UTF-16 길이 max로 자른다. 끝이 서로게이트 쌍의 앞쪽이면 그것도 뺀다(쌍을 반으로 자르지 않는다). */
export function cutUtf16(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/** 저장 검사(raw.name.length > NAME_MAX)와 같은 UTF-16 기준(설계 4.8) */
export function shareTitle(name: string): string {
  return cutUtf16(name.trim(), SHARE_TITLE_MAX).trim() || '공유';
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

const fail = (code: ShareError, path?: string): PartFail => (path === undefined ? { ok: false, code } : { ok: false, code, path });

const failOf = (r: ResultFail): PartFail => fail(r.code, r.path);

function exactKeys(v: Row, keys: string[], path: string): PartFail | null {
  for (const k of Object.keys(v)) if (!keys.includes(k)) return fail('unknown-field', path ? `${path}.${k}` : k);
  for (const k of keys) if (!Object.hasOwn(v, k)) return fail('invalid', path ? `${path}.${k}` : k);
  return null;
}

/** create는 UTF-16 30 이내. read는 code point 30 이내도 받는다(지금 만드는 쪽이 code point로 잰 옛 공유, 설계 2.7). */
const validTitle = (t: unknown, mode: CheckMode): t is string =>
  typeof t === 'string' && t !== '' && t === t.trim() && (t.length <= SHARE_TITLE_MAX || (mode === 'read' && [...t].length <= SHARE_TITLE_MAX));

function sameAs(input: unknown, cleaned: unknown, path: string, mode: CheckMode): PartFail | null {
  const d = jsonDiff(input, cleaned, path, { ignoreMissing: mode === 'read' });
  return d ? fail(d.kind === 'extra' ? 'unknown-field' : 'invalid', d.path) : null;
}

const symbolsOk = (s: unknown, min: number, max: number, re: (x: unknown) => boolean = isShareSymbol): s is string[] =>
  Array.isArray(s) && s.length >= min && s.length <= max && s.every(re) && new Set(s).size === s.length;

/** 전략 부분(strategy·simResult). 돌려주는 strategy는 정리 결과(read면 빠진 필드를 채운 값)다. */
export function checkStrategyPart(s: unknown, title: string, now: number, mode: CheckMode): { ok: true; strategy: Strategy } | PartFail {
  if (!isRecord(s) || s.id !== SHARED_ID || s.name !== title || s.updatedAt !== 0) return fail('invalid', 'strategy');
  if (!isRecord(s.universe) || s.universe.kind !== 'symbols') return fail('reference', 'strategy.universe');
  const cleaned = sanitizeStrategies({ strategies: [s] }, now).strategies[0];
  if (!cleaned) return fail('invalid', 'strategy');
  const diff = sameAs(s, cleaned, 'strategy', mode);
  if (diff) return diff;
  // 가져오면 받은 사람 키로 보내는 시세 요청에 들어가는 값이라 공유 경로에서만 코드 모양을 본다(정리 함수는 바꾸지 않는다)
  const u = cleaned.universe;
  if (u.kind !== 'symbols' || !symbolsOk(u.symbols, 0, Infinity)) return fail('invalid', 'strategy.universe.symbols');
  if (cleaned.benchmarks.symbol !== null && !isShareSymbol(cleaned.benchmarks.symbol)) return fail('invalid', 'strategy.benchmarks.symbol');
  return { ok: true, strategy: cleaned };
}

/** 기준 부분(criteria·validation): raw의 criteria·baskets·title을 본다. */
export function checkCriteriaPart(
  raw: Row,
  now: number,
  mode: CheckMode,
): { ok: true; criteria: SelectionCriteria; baskets: CriteriaSnapshot['baskets'] } | PartFail {
  if (!Array.isArray(raw.baskets) || raw.baskets.length > 30) return fail('invalid', 'baskets');
  const ids: string[] = [];
  for (const [i, b] of raw.baskets.entries()) {
    const path = `baskets[${i}]`;
    if (!isRecord(b)) return fail('invalid', path);
    const bk = exactKeys(b, ['id', 'name', 'symbols'], path);
    if (bk) return bk;
    if (b.id !== basketId(i) || !validTitle(b.name, mode)) return fail('invalid', path);
    if (!symbolsOk(b.symbols, 1, 300, (x) => typeof x === 'string' && BASKET_SYMBOL_RE.test(x))) return fail('invalid', `${path}.symbols`);
    ids.push(b.id);
  }
  const c = raw.criteria;
  if (!isRecord(c) || c.id !== SHARED_ID || c.name !== raw.title || c.updatedAt !== 0) return fail('invalid', 'criteria');
  const cleaned = sanitizeCriteria({ criteria: [c] }, now).criteria[0];
  if (!cleaned) return fail('invalid', 'criteria');
  const diff = sameAs(c, cleaned, 'criteria', mode);
  if (diff) return diff;
  if (cleaned.pool.baskets.some((id) => !ids.includes(id))) return fail('reference', 'criteria.pool.baskets');
  if (cleaned.conditions.rebound.pattern.from !== 'custom') return fail('reference', 'criteria.conditions.rebound.pattern');
  if (cleaned.trading.strategyId !== null) return fail('reference', 'criteria.trading.strategyId');
  if (!symbolsOk(cleaned.benchmarks.symbols, 0, Infinity)) return fail('invalid', 'criteria.benchmarks.symbols');
  return { ok: true, criteria: cleaned, baskets: raw.baskets as CriteriaSnapshot['baskets'] };
}

/**
 * 스냅샷을 검사한다. 깊이 → 금지 키 → 크기 → 원본 ID 모양(UUID) → kind·v·title → 종류별 필드 순서. 고칠 것이 있으면 거절한다.
 * kind는 요청의 kind와 같아야 한다. read 모드는 전략·기준의 빠진 필드만 기본값으로 채워 받고, 돌려주는 snapshot은 채운 값이다.
 */
export function checkShareSnapshot(raw: unknown, kind: unknown, now = Date.now(), mode: CheckMode = 'create'): ShareCheck {
  if (!isRecord(raw)) return fail('invalid');
  if (exceedsDepth(raw)) return fail('invalid');
  const forbidden = findForbidden(raw);
  if (forbidden) return fail('forbidden-field', forbidden);
  if (jsonBytes(raw) > SHARE_MAX_BYTES) return fail('too-large');
  if (UUID_RE.test(JSON.stringify(raw))) return fail('reference');
  if (raw.kind !== kind) return fail('invalid', 'kind');
  if (!isShareKind(raw.kind)) return typeof raw.kind === 'string' ? fail('unsupported', 'kind') : fail('invalid', 'kind');
  if (raw.v !== SHARE_VERSION) return fail('invalid', 'v');
  if (!validTitle(raw.title, mode)) return fail('invalid', 'title');

  switch (raw.kind) {
    case 'group': {
      const k = exactKeys(raw, ['kind', 'v', 'title', 'symbols'], '');
      if (k) return k;
      if (!symbolsOk(raw.symbols, 0, SHARE_GROUP_MAX)) return fail('invalid', 'symbols');
      return { ok: true, snapshot: raw as unknown as GroupSnapshot };
    }
    case 'strategy': {
      const k = exactKeys(raw, ['kind', 'v', 'title', 'strategy', 'capitalHidden'], '');
      if (k) return k;
      if (typeof raw.capitalHidden !== 'boolean') return fail('invalid', 'capitalHidden');
      const st = checkStrategyPart(raw.strategy, raw.title, now, mode);
      if (!st.ok) return st;
      return { ok: true, snapshot: { ...raw, strategy: st.strategy } as unknown as StrategySnapshot };
    }
    case 'criteria': {
      const k = exactKeys(raw, ['kind', 'v', 'title', 'criteria', 'baskets', 'capitalHidden'], '');
      if (k) return k;
      if (typeof raw.capitalHidden !== 'boolean') return fail('invalid', 'capitalHidden');
      const cr = checkCriteriaPart(raw, now, mode);
      if (!cr.ok) return cr;
      return { ok: true, snapshot: { ...raw, criteria: cr.criteria } as unknown as CriteriaSnapshot };
    }
    case 'compare': {
      const k = exactKeys(raw, ['kind', 'v', 'title', 'symbols', 'view'], '');
      if (k) return k;
      if (!symbolsOk(raw.symbols, 1, COMPARE_SYMBOLS_MAX)) return fail('invalid', 'symbols');
      if (!isRecord(raw.view)) return fail('invalid', 'view');
      const vk = exactKeys(raw.view, ['period', 'metric', 'benchmark', 'boardOrder'], 'view');
      if (vk) return vk;
      for (const key of ['period', 'metric', 'benchmark', 'boardOrder'] as const) if (!SETTING_OK[key](raw.view[key])) return fail('invalid', `view.${key}`);
      return { ok: true, snapshot: raw as unknown as CompareSnapshot };
    }
    case 'simResult': {
      const k = exactKeys(raw, ['kind', 'v', 'title', 'strategy', 'capitalHidden', 'run', 'result'], '');
      if (k) return k;
      if (typeof raw.capitalHidden !== 'boolean') return fail('invalid', 'capitalHidden');
      const st = checkStrategyPart(raw.strategy, raw.title, now, mode);
      if (!st.ok) return st;
      const universe = st.strategy.universe.kind === 'symbols' ? st.strategy.universe.symbols : [];
      const r = checkSimResult(raw.result, { universe, capitalHidden: raw.capitalHidden });
      if (r) return failOf(r);
      const run = checkRun(raw.run, (raw.result as SharedSimResult).axis);
      if (run) return failOf(run);
      return { ok: true, snapshot: { ...raw, strategy: st.strategy } as unknown as SimResultSnapshot };
    }
    case 'validation': {
      const k = exactKeys(raw, ['kind', 'v', 'title', 'criteria', 'baskets', 'capitalHidden', 'run', 'result'], '');
      if (k) return k;
      if (typeof raw.capitalHidden !== 'boolean') return fail('invalid', 'capitalHidden');
      const cr = checkCriteriaPart(raw, now, mode);
      if (!cr.ok) return cr;
      const r = checkValidation(raw.result, { indices: cr.criteria.benchmarks.indices, benchSymbols: cr.criteria.benchmarks.symbols });
      if (r) return failOf(r);
      const run = checkRun(raw.run, (raw.result as SharedValidation).axis);
      if (run) return failOf(run);
      return { ok: true, snapshot: { ...raw, criteria: cr.criteria } as unknown as ValidationSnapshot };
    }
    default:
      return fail('unsupported', 'kind');
  }
}
