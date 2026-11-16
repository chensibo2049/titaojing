// Run after npm run build: node scripts/检查双端布局.mjs
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.env.LAYOUT_OUT || path.join(root, '.smoke-out', '入口验收-20261116'));
fs.mkdirSync(OUT, { recursive: true });
const chrome = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && fs.existsSync(p));
assert(chrome, 'Chrome required');
const server = spawn('python3', [path.join(root, 'scripts/serve.py'), path.join(root, 'dist'), '8997'], { env: { ...process.env, PYTHONUNBUFFERED: '1', QUIET: '1' } });
let browser;
try {
  const base = await new Promise((resolve, reject) => {
    let text = '';
    const timer = setTimeout(() => reject(Error('server startup timeout')), 10000);
    server.stdout.on('data', d => { text += d; const m = text.match(new RegExp('http://127[.]0[.]0[.]1:[0-9]+/')); if (m) { clearTimeout(timer); resolve(m[0]); } });
    server.once('error', reject);
  });
  browser = await puppeteer.launch({ executablePath: chrome, headless: true, pipe: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const key = fs.readFileSync(path.join(root, 'src/consent.js'), 'utf8').match(/const KEY = "([^"]+)"/)[1];
  await page.evaluateOnNewDocument(k => {
    localStorage.setItem(k, JSON.stringify({ termsAccepted: true, experience: false }));
    localStorage.setItem('titaojing.settings.v1', JSON.stringify({ sim3d: 'off', asrAutoDownload: false }));
    localStorage.setItem('titaojing.seenVersion', '1.6.0');
  }, key);
  fs.mkdirSync(path.join(root, '.smoke-out'), { recursive: true });
  let checks = 0;
  for (const [width, height] of [[360,800],[390,844],[768,1024],[1366,768],[1440,900],[844,390]]) {
    await page.setViewport({ width, height });
    for (const route of ['?noasrdl=1', '?noasrdl=1#/settings', '?noasrdl=1#/about', 'landing/']) {
      await page.goto(base + route, { waitUntil: 'domcontentloaded' });
      await new Promise(r => setTimeout(r, 150));
      const m = await page.evaluate(() => { const e = [...document.querySelectorAll('.screen')].find(e => !e.hidden) || document.documentElement; return { doc: document.documentElement.scrollWidth, width: innerWidth, screen: e.scrollWidth, client: e.clientWidth }; });
      assert(m.doc <= width + 1 && m.screen <= m.client + 1, JSON.stringify({ width, route, ...m }));
      checks++;
    }
    await page.goto(base + '?noasrdl=1', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#btn-camera', { visible: true });
    const hit = selector => page.$eval(selector, e => { const r=e.getBoundingClientRect(); const at=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); return r.top >= 0 && r.bottom <= innerHeight && (at===e || e.contains(at)); });
    assert(await hit('#btn-camera'), `${width}: primary CTA not in first viewport or obstructed`);
    assert(await page.$eval('.local-import', e => !e.open), 'file input must be collapsed');
    assert.equal(await page.$('#tj-debug'), null, 'debug should be opt-in');
    await page.screenshot({ path:path.join(OUT, `入口-回访-${width}.png`) });
    if (await page.$('#whats-new:not([hidden])')) {
      await page.click('#btn-view-whats-new');
      await page.waitForSelector('#modal:not([hidden])', { visible: true });
      assert(await page.$eval('#consent-veil', e => e.hidden), 'consent overlaps updates');
      assert(await page.$eval('#modal', e => e.contains(document.activeElement) && document.getElementById('app').inert), 'modal focus not contained');
      await page.keyboard.press('Tab');
      assert(await page.$eval('#modal', e => e.contains(document.activeElement)), 'Tab escaped modal');
      await page.click('#modal-actions button');
      assert(await page.$eval('#modal', e => e.hidden && getComputedStyle(e).display === 'none'), 'modal failed to hide');
    }
    await page.click('.local-import summary');
    assert(await page.$eval('#local-video-file', e => e.getBoundingClientRect().height > 0), 'file input cannot expand');
    await page.click('.local-import summary');
    await page.$eval('#screen-cover', e => e.scrollTop = 0);
    await page.click('#btn-camera');
    await page.waitForSelector('#screen-permission:not([hidden])');
    await page.goto(base + '?noasrdl=1', { waitUntil: 'domcontentloaded' });
    for (const route of ['history','settings','compare','profile','feedback','about']) {
      const selector = `.cover-nav a[href="#/${route}"]`;
      if (['compare','profile','feedback','about'].includes(route)) await page.click('.nav-more summary');
      await page.click(selector);
      await page.waitForSelector(`#screen-${route}:not([hidden])`);
      await page.goto(base + '?noasrdl=1', { waitUntil: 'domcontentloaded' });
    }
    const freshContext = await browser.createBrowserContext();
    const fresh = await freshContext.newPage();
    await fresh.setViewport({ width, height });
    fresh.on('pageerror', e => errors.push(e.message));
    await fresh.evaluateOnNewDocument(() => localStorage.setItem('titaojing.settings.v1', JSON.stringify({ asrAutoDownload: false })));
    await fresh.goto(base + '?noasrdl=1', { waitUntil: 'domcontentloaded' });
    await fresh.waitForSelector('#consent-veil:not([hidden])');
    assert(await fresh.$eval('#whats-new', e => e.hidden && getComputedStyle(e).display === 'none'), 'fresh updates overlap');
    await fresh.$eval('#update-bar', e => e.hidden = false);
    assert(await fresh.$eval('#update-bar', e => getComputedStyle(e).display === 'none'), 'service-worker update overlaps consent');
    assert(await fresh.$eval('#btn-consent-ok', e => { const r=e.getBoundingClientRect(); const at=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); return r.top >= 0 && r.bottom <= innerHeight && (at===e || e.contains(at)); }), 'first-use action not in viewport');
    await fresh.screenshot({ path:path.join(OUT, `入口-首次-${width}.png`) });
    await fresh.click('#btn-consent-ok');
    assert(await fresh.$eval('#consent-veil', e => e.hidden && getComputedStyle(e).display === 'none'), 'consent failed to hide');
    await fresh.reload({ waitUntil:'domcontentloaded' });
    await fresh.waitForSelector('#btn-camera', { visible:true });
    assert(await fresh.$eval('#whats-new', e => e.hidden), 'fresh update returned after consent');
    await freshContext.close();
    await page.goto(base + 'landing/', { waitUntil:'domcontentloaded' });
    await page.screenshot({ path:path.join(OUT, `介绍页-${width}.png`), fullPage:true });
    await page.goto(base + '?noasrdl=1#/demo', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.getElementById('btn-stop').disabled);
    assert(await page.$eval('#dock-note', e => /低头看稿/.test(e.textContent) && /非真实识别/.test(e.textContent) && e.getBoundingClientRect().height > 0), 'outside demo explanation missing');
    assert(await page.$eval('#hud-caption', e => +getComputedStyle(e).zIndex > +getComputedStyle(document.querySelector('.stage-overlay')).zIndex), 'caption behind skeleton');
    assert(await page.$eval('#hud-flags', e => +getComputedStyle(e).zIndex > +getComputedStyle(document.querySelector('.stage-overlay')).zIndex), 'flags behind skeleton');
    await page.waitForFunction(() => { const e=document.getElementById('hud-caption'); return !e.hidden && e.textContent.trim().length > 2; });
    assert(await page.$eval('#hud-caption', e => { const r=e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), 'mobile caption outside viewport');
    assert(await page.$eval('#live-demo-source', e => !document.getElementById('live-stage').contains(e)), 'disclaimer overlaps stage');
    await page.screenshot({ path:path.join(OUT, `演示-${width}.png`) });
    await page.waitForSelector('#btn-skip-demo', { visible: true });
    await page.click('#btn-skip-demo');
    await page.waitForSelector('#screen-replay', { visible: true });
    const m = await page.evaluate(() => {
      const e = document.getElementById('screen-replay');
      const box = id => { const r = document.getElementById(id).getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, bottom:r.bottom }; };
      return { doc:document.documentElement.scrollWidth, screen:e.scrollWidth, client:e.clientWidth, stage:box('replay-stage'), overlay:box('replay-overlay'), timeline:box('timeline') };
    });
    assert(m.doc <= width + 1 && m.screen <= m.client + 1, 'replay overflow');
    assert(m.stage.width > 0 && m.stage.height <= height + 1, 'stage exceeds viewport');
    assert(Math.abs(m.stage.width - m.overlay.width) <= 1 && Math.abs(m.stage.height - m.overlay.height) <= 1, 'overlay aspect mismatch');
    if (width > 900) assert(m.timeline.bottom <= height + 1, 'desktop timeline pushed below viewport');
    await page.$eval('#btn-play-dock', e => e.scrollIntoView({ block:'center' }));
    assert(await page.$eval('#btn-play-dock', e => { const r=e.getBoundingClientRect(); const at=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); return e===at || e.contains(at); }), 'play control obstructed');
    await page.$eval('#screen-replay', e => e.scrollTop = 0);
    if (width === 390 || width === 1366) await page.screenshot({ path:path.join(OUT, `双端回放-${width}.png`) });
    await page.goto(base + '?debug=1&noasrdl=1', { waitUntil:'domcontentloaded' });
    await page.waitForSelector('#tj-debug.min');
    assert(await hit('#btn-camera'), 'collapsed debug blocks CTA');
    await page.click('#btn-view-whats-new');
    assert(await page.$eval('#tj-debug', e => getComputedStyle(e).visibility === 'hidden'), 'debug overlaps modal');
    await page.keyboard.press('Escape');
    assert(await page.$eval('#modal', e => e.hidden && !document.getElementById('app').inert), 'Escape failed to restore app');
    console.log('PASS', `${width}x${height}`, 'cover/settings/about/landing/replay', JSON.stringify(m.stage));
    checks++;
  }
  assert.equal(errors.length, 0, errors.join('; '));
  console.log(`PASS ${checks} responsive layout cases; desktop Chromium emulation, not device certification.`);
} finally { if (browser) await browser.close(); server.kill(); }
