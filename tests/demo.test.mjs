import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

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
    for(const e of [{key:'Shift'},{key:'Meta'},{key:'Control'},{key:'Alt'},{key:'5',metaKey:true,shiftKey:true},{key:'f',metaKey:true,ctrlKey:true},{key:'=',metaKey:true},{key:'Tab',altKey:true}])
      demo.fire('keydown',{isTrusted:true,target,...e});
    assert.equal(demo.repeat(),repeat);
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
