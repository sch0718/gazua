import { afterEach, describe, expect, it } from 'vitest';
import { writeAuth } from '../config';
import { run } from '../main';
import { cleanupDirs, makeIo, profileDoc, syncServer } from '../testing';

afterEach(cleanupDirs);
const TOKEN = `gzc_${'A'.repeat(43)}`;
const AUTH = { v: 1 as const, server: 'https://sync.example', token: TOKEN, tokenId: 't1', label: 'gazua@mac', expiresAt: Date.UTC(2027, 0, 1) };

function setup(profiles: Parameters<typeof syncServer>[0], loggedIn = true) {
  const f = syncServer(profiles);
  const t = makeIo({ fetch: f });
  if (loggedIn) writeAuth(t.dir, AUTH);
  return { f, t };
}

describe('로그인 확인', () => {
  it('로그인하지 않았으면 not-logged-in, 토큰이 로컬에서 만료됐으면 cli-token-expired(요청 없음)', async () => {
    const a = setup({ p1: { doc: profileDoc(2) } }, false);
    expect(await run(['profiles'], a.t.io)).toBe(1);
    expect(a.t.result().error.code).toBe('not-logged-in');
    const b = setup({ p1: { doc: profileDoc(2) } });
    b.t.clock.now = AUTH.expiresAt + 1;
    await run(['profiles'], b.t.io);
    expect(b.t.result().error.code).toBe('cli-token-expired');
    expect(b.f.calls).toHaveLength(0);
  });
});

describe('gazua profiles', () => {
  it('프로필 목록(ID·이름·리비전·그룹·전략 수)', async () => {
    const { t } = setup({ p1: { doc: profileDoc(2, '내 프로필'), revision: 12 }, p2: { doc: profileDoc(1, '회사'), revision: 3 }, gone: { doc: profileDoc(2), deleted: true } });
    expect(await run(['profiles'], t.io)).toBe(0);
    expect(t.result()).toEqual({
      ok: true,
      data: { profiles: [{ id: 'p1', name: '내 프로필', revision: 12, groups: 1, strategies: 1 }, { id: 'p2', name: '회사', revision: 3, groups: 1, strategies: 1 }] },
    });
  });

  it('토큰은 Gazua-CLI 헤더로만 보내고 출력에 없다', async () => {
    const { f, t } = setup({ p1: { doc: profileDoc(2) } });
    await run(['profiles'], t.io);
    expect(f.calls.length).toBeGreaterThan(0);
    expect(f.calls.every((c) => c.headers.get('authorization') === `Gazua-CLI ${TOKEN}`)).toBe(true);
    expect(f.calls.every((c) => c.method === 'GET' && !c.headers.has('origin') && !c.url.href.includes(TOKEN) && c.body === undefined)).toBe(true);
    expect(t.out.join('')).not.toContain(TOKEN);
  });
});

describe('gazua watchlists', () => {
  it('그룹과 종목(숨김 여부 포함)', async () => {
    const { t } = setup({ p1: { doc: profileDoc(2, '내 프로필') } });
    await run(['watchlists'], t.io);
    expect(t.result()).toEqual({
      ok: true,
      data: { profile: '내 프로필', groups: [{ id: 'g0', name: '반도체', symbols: [{ symbol: '005930', hidden: false }, { symbol: '000660', hidden: true }] }] },
    });
  });

  it('프로필이 여럿이면 profile-required(+목록), --profile로 고른다', async () => {
    const { t } = setup({ p1: { doc: profileDoc(2, '내 프로필') }, p2: { doc: profileDoc(2, '회사') } });
    expect(await run(['watchlists'], t.io)).toBe(1);
    expect(t.result()).toMatchObject({ ok: false, error: { code: 'profile-required' }, data: { profiles: [{ id: 'p1', name: '내 프로필' }, { id: 'p2', name: '회사' }] } });
    const u = setup({ p1: { doc: profileDoc(2, '내 프로필') }, p2: { doc: profileDoc(2, '회사') } });
    expect(await run(['watchlists', '--profile', '회사'], u.t.io)).toBe(0);
    expect(u.t.result().data.profile).toBe('회사');
  });
});

describe('gazua strategies', () => {
  it('전략 목록과 규칙 요약(앱의 문구를 그대로 쓴다). 그룹 전략은 종목을 풀어 준다', async () => {
    const { t } = setup({ p1: { doc: profileDoc(2) } });
    await run(['strategies'], t.io);
    const s = t.result().data.strategies[0];
    expect(s).toMatchObject({ id: 's2', name: '골든크로스 추세', universe: { kind: 'group', groupId: 'g0', symbols: ['005930', '000660'] }, sizing: '회당 총자산 10%' });
    expect(s.buy).toContain('반등 패턴');
    expect(s.sell).toContain('익절');
    expect(s.sell).toContain('손절');
    expect(s.rules).toBeUndefined();
  });

  it('--raw면 원 규칙(rules)도 함께 낸다', async () => {
    const { t } = setup({ p1: { doc: profileDoc(2) } });
    await run(['strategies', '--raw'], t.io);
    expect(t.result().data.strategies[0].rules.sell.stopLoss).toEqual({ on: true, pct: 7, basis: 'avgAlways' });
  });

  it('v1 문서의 전략도 v2로 옮겨 읽는다', async () => {
    const { t } = setup({ p1: { doc: profileDoc(1) } });
    await run(['strategies'], t.io);
    expect(t.result().data.strategies[0]).toMatchObject({ id: 's1', name: '눌림목' });
  });
});
