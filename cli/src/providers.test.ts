import { chmodSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildProvider } from './providers';
import { createRedactor } from './output';
import { parseArgv } from './args';
import { cleanupDirs, tempDir } from './testing';
import type { Ctx } from './context';

afterEach(cleanupDirs);

function ctxFor(dir: string, fetchImpl: typeof fetch, warnings: string[] = []): Ctx {
  return {
    args: parseArgv(['quote']),
    env: {},
    fetch: fetchImpl,
    now: Date.now,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    hostname: () => 'h',
    dir,
    say: () => {},
    log: () => {},
    warn: (m) => void warnings.push(m),
    redact: createRedactor(),
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const CREDS = { toss: { clientId: 'toss-client-id-1', clientSecret: 'toss-client-secret-1' } };
const TOKEN = 'access-token-1';

/** ト큰 발급 횟수를 세는 가짜 토스. rejectToken이면 모든 데이터 요청을 401로 거절한다 */
function tossFetch() {
  const seen = { issued: 0, rejectToken: false };
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === '/oauth2/token') {
      seen.issued++;
      await new Promise((r) => setTimeout(r, 30));
      return json({ access_token: TOKEN, expires_in: 86_400 });
    }
    if (url.pathname === '/api/v1/prices' && !seen.rejectToken && new Headers(init?.headers).get('authorization') === `Bearer ${TOKEN}`) {
      return json({ result: (url.searchParams.get('symbols') ?? '').split(',').map((symbol) => ({ symbol, lastPrice: '72000', timestamp: '2026-11-02T09:00:00+09:00' })) });
    }
    return json({ error: 'token-revoked' }, 401);
  }) as typeof fetch;
  return { f, seen };
}

describe('buildProvider', () => {
  it('같은 키로 동시에 돈 두 실행은 토큰을 한 번만 발급하고 파일에는 해시·토큰·발급 시각만 남긴다', async () => {
    const dir = tempDir();
    const { f, seen } = tossFetch();
    const a = buildProvider(ctxFor(dir, f), 'toss', CREDS);
    const b = buildProvider(ctxFor(dir, f), 'toss', CREDS);
    const [qa, qb] = await Promise.all([a.provider.getQuotes(['005930'], 'UNIFIED'), b.provider.getQuotes(['000660'], 'UNIFIED')]);
    expect(qa[0]).toMatchObject({ symbol: '005930', price: 72000 });
    expect(qb[0]).toMatchObject({ symbol: '000660', price: 72000 });
    expect(seen.issued).toBe(1);
    const text = readFileSync(join(dir, 'tokens-toss.json'), 'utf8');
    expect(JSON.parse(text)).toMatchObject({ v: 1, keyHash: a.keyHash, accessToken: TOKEN, issuedAt: expect.any(Number) });
    expect(text).not.toContain('toss-client-secret-1');
    if (process.platform !== 'win32') expect(statSync(join(dir, 'tokens-toss.json')).mode & 0o777).toBe(0o600);
  });

  it('이미 받은 토큰이 파일에 있으면 새 실행은 발급하지 않는다', async () => {
    const dir = tempDir();
    const { f, seen } = tossFetch();
    await buildProvider(ctxFor(dir, f), 'toss', CREDS).provider.getQuotes(['005930'], 'UNIFIED');
    await buildProvider(ctxFor(dir, f), 'toss', CREDS).provider.getQuotes(['005930'], 'UNIFIED');
    expect(seen.issued).toBe(1);
  });

  it('재시작 뒤 캐시 토큰이 거절돼도 1분 안이면 재발급하지 않고 token-contended', async () => {
    const dir = tempDir();
    const { f, seen } = tossFetch();
    await buildProvider(ctxFor(dir, f), 'toss', CREDS).provider.getQuotes(['005930'], 'UNIFIED');
    seen.rejectToken = true;
    await expect(buildProvider(ctxFor(dir, f), 'toss', CREDS).provider.getQuotes(['005930'], 'UNIFIED')).rejects.toMatchObject({ code: 'token-contended' });
    expect(seen.issued).toBe(1);
  });

  it('키(clientId)가 바뀌면 캐시를 버리고 다시 발급한다', async () => {
    const dir = tempDir();
    const { f, seen } = tossFetch();
    await buildProvider(ctxFor(dir, f), 'toss', CREDS).provider.getQuotes(['005930'], 'UNIFIED');
    await buildProvider(ctxFor(dir, f), 'toss', { toss: { clientId: 'toss-client-id-2', clientSecret: 'toss-client-secret-1' } }).provider.getQuotes(['005930'], 'UNIFIED');
    expect(seen.issued).toBe(2);
  });

  it('키와 접근 토큰(발급한 것·파일에서 읽은 것)을 출력 거르기에 등록한다', async () => {
    const dir = tempDir();
    const { f } = tossFetch();
    const issuing = ctxFor(dir, f);
    await buildProvider(issuing, 'toss', CREDS).provider.getQuotes(['005930'], 'UNIFIED');
    expect(issuing.redact.apply({ message: `x toss-client-secret-1 y toss-client-id-1 z ${TOKEN}` })).toEqual({ message: 'x [숨김] y [숨김] z [숨김]' });
    const reading = ctxFor(dir, f);
    await buildProvider(reading, 'toss', CREDS).provider.getQuotes(['005930'], 'UNIFIED');
    expect(reading.redact.apply({ message: TOKEN })).toEqual({ message: '[숨김]' });
  });

  it.skipIf(process.platform === 'win32')('토큰 파일 644·디렉터리 755면 로그인 없이도 warnings로 알린다', async () => {
    const dir = tempDir();
    const { f } = tossFetch();
    await buildProvider(ctxFor(dir, f), 'toss', CREDS).provider.getQuotes(['005930'], 'UNIFIED');
    chmodSync(join(dir, 'tokens-toss.json'), 0o644);
    chmodSync(dir, 0o755);
    const warnings: string[] = [];
    await buildProvider(ctxFor(dir, f, warnings), 'toss', CREDS).provider.getQuotes(['005930'], 'UNIFIED');
    expect(warnings.some((m) => m.includes('tokens-toss.json') && m.includes('chmod 600'))).toBe(true);
    expect(warnings.some((m) => m.includes('chmod 700'))).toBe(true);
  });
});
