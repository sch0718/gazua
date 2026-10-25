import { describe, expect, it } from 'vitest';
import { createSafeStorage } from '../state/storage';
import { memoryBacking, seed } from '../state/testStorage';
import { newStrategy } from '../sim/defaults';
import { newCriteria } from '../screen/defaults';
import { FORBIDDEN_KEYS } from './forbidden';
import { checkProfileDoc, PROFILE_DOC_MAX_BYTES, type ProfileDocV1 } from './dto';
import { applyProfileDoc, buildProfileDoc } from './profileDoc';

const NOW = Date.UTC(2026, 9, 25, 3);
const PID = 'p-1';
// 지어낸 값. 실제 키 모양을 흉내 내지 않는다.
const FAKE = {
  kisKey: 'FAKE-KIS-APPKEY-0001',
  kisSecret: 'FAKE-KIS-SECRET-0001',
  tossId: 'FAKE-TOSS-ID-0001',
  tossSecret: 'FAKE-TOSS-SECRET-0001',
  proxyToken: 'FAKE-PROXY-TOKEN-0001',
  access: 'FAKE-ACCESS-TOKEN-0001',
  proxyUrl: 'https://fake-proxy.example.test',
};

function seeded() {
  const backing = memoryBacking();
  seed(backing, `p:${PID}:settings`, {
    provider: 'toss',
    proxyUrl: FAKE.proxyUrl,
    venueMode: 'NXT',
    period: { unit: 'W', n: 2 },
    metric: 'rsi',
    benchmark: 'KOSDAQ',
    theme: 'dark',
    colorConvention: 'global',
    boardOrder: 'mine',
    perfBenchmark: '069500',
    lastGroupId: 'g-1',
    keyLock: false,
    onboarded: true,
  });
  seed(backing, `p:${PID}:watchlists`, {
    groups: [{ id: 'g-1', name: '반도체', items: [{ symbol: '005930', colorSlot: 1, hidden: false, addedAt: 1 }] }],
  });
  seed(backing, `p:${PID}:secrets`, {
    kis: { appKey: FAKE.kisKey, appSecret: FAKE.kisSecret },
    toss: { clientId: FAKE.tossId, clientSecret: FAKE.tossSecret },
    proxyToken: FAKE.proxyToken,
  });
  seed(backing, `p:${PID}:token:toss`, { accessToken: FAKE.access, expiresAt: NOW + 1000 });
  seed(backing, `p:${PID}:recent`, ['000660']);
  seed(backing, `p:${PID}:strategies`, { strategies: [newStrategy(NOW, 'g-1', '눌림목')] });
  seed(backing, `p:${PID}:criteria`, { criteria: [newCriteria(NOW, null, '저평가')] });
  seed(backing, `p:${PID}:baskets`, { baskets: [{ id: 'b-1', name: '관찰', updatedAt: NOW, symbols: ['035420'] }] });
  return { backing, st: createSafeStorage(backing) };
}

function validDoc(): ProfileDocV1 {
  const { st } = seeded();
  return buildProfileDoc(st, PID, '내 프로필');
}

describe('buildProfileDoc', () => {
  it('키·토큰·프록시·최근 종목·기기 설정을 담지 않는다', () => {
    const doc = validDoc();
    const json = JSON.stringify(doc);
    for (const v of Object.values(FAKE)) expect(json).not.toContain(v);
    expect(json).not.toContain('000660');
    expect(Object.keys(doc.settings).sort()).toEqual(['benchmark', 'boardOrder', 'colorConvention', 'metric', 'perfBenchmark', 'period']);
    expect(doc.settings).toEqual({
      period: { unit: 'W', n: 2 },
      metric: 'rsi',
      benchmark: 'KOSDAQ',
      perfBenchmark: '069500',
      colorConvention: 'global',
      boardOrder: 'mine',
    });
  });

  it('만든 문서는 검사를 통과한다', () => {
    const doc = validDoc();
    expect(checkProfileDoc(doc, NOW)).toEqual({ ok: true, doc });
  });

  it('이름을 다듬는다', () => {
    const { st } = seeded();
    expect(buildProfileDoc(st, PID, '  ').name).toBe('내 프로필');
    expect([...buildProfileDoc(st, PID, 'ㄱ'.repeat(40)).name]).toHaveLength(30);
  });
});

describe('checkProfileDoc', () => {
  it.each(FORBIDDEN_KEYS)('금지 키 %s는 어느 깊이에 있어도 거절한다', (key) => {
    const top = { ...validDoc(), [key]: 'x' };
    expect(checkProfileDoc(top, NOW)).toMatchObject({ ok: false, code: 'forbidden-field', path: key });
    const nested = validDoc() as unknown as { strategies: Record<string, unknown>[] };
    nested.strategies[0].capital = { ...(nested.strategies[0].capital as object), [key]: 'x' };
    expect(checkProfileDoc(nested, NOW)).toMatchObject({ ok: false, code: 'forbidden-field', path: `strategies[0].capital.${key}` });
  });

  it('대소문자를 바꾼 금지 키도 거절한다', () => {
    expect(checkProfileDoc({ ...validDoc(), AppSecret: 'x' }, NOW)).toMatchObject({ code: 'forbidden-field' });
  });

  it('알 수 없는 필드를 거절한다', () => {
    expect(checkProfileDoc({ ...validDoc(), extra: 1 }, NOW)).toMatchObject({ code: 'unknown-field', path: 'extra' });
    const d = validDoc();
    (d.settings as unknown as Record<string, unknown>).fontSize = 3;
    expect(checkProfileDoc(d, NOW)).toMatchObject({ code: 'unknown-field', path: 'settings.fontSize' });
    const g = validDoc();
    (g.watchlists.groups[0] as unknown as Record<string, unknown>).note = '메모';
    expect(checkProfileDoc(g, NOW)).toMatchObject({ code: 'unknown-field', path: 'watchlists.groups[0].note' });
    const s = validDoc();
    (s.strategies[0] as unknown as Record<string, unknown>).memo = 'x';
    expect(checkProfileDoc(s, NOW)).toMatchObject({ code: 'unknown-field', path: 'strategies[0].memo' });
  });

  it('고칠 값이 있으면 고쳐 받지 않고 거절한다', () => {
    const d = validDoc();
    d.strategies[0].capital.perBuyPct = 500;
    expect(checkProfileDoc(d, NOW)).toMatchObject({ code: 'invalid', path: 'strategies[0].capital.perBuyPct' });
    const p = validDoc();
    p.settings.period = { unit: 'D', n: 7 };
    expect(checkProfileDoc(p, NOW)).toMatchObject({ code: 'invalid', path: 'settings.period' });
    const n = validDoc();
    n.name = ' 앞 공백';
    expect(checkProfileDoc(n, NOW)).toMatchObject({ code: 'invalid', path: 'name' });
    const missing = validDoc() as unknown as Record<string, unknown>;
    delete missing.baskets;
    expect(checkProfileDoc(missing, NOW)).toMatchObject({ code: 'invalid', path: 'baskets' });
    expect(checkProfileDoc({ ...validDoc(), v: 2 }, NOW)).toMatchObject({ code: 'invalid', path: 'v' });
    expect(checkProfileDoc([], NOW)).toMatchObject({ code: 'invalid' });
  });

  it('256 KiB를 넘으면 거절한다', () => {
    const d = validDoc();
    d.name = '큰';
    d.baskets = Array.from({ length: 30 }, (_, i) => ({
      id: `b-${i}`,
      name: `b${i}`,
      updatedAt: NOW,
      symbols: Array.from({ length: 300 }, (_, j) => String(100000 + i * 1000 + j)),
    }));
    // 30 × 300 × 약 9바이트 ≈ 81 KiB라서 그룹 이름으로 채운다
    d.watchlists.groups[0].name = 'x'.repeat(PROFILE_DOC_MAX_BYTES);
    expect(checkProfileDoc(d, NOW)).toMatchObject({ ok: false, code: 'too-large' });
  });
});

describe('applyProfileDoc', () => {
  it('같은 ID에 쓰고 기기 전용 설정·키·최근 종목은 그대로 둔다', () => {
    const { st, backing } = seeded();
    const doc = validDoc();
    doc.settings.metric = 'mcap';
    doc.watchlists.groups.push({ id: 'g-2', name: '2차전지', items: [] });
    applyProfileDoc(st, PID, doc);
    const after = buildProfileDoc(st, PID, '내 프로필');
    expect(after).toEqual(doc);
    const settings = JSON.parse(backing.getItem(`gazua:v1:p:${PID}:settings`)!);
    expect(settings).toMatchObject({ provider: 'toss', proxyUrl: FAKE.proxyUrl, venueMode: 'NXT', theme: 'dark', onboarded: true, lastGroupId: 'g-1' });
    expect(backing.getItem(`gazua:v1:p:${PID}:secrets`)).toContain(FAKE.proxyToken);
    expect(backing.getItem(`gazua:v1:p:${PID}:recent`)).toBe('["000660"]');
  });
});
