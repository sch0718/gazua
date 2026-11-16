import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { cleanupDirs, tempDir } from '../testing';
import { ledgerPath, readLedger, writeLedger, type AutoLedger } from './ledger';

afterEach(cleanupDirs);
const date = '2026-11-13';
it('없는 원장은 비우고 날짜가 바뀌면 당일 기록을 비운다', () => {
  const dir = tempDir();
  const path = ledgerPath(dir, 'dry');
  const ledger = readLedger(path, date);
  expect(path).not.toBe(ledgerPath(dir, 'live'));
  expect(ledger).toEqual({ version: 1, strategyId: null, today: { date, bought: [], sold: [] }, positions: [], notified: [] });
  ledger.today.bought.push('005930');
  writeLedger(path, ledger);
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(ledger);
  expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(readLedger(path, '2026-11-16').today).toEqual({ date: '2026-11-16', bought: [], sold: [] });
});

it('읽을 수 없거나 값이 잘못된 원장을 빈 원장으로 바꾸지 않는다', () => {
  const path = ledgerPath(tempDir(), 'live');
  const ledger: AutoLedger = { version: 1, strategyId: 's', today: { date, bought: [], sold: [] }, notified: [], positions: [{ symbol: '005930', boughtAt: date, buyPrice: 100, boughtQty: 10, qty: 9, peak: 100, sells: [] }] };
  for (const value of ['{', JSON.stringify(ledger), JSON.stringify({ ...ledger, today: { ...ledger.today, date: '2026-02-29' } }), JSON.stringify({ ...ledger, positions: [{ ...ledger.positions[0], qty: 10 }, { ...ledger.positions[0], qty: 10 }] })]) {
    writeFileSync(path, value);
    expect(() => readLedger(path, date)).toThrow(`자동 실행 원장을 읽을 수 없어요: ${path}`);
  }
});

it('판정 표식과 거래를 검증하고 원본 읽기에서는 날짜를 보존한다', async () => {
  const { readLedgerRaw } = await import('./ledger');
  const path = ledgerPath(tempDir(), 'dry', 'rebound');
  expect(path).toContain('auto-positions.dry.preset-rebound.json');
  const ledger = readLedger(path, date);
  ledger.today.judgedDate = date;
  ledger.today.trades = [{ side: 'BUY', symbol: '005930', name: '삼성전자', qty: 10, price: 70000, reason: '조건 충족' }];
  writeLedger(path, ledger);
  expect(readLedgerRaw(path)).toEqual(ledger);
  expect(readLedger(path, '2026-11-16').today).toEqual({ date: '2026-11-16', bought: [], sold: [] });
  for (const judgedDate of ['오류', '2026-02-29', '2026-11-16']) {
    writeFileSync(path, JSON.stringify({ ...ledger, today: { ...ledger.today, judgedDate } }));
    expect(() => readLedgerRaw(path)).toThrow();
  }
  for (const trade of [{ ...ledger.today.trades[0], qty: 0 }, { ...ledger.today.trades[0], side: '다른값' }, { ...ledger.today.trades[0], price: -1 }]) {
    writeFileSync(path, JSON.stringify({ ...ledger, today: { ...ledger.today, trades: [trade] } }));
    expect(() => readLedgerRaw(path)).toThrow();
  }
});
