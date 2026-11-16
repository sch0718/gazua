import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { kstEpoch } from '../../../src/lib/time/kst';
import { parseArgv } from '../args';
import type { Ctx } from '../context';
import { createRedactor } from '../output';
import { cleanupDirs, fakeFetch, makeIo } from '../testing';
import { runDigest } from './digest';
import { ledgerPath, readLedger, writeLedger } from './ledger';

afterEach(cleanupDirs);
const today = '2026-11-13';
function fixture(o: { fail?: boolean; stale?: boolean; quoteError?: boolean; presets?: boolean; date?: string; time?: string } = {}) {
  const f = fakeFetch((c) => {
    if (c.url.hostname === 'ntfy.example') return { status: o.fail ? 500 : 200 };
    if (c.url.pathname.includes('/item/')) return o.quoteError ? { status: 500 } : { body: [
      { localDate: '20261112', openPrice: 69000, closePrice: 69000 },
      ...(!o.stale ? [{ localDate: '20261113', openPrice: 70000, closePrice: 70840 }] : []),
    ] };
    if (c.url.pathname.endsWith('/basic')) return { body: { stockName: '삼성전자' } };
  });
  const t = makeIo({ fetch: f, now: kstEpoch(o.date ?? today, o.time ?? '20:00:00'), env: {
    AUTO_STRATEGY: '내 전략', AUTO_DRY_PRESETS: o.presets ? 'all' : 'off',
    GAZUA_ALERT_NTFY_TOPIC: '시험용가짜토픽', GAZUA_ALERT_NTFY_SERVER: 'https://ntfy.example',
  } });
  const ctx: Ctx = { ...t.io, args: parseArgv(['auto', 'digest']), dir: t.dir, redact: createRedactor(), say: () => {}, log: () => {}, warn: () => {} };
  const path = ledgerPath(t.dir, 'dry'), state = join(t.dir, 'auto-digest.json');
  const seed = (preset?: string) => {
    const ledger = readLedger(path, today);
    ledger.strategyId = preset ? `preset-${preset}` : 's';
    ledger.today = { date: today, judgedDate: today, bought: [], sold: [] };
    ledger.positions = [{ symbol: '005930', boughtAt: today, buyPrice: 70000, boughtQty: 10, qty: 10, peak: 70000, sells: [] }];
    writeLedger(ledgerPath(t.dir, 'dry', preset), ledger);
    return ledger;
  };
  return { ...t, ctx, f, path, state, seed, run: () => runDigest(ctx) };
}
const alerts = (t: ReturnType<typeof fixture>) => t.f.calls.filter((c) => c.url.hostname === 'ntfy.example');
const message = (t: ReturnType<typeof fixture>) => alerts(t)[0].body as { title: string; message: string };

it('당일 거래·보유 수익률과 거래 없는 프리셋을 한 번 요약하고 상태만 저장한다', async () => {
  const t = fixture({ presets: true });
  const ledger = t.seed();
  ledger.today.trades = [{ side: 'BUY', symbol: '005930', name: '삼성전자', qty: 10, price: 70000, reason: '조건 충족' },
    { side: 'SELL', symbol: '000660', name: '다른 종목', qty: 1, price: 200000, reason: '기간 청산' }];
  writeLedger(t.path, ledger);
  t.seed('rebound');
  const before = readFileSync(t.path, 'utf8');
  expect(await t.run()).toEqual({ sent: true });
  expect(message(t)).toMatchObject({ title: '[연습] 오늘 연습 결과 11/13', message: expect.stringContaining('내 전략') });
  expect(message(t).message).toContain('매수 005930 삼성전자 10주 70,000원 (조건 충족)');
  expect(message(t).message).toContain('매도 000660 다른 종목 1주 200,000원 (기간 청산)');
  expect(message(t).message).toContain('삼성전자 10주 70,000→70,840 +1.2%');
  expect(message(t).message).toContain('하락 후 반등\n거래 없음');
  expect(message(t).message).toContain('200일선 추세 추종\n오늘 기록 없음');
  expect(message(t).message).toMatch(/투자 조언 아님$/);
  expect(t.f.calls.filter((c) => c.url.pathname.includes('/item/'))).toHaveLength(1);
  expect(readFileSync(t.path, 'utf8')).toBe(before);
  expect(JSON.parse(readFileSync(t.state, 'utf8'))).toEqual({ date: today });
  expect(statSync(t.state).mode & 0o777).toBe(0o600);
  expect(await t.run()).toEqual({ skipped: 'sent' });
  expect(alerts(t)).toHaveLength(1);
});
it.each(['설정 오류', '장 상태 오류', '어제 표식', '기존 원장', '손상 원장', '없음'])('%s만 있으면 요약하지 않는다', async (kind) => {
  const t = fixture();
  if (kind !== '없음') {
    const ledger = t.seed();
    delete ledger.today.judgedDate;
    ledger.today.trades = [];
    if (kind === '어제 표식') ledger.today = { date: '2026-11-12', judgedDate: '2026-11-12', bought: [], sold: [] };
    if (kind.includes('오류')) ledger.notified = [`${today}:internal`, `${today}:recover`];
    writeLedger(t.path, ledger);
    if (kind === '손상 원장') writeFileSync(t.path, '{');
  }
  expect(await t.run()).toEqual({ skipped: 'closed' });
  expect(t.f.calls).toHaveLength(0);
  expect(existsSync(t.state)).toBe(false);
});
it('거래 없는 당일 판정과 그 뒤 오류도 요약하며 손상된 다른 원장은 격리한다', async () => {
  const t = fixture({ presets: true });
  const ledger = t.seed('ma200');
  ledger.positions = [];
  ledger.notified = [`${today}:internal`];
  writeLedger(ledgerPath(t.dir, 'dry', 'ma200'), ledger);
  writeFileSync(t.path, '{');
  expect(await t.run()).toEqual({ sent: true });
  expect(message(t).message).toContain('내 전략\n오늘 기록 없음');
  expect(message(t).message).toContain('200일선 추세 추종\n거래 없음');
});
it.each([{ stale: true }, { quoteError: true }])('오늘 종가가 없으면 이전 봉 대신 평가 불가로 표시한다: %j', async (o) => {
  const t = fixture(o); t.seed();
  await t.run();
  expect(message(t).message).toContain('삼성전자 10주 70,000→평가 불가');
  expect(message(t).message).not.toContain('%');
});
it('전송 실패는 상태를 저장하지 않아 재시도할 수 있다', async () => {
  const t = fixture({ fail: true }); t.seed();
  expect(await t.run()).toEqual({ sent: false });
  expect(await t.run()).toEqual({ sent: false });
  expect(existsSync(t.state)).toBe(false);
  expect(alerts(t)).toHaveLength(2);
});
it.each([{ date: '2026-11-14' }, { time: '15:29:59' }])('주말·장 마감 전에는 아무것도 읽거나 보내지 않는다: %j', async (o) => {
  const t = fixture(o); t.seed();
  expect(await t.run()).toEqual({ skipped: 'hours' });
  expect(t.f.calls).toHaveLength(0);
});
it('긴 본문을 3500바이트 안에서 줄 단위로 자르고 끝 문구를 유지한다', async () => {
  const t = fixture();
  const ledger = t.seed();
  ledger.today.trades = Array.from({ length: 100 }, () => ({ side: 'BUY', symbol: '005930', name: '삼성전자', qty: 10, price: 70000, reason: '조건 충족' }));
  writeLedger(t.path, ledger);
  await t.run();
  expect(Buffer.byteLength(message(t).message)).toBeLessThanOrEqual(3500);
  expect(message(t).message).toMatch(/\n…\(줄임\)\n투자 조언 아님$/);
  expect(message(t).message).not.toContain('�');
});
