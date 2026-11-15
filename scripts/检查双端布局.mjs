// Run after npm run build: node scripts/检查双端布局.mjs
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
    await page.goto(base + '?noasrdl=1#/demo', { waitUntil: 'domcontentloaded' });
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
    if (width === 390 || width === 1366) await page.screenshot({ path:path.join(root, '.smoke-out', `双端回放-${width}.png`) });
    console.log('PASS', `${width}x${height}`, 'cover/settings/about/landing/replay', JSON.stringify(m.stage));
    checks++;
  }
  assert.equal(errors.length, 0, errors.join('; '));
  console.log(`PASS ${checks} responsive layout cases; desktop Chromium emulation, not device certification.`);
} finally { if (browser) await browser.close(); server.kill(); }
