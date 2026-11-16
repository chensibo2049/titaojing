// Executed only inside ego-browser nodejs by 检查轻量演示浏览器.mjs.
const t = await taskSpace(config.space), p = t.page('p1');
const {base,out,layoutOnly} = config;
let count = 0;
const checks = [];
const check = (name, ok, detail = '') => { checks.push({name,ok,detail}); console.log((ok?'PASS ':'FAIL ')+name+' '+JSON.stringify(detail)); if(!ok) throw Error(name); count++; };
await p.cdp('Network.enable');
await p.cdp('Network.setBypassServiceWorker',{bypass:true});
await p.cdp('Network.setCacheDisabled',{cacheDisabled:true});
const go = route => p.goto(base+'?noasrdl=1&qa='+Date.now()+route);
const size = async(w,h) => {
  await p.cdp('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:w<900});
  // Wait on the actual page, not the CDP acknowledgement.
  await p.waitForFunction(`innerWidth===${w} && innerHeight===${h}`);
};
const seek = async n => {
  await p.focus('#timeline'); await p.keyboard.press('Home');
  for(let i=0;i<Math.floor(n/5);i++) await p.keyboard.press('Shift+ArrowRight');
  for(let i=0;i<n%5;i++) await p.keyboard.press('ArrowRight');
};
const state = () => p.evaluate(()=>window.__openpodiumDemo.status());
// Keyboard activation avoids native pointer coordinates changing CDP viewport emulation in Ego.
// These are real focused button events, not calls into application internals.
const activate = async selector => { await p.focus(selector); await p.keyboard.press('Enter'); };
const start = async() => {
  await go('#/demo'); await p.waitForFunction(()=>window.__openpodiumDemo.status().state==='ready');
  await activate('#btn-skip-demo'); await p.waitForFunction(()=>!document.querySelector('#screen-replay').hidden && window.__openpodiumDemo.status().state==='ready');
};
await size(1366,768);
for(const route of ['', '#/try']) {
  await go(route);
  const requests = await p.evaluate(()=>performance.getEntriesByType('resource').map(e=>e.name));
  check('非演示路径零Three/GLB请求 '+route, !requests.some(s=>/demo-presenter|three|[.]glb|draco/i.test(s)), requests.length);
}
await start();
check('演示独立模块只请求一次',await p.evaluate(()=>performance.getEntriesByType('resource').filter(e=>/demo-presenter[.]js/.test(e.name)).length===1));
if(!layoutOnly) {
  for(const n of [0,4,13,20,22,30,38,44,48]) {
    await seek(n); const s=await state();
    check('关键时刻 '+n,s.state==='ready'&&s.time===n,s.sample.phase.label);
    if([4,13,20,38,48].includes(n)) await p.screenshot({path:out+'/1366-'+n+'.png'});
  }
  await seek(20);
  const a=await p.evaluate(()=>({rig:document.querySelector('.demo-presenter-canvas').dataset.rig,sample:window.__openpodiumDemo.status().sample}));
  const f=(await state()).frames;
  await p.evaluate(()=>new Promise(r=>setTimeout(r,400)));
  check('暂停不继续渲染',(await state()).frames===f);
  await seek(48);await seek(20);
  const b=await p.evaluate(()=>({rig:document.querySelector('.demo-presenter-canvas').dataset.rig,sample:window.__openpodiumDemo.status().sample}));
  check('反向seek相同rig与动作',JSON.stringify(a)===JSON.stringify(b));
  await activate('#btn-play-dock');
  await p.waitForFunction(()=>window.__openpodiumDemo.status().time>21);
  await activate('#btn-play-dock');
  await p.waitForFunction(()=>document.querySelector('#btn-play-dock').textContent==='播放');
  const paused=(await state()).time;
  await p.evaluate(()=>new Promise(r=>setTimeout(r,400)));
  check('实际播放与暂停',(await state()).time===paused && paused>21);
  console.log('MEASURE',await state());
  await p.evaluate(()=>document.querySelector('.demo-presenter-canvas').dispatchEvent(new Event('webglcontextlost',{cancelable:true})));
  check('WebGL丢失降级',(await state()).state==='fallback'&&await p.evaluate(()=>!document.querySelector('.demo-presenter-canvas')&&!document.querySelector('#replay-scene').hidden));
  await p.goto(base+'?demoRenderer=2d&noasrdl=1#/demo');
  check('显式2D不加载独立模块',await p.evaluate(()=>window.__openpodiumDemo.status().state==='fallback'&&!performance.getEntriesByType('resource').some(e=>/demo-presenter/.test(e.name))));
  await p.cdp('Network.setBlockedURLs',{urls:['*demo-presenter.js*']});
  await go('#/demo');await p.waitForFunction(()=>window.__openpodiumDemo.status().state==='fallback');
  check('模块加载失败回退2D',await p.evaluate(()=>!document.querySelector('.demo-presenter-canvas')&&!document.querySelector('#live-scene').hidden));
  await p.cdp('Network.setBlockedURLs',{urls:[]});
}
for(const [w,h] of [[1366,768],[390,844],[360,800],[844,390]]) {
  await size(w,h);
  for (const route of ['', '#/settings', '#/about', 'landing/']) {
    await p.goto(base + (route === 'landing/' ? route : '?noasrdl=1' + route));
    const m = await p.evaluate(() => ({width:innerWidth, overflow:document.documentElement.scrollWidth>innerWidth+1, text:document.body.innerText}));
    check('旧入口布局 '+w+' '+(route||'封面'), !m.overflow && m.text.trim().length>40 && m.width===w);
    if (route === '#/about') {
      const expected = await p.evaluate(async () => (await (await fetch('version.json', {cache:'no-store'})).json()).version);
      check('关于页展示当前版本与轻量演示说明 '+w, await p.evaluate(version => {
        const notes = document.querySelector('#about-changelog-body').textContent;
        const capabilities = document.querySelector('#about-capabilities-list').textContent;
        return notes.includes('v'+version) && notes.includes('轻量预设试讲演示') && capabilities.includes('按需加载轻量三维人物');
      }, expected));
    }
  }
  await go(''); await activate('#btn-camera');
  await p.waitForFunction(()=>!document.querySelector('#screen-permission').hidden);
  check('开始练习仍进入准备页 '+w, await p.evaluate(()=>!document.querySelector('#screen-permission').hidden && /半身/.test(document.querySelector('#screen-permission').textContent)));
  await start(); await seek(38);
  const m=await p.evaluate(()=>{
    const box=id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};};
    return {vp:[innerWidth,innerHeight],overflow:document.documentElement.scrollWidth>innerWidth+1,stage:box('replay-stage'),overlay:box('replay-overlay'),timeline:box('timeline')};
  });
  check('双端布局 '+w,!m.overflow&&m.stage.width>0&&m.stage.height<h&&Math.abs(m.stage.width-m.overlay.width)<2&&Math.abs(m.stage.height-m.overlay.height)<2,m);
  await p.screenshot({path:out+'/'+w+'x'+h+'-板书.png'});
  await seek(4); await p.screenshot({path:out+'/'+w+'x'+h+'-开场.png'});
  await go('#/try');
  check('离开演示销毁 '+w,await p.evaluate(()=>window.__openpodiumDemo.status().state==='off'&&!document.querySelector('.demo-presenter-canvas')));
}
const fs = await import('node:fs/promises');
await fs.writeFile(out+'/result.json', JSON.stringify({base,layoutOnly,count,checks,time:new Date().toISOString()},null,2)+'\n');
console.log('PASS '+count+' ego checks. Desktop Chromium emulation; no physical device or camera permission test.');
