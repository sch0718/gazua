export type Provider = 'kis' | 'toss';

export const UPSTREAM: Record<Provider, string> = {
  toss: 'https://openapi.tossinvest.com',
  kis: 'https://openapi.koreainvestment.com:9443',
};

const KIS_QUOTATIONS = '/uapi/domestic-stock/v1/quotations/';

interface Rules {
  exact: Record<string, readonly string[]>; // path -> methods
  patterns: Array<{ re: RegExp; methods: readonly string[] }>;
}

const RULES: Record<Provider, Rules> = {
  toss: {
    exact: {
      '/oauth2/token': ['POST'],
      '/api/v1/prices': ['GET'],
      '/api/v1/candles': ['GET'],
      '/api/v1/stocks': ['GET'],
      '/api/v1/market-calendar/KR': ['GET'],
    },
    patterns: [{ re: /^\/api\/v1\/market-indicators\/(KOSPI|KOSDAQ)\/candles$/, methods: ['GET'] }],
  },
  kis: {
    exact: {
      '/oauth2/tokenP': ['POST'],
      ...Object.fromEntries(
        [
          'inquire-price',
          'inquire-daily-itemchartprice',
          'inquire-time-dailychartprice',
          'search-stock-info',
          'chk-holiday',
          'inquire-daily-indexchartprice',
          'inquire-time-indexchartprice',
        ].map((name) => [KIS_QUOTATIONS + name, ['GET']] as const),
      ),
    },
    patterns: [],
  },
};

export function isProvider(value: string): value is Provider {
  return value === 'kis' || value === 'toss';
}

/** Exact path + method match. The query string is not part of `path`. */
export function isAllowed(provider: Provider, path: string, method: string): boolean {
  const rules = RULES[provider];
  if (Object.hasOwn(rules.exact, path)) return rules.exact[path].includes(method);
  return rules.patterns.some((p) => p.re.test(path) && p.methods.includes(method));
}
