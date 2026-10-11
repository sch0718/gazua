// 프로필 데이터 내보내기·가져오기(스펙 7.4 데이터). 토큰은 절대 넣지 않는다. 키는 요청할 때만 저장된 형태 그대로 넣는다.
import { loadRecent, loadSettings, loadWatchlists, profileKeys, RECENT_MAX } from './profileStore';
import {
  DEFAULT_PROFILE_NAME,
  DEFAULT_SETTINGS,
  META_KEY,
  loadMeta,
  type Group,
  type Meta,
  type Settings,
  type WatchItem,
  type Watchlists,
} from './schema';
import { isLocked, type LockedSecrets, type Secrets } from './secrets';
import type { SafeStorage } from './storage';
import { kstDate } from '../time/kst';

export const EXPORT_FORMAT = 'gazua-export';
export const EXPORT_SCHEMA_VERSION = 1;
export const IMPORT_BAD_FORMAT = '파일 형식이 맞지 않아요';
export const IMPORT_BAD_VERSION = '지원하지 않는 버전이에요';

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  schemaVersion: typeof EXPORT_SCHEMA_VERSION;
  profile: { name: string };
  settings: Settings;
  watchlists: Watchlists;
  recent: string[];
  secrets?: Secrets | LockedSecrets;
}

export type ImportResult = { ok: true; profileId: string } | { ok: false; reason: string };

type Row = Record<string, unknown>;
const isRecord = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';

/** 평문 키에서 아는 필드만 남긴다. 모양이 틀리면 null. */
function plainSecrets(v: unknown): Secrets | null {
  if (!isRecord(v)) return null;
  const out: Secrets = {};
  if (v.kis !== undefined) {
    if (!isRecord(v.kis) || !isString(v.kis.appKey) || !isString(v.kis.appSecret)) return null;
    out.kis = { appKey: v.kis.appKey, appSecret: v.kis.appSecret };
  }
  if (v.toss !== undefined) {
    if (!isRecord(v.toss) || !isString(v.toss.clientId) || !isString(v.toss.clientSecret)) return null;
    out.toss = { clientId: v.toss.clientId, clientSecret: v.toss.clientSecret };
  }
  if (v.proxyToken !== undefined) {
    if (!isString(v.proxyToken)) return null;
    out.proxyToken = v.proxyToken;
  }
  return out;
}

function profileName(st: SafeStorage, profileId: string): string {
  const meta = st.get<unknown>(META_KEY, null);
  const profiles = isRecord(meta) && Array.isArray(meta.profiles) ? meta.profiles : [];
  const found = profiles.find((p): p is Row => isRecord(p) && p.id === profileId);
  return found && isString(found.name) ? found.name : DEFAULT_PROFILE_NAME;
}

export function exportData(st: SafeStorage, profileId: string, includeSecrets: boolean): string {
  const file: ExportFile = {
    format: EXPORT_FORMAT,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    profile: { name: profileName(st, profileId) },
    settings: loadSettings(st, profileId),
    watchlists: loadWatchlists(st, profileId),
    recent: loadRecent(st, profileId),
  };
  if (includeSecrets) {
    const raw = st.get<unknown>(profileKeys.secrets(profileId), null);
    const secrets = isLocked(raw)
      ? { enc: raw.enc, iv: raw.iv, salt: raw.salt, kdf: raw.kdf, iter: raw.iter }
      : plainSecrets(raw);
    if (secrets) file.secrets = secrets;
  }
  return JSON.stringify(file, null, 2);
}

/** `gazua-{프로필 이름}-{KST 날짜}.json`. 파일 이름에 못 쓰는 문자는 `_`로. */
export function exportFileName(profileName: string, now: number): string {
  const safe = profileName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'profile';
  return `gazua-${safe}-${kstDate(now)}.json`;
}

// ── 가져오기 검증 ──────────────────────────────────────────

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
      return isString(v);
    case 'period':
      return (
        isRecord(v) &&
        ['D', 'W', 'M', 'Y'].includes(v.unit as string) &&
        typeof v.n === 'number' &&
        Number.isInteger(v.n) &&
        v.n >= 1
      );
    case 'lastGroupId':
      return v === null || isString(v);
    case 'onboarded':
      return typeof v === 'boolean';
    default:
      return false;
  }
}

/** 아는 필드만, 값이 맞을 때만 가져온다. 나머지는 기본값. keyLock은 키의 형태로 정한다. */
function sanitizeSettings(raw: Row, keyLock: boolean): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (key === 'keyLock') continue;
    if (key in raw && validField(key, raw[key])) (out as unknown as Row)[key] = raw[key];
  }
  out.keyLock = keyLock;
  return out;
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

function validWatchlists(v: unknown): Watchlists | null {
  if (!isRecord(v) || !Array.isArray(v.groups)) return null;
  const ids = new Set<string>();
  const groups: Group[] = [];
  for (const g of v.groups) {
    if (!isRecord(g) || !isString(g.id) || g.id === '' || !isString(g.name) || !Array.isArray(g.items)) return null;
    if (ids.has(g.id) || g.items.length > 8 || !g.items.every(validItem)) return null;
    ids.add(g.id);
    const items = g.items.map(({ symbol, colorSlot, hidden, addedAt }) => ({ symbol, colorSlot, hidden, addedAt }));
    groups.push({ id: g.id, name: g.name, items });
  }
  return { groups };
}

const fail = (reason: string): ImportResult => ({ ok: false, reason });

/** 새 프로필 `{이름} (가져옴)`을 만든다. 지금 쓰는 프로필은 바꾸지 않는다. */
export function importData(st: SafeStorage, json: string, now: () => number = Date.now): ImportResult {
  let file: unknown;
  try {
    file = JSON.parse(json);
  } catch {
    return fail(IMPORT_BAD_FORMAT);
  }
  if (!isRecord(file) || file.format !== EXPORT_FORMAT || !('schemaVersion' in file)) return fail(IMPORT_BAD_FORMAT);
  if (file.schemaVersion !== EXPORT_SCHEMA_VERSION) return fail(IMPORT_BAD_VERSION);
  if (!isRecord(file.settings)) return fail(IMPORT_BAD_FORMAT);
  const watchlists = validWatchlists(file.watchlists);
  if (!watchlists) return fail(IMPORT_BAD_FORMAT);
  if (file.recent !== undefined && !Array.isArray(file.recent)) return fail(IMPORT_BAD_FORMAT);
  const recent = ((file.recent as unknown[] | undefined) ?? []).filter(isString).slice(0, RECENT_MAX);

  let secrets: Secrets | LockedSecrets | null = null;
  if (file.secrets !== undefined) {
    secrets = isLocked(file.secrets) ? file.secrets : plainSecrets(file.secrets);
    if (!secrets) return fail(IMPORT_BAD_FORMAT);
  }
  const locked = secrets !== null && isLocked(secrets);
  const settings = sanitizeSettings(file.settings, locked);

  const name = isRecord(file.profile) && isString(file.profile.name) && file.profile.name.trim() ? file.profile.name.trim() : DEFAULT_PROFILE_NAME;
  const id = crypto.randomUUID();
  st.set(profileKeys.settings(id), settings);
  st.set(profileKeys.watchlists(id), watchlists);
  st.set(profileKeys.recent(id), recent);
  if (secrets) st.set(profileKeys.secrets(id), secrets);
  // 색인은 마지막에 쓴다(중간에 실패해도 반쯤 만든 프로필이 목록에 보이지 않게).
  const meta: Meta = loadMeta(st);
  st.set(META_KEY, { ...meta, profiles: [...meta.profiles, { id, name: `${name} (가져옴)`, createdAt: now() }] });
  return { ok: true, profileId: id };
}
