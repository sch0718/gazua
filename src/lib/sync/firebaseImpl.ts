// Firebase 웹 SDK 호출부. auth.ts가 동적 import해서 별도 청크가 된다.
import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  getRedirectResult,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  initializeAuth,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut,
  type Auth,
  type User,
} from 'firebase/auth';
import type { SyncConfig } from './config';
import type { AuthUser } from './auth';

let instance: Auth | null = null;

export function getAuthFor(cfg: SyncConfig['firebase']): Auth {
  if (instance) return instance;
  const app: FirebaseApp = getApps()[0] ?? initializeApp(cfg);
  instance = initializeAuth(app, {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence],
    popupRedirectResolver: browserPopupRedirectResolver,
  });
  return instance;
}

const toUser = (u: User): AuthUser => ({ uid: u.uid, email: u.email });

function provider() {
  const p = new GoogleAuthProvider();
  // 여러 Google 계정이 있으면 고르게 한다(허용 목록 밖 계정으로 조용히 들어가지 않게)
  p.setCustomParameters({ prompt: 'select_account' });
  return p;
}

export async function ready(auth: Auth): Promise<AuthUser | null> {
  await auth.authStateReady();
  return auth.currentUser ? toUser(auth.currentUser) : null;
}

export async function signIn(auth: Auth): Promise<{ user: AuthUser; idToken: string } | 'redirect' | null> {
  try {
    const cred = await signInWithPopup(auth, provider());
    return { user: toUser(cred.user), idToken: await cred.user.getIdToken() };
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, provider());
      return 'redirect';
    }
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return null;
    throw e;
  }
}

export async function redirectResult(auth: Auth): Promise<{ user: AuthUser; idToken: string } | null> {
  const cred = await getRedirectResult(auth);
  return cred ? { user: toUser(cred.user), idToken: await cred.user.getIdToken() } : null;
}

export async function signOut(auth: Auth): Promise<void> {
  await fbSignOut(auth);
}

export async function idToken(auth: Auth, force = false): Promise<string | null> {
  await auth.authStateReady();
  return auth.currentUser ? auth.currentUser.getIdToken(force) : null;
}
