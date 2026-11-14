// 流畅度测量：node scripts/perf.mjs  （需先 npm run build）
//   用无头 Chrome + 虚拟摄像头跑一次试讲，记录：
//   - 分析帧率（每秒完成多少次姿态分析）与每帧分析耗时（姿态/面部/手部合计）
//   - 页面帧率（requestAnimationFrame 每秒实际回调次数，代表画面是否卡顿）
//   注意：无头 Chrome 用软件渲染（SwiftShader），数字只用来比较改动前后，不代表真实笔记本。
// 环境变量：PERF_MS（试讲时长，默认 20000）、PERF_MODE（auto|smooth|detail，写入设置）、CHROME_PATH
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => p && fs.existsSync(p));
const server = spawn("python3", [path.join(root, "scripts/serve.py"), path.join(root, "dist"), process.env.SMOKE_PORT || "8880"], { env: { ...process.env, QUIET: "1", PYTHONUNBUFFERED: "1" } });
const BASE = await new Promise((resolve, reject) => {
  let buf = "";
  server.stdout.on("data", (d) => { buf += d; const m = buf.match(/(http:\/\/127\.0\.0\.1:\d+\/)/); if (m) resolve(m[1]); });
  setTimeout(() => reject(new Error("server did not start")), 15000);
});
const browser = await puppeteer.launch({
  executablePath: chrome, headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader"],
  defaultViewport: { width: 1400, height: 900 },
});
const mode = process.env.PERF_MODE || "";
const out = {};
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((mode) => {
    try {
      localStorage.setItem("titaojing.consent.v1", JSON.stringify({ termsAccepted: true, experience: false, termsAcceptedAt: "2000-01-01T00:00:00.000Z" }));
      if (mode) {
        const s = JSON.parse(localStorage.getItem("titaojing.settings.v1") || "{}");
        s.perfMode = mode;
        localStorage.setItem("titaojing.settings.v1", JSON.stringify(s));
      }
    } catch (_) {}
    window.__raf = [];
    const tick = (t) => { window.__raf.push(t); if (window.__raf.length > 5000) window.__raf.shift(); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }, mode);
  const waitVisible = (id, timeout = 15000) => page.waitForFunction((i) => { const e = document.getElementById(i); return e && !e.hidden; }, { timeout }, id);
  await page.goto(BASE + "?debug=1#/try", { waitUntil: "domcontentloaded" });
  await waitVisible("screen-permission");
  await page.click("#btn-allow-media");
  await waitVisible("screen-coach", 15000);
  await page.waitForFunction(() => /已就绪|没能加载|太慢/.test(document.getElementById("mp-label").textContent), { timeout: 90000 }).catch(() => {});
  await sleep(1500);
  await page.keyboard.press("Space");
  await waitVisible("screen-live");
  await sleep(4000); // 倒计时 + 预热
  const samples = [];
  const total = Number(process.env.PERF_MS || 20000);
  const t0 = Date.now();
  while (Date.now() - t0 < total) {
    await sleep(1000);
    samples.push(await page.evaluate(() => {
      const s = window.__titaojingDebug.state;
      const now = performance.now();
      const ft = s.frameTimes.filter((x) => now - x < 2000);
      const fps = ft.length > 1 ? (ft.length - 1) / ((ft[ft.length - 1] - ft[0]) / 1000) : 0;
      const ms = s.inferMs.length ? s.inferMs.reduce((a, b) => a + b, 0) / s.inferMs.length : 0;
      const r = window.__raf.filter((x) => now - x < 1000);
      return { fps, ms, raf: r.length, perf: s.perf || null };
    }));
  }
  const avg = (k) => samples.reduce((a, s) => a + s[k], 0) / samples.length;
  out.analysisFps = +avg("fps").toFixed(1);
  out.inferMsPerAnalysedFrame = +avg("ms").toFixed(1);
  out.pageFps = +avg("raf").toFixed(1);
  out.last = samples[samples.length - 1].perf;
  out.stats = await page.evaluate(() => (window.__titaojingDebug.state.perf || null));
} finally {
  await browser.close();
  server.kill();
}
console.log(JSON.stringify({ mode: mode || "(默认)", ...out }, null, 2));
