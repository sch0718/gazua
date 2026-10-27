import type { CertSource, D1Database } from '@sch0718/firebase-session/worker';

export interface SyncEnv {
  DB: D1Database;
  /** 콤마로 구분한 허용 출처(정확히 일치). */
  ALLOWED_ORIGINS: string;
  /** Firebase 프로젝트 ID. 토큰의 aud·iss를 이것으로 검사한다. */
  FIREBASE_PROJECT_ID: string;
  /** 콤마로 구분한 허용 이메일(secret). 비어 있으면 아무도 들어오지 못한다. */
  ALLOWED_EMAILS?: string;
}

/** 테스트에서 바꿔 끼우는 것들. */
export interface SyncDeps {
  now: () => number;
  certs: CertSource;
  /** 32바이트 무작위 값. */
  random: (n: number) => Uint8Array;
  uuid: () => string;
  /** 메서드·경로 패턴·상태·시간만 받는다. 토큰·본문·이메일은 넘기지 않는다. */
  log: (line: string) => void;
}

export const DAY = 24 * 60 * 60 * 1000;
