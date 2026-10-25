// 동기화·공유 문서에 어느 깊이에서도 들어가면 안 되는 키. 클라이언트와 sync-worker가 함께 쓴다.
// 허용 필드 검사(dto.ts·share/snapshot.ts)와 별도로 먼저 본다. 허용 목록이 실수로 넓어져도 키·계좌는 막히게.

export const FORBIDDEN_KEYS: readonly string[] = [
  // 증권사 키·프록시 토큰(secrets.ts)
  'secrets',
  'appKey',
  'appSecret',
  'clientId',
  'clientSecret',
  'proxyToken',
  // 접근 토큰·발급 시각
  'token',
  'accessToken',
  'refreshToken',
  'idToken',
  'tokenIssuedAt',
  'expiresAt',
  // 잠긴 키의 저장 형태
  'enc',
  'iv',
  'salt',
  'kdf',
  'iter',
  // 기기 전용 설정
  'proxyUrl',
  'provider',
  'keyLock',
  'onboarded',
  'lastGroupId',
  'venueMode',
  'theme',
  // 계좌·주문 캐시(gazua-account)·성과 이력
  'accountId',
  'accountSeq',
  'orders',
  'syncedAt',
  'syncedThrough',
  'holdings',
  'performance',
  // 소유자는 서버가 정한다
  'ownerId',
  'userId',
];

const FORBIDDEN = new Set(FORBIDDEN_KEYS.map((k) => k.toLowerCase()));

/** 금지 키가 처음 나온 경로(`a.b[2].c`). 없으면 null. 대소문자는 가리지 않는다. */
export function findForbidden(v: unknown, path = ''): string | null {
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const hit = findForbidden(v[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  for (const [k, child] of Object.entries(v)) {
    const p = path ? `${path}.${k}` : k;
    if (FORBIDDEN.has(k.toLowerCase())) return p;
    const hit = findForbidden(child, p);
    if (hit) return hit;
  }
  return null;
}

/**
 * 두 JSON 값이 같은지(객체 키 순서는 무시). 다르면 처음 다른 경로와 종류를 돌려준다.
 * extra: 입력(a)에만 있는 키 — 알 수 없는 필드다.
 */
export function jsonDiff(a: unknown, b: unknown, path = ''): { path: string; kind: 'extra' | 'value' } | null {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return { path, kind: 'value' };
    for (let i = 0; i < a.length; i++) {
      const d = jsonDiff(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
  if (isObj(a) && isObj(b)) {
    for (const k of Object.keys(a)) {
      const p = path ? `${path}.${k}` : k;
      if (!Object.hasOwn(b, k)) return { path: p, kind: 'extra' };
      const d = jsonDiff(a[k], b[k], p);
      if (d) return d;
    }
    for (const k of Object.keys(b)) if (!Object.hasOwn(a, k)) return { path: path ? `${path}.${k}` : k, kind: 'value' };
    return null;
  }
  return Object.is(a, b) ? null : { path, kind: 'value' };
}

/** JSON 문자열의 UTF-8 바이트 수. */
export function jsonBytes(v: unknown): number {
  return new TextEncoder().encode(JSON.stringify(v)).length;
}
