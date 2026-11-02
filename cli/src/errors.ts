// CLI 오류 코드(스펙 §6.6). message는 사람이 읽는 한국어 한 줄이고 비밀값이 없다.
import { ApiError, type ErrorCode } from '../../src/lib/providers/errors';

export const MESSAGES = {
  'invalid-args': '인자가 맞지 않아요',
  'not-logged-in': '로그인하지 않았어요. gazua login을 먼저 실행해 주세요',
  'cli-token-revoked': 'CLI 연결이 끊겼어요. gazua login을 다시 실행해 주세요',
  'cli-token-expired': 'CLI 로그인이 만료됐어요(90일). gazua login을 다시 실행해 주세요',
  'cli-scope': '서버가 읽기 전용 밖의 요청이라며 거절했어요',
  'not-allowed': '이 계정은 허용 목록에 없어요',
  'server-outdated': '서버가 CLI를 아직 지원하지 않아요. 서버(Worker)를 업데이트해 주세요',
  'login-expired': '로그인 코드가 만료됐어요. gazua login을 다시 실행해 주세요',
  'login-denied': '앱에서 연결을 거절했어요',
  'rate-limited': '요청이 너무 많아요. 잠시 뒤 다시 시도해 주세요',
  network: '서버에 연결할 수 없어요',
  'profile-required': '프로필이 여럿이에요. --profile로 골라 주세요',
  'profile-not-found': '프로필을 찾을 수 없어요',
  'strategy-not-found': '전략을 찾을 수 없어요',
  'ambiguous-strategy': '같은 이름의 전략이 여럿이에요. ID로 골라 주세요',
  'no-credentials': '증권사 키가 없어요. 환경변수(KIS_APP_KEY·KIS_APP_SECRET 또는 TOSS_CLIENT_ID·TOSS_CLIENT_SECRET)나 --env-file로 알려 주세요',
  'provider-unsupported': '이 공급자로는 할 수 없는 명령이에요',
  'path-blocked': '허용되지 않은 증권사 경로라서 막았어요',
  'ip-not-allowed': '증권사가 이 기기의 IP를 허용하지 않아요. 개발자 콘솔에 등록해 주세요',
  'invalid-credentials': '증권사 키가 맞지 않아요',
  'token-throttled': '증권사 토큰 발급 제한에 걸렸어요. 1분 뒤 다시 시도해 주세요',
  'token-contended': '다른 실행이나 앱이 같은 키로 토큰을 쓰고 있어요. 토스는 CLI용 앱 키를 따로 쓰세요',
  'token-busy': '다른 gazua 실행이 토큰을 받는 중이에요. 잠시 뒤 다시 시도해 주세요',
  upstream: '증권사 응답에 문제가 있어요',
  timeout: '증권사 응답이 늦어요',
  'app-outdated': '서버 문서가 이 CLI보다 새로워요. CLI를 업데이트해 주세요',
  'drive-not-configured': 'Drive 설정이 없어요. GAZUA_DRIVE_CLIENT_ID·GAZUA_DRIVE_CLIENT_SECRET를 알려 주세요',
  'drive-login-required': 'Drive 로그인이 필요해요. gazua drive login을 실행해 주세요',
  'drive-login-timeout': 'Google 로그인을 기다리다 시간이 지났어요(5분). gazua drive login을 다시 실행해 주세요',
  'drive-denied': 'Google에서 Drive 권한을 허용하지 않았어요',
  'drive-quota': 'Drive 공간이나 요청 한도에 걸렸어요. 잠시 뒤 다시 시도해 주세요',
  'drive-failed': 'Drive 요청이 실패했어요',
  'market-file-invalid': '올릴 수 없는 시장 파일이에요',
  'market-limit': 'Drive 보관본이 서버 한도(10개)에 찼어요. 앱 설정 › 데이터의 「Drive 보관본 지우기」로 비운 뒤 다시 올려 주세요',
  internal: '예상하지 못한 오류예요',
} as const;

export type CliErrorCode = keyof typeof MESSAGES;

export class CliError extends Error {
  readonly code: CliErrorCode;
  readonly data?: unknown;
  constructor(code: CliErrorCode, message: string = MESSAGES[code], data?: unknown) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    if (data !== undefined) this.data = data;
  }
}

const PASS_THROUGH: readonly ErrorCode[] = ['ip-not-allowed', 'invalid-credentials', 'token-throttled', 'token-contended', 'upstream', 'timeout', 'rate-limited', 'path-blocked'];

/** CLI는 프록시를 쓰지 않아 proxy-unreachable·offline이라는 이름이 맞지 않는다 → network */
export function fromApiError(e: ApiError): CliError {
  if (e.code === 'proxy-unreachable' || e.code === 'offline') return new CliError('network');
  if (PASS_THROUGH.includes(e.code)) return new CliError(e.code as CliErrorCode);
  return new CliError('upstream');
}

/** 모르는 오류의 원문은 내보내지 않는다(요청 정보가 섞일 수 있다) */
export function toCliError(e: unknown): CliError {
  if (e instanceof CliError) return e;
  if (e instanceof ApiError) return fromApiError(e);
  return new CliError('internal');
}

export const exitCodeOf = (code: CliErrorCode): 1 | 2 => (code === 'invalid-args' ? 2 : 1);
