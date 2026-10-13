import { createRequestQueue } from '../data/requestQueue';
import type { Settings } from '../state/schema';
import type { Secrets } from '../state/secrets';
import { sharedUniverse } from '../../sheets/universeSource';
import { createDemoProvider } from './demo';
import { createProxyClient } from './http';
import { createKisProvider } from './kis';
import { TOSS_QUEUE_RATES, createTossProvider } from './toss';
import type { IssuedAtStore, MarketDataProvider, TokenStore } from './types';

export interface ProviderFactoryDeps {
  now: () => number;
  fetchImpl?: typeof fetch;
  /** 공급자별 토큰 저장소. 잠금 모드면 호출자가 메모리 저장소를 준다. */
  tokenStore(provider: 'kis' | 'toss'): TokenStore;
  /** KIS 마지막 발급 시각 저장소(1분 제한 남은 초). 없으면 이 탭에서만 기억한다. */
  issuedAtStore?(provider: 'kis'): IssuedAtStore;
}

/** KIS 초당 20건의 80%. 큐는 받은 값을 그대로 쓴다. */
const KIS_QUEUE_RATES = { kis: 15 };

const filled = (...values: Array<string | undefined>): boolean => values.every((v) => !!v && v.trim() !== '');

/** 공급자가 demo이거나, 프록시 주소나 그 공급자의 키가 없으면 데모 공급자를 돌려준다. */
export function createProvider(
  s: Settings,
  secrets: Secrets | null,
  deps: ProviderFactoryDeps,
): MarketDataProvider {
  const { now, fetchImpl } = deps;
  const demo = () => createDemoProvider({ seed: 1, now, universe: sharedUniverse });
  if (s.provider === 'demo' || s.proxyUrl.trim() === '' || !secrets) return demo();

  const client = () => createProxyClient({ baseUrl: s.proxyUrl.trim(), proxyToken: secrets.proxyToken, fetchImpl });

  if (s.provider === 'kis') {
    const kis = secrets.kis;
    if (!kis || !filled(kis.appKey, kis.appSecret)) return demo();
    return createKisProvider({
      client: client(),
      queue: createRequestQueue({ ratesPerSec: KIS_QUEUE_RATES }),
      creds: kis,
      tokenStore: deps.tokenStore('kis'),
      ...(deps.issuedAtStore ? { issuedAt: deps.issuedAtStore('kis') } : {}),
      now,
    });
  }

  const toss = secrets.toss;
  if (!toss || !filled(toss.clientId, toss.clientSecret)) return demo();
  return createTossProvider({
    client: client(),
    queue: createRequestQueue({ ratesPerSec: { ...TOSS_QUEUE_RATES } }),
    creds: toss,
    tokenStore: deps.tokenStore('toss'),
    now,
  });
}
