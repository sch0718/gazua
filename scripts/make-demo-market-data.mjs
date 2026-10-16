// 데모용 합성 시장 데이터를 만든다(고정 시드 난수라 매번 같은 결과).
// 실행: node scripts/make-demo-market-data.mjs [출력 경로]
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const OUT = process.argv[2] ?? 'tests/fixtures/market-data-demo.json.gz';

// mulberry32
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

// 2024-10-16 ~ 2026-10-15 평일(공휴일 무시)
function weekdays() {
  const out = [];
  const t = Date.UTC(2024, 9, 16);
  const end = Date.UTC(2026, 9, 15);
  for (let ms = t; ms <= end; ms += 86400000) {
    const dt = new Date(ms);
    if (dt.getUTCDay() === 0 || dt.getUTCDay() === 6) continue;
    out.push(dt.toISOString().slice(0, 10).replace(/-/g, ''));
  }
  return out;
}
const DATES = weekdays();

// ── 합성 macro (FRED 모양: 미국 평일, 몇 날은 휴일로 비움, 일봉 시작 1년 전부터) ──
function macroDates() {
  const out = [];
  const end = Date.UTC(2026, 9, 15);
  let k = 0;
  for (let ms = Date.UTC(2023, 9, 16); ms <= end; ms += 86400000) {
    const dt = new Date(ms);
    if (dt.getUTCDay() === 0 || dt.getUTCDay() === 6) continue;
    if (++k % 47 === 0) continue; // 휴일처럼 빈 날
    out.push(dt.toISOString().slice(0, 10).replace(/-/g, ''));
  }
  return out;
}
const MACRO_D = macroDates();
function macroSeries(seed, start, vol, round) {
  const r = rng(seed);
  let x = start;
  const v = MACRO_D.map(() => {
    x = Math.max(start * 0.5, x * (1 + 0.0001 + gauss(r) * vol));
    return Math.round(x * round) / round;
  });
  return { d: MACRO_D, v };
}
const macro = { usdkrw: macroSeries(7001, 1350, 0.006, 100), wti: macroSeries(7002, 75, 0.015, 100) };

// 관측일 기준 짝짓기(스펙 2.3): 봉 날짜 t보다 앞선 마지막 관측값의 인덱스(없으면 -1)
function lastBefore(t) {
  let lo = 0, hi = MACRO_D.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (MACRO_D[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}
// 봉 i의 환율 변화율 a(t_i)/a(t_{i-1}) - 1
const fxChange = DATES.map((t, i) => {
  if (i === 0) return 0;
  const a = lastBefore(t), b = lastBefore(DATES[i - 1]);
  return a < 0 || b < 0 ? 0 : macro.usdkrw.v[a] / macro.usdkrw.v[b] - 1;
});

const sectors = [
  { code: '00013', name: '전기·전자', level: 1 },
  { code: '00016', name: '금융', level: 1 },
  { code: '00005', name: '화학', level: 1 },
  { code: '11028', name: '전기·전자', level: 1 },
  { code: '11027', name: '제약', level: 1 },
];
const SEC_KOSPI = ['00013', '00016', '00005'];
const SEC_KOSDAQ = ['11028', '11027', '11028'];

function series(seed, start, vol, drift, dates) {
  const r = rng(seed);
  const o = [], h = [], l = [], c = [], v = [], tv = [];
  let prev = start;
  for (let i = 0; i < dates.length; i++) {
    const open = Math.max(10, Math.round(prev * (1 + gauss(r) * vol * 0.3)));
    const close = Math.max(10, Math.round(open * (1 + drift + gauss(r) * vol)));
    const hi = Math.round(Math.max(open, close) * (1 + r() * vol * 0.5));
    const lo = Math.max(1, Math.round(Math.min(open, close) * (1 - r() * vol * 0.5)));
    const vol_ = Math.round(100000 + r() * 900000);
    o.push(open); h.push(hi); l.push(lo); c.push(close); v.push(vol_); tv.push(vol_ * close);
    prev = close;
  }
  return { o, h, l, c, v, tv };
}

// 환율 변화에 beta를 곱하고 잡음을 더한 수익률로 만든 시리즈. 잡음은 표본에서 환율과 직교하게 만들어 β가 설계값에 맞는다.
function betaSeries(seed, start, beta, noiseVol, dates) {
  const r = rng(seed);
  const n = dates.length;
  const x = fxChange;
  const noise = Array.from({ length: n }, () => gauss(r) * noiseVol);
  noise[0] = 0;
  const mean = (a) => a.slice(1).reduce((p, q) => p + q, 0) / (n - 1);
  const mx = mean(x), mn = mean(noise);
  let cov = 0, vr = 0;
  for (let i = 1; i < n; i++) {
    cov += (x[i] - mx) * (noise[i] - mn);
    vr += (x[i] - mx) ** 2;
  }
  const k = cov / vr;
  const o = [], h = [], l = [], c = [], v = [], tv = [];
  let prev = start;
  for (let i = 0; i < n; i++) {
    const ret = i === 0 ? 0 : 0.0003 + beta * x[i] + (noise[i] - mn - k * (x[i] - mx));
    const close = Math.max(10, Math.round(prev * (1 + ret)));
    const open = Math.max(10, Math.round((prev + close) / 2 * (1 + gauss(r) * 0.001)));
    const hi = Math.round(Math.max(open, close) * (1 + r() * 0.004));
    const lo = Math.max(1, Math.round(Math.min(open, close) * (1 - r() * 0.004)));
    const vol_ = Math.round(100000 + r() * 900000);
    o.push(open); h.push(hi); l.push(lo); c.push(close); v.push(vol_); tv.push(vol_ * close);
    prev = close;
  }
  return { o, h, l, c, v, tv };
}

function pick(seedBase, arr) {
  return arr[seedBase % arr.length];
}

const stocks = [];
function add({ s, n, m, t, sec, shares, managed = false, halted = false, gapFrom, gapTo, beta }, i) {
  let dates = DATES;
  if (gapFrom !== undefined) dates = DATES.filter((_, k) => k < gapFrom || k >= gapTo); // 중간 공백
  const r = rng(1000 + i);
  const start = Math.round(5000 + r() * 95000);
  const x = beta === undefined ? series(5000 + i, start, t === 'ETF' ? 0.008 : 0.02, 0.0003, dates) : betaSeries(5000 + i, 50000 + Math.round(r() * 50000), beta, 0.003, dates);
  stocks.push({ s, n, m, t, sec, shares, managed, halted, d: dates, ...x });
}

const kospiNames = ['가온전자', '나라반도체', '다올화학', '라온금융', '마루전기', '바다케미칼', '사랑디스플레이', '아침은행', '자람소재', '차오름전자', '카이로보험', '타임화학', '파랑전자', '하늘증권', '행복소재'];
const kosdaqNames = ['가람바이오', '나눔소프트', '다솜제약', '라임반도체', '마음헬스', '바른테크', '새빛제약', '아름전자', '우리바이오', '진솔소재'];
const etfNames = ['KODEX 200', 'KODEX 반도체', 'TIGER 코스닥150', 'KODEX 은행', 'TIGER 화학'];
const etfCodes = ['069500', '091160', '232080', '091170', '227560'];

// 환율 민감도 설계값: +1.5 다섯 종목, -1.0 세 종목 (인덱스는 이름 배열 순서)
const BETA = { KOSPI: { 0: 1.5, 1: 1.5, 2: 1.5, 4: -1.0, 5: -1.0 }, KOSDAQ: { 0: 1.5, 1: 1.5, 2: -1.0 } };

let idx = 0;
kospiNames.forEach((n, k) => {
  const opt = { s: String(100000 + k * 1111).padStart(6, '0'), n, m: 'KOSPI', t: 'STOCK', sec: [pick(k, SEC_KOSPI), '', ''], shares: Math.round((2e7 + k * 1.3e7) / 1000) * 1000 };
  if (k === 3) opt.managed = true;
  if (k === 11) opt.halted = true;
  if (k === 7) { opt.gapFrom = 200; opt.gapTo = 215; }
  if (BETA.KOSPI[k] !== undefined) opt.beta = BETA.KOSPI[k];
  add(opt, idx++);
});
kosdaqNames.forEach((n, k) => {
  const opt = { s: String(200000 + k * 2222).padStart(6, '0'), n, m: 'KOSDAQ', t: 'STOCK', sec: [pick(k, SEC_KOSDAQ), '', ''], shares: Math.round((8e6 + k * 4e6) / 1000) * 1000 };
  if (k === 5) opt.managed = true;
  if (BETA.KOSDAQ[k] !== undefined) opt.beta = BETA.KOSDAQ[k];
  add(opt, idx++);
});
etfNames.forEach((n, k) => {
  add({ s: etfCodes[k], n, m: 'KOSPI', t: 'ETF', sec: ['', '', ''], shares: 5e6 + k * 3e6 }, idx++);
});

function index(id, seed, start) {
  const x = series(seed, start, 0.01, 0.0003, DATES);
  return { id, d: DATES, o: x.o.map((n) => n / 10), c: x.c.map((n) => n / 10) };
}
const indices = [index('KOSPI', 9001, 2600), index('KOSDAQ', 9002, 800)];
// 지수 값은 소수 한 자리
for (const i of indices) { i.o = i.o.map((n) => Math.round(n * 10) / 10); i.c = i.c.map((n) => Math.round(n * 10) / 10); }

const kospiStocks = stocks.filter((x) => x.m === 'KOSPI' && x.t === 'STOCK');
const kosdaqStocks = stocks.filter((x) => x.m === 'KOSDAQ');
const themes = [
  { code: '001', name: '환율 수혜 대표', symbols: [0, 1, 2].map((k) => kospiStocks[k].s) },
  { code: '002', name: '코스피·코스닥 혼합', symbols: [...kospiStocks.slice(3, 6).map((x) => x.s), ...kosdaqStocks.slice(0, 3).map((x) => x.s)] },
  { code: '003', name: '코스닥 바이오', symbols: [0, 4, 6, 8].map((k) => kosdaqStocks[k].s) },
];

const file = {
  format: 'gazua-market-data',
  version: 2,
  collectedAt: '2026-10-16T09:00:00+09:00',
  source: 'kis',
  adjusted: true,
  range: { from: '2024-10-16', to: '2026-10-15' },
  sectors,
  macro,
  themes,
  stocks,
  indices,
};
// 날짜가 같으니 mtime 없이 결정적이도록 gzip 헤더 mtime은 zlib이 0으로 둔다
writeFileSync(OUT, gzipSync(Buffer.from(JSON.stringify(file)), { level: 9 }));
console.log(`${OUT}: ${stocks.length}종목, ${DATES.length}일`);
