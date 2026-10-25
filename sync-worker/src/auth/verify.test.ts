import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importPKCS8, SignJWT, UnsecuredJWT } from 'jose';
import { googleCerts, CertsUnavailableError } from './certs';
import { verifyIdToken, AuthError, parseAllowList } from './verify';
import { harness, otherKeys, PROJECT, ME, T0 } from '../../test/harness';

const h = harness();
const certs = h.deps.certs;
const allowed = parseAllowList(`${ME}, Other@Example.test`);
const verify = (t: string, now = T0, list = allowed) => verifyIdToken(t, { projectId: PROJECT, certs, now, allowedEmails: list });
const rejects = async (t: string | Promise<string>, code: AuthError['code'] = 'invalid-token', now = T0) => {
  const err = await verify(await t, now).catch((e) => e);
  expect(err).toBeInstanceOf(AuthError);
  expect(err.code).toBe(code);
};
const sec = T0 / 1000;

describe('verifyIdToken', () => {
  it('맞는 토큰은 sub·email·auth_time을 돌려준다', async () => {
    expect(await verify(await h.token())).toEqual({ sub: 'uid-me', email: ME, authTime: T0 });
  });

  it('허용 이메일은 대소문자를 가리지 않는다', async () => {
    expect((await verify(await h.token({ email: 'OTHER@example.TEST' }))).email).toBe('other@example.test');
  });

  it('서명이 다르거나 모르는 kid면 거절한다', async () => {
    await rejects(h.token({}, { key: otherKeys.privateKey }));
    await rejects(h.token({}, { kid: 'nope' }));
  });

  it('alg none·HS256은 거절한다', async () => {
    const none = new UnsecuredJWT({ sub: 'uid-me', aud: PROJECT }).encode();
    await rejects(none);
    const hs = await new SignJWT({ sub: 'uid-me' }).setProtectedHeader({ alg: 'HS256', kid: 'k1' }).sign(new Uint8Array(32));
    await rejects(hs);
  });

  it('aud·iss가 다르면 거절한다', async () => {
    await rejects(h.token({ aud: 'other-project' }));
    await rejects(h.token({ iss: 'https://securetoken.google.com/other-project' }));
    await rejects(h.token({ iss: 'https://accounts.google.com' }));
  });

  it('만료(exp)는 60초 여유 뒤 거절한다', async () => {
    await rejects(h.token({ exp: sec - 61 }));
    expect(await verify(await h.token({ exp: sec - 30 }))).toBeTruthy();
    await rejects(h.token({ exp: undefined }));
  });

  it('iat·auth_time이 미래면 거절한다', async () => {
    await rejects(h.token({ iat: sec + 120 }));
    await rejects(h.token({ auth_time: sec + 120 }));
    await rejects(h.token({ auth_time: undefined }));
    await rejects(h.token({ auth_time: 'yesterday' }));
  });

  it('sub가 비었거나 128자를 넘으면 거절한다', async () => {
    await rejects(h.token({ sub: '' }));
    await rejects(h.token({ sub: 'x'.repeat(129) }));
  });

  it('email_verified가 아니거나 허용 목록 밖이면 거절한다', async () => {
    await rejects(h.token({ email_verified: false }), 'not-allowed');
    await rejects(h.token({ email_verified: 'true' }), 'not-allowed');
    await rejects(h.token({ email: 'stranger@example.test' }), 'not-allowed');
    await rejects(h.token({ email: undefined }), 'not-allowed');
  });

  it('허용 목록이 비어 있으면 아무도 들어오지 못한다', async () => {
    const err = await verify(await h.token(), T0, parseAllowList('')).catch((e) => e);
    expect(err.code).toBe('not-allowed');
    const err2 = await verify(await h.token(), T0, parseAllowList(undefined)).catch((e) => e);
    expect(err2.code).toBe('not-allowed');
  });

  it('프로젝트 ID가 설정되지 않았으면 거절한다', async () => {
    const err = await verifyIdToken(await h.token(), { projectId: '', certs, now: T0, allowedEmails: allowed }).catch((e) => e);
    expect(err.code).toBe('invalid-token');
  });

  it('검증 1회 시간(무료 CPU 10ms 예산 참고용)', async () => {
    const t = await h.token();
    await verify(t);
    const n = 50;
    const start = performance.now();
    for (let i = 0; i < n; i++) await verify(t);
    const per = (performance.now() - start) / n;
    console.log(`verifyIdToken: ${per.toFixed(3)}ms/회 (Node, 참고값)`);
    expect(per).toBeLessThan(10);
  });
});

describe('googleCerts', () => {
  it('x509 인증서로 실제 서명을 검증한다(openssl로 만든 지어낸 인증서)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gazua-cert-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'), '-subj', '/CN=test', '-days', '1'], { stdio: 'ignore' });
    const cert = readFileSync(join(dir, 'c.pem'), 'utf8');
    const priv = await importPKCS8(readFileSync(join(dir, 'k.pem'), 'utf8'), 'RS256');
    const c = googleCerts((async () => new Response(JSON.stringify({ kx: cert }))) as unknown as typeof fetch, () => T0);
    const t = await h.token({}, { kid: 'kx', key: priv });
    expect(await verifyIdToken(t, { projectId: PROJECT, certs: c, now: T0, allowedEmails: allowed })).toMatchObject({ sub: 'uid-me' });
    const wrong = await h.token({}, { kid: 'kx' });
    await expect(verifyIdToken(wrong, { projectId: PROJECT, certs: c, now: T0, allowedEmails: allowed })).rejects.toBeInstanceOf(AuthError);
  });

  it('max-age만큼 캐시하고 지나면 다시 받는다', async () => {
    let calls = 0;
    let now = T0;
    const fetchImpl = (async () => {
      calls++;
      return new Response('{}', { headers: { 'Cache-Control': 'public, max-age=100, must-revalidate' } });
    }) as unknown as typeof fetch;
    const c = googleCerts(fetchImpl, () => now);
    expect(await c.key('a')).toBeNull();
    expect(await c.key('b')).toBeNull();
    expect(calls).toBe(1);
    now += 101_000;
    await c.key('a');
    expect(calls).toBe(2);
  });

  it('받지 못하면 CertsUnavailableError', async () => {
    const down = googleCerts((async () => new Response('', { status: 500 })) as unknown as typeof fetch);
    await expect(down.key('a')).rejects.toBeInstanceOf(CertsUnavailableError);
    const offline = googleCerts((async () => {
      throw new TypeError('network');
    }) as unknown as typeof fetch);
    await expect(offline.key('a')).rejects.toBeInstanceOf(CertsUnavailableError);
  });

  it('동시에 여러 번 불러도 한 번만 받는다', async () => {
    let calls = 0;
    const c = googleCerts((async () => {
      calls++;
      return new Response('{}');
    }) as unknown as typeof fetch);
    await Promise.all([c.key('a'), c.key('b'), c.key('c')]);
    expect(calls).toBe(1);
  });
});

