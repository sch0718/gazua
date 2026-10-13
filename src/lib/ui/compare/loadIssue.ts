// 비교 화면의 마지막 로딩 오류 → 상단 배너·툴바 안내(스펙 11절).
// 종목 단위 오류(upstream 등)는 그 행에만 보이고, 연결 수준 오류만 화면 위쪽에 알린다.
import { ApiError, describeError, type ErrorActionTarget, type ErrorCode } from '../../providers/errors';
import type { App } from '../../state/app.svelte';
import { showSnackbar } from '../components/snackbarStore.svelte';
import { kstHHMM } from './compareText';

/** 종목 정보(메타)를 받지 못했을 때의 행 문구. 오류 코드를 모를 때 연결 문구의 fallback으로도 쓴다. */
export const META_ERROR = '종목 정보를 받지 못했어요';

/** 시뮬레이션에서 종목 일봉을 모두 받지 못했는데 오류 코드를 모를 때의 연결 문구 */
export const CANDLES_ERROR = '종목 일봉을 받지 못했어요';

/** 한 종목의 마지막 시도가 실패한 이유. */
export interface LoadFault {
  code: ErrorCode;
  /** 실패를 기록한 시각(epoch ms) */
  at: number;
  retryAfterMs?: number;
}

export interface LoadIssue extends LoadFault {
  /** 지금 그룹의 모든 종목이 새로 받지 못했다(마지막 성공 결과만 있거나 아무것도 없음). */
  allFailed: boolean;
  /** 마지막으로 새 데이터를 받은 시각. 없으면 null */
  lastOkAt: number | null;
}

export type IssueView =
  | { kind: 'banner'; tone: 'warn' | 'error'; text: string; action?: { label: string; target: ErrorActionTarget } }
  | { kind: 'toolbar'; text: string };

/** 사용자가 고칠 수 있는 것부터: 연결 → 키·권한 → 한도 → 느림 → 그 밖. */
const PRIORITY: ErrorCode[] = [
  'offline',
  'proxy-unreachable',
  'proxy-redirect',
  'cors-blocked',
  'origin-not-allowed',
  'proxy-token-invalid',
  'ip-not-allowed',
  'invalid-credentials',
  'token-throttled',
  'rate-limited',
  'timeout',
  'path-blocked',
  'token-expired',
  'upstream',
];

export function dominantFault(faults: LoadFault[]): LoadFault | null {
  let best: LoadFault | null = null;
  for (const f of faults) {
    if (!best || PRIORITY.indexOf(f.code) < PRIORITY.indexOf(best.code)) best = f;
  }
  return best;
}

/** 한 행의 일시적 실패일 수 있어 과반 행이 같은 코드로 실패할 때만 화면 문제로 보는 연결 코드. */
export const CONNECTION_CODES: ErrorCode[] = ['proxy-unreachable', 'timeout'];

/** 연결 코드 오류는 그 코드로 실패한 행이 total의 과반(> total / 2)일 때만 남긴다. 그 밖의 코드는 그대로. */
export function issueFaults(faults: LoadFault[], total: number): LoadFault[] {
  const count = new Map<ErrorCode, number>();
  for (const f of faults) count.set(f.code, (count.get(f.code) ?? 0) + 1);
  return faults.filter((f) => !CONNECTION_CODES.includes(f.code) || (count.get(f.code) ?? 0) > total / 2);
}

/** 화면 전체의 문제인 코드(연결·키·권한). 연결 코드는 issueFaults를 거쳐 과반일 때만 여기까지 온다. */
const BANNER_CODES: ErrorCode[] = [
  'proxy-unreachable',
  'timeout',
  'proxy-redirect',
  'cors-blocked',
  'origin-not-allowed',
  'proxy-token-invalid',
  'ip-not-allowed',
  'invalid-credentials',
];

export function issueView(issue: LoadIssue | null, now: number): IssueView | null {
  if (!issue) return null;
  const d = describeError(issue.code);
  switch (issue.code) {
    case 'offline':
      return {
        kind: 'banner',
        tone: 'warn',
        text: issue.lastOkAt === null ? d.title : `오프라인 · ${kstHHMM(issue.lastOkAt)} 기준`,
      };
    case 'rate-limited':
      return { kind: 'toolbar', text: d.title };
    case 'token-throttled': {
      const left = issue.retryAfterMs === undefined ? 0 : Math.ceil((issue.at + issue.retryAfterMs - now) / 1000);
      return { kind: 'banner', tone: 'warn', text: left > 0 ? `${d.title} · ${left}초 남았어요` : d.title };
    }
  }
  if (!BANNER_CODES.includes(issue.code)) return null;
  return { kind: 'banner', tone: 'error', text: d.title, ...(d.action ? { action: d.action } : {}) };
}

/** 배너의 해결 행동: 진단·연결 설정으로 가거나 허용할 주소를 복사한다. */
export function runIssueAction(app: Pick<App, 'navigate'>, target: ErrorActionTarget): void {
  if (target === 'diagnostics') app.navigate({ name: 'settings', section: 'diagnostics' });
  else if (target === 'credentials') app.navigate({ name: 'settings', section: 'connection' });
  else {
    void navigator.clipboard?.writeText(location.origin).then(
      () => showSnackbar('허용할 주소를 복사했어요'),
      () => showSnackbar(`복사하지 못했어요 · ${location.origin}`),
    );
  }
}

/**
 * 첫 요청부터 실패한 연결 오류 한 건 → 배너 문구와 해결 행동. 문구는 비교 화면 배너와 같다.
 * 오류 코드를 모르면 fallback 문구와 진단 열기.
 */
export function connectionIssue(e: unknown, fallback: string): { text: string; action: { label: string; target: ErrorActionTarget } } {
  const diag = { label: describeError('timeout').action!.label, target: 'diagnostics' as const };
  if (!(e instanceof ApiError)) return { text: fallback, action: diag };
  const d = describeError(e.code);
  return { text: d.title, action: d.action ?? diag };
}
