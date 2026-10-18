import type { IssuedAtStore, TokenInfo, TokenLock, TokenStore } from './types';

/** 만료까지 이 시간(ms)보다 적게 남으면 새로 발급한다. */
const REFRESH_MARGIN_MS = 60_000;

/**
 * 접근 토큰 관리자.
 * - 동시에 get()을 불러도 발급(issue)은 한 번만 일어난다.
 * - 발급이 실패하면 진행 중 표시를 지워 다음 get()이 다시 시도한다.
 * - 갖고 있는 토큰이 없거나 만료가 가까우면, 발급하기 전에 저장소를 다시 읽는다(같은 저장소를 쓰는 다른 탭이 받은 토큰).
 * - invalidate(token)은 그 토큰(없으면 지금 토큰)을 버린다. 이후 저장소에 같은 토큰만 있으면 새로 발급한다.
 * - 발급에 성공하면 그 시각을 issuedAt에 기록한다(무효화된 발급도 증권사는 센다).
 * - lock이 있으면 발급과 저장을 그 잠금 안에서 한다. 잠금을 기다리는 동안 다른 탭이 받아 저장한 토큰이 있으면
 *   발급하지 않고 그 토큰을 쓴다. 같은 저장소를 쓰는 탭이 동시에 발급해 무효가 된 토큰이 저장소를 덮어쓰지 않게 한다.
 */
export function createTokenManager(
  issue: () => Promise<TokenInfo>,
  store: TokenStore,
  now: () => number,
  issuedAt?: IssuedAtStore,
  lock?: TokenLock,
): {
  get(): Promise<string>;
  info(): Promise<TokenInfo>;
  invalidate(token?: string): void;
  lastIssuedAt(): number | null;
} {
  let current: TokenInfo | null = null;
  // 저장소에 쓰지 못해도 이 탭에서는 기억한다.
  let issuedHere: number | null = null;
  // 서버가 거절한 토큰. 저장소에 남아 있어도 다시 쓰지 않는다.
  const rejected = new Set<string>();
  let inflight: Promise<TokenInfo> | null = null;
  // invalidate()마다 올려서, 그 전에 시작한 발급 결과가 상태를 덮어쓰지 못하게 한다.
  let generation = 0;

  const fresh = (t: TokenInfo | null): t is TokenInfo => t !== null && t.expiresAt - now() >= REFRESH_MARGIN_MS;

  /** 저장소의 토큰이 쓸 만하면(만료 전·거절된 적 없음) 돌려준다. */
  function usableStored(): TokenInfo | null {
    const stored = store.load();
    return fresh(stored) && !rejected.has(stored.accessToken) ? stored : null;
  }

  function startIssue(): Promise<TokenInfo> {
    const mine = generation;
    const issueAndSave = async (): Promise<TokenInfo> => {
      // 잠금을 기다리는 동안 다른 탭이 받아 둔 토큰.
      if (lock) {
        const stored = usableStored();
        if (stored) return stored;
      }
      const token = await issue();
      issuedHere = now();
      try {
        issuedAt?.save(issuedHere);
      } catch {
        // 시각을 저장하지 못해도 토큰은 쓴다.
      }
      if (mine === generation) {
        try {
          store.save(token);
        } catch {
          // 저장 실패(용량 초과·시크릿 모드 등)가 유효한 토큰을 버리게 하지 않는다.
        }
      }
      return token;
    };
    const p = (lock ? lock(issueAndSave) : issueAndSave()).then(
      (token) => {
        if (mine === generation) current = token;
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

  async function info(): Promise<TokenInfo> {
    if (fresh(current)) return current;
    const stored = usableStored();
    if (stored) {
      current = stored;
      return stored;
    }
    return inflight ?? startIssue();
  }

  return {
    async get() {
      return (await info()).accessToken;
    },
    /** get()과 같지만 만료 시각까지 돌려준다(연결 진단이 같은 토큰을 쓰도록). */
    info,
    invalidate(token) {
      const bad = token ?? current?.accessToken;
      if (bad !== undefined) rejected.add(bad);
      generation++;
      current = null;
      inflight = null;
    },
    /** 이 탭 또는 저장소(새로고침 전·진단의 발급)에 남은 가장 늦은 발급 시각. 모르면 null. */
    lastIssuedAt() {
      let stored: number | null = null;
      try {
        stored = issuedAt?.load() ?? null;
      } catch {
        stored = null;
      }
      if (stored === null) return issuedHere;
      return issuedHere === null ? stored : Math.max(stored, issuedHere);
    },
  };
}
