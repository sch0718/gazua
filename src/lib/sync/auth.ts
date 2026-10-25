// Firebase Auth(Spark, Google 로그인)를 감싼 인증 클라이언트. Firestore는 쓰지 않는다.
// SDK는 로그인 버튼을 누르거나 저장된 세션이 있을 때만 동적 import한다(로그인하지 않은 사용자의 첫 화면 번들은 그대로).
import type { SyncConfig } from './config';

export interface AuthUser {
  uid: string;
  email: string | null;
}

export interface AuthClient {
  /** SDK가 저장된 로그인 상태를 다 읽을 때까지 기다린 뒤의 사용자. */
  ready(): Promise<AuthUser | null>;
  /**
   * Google 로그인. 방금 로그인한 ID 토큰(auth_time이 지금)을 돌려준다.
   * 팝업이 막혀 리다이렉트로 넘어가면 'redirect'(페이지가 떠난다). 사용자가 닫으면 null.
   */
  signIn(): Promise<{ user: AuthUser; idToken: string } | 'redirect' | null>;
  /** 리다이렉트 로그인에서 돌아왔으면 그 결과. */
  redirectResult(): Promise<{ user: AuthUser; idToken: string } | null>;
  signOut(): Promise<void>;
  idToken(forceRefresh?: boolean): Promise<string | null>;
}

export function firebaseAuth(cfg: SyncConfig['firebase']): AuthClient {
  let loaded: Promise<typeof import('./firebaseImpl')> | null = null;
  const impl = () => (loaded ??= import('./firebaseImpl'));
  const auth = async () => (await impl()).getAuthFor(cfg);
  return {
    ready: async () => (await impl()).ready(await auth()),
    signIn: async () => (await impl()).signIn(await auth()),
    redirectResult: async () => (await impl()).redirectResult(await auth()),
    signOut: async () => (await impl()).signOut(await auth()),
    idToken: async (force) => (await impl()).idToken(await auth(), force),
  };
}
