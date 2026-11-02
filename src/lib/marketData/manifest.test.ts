import { describe, expect, it } from 'vitest';
import { checkMarketBody, checkMarketFiles, checkMarketMeta, MARKET_FILE_MAX_BYTES } from './manifest';

const meta = () => ({
  name: 'market-data-20261031.json.gz',
  sha256: 'a'.repeat(64),
  size: 1234,
  version: 4,
  collectedAt: '2026-10-31T18:00:00+09:00',
  range: { from: '2021-10-31', to: '2026-10-31' },
  stocks: 2600,
});
const body = () => ({ ...meta(), driveFileId: '1AbC_def-GHIjkl' });

describe('checkMarketMeta', () => {
  it('정상 메타를 그대로 돌려준다', () => {
    expect(checkMarketMeta(meta())).toEqual({ ok: true, value: meta() });
  });
  it('알 수 없는 키는 unknown-field, driveFileId도 메타에서는 모르는 키다', () => {
    expect(checkMarketMeta({ ...meta(), extra: 1 })).toEqual({ ok: false, code: 'unknown-field', path: 'extra' });
    expect(checkMarketMeta(body())).toEqual({ ok: false, code: 'unknown-field', path: 'driveFileId' });
  });
  it.each([
    ['name', '시장.json.gz'],
    ['name', 'market data.json.gz'],
    ['name', 'market-data.json'],
    ['name', `${'a'.repeat(94)}.json.gz`],
    ['sha256', 'A'.repeat(64)],
    ['size', 0],
    ['size', MARKET_FILE_MAX_BYTES + 1],
    ['size', 1.5],
    ['version', 0],
    ['version', 100],
    ['collectedAt', 'not a date'],
    ['collectedAt', `2026-10-31T18:00:00+09:00${' '.repeat(20)}`],
    ['stocks', -1],
    ['stocks', 100001],
  ])('%s=%j 는 invalid', (k, v) => {
    expect(checkMarketMeta({ ...meta(), [k]: v })).toEqual({ ok: false, code: 'invalid', path: k });
  });
  it.each([
    [{ from: '2026-02-30', to: '2026-10-31' }],
    [{ from: '2026-13-01', to: '2026-10-31' }],
    [{ from: '2026-00-10', to: '2026-10-31' }],
    [{ from: '2026-10-32', to: '2026-10-31' }],
    [{ from: '2026-01-01', to: '2026-13-01' }],
    [{ from: '2026-01-01', to: '2026-00-10' }],
    [{ from: '2026-01-01', to: '2026-10-32' }],
    [{ from: '2026-10-31', to: '2026-10-30' }],
    [{ from: '20261031', to: '2026-10-31' }],
    [{ from: '2026-10-31' }],
  ])('range %j 는 invalid', (range) => {
    expect(checkMarketMeta({ ...meta(), range })).toEqual({ ok: false, code: 'invalid', path: 'range' });
  });
  it('객체가 아니면 invalid', () => {
    expect(checkMarketMeta(null)).toEqual({ ok: false, code: 'invalid', path: '' });
  });
});

describe('checkMarketBody', () => {
  it('driveFileId 모양을 본다', () => {
    expect(checkMarketBody(body()).ok).toBe(true);
    expect(checkMarketBody({ ...body(), driveFileId: 'short' })).toEqual({ ok: false, code: 'invalid', path: 'driveFileId' });
    expect(checkMarketBody(meta())).toEqual({ ok: false, code: 'invalid', path: 'driveFileId' });
  });
});

describe('checkMarketFiles', () => {
  it('행 배열만 받는다', () => {
    const row = { ...body(), id: 'r1', createdAt: 1, updatedAt: 2 };
    expect(checkMarketFiles([row])).toEqual([row]);
    expect(checkMarketFiles([{ ...row, sha256: 'x' }])).toBeNull();
    expect(checkMarketFiles({})).toBeNull();
  });
});
