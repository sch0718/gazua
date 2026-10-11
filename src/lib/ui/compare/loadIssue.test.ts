import { describe, expect, it } from 'vitest';
import { kstEpoch } from '../../time/kst';
import { dominantFault, issueView, type LoadIssue } from './loadIssue';

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

  it('timeout is a banner only when every row failed', () => {
    expect(issueView(issue({ code: 'timeout', allFailed: false }), NOW)).toBeNull();
    expect(issueView(issue({ code: 'timeout' }), NOW)).toMatchObject({ kind: 'banner', text: '응답이 늦어요' });
  });

  it('row-level codes (upstream, path-blocked, token-expired) stay in their rows', () => {
    for (const code of ['upstream', 'path-blocked', 'token-expired'] as const) expect(issueView(issue({ code }), NOW)).toBeNull();
  });
});
