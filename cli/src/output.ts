// 출력: 표준 출력에는 JSON 한 줄만. 비밀값은 출력 직전에 한 번 더 거른다(스펙 §6.4).
export const HIDDEN = '[숨김]';

/** 동기화의 FORBIDDEN_KEYS는 쓰지 않는다. holdings·provider·orders처럼 CLI가 정상으로 내는 키가 있어서다 */
export const SECRET_KEYS: ReadonlySet<string> = new Set([
  'appkey', 'appsecret', 'clientid', 'clientsecret', 'accesstoken', 'refreshtoken', 'token', 'proxytoken', 'accountseq', 'devicecode', 'secrets',
]);

/** 이보다 짧은 값은 문자열 치환에서 뺀다(짧은 accountSeq가 출력 전체를 망가뜨리지 않게). 키 이름 거르기는 그대로 적용된다 */
const MIN_SECRET_LENGTH = 6;

export interface Redactor {
  /** 지금 실행의 비밀값(환경변수 키, CLI 토큰, 접근 토큰, accountSeq)을 등록한다 */
  add(value: string | undefined): void;
  apply<T>(value: T): T;
}

export function createRedactor(): Redactor {
  const secrets = new Set<string>();
  const scrub = (s: string): string => {
    let out = s;
    for (const v of [...secrets].sort((a, b) => b.length - a.length)) out = out.split(v).join(HIDDEN);
    return out;
  };
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return scrub(v);
    if (Array.isArray(v)) return v.map(walk);
    if (typeof v === 'object' && v !== null) {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET_KEYS.has(k.toLowerCase()) ? HIDDEN : walk(x)]));
    }
    return v;
  };
  return {
    add(value) {
      if (value !== undefined && value.length >= MIN_SECRET_LENGTH) secrets.add(value);
    },
    apply: <T>(value: T) => walk(value) as T,
  };
}

export type Result =
  | { ok: true; data: unknown; warnings?: string[] }
  | { ok: false; error: { code: string; message: string }; data?: unknown; warnings?: string[] };

export function ok(data: unknown, warnings: string[] = []): Result {
  return warnings.length ? { ok: true, data, warnings } : { ok: true, data };
}

export function fail(code: string, message: string, data?: unknown, warnings: string[] = []): Result {
  return { ok: false, error: { code, message }, ...(data !== undefined ? { data } : {}), ...(warnings.length ? { warnings } : {}) };
}

export const render = (r: Result, redactor: Redactor, pretty: boolean): string => `${JSON.stringify(redactor.apply(r), null, pretty ? 2 : undefined)}\n`;
