import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

function loadDemo(path){
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
    document:{querySelector:element,addEventListener:(type,fn)=>handlers.set(type,fn)},
    addEventListener(){}, scrollTo(){}, setInterval(){},
    setTimeout(fn,ms){ const id=++nextTimer; timers.set(id,{fn,ms}); return id; },
    clearTimeout(id){ timers.delete(id); },
  });
  context.window=context;
  context.addEventListener=(type,fn)=>handlers.set(type,fn);
  vm.runInContext(script.slice(0,script.lastIndexOf('\nrender();\n')),context);
  vm.runInContext('SCRIPT.length=0; render=()=>{}; clearScrub=()=>{}; window.GAZUA_MOTION=true;',context);
  const run=source=>vm.runInContext(source,context);
  const repeat=()=>[...timers.values()].find(t=>t.ms===2500);
  return {run,timers,repeat,handlers};
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
    demo.handlers.get('pointerdown')({isTrusted:true,target:{closest:()=>null}});
    demo.run("state.groups.push({id:'new',name:'new',items:[]})");
    assert.equal(demo.repeat(),undefined);
    repeat.fn();
    assert.equal(demo.run('state.groups.length'),4);
  });

  test(path+': keyboard input during repeat delay cancels restart',async()=>{
    const demo=loadDemo(path);
    await demo.run('runDemo()');
    const repeat=demo.repeat();
    demo.handlers.get('keydown')({isTrusted:true,key:'Escape',target:{matches:()=>false,closest:()=>null}});
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
    demo.handlers.get('pointerdown')({isTrusted:true,target:{closest:selector=>selector==='[data-demo-ctl]'?{}:null}});
    assert.equal(demo.repeat(),undefined);
  });

  test(path+': generated demo events do not interrupt playback',async()=>{
    const demo=loadDemo(path);
    await demo.run('runDemo()');
    const repeat=demo.repeat();
    for(const type of ['pointerdown','keydown']) demo.handlers.get(type)({isTrusted:false,key:'x',target:{closest:()=>null,matches:()=>false}});
    assert.equal(demo.repeat(),repeat);
  });

  test(path+': play button input leaves its replay handler in control',async()=>{
    const demo=loadDemo(path);
    await demo.run('runDemo()');
    const repeat=demo.repeat();
    demo.handlers.get('pointerdown')({isTrusted:true,target:{closest:()=>({})}});
    assert.equal(demo.repeat(),repeat);
  });
}
