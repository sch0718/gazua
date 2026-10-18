import type { TokenLock } from './types';

/** 브라우저의 탭 간 잠금(Web Locks)으로 만든 토큰 발급 잠금. 지원하지 않는 환경(null)이면 undefined. */
export function webTokenLock(
  name: string,
  locks: LockManager | null | undefined = globalThis.navigator?.locks,
): TokenLock | undefined {
  if (!locks) return undefined;
  // request는 콜백이 돌려준 Promise가 끝날 때까지 잠금을 쥐고, 그 결과로 끝난다.
  return <T>(fn: () => Promise<T>) => locks.request(name, () => fn()) as Promise<T>;
}
