import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { harness, ORIGIN, type Harness } from '../test/harness';
import { IP_LIMIT, normalizeIp, PENDING_LIMIT, TOKEN_TTL } from './cli';
import { DAY } from './env';
import { doc } from '../test/docs';

const j = async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, any> });
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Origin 없이(CLI처럼) 부른다 */
function cliCall(
  h: Harness,
  method: string,
  path: string,
  o: { token?: string; body?: unknown; ip?: string; cf?: { country?: string; city?: string }; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = { ...o.headers };
  if (o.token) headers.Authorization = `Gazua-CLI ${o.token}`;
  if (o.ip) headers['CF-Connecting-IP'] = o.ip;
  return h.call(method, path, { origin: null, token: null, headers, body: o.body, cf: o.cf });
}
const device = (h: Harness, ip = '203.0.113.5', label = 'gazua@mac', cf?: { country?: string; city?: string }) =>
  cliCall(h, 'POST', '/v1/cli/device', { body: { label }, ip, cf });
const rows = (h: Harness, sql: string) => h.env.DB.raw.prepare(sql).all() as Record<string, any>[];
const poll = (h: Harness, deviceCode: string) => cliCall(h, 'POST', '/v1/cli/token', { body: { deviceCode } });

const columns = (h: ReturnType<typeof harness>, table: string) =>
  (h.env.DB.raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

describe('0005 마이그레이션', () => {
  it('cli_grants 열 이름이 스펙과 같다', () => {
    expect(columns(harness(), 'cli_grants')).toEqual([
      'id', 'device_hash', 'user_code', 'label', 'ip_hash', 'status', 'user_id', 'interval_ms',
      'last_polled_at', 'consumed_token_hash', 'geo', 'created_at', 'expires_at', 'scope',
    ]);
  });

  it('cli_tokens 열 이름이 스펙과 같다', () => {
    expect(columns(harness(), 'cli_tokens')).toEqual([
      'id', 'token_hash', 'user_id', 'label', 'scope', 'created_at', 'last_used_at', 'expires_at', 'revoked_at',
    ]);
  });

  it('device_hash·user_code·token_hash는 UNIQUE다', () => {
    const h = harness();
    const ins = (id: string, device: string, code: string) =>
      h.env.DB.raw
        .prepare(
          `INSERT INTO cli_grants (id, device_hash, user_code, label, ip_hash, status, interval_ms, created_at, expires_at)
           VALUES (?, ?, ?, 'l', 'ip', 'pending', 5000, 1, 2)`,
        )
        .run(id, device, code);
    ins('a', 'd1', 'BBBBBBBB');
    expect(() => ins('b', 'd1', 'CCCCCCCC')).toThrow(/UNIQUE/);
    expect(() => ins('c', 'd2', 'BBBBBBBB')).toThrow(/UNIQUE/);
  });

  it('하네스 env에 CLI_IP_SALT 기본값이 있다', () => {
    expect(harness().env.CLI_IP_SALT).toBe('test-cli-ip-salt');
  });
});

describe('normalizeIp', () => {
  it.each([
    ['203.0.113.5', '203.0.113.5'],
    ['::ffff:203.0.113.5', '203.0.113.5'],
    ['2001:db8::2', 'v6:2001:0db8:0000:0000'],
    ['2001:0db8:0000:0000:aaaa::1', 'v6:2001:0db8:0000:0000'],
    ['2001:DB8:0:0:1:2:3:4', 'v6:2001:0db8:0000:0000'],
    ['::1', 'v6:0000:0000:0000:0000'],
    ['', 'unknown'],
    [null, 'unknown'],
  ])('%s → %s', (raw, want) => expect(normalizeIp(raw as string | null)).toBe(want));
});

describe('POST /v1/cli/device', () => {
  it('무인증으로 코드를 받고 DB에는 해시만 둔다', async () => {
    const h = harness();
    const r = await j(await device(h, '203.0.113.5', 'gazua@mac', { country: 'KR', city: 'Seoul' }));
    expect(r.status).toBe(200);
    expect(r.body.deviceCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.body.userCode).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    expect(r.body.verifyUrl).toBe(`${ORIGIN}/#/settings/sync`);
    expect(r.body.interval).toBe(5);
    expect(r.body.expiresIn).toBe(600);
    const [row] = rows(h, 'SELECT * FROM cli_grants');
    expect(row).toMatchObject({
      device_hash: sha(r.body.deviceCode),
      user_code: (r.body.userCode as string).replace('-', ''),
      label: 'gazua@mac',
      status: 'pending',
      user_id: null,
      interval_ms: 5000,
      last_polled_at: null,
      consumed_token_hash: null,
      geo: 'KR · Seoul',
      created_at: h.clock.now,
      expires_at: h.clock.now + 600_000,
    });
    expect(row.ip_hash).toMatch(/^[0-9a-f]{64}$/);
    const dump = JSON.stringify(rows(h, 'SELECT * FROM cli_grants'));
    expect(dump).not.toContain(r.body.deviceCode);
    expect(dump).not.toContain('203.0.113.5');
    expect(h.logs.join('\n')).not.toContain(r.body.deviceCode);
  });

  it('위치 정보가 없으면 geo는 NULL, 길면 64자로 자른다', async () => {
    const h = harness();
    await device(h);
    await device(h, '203.0.113.6', 'gazua@mac', { country: 'KR', city: 'x'.repeat(100) });
    const geos = rows(h, 'SELECT geo FROM cli_grants ORDER BY created_at, rowid').map((r) => r.geo);
    expect(geos[0]).toBeNull();
    expect(geos[1]).toHaveLength(64);
  });

  it('label은 1~64자 문자열만 받는다(422 invalid)', async () => {
    const h = harness();
    for (const label of [undefined, '', '   ', 7, 'x'.repeat(65), 'a\nb']) {
      const r = await j(await cliCall(h, 'POST', '/v1/cli/device', { body: { label }, ip: '203.0.113.5' }));
      expect(r.status).toBe(422);
      expect(r.body.error).toBe('invalid');
    }
    expect((await device(h, '203.0.113.5', 'x'.repeat(64))).status).toBe(200);
  });

  it('CLI_IP_SALT가 없으면 503 cli-disabled', async () => {
    const h = harness();
    delete h.env.CLI_IP_SALT;
    const r = await j(await device(h));
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('cli-disabled');
  });

  it('허용 Origin으로 부르면 404, Origin 없는 다른 요청은 지금처럼 403 origin', async () => {
    const h = harness();
    expect((await h.call('POST', '/v1/cli/device', { body: { label: 'x' } })).status).toBe(404);
    const other = await j(await h.call('GET', '/v1/profiles', { origin: null, token: 'abc' }));
    expect(other.status).toBe(403);
    expect(other.body.error).toBe('origin');
    const wrongOrigin = await j(await h.call('POST', '/v1/cli/device', { origin: 'https://evil.example.test', body: { label: 'x' } }));
    expect(wrongOrigin.status).toBe(403);
  });

  it('같은 IP 6번째는 429 rate-limited + Retry-After', async () => {
    const h = harness();
    for (let i = 0; i < IP_LIMIT; i++) expect((await device(h)).status).toBe(200);
    const sixth = await device(h);
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get('Retry-After')).toBe('60');
    expect((await sixth.json()).error).toBe('rate-limited');
    expect((await device(h, '203.0.113.99')).status).toBe(200);
    h.clock.now += 10 * 60_000 + 1;
    expect((await device(h)).status).toBe(200);
  });

  it('전체 pending 51번째는 429', async () => {
    const h = harness();
    for (let i = 0; i < PENDING_LIMIT; i++) expect((await device(h, `198.51.100.${i}`)).status).toBe(200);
    expect((await device(h, '198.51.100.200')).status).toBe(429);
    h.clock.now += 10 * 60_000 + 1; // 모두 만료
    expect((await device(h, '198.51.100.200')).status).toBe(200);
  });

  it('겹친 넣기도 한도를 넘지 않는다', async () => {
    const h = harness();
    for (let i = 0; i < IP_LIMIT - 1; i++) await device(h);
    const statuses = (await Promise.all([device(h), device(h), device(h)])).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 429, 429]);
    expect(rows(h, 'SELECT count(*) AS n FROM cli_grants')[0].n).toBe(IP_LIMIT);
  });

  it('같은 IPv6 /64와 IPv4-mapped는 같은 묶음, 헤더가 없으면 unknown 묶음', async () => {
    const h = harness();
    await device(h, '2001:0db8:0000:0000:aaaa::1');
    await device(h, '2001:db8::2');
    await device(h, '2001:DB8:0:0:1:2:3:4');
    await device(h, '::ffff:203.0.113.5');
    await device(h, '203.0.113.5');
    await cliCall(h, 'POST', '/v1/cli/device', { body: { label: 'x' } });
    await device(h, '2001:db8:0:1::1');
    const counts = rows(h, 'SELECT count(*) AS n FROM cli_grants GROUP BY ip_hash ORDER BY n DESC').map((r) => r.n);
    expect(counts).toEqual([3, 2, 1, 1]);
  });

  it('사용자 코드가 겹치면 다시 만든다', async () => {
    const h = harness();
    // random 호출 순서: 기기 코드(1), 사용자 코드(2) / 기기 코드(3), 사용자 코드(4: 겹침), 사용자 코드(5)
    const script = [1, 0, 2, 0, 5].map((v) => new Uint8Array(32).fill(v));
    let n = 0;
    h.deps.random = () => script[n++];
    expect((await j(await device(h, '203.0.113.5'))).body.userCode).toBe('BBBB-BBBB');
    expect((await j(await device(h, '203.0.113.6'))).body.userCode).toBe('HHHH-HHHH');
  });
});

describe('POST /v1/cli/approve', () => {
  async function pending(h: Harness, cf?: { country?: string; city?: string }) {
    const me = await h.login();
    const d = (await j(await device(h, '203.0.113.5', 'gazua@macbook', cf))).body;
    return { me, d };
  }

  it('조회는 상태를 바꾸지 않고 label·createdAt·geo를 돌려준다', async () => {
    const h = harness();
    const { me, d } = await pending(h, { country: 'KR', city: 'Seoul' });
    const r = await j(await me.as('POST', '/v1/cli/approve', { userCode: d.userCode }));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ label: 'gazua@macbook', createdAt: h.clock.now, geo: 'KR · Seoul', scope: 'read' });
    expect(rows(h, 'SELECT status, user_id FROM cli_grants')).toEqual([{ status: 'pending', user_id: null }]);
  });

  it('소문자·하이픈 없는 코드도 받는다. geo가 없으면 null', async () => {
    const h = harness();
    const { me, d } = await pending(h);
    const typed = (d.userCode as string).replace('-', '').toLowerCase();
    const r = await j(await me.as('POST', '/v1/cli/approve', { userCode: typed }));
    expect(r.body.geo).toBeNull();
  });

  it('approve:true는 approved + 승인한 사용자를 기록, 응답은 {label, createdAt, scope}', async () => {
    const h = harness();
    const { me, d } = await pending(h);
    const r = await j(await me.as('POST', '/v1/cli/approve', { userCode: d.userCode, approve: true }));
    expect(r.body).toEqual({ label: 'gazua@macbook', createdAt: h.clock.now, scope: 'read' });
    const userId = (rows(h, 'SELECT id FROM users')[0] as { id: string }).id;
    expect(rows(h, 'SELECT status, user_id FROM cli_grants')).toEqual([{ status: 'approved', user_id: userId }]);
  });

  it('approve:false는 denied', async () => {
    const h = harness();
    const { me, d } = await pending(h);
    expect((await me.as('POST', '/v1/cli/approve', { userCode: d.userCode, approve: false })).status).toBe(200);
    expect(rows(h, 'SELECT status FROM cli_grants')).toEqual([{ status: 'denied' }]);
  });

  it('없는 코드·틀린 모양·이미 처리·만료는 422 invalid-code', async () => {
    const h = harness();
    const { me, d } = await pending(h);
    for (const userCode of ['ZZZZ-ZZZZ', 'abc', 'AEIO-UAEI', '']) {
      const r = await j(await me.as('POST', '/v1/cli/approve', { userCode }));
      expect(r).toMatchObject({ status: 422, body: { error: 'invalid-code' } });
    }
    await me.as('POST', '/v1/cli/approve', { userCode: d.userCode, approve: true });
    expect((await me.as('POST', '/v1/cli/approve', { userCode: d.userCode, approve: false })).status).toBe(422);
    expect((await me.as('POST', '/v1/cli/approve', { userCode: d.userCode })).status).toBe(422);
    const h2 = harness();
    const p2 = await pending(h2);
    h2.clock.now += 600_000;
    expect((await p2.me.as('POST', '/v1/cli/approve', { userCode: p2.d.userCode, approve: true })).status).toBe(422);
  });

  it('approve가 불리언이 아니면 422 invalid', async () => {
    const h = harness();
    const { me, d } = await pending(h);
    const r = await j(await me.as('POST', '/v1/cli/approve', { userCode: d.userCode, approve: 'yes' }));
    expect(r).toMatchObject({ status: 422, body: { error: 'invalid' } });
  });

  it('앱 세션 없이는 승인하지 못한다', async () => {
    const h = harness();
    const d = (await j(await device(h))).body;
    expect((await h.call('POST', '/v1/cli/approve', { body: { userCode: d.userCode, approve: true } })).status).toBe(401);
    expect(rows(h, 'SELECT status FROM cli_grants')).toEqual([{ status: 'pending' }]);
  });
});

describe('POST /v1/cli/token', () => {
  async function approved(h: Harness) {
    const me = await h.login();
    const d = (await j(await device(h))).body;
    await me.as('POST', '/v1/cli/approve', { userCode: d.userCode, approve: true });
    return { me, d };
  }

  it('흐름: device → pending → 조회 → 승인 → 토큰 한 번 → 다시 410', async () => {
    const h = harness();
    const me = await h.login();
    const d = (await j(await device(h))).body;
    expect(await j(await poll(h, d.deviceCode))).toMatchObject({ status: 400, body: { error: 'pending' } });
    await me.as('POST', '/v1/cli/approve', { userCode: d.userCode }); // 조회: 상태 그대로
    h.clock.now += 5000;
    expect((await j(await poll(h, d.deviceCode))).body.error).toBe('pending');
    await me.as('POST', '/v1/cli/approve', { userCode: d.userCode, approve: true });
    const t = await j(await poll(h, d.deviceCode));
    expect(t.status).toBe(200);
    expect(t.body.token).toMatch(/^gzc_[A-Za-z0-9_-]{43}$/);
    expect(t.body.expiresAt).toBe(h.clock.now + TOKEN_TTL);
    expect(typeof t.body.tokenId).toBe('string');
    const [tok] = rows(h, 'SELECT * FROM cli_tokens');
    expect(tok).toMatchObject({ id: t.body.tokenId, token_hash: sha(t.body.token), label: 'gazua@mac', scope: 'read', revoked_at: null, last_used_at: h.clock.now });
    expect(JSON.stringify(rows(h, 'SELECT * FROM cli_tokens'))).not.toContain(t.body.token);
    expect(JSON.stringify(rows(h, 'SELECT * FROM cli_grants'))).not.toContain(t.body.token);
    expect(await j(await poll(h, d.deviceCode))).toMatchObject({ status: 410, body: { error: 'expired' } });
    expect(rows(h, 'SELECT count(*) AS n FROM cli_tokens')[0].n).toBe(1);
    expect(h.logs.join('\n')).not.toContain(t.body.token);
  });

  it('거절하면 403 denied', async () => {
    const h = harness();
    const me = await h.login();
    const d = (await j(await device(h))).body;
    await me.as('POST', '/v1/cli/approve', { userCode: d.userCode, approve: false });
    expect(await j(await poll(h, d.deviceCode))).toMatchObject({ status: 403, body: { error: 'denied' } });
    expect(rows(h, 'SELECT count(*) AS n FROM cli_tokens')[0].n).toBe(0);
  });

  it('모르는 기기 코드는 404 unknown-device, 모양이 틀리면 422', async () => {
    const h = harness();
    expect(await j(await poll(h, 'A'.repeat(43)))).toMatchObject({ status: 404, body: { error: 'unknown-device' } });
    expect((await j(await poll(h, 'short'))).status).toBe(422);
    expect((await j(await cliCall(h, 'POST', '/v1/cli/token', { body: {} }))).status).toBe(422);
  });

  it('10분이 지나면 410 expired(승인 전·승인 뒤 모두), approve는 422', async () => {
    const h = harness();
    const me = await h.login();
    const a = (await j(await device(h, '203.0.113.5'))).body;
    const b = (await j(await device(h, '203.0.113.6'))).body;
    await me.as('POST', '/v1/cli/approve', { userCode: b.userCode, approve: true });
    h.clock.now += 600_000;
    expect((await j(await poll(h, a.deviceCode))).status).toBe(410);
    expect((await j(await poll(h, b.deviceCode))).status).toBe(410);
    expect(rows(h, 'SELECT count(*) AS n FROM cli_tokens')[0].n).toBe(0);
    expect((await me.as('POST', '/v1/cli/approve', { userCode: a.userCode, approve: true })).status).toBe(422);
  });

  it('간격 안의 두 번째 폴링은 400 slow_down이고 저장 간격이 5초 늘어난다', async () => {
    const h = harness();
    const d = (await j(await device(h))).body;
    expect((await j(await poll(h, d.deviceCode))).body.error).toBe('pending');
    const slow = await j(await poll(h, d.deviceCode));
    expect(slow).toMatchObject({ status: 400, body: { error: 'slow_down', interval: 10 } });
    expect(rows(h, 'SELECT interval_ms FROM cli_grants')).toEqual([{ interval_ms: 10_000 }]);
    h.clock.now += 5000; // 늘어난 간격(10초) 전이라 아직 빠르다
    expect((await j(await poll(h, d.deviceCode))).body.error).toBe('slow_down');
    h.clock.now += 20_000;
    expect((await j(await poll(h, d.deviceCode))).body.error).toBe('pending');
  });

  it('interval_ms가 60000 이상이면 slow_down만 답하고 간격은 그대로', async () => {
    const h = harness();
    const d = (await j(await device(h))).body;
    h.env.DB.raw.prepare('UPDATE cli_grants SET interval_ms = 60000').run();
    await poll(h, d.deviceCode);
    const slow = await j(await poll(h, d.deviceCode));
    expect(slow).toMatchObject({ status: 400, body: { error: 'slow_down', interval: 60 } });
    expect(rows(h, 'SELECT interval_ms FROM cli_grants')).toEqual([{ interval_ms: 60_000 }]);
    h.env.DB.raw.prepare('UPDATE cli_grants SET interval_ms = 57000').run();
    h.clock.now += 100_000;
    await poll(h, d.deviceCode);
    await poll(h, d.deviceCode);
    expect(rows(h, 'SELECT interval_ms FROM cli_grants')).toEqual([{ interval_ms: 62_000 }]);
  });

  it('겹친 폴링 둘 중 하나만 토큰을 받고 cli_tokens 행은 1개, 다른 하나는 410', async () => {
    const h = harness();
    const { d } = await approved(h);
    // 첫 폴링이 batch를 실행하기 직전에 두 번째 폴링을 끝까지 끼워 넣는다(둘 다 approved 상태를 읽은 뒤)
    const realBatch = h.env.DB.batch.bind(h.env.DB);
    let second: Promise<Response> | null = null;
    h.env.DB.batch = async (statements) => {
      if (second === null) {
        second = poll(h, d.deviceCode);
        await second;
      }
      return realBatch(statements);
    };
    const first = await poll(h, d.deviceCode);
    const results = [await j(first), await j(await second!)];
    expect(results.map((r) => r.status).sort()).toEqual([200, 410]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rows(h, 'SELECT count(*) AS n FROM cli_tokens')[0].n).toBe(1);
    const winner = results.find((r) => r.status === 200)!.body;
    expect(rows(h, 'SELECT token_hash FROM cli_tokens')[0].token_hash).toBe(sha(winner.token));
    expect(rows(h, 'SELECT consumed_token_hash, status FROM cli_grants')).toEqual([{ consumed_token_hash: sha(winner.token), status: 'consumed' }]);
  });

  it('읽은 뒤 batch 직전에 만료되면 토큰을 만들지 않는다(UPDATE의 만료 조건)', async () => {
    const h = harness();
    const { d } = await approved(h);
    const realBatch = h.env.DB.batch.bind(h.env.DB);
    h.env.DB.batch = async (statements) => {
      // pollToken이 grant를 읽은 뒤 batch가 실행되기 전에 만료 시각이 지금이 됐다고 본다(expires_at > now가 거짓)
      h.env.DB.raw.prepare('UPDATE cli_grants SET expires_at = ?').run(h.clock.now);
      return realBatch(statements);
    };
    expect(await j(await poll(h, d.deviceCode))).toMatchObject({ status: 410, body: { error: 'expired' } });
    expect(rows(h, 'SELECT count(*) AS n FROM cli_tokens')[0].n).toBe(0);
    expect(rows(h, 'SELECT status, consumed_token_hash FROM cli_grants')).toEqual([{ status: 'approved', consumed_token_hash: null }]);
  });
});

async function connect(h: Harness, who?: { as: (m: string, p: string, b?: unknown) => Promise<Response> }, label = 'gazua@mac') {
  const me = who ?? (await h.login());
  const d = (await j(await cliCall(h, 'POST', '/v1/cli/device', { body: { label }, ip: '203.0.113.5' }))).body;
  await me.as('POST', '/v1/cli/approve', { userCode: d.userCode, approve: true });
  h.clock.now += 5000;
  const t = (await j(await poll(h, d.deviceCode))).body;
  return { me, token: t.token as string, tokenId: t.tokenId as string };
}

describe('CLI 토큰 인증과 읽기 전용 강제', () => {
  async function ready() {
    const h = harness();
    const c = await connect(h);
    await c.me.as('PUT', '/v1/profiles/p1', { opId: 'op-1', expectedRevision: 0, doc: doc() });
    return { h, ...c };
  }

  it('허용된 두 GET은 200', async () => {
    const { h, token } = await ready();
    const list = await j(await cliCall(h, 'GET', '/v1/profiles', { token }));
    expect(list.status).toBe(200);
    expect(list.body.profiles).toHaveLength(1);
    expect((await cliCall(h, 'GET', '/v1/profiles/p1?docVersion=2', { token })).status).toBe(200);
  });

  it('허용 밖은 라우터 전에 403 cli-scope', async () => {
    const { h, token } = await ready();
    const cases: [string, string][] = [
      ['GET', '/v1/profiles/p1'],
      ['GET', '/v1/profiles/p1?docVersion=1'],
      ['GET', '/v1/profiles/p1?docVersion=02'],
      ['GET', '/v1/profiles/p1?docVersion=2&docVersion=3'],
      ['HEAD', '/v1/profiles'],
      ['GET', '/v1/profiles/'],
      ['GET', '/v1/profiles/p1/revisions'],
      ['PUT', '/v1/profiles/p1?docVersion=2'],
      ['DELETE', '/v1/profiles/p1?docVersion=2'],
      ['GET', '/v1/keys'],
      ['POST', '/v1/shares'],
      ['GET', '/v1/sessions'],
      ['GET', '/v1/cli/tokens'],
      ['DELETE', '/v1/cli/tokens/x'],
      ['POST', '/v1/cli/approve'],
      ['DELETE', '/v1/cli/token/'],
    ];
    for (const [method, path] of cases) {
      const r = await j(await cliCall(h, method, path, { token, body: method === 'PUT' || method === 'POST' ? {} : undefined }));
      expect({ method, path, status: r.status, error: r.body.error }).toEqual({ method, path, status: 403, error: 'cli-scope' });
    }
  });

  it('토큰 모양이 틀리면 401 cli-token', async () => {
    const { h } = await ready();
    for (const token of ['x', 'gzc_short', `gzc_${'A'.repeat(44)}`, `abc_${'A'.repeat(43)}`]) {
      const r = await j(await cliCall(h, 'GET', '/v1/profiles', { token }));
      expect(r).toMatchObject({ status: 401, body: { error: 'cli-token' } });
    }
  });

  it('모르는 토큰·앱에서 철회한 토큰은 401 cli-token-revoked', async () => {
    const { h, token, tokenId, me } = await ready();
    expect(await j(await cliCall(h, 'GET', '/v1/profiles', { token: `gzc_${'A'.repeat(43)}` }))).toMatchObject({ status: 401, body: { error: 'cli-token-revoked' } });
    expect((await me.as('DELETE', `/v1/cli/tokens/${tokenId}`)).status).toBe(200);
    expect(await j(await cliCall(h, 'GET', '/v1/profiles', { token }))).toMatchObject({ status: 401, body: { error: 'cli-token-revoked' } });
  });

  it('만료 90일 직전까지는 200, 90일이 되면 401 cli-token-expired', async () => {
    const { h, token } = await ready();
    h.clock.now += 90 * DAY - 1;
    expect((await cliCall(h, 'GET', '/v1/profiles', { token })).status).toBe(200);
    h.clock.now += 1;
    expect(await j(await cliCall(h, 'GET', '/v1/profiles', { token }))).toMatchObject({ status: 401, body: { error: 'cli-token-expired' } });
  });

  it('DELETE /v1/cli/token은 요청에 쓴 그 토큰만 철회한다', async () => {
    const { h, token, me } = await ready();
    const second = await connect(h, me, 'gazua@pc');
    const r = await j(await cliCall(h, 'DELETE', '/v1/cli/token', { token }));
    expect(r).toMatchObject({ status: 200, body: { revoked: true } });
    expect((await cliCall(h, 'GET', '/v1/profiles', { token })).status).toBe(401);
    expect((await cliCall(h, 'GET', '/v1/profiles', { token: second.token })).status).toBe(200);
    expect((await cliCall(h, 'DELETE', '/v1/cli/token', { token })).status).toBe(401); // 이미 끊김
  });

  it('허용 Origin+세션으로 DELETE /v1/cli/token은 404', async () => {
    const { me } = await ready();
    expect((await me.as('DELETE', '/v1/cli/token')).status).toBe(404);
  });

  it('Origin이 있는 요청의 Gazua-CLI 헤더는 CLI 경로로 가지 않는다(세션 인증 실패)', async () => {
    const { h, token } = await ready();
    const r = await h.call('GET', '/v1/profiles', { token: null, headers: { Authorization: `Gazua-CLI ${token}` } });
    expect(r.status).toBe(401);
    expect(rows(h, 'SELECT count(*) AS n FROM cli_tokens WHERE revoked_at IS NULL')[0].n).toBe(1);
  });

  it('「다른 기기 모두 로그아웃」 뒤에도 CLI 토큰은 살아 있다', async () => {
    const { h, token, me } = await ready();
    await h.login(); // 두 번째 앱 세션
    const out = await j(await me.as('DELETE', '/v1/sessions?others=1'));
    expect(out.body.revoked).toBe(1);
    expect((await cliCall(h, 'GET', '/v1/profiles', { token })).status).toBe(200);
  });

  it('허용 목록에서 빠진 사용자는 403 not-allowed(이메일, kakao 소셜)', async () => {
    const h = harness();
    const { token } = await connect(h);
    h.env.ALLOWED_EMAILS = 'someone-else@example.test';
    expect(await j(await cliCall(h, 'GET', '/v1/profiles', { token }))).toMatchObject({ status: 403, body: { error: 'not-allowed' } });

    const s = harness({ social: true });
    const kakao = await s.socialLogin('kakao', 'kakao-me');
    const c = await connect(s, kakao);
    expect((await cliCall(s, 'GET', '/v1/profiles', { token: c.token })).status).toBe(200);
    s.env.ALLOWED_ACCOUNTS = 'kakao:someone-else';
    expect(await j(await cliCall(s, 'GET', '/v1/profiles', { token: c.token }))).toMatchObject({ status: 403, body: { error: 'not-allowed' } });
  });

  it('초대 멤버의 CLI 토큰은 멤버인 동안만 통과하고, 내보내면 철회된다', async () => {
    const h = harness();
    h.env.INVITE_CODE = 'i'.repeat(32);
    const email = 'friend@example.test';
    const t = await h.token({ email, sub: 'uid-friend' });
    const s = (await j(await h.call('POST', '/v1/session', { token: t, body: { invite: 'i'.repeat(32) } }))).body.sessionId as string;
    const friend = { as: async (m: string, p: string, b?: unknown) => h.call(m, p, { token: await h.token({ email, sub: 'uid-friend' }), session: s, body: b }) };
    const c = await connect(h, friend);
    expect((await cliCall(h, 'GET', '/v1/profiles', { token: c.token })).status).toBe(200);
    // 멤버 표만 바뀌어도(stillAllowed 재확인) 막힌다
    h.env.DB.raw.prepare('UPDATE members SET removed_at = 1').run();
    expect(await j(await cliCall(h, 'GET', '/v1/profiles', { token: c.token }))).toMatchObject({ status: 403, body: { error: 'not-allowed' } });
    h.env.DB.raw.prepare('UPDATE members SET removed_at = NULL').run();
    const admin = await h.login();
    expect((await admin.as('DELETE', `/v1/members/${encodeURIComponent(email)}`)).status).toBe(200);
    expect(await j(await cliCall(h, 'GET', '/v1/profiles', { token: c.token }))).toMatchObject({ status: 401, body: { error: 'cli-token-revoked' } });
  });

  it('last_used_at은 하루에 한 번만 갱신한다', async () => {
    const { h, token } = await ready();
    const first = h.clock.now;
    h.clock.now += DAY - 1;
    await cliCall(h, 'GET', '/v1/profiles', { token });
    expect(rows(h, 'SELECT last_used_at FROM cli_tokens')[0].last_used_at).toBeLessThan(first + 1);
    h.clock.now += 1;
    await cliCall(h, 'GET', '/v1/profiles', { token });
    expect(rows(h, 'SELECT last_used_at FROM cli_tokens')[0].last_used_at).toBe(h.clock.now);
  });
});

describe('앱용 CLI 토큰 목록·철회', () => {
  it('살아 있는 내 토큰만 목록에 나오고 원문은 없다', async () => {
    const h = harness();
    const a = await connect(h);
    const b = await connect(h, a.me, 'gazua@pc');
    await a.me.as('DELETE', `/v1/cli/tokens/${b.tokenId}`);
    const r = await j(await a.me.as('GET', '/v1/cli/tokens'));
    expect(r.body.tokens).toEqual([{ id: a.tokenId, label: 'gazua@mac', createdAt: expect.any(Number), lastUsedAt: expect.any(Number), expiresAt: expect.any(Number), scope: 'read' }]);
    expect(JSON.stringify(r.body)).not.toContain(a.token);
  });

  it('남의 토큰을 철회하면 404, 이미 철회했으면 그대로 200', async () => {
    const h = harness();
    const a = await connect(h);
    const other = await h.login('other@example.test', 'uid-other');
    expect((await other.as('DELETE', `/v1/cli/tokens/${a.tokenId}`)).status).toBe(404);
    expect((await a.me.as('DELETE', `/v1/cli/tokens/${a.tokenId}`)).status).toBe(200);
    expect((await a.me.as('DELETE', `/v1/cli/tokens/${a.tokenId}`)).status).toBe(200);
    expect((await a.me.as('DELETE', '/v1/cli/tokens/nope')).status).toBe(404);
    expect((await j(await other.as('GET', '/v1/cli/tokens'))).body.tokens).toEqual([]); // 남의 토큰은 목록에도 없다
  });
});

describe('market-upload 범위', () => {
  const marketBody = {
    driveFileId: 'drive-file-0001', name: 'market-data-20261031.json.gz', sha256: 'b'.repeat(64), size: 10, version: 4,
    collectedAt: '2026-10-31T18:00:00+09:00', range: { from: '2021-10-31', to: '2026-10-31' }, stocks: 1,
  };
  async function connectScoped(h: Harness, scope?: string) {
    const me = await h.login();
    const d = (await j(await cliCall(h, 'POST', '/v1/cli/device', { body: scope ? { label: 'gazua-drive@mac', scope } : { label: 'gazua@mac' }, ip: '203.0.113.5' }))).body;
    const look = (await j(await me.as('POST', '/v1/cli/approve', { userCode: d.userCode }))).body;
    await me.as('POST', '/v1/cli/approve', { userCode: d.userCode, approve: true });
    h.clock.now += 5000;
    const t = (await j(await poll(h, d.deviceCode))).body;
    return { me, look, t };
  }

  it('scope 없이 요청하면 read, market-upload면 승인 조회·토큰 응답·토큰 목록에 범위가 보인다', async () => {
    const h = harness();
    const read = await connectScoped(h);
    expect(read.look.scope).toBe('read');
    expect(read.t.scope).toBe('read');
    const up = await connectScoped(h, 'market-upload');
    expect(up.look.scope).toBe('market-upload');
    expect(up.t.scope).toBe('market-upload');
    expect(rows(h, 'SELECT scope FROM cli_tokens ORDER BY created_at').map((r) => r.scope)).toEqual(['read', 'market-upload']);
    const list = (await j(await up.me.as('GET', '/v1/cli/tokens'))).body.tokens;
    expect(list.map((t: any) => t.scope).sort()).toEqual(['market-upload', 'read']);
  });

  it('알 수 없는 scope는 422 invalid path scope', async () => {
    const h = harness();
    const r = await j(await cliCall(h, 'POST', '/v1/cli/device', { body: { label: 'x', scope: 'write' }, ip: '203.0.113.5' }));
    expect(r).toMatchObject({ status: 422, body: { error: 'invalid', path: 'scope' } });
  });

  it('market-upload 토큰은 manifest 목록·등록·삭제와 로그아웃만 된다', async () => {
    const h = harness();
    const { t } = await connectScoped(h, 'market-upload');
    const put = await j(await cliCall(h, 'POST', '/v1/market/files', { token: t.token, body: marketBody }));
    expect(put.status).toBe(200);
    expect((await j(await cliCall(h, 'GET', '/v1/market/files', { token: t.token }))).body.files).toHaveLength(1);
    for (const [m, p] of [['GET', '/v1/profiles'], ['GET', '/v1/profiles/p1?docVersion=2'], ['DELETE', '/v1/market/files'], ['GET', '/v1/keys']] as const) {
      expect((await j(await cliCall(h, m, p, { token: t.token }))).body.error, `${m} ${p}`).toBe('cli-scope');
    }
    expect((await cliCall(h, 'DELETE', `/v1/market/files/${put.body.id}`, { token: t.token })).status).toBe(200);
    expect((await cliCall(h, 'DELETE', '/v1/cli/token', { token: t.token })).status).toBe(200);
  });

  it('read 토큰은 market 경로가 403 cli-scope', async () => {
    const h = harness();
    const { t } = await connectScoped(h);
    for (const [m, p] of [['GET', '/v1/market/files'], ['POST', '/v1/market/files'], ['DELETE', '/v1/market/files/x']] as const) {
      expect((await j(await cliCall(h, m, p, { token: t.token, body: m === 'POST' ? marketBody : undefined }))).body.error).toBe('cli-scope');
    }
  });

  it('market-upload 등록 한도 429 market-limit', async () => {
    const h = harness();
    const { t } = await connectScoped(h, 'market-upload');
    for (let i = 0; i < 10; i++) {
      const b = { ...marketBody, sha256: i.toString(16).padStart(64, '0') };
      expect((await cliCall(h, 'POST', '/v1/market/files', { token: t.token, body: b })).status).toBe(200);
    }
    const over = await j(await cliCall(h, 'POST', '/v1/market/files', { token: t.token, body: { ...marketBody, sha256: 'f'.repeat(64) } }));
    expect(over).toMatchObject({ status: 429, body: { error: 'market-limit' } });
  });
});
