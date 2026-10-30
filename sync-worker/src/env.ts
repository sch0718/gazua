import type { CertSource, D1Database, SocialProvider } from '@sch0718/firebase-session/worker';

export interface SyncEnv {
  DB: D1Database;
  /** 콤마로 구분한 허용 출처(정확히 일치). */
  ALLOWED_ORIGINS: string;
  /** Firebase 프로젝트 ID. 토큰의 aud·iss를 이것으로 검사한다. */
  FIREBASE_PROJECT_ID: string;
  /** 콤마로 구분한 허용 이메일(secret). 비어 있으면 아무도 들어오지 못한다. */
  ALLOWED_EMAILS?: string;
  /** 콤마로 구분한 허용 공급자 계정(secret). 비면 모두 거절한다. */
  ALLOWED_ACCOUNTS?: string;
  /** 카카오 로그인 클라이언트 ID(secret). 시크릿과 함께 있어야 켜진다. */
  KAKAO_CLIENT_ID?: string;
  /** 카카오 로그인 클라이언트 시크릿(secret). */
  KAKAO_CLIENT_SECRET?: string;
  /** 네이버 로그인 클라이언트 ID(secret). 시크릿과 함께 있어야 켜진다. */
  NAVER_CLIENT_ID?: string;
  /** 네이버 로그인 클라이언트 시크릿(secret). */
  NAVER_CLIENT_SECRET?: string;
  /** 콤마로 구분한 콜백 주소(var). 정확히 일치해야 하고 비면 모두 거절한다. */
  SOCIAL_REDIRECT_URIS?: string;
}

/** 테스트에서 바꿔 끼우는 것들. */
export interface SyncDeps {
  now: () => number;
  certs: CertSource;
  /** isolate마다 재사용하는 공급자별 공개키 캐시. */
  socialKeys: Record<SocialProvider, CertSource>;
  /** 테스트와 로컬 개발에서 공급자 토큰 교환을 바꿔 끼운다. */
  socialFetch?: typeof fetch;
  /** 32바이트 무작위 값. */
  random: (n: number) => Uint8Array;
  uuid: () => string;
  /** 메서드·경로 패턴·상태·시간만 받는다. 토큰·본문·이메일은 넘기지 않는다. */
  log: (line: string) => void;
}

export const DAY = 24 * 60 * 60 * 1000;
