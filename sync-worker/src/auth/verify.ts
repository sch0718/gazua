// Firebase ID 토큰 검증(공식 문서 「서드파티 JWT 라이브러리로 검증」 절의 조건)과 이메일 허용 목록.
import { decodeProtectedHeader, errors, jwtVerify } from 'jose';
import type { CertSource } from './certs';

export const CLOCK_SKEW_SEC = 60;

export interface VerifiedUser {
  sub: string;
  email: string;
  authTime: number; // epoch ms
}

export class AuthError extends Error {
  constructor(readonly code: 'missing-token' | 'invalid-token' | 'not-allowed') {
    super(code);
  }
}

/** Authorization: Bearer <token>. 없으면 null. */
export function bearer(req: Request): string | null {
  const h = req.headers.get('Authorization');
  const m = h ? /^Bearer ([A-Za-z0-9_.-]+)$/.exec(h) : null;
  return m ? m[1] : null;
}

export function parseAllowList(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * 서명(RS256, kid의 Google 공개키)·aud·iss·exp·iat·auth_time·sub를 검사하고, email_verified인 허용 이메일만 통과시킨다.
 * 인증서를 받지 못하면 CertsUnavailableError를 그대로 던진다(503).
 */
export async function verifyIdToken(
  token: string,
  opts: { projectId: string; certs: CertSource; now: number; allowedEmails: Set<string> },
): Promise<VerifiedUser> {
  if (!opts.projectId) throw new AuthError('invalid-token');
  let header: ReturnType<typeof decodeProtectedHeader>;
  try {
    header = decodeProtectedHeader(token);
  } catch {
    throw new AuthError('invalid-token');
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new AuthError('invalid-token');
  const key = await opts.certs.key(header.kid);
  if (!key) throw new AuthError('invalid-token');

  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, key, {
      algorithms: ['RS256'],
      audience: opts.projectId,
      issuer: `https://securetoken.google.com/${opts.projectId}`,
      currentDate: new Date(opts.now),
      clockTolerance: CLOCK_SKEW_SEC,
      requiredClaims: ['exp', 'iat', 'sub', 'auth_time'],
    }));
  } catch (e) {
    if (e instanceof errors.JOSEError) throw new AuthError('invalid-token');
    throw e;
  }
  const nowSec = opts.now / 1000;
  const iat = payload.iat;
  const authTime = payload.auth_time;
  const sub = payload.sub;
  if (typeof iat !== 'number' || iat > nowSec + CLOCK_SKEW_SEC) throw new AuthError('invalid-token');
  if (typeof authTime !== 'number' || authTime > nowSec + CLOCK_SKEW_SEC) throw new AuthError('invalid-token');
  if (typeof sub !== 'string' || sub === '' || sub.length > 128) throw new AuthError('invalid-token');

  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
  if (payload.email_verified !== true || !email || !opts.allowedEmails.has(email)) throw new AuthError('not-allowed');
  return { sub, email, authTime: authTime * 1000 };
}
