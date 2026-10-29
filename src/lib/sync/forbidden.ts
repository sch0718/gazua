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

/** 스냅샷·문서의 실제 깊이는 10 안팎이다. 이보다 깊으면 재귀하지 않고 거절한다(설계 2.7) */
export const JSON_DEPTH_MAX = 32;

/** 어느 객체·배열이 깊이 max를 넘는가(루트 0). 재귀 없이 돈다. */
export function exceedsDepth(v: unknown, max = JSON_DEPTH_MAX): boolean {
  const stack: [unknown, number][] = [[v, 0]];
  while (stack.length) {
    const [x, d] = stack.pop()!;
    if (typeof x !== 'object' || x === null) continue;
    if (d > max) return true;
    for (const child of Array.isArray(x) ? x : Object.values(x)) stack.push([child, d + 1]);
  }
  return false;
}

/** 금지 키가 처음 나온 경로(`a.b[2].c`). 대소문자는 가리지 않는다. 깊이 상한을 넘으면 그 경로를 돌려줘 거절한다. 둘 다 없으면 null. */
export function findForbidden(v: unknown, path = '', depth = 0): string | null {
  if (Array.isArray(v)) {
    if (depth > JSON_DEPTH_MAX) return path;
    for (let i = 0; i < v.length; i++) {
      const hit = findForbidden(v[i], `${path}[${i}]`, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  if (depth > JSON_DEPTH_MAX) return path;
  for (const [k, child] of Object.entries(v)) {
    const p = path ? `${path}.${k}` : k;
    if (FORBIDDEN.has(k.toLowerCase())) return p;
    const hit = findForbidden(child, p, depth + 1);
    if (hit) return hit;
  }
  return null;
}

/**
 * 두 JSON 값이 같은지(객체 키 순서는 무시). 다르면 처음 다른 경로와 종류를 돌려준다.
 * extra: 입력(a)에만 있는 키 — 알 수 없는 필드다.
 * ignoreMissing: 정리 결과(b)에만 있는 키(입력에서 빠진 필드)는 차이로 보지 않고 건너뛴다(공유 받는 쪽 검사, 설계 2.7).
 * 객체·배열이 깊이 상한을 넘으면 그 자리에서 value 차이로 멈춘다.
 */
export function jsonDiff(
  a: unknown,
  b: unknown,
  path = '',
  opts: { ignoreMissing?: boolean } = {},
  depth = 0,
): { path: string; kind: 'extra' | 'value' } | null {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return { path, kind: 'value' };
    if (depth > JSON_DEPTH_MAX) return { path, kind: 'value' };
    for (let i = 0; i < a.length; i++) {
      const d = jsonDiff(a[i], b[i], `${path}[${i}]`, opts, depth + 1);
      if (d) return d;
    }
    return null;
  }
  const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
  if (isObj(a) && isObj(b)) {
    if (depth > JSON_DEPTH_MAX) return { path, kind: 'value' };
    for (const k of Object.keys(a)) {
      const p = path ? `${path}.${k}` : k;
      if (!Object.hasOwn(b, k)) return { path: p, kind: 'extra' };
      const d = jsonDiff(a[k], b[k], p, opts, depth + 1);
      if (d) return d;
    }
    if (!opts.ignoreMissing) for (const k of Object.keys(b)) if (!Object.hasOwn(a, k)) return { path: path ? `${path}.${k}` : k, kind: 'value' };
    return null;
  }
  return Object.is(a, b) ? null : { path, kind: 'value' };
}

/** JSON 문자열의 UTF-8 바이트 수. */
export function jsonBytes(v: unknown): number {
  return new TextEncoder().encode(JSON.stringify(v)).length;
}
