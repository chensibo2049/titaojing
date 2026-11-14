// 为 v1.4.0 报告截取语文观察表、开讲页题干、朗读模拟。需已 npm install（puppeteer-core、esbuild）。
import * as esbuild from "esbuild";
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = process.env.SHOT_OUT || "/workspace/titaojing-shots/v14";
const TMP = path.join(root, ".shot-v14");
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(root, "scripts/shot-v14-fixture.js")],
  bundle: true,
  format: "esm",
  outfile: path.join(TMP, "fixture.js"),
  logLevel: "silent",
  platform: "browser",
});
fs.copyFileSync(path.join(root, "assets/app.css"), path.join(TMP, "app.css"));
const html = `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<title>体态镜 · 语文试讲观察表</title>
<link rel="stylesheet" href="./app.css">
<style>
  body { margin: 0; background: var(--paper); color: var(--ink); }
  .shot-page { padding: 28px 32px 48px; max-width: 1080px; margin: 0 auto; }
  .shot-block { margin-bottom: 36px; }
  .shot-block h2 { font-family: var(--serif); font-size: 18px; margin: 0 0 12px; }
  .perm-stem { max-width: 36em; }
  .sim-row { display: flex; gap: 10px; flex-wrap: wrap; }
  .sim-seat { border: 1px solid var(--line); background: var(--paper-soft); padding: 8px 10px 10px; width: 120px; text-align: center; font-size: 12px; }
  .sim-name { display: block; font-weight: 600; margin-top: 4px; }
  .sim-meta { display: block; color: var(--ink-faint); }
  .sim-bubble { margin-top: 6px; font-size: 12px; background: #fff; border: 1px solid var(--line); padding: 2px 6px; }
  .kicker { color: var(--ink-faint); font-size: 13px; margin: 0 0 8px; }
</style>
<body>
  <div class="shot-page">
    <section class="shot-block" id="shot-stem">
      <p class="kicker">开讲页 · 选填</p>
      <div class="perm-stem" id="perm-stem-box">
        <label class="field-label" for="perm-stem">题干要求（选填）</label>
        <textarea id="perm-stem" rows="3" maxlength="800"></textarea>
        <p class="fs-note">只随这次试讲保存，用来对照「紧扣题干」。可不填。</p>
      </div>
    </section>
    <section class="shot-block" id="shot-chorus">
      <h2>模拟学生 · 齐读</h2>
      <p class="kicker">练习用模拟。听到「请大家齐读题目」之后。</p>
      <div class="sim-row" id="sim-chorus-row"></div>
    </section>
    <section class="shot-block" id="shot-point">
      <h2>模拟学生 · 请你来读</h2>
      <p class="kicker">练习用模拟。听到「请你来读」之后，一位同学站起来读。</p>
      <div class="sim-row" id="sim-point-row"></div>
    </section>
    <div id="sheet" class="observe-sheet"></div>
  </div>
  <script type="module" src="./fixture.js"></script>
</body>
</html>`;
fs.writeFileSync(path.join(TMP, "index.html"), html);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  let file = path.join(TMP, url.pathname === "/" ? "index.html" : url.pathname);
  if (!file.startsWith(TMP)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(file)) { res.writeHead(404); res.end("no"); return; }
  const ext = path.extname(file);
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
  res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const chrome = ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", process.env.CHROME_PATH].find((p) => p && fs.existsSync(p));
if (!chrome) { console.error("no chrome"); process.exit(2); }
const browser = await puppeteer.launch({
  executablePath: chrome, headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
  defaultViewport: { width: 1280, height: 1600 },
});
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle0", timeout: 30000 });
await page.waitForSelector("body.ready #ob-yuwen", { timeout: 15000 });

async function shot(sel, name, pad = 8) {
  const el = await page.$(sel);
  if (!el) throw new Error("missing " + sel);
  const box = await el.boundingBox();
  const vp = page.viewport();
  const clip = {
    x: Math.max(0, box.x - pad),
    y: Math.max(0, box.y - pad),
    width: Math.min(vp.width, box.width + pad * 2),
    height: Math.min(2400, box.height + pad * 2),
  };
  const dest = path.join(OUT, name);
  await page.screenshot({ path: dest, clip, type: "png" });
  console.log("wrote", dest, Math.round(clip.width) + "x" + Math.round(clip.height));
}

await shot("#shot-stem", "start-stem.png", 16);
await shot("#shot-chorus", "sim-chorus-read.png", 12);
await shot("#shot-point", "sim-stand-read.png", 12);
await shot("#ob-yuwen", "yuwen-rubric.png", 12);
// also a taller crop of the first law card + a few rows, and the full yuwen if too tall
const yuwen = await page.$("#ob-yuwen");
const box = await yuwen.boundingBox();
// if very tall, also save a top crop that shows the law card
await page.screenshot({
  path: path.join(OUT, "yuwen-rubric-top.png"),
  clip: { x: Math.max(0, box.x - 12), y: Math.max(0, box.y - 12), width: Math.min(page.viewport().width, box.width + 24), height: Math.min(1400, box.height + 24) },
  type: "png",
});
console.log("wrote", path.join(OUT, "yuwen-rubric-top.png"));

await browser.close();
server.close();
