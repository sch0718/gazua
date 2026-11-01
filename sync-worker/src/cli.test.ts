import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { harness, ORIGIN, type Harness } from '../test/harness';
import { IP_LIMIT, normalizeIp, PENDING_LIMIT } from './cli';

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

const columns = (h: ReturnType<typeof harness>, table: string) =>
  (h.env.DB.raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

describe('0005 마이그레이션', () => {
  it('cli_grants 열 이름이 스펙과 같다', () => {
    expect(columns(harness(), 'cli_grants')).toEqual([
      'id', 'device_hash', 'user_code', 'label', 'ip_hash', 'status', 'user_id', 'interval_ms',
      'last_polled_at', 'consumed_token_hash', 'geo', 'created_at', 'expires_at',
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
    expect(r.body).toEqual({ label: 'gazua@macbook', createdAt: h.clock.now, geo: 'KR · Seoul' });
    expect(rows(h, 'SELECT status, user_id FROM cli_grants')).toEqual([{ status: 'pending', user_id: null }]);
  });

  it('소문자·하이픈 없는 코드도 받는다. geo가 없으면 null', async () => {
    const h = harness();
    const { me, d } = await pending(h);
    const typed = (d.userCode as string).replace('-', '').toLowerCase();
    const r = await j(await me.as('POST', '/v1/cli/approve', { userCode: typed }));
    expect(r.body.geo).toBeNull();
  });

  it('approve:true는 approved + 승인한 사용자를 기록, 응답은 {label, createdAt}', async () => {
    const h = harness();
    const { me, d } = await pending(h);
    const r = await j(await me.as('POST', '/v1/cli/approve', { userCode: d.userCode, approve: true }));
    expect(r.body).toEqual({ label: 'gazua@macbook', createdAt: h.clock.now });
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
