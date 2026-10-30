// 받은 공유를 이 프로필에 새로 만드는 계획과 적용(설계 4.8). 순수 함수다: 저장은 ImportHost가 app.set*으로 한다.
import { withNewGroup } from '../../sheets/groupImport';
import { BASKET_CAP_MESSAGE, MAX_BASKETS, newBasket, sanitizeBaskets, type Basket } from '../screen/baskets';
import { CRITERIA_CAP_MESSAGE } from '../screen/criteriaStore';
import { MAX_CRITERIA } from '../screen/defaults';
import type { SelectionCriteria } from '../screen/types';
import { sanitizeCriteria } from '../screen/validate';
import { MAX_STRATEGIES } from '../sim/defaults';
import { STRATEGY_CAP_MESSAGE } from '../sim/strategyStore';
import type { Strategy } from '../sim/types';
import { sanitizeStrategies } from '../sim/validate';
import type { Route } from '../state/routes';
import type { Settings, Watchlists } from '../state/schema';
import { MAX_ITEMS } from '../state/watchlist';
import { jsonDiff } from '../sync/forbidden';
import type { ShareKind } from './kinds';
import type { ImportSnapshot } from './pendingImport';
import { cutUtf16, type CompareSnapshot, type CriteriaSnapshot } from './snapshot';

export const IMPORT_NAME_MAX = 30;
const UNREADABLE = '가져올 수 없는 공유예요';

export interface ImportState {
  watchlists: Watchlists;
  strategies: Strategy[];
  criteria: SelectionCriteria[];
  baskets: Basket[];
  /** 앱 종목 코드. 받지 못했으면 null(그때는 거르지 않는다) */
  universe: ReadonlySet<string> | null;
}
export interface ImportPlan {
  /** 만들 것 한 줄씩(바뀐 이름으로) */
  lines: string[];
  /** 이름 변경·자르기·뺀 종목·자금·결과 안내 */
  notes: string[];
  /** 저장할 수 없는 이유. 있으면 저장 단추를 끈다 */
  blocked: string | null;
  /** compare만: 적용할 수 있는 보기 설정 */
  view: CompareSnapshot['view'] | null;
}
export interface ImportApplied {
  /** 실제 저장한 이름. 기준은 기준 이름 다음에 새 묶음 이름들을 순서대로 둔다 */
  names: string[];
  watchlists?: Watchlists;
  strategies?: Strategy[];
  criteria?: SelectionCriteria[];
  baskets?: Basket[];
  settings?: Partial<Pick<Settings, 'period' | 'metric' | 'benchmark' | 'boardOrder'>>;
  route: Route;
}
/** 대기 값(PendingImport)의 snapshot·from. from은 확인 창 안내에만 쓴다 */
export interface ImportInput {
  snapshot: ImportSnapshot;
  from: ShareKind;
}

function baseName(x: string, max = IMPORT_NAME_MAX): string {
  return cutUtf16(x.trim(), max).trim() || '공유';
}

/**
 * base가 taken에 없으면 그대로, 있으면 ` 2`, ` 3`…을 붙인다. 붙인 결과가 max(UTF-16 길이, 저장 검사와 같은 기준)를 넘으면
 * 이름 끝을 잘라 맞추되 서로게이트 쌍을 반으로 자르지 않는다.
 */
export function uniqueName(base: string, taken: ReadonlySet<string>, max = IMPORT_NAME_MAX): string {
  const b = baseName(base, max);
  if (!taken.has(b)) return b;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const name = cutUtf16(b, max - suffix.length).trimEnd() + suffix;
    if (!taken.has(name)) return name;
  }
}

/**
 * 한글 음절과 숫자로 끝나는 이름만 발음에 맞춰 「이름」로/으로를 붙이고, 그 밖의 글자는 '로'로 둔다.
 * 충돌로 바뀐 이름은 늘 숫자로 끝난다.
 */
export function withRo(name: string): string {
  const last = name.at(-1) ?? '';
  const code = last.charCodeAt(0);
  let particle = '로';
  if (code >= 0xac00 && code <= 0xd7a3) {
    const jong = (code - 0xac00) % 28;
    if (jong !== 0 && jong !== 8) particle = '으로'; // 받침 없음·ㄹ은 로
  } else if (last === '0' || last === '3' || last === '6') {
    particle = '으로';
  }
  return `「${name}」${particle}`;
}

const namesOf = (list: readonly { name: string }[]) => new Set(list.map((x) => x.name.trim()));

/** 종목 목록으로 거르고(null이면 거르지 않음) 앞에서 MAX_ITEMS개 */
function groupSymbols(symbols: readonly string[], universe: ReadonlySet<string> | null) {
  const known = universe ? symbols.filter((s) => universe.has(s)) : [...symbols];
  return { symbols: known.slice(0, MAX_ITEMS), unknown: symbols.length - known.length, cut: known.length > MAX_ITEMS };
}

/** 한 번의 가져오기로 만드는 묶음끼리도 겹치지 않게 차례로 taken에 더한다 */
function basketNames(s: CriteriaSnapshot, cur: ImportState): string[] {
  const taken = new Set(namesOf(cur.baskets));
  return s.baskets.map((b) => {
    const name = uniqueName(b.name, taken);
    taken.add(name);
    return name;
  });
}

const changed = (a: unknown, b: unknown) => b === undefined || jsonDiff(a, b) !== null;

export function planImport(p: ImportInput, cur: ImportState): ImportPlan {
  const s = p.snapshot;
  const lines: string[] = [];
  const notes: string[] = [];
  let blocked: string | null = null;
  let view: ImportPlan['view'] = null;
  const renamed = (base: string, name: string) => {
    if (name !== baseName(base)) notes.push(`같은 이름이 있어 ${withRo(name)} 저장해요`);
  };
  switch (s.kind) {
    case 'group':
    case 'compare': {
      const g = groupSymbols(s.symbols, cur.universe);
      if (g.symbols.length === 0) blocked = '가져올 수 있는 종목이 없어요';
      const name = uniqueName(s.title, namesOf(cur.watchlists.groups));
      lines.push(`그룹 「${name}」 · 종목 ${g.symbols.length}개`);
      renamed(s.title, name);
      if (g.unknown > 0) notes.push(`종목 목록에 없는 종목 ${g.unknown}개는 뺐어요`);
      if (g.cut) notes.push(`상위 ${MAX_ITEMS}개만 넣었어요`);
      if (s.kind === 'compare') view = { ...s.view, period: { ...s.view.period } };
      break;
    }
    case 'strategy': {
      const name = uniqueName(s.title, namesOf(cur.strategies));
      if (cur.strategies.length >= MAX_STRATEGIES) blocked = STRATEGY_CAP_MESSAGE;
      const next = { ...s.strategy, name };
      if (!blocked && changed(next, sanitizeStrategies({ strategies: [next] }, 0).strategies[0])) blocked = UNREADABLE;
      lines.push(`전략 「${name}」`);
      renamed(s.title, name);
      if (s.capitalHidden) notes.push('초기 자금은 기본값으로 저장해요');
      break;
    }
    case 'criteria': {
      const name = uniqueName(s.title, namesOf(cur.criteria));
      const bn = basketNames(s, cur);
      if (cur.criteria.length >= MAX_CRITERIA) blocked = CRITERIA_CAP_MESSAGE;
      else if (cur.baskets.length + s.baskets.length > MAX_BASKETS) blocked = BASKET_CAP_MESSAGE;
      if (!blocked) {
        const next = { ...s.criteria, name };
        const bs = s.baskets.map((b, i) => ({ id: b.id, name: bn[i], updatedAt: 0, symbols: b.symbols }));
        if (changed(next, sanitizeCriteria({ criteria: [next] }, 0).criteria[0]) || sanitizeBaskets({ baskets: bs }).repaired) blocked = UNREADABLE;
      }
      lines.push(s.baskets.length ? `선정 기준 「${name}」 · 묶음 ${s.baskets.length}개` : `선정 기준 「${name}」`);
      renamed(s.title, name);
      s.baskets.forEach((b, i) => renamed(b.name, bn[i]));
      if (s.capitalHidden) notes.push('초기 자금은 기본값으로 저장해요');
      break;
    }
  }
  if (p.from === 'validation') notes.push('② 매매 규칙은 함께 오지 않아요. 저장한 뒤 매매 규칙을 골라 주세요');
  if (p.from === 'simResult' || p.from === 'validation') notes.push('결과는 저장하지 않아요. 저장한 뒤 실행하면 내 데이터로 다시 계산해요');
  return { lines, notes: [...new Set(notes)], blocked, view };
}

/**
 * planImport가 막지 않은 경우에만 부른다. 막힌 계획이면 던진다. 늘 새로 만들고 기존 것을 덮어쓰지 않는다.
 * 확인 창이 떠 있는 동안 다른 탭이 같은 이름을 더할 수 있어 저장 시점 cur로 이름을 다시 계산한다.
 * 실제 저장한 이름은 ImportApplied.names로 돌려준다.
 */
export function applyImport(p: ImportInput, cur: ImportState, opts: { now: number; applyView: boolean }): ImportApplied {
  const plan = planImport(p, cur);
  if (plan.blocked) throw new Error(plan.blocked);
  const s = p.snapshot;
  switch (s.kind) {
    case 'group':
    case 'compare': {
      const { symbols } = groupSymbols(s.symbols, cur.universe);
      const { watchlists, groupId } = withNewGroup(cur.watchlists, uniqueName(s.title, namesOf(cur.watchlists.groups)), symbols, opts.now);
      const settings = s.kind === 'compare' && opts.applyView ? { ...s.view, period: { ...s.view.period } } : undefined;
      return { watchlists, names: [watchlists.groups.find((g) => g.id === groupId)!.name], ...(settings && { settings }), route: { name: 'compare', groupId } };
    }
    case 'strategy': {
      const strategy: Strategy = { ...structuredClone(s.strategy), id: crypto.randomUUID(), name: uniqueName(s.title, namesOf(cur.strategies)), updatedAt: opts.now };
      return { strategies: [...cur.strategies, strategy], names: [strategy.name], route: { name: 'simulate', strategyId: strategy.id } };
    }
    case 'criteria': {
      const bn = basketNames(s, cur);
      const ids = new Map<string, string>();
      const baskets = s.baskets.map((b, i) => {
        const made = newBasket(opts.now, bn[i], [...b.symbols]);
        ids.set(b.id, made.id);
        return made;
      });
      const c = structuredClone(s.criteria);
      const criteria: SelectionCriteria = {
        ...c,
        id: crypto.randomUUID(),
        name: uniqueName(s.title, namesOf(cur.criteria)),
        updatedAt: opts.now,
        pool: { ...c.pool, baskets: c.pool.baskets.map((id) => ids.get(id)!) },
      };
      return { baskets: [...cur.baskets, ...baskets], criteria: [...cur.criteria, criteria], names: [criteria.name, ...baskets.map((b) => b.name)], route: { name: 'simulate', tab: 'criteria', criteriaId: criteria.id } };
    }
  }
}
