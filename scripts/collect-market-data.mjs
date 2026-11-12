// 전 종목 일봉을 KIS·토스에서 모아 시장 데이터 파일(market-data-YYYYMMDD.json.gz)로 만들어요.
//   KIS_APP_KEY=... KIS_APP_SECRET=... pnpm collect -- --years 5 --out ~/gazua-data/
//   KIS_APP_KEY=... KIS_APP_SECRET=... pnpm collect -- --update ~/gazua-data/market-data-20261016.json.gz
//   GAZUA_DRIVE_CLIENT_ID=... GAZUA_DRIVE_CLIENT_SECRET=... pnpm collect -- --update <파일> --drive
//   node --env-file=.env.toss scripts/collect-market-data.mjs --provider toss --years 5   (일봉만, 설계 2026-11-06-toss-collect)
//   node --env-file=.env.toss scripts/collect-market-data.mjs --provider toss --extend-back ~/gazua-data/market-data-20261111.json.gz --max-years 5
// 키는 환경변수로만 받고, 파일·로그·오류에는 쓰지 않아요. 형식: docs/superpowers/specs/2026-10-16-selection-criteria-validation-design.md 3.4
// v4(종목별 재무 fin): docs/superpowers/specs/2026-10-17-fundamental-criteria-design.md 2.2·5장
import { spawnSync } from 'node:child_process';
import { appendFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { pipeline } from 'node:stream/promises';
import { createGzip, gunzipSync } from 'node:zlib';
import { unzipSync } from 'fflate';
import { fetchFredSeries } from './fetch-fred.mjs';
import { FIN_API, buildFinWithStart, fetchFundamentals } from './fetch-fundamentals.mjs';
import { alignFlow, fetchInvestorFlow } from './fetch-investor-flow.mjs';
import { KisError, createKisClient, prevDay } from './kis-collect.mjs';
import { parseIdxcode } from './parse-idxcode.mjs';
import { parseMaster } from './parse-master.mjs';
import { parseThemesDetailed } from './parse-theme.mjs';
import { RATE_PER_SEC as TOSS_RATE, createTossClient } from './toss-collect.mjs';

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
// FRED 계열 ID(키 없이 받는다)
const FRED_IDS = { usdkrw: 'DEXKOUS', wti: 'DCOILWTICO' };
const pick = (rec, keys) => Object.fromEntries(keys.map((k) => [k, rec[k]]));
const SECTOR_PREFIX = { KOSPI: '0', KOSDAQ: '1' };
// 자식 프로세스(gazua CLI)에 넘기지 않고, 오류 문구에서 가리는 키 환경변수
const KEY_ENV = ['KIS_APP_KEY', 'KIS_APP_SECRET', 'TOSS_CLIENT_ID', 'TOSS_CLIENT_SECRET'];

const KST_MS = 9 * 3_600_000;
const kstCompact = (ms) => new Date(ms + KST_MS).toISOString().slice(0, 10).replaceAll('-', '');
const dashed = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
const compactDate = (d) => d.replaceAll('-', '');
const FLOW_OVERLAP_DAYS = 5; // --update에서 수급을 다시 받는 마지막 날 수
const yearsBefore = (d, n) => new Date(Date.UTC(+d.slice(0, 4) - n, +d.slice(4, 6) - 1, +d.slice(6, 8))).toISOString().slice(0, 10).replaceAll('-', '');

// 파일의 flow(from·길이·세 열)를 날짜가 붙은 행으로 되돌린다. barDates는 그 종목의 일봉 날짜.
function flowToRows(flow, barDates) {
  const at = flow ? barDates.indexOf(flow.from) : -1;
  if (at < 0) return [];
  return flow.f.map((f, k) => ({ d: barDates[at + k], f, i: flow.i[k], p: flow.p[k] })).filter((r) => r.d !== undefined);
}

const FIN_KEYS = ['q', 'a', 'rev', 'op', 'ni', 'eq', 'debt'];
const finMonth = (ym) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(4, 6)) - 1;
// 분기말 YYYYMM → 'YYYY년 N분기'(달력 분기)
const quarterLabel = (ym) => `${ym.slice(0, 4)}년 ${Math.ceil(Number(ym.slice(4, 6)) / 3)}분기`;

/**
 * --update의 재무 합치기(스펙 5장). 새로 받은 fin을 쓰고, 이전 fin의 앞 분기를 붙일 수 있으면 붙인다.
 * - 붙이는 분기는 새 이력의 시작 경계(start: 새 응답에서 가장 이른 연간 행) 이하만이다. 경계 뒤의 이전 분기는
 *   이전 수집에서 열린 회계연도 꼬리라 a를 가정한 값일 수 있어 쓰지 않는다(D8).
 * - 이전 fin의 마지막으로 붙일 분기가 정확히 경계이고 새 첫 분기의 3개월 전이며, 그 분기가 이전 파일에서
 *   a = 1(결산 분기)일 때만 붙인다. 붙인 분기는 이전 파일의 값과 a를 그대로 쓴다.
 * - 이전 fin의 열이 빠졌거나 길이가 다르면 붙이지 않는다. 새로 받은 것이 비면(null) 이전 fin을 지킨다.
 * @param {any} prev 이전 파일의 fin(없으면 undefined)
 * @param {any} fresh buildFin 결과(없으면 null)
 * @param {string | undefined} start 새 이력의 시작 경계(YYYYMM)
 */
export function mergeFin(prev, fresh, start) {
  if (!fresh) return prev ?? null;
  const len = Array.isArray(prev?.q) ? prev.q.length : 0;
  if (len === 0 || !start || !FIN_KEYS.every((k) => Array.isArray(prev[k]) && prev[k].length === len)) return fresh;
  const bound = finMonth(start);
  if (finMonth(fresh.q[0]) !== bound + 3) return fresh;
  const at = prev.q.indexOf(start);
  if (at < 0 || prev.a[at] !== 1) return fresh;
  const n = at + 1;
  return Object.fromEntries(FIN_KEYS.map((k) => [k, [...prev[k].slice(0, n), ...fresh[k]]]));
}

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
export function validateCreds(appKey, appSecret, names = ['KIS_APP_KEY', 'KIS_APP_SECRET']) {
  const ok = (v) => typeof v === 'string' && /^[\x21-\x7e]+$/.test(v);
  if (!ok(appKey)) throw new Error(`${names[0]} 형식이 올바르지 않아요 (공백·줄바꿈·한글 없이 붙여 넣어 주세요)`);
  if (!ok(appSecret)) throw new Error(`${names[1]} 형식이 올바르지 않아요 (공백·줄바꿈·한글 없이 붙여 넣어 주세요)`);
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

// ── 과거로 늘리기 ─────────────────────────────────────────────────────
// 날짜는 요청에 쓰는 YYYYMMDD로 돌려줘요. 14일 여유로 주말·연휴를 흡수해요.
export function planExtendBack(prev, { years = 1, maxYears = 5, today }) {
  if (prev?.format !== 'gazua-market-data') throw new Error('--extend-back 파일이 시장 데이터 파일이 아니에요');
  const oldFrom = compactDate(prev.range.from);
  const target = yearsBefore(today, maxYears);
  const grace = kstCompact(Date.UTC(+target.slice(0, 4), +target.slice(4, 6) - 1, +target.slice(6, 8) + 14));
  return {
    reached: oldFrom <= grace,
    from: [yearsBefore(oldFrom, years), target].sort().at(-1),
    to: compactDate(prev.range.to),
  };
}

// 앞 5거래일과 공통인 날의 가격을 비교해요. 공통 날짜가 없어도 붙이지 않아요.
export function mergeBack(old, fresh) {
  const keys = COMPARE.filter((k) => k in old);
  const freshAt = new Map(fresh.d.map((d, i) => [d, i]));
  let overlap = 0;
  for (let i = 0; i < Math.min(OVERLAP_DAYS, old.d.length); i++) {
    const j = freshAt.get(old.d[i]);
    if (j === undefined) continue;
    overlap++;
    if (keys.some((k) => fresh[k][j] !== old[k][i])) return { cols: old, mismatch: true };
  }
  if (!overlap) return { cols: old, mismatch: true };
  const before = fresh.d.filter((d) => d < old.d[0]).length;
  if (!before) return { cols: old, mismatch: false };
  return { cols: Object.fromEntries(Object.keys(old).map((k) => [k, [...fresh[k].slice(0, before), ...old[k]]])), mismatch: false };
}

// 같은 파일·공급자의 진행분이면 실행 날짜가 바뀌어도 요청 기간을 지켜요.
function extendPlan(prev, { years, maxYears, today, out, extendBack, source }) {
  const planned = planExtendBack(prev, { years, maxYears, today });
  const partial = join(out, 'market-data-extend-back.partial');
  if (typeof extendBack !== 'string' || !existsSync(partial)) return planned;
  try {
    const h = JSON.parse(readFileSync(partial, 'utf8').split('\n')[0]);
    if (h.kind === 'header' && h.extendFrom === resolve(extendBack) && h.source === source && /^\d{8}$/.test(h.from) && /^\d{8}$/.test(h.to)) {
      return { reached: false, from: h.from, to: h.to };
    }
  } catch {
    // 쓰다 끊긴 헤더는 이어 받지 않아요.
  }
  return planned;
}

// ── 진행분(.partial): 한 줄에 한 JSON. 끝난 종목마다 덧붙인다 ───────────────
// 온전한 줄만 돌려준다. 호출한 쪽이 그 줄들로 파일을 다시 써서, 끊긴 마지막 줄 뒤에 덧붙이는 일이 없게 한다.
function readPartial(path, header) {
  const empty = { stocks: new Map(), indices: new Map(), flows: new Map(), fins: new Map(), lines: [] };
  if (!existsSync(path)) return empty;
  const done = { stocks: new Map(), indices: new Map(), flows: new Map(), fins: new Map(), lines: [] };
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
      ok =
        rec.from === header.from &&
        rec.to === header.to &&
        rec.updateFrom === header.updateFrom &&
        (rec.extendFrom ?? null) === (header.extendFrom ?? null) &&
        (rec.source ?? 'kis') === header.source &&
        (rec.flowFrom ?? null) === (header.flowFrom ?? null) &&
        // 재무 줄이 없는 예전 진행분(이 필드가 없음)은 그대로 이어 받는다
        (rec.finCumulative === undefined || rec.finCumulative === header.finCumulative) &&
        (rec.finApi === undefined || rec.finApi === header.finApi);
      if (!ok) return empty;
    } else if (!ok) {
      return empty;
    } else if (rec.kind === 'stock') done.stocks.set(rec.s, rec);
    else if (rec.kind === 'index') done.indices.set(rec.id, rec);
    else if (rec.kind === 'flow') done.flows.set(rec.s, rec);
    else if (rec.kind === 'fin') done.fins.set(rec.s, rec);
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

/** FIN_API 전체의 서명: 키 순서와 상관없이 같은 내용이면 같은 문자열. 함수는 소스 문자열로 */
function finApiSignature() {
  const norm = (v) =>
    typeof v === 'function' ? String(v) : Array.isArray(v) ? v.map(norm) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])])) : v;
  return JSON.stringify(norm(FIN_API));
}

/**
 * @param {{ years?: number; flows?: boolean; fins?: boolean; flowsYears?: number | null; out: string; update?: string | object; extendBack?: string | object; maxYears?: number; client: ReturnType<typeof createKisClient>; secrets?: string[];
 *   master: { stocks: any[]; idxcode: { code: string; name: string }[]; themes?: { code: string; name: string; symbols: string[] }[]; themeDropped?: number; themeFailed?: boolean };
 *   fredFetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; source?: 'kis' | 'toss';
 *   now?: () => number; log?: (line: string) => void; repoRoot?: string }} o
 */
export async function collect({ years, out, update, extendBack, maxYears = 5, client, master, flows = true, fins = true, flowsYears = null, now = Date.now, log: rawLog = () => {}, repoRoot = REPO_ROOT, secrets = [], fredFetch, sleep, owner, source = 'kis' }) {
  years ??= extendBack ? 1 : 5;
  if (extendBack && update) throw new Error('--extend-back과 --update는 함께 쓸 수 없어요');
  if (extendBack && source !== 'toss') throw new Error('--extend-back은 --provider toss와 함께 써요');
  // 토스는 일봉만 준다(매매동향은 수량뿐, 재무는 없음). 받지 않고, --update의 이전 KIS 값도 남기지 않는다
  // (끝 날짜가 멈춘 수급·재무가 조건에 쓰이지 않게. 앱은 없으면 「다시 수집하면 쓸 수 있어요」로 막는다)
  const kisExtras = source === 'kis';
  if (!kisExtras) {
    flows = false;
    fins = false;
  }
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
  const previous = extendBack ?? update;
  if (previous) {
    prev = typeof previous === 'string' ? JSON.parse(gunzipSync(readFileSync(previous)).toString('utf8')) : previous;
    if (prev?.format !== 'gazua-market-data') throw new Error(`${extendBack ? '--extend-back' : '--update'} 파일이 시장 데이터 파일이 아니에요`);
  }
  const back = extendBack ? extendPlan(prev, { years, maxYears, today, out: outDir, extendBack, source }) : null;
  if (back?.reached) {
    log(`이미 ${maxYears}년치예요`);
    return null;
  }
  let from;
  if (back) {
    from = back.from;
  } else if (prev) {
    from = compactDate(prev.range.from);
  } else {
    const t = new Date(Date.UTC(+today.slice(0, 4) - years, +today.slice(4, 6) - 1, +today.slice(6, 8)));
    from = t.toISOString().slice(0, 10).replaceAll('-', '');
  }
  // 장 마감(KST 18시) 전의 평일에는 아직 끝나지 않은 오늘 봉을 받지 않는다.
  const kst = new Date(now() + KST_MS);
  const weekday = kst.getUTCDay() >= 1 && kst.getUTCDay() <= 5;
  const to = back ? back.to : weekday && kst.getUTCHours() < 18 ? prevDay(today) : today;
  const oldStock = new Map((prev?.stocks ?? []).map((s) => [s.s, s]));
  const oldIndex = new Map((prev?.indices ?? []).map((i) => [i.id, i]));

  mkdirSync(outDir, { recursive: true });
  const filePath = join(outDir, `market-data-${today}.json.gz`);
  const partialPath = back ? join(outDir, 'market-data-extend-back.partial') : `${filePath}.partial`;
  const updateFrom = update ? (typeof update === 'string' ? resolve(update) : '(object)') : null;
  // 수급 기간 하한: --flows-years N이면 오늘부터 N년 전, 아니면 일봉 시작
  const flowFloor = flowsYears ? (yearsBefore(today, flowsYears) > from ? yearsBefore(today, flowsYears) : from) : from;
  // FIN_API의 어느 값이든(경로·필드·단위·누적 여부) 바뀌면 헤더가 달라져 readPartial이 빈 결과를 돌려주므로
  // 옛 규칙으로 받은 재무 줄을 이어 받지 않는다(고친 금액과 옛 금액이 섞이는 것을 막는다)
  const header = { kind: 'header', from, to, updateFrom, ...(back ? { extendFrom: typeof extendBack === 'string' ? resolve(extendBack) : '(object)' } : {}), source, flowFrom: flowsYears ? flowFloor : null, finCumulative: FIN_API.cumulative, finApi: finApiSignature() };
  const done = readPartial(partialPath, header);
  if (done.stocks.size + done.indices.size === 0) writeFileSync(partialPath, `${JSON.stringify(header)}\n`);
  else {
    writeFileSync(partialPath, `${[JSON.stringify(header), ...done.lines.filter((l) => !l.includes('"kind":"header"'))].join('\n')}\n`);
    log(`진행분을 이어서 받아요 (종목 ${done.stocks.size}개 완료)`);
  }

  const masterStocks = master.stocks.filter((s) => !back || oldStock.has(s.s)).sort((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : 0));
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
      if (back && old) {
        const fresh = await client.indexDaily(id, dashed(from), old.d[Math.min(OVERLAP_DAYS - 1, old.d.length - 1)]);
        const merged = mergeBack(old, fresh);
        cols = merged.cols;
        if (merged.mismatch) log(`수정주가가 달라 늘리지 않았어요: ${id}`);
      } else if (old) {
        const overlapFrom = old.d[Math.max(0, old.d.length - OVERLAP_DAYS)];
        const fresh = await client.indexDaily(id, overlapFrom, to);
        cols = (await mergeUpdate(old, fresh, () => client.indexDaily(id, dashed(from), to))).cols;
      } else {
        cols = await client.indexDaily(id, dashed(from), to);
      }
      rec = { kind: 'index', id, ...cols };
      appendFileSync(partialPath, `${JSON.stringify(rec)}\n`);
    }
    if (back && id === 'KOSPI' && rec.d.length <= (oldIndex.get(id)?.d.length ?? 0)) {
      log('더 오래된 지수가 없어요');
      rmSync(partialPath, { force: true });
      return null;
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
      if (back && old) {
        const fresh = await client.dailyCandles(m.s, dashed(from), old.d[Math.min(OVERLAP_DAYS - 1, old.d.length - 1)]);
        const merged = mergeBack(old, fresh);
        cols = merged.cols;
        if (merged.mismatch) log(`수정주가가 달라 늘리지 않았어요: ${m.s}`);
      } else if (old) {
        const overlapFrom = old.d[Math.max(0, old.d.length - OVERLAP_DAYS)];
        const fresh = await client.dailyCandles(m.s, overlapFrom, to);
        const merged = await mergeUpdate(old, fresh, () => client.dailyCandles(m.s, dashed(from), to));
        cols = merged.cols;
        didRefetch = merged.refetched;
        // 다시 받은 결과가 비거나 기존보다 늦게 시작하면(이력이 줄어듦) 기존 기록을 지우지 않는다.
        // 기존 첫 날짜가 요청 시작보다 앞이면 요청 범위 안의 첫 날짜와 비교한다.
        if (didRefetch && cols.d.length === 0) throw new Error('다시 받은 데이터가 비어 있어요');
        const oldFirst = old.d.find((d) => d >= from);
        if (didRefetch && oldFirst !== undefined && cols.d[0] > oldFirst) throw new Error('다시 받은 이력이 기존보다 짧아요');
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

  // 수급: 일봉 다음에 종목마다 받는다. 한 종목이 실패하면 그 종목만 비우고(--update면 이전 값을 지키고) 계속한다.
  // 수급 실패는 수집을 멈추지 않는다(치명 오류인 401·403 등만 멈춘다). 연속 20번 실패하면 남은 종목은 받지 않고 실패로 센다.
  const flowFailed = [];
  let flowTried = 0; // 이번 수집에서 받으려던 종목 수(.partial에서 이어 받은 종목과 멈춘 뒤 남은 종목은 넣고, 이전 값만 지킨 종목은 뺀다)
  let flowFails = 0;
  let flowStopped = false;
  for (let idx = 0; idx < stocks.length; idx++) {
    const st = stocks[idx];
    const oldRec = kisExtras ? oldStock.get(st.s) : undefined;
    const prevRows = flowToRows(oldRec?.flow, oldRec?.d ?? []);
    const keep = () => alignFlow(st.d, prevRows) ?? undefined; // 이전 flow를 새 일봉에 다시 맞춘다(일봉이 그대로면 같은 값)
    let flow;
    if (!flows || keptOld.includes(st.s)) {
      // 받지 않는다: 이전 값만 지킨다. keptOld(--update에서 일봉 받기가 실패해 옛 일봉을 그대로 둔 종목)는
      // 일봉이 이전 파일과 같아 받을 새 수급이 없고, 일봉 실패로 이미 알렸으니 수급 실패로 세지 않는다.
      flow = keep();
    } else if (done.flows.has(st.s)) {
      flowTried++;
      flow = done.flows.get(st.s).flow ?? undefined;
    } else if (flowStopped) {
      flowTried++;
      flowFailed.push(st.s);
      flow = keep();
    } else {
      // 이전 flow가 있으면 수급 끝에서 5번째 날부터(일봉처럼 5일 겹쳐 받아 잠정값을 바로잡는다. 일봉의 끝이 아니다),
      // 없으면 기간 처음부터 받는다. 겹친 날은 새로 받은 행이 이전 행을 덮어쓴다(alignFlow의 Map이 뒤의 행을 남긴다)
      const overlapFrom = prevRows.length ? prevRows[Math.max(0, prevRows.length - FLOW_OVERLAP_DAYS)].d : undefined;
      const start = overlapFrom ?? (flowFloor > st.d[0] ? flowFloor : st.d[0]);
      if (start <= to) flowTried++; // 받을 날이 없으면 요청하지 않으니 시도로 세지 않는다
      try {
        const fresh = start <= to ? await fetchInvestorFlow(client, st.s, { from: start, to }) : [];
        flow = alignFlow(st.d, [...prevRows, ...fresh]) ?? undefined;
        flowFails = 0;
        appendFileSync(partialPath, `${JSON.stringify({ kind: 'flow', s: st.s, flow: flow ?? null })}\n`);
      } catch (e) {
        if (e?.fatal) {
          log(`중단했어요: ${errText(e)} (진행분은 ${partialPath} 에 남겼어요)`);
          throw e;
        }
        flowFailed.push(st.s);
        log(`수급 실패 ${st.s}: ${errText(e)}`);
        flow = keep();
        if (++flowFails >= MAX_CONSECUTIVE_FAILS) {
          flowStopped = true;
          const left = stocks.slice(idx + 1).filter((x) => !keptOld.includes(x.s) && !done.flows.has(x.s)).length;
          log(`연속 실패로 매매동향 받기를 멈췄어요 (${left}종목 남음)`);
        }
      }
    }
    if (flow) st.flow = flow;
  }
  const flowStocks = stocks.filter((x) => x.flow).length;
  const flowFirst = stocks.reduce((m, x) => (x.flow && (m === '' || x.flow.from < m) ? x.flow.from : m), '');
  // 분모는 이번 수집에서 받으려던 종목 수다. 이전 값만 지킨 종목(--no-flows·일봉 실패)을 넣으면 실패가 묽어져 경고가 덜 나온다
  if (flowFailed.length * 2 > flowTried) log(`경고: 수급 받기 실패가 절반을 넘었어요 (${flowFailed.length}/${flowTried}종목). 수급 TR·권한을 확인해 주세요`);

  // 재무: 수급 다음에 STOCK 종목마다 받는다(ETF·ETN 등은 재무제표가 없어 요청하지 않고 실패로도 세지 않는다).
  // 실패 처리는 수급과 같다. 한 종목이 실패하면 그 종목만 비우고(--update면 이전 값을 지키고) 계속한다.
  // 치명 오류(401·403 등)만 멈추고, 연속 20번 실패하면 남은 종목은 받지 않고 실패로 센다.
  const finFailed = [];
  let finTried = 0; // 수급과 같다: 이번에 받으려던 STOCK 종목 수
  let finFails = 0;
  let finStopped = false;
  const finTargets = stocks.filter((x) => x.t === 'STOCK');
  for (let idx = 0; idx < finTargets.length; idx++) {
    const st = finTargets[idx];
    const prevFin = kisExtras ? oldStock.get(st.s)?.fin : undefined;
    let fin;
    if (!fins || keptOld.includes(st.s)) {
      // 받지 않는다: 이전 값만 지킨다. keptOld(일봉 받기가 실패해 옛 기록을 그대로 둔 종목)는 일봉 실패로 이미 알렸으니 재무 실패로 세지 않는다
      fin = prevFin;
    } else if (done.fins.has(st.s)) {
      finTried++;
      fin = done.fins.get(st.s).fin ?? undefined;
    } else if (finStopped) {
      finTried++;
      finFailed.push(st.s);
      fin = prevFin;
    } else {
      finTried++;
      try {
        const built = buildFinWithStart(await fetchFundamentals(client, st.s));
        fin = mergeFin(prevFin, built.fin, built.start) ?? undefined;
        finFails = 0;
        appendFileSync(partialPath, `${JSON.stringify({ kind: 'fin', s: st.s, fin: fin ?? null })}\n`);
      } catch (e) {
        if (e?.fatal) {
          log(`중단했어요: ${errText(e)} (진행분은 ${partialPath} 에 남겼어요)`);
          throw e;
        }
        finFailed.push(st.s);
        log(`재무 실패 ${st.s}: ${errText(e)}`);
        fin = prevFin;
        if (++finFails >= MAX_CONSECUTIVE_FAILS) {
          finStopped = true;
          const left = finTargets.slice(idx + 1).filter((x) => !keptOld.includes(x.s) && !done.fins.has(x.s)).length;
          log(`연속 실패로 재무 받기를 멈췄어요 (${left}종목 남음)`);
        }
      }
    }
    if (fin) st.fin = fin;
  }
  const finStocks = stocks.filter((x) => x.fin).length;
  const finFirst = stocks.reduce((m, x) => (x.fin && (m === '' || x.fin.q[0] < m) ? x.fin.q[0] : m), '');
  // 분모는 이번 수집에서 받으려던 STOCK 종목 수다(이전 값만 지킨 종목과 재무를 요청하지 않는 ETF·ETN 등은 뺀다)
  if (finFailed.length * 2 > finTried) log(`경고: 재무 받기 실패가 절반을 넘었어요 (${finFailed.length}/${finTried}종목). 재무 TR·권한을 확인해 주세요`);

  // 환율·유가: 일봉 시작 1년 전부터(β 워밍업). 실패해도 수집은 계속하고 그 계열만 비운다.
  // 윤일(2월 29일)도 유효한 날짜가 되도록 Date.UTC로 계산한다(2024-02-29 → 2023-03-01)
  const macroFrom = new Date(Date.UTC(+from.slice(0, 4) - 1, +from.slice(4, 6) - 1, +from.slice(6, 8))).toISOString().slice(0, 10);
  const macro = {};
  let macroFailed = false;
  for (const [key, id] of Object.entries(FRED_IDS)) {
    try {
      macro[key] = await fetchFredSeries(id, { fetchImpl: fredFetch, sleep, from: macroFrom, to: dashed(to) });
    } catch (e) {
      macroFailed = true;
      log(`${key} 계열 실패: ${errText(e)}`);
      const kept = prev?.macro?.[key];
      if (kept?.d?.length) {
        macro[key] = kept; // --update: 이전 파일의 계열을 비우지 않고 지킨다
        log(`이전 파일의 ${key} 계열 ${kept.d.length}일을 그대로 두었어요`);
      } else macro[key] = { d: [], v: [] };
    }
  }
  if (macroFailed) log('환율·유가를 받지 못했어요');

  if (master.themeFailed) log('테마를 받지 못했어요');

  // 테마: 파일에 있는 종목만 남기고 빈 테마는 버린다.
  const inFile = new Set(stocks.map((s) => s.s));
  const themes = (master.themes ?? [])
    .map((t) => ({ code: t.code, name: t.name, symbols: t.symbols.filter((x) => inFile.has(x)) }))
    .filter((t) => t.symbols.length > 0);

  const axis = indices.find((i) => i.id === 'KOSPI')?.d ?? [];
  const allDates = axis.length ? axis : stocks.flatMap((s) => [s.d[0], s.d.at(-1)]).sort();
  const range = { from: dashed(allDates[0] ?? from), to: back ? dashed(to) : dashed(allDates.at(-1) ?? to) };
  const file = {
    format: 'gazua-market-data',
    version: 4,
    collectedAt: new Date(now() + KST_MS).toISOString().replace('Z', '+09:00'),
    // 수집 계정 표시: 이번 실행에서 받은 것만 쓴다(--update여도 이전 파일 값은 쓰지 않는다)
    ...(owner ? { owner } : {}),
    source,
    adjusted: true,
    range,
    sectors,
    macro,
    themes,
    stocks,
    indices,
  };

  // 임시 파일에 쓴 뒤 이름을 바꿔 원자적으로 교체한다.
  const tmp = `${filePath}.tmp`;
  await writeGzipJson(tmp, file);
  if (back && typeof extendBack === 'string') renameSync(extendBack, join(outDir, 'market-data-backup.json.gz.bak'));
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
    macroDays: { usdkrw: macro.usdkrw.d.length, wti: macro.wti.d.length },
    themes: themes.length,
    themeDropped: master.themeDropped ?? 0,
    flowStocks,
    flowFailed,
    flowFirst: flowFirst ? dashed(flowFirst) : null,
    finStocks,
    finFailed,
    finFirst: finFirst || null,
  };
  log(
    `완료: ${summary.stocks}종목 · ${range.from} ~ ${range.to} · 다시 받은 종목 ${refetched}개 · 실패 ${failed.length}개${
      failed.length ? ` (${failed.join(', ')})` : ''
    } · ${Math.round(summary.elapsedMs / 1000)}초 · ${(summary.bytes / 1048576).toFixed(1)}MB`,
  );
  log(`환율 ${summary.macroDays.usdkrw}일 · 유가 ${summary.macroDays.wti}일 · 테마 ${themes.length}개`);
  if (!kisExtras) log('매매동향·재무는 토스에 없어 넣지 않았어요');
  else {
    if (flows) {
      log(`매매동향 ${flowStocks}종목${flowStocks ? ` · 최초 ${summary.flowFirst}` : ''}${flowFailed.length ? ` · 수급 받기 실패 ${flowFailed.length}종목` : ''}`);
    } else log(`매매동향은 새로 받지 않았어요 (--no-flows)${flowStocks ? ` · 이전 수급 ${flowStocks}종목 유지` : ''}`);
    if (fins) {
      log(`재무 ${finStocks}종목${finStocks ? ` · 최초 ${quarterLabel(finFirst)}` : ''}${finFailed.length ? ` · 재무 받기 실패 ${finFailed.length}종목` : ''}`);
    } else log(`재무는 새로 받지 않았어요 (--no-fins)${finStocks ? ` · 이전 재무 ${finStocks}종목 유지` : ''}`);
  }
  if (summary.themeDropped) log(`테마 파일에서 형식이 맞지 않는 행 ${summary.themeDropped}개를 뺐어요`);
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
  // 테마는 없어도 되는 데이터라 실패하면 빈 목록으로 두고 알린다(오류 문구는 담지 않는다)
  const loadThemes = async () => {
    try {
      const { themes, dropped } = parseThemesDetailed(await get('theme_code.mst.zip', 'theme_code.mst'));
      return { themes, themeDropped: dropped };
    } catch {
      return { themes: [], themeDropped: 0, themeFailed: true };
    }
  };
  const [kospi, kosdaq, idx, themeInfo] = await Promise.all([
    get('kospi_code.mst.zip', 'kospi_code.mst'),
    get('kosdaq_code.mst.zip', 'kosdaq_code.mst'),
    get('idxcode.mst.zip', 'idxcode.mst'),
    loadThemes(),
  ]);
  return {
    ...themeInfo,
    stocks: [...parseMaster(kospi, 'KOSPI', { detail: true }), ...parseMaster(kosdaq, 'KOSDAQ', { detail: true })],
    idxcode: parseIdxcode(idx),
  };
}

export function parseArgs(argv) {
  const o = { years: 5, out: null, update: null, paper: false, flows: true, fins: true, flowsYears: null, drive: false, owner: true, provider: 'kis', rate: null, extendBack: null, maxYears: 5 };
  const args = argv.filter((a) => a !== '--');
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--paper') o.paper = true;
    else if (a === '--no-flows') o.flows = false;
    else if (a === '--no-fins') o.fins = false;
    else if (a === '--drive') o.drive = true;
    else if (a === '--no-owner') o.owner = false;
    else if (a === '--years' || a === '--flows-years' || a === '--out' || a === '--update' || a === '--provider' || a === '--rate' || a === '--extend-back' || a === '--max-years') {
      const v = args[++i];
      if (v === undefined) throw new Error(`${a} 값이 필요해요`);
      if (a === '--years') {
        o.years = Number(v);
        if (!Number.isInteger(o.years) || o.years < 1 || o.years > MAX_YEARS) throw new Error(`--years는 1~${MAX_YEARS} 사이 정수예요`);
      } else if (a === '--max-years') {
        o.maxYears = Number(v);
        if (!Number.isInteger(o.maxYears) || o.maxYears < 1 || o.maxYears > MAX_YEARS) throw new Error(`--max-years는 1~${MAX_YEARS} 사이 정수예요`);
      } else if (a === '--extend-back') {
        o.extendBack = v;
      } else if (a === '--flows-years') {
        o.flowsYears = Number(v);
        if (!Number.isInteger(o.flowsYears) || o.flowsYears < 1 || o.flowsYears > MAX_YEARS) throw new Error(`--flows-years는 1~${MAX_YEARS} 사이 정수예요`);
      } else if (a === '--provider') {
        if (v !== 'kis' && v !== 'toss') throw new Error('--provider는 kis 또는 toss예요');
        o.provider = v;
      } else if (a === '--rate') {
        o.rate = Number(v);
        if (!Number.isFinite(o.rate) || o.rate < 0.1 || o.rate > 10) throw new Error('--rate는 초당 0.1~10건이에요');
      } else o[a.slice(2)] = v;
    } else throw new Error(`알 수 없는 옵션: ${a}`);
  }
  if (o.extendBack) {
    if (o.update) throw new Error('--extend-back과 --update는 함께 쓸 수 없어요');
    if (o.provider !== 'toss') throw new Error('--extend-back은 --provider toss와 함께 써요');
    if (!args.includes('--years')) o.years = 1;
    o.rate ??= 1;
  }
  if (args.includes('--max-years') && !o.extendBack) throw new Error('--max-years는 --extend-back과 함께 써요');
  if (o.rate !== null && o.provider !== 'toss') throw new Error('--rate는 --provider toss와 함께 써요');
  if (o.paper && o.provider !== 'kis') throw new Error('--paper는 KIS에서만 써요');
  const home = (p) => (p === '~' || p.startsWith('~/') ? join(homedir(), p.slice(1)) : p);
  if (o.extendBack) o.extendBack = resolve(home(o.extendBack));
  if (o.update) o.update = resolve(home(o.update));
  o.out = resolve(home(o.out ?? (o.extendBack ? dirname(o.extendBack) : o.update ? dirname(o.update) : '~/gazua-data/')));
  return o;
}

/**
 * --drive: 수집이 끝난 파일을 CLI(gazua drive upload)로 본인 Drive에 올린다(설계 2026-11-02-market-drive 7절, D11).
 * 일봉을 받지 못한 종목이 있으면 올리지 않는다. KIS·토스 키는 자식에 넘기지 않는다.
 */
export function runDriveUpload(file, summary, deps = {}) {
  const { spawn = spawnSync, env = process.env, cliPath = join(REPO_ROOT, 'cli', 'dist', 'gazua.mjs'), exists = existsSync, error = (s) => console.error(s) } = deps;
  const retry = `파일은 ${file}에 있어요. \`gazua drive upload ${file}\`로 다시 올릴 수 있어요`;
  if (summary.failed.length > 0) {
    error(`일봉 실패 ${summary.failed.length}종목이 있어 Drive에 올리지 않았어요. --update로 다시 받거나, 이대로 올리려면 \`gazua drive upload ${file}\`를 실행해 주세요`);
    return 1;
  }
  if (!exists(cliPath)) {
    error(`먼저 pnpm -C cli build를 실행해 주세요. ${retry}`);
    return 1;
  }
  const childEnv = { ...env };
  for (const k of KEY_ENV) delete childEnv[k];
  const r = spawn(process.execPath, [cliPath, 'drive', 'upload', file], { stdio: 'inherit', env: childEnv });
  if (r.status === 0) return 0;
  error(retry);
  return 1;
}

/**
 * 수집 계정 표시(owner)를 CLI(gazua owner)로 받는다(설계 2026-11-03-market-owner-tag 4절).
 * 받지 못하면 던진다. KIS·토스 키는 자식에 넘기지 않는다.
 */
export function fetchOwner(deps = {}) {
  const { spawn = spawnSync, env = process.env, cliPath = join(REPO_ROOT, 'cli', 'dist', 'gazua.mjs'), exists = existsSync } = deps;
  if (!exists(cliPath)) throw new Error('먼저 pnpm -C cli build를 실행해 주세요');
  const childEnv = { ...env };
  for (const k of KEY_ENV) delete childEnv[k];
  const r = spawn(process.execPath, [cliPath, 'owner'], { encoding: 'utf8', env: childEnv, stdio: ['ignore', 'pipe', 'inherit'] });
  const loginHint = 'gazua drive login 또는 gazua login 뒤 다시 실행하거나, 표시 없이 수집하려면 --no-owner를 붙여 주세요';
  let res;
  try {
    res = JSON.parse(String(r.stdout ?? '').trim().split('\n').at(-1));
  } catch {
    res = null;
  }
  if (res?.ok === true && typeof res.data?.owner === 'string' && /^[0-9a-f]{32}$/.test(res.data.owner)) return res.data.owner;
  if (res?.ok === false && res.error?.code === 'invalid-args') throw new Error('CLI가 옛 빌드예요. pnpm -C cli build를 다시 실행해 주세요');
  const why = res?.ok === false ? (res.error?.message ?? res.error?.code) : res?.ok === true ? '표시 형식이 올바르지 않아요' : `CLI 출력을 해석하지 못했어요(종료 코드 ${r.status})`;
  // 로그인 문제일 때만 다시 로그인하라고 한다(서버 옛 버전·네트워크면 쓸모없는 재로그인을 권하지 않는다)
  const hint = ['not-logged-in', 'cli-token-expired', 'cli-token-revoked'].includes(res?.error?.code) ? loginHint : '표시 없이 수집하려면 --no-owner를 붙여 주세요';
  throw new Error(`수집 계정 표시를 받지 못했어요: ${why}. ${hint}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const log = (line) => console.log(line);
  if (opts.extendBack) {
    const prev = JSON.parse(gunzipSync(readFileSync(opts.extendBack)).toString('utf8'));
    const back = extendPlan(prev, { ...opts, today: kstCompact(Date.now()), source: opts.provider });
    if (back.reached) {
      log(`이미 ${opts.maxYears}년치예요`);
      return;
    }
  }
  const toss = opts.provider === 'toss';
  const names = toss ? ['TOSS_CLIENT_ID', 'TOSS_CLIENT_SECRET'] : ['KIS_APP_KEY', 'KIS_APP_SECRET'];
  const [appKey, appSecret] = names.map((k) => process.env[k]);
  if (!appKey || !appSecret) {
    throw new Error(toss ? '환경변수 TOSS_CLIENT_ID, TOSS_CLIENT_SECRET이 필요해요 (node --env-file=.env.toss ...)' : '환경변수 KIS_APP_KEY, KIS_APP_SECRET이 필요해요');
  }
  validateCreds(appKey, appSecret, names);
  assertOutAllowed(opts.out);
  // 계정 표시는 긴 수집 전에 먼저 확인한다
  const owner = opts.owner ? fetchOwner() : undefined;
  if (!opts.owner) log('수집 계정 표시 없이 수집해요(어느 계정의 앱이든 가져올 수 있어요)');
  log('종목 마스터를 받아요');
  const master = await loadMaster();
  const client = toss
    ? createTossClient({ clientId: appKey, clientSecret: appSecret, ...(opts.rate ? { perSecond: opts.rate } : {}) })
    : createKisClient({ appKey, appSecret, paper: opts.paper });
  if (toss) log(`토스로 종목·지수 일봉만 받아요 (초당 ${opts.rate ?? TOSS_RATE}건)`);
  const result = await collect({ extendBack: opts.extendBack ?? undefined, maxYears: opts.maxYears, years: opts.years, flows: opts.flows, fins: opts.fins, flowsYears: opts.flowsYears, out: opts.out, update: opts.update ?? undefined, client, master, log, owner, source: opts.provider });
  if (opts.drive && result) process.exitCode = runDriveUpload(result.summary.path, result.summary);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    // 환경변수의 키·시크릿이 문구에 섞여 있어도 가린다.
    let msg = e instanceof Error ? e.message : '실패했어요';
    for (const v of KEY_ENV.map((k) => process.env[k])) if (v) msg = msg.split(v).join('***');
    console.error(`[collect] ${msg}`);
    process.exit(1);
  });
}
