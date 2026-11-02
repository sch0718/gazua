import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { readMarketFile } from './marketFile';
import { cleanupDirs, tempDir, tinyMarket } from './testing';

afterEach(cleanupDirs);
const write = (name: string, data: unknown) => {
  const p = join(tempDir(), name);
  writeFileSync(p, gzipSync(Buffer.from(JSON.stringify(data))));
  return p;
};

describe('readMarketFile', () => {
  it('해시·크기·메타를 만든다', () => {
    const p = write('market-data-20261031.json.gz', tinyMarket());
    const f = readMarketFile(p);
    expect(f.meta).toMatchObject({ name: 'market-data-20261031.json.gz', version: 1, collectedAt: '2026-10-31T18:00:00+09:00', range: { from: '2026-10-30', to: '2026-10-31' }, stocks: 1, size: f.bytes.byteLength });
    expect(f.meta.sha256).toBe(createHash('sha256').update(f.bytes).digest('hex'));
    expect(f.md5).toBe(createHash('md5').update(f.bytes).digest('hex'));
  });
  it.each([
    ['시장.json.gz', tinyMarket()],
    ['market data.json.gz', tinyMarket()],
    ['market-data.json', tinyMarket()],
    [`${'a'.repeat(93)}.json.gz`, tinyMarket()],
    ['market-data.json.gz', tinyMarket({ range: { from: '2026-10-31', to: '2026-10-30' } })],
    ['market-data.json.gz', tinyMarket({ collectedAt: 'yesterday' })],
    ['market-data.json.gz', tinyMarket({ collectedAt: `2026-10-31T18:00:00+09:00${' '.repeat(20)}` })],
    ['market-data.json.gz', { hello: 1 }],
  ])('%s 는 market-file-invalid', (name, data) => {
    expect(() => readMarketFile(write(name, data))).toThrow(expect.objectContaining({ code: 'market-file-invalid' }));
  });
  it('gzip이 아니거나 없는 파일도 market-file-invalid', () => {
    const p = join(tempDir(), 'x.json.gz');
    writeFileSync(p, 'not gzip');
    expect(() => readMarketFile(p)).toThrow(expect.objectContaining({ code: 'market-file-invalid' }));
    expect(() => readMarketFile(join(tempDir(), 'none.json.gz'))).toThrow(expect.objectContaining({ code: 'market-file-invalid' }));
  });
});
