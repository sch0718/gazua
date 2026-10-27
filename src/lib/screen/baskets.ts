// 내 묶음(스펙 4.2): 프로필별 종목 묶음. 저장 모양은 { baskets: Basket[] }.
import { NAME_MAX } from '../sim/defaults';
import { profileKeys } from '../state/profileStore';
import type { SafeStorage } from '../state/storage';

export const MAX_BASKETS = 30;
export const BASKET_SYMBOLS_MAX = 300;

export interface Basket {
  id: string;
  name: string; // 30자 이내
  updatedAt: number;
  symbols: string[]; // 1~300, 6자 [0-9A-Z]
}

export function newBasket(now: number, name = '새 묶음', symbols: string[] = []): Basket {
  return { id: crypto.randomUUID(), name, updatedAt: now, symbols };
}

type Row = Record<string, unknown>;
const isRecord = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);
const SYMBOL_RE = /^[0-9A-Z]{6}$/;

/**
 * `{ baskets: [...] }`를 고친다. id·name이 틀리거나 종목이 남지 않은 항목, id가 겹치는 항목, 30개 초과는 버린다.
 * `baskets` 칸이 없으면(이전 내보내기 파일) 조용히 빈 목록이다. 저장소에서 읽을 때의 판단은 loadBaskets가 따로 한다.
 */
export function sanitizeBaskets(raw: unknown): { baskets: Basket[]; repaired: boolean } {
  if (!isRecord(raw) || !Array.isArray(raw.baskets))
    return { baskets: [], repaired: isRecord(raw) ? raw.baskets !== undefined : raw !== undefined && raw !== null };
  const baskets: Basket[] = [];
  const ids = new Set<string>();
  let repaired = false;
  for (const item of raw.baskets) {
    if (
      !isRecord(item) ||
      typeof item.id !== 'string' ||
      item.id.trim() === '' ||
      typeof item.name !== 'string' ||
      !Array.isArray(item.symbols) ||
      ids.has(item.id) ||
      baskets.length >= MAX_BASKETS
    ) {
      repaired = true;
      continue;
    }
    const valid = item.symbols.filter((x): x is string => typeof x === 'string' && SYMBOL_RE.test(x));
    const uniq = [...new Set(valid)];
    if (uniq.length !== item.symbols.length || uniq.length > BASKET_SYMBOLS_MAX) repaired = true;
    const symbols = uniq.slice(0, BASKET_SYMBOLS_MAX);
    if (symbols.length === 0) {
      repaired = true;
      continue;
    }
    if (item.name.length > NAME_MAX) repaired = true;
    const updatedAt = typeof item.updatedAt === 'number' && Number.isFinite(item.updatedAt) ? item.updatedAt : 0;
    if (item.updatedAt !== undefined && updatedAt !== item.updatedAt) repaired = true;
    ids.add(item.id);
    baskets.push({ id: item.id, name: item.name.slice(0, NAME_MAX), updatedAt, symbols });
  }
  return { baskets, repaired };
}

/**
 * 읽을 때 검증한다. 모양이 깨졌거나 고친 것이 있으면 저장소 배너로 알리고, 저장된 값은 덮어쓰지 않는다.
 * 앱은 늘 `{ baskets: [...] }`로 쓰므로 sanitize와 달리 `{}`도 손상으로 본다(loadCriteria와 같다).
 */
export function loadBaskets(st: SafeStorage, profileId: string): Basket[] {
  const key = profileKeys.baskets(profileId);
  const raw = st.get<unknown>(key, null);
  if (raw === null) return [];
  const { baskets, repaired } = sanitizeBaskets(raw);
  const shapeOk = isRecord(raw) && Array.isArray(raw.baskets);
  if (repaired || !shapeOk) st.reportCorrupt(key);
  return baskets;
}

/** 한도 문구. 오류와 화면 스낵바가 같은 문구를 쓴다. */
export const BASKET_CAP_MESSAGE = `내 묶음은 ${MAX_BASKETS}개까지 저장할 수 있어요`;

export function assertBasketCap(list: Basket[]): void {
  if (list.length > MAX_BASKETS) throw new Error(BASKET_CAP_MESSAGE);
}

/** 쓰기 전 검사: 개수 한도에 더해 묶음마다 종목 1~300개(6자 [0-9A-Z], 중복 없이), 이름 30자. 읽을 때 조용히 사라지는 값을 막는다. */
export function assertBasketsWritable(list: Basket[]): void {
  assertBasketCap(list);
  for (const b of list) {
    if (b.symbols.length === 0) throw new Error('묶음에는 종목이 1개 이상 있어야 해요');
    if (b.symbols.length > BASKET_SYMBOLS_MAX) throw new Error(`묶음의 종목은 ${BASKET_SYMBOLS_MAX}개까지예요`);
    if (b.name.length > NAME_MAX) throw new Error(`묶음 이름은 ${NAME_MAX}자까지예요`);
    if (b.symbols.some((x) => !SYMBOL_RE.test(x))) throw new Error('묶음의 종목 코드는 숫자·영문 대문자 6자여야 해요');
    if (new Set(b.symbols).size !== b.symbols.length) throw new Error('묶음에 같은 종목이 두 번 들어 있어요');
  }
}

export function saveBaskets(st: SafeStorage, profileId: string, list: Basket[]): void {
  assertBasketsWritable(list);
  st.set(profileKeys.baskets(profileId), { baskets: list });
}
