// 冒烟测试（CI 用，约 1 分钟）：node scripts/smoke.mjs
//   需先 npm run build。会自己启动 scripts/serve.py 服务 dist/，用无头 Chrome + 虚拟摄像头跑一遍：
//   封面 → 一键演示（调试面板）→ 镜头试讲（?debug=1&trace=1，模型加载、轨迹记录）→ 回放。
// 环境变量：CHROME_PATH（Chrome/Chromium 路径）、SMOKE_OUT（截图目录，默认 .smoke-out/）
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.resolve(process.env.SMOKE_OUT || path.join(root, ".smoke-out"));
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const findChrome = () => [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe"].find((p) => p && fs.existsSync(p));

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + String(detail).slice(0, 200) : ""}`); };

if (!fs.existsSync(path.join(root, "dist/index.html"))) { console.error("没有 dist/，请先 npm run build"); process.exit(2); }

// 1) start the server; it prints the real URL (auto-picks a free port)
const server = spawn(process.platform === "win32" ? "python" : "python3", [path.join(root, "scripts/serve.py"), path.join(root, "dist"), process.env.SMOKE_PORT || "8877"], { env: { ...process.env, QUIET: "1", PYTHONUNBUFFERED: "1" } });
const BASE = await new Promise((resolve, reject) => {
  let buf = "";
  const to = setTimeout(() => reject(new Error("server did not start: " + buf)), 15000);
  server.stdout.on("data", (d) => { buf += d; const m = buf.match(/(http:\/\/127\.0\.0\.1:\d+\/)/); if (m) { clearTimeout(to); resolve(m[1]); } });
  server.stderr.on("data", (d) => { buf += d; });
  server.on("exit", (c) => reject(new Error(`server exited ${c}: ${buf}`)));
});
console.log("serving at", BASE);

const chrome = findChrome();
if (!chrome) { console.error("找不到 Chrome，请设置 CHROME_PATH"); server.kill(); process.exit(2); }
const browser = await puppeteer.launch({
  executablePath: chrome, headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader", "--font-render-hinting=none"],
  defaultViewport: { width: 1400, height: 900 },
});
const errors = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem("titaojing.consent.v1", JSON.stringify({ termsAccepted: true, experience: false, termsAcceptedAt: "2000-01-01T00:00:00.000Z" }));
    } catch (_) {}
  });

  const waitVisible = (id, timeout = 15000) => page.waitForFunction((i) => { const e = document.getElementById(i); return e && !e.hidden; }, { timeout }, id);

  await page.goto(BASE + "?debug=1", { waitUntil: "networkidle0", timeout: 30000 });
  const ver = await page.$eval("#cover-version", (e) => e.textContent);
  check("封面版本号", /v\d+\.\d+\.\d+/.test(ver), ver);
  check("调试面板出现（?debug=1）", !!(await page.$("#tj-debug")));
  check("使用说明层已跳过（测试写入了同意）", await page.$eval("#consent-veil", (e) => e.hidden).catch(() => true));
  const lead = await page.$eval(".lead", (e) => e.textContent);
  check("封面提到课堂 10 到 20 分钟和两种构图", /10 到 20 分钟/.test(lead) && /半身/.test(await page.$eval(".cover-points", (e) => e.textContent)));

  await page.evaluate(() => { location.hash = "#/demo"; });
  await waitVisible("screen-live");
  await sleep(9000);
  const demo = await page.evaluate(() => window.__titaojingDebug.state);
  check("演示：调试面板收到帧", demo.source === "demo" && demo.t > 3, `t=${demo.t}`);
  await page.screenshot({ path: path.join(OUT, "debug-demo.png") });
  await page.click("#btn-skip-demo");
  await waitVisible("screen-replay");
  check("演示 → 回放", true);
  const tx = await page.$eval("#transcript-list", (e) => ({ hidden: e.hidden, marks: e.querySelectorAll("mark.shuici").length, items: e.children.length })).catch(() => null);
  check("演示回放有转写且标出了水词", tx && !tx.hidden && tx.marks > 0 && tx.items > 0, JSON.stringify(tx));

  await page.goto(BASE + "?debug=1&trace=1#/try", { waitUntil: "domcontentloaded" });
  await waitVisible("screen-permission");
  await page.click("#btn-allow-media");
  await waitVisible("screen-coach", 15000);
  await page.waitForFunction(() => /已就绪|没能加载|太慢/.test(document.getElementById("mp-label").textContent), { timeout: 90000 }).catch(() => {});
  const mp = await page.$eval("#mp-label", (e) => e.textContent);
  check("模型加载完成", /已就绪/.test(mp), mp);
  const kbdHint = await page.$eval("#coach-kbd-hint", (e) => e.textContent);
  check("站位页提示可用空格开始", /空格/.test(kbdHint || ""), kbdHint);
  await page.keyboard.press("Space");
  await waitVisible("screen-live");
  // GitHub-hosted runners are slower than a laptop; wait until enough pose
  // frames are recorded instead of assuming a fixed 18s is enough.
  const liveMs = Number(process.env.SMOKE_LIVE_MS || 45000);
  await page.waitForFunction(() => {
    const s = window.__titaojingDebug && window.__titaojingDebug.state;
    return s && s.source === "camera" && s.rec && s.rec.frames.length > 20;
  }, { timeout: liveMs }).catch(() => {});
  const cam = await page.evaluate(() => { const s = window.__titaojingDebug.state; return { source: s.source, recFrames: s.rec ? s.rec.frames.length : 0, fps: s.frameTimes.length, vision: s.getVisionStatus() }; });
  check("镜头：调试面板收到帧并在记录轨迹", cam.source === "camera" && cam.recFrames > 20, `recFrames=${cam.recFrames}`);
  check("模型加载耗时已记录", cam.vision.timings && cam.vision.timings.downloadMs != null && cam.vision.loadMs > 0, JSON.stringify(cam.vision.timings));
  await page.screenshot({ path: path.join(OUT, "debug-mode.png") });
  await page.waitForFunction(() => !document.getElementById("btn-stop").disabled, { timeout: 10000 }).catch(() => {});
  const liveHint = await page.$eval("#live-kbd-hint", (e) => ({ hidden: e.hidden, text: e.textContent }));
  check("试讲中提示可用空格结束", liveHint && !liveHint.hidden && /空格/.test(liveHint.text || ""), JSON.stringify(liveHint));
  await page.keyboard.press("Space");
  await waitVisible("screen-replay", 15000);
  await sleep(800);
  const trace = await page.evaluate(() => window.__titaojingDebug.getTrace());
  check("结束后生成轨迹 JSON（titaojing-trace v1）", trace && trace.format === "titaojing-trace" && trace.formatVersion === 1 && trace.frames.length > 20, trace && `${trace.frames.length} frames`);
  check("轨迹默认不含听写原文、不含图片", trace && trace.transcriptsIncluded === false && !JSON.stringify(trace).includes("data:image"));
  if (trace) fs.writeFileSync(path.join(OUT, "trace-sample.json"), JSON.stringify(trace).slice(0, 2e6));
  check("页面无未捕获错误", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("冒烟测试运行", false, e.stack || e.message);
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} 项失败` : "\n冒烟测试全部通过");
process.exit(failed ? 1 : 0);
