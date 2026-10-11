// 비교 화면의 마지막 로딩 오류 → 상단 배너·툴바 안내(스펙 11절).
// 종목 단위 오류(upstream 등)는 그 행에만 보이고, 연결 수준 오류만 화면 위쪽에 알린다.
import { describeError, type ErrorActionTarget, type ErrorCode } from '../../providers/errors';
import { kstHHMM } from './compareText';

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

/** 어느 종목에서 나도 화면 전체의 문제인 코드(연결·키·권한). */
const BANNER_CODES: ErrorCode[] = [
  'proxy-unreachable',
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
    case 'timeout':
      return issue.allFailed ? { kind: 'banner', tone: 'error', text: d.title, ...(d.action ? { action: d.action } : {}) } : null;
  }
  if (!BANNER_CODES.includes(issue.code)) return null;
  return { kind: 'banner', tone: 'error', text: d.title, ...(d.action ? { action: d.action } : {}) };
}
