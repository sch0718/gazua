// 연결 진단(스펙 7.4): ① 프록시 응답 → ② CORS 허용 → ③ 토큰 발급 → ④ 시세 조회(삼성전자).
// ③ 토큰: 앱의 공급자가 같은 키·프록시로 만들어졌으면 그 토큰 관리자(tokenSource)를 함께 쓴다
// (KIS 토큰은 1분에 한 번만 받을 수 있어, 앱이 막 받은 토큰과 겹쳐 발급하면 실패한다).
// 그렇지 않으면 직접 발급하고, 그 토큰은 이 진단 안에서만 쓰고 버린다.
// 단계의 hint·error에는 키·토큰을 절대 넣지 않는다(고정 문구와 출처만).
import type { Secrets } from '../state/secrets';
import { ApiError, classify, kisBodyCode, type ErrorCode } from './errors';
import { createProxyClient, type ProxyClient } from './http';
import { parseKisToken } from './kis';
import { parseTossToken } from './toss';
import type { TokenInfo } from './types';

export type DiagLabel = '프록시 응답' | 'CORS 허용' | '토큰 발급' | '시세 조회 (삼성전자)';

export interface DiagStep {
  id: 1 | 2 | 3 | 4;
  label: DiagLabel;
  status: 'pending' | 'running' | 'ok' | 'fail' | 'skipped';
  ms?: number;
  error?: ErrorCode;
  hint?: string;
  /** 복사해 쓸 값(CORS 실패 때 ALLOWED_ORIGINS에 넣을 출처). 비밀값이 아니다. */
  copy?: string;
}

export interface DiagnosticsArgs {
  proxyUrl: string;
  /** 없으면 secrets.proxyToken. */
  proxyToken?: string;
  provider: 'kis' | 'toss';
  secrets: Secrets;
  fetchImpl?: typeof fetch;
  onStep(s: DiagStep[]): void;
  /** 기본값 location.origin. */
  origin?: string;
  /** ms 측정용 시계. 기본값 performance.now. */
  clock?: () => number;
  /** 토큰 만료 시각 계산용 epoch ms. 기본값 Date.now. */
  now?: () => number;
  /** 있으면 ③에서 직접 발급하지 않고 이 토큰을 쓴다(앱 공급자의 getAccessToken). */
  tokenSource?: () => Promise<TokenInfo>;
}

const LABELS: Record<DiagStep['id'], DiagLabel> = {
  1: '프록시 응답',
  2: 'CORS 허용',
  3: '토큰 발급',
  4: '시세 조회 (삼성전자)',
};

const SYMBOL = '005930';
const HEALTH_TIMEOUT_MS = 8000;
// kis.ts와 같은 값(현재가 TR).
const KIS_PRICE_PATH = '/uapi/domestic-stock/v1/quotations/inquire-price';
const KIS_PRICE_TR = 'FHKST01010100';

export const IP_HINT = '토스증권 WTS › 설정 › Open API › 허용 IP 관리에 프록시 공인 IP를 등록해 주세요';

/** 실패 단계에 붙일 해결책. 출처가 필요한 문구는 corsHint로 만든다. */
const HINTS: Record<ErrorCode, string> = {
  'proxy-unreachable': '프록시 주소가 맞는지, 프록시가 켜져 있는지 확인해 주세요',
  timeout: '프록시가 응답하지 않아요. 프록시가 켜져 있는지 확인해 주세요',
  offline: '인터넷 연결을 확인해 주세요',
  'cors-blocked': '',
  'origin-not-allowed': '',
  'proxy-token-invalid': '프록시 토큰을 다시 확인해 주세요',
  'path-blocked': '프록시가 이 요청을 막고 있어요. 프록시를 최신 버전으로 다시 배포해 주세요',
  'ip-not-allowed': IP_HINT,
  'invalid-credentials': '키를 다시 확인해 주세요',
  'token-expired': '토큰이 바로 만료됐어요. 다시 진단해 주세요',
  'token-throttled': 'KIS 토큰은 1분에 한 번만 받을 수 있어요. 잠시 뒤 다시 진단해 주세요',
  'rate-limited': '호출 한도에 걸렸어요. 잠시 뒤 다시 진단해 주세요',
  upstream: '증권사 서버에서 오류가 났어요. 잠시 뒤 다시 진단해 주세요',
};

const corsHint = (origin: string) =>
  origin ? `프록시 ALLOWED_ORIGINS에 ${origin}을 넣어 주세요` : '프록시 ALLOWED_ORIGINS에 현재 주소를 넣어 주세요';

/** 단계 실패. code·hint만 담는다. */
class StepFailure extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly hint?: string,
  ) {
    super(code);
  }
}

type Row = Record<string, unknown>;
const isRecord = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const filled = (v: string | undefined): v is string => !!v && v.trim() !== '';

function positive(v: unknown): boolean {
  const n = Number(text(v).trim());
  return text(v).trim() !== '' && Number.isFinite(n) && n > 0;
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return JSON.parse(await res.text());
  } catch {
    return null;
  }
}

function codeOf(e: unknown): ErrorCode {
  if (e instanceof StepFailure) return e.code;
  if (e instanceof ApiError) return e.code;
  return 'upstream';
}

export async function runDiagnostics(args: DiagnosticsArgs): Promise<DiagStep[]> {
  const { provider, secrets, onStep } = args;
  const fetchImpl = args.fetchImpl ?? ((input, init) => fetch(input, init));
  const clock = args.clock ?? (() => performance.now());
  const now = args.now ?? (() => Date.now());
  const origin = args.origin ?? globalThis.location?.origin ?? '';
  const base = args.proxyUrl.trim().replace(/\/+$/, '');
  const proxyToken = args.proxyToken ?? secrets.proxyToken;

  let steps: DiagStep[] = ([1, 2, 3, 4] as const).map((id) => ({ id, label: LABELS[id], status: 'pending' }));
  const update = (id: DiagStep['id'], patch: Partial<DiagStep>) => {
    steps = steps.map((s) => (s.id === id ? { ...s, ...patch } : { ...s }));
    onStep(steps);
  };

  // ①·②를 지난 뒤의 TypeError는 사전 요청(사용자 지정 헤더) 거부일 가능성이 커서 CORS로 본다.
  const client: ProxyClient = createProxyClient({ baseUrl: base, proxyToken, fetchImpl, typeErrorCode: 'cors-blocked' });
  let token: TokenInfo | null = null;

  async function health(init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    try {
      return await fetchImpl(`${base}/health`, { ...init, signal: controller.signal });
    } catch (e) {
      if (controller.signal.aborted) throw new StepFailure('timeout');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  const work: Record<DiagStep['id'], () => Promise<void>> = {
    // ① 응답을 읽을 수 없는(opaque) no-cors 요청이라도 도착하면 프록시는 살아 있다.
    1: async () => {
      if (base === '') throw new StepFailure('proxy-unreachable', '프록시 URL을 입력해 주세요');
      try {
        await health({ mode: 'no-cors' });
      } catch (e) {
        if (e instanceof StepFailure) throw e;
        throw new StepFailure('proxy-unreachable');
      }
    },
    // ② 일반 요청이 TypeError면 프록시가 이 출처를 허용하지 않는 것이다.
    //    사용자 지정 헤더(프록시 토큰)는 붙이지 않는다: 사전 요청이 생기는데 /health는 그 헤더를 허용하지 않는다.
    //    프록시 토큰은 ③에서 확인된다.
    2: async () => {
      let res: Response;
      try {
        res = await health({});
      } catch (e) {
        if (e instanceof StepFailure) throw e;
        throw new StepFailure('cors-blocked');
      }
      if (res.status < 200 || res.status >= 300) throw new StepFailure(classify(res.status, await readJson(res), provider));
    },
    3: async () => {
      if (args.tokenSource) {
        token = await args.tokenSource();
        if (!token?.accessToken) throw new StepFailure('upstream');
        return;
      }
      if (provider === 'kis') {
        const kis = secrets.kis;
        if (!kis || !filled(kis.appKey) || !filled(kis.appSecret)) throw new StepFailure('invalid-credentials', '키를 입력해 주세요');
        const res = await client.request('kis', 'POST', '/oauth2/tokenP', {
          body: { grant_type: 'client_credentials', appkey: kis.appKey, appsecret: kis.appSecret },
        });
        token = parseKisToken(res.json);
      } else {
        const toss = secrets.toss;
        if (!toss || !filled(toss.clientId) || !filled(toss.clientSecret)) throw new StepFailure('invalid-credentials', '키를 입력해 주세요');
        const res = await client.request('toss', 'POST', '/oauth2/token', {
          body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: toss.clientId,
            client_secret: toss.clientSecret,
          }),
        });
        token = parseTossToken(res.json, now());
      }
      if (!token) throw new StepFailure('upstream');
    },
    4: async () => {
      const authorization = `Bearer ${token!.accessToken}`;
      if (provider === 'kis') {
        const kis = secrets.kis!;
        const res = await client.request('kis', 'GET', KIS_PRICE_PATH, {
          query: { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: SYMBOL },
          headers: {
            authorization,
            appkey: kis.appKey,
            appsecret: kis.appSecret,
            tr_id: KIS_PRICE_TR,
            custtype: 'P',
            'content-type': 'application/json; charset=utf-8',
          },
        });
        const body = res.json;
        if (isRecord(body) && 'rt_cd' in body && body.rt_cd !== '0') {
          throw new StepFailure(kisBodyCode(body.msg_cd) ?? 'upstream');
        }
        const output = isRecord(body) ? body.output : undefined;
        if (!isRecord(output) || !positive(output.stck_prpr)) throw new StepFailure('upstream');
      } else {
        const res = await client.request('toss', 'GET', '/api/v1/prices', {
          query: { symbols: SYMBOL },
          headers: { authorization },
        });
        const result = isRecord(res.json) ? res.json.result : undefined;
        const row = Array.isArray(result) ? result.find((r) => isRecord(r) && text(r.symbol) === SYMBOL) : undefined;
        if (!isRecord(row) || !positive(row.lastPrice)) throw new StepFailure('upstream');
      }
    },
  };

  for (const id of [1, 2, 3, 4] as const) {
    update(id, { status: 'running' });
    const started = clock();
    try {
      await work[id]();
      update(id, { status: 'ok', ms: Math.max(0, Math.round(clock() - started)) });
    } catch (e) {
      const code = codeOf(e);
      const cors = code === 'cors-blocked' || code === 'origin-not-allowed';
      const own = e instanceof StepFailure ? e.hint : undefined;
      const patch: Partial<DiagStep> = {
        status: 'fail',
        ms: Math.max(0, Math.round(clock() - started)),
        error: code,
        hint: own ?? (cors ? corsHint(origin) : HINTS[code]),
      };
      if (cors && origin) patch.copy = origin;
      update(id, patch);
      steps = steps.map((s) => (s.id > id ? { ...s, status: 'skipped' } : { ...s }));
      onStep(steps);
      break;
    }
  }
  return steps;
}
