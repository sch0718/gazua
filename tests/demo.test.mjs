import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { FLOW_BOTH_CODE, FLOW_FOREIGN_CODES, FLOW_INST_CODES, FLOW_INST_STREAK, FLOW_LATE_CODE, FLOW_NONE_CODE, demoFile } from '../scripts/make-demo-market-data.mjs';

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
  assert.equal(demoFile.version, 3);
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

test('데모 v3: 두 번 만들면 바이트가 같고 저장된 fixture와도 같다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'demo-'));
  try {
    const script = new URL('../scripts/make-demo-market-data.mjs', import.meta.url).pathname;
    const outs = ['a.gz', 'b.gz'].map((n) => join(dir, n));
    for (const o of outs) assert.equal(spawnSync(process.execPath, [script, o], { encoding: 'utf8' }).status, 0);
    const [a, b] = outs.map((o) => readFileSync(o));
    assert.ok(a.equals(b));
    assert.ok(a.equals(readFileSync(new URL('./fixtures/market-data-demo.json.gz', import.meta.url))));
    assert.deepEqual(JSON.parse(gunzipSync(a).toString('utf8')), JSON.parse(JSON.stringify(demoFile)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
