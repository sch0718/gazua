// KIS 공개 종목 마스터(코스피·코스닥)를 받아 public/universe.json을 만든다.
// 실패하면 기존 파일을 유지하고 경고만 남긴다(기존 파일이 없을 때만 exit 1).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { parseMaster } from './parse-master.mjs';

const BASE = 'https://new.real.download.dws.co.kr/common/master';
const SOURCES = [
  { market: 'KOSPI', zip: `${BASE}/kospi_code.mst.zip`, entry: 'kospi_code.mst' },
  { market: 'KOSDAQ', zip: `${BASE}/kosdaq_code.mst.zip`, entry: 'kosdaq_code.mst' },
];
const OUTPUT = fileURLToPath(new URL('../public/universe.json', import.meta.url));
const MIN_ITEMS = 1000; // 이보다 적으면 형식이 바뀐 것으로 보고 실패 처리한다

async function loadMarket({ market, zip, entry }) {
  const res = await fetch(zip);
  if (!res.ok) throw new Error(`${zip} 응답 ${res.status}`);
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
  const bytes = files[entry];
  if (!bytes) throw new Error(`${zip} 안에 ${entry}가 없어요`);
  return parseMaster(bytes, market);
}

async function main() {
  const lists = await Promise.all(SOURCES.map(loadMarket));
  const items = lists.flat().sort((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : 0));
  if (items.length < MIN_ITEMS) throw new Error(`종목이 ${items.length}개뿐이에요 (마스터 형식이 바뀐 듯해요)`);
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(items));
  console.log(`universe.json: ${items.length}개 종목 (${lists.map((l, i) => `${SOURCES[i].market} ${l.length}`).join(', ')})`);
}

try {
  await main();
} catch (err) {
  const reason = err instanceof Error ? err.message : String(err);
  if (existsSync(OUTPUT)) {
    console.warn(`[universe] 경고: 갱신하지 못해 기존 public/universe.json을 그대로 써요 (${reason})`);
  } else {
    console.error(`[universe] public/universe.json이 없고 새로 만들지도 못했어요: ${reason}`);
    process.exit(1);
  }
}
