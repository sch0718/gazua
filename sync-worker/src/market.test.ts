// sync-worker/src/market.test.ts
import { describe, expect, it } from 'vitest';
import { FORBIDDEN_KEYS } from '../../src/lib/sync/forbidden';
import { harness, OTHER } from '../test/harness';

const j = async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, any> });
const body = (n = 0, extra: Record<string, unknown> = {}) => ({
  driveFileId: `drive-file-${String(n).padStart(4, '0')}`,
  name: `market-data-202610${String(10 + n).padStart(2, '0')}.json.gz`,
  sha256: n.toString(16).padStart(64, '0'),
  size: 1000 + n,
  version: 4,
  collectedAt: `2026-10-${String(10 + n).padStart(2, '0')}T18:00:00+09:00`,
  range: { from: '2021-10-01', to: `2026-10-${String(10 + n).padStart(2, '0')}` },
  stocks: 2600,
  ...extra,
});
// 앱 세션은 POST를 못 하므로 테스트는 하네스 DB에 putMarketFile을 직접 부른다
import { putMarketFile } from './market';
async function seed(h: ReturnType<typeof harness>, userEmail: string, n: number) {
  const me = await h.login(userEmail, `uid-${userEmail}`);
  const user = h.env.DB.raw.prepare('SELECT id FROM users WHERE email = ?').get(userEmail) as { id: string };
  const ctx = { userId: user.id, sessionHash: '', user: { sub: `uid-${userEmail}`, email: userEmail, authTime: 0 } } as never;
  for (let i = 0; i < n; i++) await putMarketFile(h.env, h.deps, ctx, body(i));
  return { me, ctx };
}

describe('0006 마이그레이션', () => {
  it('market_files 열과 cli_grants.scope 기본값', () => {
    const h = harness();
    const cols = (h.env.DB.raw.prepare('PRAGMA table_info(market_files)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(['id', 'user_id', 'drive_file_id', 'name', 'sha256', 'size', 'format_version', 'collected_at', 'range_from', 'range_to', 'stocks', 'created_at', 'updated_at']);
    const scope = (h.env.DB.raw.prepare('PRAGMA table_info(cli_grants)').all() as { name: string; dflt_value: string }[]).find((c) => c.name === 'scope');
    expect(scope?.dflt_value).toBe("'read'");
  });
});

describe('putMarketFile', () => {
  it('등록하면 행을 돌려주고 같은 sha256은 drive_file_id·name·updatedAt만 갱신한다', async () => {
    const h = harness();
    const { ctx } = await seed(h, 'me@example.test', 1);
    h.clock.now += 1000;
    const again = await putMarketFile(h.env, h.deps, ctx, body(0, { driveFileId: 'drive-file-new0', name: 'renamed.json.gz' }));
    expect(again).toMatchObject({ driveFileId: 'drive-file-new0', name: 'renamed.json.gz', sha256: body(0).sha256, updatedAt: h.clock.now });
    expect(again.createdAt).toBe(h.clock.now - 1000);
    expect(h.env.DB.raw.prepare('SELECT count(*) AS n FROM market_files').get()).toEqual({ n: 1 });
  });
  it('9행에서 새 등록은 성공, 10행에서 새 sha256은 429 market-limit, 같은 sha256 갱신은 성공하고 10행 유지', async () => {
    const h = harness();
    const { ctx } = await seed(h, 'me@example.test', 9);
    await putMarketFile(h.env, h.deps, ctx, body(9));
    await expect(putMarketFile(h.env, h.deps, ctx, body(10))).rejects.toMatchObject({ status: 429, code: 'market-limit' });
    await expect(putMarketFile(h.env, h.deps, ctx, body(3, { driveFileId: 'drive-file-again' }))).resolves.toMatchObject({ driveFileId: 'drive-file-again' });
    expect(h.env.DB.raw.prepare('SELECT count(*) AS n FROM market_files').get()).toEqual({ n: 10 });
  });
  it('본문 검사: 알 수 없는 키 422 unknown-field, 모양 422 invalid, 금지 키 먼저', async () => {
    const h = harness();
    const { ctx } = await seed(h, 'me@example.test', 0);
    await expect(putMarketFile(h.env, h.deps, ctx, body(0, { extra: 1 }))).rejects.toMatchObject({ status: 422, code: 'unknown-field', extra: { path: 'extra' } });
    await expect(putMarketFile(h.env, h.deps, ctx, body(0, { sha256: 'x' }))).rejects.toMatchObject({ status: 422, code: 'invalid', extra: { path: 'sha256' } });
    await expect(putMarketFile(h.env, h.deps, ctx, body(0, { [FORBIDDEN_KEYS[0]]: 'k' }))).rejects.toMatchObject({ status: 422, code: 'forbidden-field' });
  });
});

describe('앱 세션 라우트', () => {
  it('GET은 내 행만 수집 시각 내림차순으로, POST는 405', async () => {
    const h = harness();
    const { me } = await seed(h, 'me@example.test', 3);
    await seed(h, OTHER, 1);
    const r = await j(await me.as('GET', '/v1/market/files'));
    expect(r.status).toBe(200);
    expect(r.body.files.map((f: any) => f.name)).toEqual([body(2).name, body(1).name, body(0).name]);
    expect(r.body.files[0]).toEqual({ id: expect.any(String), ...body(2), createdAt: h.clock.now, updatedAt: h.clock.now });
    expect((await me.as('POST', '/v1/market/files', body(5))).status).toBe(405);
  });
  it('DELETE /:id는 내 행만 지우고 남의 행·없는 행은 404, DELETE 전체는 개수를 돌려준다', async () => {
    const h = harness();
    const { me } = await seed(h, 'me@example.test', 2);
    const other = await seed(h, OTHER, 1);
    const mine = (await j(await me.as('GET', '/v1/market/files'))).body.files;
    const theirs = (await j(await other.me.as('GET', '/v1/market/files'))).body.files;
    expect((await me.as('DELETE', `/v1/market/files/${theirs[0].id}`)).status).toBe(404);
    expect((await me.as('DELETE', '/v1/market/files/nope')).status).toBe(404);
    expect((await me.as('DELETE', `/v1/market/files/${mine[0].id}`)).status).toBe(200);
    expect(await j(await me.as('DELETE', '/v1/market/files'))).toEqual({ status: 200, body: { deleted: 1 } });
    expect((await j(await other.me.as('GET', '/v1/market/files'))).body.files).toHaveLength(1);
  });
  it('로그에 Drive 파일 ID·해시가 없다', async () => {
    const h = harness();
    const { me } = await seed(h, 'me@example.test', 1);
    await me.as('GET', '/v1/market/files');
    expect(h.logs.join('\n')).not.toContain(body(0).driveFileId);
    expect(h.logs.join('\n')).not.toContain(body(0).sha256);
  });
});
