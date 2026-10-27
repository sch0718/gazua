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
import { loadCriteria } from '../screen/criteriaStore';
import { sanitizeCriteria } from '../screen/validate';
import { loadBaskets, sanitizeBaskets, type Basket } from '../screen/baskets';
import type { SelectionCriteria } from '../screen/types';
import { loadStrategies } from '../sim/strategyStore';
import { sanitizeStrategies } from '../sim/validate';
import type { Strategy } from '../sim/types';
import { kstDate } from '../time/kst';
import { sanitizeSettings, validWatchlists } from './validate';

export const EXPORT_FORMAT = 'gazua-export';
export const EXPORT_SCHEMA_VERSION = 1;
export const IMPORT_BAD_FORMAT = '파일 형식이 맞지 않아요';
export const IMPORT_BAD_VERSION = '지원하지 않는 버전이에요';
/** 프로필 이름 최대 길이(프로필 추가 입력 칸과 같다). */
const NAME_MAX = 30;

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  schemaVersion: typeof EXPORT_SCHEMA_VERSION;
  profile: { name: string };
  settings: Settings;
  watchlists: Watchlists;
  recent: string[];
  strategies?: Strategy[];
  criteria?: SelectionCriteria[];
  baskets?: Basket[];
  secrets?: Secrets | LockedSecrets;
}

export type ImportResult = { ok: true; profileId: string; repaired: boolean } | { ok: false; reason: string };

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

/** 잠긴 키에서 아는 필드만 복사한다. */
function lockedCopy(l: LockedSecrets): LockedSecrets {
  return { enc: l.enc, iv: l.iv, salt: l.salt, kdf: l.kdf, iter: l.iter };
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
    strategies: loadStrategies(st, profileId),
    criteria: loadCriteria(st, profileId),
    baskets: loadBaskets(st, profileId),
  };
  if (includeSecrets) {
    const raw = st.get<unknown>(profileKeys.secrets(profileId), null);
    const secrets = isLocked(raw) ? lockedCopy(raw) : plainSecrets(raw);
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
  const rawRecent = (file.recent as unknown[] | undefined) ?? [];
  // 문자열이 아닌 항목을 버리면 고침으로 센다(개수 초과는 정상 내보내기에서 나올 수 없어 세지 않는다)
  const recentRepaired = rawRecent.some((x) => !isString(x));
  const recent = rawRecent.filter(isString).slice(0, RECENT_MAX);

  if (file.strategies !== undefined && !Array.isArray(file.strategies)) return fail(IMPORT_BAD_FORMAT);
  const { strategies, repaired: strategiesRepaired } = sanitizeStrategies(file, now());
  if (file.criteria !== undefined && !Array.isArray(file.criteria)) return fail(IMPORT_BAD_FORMAT);
  const { criteria, repaired: criteriaRepaired } = sanitizeCriteria(file, now());
  if (file.baskets !== undefined && !Array.isArray(file.baskets)) return fail(IMPORT_BAD_FORMAT);
  const { baskets, repaired: basketsRepaired } = sanitizeBaskets(file);

  let secrets: Secrets | LockedSecrets | null = null;
  if (file.secrets !== undefined) {
    secrets = isLocked(file.secrets) ? lockedCopy(file.secrets) : plainSecrets(file.secrets);
    if (!secrets) return fail(IMPORT_BAD_FORMAT);
  }
  const locked = secrets !== null && isLocked(secrets);
  const { settings, invalid } = sanitizeSettings(file.settings, locked);

  const rawName = isRecord(file.profile) && isString(file.profile.name) ? file.profile.name.trim() : '';
  const name = rawName ? [...rawName].slice(0, NAME_MAX).join('').trim() : DEFAULT_PROFILE_NAME;
  const id = crypto.randomUUID();
  st.set(profileKeys.settings(id), settings);
  st.set(profileKeys.watchlists(id), watchlists);
  st.set(profileKeys.recent(id), recent);
  st.set(profileKeys.strategies(id), { strategies });
  st.set(profileKeys.criteria(id), { criteria });
  st.set(profileKeys.baskets(id), { baskets });
  if (secrets) st.set(profileKeys.secrets(id), secrets);
  // 색인은 마지막에 쓴다(중간에 실패해도 반쯤 만든 프로필이 목록에 보이지 않게).
  const meta: Meta = loadMeta(st);
  st.set(META_KEY, { ...meta, profiles: [...meta.profiles, { id, name: `${name} (가져옴)`, createdAt: now() }] });
  // 관심종목은 하나라도 틀리면 위에서 거절하므로 고침으로 세지 않는다
  return { ok: true, profileId: id, repaired: invalid.length > 0 || strategiesRepaired || criteriaRepaired || basketsRepaired || recentRepaired };
}
