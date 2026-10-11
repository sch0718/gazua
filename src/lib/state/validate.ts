// 저장된·가져온 설정과 관심종목의 검증. 가져오기(exportImport)와 저장소 읽기(profileStore)가 함께 쓴다.
import { PERIOD_COUNTS } from '../market/periods';
import { normalizeProxyUrl } from '../ui/settings/connection';
import { DEFAULT_SETTINGS, type Group, type PeriodUnit, type Settings, type WatchItem, type Watchlists } from './schema';

type Row = Record<string, unknown>;
const isRecord = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';

const ENUMS: Partial<Record<keyof Settings, readonly unknown[]>> = {
  provider: ['kis', 'toss', 'demo'],
  venueMode: ['AUTO', 'KRX', 'NXT', 'UNIFIED'],
  metric: ['change', 'drawdown', 'excess', 'rvol', 'mcap', 'volatility', 'rsi'],
  benchmark: ['AUTO', 'KOSPI', 'KOSDAQ'],
  theme: ['system', 'light', 'dark'],
  colorConvention: ['kr', 'global'],
};

function validField(key: keyof Settings, v: unknown): boolean {
  const allowed = ENUMS[key];
  if (allowed) return allowed.includes(v);
  switch (key) {
    case 'proxyUrl':
      return isString(v) && normalizeProxyUrl(v).ok;
    case 'period':
      // 고를 수 있는 기간만(D1, W1–4, M1–6, Y1). 그 밖의 값이면 `[` `]` 단축키가 멈춘다.
      return (
        isRecord(v) &&
        Object.hasOwn(PERIOD_COUNTS, v.unit as string) &&
        PERIOD_COUNTS[v.unit as PeriodUnit].includes(v.n as number)
      );
    case 'lastGroupId':
      return v === null || isString(v);
    case 'onboarded':
    case 'keyLock':
      return typeof v === 'boolean';
    default:
      return false;
  }
}

/**
 * 아는 필드만, 값이 맞을 때만 쓴다. 빠진 필드는 기본값(오래된 저장 형식). keyLock은 호출한 쪽이 정한다.
 * invalid: 있었지만 맞지 않아 기본값으로 바꾼 필드.
 */
export function sanitizeSettings(raw: Row, keyLock: boolean): { settings: Settings; invalid: (keyof Settings)[] } {
  const out: Settings = { ...DEFAULT_SETTINGS };
  const invalid: (keyof Settings)[] = [];
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (key === 'keyLock' || !(key in raw)) continue;
    if (validField(key, raw[key])) (out as unknown as Row)[key] = raw[key];
    else invalid.push(key);
  }
  out.keyLock = keyLock;
  const url = normalizeProxyUrl(out.proxyUrl);
  out.proxyUrl = url.ok ? url.url : '';
  return { settings: out, invalid };
}

function validItem(v: unknown): v is WatchItem {
  return (
    isRecord(v) &&
    isString(v.symbol) &&
    typeof v.colorSlot === 'number' &&
    Number.isInteger(v.colorSlot) &&
    v.colorSlot >= 1 &&
    v.colorSlot <= 8 &&
    typeof v.hidden === 'boolean' &&
    typeof v.addedAt === 'number'
  );
}

/**
 * 맞는 그룹·종목만 남긴다: 그룹 id는 겹치지 않고, 한 그룹 안에서 종목과 색 슬롯은 겹치지 않으며 8개까지.
 * repaired: 무언가를 버렸다. 모양부터 틀리면(groups 배열 없음) null.
 */
export function sanitizeWatchlists(v: unknown): { watchlists: Watchlists; repaired: boolean } | null {
  if (!isRecord(v) || !Array.isArray(v.groups)) return null;
  let repaired = false;
  const ids = new Set<string>();
  const groups: Group[] = [];
  for (const g of v.groups) {
    if (!isRecord(g) || !isString(g.id) || g.id === '' || !isString(g.name) || !Array.isArray(g.items) || ids.has(g.id)) {
      repaired = true;
      continue;
    }
    ids.add(g.id);
    const symbols = new Set<string>();
    const slots = new Set<number>();
    const items: WatchItem[] = [];
    for (const i of g.items) {
      if (!validItem(i) || symbols.has(i.symbol) || slots.has(i.colorSlot) || items.length >= 8) {
        repaired = true;
        continue;
      }
      symbols.add(i.symbol);
      slots.add(i.colorSlot);
      items.push({ symbol: i.symbol, colorSlot: i.colorSlot, hidden: i.hidden, addedAt: i.addedAt });
    }
    groups.push({ id: g.id, name: g.name, items });
  }
  return { watchlists: { groups }, repaired };
}

/** 가져오기: 하나라도 틀리면 받지 않는다. */
export function validWatchlists(v: unknown): Watchlists | null {
  const r = sanitizeWatchlists(v);
  return r && !r.repaired ? r.watchlists : null;
}
