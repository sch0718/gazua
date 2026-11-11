import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { kstEpoch } from '../../../src/lib/time/kst';
import { appendLog, readLogs, readState } from '../alert/state';
import { writeAuth } from '../config';
import { execute } from '../execute';
import { parseArgv } from '../args';
import { run } from '../main';
import { createRedactor } from '../output';
import { cleanupDirs, fakeFetch, makeIo, profileDoc, syncServer, type FakeCall, type FakeReply } from '../testing';
import { targetSymbols } from './alert';

afterEach(cleanupDirs);
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/naver/${name}.json`, import.meta.url), 'utf8'));
const NOW = kstEpoch('2026-11-11', '10:40:00');
const ENV = { GAZUA_ALERT_NTFY_TOPIC: 'testtopic-abcdefghijkl' };
function spikyWeek() {
  const week = fixture('es-week');
  for (const key of Object.keys(week.priceInfos)) week.priceInfos[key] = week.priceInfos[key].filter((b: { localDateTime: string }) => b.localDateTime <= '20261110192000');
  const sorted = Object.values(week.priceInfos).flat().sort((a: any, b: any) => a.localDateTime.localeCompare(b.localDateTime)) as { currentPrice: number }[];
  sorted.at(-1)!.currentPrice = sorted.at(-2)!.currentPrice * 1.01;
  return week;
}
function setup(o: { now?: number; dir?: string; ntfy?: FakeReply; route?: (c: FakeCall) => FakeReply | undefined } = {}) {
  const f = fakeFetch((c) => {
    const override = o.route?.(c);
    if (override !== undefined) return override;
    if (c.url.hostname === 'ntfy.sh') return o.ntfy ?? { body: { id: '시험' } };
    if (c.url.pathname.endsWith('/KOSPI')) return { body: fixture('kospi-polling') };
    if (c.url.pathname.includes('EScv1')) return { body: spikyWeek() };
    if (c.url.pathname.includes('NQcv1')) return { body: {} };
    if (c.url.pathname.includes('/item/')) return { body: fixture('item-week') };
    if (c.url.pathname.includes('/marketindex/')) return { body: fixture('dxy') };
    return undefined;
  });
  const t = makeIo({ env: { ...ENV }, now: o.now ?? NOW, fetch: f, dir: o.dir });
  return { t, f, sends: () => f.calls.filter((c) => c.url.hostname === 'ntfy.sh') };
}

describe('gazua alert', () => {
  it('급변을 한 번 보내고 기록하며 같은 봉은 다시 보내지 않는다', async () => {
    const { t, sends } = setup();
    expect(await run(['alert', 'watch', '--symbols', '000660'], t.io)).toBe(0);
    expect(sends()).toHaveLength(1);
    expect(sends()[0]).toMatchObject({ method: 'POST', body: { topic: ENV.GAZUA_ALERT_NTFY_TOPIC, title: expect.stringContaining('ES') } });
    expect(sends()[0].headers.get('title')).toBeNull();
    expect(readLogs(t.dir)).toMatchObject([{ kind: 'watch', delivered: true, barEnd: kstEpoch('2026-11-11', '10:30:00') }]);
    const again = setup({ dir: t.dir });
    await run(['alert', 'watch', '--symbols', '000660'], again.t.io);
    expect(again.sends()).toHaveLength(0);
    expect(readLogs(t.dir)).toHaveLength(1);
  });
  it('장 시간 밖이면 설정·네트워크 없이 끝낸다', async () => {
    const { t, f } = setup({ now: kstEpoch('2026-11-11', '08:30:00') });
    t.io.env = {};
    await run(['alert', 'watch'], t.io);
    expect(t.result().data).toEqual({ skipped: 'hours' });
    expect(f.calls).toHaveLength(0);
  });
  it('휴장과 선물 없음·급변 없음은 기록을 쓰지 않는다', async () => {
    for (const kind of ['closed', 'nodata', 'quiet']) {
      const { t, sends } = setup({ route: (c) => {
        if (kind === 'closed' && c.url.pathname.endsWith('/KOSPI')) return { body: { datas: [{ marketStatus: 'CLOSE' }] } };
        if (kind === 'nodata' && c.url.pathname.includes('/futures/')) return { status: 503 };
        if (kind === 'quiet' && c.url.pathname.includes('/futures/')) return { body: fixture('es-week') };
      } });
      await run(['alert', 'watch', '--symbols', '000660'], t.io);
      if (kind === 'quiet') expect(t.result().data).toEqual({ spikes: [] });
      else expect(t.result().data.skipped).toBe(kind);
      expect(sends()).toHaveLength(0);
      expect(readState(t.dir, 'watch', null)).toBeNull();
    }
  });
  it('휴장 조회 실패·종목 일부 실패·참고값 실패에도 남은 값으로 보낸다', async () => {
    const { t, sends } = setup({ route: (c) => {
      if (c.url.pathname.endsWith('/KOSPI') || c.url.pathname.includes('/item/005930') || c.url.pathname.includes('/marketindex/')) return { status: 503 };
    } });
    expect(await run(['alert', 'watch', '--symbols', '005930,000660'], t.io)).toBe(0);
    expect(sends()).toHaveLength(1);
    expect((sends()[0].body as { message: string }).message).toContain('빠진 지표:');
  });
  it.each([500, new TypeError(`https://ntfy.sh/${ENV.GAZUA_ALERT_NTFY_TOPIC}`)])('ntfy 실패를 기록하고 URL·토픽을 출력하지 않는다: %s', async (failure) => {
    const { t, sends } = setup({ ntfy: typeof failure === 'number' ? { status: failure } : failure });
    await run(['alert', 'watch', '--symbols', '000660', '--verbose'], t.io);
    expect(sends()).toHaveLength(1);
    expect(readLogs(t.dir)[0]).toMatchObject({ delivered: false, sentAt: null });
    expect(t.err.join('')).toContain('ntfy 전송 실패: HTTP');
    expect(t.out.join('') + t.err.join('') + JSON.stringify(readLogs(t.dir))).not.toMatch(/testtopic|https:\/\/ntfy/);
    const again = setup({ dir: t.dir });
    await run(['alert', 'watch', '--symbols', '000660'], again.t.io);
    expect(again.sends()).toHaveLength(0);
  });
  it.each([['watch', '--symbols', '12345'], ['foo'], ['premarket'], ['test', '추가']])('잘못된 하위 명령·옵션은 종료 코드 2다: %j', async (...args) => {
    const { t, f } = setup();
    expect(await run(['alert', ...args], t.io)).toBe(2);
    expect(t.result().error.code).toBe('invalid-args');
    expect(f.calls).toHaveLength(0);
  });
  it('test는 시험 문구를 보낸다', async () => {
    const { t, sends } = setup();
    await run(['alert', 'test'], t.io);
    expect(t.result().data).toEqual({ delivered: true });
    expect((sends()[0].body as { title: string }).title).toBe('gazua 알람 시험');
  });
  it('로그인이 필요하다는 알림은 KST 하루 한 번 보내고 원래 오류를 돌려준다', async () => {
    const { t, sends } = setup();
    expect(await run(['alert', 'watch'], t.io)).toBe(1);
    expect(t.result().error.code).toBe('not-logged-in');
    expect(sends()).toHaveLength(1);
    expect((sends()[0].body as { title: string }).title).toBe('gazua login 필요');
    t.out.length = 0;
    await run(['alert', 'watch'], t.io);
    expect(sends()).toHaveLength(1);
  });
  it('stats는 기록이 없으면 네트워크·설정 없이 표본 0을 돌려준다', async () => {
    const { t, f } = setup(); t.io.env = {};
    await run(['alert', 'stats'], t.io);
    expect(t.result().data).toEqual({ kinds: { watch: { hit: 0, n: 0, days: 0, baseUp: 0 } } });
    expect(f.calls).toHaveLength(0);
  });
  it('stats는 발송 뒤 첫 완성 봉의 방향만 평가하고 실패·오래된 기록은 뺀다', async () => {
    const sentAt = kstEpoch('2026-11-10', '10:35:00');
    const bars = { priceInfos: { a: [
      { localDateTime: '20261110102000', currentPrice: 100 },
      { localDateTime: '20261110103000', currentPrice: 101 },
      { localDateTime: '20261110104000', currentPrice: 90 },
    ] } };
    const { t } = setup({ route: (c) => c.url.pathname.includes('/item/') ? { body: bars } : undefined });
    const line = { kind: 'watch' as const, receivedAt: sentAt, sentAt, changes: { ES: 0.01 }, picks: [{ code: '000660', expected: 0.01 }], delivered: true };
    appendLog(t.dir, line);
    appendLog(t.dir, { ...line, delivered: false });
    appendLog(t.dir, { ...line, sentAt: kstEpoch('2026-10-01', '10:35:00') });
    await run(['alert', 'stats'], t.io);
    expect(t.result().data.kinds.watch).toEqual({ hit: 1, n: 1, days: 1, baseUp: 1 });
    expect(readLogs(t.dir)[0]).not.toHaveProperty('outcome');
  });
});

describe('대상 종목', () => {
  it('명시한 코드라면 로그인 없이 중복을 뺀다', async () => {
    const t = makeIo();
    const r = await execute(targetSymbols, parseArgv(['alert', '--symbols', '000660,005930,000660']), t.io, createRedactor());
    expect(r).toMatchObject({ ok: true, data: [{ code: '000660', name: '000660' }, { code: '005930', name: '005930' }] });
  });
  it('숨김·중복을 빼고 그룹 순서대로 30개까지 읽는다', async () => {
    const doc = profileDoc(2) as any;
    doc.watchlists.groups[0].items.push(...Array.from({ length: 40 }, (_, i) => ({ symbol: String(i).padStart(6, '0'), hidden: false })), { symbol: '005930', hidden: false });
    const t = makeIo({ fetch: syncServer({ p1: { doc } }) });
    writeAuth(t.dir, { v: 1, server: 'https://sync.example', token: 'token', tokenId: 't', label: '시험', expiresAt: NOW + 86400_000 });
    const r = await execute(targetSymbols, parseArgv(['alert']), t.io, createRedactor());
    expect(r.ok).toBe(true);
    if (r.ok) {
      const list = r.data as { code: string }[];
      expect(list).toHaveLength(30);
      expect(list[0].code).toBe('005930');
      expect(list.some((s) => s.code === '000660')).toBe(false);
      expect(new Set(list.map((s) => s.code)).size).toBe(30);
    }
  });
});
