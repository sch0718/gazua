import { describe, expect, it } from 'vitest';
import { kstEpoch } from '../../time/kst';
import { ApiError } from '../../providers/errors';
import { connectionIssue, dominantFault, issueFaults, issueView, type LoadFault, type LoadIssue } from './loadIssue';

const NOW = kstEpoch('2026-10-12', '17:25:00');
const issue = (over: Partial<LoadIssue>): LoadIssue => ({
  code: 'upstream',
  at: NOW,
  allFailed: true,
  lastOkAt: kstEpoch('2026-10-12', '17:20:00'),
  ...over,
});

describe('dominantFault', () => {
  it('picks the most actionable connection-level code', () => {
    const f = (code: LoadIssue['code']) => ({ code, at: NOW });
    expect(dominantFault([f('upstream'), f('invalid-credentials'), f('rate-limited')])?.code).toBe('invalid-credentials');
    expect(dominantFault([f('upstream'), f('proxy-unreachable'), f('offline')])?.code).toBe('offline');
    expect(dominantFault([f('timeout'), f('rate-limited')])?.code).toBe('rate-limited');
    expect(dominantFault([])).toBeNull();
  });
});

describe('issueFaults', () => {
  const fault = (code: LoadFault['code']): LoadFault => ({ code, at: NOW });
  const many = (code: LoadFault['code'], n: number) => Array.from({ length: n }, () => fault(code));

  it('one flaky row does not raise the proxy banner but credentials still do', () => {
    const faults = issueFaults([fault('proxy-unreachable'), fault('invalid-credentials')], 8);
    expect(faults.map((x) => x.code)).toEqual(['invalid-credentials']);
    expect(dominantFault(faults)?.code).toBe('invalid-credentials');
  });

  it('keeps connection codes only when strictly more than half of the rows failed with that code', () => {
    expect(issueFaults(many('proxy-unreachable', 4), 8)).toEqual([]);
    expect(issueFaults(many('proxy-unreachable', 5), 8)).toHaveLength(5);
    expect(issueFaults(many('timeout', 4), 8)).toEqual([]);
    expect(issueFaults(many('timeout', 5), 8)).toHaveLength(5);
    expect(issueFaults(many('proxy-unreachable', 1), 1)).toHaveLength(1);
    expect(issueFaults(many('proxy-unreachable', 2), 2)).toHaveLength(2);
    expect(issueFaults(many('timeout', 1), 2)).toEqual([]);
  });

  it('counts each connection code separately', () => {
    const faults = [...many('proxy-unreachable', 3), ...many('timeout', 3)];
    expect(issueFaults(faults, 8)).toEqual([]);
  });

  it('never filters non-connection codes', () => {
    const faults = [fault('upstream'), fault('rate-limited'), fault('offline')];
    expect(issueFaults(faults, 8)).toEqual(faults);
  });
});

describe('issueView', () => {
  it('no issue → nothing', () => {
    expect(issueView(null, NOW)).toBeNull();
  });

  it('proxy unreachable → error banner with 진단 열기', () => {
    expect(issueView(issue({ code: 'proxy-unreachable' }), NOW)).toEqual({
      kind: 'banner',
      tone: 'error',
      text: '프록시에 연결할 수 없어요',
      action: { label: '진단 열기', target: 'diagnostics' },
    });
  });

  it('proxy redirect → error banner from describeError, ranked as a connection problem', () => {
    expect(issueView(issue({ code: 'proxy-redirect', allFailed: false }), NOW)).toEqual({
      kind: 'banner',
      tone: 'error',
      text: '프록시가 요청을 다른 주소로 보내려 해서 멈췄어요. 프록시 URL을 확인해 주세요',
      action: { label: '진단 열기', target: 'diagnostics' },
    });
    const f = (code: LoadIssue['code']) => ({ code, at: NOW });
    expect(dominantFault([f('upstream'), f('proxy-redirect'), f('invalid-credentials')])?.code).toBe('proxy-redirect');
    expect(dominantFault([f('proxy-redirect'), f('offline')])?.code).toBe('offline');
  });

  it('invalid credentials → error banner with 키 다시 입력', () => {
    expect(issueView(issue({ code: 'invalid-credentials', allFailed: false }), NOW)).toEqual({
      kind: 'banner',
      tone: 'error',
      text: '키가 맞지 않아요',
      action: { label: '키 다시 입력', target: 'credentials' },
    });
  });

  it('rate limited → toolbar notice, not a banner', () => {
    expect(issueView(issue({ code: 'rate-limited', allFailed: false }), NOW)).toEqual({
      kind: 'toolbar',
      text: '잠시 천천히 불러오는 중',
    });
  });

  it('offline → 오프라인 · HH:MM 기준 from the last success', () => {
    expect(issueView(issue({ code: 'offline' }), NOW)).toEqual({ kind: 'banner', tone: 'warn', text: '오프라인 · 17:20 기준' });
    expect(issueView(issue({ code: 'offline', lastOkAt: null }), NOW)).toEqual({ kind: 'banner', tone: 'warn', text: '오프라인이에요' });
  });

  it('token throttled → seconds left when the error carries Retry-After', () => {
    expect(issueView(issue({ code: 'token-throttled', retryAfterMs: 42_000, at: NOW - 2_000 }), NOW)).toEqual({
      kind: 'banner',
      tone: 'warn',
      text: 'KIS 토큰은 1분에 한 번만 받을 수 있어요 · 40초 남았어요',
    });
    expect(issueView(issue({ code: 'token-throttled' }), NOW)).toEqual({
      kind: 'banner',
      tone: 'warn',
      text: 'KIS 토큰은 1분에 한 번만 받을 수 있어요',
    });
  });

  it('timeout that passed the majority filter is a banner', () => {
    // 과반 판단은 issueFaults가 이미 했다: 여기 남은 timeout은 배너 대상이다.
    expect(issueView(issue({ code: 'timeout', allFailed: false }), NOW)).toMatchObject({ kind: 'banner', text: '응답이 늦어요' });
    expect(issueView(issue({ code: 'timeout' }), NOW)).toMatchObject({ kind: 'banner', text: '응답이 늦어요' });
  });

  it('row-level codes (upstream, path-blocked, token-expired) stay in their rows', () => {
    for (const code of ['upstream', 'path-blocked', 'token-expired'] as const) expect(issueView(issue({ code }), NOW)).toBeNull();
  });
});

describe('connectionIssue', () => {
  it('uses the banner copy and action of the error code', () => {
    expect(connectionIssue(new ApiError('invalid-credentials'), '종목 정보를 받지 못했어요')).toEqual({
      text: '키가 맞지 않아요',
      action: { label: '키 다시 입력', target: 'credentials' },
    });
  });

  it('codes without an action and unknown errors fall back to 진단 열기', () => {
    expect(connectionIssue(new ApiError('upstream'), 'x')).toEqual({
      text: '증권사 서버에서 오류가 났어요',
      action: { label: '진단 열기', target: 'diagnostics' },
    });
    expect(connectionIssue(new TypeError('fetch'), '종목 정보를 받지 못했어요')).toEqual({
      text: '종목 정보를 받지 못했어요',
      action: { label: '진단 열기', target: 'diagnostics' },
    });
  });
});
