// 전 종목 일봉을 KIS에서 모아 시장 데이터 파일(market-data-YYYYMMDD.json.gz)로 만든다.
//   KIS_APP_KEY=... KIS_APP_SECRET=... pnpm collect -- --years 5 --out ~/gazua-data/
//   KIS_APP_KEY=... KIS_APP_SECRET=... pnpm collect -- --update ~/gazua-data/market-data-20261016.json.gz
// 키는 환경변수로만 받고, 파일·로그·오류에는 쓰지 않는다. 형식: docs/superpowers/specs/2026-10-16-selection-criteria-validation-design.md 3.4
import { appendFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { pipeline } from 'node:stream/promises';
import { createGzip, gunzipSync } from 'node:zlib';
import { unzipSync } from 'fflate';
import { KisError, createKisClient, prevDay } from './kis-collect.mjs';
import { parseIdxcode } from './parse-idxcode.mjs';
import { parseMaster } from './parse-master.mjs';

export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const MASTER_BASE = 'https://new.real.download.dws.co.kr/common/master';
const OVERLAP_DAYS = 5; // 이어 받을 때 다시 받아 비교하는 거래일 수
const MAX_CONSECUTIVE_FAILS = 20; // 연속으로 이만큼 실패하면 키·네트워크 문제로 보고 멈춘다
const FLUSH_LOG_EVERY = 100;
// 앱은 풀린 JSON을 문자열 하나로 읽는다. 전 종목 10년을 넘으면 V8 문자열 한도(약 512MB)에 닿을 수 있다
const MAX_YEARS = 10;
const STOCK_KEYS = ['d', 'o', 'h', 'l', 'c', 'v', 'tv'];
const INDEX_KEYS = ['d', 'o', 'c'];
const INDEX_IDS = ['KOSPI', 'KOSDAQ'];
const pick = (rec, keys) => Object.fromEntries(keys.map((k) => [k, rec[k]]));
const SECTOR_PREFIX = { KOSPI: '0', KOSDAQ: '1' };

const KST_MS = 9 * 3_600_000;
const kstCompact = (ms) => new Date(ms + KST_MS).toISOString().slice(0, 10).replaceAll('-', '');
const dashed = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
const compactDate = (d) => d.replaceAll('-', '');

// ── 업종 코드 (ruling R3) ────────────────────────────────────────────
// 종목 마스터의 4자리 tail 앞에 시장 숫자(KOSPI '0', KOSDAQ '1')를 붙이면 idxcode.mst의 5자리 코드가 된다.
// (KOSDAQ tail은 이미 '1'로 시작한다: 에코프로비엠 '1009' → '11009' 제조.) '0000'·없는 코드는 ''.
export function resolveSectors(stocks, idxcode) {
  const names = new Map(idxcode.map((r) => [r.code, r.name]));
  const levels = new Map(); // 코드 → 나타난 가장 낮은 레벨
  const resolved = stocks.map((s) => {
    const sec = (s.sec ?? []).map((tail, i) => {
      if (!tail || tail === '0000') return '';
      const code = SECTOR_PREFIX[s.m] + tail;
      if (!names.has(code)) return '';
      levels.set(code, Math.min(levels.get(code) ?? 3, i + 1));
      return code;
    });
    while (sec.length < 3) sec.push('');
    return sec;
  });
  const sectors = [...levels.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([code, level]) => ({ code, name: names.get(code), level }));
  return { sec: resolved, sectors };
}

// ── 출력 경로 ─────────────────────────────────────────────────────────
// 아직 없는 경로여도 실제로 있는 가장 가까운 상위 폴더를 realpath로 풀어서 비교한다(심볼릭 링크·대소문자 무시 파일시스템 대응).
function realResolve(p) {
  let cur = resolve(p);
  const rest = [];
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) break;
    rest.unshift(basename(cur));
    cur = parent;
  }
  return join(realpathSync.native(cur), ...rest);
}

// 저장소 안이면 .gitignore에 있는 data/만 허용한다.
export function assertOutAllowed(out, repoRoot = REPO_ROOT) {
  const abs = realResolve(out);
  const rel = relative(realResolve(repoRoot), abs);
  const inside = rel === '' || !(rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel));
  if (inside && rel !== 'data' && !rel.startsWith(`data${sep}`)) {
    throw new Error('저장소 안에는 data/ 폴더에만 쓸 수 있어요. 저장소 밖(예: ~/gazua-data/)을 고르세요');
  }
  return resolve(out);
}

// ── 키 형식 ───────────────────────────────────────────────────────────
// 줄바꿈·공백·한글이 들어 있으면 fetch가 헤더 값 전체를 오류 메시지에 담는다. 값은 절대 되풀이하지 않는다.
export function validateCreds(appKey, appSecret) {
  const ok = (v) => typeof v === 'string' && /^[\x21-\x7e]+$/.test(v);
  if (!ok(appKey)) throw new Error('KIS_APP_KEY 형식이 올바르지 않아요 (공백·줄바꿈·한글 없이 붙여 넣어 주세요)');
  if (!ok(appSecret)) throw new Error('KIS_APP_SECRET 형식이 올바르지 않아요 (공백·줄바꿈·한글 없이 붙여 넣어 주세요)');
}

// ── 이어 받기 병합 ────────────────────────────────────────────────────
const sliceCols = (cols, from) => Object.fromEntries(Object.entries(cols).map(([k, v]) => [k, v.slice(from)]));
const COMPARE = ['o', 'h', 'l', 'c'];

/**
 * 겹치는 마지막 5거래일이 기존 값과 같으면 새 날짜만 붙이고, 다르면(수정주가 변경) refetch로 전체를 다시 받는다.
 * @param {Record<string, any[]>} old 기존 열 지향 데이터
 * @param {Record<string, any[]>} fresh 마지막 5거래일 이전부터 받은 새 데이터
 * @param {() => Promise<Record<string, any[]>>} refetch 전체 기간 다시 받기
 * @returns {Promise<{ cols: Record<string, any[]>; refetched: boolean }>}
 */
export async function mergeUpdate(old, fresh, refetch) {
  const last = old.d.length;
  const overlapFrom = Math.max(0, last - OVERLAP_DAYS);
  const keys = COMPARE.filter((k) => k in old);
  const freshAt = new Map(fresh.d.map((d, i) => [d, i]));
  let same = true;
  for (let i = overlapFrom; i < last && same; i++) {
    const j = freshAt.get(old.d[i]);
    if (j === undefined || keys.some((k) => fresh[k][j] !== old[k][i])) same = false;
  }
  if (!same) return { cols: await refetch(), refetched: true };
  const lastDate = old.d[last - 1];
  const from = fresh.d.findIndex((d) => d > lastDate);
  if (from === -1) return { cols: old, refetched: false }; // 새 날짜가 없으면 같은 참조를 돌려준다
  const cols = {};
  for (const k of Object.keys(old)) cols[k] = [...old[k], ...fresh[k].slice(from)];
  return { cols, refetched: false };
}

// ── 진행분(.partial): 한 줄에 한 JSON. 끝난 종목마다 덧붙인다 ───────────────
// 온전한 줄만 돌려준다. 호출한 쪽이 그 줄들로 파일을 다시 써서, 끊긴 마지막 줄 뒤에 덧붙이는 일이 없게 한다.
function readPartial(path, header) {
  const empty = { stocks: new Map(), indices: new Map(), lines: [] };
  if (!existsSync(path)) return empty;
  const done = { stocks: new Map(), indices: new Map(), lines: [] };
  let ok = false;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      break; // 쓰다 끊긴 줄
    }
    if (rec.kind === 'header') {
      ok = rec.from === header.from && rec.to === header.to && rec.updateFrom === header.updateFrom;
      if (!ok) return empty;
    } else if (!ok) {
      return empty;
    } else if (rec.kind === 'stock') done.stocks.set(rec.s, rec);
    else if (rec.kind === 'index') done.indices.set(rec.id, rec);
    else continue;
    done.lines.push(line);
  }
  return done;
}

// 최종 파일을 조각으로 나눠 gzip 스트림에 쓴다(수백 MB 문자열을 한 번에 만들지 않는다).
export async function writeGzipJson(path, file, { sink } = {}) {
  const gz = createGzip();
  const done = pipeline(gz, sink ?? createWriteStream(path)); // 쓰기 오류가 처음부터 처리되도록 먼저 연결한다
  done.catch(() => {}); // 기다리기 전에 실패해도 처리되지 않은 거부가 되지 않게 한다
  // drain을 기다리는 중에 대상이 실패하면 drain은 오지 않으므로 done의 거부로 빠져나온다
  const put = (chunk) => (gz.write(chunk) ? undefined : Promise.race([once(gz, 'drain'), done]));
  try {
    const { stocks, indices, ...head } = file;
    await put(`${JSON.stringify(head).slice(0, -1)},"stocks":[`);
    for (let i = 0; i < stocks.length; i++) await put((i ? ',' : '') + JSON.stringify(stocks[i]));
    await put(`],"indices":${JSON.stringify(indices)}}`);
    gz.end();
    await done;
  } catch (e) {
    gz.destroy();
    await done.catch(() => {});
    rmSync(path, { force: true, recursive: true });
    throw e;
  }
}

/**
 * @param {{ years?: number; out: string; update?: string | object; client: ReturnType<typeof createKisClient>; secrets?: string[];
 *   master: { stocks: any[]; idxcode: { code: string; name: string }[] };
 *   now?: () => number; log?: (line: string) => void; repoRoot?: string }} o
 */
export async function collect({ years = 5, out, update, client, master, now = Date.now, log: rawLog = () => {}, repoRoot = REPO_ROOT, secrets = [] }) {
  // 로그에 나가는 모든 문구에서 키·토큰을 가린다.
  const clean = (msg) => {
    let t = client.scrub ? client.scrub(msg) : String(msg);
    for (const sec of secrets) if (sec) t = t.split(sec).join('***');
    return t.replace(/Bearer\s+\S+/gi, 'Bearer ***');
  };
  const log = (line) => rawLog(clean(line));
  const errText = (e) => (e instanceof KisError ? e.message : `${e instanceof Error ? e.name : 'Error'}: ${e instanceof Error ? e.message : ''}`);
  const startedAt = now();
  const outDir = assertOutAllowed(out, repoRoot);
  const today = kstCompact(now());

  // 이어 받기: 기존 파일을 읽어 둔다.
  let prev = null;
  if (update) {
    prev = typeof update === 'string' ? JSON.parse(gunzipSync(readFileSync(update)).toString('utf8')) : update;
    if (prev?.format !== 'gazua-market-data') throw new Error('--update 파일이 시장 데이터 파일이 아니에요');
  }
  let from;
  if (prev) {
    from = compactDate(prev.range.from);
  } else {
    const t = new Date(Date.UTC(+today.slice(0, 4) - years, +today.slice(4, 6) - 1, +today.slice(6, 8)));
    from = t.toISOString().slice(0, 10).replaceAll('-', '');
  }
  // 장 마감(KST 18시) 전의 평일에는 아직 끝나지 않은 오늘 봉을 받지 않는다.
  const kst = new Date(now() + KST_MS);
  const weekday = kst.getUTCDay() >= 1 && kst.getUTCDay() <= 5;
  const to = weekday && kst.getUTCHours() < 18 ? prevDay(today) : today;
  const oldStock = new Map((prev?.stocks ?? []).map((s) => [s.s, s]));
  const oldIndex = new Map((prev?.indices ?? []).map((i) => [i.id, i]));

  mkdirSync(outDir, { recursive: true });
  const filePath = join(outDir, `market-data-${today}.json.gz`);
  const partialPath = `${filePath}.partial`;
  const updateFrom = prev ? (typeof update === 'string' ? resolve(update) : '(object)') : null;
  const header = { kind: 'header', from, to, updateFrom };
  const done = readPartial(partialPath, header);
  if (done.stocks.size + done.indices.size === 0) writeFileSync(partialPath, `${JSON.stringify(header)}\n`);
  else {
    writeFileSync(partialPath, `${[JSON.stringify(header), ...done.lines.filter((l) => !l.includes('"kind":"header"'))].join('\n')}\n`);
    log(`진행분을 이어서 받아요 (종목 ${done.stocks.size}개 완료)`);
  }

  const masterStocks = [...master.stocks].sort((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : 0));
  let refetched = 0;
  const failed = [];

  // 지수
  const indices = [];
  for (const id of INDEX_IDS) {
    let rec = done.indices.get(id);
    if (!rec) {
      const oldRec = oldIndex.get(id);
      const old = oldRec && oldRec.d.length ? pick(oldRec, INDEX_KEYS) : null;
      let cols;
      if (old) {
        const overlapFrom = old.d[Math.max(0, old.d.length - OVERLAP_DAYS)];
        const fresh = await client.indexDaily(id, overlapFrom, to);
        cols = (await mergeUpdate(old, fresh, () => client.indexDaily(id, dashed(from), to))).cols;
      } else {
        cols = await client.indexDaily(id, dashed(from), to);
      }
      rec = { kind: 'index', id, ...cols };
      appendFileSync(partialPath, `${JSON.stringify(rec)}\n`);
    }
    indices.push({ id, d: rec.d, o: rec.o, c: rec.c });
  }

  // 종목
  const stockData = new Map();
  let consecutiveFails = 0;
  let n = 0;
  for (const m of masterStocks) {
    n++;
    if (n % FLUSH_LOG_EVERY === 0) log(`진행 ${n}/${masterStocks.length}`);
    const doneRec = done.stocks.get(m.s);
    if (doneRec) {
      stockData.set(m.s, doneRec);
      if (doneRec.refetched) refetched++;
      continue;
    }
    const oldRec = oldStock.get(m.s);
    const old = oldRec && oldRec.d.length ? pick(oldRec, STOCK_KEYS) : null;
    try {
      let cols;
      let didRefetch = false;
      if (old) {
        const overlapFrom = old.d[Math.max(0, old.d.length - OVERLAP_DAYS)];
        const fresh = await client.dailyCandles(m.s, overlapFrom, to);
        const merged = await mergeUpdate(old, fresh, () => client.dailyCandles(m.s, dashed(from), to));
        cols = merged.cols;
        didRefetch = merged.refetched;
        // 다시 받은 결과가 비면 기존 기록을 지우지 않는다.
        if (didRefetch && cols.d.length === 0) throw new Error('다시 받은 데이터가 비어 있어요');
      } else {
        cols = await client.dailyCandles(m.s, dashed(from), to);
      }
      consecutiveFails = 0;
      if (didRefetch) refetched++;
      const rec = { kind: 'stock', s: m.s, refetched: didRefetch, ...Object.fromEntries(STOCK_KEYS.map((k) => [k, cols[k]])) };
      appendFileSync(partialPath, `${JSON.stringify(rec)}\n`);
      stockData.set(m.s, rec);
    } catch (e) {
      if (e?.fatal || ++consecutiveFails >= MAX_CONSECUTIVE_FAILS) {
        log(`중단했어요: ${errText(e)} (진행분은 ${partialPath} 에 남겼어요)`);
        throw e;
      }
      failed.push(m.s);
      log(`실패 ${m.s}: ${errText(e)}`);
    }
  }

  // 실패한 종목은 이어 받기에서 기존 값을 그대로 둔다.
  const keptOld = failed.filter((s) => oldStock.has(s));
  const { sec, sectors } = resolveSectors(masterStocks, master.idxcode);
  const stocks = [];
  masterStocks.forEach((m, i) => {
    const rec = stockData.get(m.s) ?? (keptOld.includes(m.s) ? oldStock.get(m.s) : null);
    if (!rec || !rec.d?.length) return; // 데이터가 없는 종목(신규 상장 직후 등)은 뺀다
    stocks.push({
      s: m.s,
      n: m.n,
      m: m.m,
      t: m.t,
      sec: sec[i],
      shares: m.shares,
      managed: m.managed,
      halted: m.halted,
      ...Object.fromEntries(STOCK_KEYS.map((k) => [k, rec[k]])),
    });
  });

  const axis = indices.find((i) => i.id === 'KOSPI')?.d ?? [];
  const allDates = axis.length ? axis : stocks.flatMap((s) => [s.d[0], s.d.at(-1)]).sort();
  const range = { from: dashed(allDates[0] ?? from), to: dashed(allDates.at(-1) ?? to) };
  const file = {
    format: 'gazua-market-data',
    version: 1,
    collectedAt: new Date(now() + KST_MS).toISOString().replace('Z', '+09:00'),
    source: 'kis',
    adjusted: true,
    range,
    sectors,
    stocks,
    indices,
  };

  // 임시 파일에 쓴 뒤 이름을 바꿔 원자적으로 교체한다.
  const tmp = `${filePath}.tmp`;
  await writeGzipJson(tmp, file);
  renameSync(tmp, filePath);
  rmSync(partialPath, { force: true });

  const summary = {
    path: filePath,
    stocks: stocks.length,
    range,
    refetched,
    failed,
    elapsedMs: now() - startedAt,
    bytes: statSync(filePath).size,
  };
  log(
    `완료: ${summary.stocks}종목 · ${range.from} ~ ${range.to} · 다시 받은 종목 ${refetched}개 · 실패 ${failed.length}개${
      failed.length ? ` (${failed.join(', ')})` : ''
    } · ${Math.round(summary.elapsedMs / 1000)}초 · ${(summary.bytes / 1048576).toFixed(1)}MB`,
  );
  return { file, summary };
}

// ── 마스터 내려받기 (build-universe.mjs와 같은 방식) ────────────────────
export async function loadMaster({ fetchImpl = fetch } = {}) {
  const get = async (zip, entry) => {
    const res = await fetchImpl(`${MASTER_BASE}/${zip}`, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`${zip} 응답 ${res.status}`);
    const bytes = unzipSync(new Uint8Array(await res.arrayBuffer()))[entry];
    if (!bytes) throw new Error(`${zip} 안에 ${entry}가 없어요`);
    return bytes;
  };
  const [kospi, kosdaq, idx] = await Promise.all([
    get('kospi_code.mst.zip', 'kospi_code.mst'),
    get('kosdaq_code.mst.zip', 'kosdaq_code.mst'),
    get('idxcode.mst.zip', 'idxcode.mst'),
  ]);
  return {
    stocks: [...parseMaster(kospi, 'KOSPI', { detail: true }), ...parseMaster(kosdaq, 'KOSDAQ', { detail: true })],
    idxcode: parseIdxcode(idx),
  };
}

export function parseArgs(argv) {
  const o = { years: 5, out: null, update: null, paper: false };
  const args = argv.filter((a) => a !== '--');
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--paper') o.paper = true;
    else if (a === '--years' || a === '--out' || a === '--update') {
      const v = args[++i];
      if (v === undefined) throw new Error(`${a} 값이 필요해요`);
      if (a === '--years') {
        o.years = Number(v);
        if (!Number.isInteger(o.years) || o.years < 1 || o.years > MAX_YEARS) throw new Error(`--years는 1~${MAX_YEARS} 사이 정수예요`);
      } else o[a.slice(2)] = v;
    } else throw new Error(`알 수 없는 옵션: ${a}`);
  }
  const home = (p) => (p === '~' || p.startsWith('~/') ? join(homedir(), p.slice(1)) : p);
  if (o.update) o.update = resolve(home(o.update));
  o.out = resolve(home(o.out ?? (o.update ? dirname(o.update) : '~/gazua-data/')));
  return o;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const appKey = process.env.KIS_APP_KEY;
  const appSecret = process.env.KIS_APP_SECRET;
  if (!appKey || !appSecret) throw new Error('환경변수 KIS_APP_KEY, KIS_APP_SECRET이 필요해요');
  validateCreds(appKey, appSecret);
  assertOutAllowed(opts.out);
  const log = (line) => console.log(line);
  log('종목 마스터를 받아요');
  const master = await loadMaster();
  const client = createKisClient({ appKey, appSecret, paper: opts.paper });
  await collect({ years: opts.years, out: opts.out, update: opts.update ?? undefined, client, master, log });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    // 환경변수의 키·시크릿이 문구에 섞여 있어도 가린다.
    let msg = e instanceof Error ? e.message : '실패했어요';
    for (const v of [process.env.KIS_APP_KEY, process.env.KIS_APP_SECRET]) if (v) msg = msg.split(v).join('***');
    console.error(`[collect] ${msg}`);
    process.exit(1);
  });
}
