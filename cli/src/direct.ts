// 프록시와 같은 허용 목록으로 주문·쓰기 경로를 막고 증권사를 직접 부른다.
import { isAllowed, UPSTREAM } from '../../proxy/src/allowlist';
import { ApiError } from '../../src/lib/providers/errors';
import { createProxyClient, type ProxyClient } from '../../src/lib/providers/http';

export function createDirectClient(fetchImpl: typeof fetch = fetch): ProxyClient {
  const inner = createProxyClient({ baseUrl: '', fetchImpl, urlFor: (p, path) => `${UPSTREAM[p]}${path}` });
  return {
    request(provider, method, path, opts) {
      // 쿼리는 opts.query로만 받는다. 경로에 섞이면 허용 목록 검사를 통과하지 못한다.
      if (!isAllowed(provider, path, method)) return Promise.reject(new ApiError('path-blocked'));
      return inner.request(provider, method, path, opts);
    },
  };
}
