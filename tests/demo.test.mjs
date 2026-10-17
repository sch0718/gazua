import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  FIN_GROWTH_CODES,
  FIN_LATE_CODE,
  FIN_LOSS_CODE,
  FIN_QUALITY_CODES,
  FIN_VALUE_CODES,
  FLOW_BOTH_CODE,
  FLOW_FOREIGN_CODES,
  FLOW_INST_CODES,
  FLOW_INST_STREAK,
  FLOW_LATE_CODE,
  FLOW_NONE_CODE,
  demoFile,
} from '../scripts/make-demo-market-data.mjs';

// tail=true면 마지막 'render();' 이후의 자동 시작 코드까지 실행한다(render는 스텁).
function loadDemo(path,{tail=false}={}){
  const html=readFileSync(new URL('../'+path,import.meta.url),'utf8');
  const script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
  const timers=new Map(), handlers=new Map(), elements=new Map();
  let nextTimer=0;
  const element=selector=>{
    if(!elements.has(selector)) elements.set(selector,{
      hidden:false, style:{}, classList:{add(){},remove(){},toggle(){}},
      addEventListener(){}, setAttribute(){}, focus(){},
    });
    return elements.get(selector);
  };
  const context=vm.createContext({
    console, URLSearchParams, location:{search:''}, innerWidth:1440, innerHeight:900,
    document:{querySelector:element,addEventListener:(type,fn)=>handlers.set('doc:'+type,fn)},
    addEventListener(){}, scrollTo(){}, setInterval(){},
    setTimeout(fn,ms){ const id=++nextTimer; timers.set(id,{fn,ms}); return id; },
    clearTimeout(id){ timers.delete(id); },
  });
  context.window=context;
  context.addEventListener=(type,fn)=>handlers.set('win:'+type,fn);
  const cut=script.lastIndexOf('\nrender();\n');
  vm.runInContext(script.slice(0,cut),context);
  vm.runInContext('SCRIPT.length=0; render=()=>{}; clearScrub=()=>{}; window.GAZUA_MOTION=true;',context);
  if(tail) vm.runInContext(script.slice(cut),context);
  const run=source=>vm.runInContext(source,context);
  const repeat=()=>[...timers.values()].find(t=>t.ms===2500);
  const start=()=>[...timers.values()].find(t=>t.ms===600);
  const fire=(type,e)=>handlers.get('win:'+type)({type,...e});
  return {run,timers,repeat,start,fire,handlers};
}

for(const path of ['poc/gazua-poc.html','motion/gazua-demo.html']){
  test(path+': completed demo repeats without user input',async()=>{
    const demo=loadDemo(path);
    await demo.run('runDemo()');
    assert.ok(demo.repeat());
    demo.run("state.groups.push({id:'new',name:'new',items:[]})");
    demo.repeat().fn();
    assert.equal(demo.run('state.groups.length'),3);
  });

  test(path+': pointer input during repeat delay preserves edited groups',async()=>{
    const demo=loadDemo(path);
    await demo.run('runDemo()');
    const repeat=demo.repeat();
    demo.fire('pointerdown',{isTrusted:true,target:{closest:()=>null}});
    demo.run("state.groups.push({id:'new',name:'new',items:[]})");
    assert.equal(demo.repeat(),undefined);
    repeat.fn();
    assert.equal(demo.run('state.groups.length'),4);
  });

  test(path+': keyboard input during repeat delay cancels restart',async()=>{
    const demo=loadDemo(path);
    await demo.run('runDemo()');
    const repeat=demo.repeat();
    demo.fire('keydown',{isTrusted:true,key:'Escape',target:{matches:()=>false,closest:()=>null}});
    demo.run("state.groups.push({id:'new',name:'new',items:[]})");
    assert.equal(demo.repeat(),undefined);
    repeat.fn();
    assert.equal(demo.run('state.groups.length'),4);
  });

  test(path+': explicit stop invalidates an already queued callback',async()=>{
    const demo=loadDemo(path);
    await demo.run('runDemo()');
    const repeat=demo.repeat();
    demo.run("stopDemo(); state.groups.push({id:'new',name:'new',items:[]})");
    assert.equal(demo.repeat(),undefined);
    repeat.fn();
    assert.equal(demo.run('state.groups.length'),4);
  });

  test(path+': manual replay replaces the previous repeat timer',async()=>{
    const demo=loadDemo(path);
    await demo.run('runDemo()');
    const repeat=demo.repeat();
    await demo.run('runDemo()');
    demo.run("state.groups.push({id:'new',name:'new',items:[]})");
    repeat.fn();
    assert.equal(demo.run('state.groups.length'),4);
    assert.equal([...demo.timers.values()].filter(t=>t.ms===2500).length,1);
  });

  test(path+': simulation controls also cancel a pending repeat',async()=>{
    const demo=loadDemo(path);
    await demo.run('runDemo()');
    demo.fire('pointerdown',{isTrusted:true,target:{closest:selector=>selector==='[data-demo-ctl]'?{}:null}});
    assert.equal(demo.repeat(),undefined);
  });

  test(path+': generated demo events do not interrupt playback',async()=>{
    const demo=loadDemo(path);
    await demo.run('runDemo()');
    const repeat=demo.repeat();
    for(const type of ['pointerdown','keydown']) demo.fire(type,{isTrusted:false,key:'x',target:{closest:()=>null,matches:()=>false}});
    assert.equal(demo.repeat(),repeat);
  });

  test(path+': play button input leaves its replay handler in control',async()=>{
    const demo=loadDemo(path);
    await demo.run('runDemo()');
    const repeat=demo.repeat();
    demo.fire('pointerdown',{isTrusted:true,target:{closest:selector=>selector==='#playBtn'?{}:null}});
    assert.equal(demo.repeat(),repeat);
  });

  test(path+': modifier keys and OS shortcuts do not stop the demo',async()=>{
    const demo=loadDemo(path);
    await demo.run('runDemo()');
    const repeat=demo.repeat();
    const target={closest:()=>null,matches:()=>false};
    for(const e of [{key:'Shift'},{key:'Meta'},{key:'Control'},{key:'Alt'},{key:'5',metaKey:true,shiftKey:true},{key:'f',metaKey:true,ctrlKey:true},{key:'=',metaKey:true},{key:'=',ctrlKey:true},{key:'Tab',altKey:true}])
      demo.fire('keydown',{isTrusted:true,target,...e});
    assert.equal(demo.repeat(),repeat);
  });

  test(path+': shifted characters still count as user input',async()=>{
    const demo=loadDemo(path);
    await demo.run('runDemo()');
    demo.fire('keydown',{isTrusted:true,key:'?',shiftKey:true,target:{closest:()=>null,matches:()=>false}});
    assert.equal(demo.repeat(),undefined);
  });

  test(path+': autoplay start timer is registered and cancelled by user input',()=>{
    const demo=loadDemo(path,{tail:true});
    assert.ok(demo.start());
    assert.equal(demo.run('demo.restartTimer!==null'),true);
    demo.fire('pointerdown',{isTrusted:true,target:{closest:()=>null}});
    assert.equal(demo.start(),undefined);
    assert.equal(demo.run('demo.restartTimer'),null);
  });

  test(path+': stop button before autoplay cancels the start timer',()=>{
    const demo=loadDemo(path,{tail:true});
    demo.run('stopDemo()');
    assert.equal(demo.start(),undefined);
  });
}

test('motion copy differs from the PoC only in title, banner and the GAZUA_MOTION flag',()=>{
  const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8').split('\n');
  const skip=l=>/^<title>|class="poc-banner"|^<script>window\.GAZUA_MOTION = true;/.test(l);
  const poc=read('poc/gazua-poc.html').filter(l=>!skip(l)), motion=read('motion/gazua-demo.html').filter(l=>!skip(l));
  assert.deepEqual(motion,poc);
  assert.ok(read('motion/gazua-demo.html').some(l=>l.startsWith('<script>window.GAZUA_MOTION = true;')));
});

// ── 데모 시장 데이터 v3: 설계한 수급 종목 ─────────────────────────────
const st = (code) => demoFile.stocks.find((x) => x.s === code);
// e(포함)까지 w일 창의 순매수 / 거래대금 합(백만 원)
function ratio(stock, key, e, w = 20) {
  const fl = stock.flow;
  const at = stock.d.indexOf(fl.from);
  let net = 0, tv = 0;
  for (let k = e - w + 1; k <= e; k++) {
    net += fl[key][k - at];
    tv += stock.tv[k] / 1e6;
  }
  return net / tv;
}
const last = (stock) => stock.d.length - 1;

test('데모 v3: 외국인 순매수 설계 종목은 어느 날 20일 비율이 봐도 3% 이상이다', () => {
  assert.equal(demoFile.version, 4);
  for (const code of FLOW_FOREIGN_CODES) {
    const stock = st(code);
    assert.ok(stock.flow);
    const at = stock.d.indexOf(stock.flow.from);
    for (let e = at + 19; e <= last(stock); e++) assert.ok(ratio(stock, 'f', e) >= 0.03, `${code} ${stock.d[e]}`);
  }
});

test('데모 v3: 기관 설계 종목은 마지막 봉에서 연속 순매수가 8일 이상이다(재선정일 이틀 전 기준으로도)', () => {
  assert.ok(FLOW_INST_STREAK >= 10);
  for (const code of FLOW_INST_CODES) {
    const stock = st(code);
    for (const lag of [0, 2]) {
      let streak = 0;
      for (let k = last(stock) - lag; k >= stock.d.indexOf(stock.flow.from) && stock.flow.i[k - stock.d.indexOf(stock.flow.from)] > 0; k--) streak++;
      assert.ok(streak >= 8, `${code} lag ${lag}: ${streak}`);
    }
  }
});

test('데모 v3: 외국인+기관 종목은 두 비율이 모두 양수로 크고, 늦게 시작하는 종목은 from이 기간 중간이다', () => {
  const both = st(FLOW_BOTH_CODE);
  assert.ok(ratio(both, 'f', last(both)) >= 0.03);
  assert.ok(ratio(both, 'i', last(both)) >= 0.02);
  const late = st(FLOW_LATE_CODE);
  const at = late.d.indexOf(late.flow.from);
  assert.ok(at > late.d.length * 0.4 && at < late.d.length * 0.6, `from 위치 ${at}/${late.d.length}`);
  assert.equal(late.flow.f.length, late.d.length - at);
  assert.equal(st(FLOW_NONE_CODE).flow, undefined);
});

test('데모 v3: 설계하지 않은 종목은 외국인 비율이 0 주변이고 값은 모두 정수다', () => {
  const designed = new Set([...FLOW_FOREIGN_CODES, FLOW_BOTH_CODE]);
  for (const stock of demoFile.stocks) {
    if (!stock.flow) continue;
    const { flow } = stock;
    assert.ok(stock.d.includes(flow.from));
    assert.ok(flow.f.length === flow.i.length && flow.f.length === flow.p.length);
    assert.ok([...flow.f, ...flow.i, ...flow.p].every(Number.isInteger));
    if (!designed.has(stock.s)) assert.ok(Math.abs(ratio(stock, 'f', last(stock))) < 0.03, stock.s);
  }
});

test('데모 v4: 두 번 만들면 바이트가 같고 저장된 fixture와 내용이 같다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'demo-'));
  try {
    const script = new URL('../scripts/make-demo-market-data.mjs', import.meta.url).pathname;
    const outs = ['a.gz', 'b.gz'].map((n) => join(dir, n));
    for (const o of outs) assert.equal(spawnSync(process.execPath, [script, o], { encoding: 'utf8' }).status, 0);
    const [a, b] = outs.map((o) => readFileSync(o));
    assert.ok(a.equals(b));
    // gzip 바이트는 플랫폼(zlib 버전·헤더의 OS 바이트)마다 달라서, 저장된 fixture와는 푼 내용으로 비교한다
    const stored = gunzipSync(readFileSync(new URL('./fixtures/market-data-demo.json.gz', import.meta.url)));
    assert.ok(gunzipSync(a).equals(stored));
    assert.deepEqual(JSON.parse(gunzipSync(a).toString('utf8')), JSON.parse(JSON.stringify(demoFile)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 데모 시장 데이터 v4: 설계한 재무 종목 ─────────────────────────────
// 앱의 fin.ts(Task 5)와 따로, 스펙 2.3·3.1을 그대로 옮긴 계산이다.
const compact = (ms) => new Date(ms).toISOString().slice(0, 10).replaceAll('-', '');
// 분기말(그 달 말일) + 연간 결산 분기 100일, 그 밖 60일
const finKnownFrom = (ym, a) => compact(Date.UTC(+ym.slice(0, 4), +ym.slice(4, 6), 0) + (a ? 100 : 60) * 86_400_000);
// 재선정일 d의 전 거래일 p에서 쓸 수 있는 지표. 계산 불가는 null
function finAt(stock, p) {
  const f = stock.fin;
  if (!f) return null;
  let L = -1;
  for (let k = 0; k < f.q.length; k++) if (finKnownFrom(f.q[k], f.a[k]) < p) L = k;
  const ttm = (key, end) => (end >= 3 ? f[key][end] + f[key][end - 1] + f[key][end - 2] + f[key][end - 3] : null);
  const at = stock.d.indexOf(p);
  const cap = at >= 0 ? stock.c[at] * stock.shares : null;
  const ni = L >= 0 ? ttm('ni', L) : null;
  const rev = L >= 0 ? ttm('rev', L) : null;
  const op = L >= 0 ? ttm('op', L) : null;
  const rev1 = L >= 4 ? ttm('rev', L - 4) : null;
  const op1 = L >= 4 ? ttm('op', L - 4) : null;
  const avgEq = L >= 4 ? (f.eq[L] + f.eq[L - 4]) / 2 : null;
  return {
    known: L + 1,
    ni,
    per: cap !== null && ni !== null && ni > 0 && stock.shares > 0 ? cap / (ni * 1e8) : null,
    pbr: cap !== null && L >= 0 && f.eq[L] > 0 && stock.shares > 0 ? cap / (f.eq[L] * 1e8) : null,
    roe: ni !== null && avgEq !== null && avgEq > 0 ? (ni / avgEq) * 100 : null,
    opMargin: rev !== null && rev > 0 ? (op / rev) * 100 : null,
    revGrowth: rev1 !== null && rev1 > 0 && rev !== null ? (rev / rev1 - 1) * 100 : null,
    opGrowth: op1 !== null && op1 > 0 && op !== null ? (op / op1 - 1) * 100 : null,
  };
}
// 앱의 기본 검증 기간(데이터 시작 1년 뒤 ~ 끝)의 매월 첫 거래일과 그 전 거래일 p
const AXIS = demoFile.indices.find((i) => i.id === 'KOSPI').d;
const PERIOD = { from: '20251016', to: '20261015' };
const REBAL = AXIS.map((d, i) => ({ d, p: AXIS[i - 1] })).filter(({ d }, i) => d >= PERIOD.from && d <= PERIOD.to && (AXIS[i - 1] < PERIOD.from || d.slice(0, 6) !== AXIS[i - 1].slice(0, 6)));
const LAST = REBAL.at(-1);
const FIN_DESIGNED = [...FIN_VALUE_CODES, ...FIN_QUALITY_CODES, ...FIN_GROWTH_CODES, FIN_LOSS_CODE, FIN_LATE_CODE];

test('데모 v4: 재무 설계 종목은 9개의 서로 다른 STOCK이고 수급·환율 설계 종목과 겹치지 않으며, STOCK만 재무가 있다', () => {
  assert.equal(demoFile.version, 4);
  assert.deepEqual([FIN_VALUE_CODES.length, FIN_QUALITY_CODES.length, FIN_GROWTH_CODES.length], [3, 2, 2]);
  assert.equal(new Set(FIN_DESIGNED).size, 9);
  const flowCodes = [...FLOW_FOREIGN_CODES, ...FLOW_INST_CODES, FLOW_BOTH_CODE, FLOW_LATE_CODE, FLOW_NONE_CODE];
  const betaTheme = demoFile.themes.find((t) => t.name === '환율 수혜 대표').symbols;
  const betaCodes = ['100000', '101111', '102222', '104444', '105555', '200000', '202222', '204444'];
  assert.ok(betaTheme.every((c) => betaCodes.includes(c)));
  for (const code of FIN_DESIGNED) {
    assert.equal(st(code)?.t, 'STOCK', code);
    assert.ok(!flowCodes.includes(code) && !betaCodes.includes(code), code);
  }
  for (const stock of demoFile.stocks) {
    if (stock.t !== 'STOCK') assert.equal(stock.fin, undefined, stock.s);
    else assert.ok(stock.fin, stock.s);
  }
});

test('데모 v4: fin은 형식 규칙을 지키고 12월 결산(12월 분기만 a = 1)이다', () => {
  const mon = (ym) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(4)) - 1;
  for (const stock of demoFile.stocks.filter((x) => x.fin)) {
    const f = stock.fin;
    assert.ok(f.q.length >= 1 && f.q.every((x, i) => /^\d{4}(0[1-9]|1[0-2])$/.test(x) && (i === 0 || mon(x) - mon(f.q[i - 1]) === 3)), stock.s);
    assert.deepEqual(f.a, f.q.map((q) => (q.endsWith('12') ? 1 : 0)), stock.s);
    for (const k of ['rev', 'op', 'ni', 'eq', 'debt']) {
      assert.equal(f[k].length, f.q.length);
      assert.ok(f[k].every((x) => Number.isFinite(x) && Math.round(x * 100) / 100 === x), `${stock.s} ${k}`);
    }
    assert.ok(f.eq.every((x) => x > 0) && f.debt.every((x) => x >= 0) && f.rev.every((x) => x > 0), stock.s);
  }
});

test('데모 v4: 마지막 재선정일에 설계 종목이 스펙 값 근처다(저PER·저PBR, 고ROE·고이익률, 고성장, 나머지 PER 15~40)', () => {
  assert.equal(LAST.d, '20261001');
  for (const code of FIN_VALUE_CODES) {
    const m = finAt(st(code), LAST.p);
    assert.ok(m.per > 3 && m.per <= 7, `${code} PER ${m.per}`);
    assert.ok(m.pbr > 0.35 && m.pbr <= 0.85, `${code} PBR ${m.pbr}`);
  }
  for (const code of FIN_QUALITY_CODES) {
    const m = finAt(st(code), LAST.p);
    assert.ok(m.roe >= 20 && m.roe <= 32, `${code} ROE ${m.roe}`);
    assert.ok(m.opMargin >= 18 && m.opMargin <= 22, `${code} 영업이익률 ${m.opMargin}`);
  }
  for (const code of FIN_GROWTH_CODES) {
    const m = finAt(st(code), LAST.p);
    assert.ok(m.revGrowth >= 30 && m.revGrowth <= 50, `${code} 매출 증가율 ${m.revGrowth}`);
    assert.ok(m.opGrowth >= 45 && m.opGrowth <= 75, `${code} 영업이익 증가율 ${m.opGrowth}`);
  }
  const value = new Set([...FIN_VALUE_CODES, FIN_LOSS_CODE]);
  for (const stock of demoFile.stocks.filter((x) => x.fin && !value.has(x.s))) {
    const m = finAt(stock, LAST.p);
    assert.ok(m.per >= 15 && m.per <= 40, `${stock.s} PER ${m.per}`);
    if (!FIN_QUALITY_CODES.includes(stock.s)) assert.ok(m.roe === null || m.roe < 20, `${stock.s} ROE ${m.roe}`);
    if (!FIN_GROWTH_CODES.includes(stock.s)) assert.ok(m.revGrowth === null || m.revGrowth < 30, `${stock.s} 매출 증가율 ${m.revGrowth}`);
  }
});

test('데모 v4: 기본 기간의 모든 재선정일에 PER 10 이하인 종목은 정확히 저PER 설계 종목이다', () => {
  assert.ok(REBAL.length >= 12);
  for (const { d, p } of REBAL) {
    const low = demoFile.stocks.filter((x) => x.fin && (finAt(x, p)?.per ?? Infinity) <= 10).map((x) => x.s).sort();
    assert.deepEqual(low, [...FIN_VALUE_CODES].sort(), d);
  }
});

test('데모 v4: 적자 종목은 모든 재선정일에 TTM 순이익이 0 이하라 PER이 계산 불가다', () => {
  for (const { p } of REBAL) {
    const m = finAt(st(FIN_LOSS_CODE), p);
    assert.ok(m.ni !== null && m.ni <= 0, `${p} ${m.ni}`);
    assert.equal(m.per, null);
  }
});

test('데모 v4: 늦게 시작하는 종목은 첫 분기가 기간 중간이고, 나머지는 첫 재선정일에 알려진 분기가 12개 이상이다', () => {
  const late = st(FIN_LATE_CODE);
  const first = late.fin.q[0];
  const at = late.d.findIndex((d) => d.slice(0, 6) >= first);
  assert.ok(at > late.d.length * 0.4 && at < late.d.length * 0.6, `첫 분기 ${first} 위치 ${at}/${late.d.length}`);
  assert.ok(finAt(late, REBAL[0].p).known < 4, '첫 재선정일에는 TTM을 구할 수 없다');
  assert.ok(finAt(late, LAST.p).per !== null, '마지막 재선정일에는 PER을 구할 수 있다');
  for (const stock of demoFile.stocks.filter((x) => x.fin && x.s !== FIN_LATE_CODE)) {
    assert.ok(finAt(stock, REBAL[0].p).known >= 12, stock.s);
  }
});
