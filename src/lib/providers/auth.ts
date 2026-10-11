import type { TokenInfo, TokenStore } from './types';

/** 만료까지 이 시간(ms)보다 적게 남으면 새로 발급한다. */
const REFRESH_MARGIN_MS = 60_000;

/**
 * 접근 토큰 관리자.
 * - 동시에 get()을 불러도 발급(issue)은 한 번만 일어난다.
 * - 발급이 실패하면 진행 중 표시를 지워 다음 get()이 다시 시도한다.
 * - invalidate() 이후의 get()은 저장소 값도 쓰지 않고 새로 발급한다.
 */
export function createTokenManager(
  issue: () => Promise<TokenInfo>,
  store: TokenStore,
  now: () => number,
): { get(): Promise<string>; invalidate(): void } {
  let current: TokenInfo | null = null;
  let loaded = false;
  let inflight: Promise<TokenInfo> | null = null;
  // invalidate()마다 올려서, 그 전에 시작한 발급 결과가 상태를 덮어쓰지 못하게 한다.
  let generation = 0;

  const fresh = (t: TokenInfo | null): t is TokenInfo => t !== null && t.expiresAt - now() >= REFRESH_MARGIN_MS;

  function startIssue(): Promise<TokenInfo> {
    const mine = generation;
    const p = issue().then(
      (token) => {
        if (mine === generation) {
          current = token;
          store.save(token);
        }
        if (inflight === p) inflight = null;
        return token;
      },
      (err) => {
        if (inflight === p) inflight = null;
        throw err;
      },
    );
    inflight = p;
    return p;
  }

  return {
    async get() {
      if (!loaded) {
        loaded = true;
        current = store.load();
      }
      if (fresh(current)) return current.accessToken;
      const token = await (inflight ?? startIssue());
      return token.accessToken;
    },
    invalidate() {
      generation++;
      current = null;
      loaded = true;
      inflight = null;
    },
  };
}
