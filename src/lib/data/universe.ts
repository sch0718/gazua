import type { SecurityType } from '../market/sessions';

export interface UniverseItem {
  /** 단축코드 (주식·ETF·리츠 6자리, ETN은 Q + 6자리) */
  s: string;
  /** 종목명 */
  n: string;
  /** 시장 (KOSPI | KOSDAQ) */
  m: string;
  /** 종류 */
  t: SecurityType;
}

export async function loadUniverse(fetchImpl: typeof fetch = fetch): Promise<UniverseItem[]> {
  const res = await fetchImpl(`${import.meta.env.BASE_URL}universe.json`);
  if (!res.ok) throw new Error(`universe.json 요청이 실패했어요 (${res.status})`);
  const data: unknown = await res.json();
  if (!Array.isArray(data)) throw new Error('universe.json 형식이 올바르지 않아요');
  return data as UniverseItem[];
}

const CHOSUNG = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;
const SYLLABLES_PER_CHOSUNG = 21 * 28;

function chosungOf(ch: string): string | null {
  const code = ch.charCodeAt(0);
  if (code < HANGUL_BASE || code > HANGUL_LAST) return null;
  return CHOSUNG[Math.floor((code - HANGUL_BASE) / SYLLABLES_PER_CHOSUNG)];
}

/** 한글 음절은 초성으로, 그 외 글자는 그대로 둔다. */
export function toChosung(s: string): string {
  let out = '';
  for (const ch of s) out += chosungOf(ch) ?? ch;
  return out;
}

/**
 * name[pos..]가 질의와 글자 단위로 맞는지 본다.
 * 질의 글자는 이름 글자와 같거나(대소문자 무시), 초성 자모이면 그 음절의 초성과 같아야 한다.
 * 일치하지 않으면 null, 일치하면 초성 자모를 하나라도 썼는지를 돌려준다.
 */
function matchAt(name: string, query: string, pos: number): { usedJamo: boolean } | null {
  if (pos + query.length > name.length) return null;
  let usedJamo = false;
  for (let i = 0; i < query.length; i++) {
    const q = query[i];
    const n = name[pos + i];
    if (q === n || q.toLowerCase() === n.toLowerCase()) continue;
    if (CHOSUNG.includes(q) && chosungOf(n) === q) {
      usedJamo = true;
      continue;
    }
    return null;
  }
  return { usedJamo };
}

// 순위: 코드 일치 > 이름 접두 > 초성 접두 > 이름 포함 > 초성 포함
const RANK_CODE = 0;
const RANK_NAME_PREFIX = 1;
const RANK_CHOSUNG_PREFIX = 2;
const RANK_NAME_CONTAINS = 3;
const RANK_CHOSUNG_CONTAINS = 4;

function rankOf(item: UniverseItem, query: string, queryUpper: string): number | null {
  if (item.s.startsWith(queryUpper)) return RANK_CODE;
  const prefix = matchAt(item.n, query, 0);
  if (prefix) return prefix.usedJamo ? RANK_CHOSUNG_PREFIX : RANK_NAME_PREFIX;
  let jamoHit = false;
  for (let pos = 1; pos + query.length <= item.n.length; pos++) {
    const hit = matchAt(item.n, query, pos);
    if (!hit) continue;
    if (!hit.usedJamo) return RANK_NAME_CONTAINS;
    jamoHit = true;
  }
  return jamoHit ? RANK_CHOSUNG_CONTAINS : null;
}

export function searchUniverse(items: UniverseItem[], q: string, limit = 30): UniverseItem[] {
  const query = q.trim();
  if (!query) return [];
  const queryUpper = query.toUpperCase();
  const ranked: { item: UniverseItem; rank: number }[] = [];
  for (const item of items) {
    const rank = rankOf(item, query, queryUpper);
    if (rank !== null) ranked.push({ item, rank });
  }
  ranked.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.item.n.length - b.item.n.length ||
      (a.item.s < b.item.s ? -1 : a.item.s > b.item.s ? 1 : 0),
  );
  return ranked.slice(0, limit).map((r) => r.item);
}
