// Focused WebGL presenter regression: node scripts/检查讲师动作.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && fs.existsSync(p));
assert(chrome, 'Chrome is required');
const server = spawn('python3', [path.join(root, 'scripts/serve.py'), root, '0'], { env: { ...process.env, PYTHONUNBUFFERED: '1', QUIET: '1' } });
let browser;
try {
  const base = await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('local server timed out: ' + output)), 10000);
    server.stdout.on('data', (chunk) => { output += chunk; const match = output.match(/http:\/\/127\.0\.0\.1:\d+\//); if (match) { clearTimeout(timeout); resolve(match[0]); } });
    server.stderr.on('data', (chunk) => { output += chunk; });
    server.on('exit', (code) => reject(new Error('server stopped: ' + code + ' ' + output)));
  });
  browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'], defaultViewport: { width: 900, height: 900 } });
  const page = await browser.newPage();
  page.on('pageerror', (error) => { console.error('Browser:', error.message); });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  const measurements = await page.evaluate(async () => {
    const host = document.createElement('div');
    Object.assign(host.style, { position: 'fixed', width: '430px', height: '700px', top: '0', left: '0', zIndex: '99999' });
    document.body.append(host);
    const { mountPresenterScene } = await import('/assets/character-scene.js');
    const scene = await mountPresenterScene(host);
    const sample = (t) => { const pose = scene.setDemoTime(t); const data = scene.diagnostics(); return { pose: !!pose, ...data }; };
    const a = sample(0), read = sample(13), readRepeat = sample(13), swayLeft = sample(20), swayRight = sample(22), board = sample(38), again = sample(13), returnBoard = sample(38), returnSway = sample(20);
    const canvas = host.querySelector('canvas');
    const render = (t) => { scene.setDemoTime(t); return canvas.toDataURL('image/png'); };
    const frames = { read: render(13), sway: render(22), board: render(38), front: render(0) };
    const portrait = new Image(); portrait.src = frames.front; await portrait.decode();
    const pixels = document.createElement('canvas'); pixels.width = 430; pixels.height = 700;
    const ctx = pixels.getContext('2d'); ctx.drawImage(portrait, 0, 0, 430, 700);
    const face = ctx.getImageData(200, 112, 40, 30).data;
    let brightness = 0;
    for (let i = 0; i < face.length; i += 4) brightness += face[i] * 0.2126 + face[i + 1] * 0.7152 + face[i + 2] * 0.0722;
    brightness /= face.length / 4;
    scene.dispose(); host.remove();
    return { a, read, readRepeat, swayLeft, swayRight, board, again, returnBoard, returnSway, frames, brightness };
  });
  const { a, read, readRepeat, swayLeft, swayRight, board, again, returnBoard, returnSway, frames, brightness } = measurements;
  assert.equal(a.joints, 15);
  assert.equal(a.clips.length, 5);
  for (const [name, sampled] of Object.entries({ a, read, swayLeft, swayRight, board, again, returnBoard })) assert(sampled.pose && sampled.valid, name + ' has no full projected skeleton');
  // The measured patch covers the front-facing face; a missing presenter fill
  // makes it effectively black even while the rest of the scene renders.
  assert(brightness > 45, `presenter face is underlit: luminance ${brightness}`);
  const close = (x, y, tolerance = 1e-5, label = 'pose') => assert(Math.abs(x - y) < tolerance, `${label}: ${x} != ${y}`);
  // At 13s the head genuinely nods at the neck, rather than merely moving a screen-space landmark.
  assert(read.rig.Nose.position[1] < a.rig.Nose.position[1] - 0.02, 'reading nose must lower in world space');
  assert(read.rig.Nose.position[2] > a.rig.Nose.position[2] + 0.025, 'reading nose must tip toward the notes in front of the camera');
  assert(Math.abs(swayLeft.rig.Spine2.position[0] - swayRight.rig.Spine2.position[0]) > 0.008, 'torso must sway laterally');
  assert(Math.abs(board.rig.Nose.position[0] - a.rig.Nose.position[0]) > 0.045, 'head must turn toward board');
  for (const [name, i] of [['Spine2', 0], ['Neck', 0]]) assert(Math.abs(board.rig[name].quaternion[i] - a.rig[name].quaternion[i]) > 0.04, name + ' must rotate, not translate the root');
  // The source turn_board clip itself shifts the pelvis slightly; our overlay rotates upper bones only.
  assert(Math.abs(board.rig.Pelvis.position[0] - a.rig.Pelvis.position[0]) < 0.03, 'turn must not slide the scene root');
  for (const [label, first, second] of [['repeat read', read, readRepeat], ['return read', read, again], ['return board', board, returnBoard], ['return sway', swayLeft, returnSway]]) {
    for (const name of ['Head', 'Neck', 'Spine2', 'Pelvis', 'Nose']) {
      for (const [i, v] of first.rig[name].position.entries()) close(v, second.rig[name].position[i], 1e-5, `${label} ${name} position ${i}`);
      if (first.rig[name].quaternion) for (const [i, v] of first.rig[name].quaternion.entries()) close(v, second.rig[name].quaternion[i], 1e-5, `${label} ${name} quaternion ${i}`);
    }
  }
  assert(Object.values(frames).every((png) => png.length > 4000), 'WebGL frames must render');
  // Optional visual inspection: keep under the ignored smoke output, not the deliverable.
  if (process.env.PRESENTER_SHOTS === '1') {
    const dir = path.join(root, '.smoke-out'); fs.mkdirSync(dir, { recursive: true });
    for (const [name, png] of Object.entries(frames)) fs.writeFileSync(path.join(dir, `presenter-${name}.png`), Buffer.from(png.split(',')[1], 'base64'));
  }
  console.log('PASS presenter: 15 joints, 5 clips, 3D reading/sway/board, no root displacement, identical reverse seeks and rendered frames');
} finally { await browser?.close(); server.kill(); }
