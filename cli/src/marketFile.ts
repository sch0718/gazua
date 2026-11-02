// 올릴 시장 파일을 읽어 앱과 같은 형식 검사와 서버와 같은 manifest 검사를 업로드 전에 한다(설계 6.4-1).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { validateMarketData } from '../../src/lib/marketData/format';
import { checkMarketMeta, MARKET_FILE_MAX_BYTES, type MarketFileMeta } from '../../src/lib/marketData/manifest';
import { CliError } from './errors';

export interface LocalMarketFile {
  bytes: Uint8Array;
  md5: string;
  meta: MarketFileMeta;
}
const invalid = (why: string) => new CliError('market-file-invalid', `올릴 수 없는 시장 파일이에요(${why})`);

export function readMarketFile(path: string): LocalMarketFile {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    throw invalid('파일을 읽을 수 없어요');
  }
  if (bytes.byteLength > MARKET_FILE_MAX_BYTES) throw invalid('512 MiB를 넘어요');
  let parsed: unknown;
  try {
    parsed = JSON.parse(gunzipSync(bytes).toString('utf8'));
  } catch {
    throw invalid('gzip JSON이 아니에요');
  }
  const v = validateMarketData(parsed);
  if (!v.ok) throw invalid(`형식 ${v.reason}`);
  const meta = {
    name: basename(path),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.byteLength,
    version: v.data.version,
    collectedAt: v.data.collectedAt,
    range: { from: v.data.range.from, to: v.data.range.to },
    stocks: v.data.stocks.length,
  };
  const c = checkMarketMeta(meta);
  if (!c.ok) throw invalid(c.path);
  return { bytes: new Uint8Array(bytes), md5: createHash('md5').update(bytes).digest('hex'), meta: c.value };
}
