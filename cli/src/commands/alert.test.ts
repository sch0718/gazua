import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { addDays, kstEpoch } from '../../../src/lib/time/kst';
import { appendLog, readLogs, readState, writeState } from '../alert/state';
import { parseDayBars } from '../naverMarket';
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
  it('선물 10분 지연 자료의 진행 중인 봉은 완성 봉으로 판정하지 않는다', async () => {
    const week = fixture('es-week');
    const sorted = Object.values(week.priceInfos).flat().sort((a: any, b: any) => a.localDateTime.localeCompare(b.localDateTime)) as { localDateTime: string; currentPrice: number }[];
    expect(sorted.at(-1)!.localDateTime).toBe('20261110205000'); // end = KST 12:00, 받은 시각 12:01에는 1분치만 쌓인 봉
    sorted.at(-1)!.currentPrice = sorted.at(-2)!.currentPrice * 1.01;
    const { t, sends } = setup({ now: kstEpoch('2026-11-11', '12:01:00'), route: (c) => (c.url.pathname.includes('EScv1') ? { body: week } : undefined) });
    await run(['alert', 'watch', '--symbols', '000660'], t.io);
    expect(t.result().data).toEqual({ spikes: [] });
    expect(sends()).toHaveLength(0);
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
  it.each([['watch', '--symbols', '12345'], ['foo'], ['test', '추가']])('잘못된 하위 명령·옵션은 종료 코드 2다: %j', async (...args) => {
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
    expect(t.result().data).toMatchObject({ kinds: { watch: { hit: 0, n: 0, days: 0, baseUp: 0 }, premarket: { hit: 0, n: 0, days: 0, baseUp: 0, recent20: [] } } });
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

function setupPremarket(o: { now?: number; dir?: string; ntfy?: FakeReply; route?: (c: FakeCall) => FakeReply | undefined } = {}) {
  const csv = readFileSync(new URL('../fixtures/fred/DGS10.csv', import.meta.url), 'utf8');
  const f = fakeFetch((c) => {
    const override = o.route?.(c);
    if (override !== undefined) return override;
    if (c.url.hostname === 'ntfy.sh') return o.ntfy ?? { body: {} };
    if (c.url.hostname === 'fred.stlouisfed.org') return { body: csv.replaceAll('DGS10', c.url.searchParams.get('id')!) };
    if (c.url.pathname.endsWith('/KOSPI')) return { body: { ...fixture('kospi-polling'), datas: [{ marketStatus: 'PREOPEN' }] } };
    if (c.url.pathname.includes('EScv1/day')) return { body: fixture('es-day') };
    if (c.url.pathname.includes('NQcv1/day')) return { body: fixture('nq-day') };
    if (c.url.pathname.includes('/item/')) return { body: fixture('item-day') };
    if (c.url.pathname.includes('/marketindex/bond/')) return { body: fixture('rate') };
    if (c.url.pathname.includes('/marketindex/energy/')) return { body: fixture('oil') };
    if (c.url.pathname.includes('/marketindex/exchange/')) return { body: fixture('dxy') };
  });
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const res = await f(input, init);
    // fakeFetch는 JSON 응답용이므로 FRED만 실제 CSV 응답으로 바꾼다.
    return String(input).includes('fred.stlouisfed.org') && res.ok ? new Response(await res.json()) : res;
  };
  const t = makeIo({ env: { ...ENV }, now: o.now ?? kstEpoch('2026-11-11', '08:40:00'), fetch, dir: o.dir });
  return { t, f, sends: () => f.calls.filter((c) => c.url.hostname === 'ntfy.sh') };
}

describe('gazua alert premarket', () => {
  it('08:40 PREOPEN에 한 번 보내고 KST 같은 날의 재발송을 막는다', async () => {
    const { t, f, sends } = setupPremarket();
    expect(await run(['alert', 'premarket', '--symbols', '000660'], t.io)).toBe(0);
    expect(sends()).toHaveLength(1);
    const data = t.result().data;
    expect(data).toMatchObject({ sent: true, backtest: { days: 60 }, picks: [expect.objectContaining({ code: '000660', sym: expect.stringMatching(/ES|NQ/) })] });
    expect(readState(t.dir, 'premarket', null)).toMatchObject({ sentDate: '2026-11-11' });
    expect(readLogs(t.dir)).toMatchObject([{ kind: 'premarket', delivered: true, sentAt: expect.any(Number), barStart: expect.any(Number), barEnd: expect.any(Number) }]);
    expect((sends()[0].body as { message: string }).message).toContain('백테스트');
    expect((sends()[0].body as { message: string }).message).toContain('과거 경향이며 투자 조언이 아님');
    expect((sends()[0].body as { message: string }).message).not.toMatch(/매수|매도/);
    for (const c of f.calls.filter((c) => c.url.hostname === 'api.stock.naver.com' || c.url.hostname === 'polling.finance.naver.com')) expect(c.headers.get('user-agent')).toBeTruthy();
    const day = f.calls.find((c) => c.url.pathname.includes('EScv1/day'))!;
    expect(day.url.searchParams.get('startDateTime')).toBe('202411110000');
    expect(day.url.searchParams.get('endDateTime')).toBe('202611112359');
    const again = setupPremarket({ dir: t.dir });
    await run(['alert', 'premarket', '--symbols', '000660'], again.t.io);
    expect(again.t.result().data).toEqual({ skipped: 'sent' });
    expect(again.f.calls).toHaveLength(0);
  });
  it.each(['07:59:00', '09:00:00', '09:05:00'])('%s에는 보내지 않고 late 기록을 남긴다', async (clock) => {
    const { t, sends } = setupPremarket({ now: kstEpoch('2026-11-11', clock) });
    await run(['alert', 'premarket', '--symbols', '000660'], t.io);
    expect(sends()).toHaveLength(0);
    expect(t.result().data).toMatchObject({ sent: false, reason: 'late' });
    expect(readLogs(t.dir)).toMatchObject([{ sentAt: null, delivered: false, note: 'late' }]);
    expect(readState(t.dir, 'premarket', {})).not.toHaveProperty('sentDate');
  });
  it('08:59:59에 시작해 자료 수집 중 09:00을 넘기면 보내지 않는다', async () => {
    const { t, sends } = setupPremarket({ now: kstEpoch('2026-11-11', '08:59:59') + 500 });
    await run(['alert', 'premarket', '--symbols', '000660,005930,035420'], t.io);
    expect(t.clock.now).toBeGreaterThanOrEqual(kstEpoch('2026-11-11', '09:00:00'));
    expect(sends()).toHaveLength(0);
    expect(t.result().data).toMatchObject({ sent: false, reason: 'late' });
  });
  it.each(['CLOSE', 'AFTER_HOURS'])('marketStatus %s면 휴장으로 끝낸다', async (status) => {
    const { t, f, sends } = setupPremarket({ route: (c) => c.url.pathname.endsWith('/KOSPI') ? { body: { datas: [{ marketStatus: status }] } } : undefined });
    await run(['alert', 'premarket', '--symbols', '000660'], t.io);
    expect(t.result().data).toEqual({ skipped: 'closed' });
    expect(sends()).toHaveLength(0);
    expect(f.calls).toHaveLength(1);
    expect(readLogs(t.dir)).toHaveLength(0);
  });
  it('polling 실패 때 계속 보내고 휴장 판단 불가를 알린다', async () => {
    const { t, sends } = setupPremarket({ route: (c) => c.url.pathname.endsWith('/KOSPI') ? { status: 503 } : undefined });
    await run(['alert', 'premarket', '--symbols', '000660'], t.io);
    expect(sends()).toHaveLength(1);
    expect((sends()[0].body as { message: string }).message).toContain('휴장 여부 확인 못 함');
  });
  it('FRED 실패 때 매크로 줄을 빼고 빠진 지표를 적는다', async () => {
    const { t, sends } = setupPremarket({ route: (c) => c.url.hostname === 'fred.stlouisfed.org' ? { status: 503 } : undefined });
    await run(['alert', 'premarket', '--symbols', '000660'], t.io);
    const msg = (sends()[0].body as { message: string }).message;
    expect(msg).toContain('빠진 지표: 유가, 금리, 달러');
    expect(msg).not.toMatch(/같은 쪽|반대쪽/);
  });
  it('72시간 지난 참고값을 빼고 금리는 fluctuations를 bp로 표시한다', async () => {
    const { t, sends } = setupPremarket({ route: (c) => c.url.pathname.includes('/marketindex/energy/') ? { body: { ...fixture('oil'), localTradedAt: '2026-11-08T08:00:00+09:00' } } : undefined });
    await run(['alert', 'premarket', '--symbols', '000660'], t.io);
    const msg = (sends()[0].body as { message: string }).message;
    expect(msg).toContain('금리 +14bp');
    expect(msg).toContain('빠진 지표: 유가');
    expect(msg).not.toContain('유가 +');
  });
  it('선물 일부·종목 일부 실패에도 남은 종목을 쓰고, 선물이 모두 없으면 기록만 쓴다', async () => {
    const partial = setupPremarket({ route: (c) => c.url.pathname.includes('NQcv1/day') || c.url.pathname.includes('/item/005930/') ? { status: 503 } : undefined });
    await run(['alert', 'premarket', '--symbols', '005930,000660'], partial.t.io);
    expect(partial.sends()).toHaveLength(1);
    expect(partial.t.result().data.picks[0].sym).toBe('ES');
    expect((partial.sends()[0].body as { message: string }).message).toContain('빠진 지표: NQ, 005930');
    const none = setupPremarket({ route: (c) => c.url.pathname.includes('/futures/') ? { status: 503 } : undefined });
    await run(['alert', 'premarket', '--symbols', '000660'], none.t.io);
    expect(none.sends()).toHaveLength(0);
    expect(none.t.result().data).toMatchObject({ sent: false, reason: 'nodata' });
    expect(readLogs(none.t.dir)).toMatchObject([{ kind: 'premarket', sentAt: null, delivered: false }]);
  });
  it('발송 실패는 기록하고 발송일 상태에 넣지 않으며 토픽을 노출하지 않는다', async () => {
    const { t } = setupPremarket({ ntfy: new TypeError(`https://ntfy.sh/${ENV.GAZUA_ALERT_NTFY_TOPIC}`) });
    await run(['alert', 'premarket', '--symbols', '000660'], t.io);
    expect(t.result().data.sent).toBe(false);
    expect(readLogs(t.dir)).toMatchObject([{ delivered: false, sentAt: null, note: '보내지 못함' }]);
    expect(readState(t.dir, 'premarket', {})).not.toHaveProperty('sentDate');
    expect(t.out.join('') + t.err.join('') + JSON.stringify(readLogs(t.dir))).not.toContain(ENV.GAZUA_ALERT_NTFY_TOPIC);
  });
  it('로그인 필요 알림을 상태 이름별로 하루 한 번만 보낸다', async () => {
    const { t, sends } = setupPremarket();
    writeState(t.dir, 'watch', { loginNotified: '2026-11-11' });
    expect(await run(['alert', 'premarket'], t.io)).toBe(1);
    expect(t.result().error.code).toBe('not-logged-in');
    expect(sends()).toHaveLength(1);
    t.out.length = 0;
    await run(['alert', 'premarket'], t.io);
    expect(sends()).toHaveLength(1);
    expect(readState(t.dir, 'premarket', {})).toMatchObject({ loginNotified: '2026-11-11' });
  });
  it('stats와 다음 실행은 실제 발송 기록만 시가/전일 종가로 평가하고 20일부터 기록을 표시한다', async () => {
    const stock = parseDayBars(fixture('item-day')).filter((s) => s.date < '2026-11-11');
    const { t, sends } = setupPremarket();
    for (const b of stock.slice(-21)) {
      const i = stock.indexOf(b), sentAt = kstEpoch(b.date, '08:40:00');
      appendLog(t.dir, { kind: 'premarket', receivedAt: sentAt, sentAt, changes: {}, picks: [{ code: '000660', expected: b.open / stock[i - 1].close - 1 }], delivered: true });
    }
    const first = readLogs(t.dir)[0];
    appendLog(t.dir, { ...first, delivered: false });
    appendLog(t.dir, { ...first, sentAt: null });
    await run(['alert', 'stats'], t.io);
    const record = t.result().data.kinds.premarket;
    expect(record.hit).toBe(1);
    expect(record.n).toBe(stock.slice(-21).filter((b) => b.open !== stock[stock.indexOf(b) - 1].close).length);
    expect(record.days).toBeGreaterThanOrEqual(20);
    expect(record.recent20).toHaveLength(20);
    t.out.length = 0;
    await run(['alert', 'premarket', '--symbols', '000660'], t.io);
    expect(t.result().data.record).toMatchObject({ ...record, source: '기록' });
    const msg = (sends()[0].body as { message: string }).message;
    expect(msg).toContain('기록 방향 적중 100%');
    expect(msg).not.toContain('백테스트');
  });
  it('19거래일 기록은 백테스트를, 20거래일부터 기록을 쓰며 오늘 개장 전 기록은 평가하지 않는다', async () => {
    const stock = parseDayBars(fixture('item-day')).filter((s) => s.date < '2026-11-11');
    const { t } = setupPremarket();
    const log = (date: string) => {
      const sentAt = kstEpoch(date, '08:40:00');
      appendLog(t.dir, { kind: 'premarket', receivedAt: sentAt, sentAt, changes: {}, picks: [{ code: '000660', expected: 0.01 }], delivered: true });
    };
    const days = stock.filter((b, i) => i > 0 && b.open !== stock[i - 1].close).slice(-20).map((b) => b.date);
    for (const d of days.slice(1)) log(d); // 실제 거래일 19개
    log('2026-11-11'); // 오늘 08:40 기록: 시가 전이라 세지 않는다
    await run(['alert', 'stats'], t.io);
    expect(t.result().data.kinds.premarket.days).toBe(19);
    t.out.length = 0;
    await run(['alert', 'premarket', '--symbols', '000660'], t.io);
    expect(t.result().data.record.source).toBe('백테스트');
    log(days[0]); // 20번째 거래일
    t.out.length = 0;
    await run(['alert', 'stats'], t.io);
    expect(t.result().data.kinds.premarket.days).toBe(20);
  });
  it('stats는 당일 종가 방향 대신 시가 방향을 쓰며 실패·시가 보합을 제외한다', async () => {
    const bars = [
      { localDate: '20261106', openPrice: 100, closePrice: 100 },
      { localDate: '20261109', openPrice: 110, closePrice: 90 },
      { localDate: '20261110', openPrice: 80, closePrice: 100 },
      { localDate: '20261111', openPrice: 100, closePrice: 80 },
    ];
    const { t } = setupPremarket({ now: kstEpoch('2026-11-11', '09:05:00'), route: (c) => c.url.pathname.includes('/item/') ? { body: bars } : undefined });
    for (const [date, expected] of [['2026-11-09', 0.01], ['2026-11-10', -0.01], ['2026-11-11', 0.01]] as const) {
      const sentAt = kstEpoch(date, '08:40:00');
      const line = { kind: 'premarket' as const, receivedAt: sentAt, sentAt, changes: {}, picks: [{ code: '000660', expected }], delivered: true };
      appendLog(t.dir, line);
      appendLog(t.dir, { ...line, delivered: false });
      appendLog(t.dir, { ...line, sentAt: null });
    }
    await run(['alert', 'stats'], t.io);
    expect(t.result().data.kinds.premarket).toMatchObject({ hit: 1, n: 2, days: 2, baseUp: 0.5, recent20: [{ date: '2026-11-09', hit: 1, n: 1 }, { date: '2026-11-10', hit: 1, n: 1 }] });
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
