// 로컬 스모크: 실제 workerd + 로컬 D1(wrangler dev)에서 프로필·공유 흐름을 돌린다. 지어낸 키·이메일만 쓴다.
// 사용: node test/smoke.ts  (wrangler를 띄우고 끝나면 내린다)
import { spawn } from 'node:child_process';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = 'https://app.example.test';
const PROJECT = 'gazua-test';
const EMAIL = 'me@example.test';

const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
const jwk = JSON.stringify({ ...(await exportJWK(publicKey)), alg: 'RS256' });

const run = (args: string[]) =>
  new Promise<void>((ok, bad) => {
    const p = spawn('pnpm', ['exec', 'wrangler', ...args], { stdio: 'ignore' });
    p.on('exit', (c) => (c === 0 ? ok() : bad(new Error(`wrangler ${args[0]} ${c}`))));
  });
await run(['d1', 'migrations', 'apply', 'gazua-sync', '--local', '--persist-to', '.wrangler/smoke']);
const dev = spawn(
  'pnpm',
  ['exec', 'wrangler', 'dev', 'test/devEntry.ts', '--local', '--port', String(PORT), '--persist-to', '.wrangler/smoke', '--test-scheduled',
    '--var', `TEST_PUBLIC_JWK:${jwk}`, '--var', `FIREBASE_PROJECT_ID:${PROJECT}`, '--var', `ALLOWED_EMAILS:${EMAIL}`, '--var', `ALLOWED_ORIGINS:${ORIGIN}`],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
const logs: string[] = [];
dev.stdout.on('data', (d) => logs.push(String(d)));
dev.stderr.on('data', (d) => logs.push(String(d)));

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ` ${JSON.stringify(detail)}`}`);
  if (!cond) failures++;
};

try {
  for (let i = 0; ; i++) {
    try {
      await fetch(BASE);
      break;
    } catch {
      if (i > 120) throw new Error('wrangler dev did not start');
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  const sec = () => Math.floor(Date.now() / 1000);
  const token = () =>
    new SignJWT({ email: EMAIL, email_verified: true, auth_time: sec() })
      .setProtectedHeader({ alg: 'RS256', kid: 'smoke' })
      .setIssuer(`https://securetoken.google.com/${PROJECT}`)
      .setAudience(PROJECT)
      .setSubject('uid-smoke')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
  let session = '';
  const call = async (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { Origin: ORIGIN, Authorization: `Bearer ${await token()}`, 'X-Gazua-Session': session, 'Content-Type': 'application/json', ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, headers: res.headers, body: (await res.json().catch(() => null)) as Record<string, any> };
  };

  const pre = await fetch(BASE + '/v1/profiles', { method: 'OPTIONS', headers: { Origin: ORIGIN } });
  check('preflight 204 + exact origin', pre.status === 204 && pre.headers.get('Access-Control-Allow-Origin') === ORIGIN);
  check('other origin 403', (await fetch(BASE + '/v1/profiles', { headers: { Origin: 'https://evil.example.test' } })).status === 403);

  const s = await call('POST', '/v1/session', { label: '스모크' });
  session = s.body?.sessionId;
  check('session created', s.status === 200 && typeof session === 'string', s);

  const pid = crypto.randomUUID();
  const doc = (name: string) => ({
    v: 1,
    name,
    settings: { period: { unit: 'D', n: 1 }, metric: 'change', benchmark: 'AUTO', perfBenchmark: null, colorConvention: 'kr', boardOrder: 'value' },
    watchlists: { groups: [{ id: 'g0', name: '관심', items: [] }] },
    strategies: [],
    criteria: [],
    baskets: [],
  });
  check('create rev 1', (await call('PUT', `/v1/profiles/${pid}`, { opId: 'op-0', expectedRevision: 0, doc: doc('v1') })).body?.revision === 1);
  const stale = await call('PUT', `/v1/profiles/${pid}`, { opId: 'op-x', expectedRevision: 0, doc: doc('x') });
  check('second create → 409 (batch rolled back nothing)', stale.status === 409 && stale.body.doc?.name === 'v1', stale);
  for (let r = 1; r <= 12; r++) await call('PUT', `/v1/profiles/${pid}`, { opId: `op-${r}`, expectedRevision: r, doc: doc(`v${r + 1}`) });
  const again = await call('PUT', `/v1/profiles/${pid}`, { opId: 'op-12', expectedRevision: 12, doc: doc('v13') });
  check('replayed opId → same revision', again.body?.revision === 13, again);
  const conflict = await call('PUT', `/v1/profiles/${pid}`, { opId: 'op-c', expectedRevision: 5, doc: doc('late') });
  check('stale base → 409', conflict.status === 409 && conflict.body.revision === 13, conflict.status);
  const revs = await call('GET', `/v1/profiles/${pid}/revisions`);
  check('keeps current + 10 past', JSON.stringify(revs.body?.revisions?.map((r: any) => r.revision)) === JSON.stringify([13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3]), revs.body);
  const bad = await call('PUT', `/v1/profiles/${pid}`, { opId: 'op-bad', expectedRevision: 13, doc: { ...doc('k'), proxyToken: 'FAKE' } });
  check('forbidden key → 422', bad.status === 422 && bad.body.error === 'forbidden-field', bad.body);

  const share = await call('POST', '/v1/shares', { sourceProfileId: pid, kind: 'group', snapshot: { kind: 'group', v: 1, title: '관심', symbols: ['005930'] } });
  check('share created', share.status === 200 && share.body.capability?.length === 43, share.body);
  const read = await fetch(BASE + '/v1/public/share', { headers: { Origin: ORIGIN, 'X-Share-Token': share.body.capability } });
  check('share read no-store', read.status === 200 && read.headers.get('Cache-Control') === 'no-store');

  const del = await call('DELETE', `/v1/profiles/${pid}`, { opId: 'op-del', expectedRevision: 13 });
  check('delete → tombstone', del.status === 200 && del.body.revision === 14, del.body);
  const read2 = await fetch(BASE + '/v1/public/share', { headers: { Origin: ORIGIN, 'X-Share-Token': share.body.capability } });
  check('share gone after delete', read2.status === 410);
  const late = await call('PUT', `/v1/profiles/${pid}`, { opId: 'op-late', expectedRevision: 13, doc: doc('late') });
  check('late edit cannot resurrect → 410', late.status === 410, late.status);
  const restored = await call('POST', `/v1/profiles/${pid}/restore`, { opId: 'op-res' });
  check('restore within 30 days', restored.status === 200 && restored.body.revision === 15 && restored.body.doc?.name === 'v13', restored.body);

  const cron = await fetch(`${BASE}/__scheduled?cron=17+18+*+*+*`);
  check('scheduled purge runs', cron.status === 200);
  const leaked = logs.join('').match(new RegExp([session, share.body.capability, EMAIL].filter(Boolean).join('|')));
  check('logs carry no session/capability/email', !leaked, leaked?.[0]);
} finally {
  dev.kill('SIGTERM');
}
console.log(failures === 0 ? 'smoke: all ok' : `smoke: ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
