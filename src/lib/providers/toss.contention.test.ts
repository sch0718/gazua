// 같은 키를 여러 기기·탭에서 쓸 때의 토큰 경합. 토스는 client당 유효한 토큰이 하나뿐이라
// 새로 발급하면 이전 토큰이 바로 401 token-revoked가 된다(2026-10-18 실연결 관찰).
// 고치기 전에는 기기 둘(저장소 따로)도, 저장소를 같이 쓰는 탭 둘도 매 호출마다 상대 토큰을 무효화하며 재발급했다.
import { describe, expect, it } from 'vitest';
import { createRequestQueue } from '../data/requestQueue';
import { storageTokenStore } from '../state/profileStore';
import { createSafeStorage } from '../state/storage';
import { kstEpoch } from '../time/kst';
import { ApiError } from './errors';
import type { ProxyClient, ProxyResponse } from './http';
import { createTossProvider, TOSS_REISSUE_INTERVAL_MS } from './toss';
import type { MarketDataProvider, TokenInfo, TokenLock, TokenStore } from './types';

const START = kstEpoch('2026-10-16', '10:00:00');
const POLL_MS = 10_000;
const RATES = { MARKET_DATA: 12, MARKET_DATA_CHART: 16, STOCK: 4, MARKET_INFO: 2.4, MARKET_INDICATOR_CHART: 4, ACCOUNT: 1, ASSET: 1, SECTOR: 1 };

/** 마지막으로 발급한 토큰만 받아 주는 토스 서버. 발급 시각을 남긴다. */
function tossServer(clock: { now: number }) {
  let n = 0;
  let valid = '';
  const issuedAt: number[] = [];
  const respond = (json: unknown): ProxyResponse => ({ status: 200, headers: new Headers(), json });
  const client: ProxyClient = {
    async request(_p, method, path, opts = {}) {
      if (method === 'POST' && path === '/oauth2/token') {
        issuedAt.push(clock.now);
        valid = `tok${++n}`;
        return respond({ access_token: valid, token_type: 'Bearer', expires_in: 86400 });
      }
      if (opts.headers?.authorization !== `Bearer ${valid}`) throw new ApiError('token-expired', undefined, { status: 401 });
      const symbols = (opts.query?.symbols ?? '').split(',');
      return respond({ result: symbols.map((symbol) => ({ symbol, lastPrice: '72000', timestamp: null })) });
    },
  };
  return { client, issuedAt };
}

function memoryStore(): TokenStore {
  let v: TokenInfo | null = null;
  return { load: () => v, save: (t) => (v = t) };
}

/** 탭 간 잠금(navigator.locks.request)과 같은 동작: 한 번에 하나만 실행한다. */
function mutex(): TokenLock {
  let tail: Promise<unknown> = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => {});
    return run;
  };
}

function app(client: ProxyClient, tokenStore: TokenStore, clock: { now: number }, tokenLock?: TokenLock): MarketDataProvider {
  return createTossProvider({
    client,
    queue: createRequestQueue({ ratesPerSec: RATES, now: () => 0, sleep: async () => {} }),
    creds: { clientId: 'id', clientSecret: 'secret' },
    tokenStore,
    ...(tokenLock ? { tokenLock } : {}),
    now: () => clock.now,
  });
}

const quote = (p: MarketDataProvider) => p.getQuotes(['005930'], 'UNIFIED');

/** 두 앱이 POLL_MS마다 번갈아 시세를 부른다. 실패한 오류 코드를 모은다. */
async function alternate(apps: MarketDataProvider[], clock: { now: number }, polls: number): Promise<string[]> {
  const failures: string[] = [];
  for (let i = 0; i < polls; i++) {
    for (const p of apps) {
      await quote(p).catch((e) => failures.push(e instanceof ApiError ? e.code : String(e)));
    }
    clock.now += POLL_MS;
  }
  return failures;
}

/** 각 기기가 발급한 간격이 모두 재발급 간격 이상인지(서버 기록은 섞여 있어 기기 수만큼 건너 비교한다). */
const minGap = (ts: number[], devices: number) =>
  Math.min(...ts.slice(devices).map((t, i) => t - ts[i]));

describe('toss token contention', () => {
  it('two devices with separate stores: re-issue at most once per interval each, and say why the rest fail', async () => {
    const clock = { now: START };
    const { client, issuedAt } = tossServer(clock);
    const polls = 30; // 5분
    const failures = await alternate([app(client, memoryStore(), clock), app(client, memoryStore(), clock)], clock, polls);
    // 고치기 전: 매 호출마다 발급(60회).
    expect(issuedAt.length).toBeLessThanOrEqual(2 + 2 * Math.ceil((polls * POLL_MS) / TOSS_REISSUE_INTERVAL_MS));
    expect(minGap(issuedAt, 2)).toBeGreaterThanOrEqual(TOSS_REISSUE_INTERVAL_MS);
    expect(failures.length).toBeGreaterThan(0);
    expect(new Set(failures)).toEqual(new Set(['token-contended']));
  });

  it('the contended error says how long until the next re-issue', async () => {
    const clock = { now: START };
    const { client } = tossServer(clock);
    const a = app(client, memoryStore(), clock);
    const b = app(client, memoryStore(), clock);
    await quote(a);
    await quote(b); // a의 토큰을 무효화
    clock.now += 15_000;
    const err = await quote(a).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('token-contended');
    expect(err.retryAfterMs).toBe(TOSS_REISSUE_INTERVAL_MS - 15_000);
    clock.now += TOSS_REISSUE_INTERVAL_MS;
    await expect(quote(a)).resolves.toHaveLength(1);
  });

  it('tabs sharing one store pick up the token another tab issued instead of re-issuing', async () => {
    const clock = { now: START };
    const { client, issuedAt } = tossServer(clock);
    const shared = memoryStore();
    const a = app(client, shared, clock);
    const b = app(client, shared, clock);
    await quote(a);
    await quote(b);
    expect(issuedAt).toHaveLength(1);
    // 세 번째 탭이 새로 받아 저장했다.
    clock.now += TOSS_REISSUE_INTERVAL_MS;
    const c = app(client, shared, clock);
    shared.save({ accessToken: 'stale-from-c', expiresAt: 0 }); // 만료된 값은 무시하고 발급
    await quote(c);
    expect(issuedAt).toHaveLength(2);
    const failures = await alternate([a, b, c], clock, 10);
    expect(failures).toEqual([]);
    expect(issuedAt).toHaveLength(2);
  });

  it('tabs sharing one store: after an outside issue (no save), one tab re-issues and the other reuses it', async () => {
    const clock = { now: START };
    const { client, issuedAt } = tossServer(clock);
    const shared = memoryStore();
    const a = app(client, shared, clock);
    const b = app(client, shared, clock);
    await quote(a);
    await quote(b);
    clock.now += TOSS_REISSUE_INTERVAL_MS;
    await client.request('toss', 'POST', '/oauth2/token'); // 점검 스크립트 등
    const failures = await alternate([a, b], clock, 10);
    expect(failures).toEqual([]);
    expect(issuedAt).toHaveLength(3);
  });

  it('two tabs on the same localStorage (the app\'s real token store) share the token', async () => {
    const clock = { now: START };
    const { client, issuedAt } = tossServer(clock);
    const data = new Map<string, string>();
    const local = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    } as unknown as Storage;
    const tab = () => app(client, storageTokenStore(createSafeStorage(local), 'p1.token.toss'), clock);
    const [a, b] = [tab(), tab()];
    await quote(a);
    clock.now += TOSS_REISSUE_INTERVAL_MS;
    await client.request('toss', 'POST', '/oauth2/token');
    expect(await alternate([a, b], clock, 10)).toEqual([]);
    expect(issuedAt).toHaveLength(3);
  });

  // PR #21 리뷰: 공유 저장소의 두 탭이 동시에 발급하고 먼저 보낸 응답이 늦게 오면, 무효가 된 토큰이 저장소를 덮어써
  // 한 탭이 1분간 막혔다. 브라우저의 탭 간 잠금(Web Locks)으로 발급을 한 번에 하나로 묶고, 잠금 안에서 저장소를 다시 읽는다.
  it('tabs sharing a store and a lock issue once even when they start together and the first reply is late', async () => {
    const clock = { now: START };
    const { client, issuedAt } = tossServer(clock);
    let releaseFirst!: () => void;
    const firstReply = new Promise<void>((r) => (releaseFirst = r));
    const slowFirst: ProxyClient = {
      async request(p, method, path, opts) {
        const res = client.request(p, method, path, opts);
        if (method === 'POST' && issuedAt.length === 1) await firstReply;
        return res;
      },
    };
    const shared = memoryStore();
    const lock = mutex();
    const a = app(slowFirst, shared, clock, lock);
    const b = app(slowFirst, shared, clock, lock);
    const qa = quote(a);
    const qb = quote(b);
    await Promise.resolve();
    releaseFirst();
    await expect(Promise.all([qa, qb])).resolves.toHaveLength(2);
    expect(issuedAt).toHaveLength(1);
    expect(shared.load()?.accessToken).toBe('tok1');
    expect(await alternate([a, b], clock, 5)).toEqual([]);
  });

  // PR #21 리뷰: 발급 뒤 시계가 뒤로 가면 "마지막 발급"이 미래가 되어 1분보다 오래 막혔다. 간격보다 먼 미래면 시계가 바뀐 것으로 본다.
  it('a clock moved backwards does not block re-issue for longer than the interval', async () => {
    const clock = { now: START };
    const { client, issuedAt } = tossServer(clock);
    const a = app(client, memoryStore(), clock);
    await quote(a);
    await client.request('toss', 'POST', '/oauth2/token'); // 다른 곳의 발급이 a의 토큰을 무효화
    clock.now -= 3_600_000; // 시계를 1시간 되돌림
    await expect(quote(a)).resolves.toHaveLength(1);
    expect(issuedAt).toHaveLength(3);
  });

  it('a token restored from the store that turns out revoked is replaced without a contended error', async () => {
    const clock = { now: START };
    const { client, issuedAt } = tossServer(clock);
    const store = memoryStore();
    store.save({ accessToken: 'revoked-yesterday', expiresAt: START + 3_600_000 });
    await expect(quote(app(client, store, clock))).resolves.toHaveLength(1);
    expect(issuedAt).toHaveLength(1);
  });
});
