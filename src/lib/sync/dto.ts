// 동기화 프로필 문서(ProfileDocV1): 허용한 필드만 담는다. 클라이언트가 만들고 sync-worker가 같은 함수로 다시 검사한다.
// 이 파일과 여기서 부르는 검증 함수는 DOM·import.meta.env·저장소를 쓰지 않아야 한다(Worker에서 돈다).
import type { Basket } from '../screen/baskets';
import { sanitizeBaskets } from '../screen/baskets';
import { sanitizeCriteria } from '../screen/validate';
import type { SelectionCriteria } from '../screen/types';
import { sanitizeStrategies } from '../sim/validate';
import { sanitizeStrategiesV2, type StrategyV2 } from '../sim/strategyV2';
import type { Strategy } from '../sim/types';
import { PERIOD_COUNTS } from '../market/periods';
import type { PeriodUnit, Settings, Watchlists } from '../state/schema';
import { sanitizeWatchlists } from '../state/validate';
import { findForbidden, jsonBytes, jsonDiff } from './forbidden';

/** 앱이 만드는 문서 버전. 전략 빌더 PR②에서 2로 올린다 */
export const PROFILE_DOC_VERSION = 1;
/** 받는 문서의 가장 높은 버전(전략 빌더 §8.3). 이보다 높으면 unsupported */
export const PROFILE_DOC_MAX_VERSION = 2;
/** 옛 앱에 v2 문서를 주거나 받지 않을 때의 422 코드. 옛 앱 SyncPanel이 코드를 괄호에 그대로 보여서 문장으로 둔다 */
export const APP_OUTDATED_CODE = '앱을 새로 고쳐 주세요';
/** 제안서 2절: 개인 문서당 256 KiB. 넘으면 자르지 않고 알린다. */
export const PROFILE_DOC_MAX_BYTES = 256 * 1024;
export const PROFILE_NAME_MAX = 30;

/** 기기를 옮겨도 같아야 하는 분석 설정만(사용자 결정 4번). 나머지 설정은 기기에 둔다. */
export const SYNCED_SETTINGS = ['period', 'metric', 'benchmark', 'perfBenchmark', 'colorConvention', 'boardOrder'] as const;
export type SyncedSettings = Pick<Settings, (typeof SYNCED_SETTINGS)[number]>;

export interface ProfileDocV1 {
  v: 1;
  name: string;
  settings: SyncedSettings;
  watchlists: Watchlists;
  strategies: Strategy[];
  criteria: SelectionCriteria[];
  baskets: Basket[];
}

/** 전략 v2(전략 빌더)를 담은 문서. 나머지 필드는 v1과 같다 */
export interface ProfileDocV2 extends Omit<ProfileDocV1, 'v' | 'strategies'> {
  v: 2;
  strategies: StrategyV2[];
}
export type ProfileDoc = ProfileDocV1 | ProfileDocV2;

export type DocError = 'invalid' | 'unknown-field' | 'forbidden-field' | 'too-large' | 'unsupported';
export type DocCheck = { ok: true; doc: ProfileDoc } | { ok: false; code: DocError; path?: string };

type Row = Record<string, unknown>;
const isRecord = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);
const TOP_KEYS = ['v', 'name', 'settings', 'watchlists', 'strategies', 'criteria', 'baskets'];

export const SETTING_OK: Record<(typeof SYNCED_SETTINGS)[number], (v: unknown) => boolean> = {
  period: (v) =>
    isRecord(v) &&
    Object.keys(v).length === 2 &&
    Object.hasOwn(PERIOD_COUNTS, v.unit as string) &&
    PERIOD_COUNTS[v.unit as PeriodUnit].includes(v.n as number),
  metric: (v) => ['change', 'drawdown', 'excess', 'rvol', 'mcap', 'volatility', 'rsi'].includes(v as string),
  benchmark: (v) => ['AUTO', 'KOSPI', 'KOSDAQ'].includes(v as string),
  perfBenchmark: (v) => v === null || ['AUTO', 'KOSPI', 'KOSDAQ', '069500', '229200'].includes(v as string),
  colorConvention: (v) => v === 'kr' || v === 'global',
  boardOrder: (v) => v === 'value' || v === 'mine',
};

/** 설정 전체에서 동기화할 필드만 고른다. */
export function pickSyncedSettings(s: Settings): SyncedSettings {
  return {
    period: { unit: s.period.unit, n: s.period.n },
    metric: s.metric,
    benchmark: s.benchmark,
    perfBenchmark: s.perfBenchmark,
    colorConvention: s.colorConvention,
    boardOrder: s.boardOrder,
  };
}

const fail = (code: DocError, path?: string): DocCheck => (path === undefined ? { ok: false, code } : { ok: false, code, path });

/** 고친 결과가 입력과 정확히 같아야 한다. 입력에만 있는 키는 unknown-field, 그 밖의 차이는 invalid. */
function sameAs(input: unknown, cleaned: unknown, path: string): DocCheck | null {
  const d = jsonDiff(input, cleaned, path);
  if (!d) return null;
  return fail(d.kind === 'extra' ? 'unknown-field' : 'invalid', d.path);
}

/**
 * 받은 문서를 검사한다. 금지 키 → 크기 → 버전 → 알 수 없는 필드 → 값 순서로 본다.
 * 저장소 읽기처럼 고쳐서 받지 않는다. 고칠 것이 하나라도 있으면 거절한다.
 * v가 1이면 v1 전략, 2면 v2 전략으로 검사한다. 앱은 아직 v1만 만든다.
 */
export function checkProfileDoc(raw: unknown, now = Date.now()): DocCheck {
  if (!isRecord(raw)) return fail('invalid');
  const forbidden = findForbidden(raw);
  if (forbidden) return fail('forbidden-field', forbidden);
  if (jsonBytes(raw) > PROFILE_DOC_MAX_BYTES) return fail('too-large');
  const v = raw.v;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) return fail('invalid', 'v');
  if (v > PROFILE_DOC_MAX_VERSION) return fail('unsupported', 'v');
  for (const k of Object.keys(raw)) if (!TOP_KEYS.includes(k)) return fail('unknown-field', k);
  for (const k of TOP_KEYS) if (!Object.hasOwn(raw, k)) return fail('invalid', k);
  if (typeof raw.name !== 'string' || raw.name.trim() === '' || raw.name !== raw.name.trim() || [...raw.name].length > PROFILE_NAME_MAX)
    return fail('invalid', 'name');

  const s = raw.settings;
  if (!isRecord(s)) return fail('invalid', 'settings');
  for (const k of Object.keys(s)) if (!(SYNCED_SETTINGS as readonly string[]).includes(k)) return fail('unknown-field', `settings.${k}`);
  for (const k of SYNCED_SETTINGS) if (!Object.hasOwn(s, k) || !SETTING_OK[k](s[k])) return fail('invalid', `settings.${k}`);

  const w = sanitizeWatchlists(raw.watchlists);
  if (!w || w.watchlists.groups.length === 0) return fail('invalid', 'watchlists');
  const wd = sameAs(raw.watchlists, w.watchlists, 'watchlists');
  if (wd) return wd;

  for (const [key, cleaned] of [
    ['strategies', v === 1 ? sanitizeStrategies({ strategies: raw.strategies }, now).strategies : sanitizeStrategiesV2({ strategies: raw.strategies }, now).strategies],
    ['criteria', sanitizeCriteria({ criteria: raw.criteria }, now).criteria],
    ['baskets', sanitizeBaskets({ baskets: raw.baskets }).baskets],
  ] as const) {
    if (!Array.isArray(raw[key])) return fail('invalid', key);
    const d = sameAs(raw[key], cleaned, key);
    if (d) return d;
  }
  return { ok: true, doc: raw as unknown as ProfileDoc }; // 입력 원본을 돌려준다(Worker는 이것을 저장한다)
}
