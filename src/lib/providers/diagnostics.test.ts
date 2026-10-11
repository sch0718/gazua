import { describe, expect, it, vi } from 'vitest';
import type { Secrets } from '../state/secrets';
import { runDiagnostics, type DiagStep } from './diagnostics';
import kisPrice from './fixtures/kis/inquire-price-005930.json';
import kisToken from './fixtures/kis/token.json';
import tossPrices from './fixtures/toss/prices.json';
import tossToken from './fixtures/toss/token.json';

const PROXY = 'https://proxy.example.net';
const ORIGIN = 'https://me.github.io';
const KIS: Secrets = { kis: { appKey: 'PSkisAppKey-0123456789', appSecret: 'kisSecret/ABCDEFGHIJKLMNOP' } };
const TOSS: Secrets = {
  toss: { clientId: 'toss-client-id-55aa', clientSecret: 'toss-secret-ZZZ999' },
  proxyToken: 'proxy-token-xyz-424242',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Handler = (url: string, init: RequestInit | undefined) => Response | Promise<Response>;

/** 경로별로 답하는 가짜 fetch. 정해지지 않은 경로는 실패시킨다. */
function fakeFetch(routes: { health?: Handler; healthNoCors?: Handler; token?: Handler; price?: Handler }) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === `${PROXY}/health`) {
      const h = init?.mode === 'no-cors' ? routes.healthNoCors : routes.health;
      return h ? h(url, init) : new Response(null, { status: 200 });
    }
    if (url.includes('/oauth2/')) return routes.token!(url, init);
    if (url.includes('inquire-price') || url.includes('/api/v1/prices')) return routes.price!(url, init);
    throw new Error(`unexpected ${url}`);
  });
}

function run(provider: 'kis' | 'toss', secrets: Secrets, fetchImpl: typeof fetch, extra: { proxyToken?: string } = {}) {
  const seen: DiagStep[][] = [];
  const done = runDiagnostics({
    proxyUrl: PROXY,
    provider,
    secrets,
    fetchImpl,
    origin: ORIGIN,
    onStep: (s) => seen.push(s),
    ...extra,
  });
  return { done, seen };
}

describe('runDiagnostics', () => {
  it('KIS: all four steps succeed and record ms', async () => {
    const f = fakeFetch({ token: () => json(kisToken), price: () => json(kisPrice) });
    const { done, seen } = run('kis', KIS, f);
    const steps = await done;
    expect(steps.map((s) => s.label)).toEqual(['프록시 응답', 'CORS 허용', '토큰 발급', '시세 조회 (삼성전자)']);
    expect(steps.map((s) => s.status)).toEqual(['ok', 'ok', 'ok', 'ok']);
    for (const s of steps) expect(typeof s.ms).toBe('number');
    // ① no-cors, ② 일반 fetch
    expect(f.mock.calls[0][0]).toBe(`${PROXY}/health`);
    expect(f.mock.calls[0][1]).toMatchObject({ mode: 'no-cors' });
    expect(f.mock.calls[1][0]).toBe(`${PROXY}/health`);
    expect(f.mock.calls[1][1]?.mode).toBeUndefined();
    // ③ KIS 토큰 POST JSON, ④ inquire-price J 005930 + 받은 토큰
    const [tokenUrl, tokenInit] = f.mock.calls[2];
    expect(String(tokenUrl)).toBe(`${PROXY}/kis/oauth2/tokenP`);
    expect(tokenInit?.method).toBe('POST');
    expect(JSON.parse(String(tokenInit?.body))).toEqual({
      grant_type: 'client_credentials',
      appkey: KIS.kis!.appKey,
      appsecret: KIS.kis!.appSecret,
    });
    const [priceUrl, priceInit] = f.mock.calls[3];
    expect(String(priceUrl)).toContain('/kis/uapi/domestic-stock/v1/quotations/inquire-price?');
    expect(String(priceUrl)).toContain('FID_COND_MRKT_DIV_CODE=J');
    expect(String(priceUrl)).toContain('FID_INPUT_ISCD=005930');
    const headers = new Headers(priceInit?.headers);
    expect(headers.get('authorization')).toBe('Bearer test-access-token');
    expect(headers.get('tr_id')).toBe('FHKST01010100');
    // 단계마다 새 배열로 알리고, 처음엔 running이 보인다.
    expect(seen.length).toBeGreaterThanOrEqual(8);
    expect(seen[0]).not.toBe(seen[1]);
    expect(seen[0][0].status).toBe('running');
    expect(seen[0].slice(1).every((s) => s.status === 'pending')).toBe(true);
    expect(seen.at(-1)).toEqual(steps);
  });

  it('Toss: token is a form POST and prices use symbols=005930; proxy token goes to the proxy only', async () => {
    const f = fakeFetch({ token: () => json(tossToken), price: () => json(tossPrices) });
    const steps = await run('toss', TOSS, f).done;
    expect(steps.every((s) => s.status === 'ok')).toBe(true);
    const [tokenUrl, tokenInit] = f.mock.calls[2];
    expect(String(tokenUrl)).toBe(`${PROXY}/toss/oauth2/token`);
    const tokenHeaders = new Headers(tokenInit?.headers);
    expect(tokenHeaders.get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(tokenHeaders.get('x-proxy-token')).toBe(TOSS.proxyToken);
    expect(new URLSearchParams(String(tokenInit?.body)).get('client_id')).toBe(TOSS.toss!.clientId);
    expect(String(f.mock.calls[3][0])).toBe(`${PROXY}/toss/api/v1/prices?symbols=005930`);
    // /health는 사전 요청(preflight)이 생기지 않게 사용자 지정 헤더 없이 부른다.
    expect(new Headers(f.mock.calls[1][1]?.headers).has('x-proxy-token')).toBe(false);
  });

  it('① fails as proxy-unreachable when even a no-cors request fails; the rest are skipped', async () => {
    const f = fakeFetch({
      healthNoCors: () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const steps = await run('kis', KIS, f).done;
    expect(steps[0]).toMatchObject({ status: 'fail', error: 'proxy-unreachable' });
    expect(steps[0].hint).toBeTruthy();
    expect(steps.slice(1).map((s) => s.status)).toEqual(['skipped', 'skipped', 'skipped']);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('① ok · ② TypeError → cors-blocked with the origin to allow, later steps skipped', async () => {
    const f = fakeFetch({
      health: () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const steps = await run('kis', KIS, f).done;
    expect(steps[0].status).toBe('ok');
    expect(steps[1]).toMatchObject({ status: 'fail', error: 'cors-blocked', copy: ORIGIN });
    expect(steps[1].hint).toBe(`프록시 ALLOWED_ORIGINS에 ${ORIGIN}을 넣어 주세요`);
    expect(steps[2].status).toBe('skipped');
    expect(steps[3].status).toBe('skipped');
  });

  it('② non-2xx with a proxy error code is classified', async () => {
    const f = fakeFetch({ health: () => json({ error: { code: 'origin-not-allowed' } }, 403) });
    const steps = await run('kis', KIS, f).done;
    expect(steps[1]).toMatchObject({ status: 'fail', error: 'origin-not-allowed', copy: ORIGIN });
  });

  it('③ Toss 403 ip-not-allowed → hint points at 허용 IP 관리, ④ skipped', async () => {
    const f = fakeFetch({ token: () => json({ error: 'access_denied' }, 403) });
    const steps = await run('toss', TOSS, f).done;
    expect(steps[2]).toMatchObject({ status: 'fail', error: 'ip-not-allowed' });
    expect(steps[2].hint).toContain('토스증권 WTS › 설정 › Open API › 허용 IP 관리');
    expect(steps[3].status).toBe('skipped');
  });

  it('③ hints for invalid credentials, KIS token throttling and a wrong proxy token', async () => {
    const invalid = await run('toss', TOSS, fakeFetch({ token: () => json({ error: 'invalid_client' }, 401) })).done;
    expect(invalid[2]).toMatchObject({ error: 'invalid-credentials', hint: '키를 다시 확인해 주세요' });

    const throttled = await run('kis', KIS, fakeFetch({ token: () => json({ error_code: 'EGW00133' }, 403) })).done;
    expect(throttled[2]).toMatchObject({
      error: 'token-throttled',
      hint: 'KIS 토큰은 1분에 한 번만 받을 수 있어요. 잠시 뒤 다시 진단해 주세요',
    });

    const proxyToken = await run(
      'kis',
      KIS,
      fakeFetch({ token: () => json({ error: { code: 'proxy-token-invalid' } }, 401) }),
    ).done;
    expect(proxyToken[2].error).toBe('proxy-token-invalid');
  });

  it('③ fails without calling the proxy when the provider keys are missing', async () => {
    const f = fakeFetch({});
    const steps = await run('kis', { proxyToken: 'x' }, f).done;
    expect(steps[2]).toMatchObject({ status: 'fail', error: 'invalid-credentials' });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('④ fails when no price can be read', async () => {
    const f = fakeFetch({ token: () => json(kisToken), price: () => json({ rt_cd: '0', output: {} }) });
    const steps = await run('kis', KIS, f).done;
    expect(steps[3]).toMatchObject({ status: 'fail', error: 'upstream' });
  });

  it('a blank proxy URL fails step ① without any request', async () => {
    const f = fakeFetch({});
    const steps = await runDiagnostics({ proxyUrl: '  ', provider: 'kis', secrets: KIS, fetchImpl: f, onStep: () => {} });
    expect(steps[0]).toMatchObject({ status: 'fail', error: 'proxy-unreachable', hint: '프록시 URL을 입력해 주세요' });
    expect(f).not.toHaveBeenCalled();
  });

  it('never puts keys, secrets or tokens into the steps', async () => {
    const outputs: string[] = [];
    for (const token of [
      () => json({ error: 'access_denied' }, 403),
      () => json({ error: 'invalid_client' }, 401),
      () => json({ error: { code: 'proxy-token-invalid' } }, 401),
      () => json(tossToken),
    ]) {
      const f = fakeFetch({ token, price: () => json({ result: [] }) });
      const { done, seen } = run('toss', TOSS, f);
      outputs.push(JSON.stringify(await done), JSON.stringify(seen));
    }
    const all = outputs.join('\n');
    for (const secret of [TOSS.toss!.clientId, TOSS.toss!.clientSecret, TOSS.proxyToken!, 'test-access-token']) {
      expect(all).not.toContain(secret);
    }
  });
});
