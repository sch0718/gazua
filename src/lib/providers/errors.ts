export type ErrorCode =
  | 'proxy-unreachable'
  | 'proxy-redirect'
  | 'cors-blocked'
  | 'origin-not-allowed'
  | 'proxy-token-invalid'
  | 'path-blocked'
  | 'ip-not-allowed'
  | 'invalid-credentials'
  | 'token-expired'
  | 'token-throttled'
  | 'rate-limited'
  | 'timeout'
  | 'upstream'
  | 'offline';

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status?: number;
  readonly retryAfterMs?: number;

  /** `message` must never contain keys, tokens or secrets; by default only the code and status are used. */
  constructor(code: ErrorCode, message?: string, opts: { status?: number; retryAfterMs?: number } = {}) {
    super(message ?? (opts.status !== undefined ? `${code} (HTTP ${opts.status})` : code));
    this.name = 'ApiError';
    this.code = code;
    if (opts.status !== undefined) this.status = opts.status;
    if (opts.retryAfterMs !== undefined) this.retryAfterMs = opts.retryAfterMs;
  }
}

const PROXY_CODES: Record<string, ErrorCode> = {
  'proxy-path-blocked': 'path-blocked',
  'proxy-token-invalid': 'proxy-token-invalid',
  'origin-not-allowed': 'origin-not-allowed',
  'upstream-unreachable': 'upstream',
  'upstream-timeout': 'timeout',
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** KIS 본문 msg_cd → 오류 코드. EGW00121/EGW00123 토큰 무효·만료, EGW00201 초당 호출 한도. */
export function kisBodyCode(msgCd: unknown): ErrorCode | undefined {
  if (msgCd === 'EGW00121' || msgCd === 'EGW00123') return 'token-expired';
  if (msgCd === 'EGW00201') return 'rate-limited';
  return undefined;
}

/** Maps a non-2xx proxy/upstream response to an ErrorCode. */
export function classify(status: number, body: unknown, _provider: 'kis' | 'toss'): ErrorCode {
  const rec = isRecord(body) ? body : {};
  const errorField = rec.error;
  const nestedCode = isRecord(errorField) && typeof errorField.code === 'string' ? errorField.code : undefined;
  const oauthError = typeof errorField === 'string' ? errorField : undefined;

  if (nestedCode !== undefined && Object.hasOwn(PROXY_CODES, nestedCode)) return PROXY_CODES[nestedCode];
  if (rec.error_code === 'EGW00133') return 'token-throttled';
  // KIS는 토큰 만료·무효를 HTTP 상태와 무관하게(주로 500) 본문 msg_cd로 알린다.
  const bodyCode = kisBodyCode(rec.msg_cd);
  if (bodyCode !== undefined) return bodyCode;
  if (status === 403 && (nestedCode === 'ip-not-allowed' || oauthError === 'access_denied')) return 'ip-not-allowed';
  if (status === 401) return oauthError === 'invalid_client' ? 'invalid-credentials' : 'token-expired';
  if (status === 429) return 'rate-limited';
  return 'upstream';
}

export type ErrorActionTarget = 'diagnostics' | 'credentials' | 'copy-origin';

export interface ErrorDescription {
  title: string;
  action?: { label: string; target: ErrorActionTarget };
}

const DESCRIPTIONS: Record<ErrorCode, ErrorDescription> = {
  'proxy-unreachable': {
    title: '프록시에 연결할 수 없어요',
    action: { label: '진단 열기', target: 'diagnostics' },
  },
  'proxy-redirect': {
    title: '프록시가 요청을 다른 주소로 보내려 해서 멈췄어요. 프록시 URL을 확인해 주세요',
    action: { label: '진단 열기', target: 'diagnostics' },
  },
  'cors-blocked': {
    title: '프록시가 이 주소를 허용하지 않아요',
    action: { label: '허용할 주소 복사', target: 'copy-origin' },
  },
  'origin-not-allowed': {
    title: '프록시가 이 주소를 허용하지 않아요',
    action: { label: '허용할 주소 복사', target: 'copy-origin' },
  },
  'proxy-token-invalid': {
    title: '프록시 토큰이 맞지 않아요',
    action: { label: '토큰 다시 입력', target: 'credentials' },
  },
  'path-blocked': { title: '이 요청은 프록시에서 막혀 있어요' },
  'ip-not-allowed': {
    title: '토스에 프록시 IP가 등록되지 않았어요',
    action: { label: '진단 열기', target: 'diagnostics' },
  },
  'invalid-credentials': {
    title: '키가 맞지 않아요',
    action: { label: '키 다시 입력', target: 'credentials' },
  },
  'token-expired': { title: '토큰을 다시 받는 중이에요' },
  'token-throttled': { title: 'KIS 토큰은 1분에 한 번만 받을 수 있어요' },
  'rate-limited': { title: '잠시 천천히 불러오는 중' },
  timeout: { title: '응답이 늦어요', action: { label: '진단 열기', target: 'diagnostics' } },
  upstream: { title: '증권사 서버에서 오류가 났어요' },
  offline: { title: '오프라인이에요' },
};

export function describeError(code: ErrorCode): ErrorDescription {
  const d = DESCRIPTIONS[code];
  return d.action ? { title: d.title, action: { ...d.action } } : { title: d.title };
}
