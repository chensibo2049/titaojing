// v1.0 无头浏览器验收：node scripts/qa-v1.mjs  （需先 npm run build，并在 8877 端口服务 dist/）
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.QA_BASE || "http://127.0.0.1:8877/";
const OUT = process.env.QA_OUT || "/workspace/titaojing-shots/v1";
fs.mkdirSync(OUT, { recursive: true });
const T0 = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = { checks: [], errors: [], benignConsole: [], external: [], failed: [] };
const check = (name, ok, detail = "") => { results.checks.push({ name, ok: !!ok, detail: String(detail).slice(0, 300) }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + String(detail).slice(0, 160) : ""}`); };

const BENIGN = [/XNNPACK/i, /TensorFlow Lite/i, /gl_context/i, /OpenGL/i, /WebGL/i, /GPU/i, /Graph successfully started/i, /Created .* delegate/i, /landmark_projection_calculator/i, /inference_feedback_manager/i, /Feedback manager/i, /W\d{4} /, /I\d{4} /];

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--font-render-hinting=none", "--enable-unsafe-swiftshader"],
  defaultViewport: { width: 1400, height: 900, deviceScaleFactor: 1 },
});

function watch(page, tag) {
  page.on("pageerror", (e) => results.errors.push(`[${tag}] PAGEERROR ${e.message}`));
  page.on("console", (m) => {
    const t = m.text();
    if (m.type() === "error" || m.type() === "warning" || m.type() === "warn") {
      if (BENIGN.some((r) => r.test(t))) results.benignConsole.push(`[${tag}] ${m.type()}: ${t.slice(0, 160)}`);
      else if (m.type() === "error") results.errors.push(`[${tag}] CONSOLE ${t.slice(0, 300)}`);
    }
  });
  page.on("request", (r) => { const u = r.url(); if (!u.startsWith(BASE.replace(/\/$/, "")) && !u.startsWith("data:") && !u.startsWith("blob:")) results.external.push(`[${tag}] ${u}`); });
  page.on("requestfailed", (r) => { const u = r.url(); if (!u.startsWith("blob:")) results.failed.push(`[${tag}] ${u} ${r.failure()?.errorText} type=${r.resourceType()} sw=${!!r.isNavigationRequest()} t=${Date.now() - T0}ms`); });
}

const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) });
const go = async (page, hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await sleep(500); };
const visible = (page, id) => page.$eval(`#${id}`, (el) => !el.hidden).catch(() => false);
const waitVisible = (page, id, timeout = 15000) => page.waitForFunction((i) => { const e = document.getElementById(i); return e && !e.hidden; }, { timeout }, id);

const ctx = await browser.createBrowserContext();
await ctx.evaluateOnNewDocument(() => {
  try { localStorage.setItem("titaojing.consent.v1", JSON.stringify({ termsAccepted: true, experience: false, termsAcceptedAt: "2000-01-01T00:00:00.000Z" })); } catch (_) {}
});
const page = await ctx.newPage();
watch(page, "main");

// 1. Cover
await page.goto(BASE, { waitUntil: "networkidle0", timeout: 30000 });
await sleep(800);
await shot(page, "01-cover-desktop.png");
const ver = await page.$eval("#cover-version", (e) => e.textContent);
check("封面显示版本号与构建日期", /v\d+\.\d+\.\d+ · \d{4}-\d{2}-\d{2} 构建/.test(ver), ver);
check("封面无 file:// 警告", await page.$eval("#file-warning", (e) => e.hidden));
check("品牌：沉思波 · 体态镜", (await page.$eval(".brand-mark", (e) => e.textContent)).includes("沉思波 · 体态镜"));

// PWA manifest + SW
const mf = await page.evaluate(async () => { const r = await fetch(document.querySelector('link[rel=manifest]').href); return { ct: r.headers.get("content-type"), j: await r.json() }; });
check("manifest 可读取且 MIME 正确", mf.ct.includes("manifest+json") && mf.j.short_name === "体态镜" && mf.j.icons.length >= 4, `${mf.ct} ${mf.j.name}`);
const icons = await page.evaluate(async (list) => Promise.all(list.map(async (i) => (await fetch(i.src)).ok)), mf.j.icons);
check("manifest 图标全部可访问", icons.every(Boolean));
const sw = await page.evaluate(async () => { const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 10000))]); return reg ? { scope: reg.scope, active: !!reg.active, script: reg.active && reg.active.scriptURL } : null; });
check("Service Worker 已注册并激活", sw && sw.active, sw && sw.script);
const wasmCt = await page.evaluate(async () => { const r = await fetch("assets/mediapipe/wasm/vision_wasm_internal.wasm"); await r.arrayBuffer(); return r.headers.get("content-type"); });
check(".wasm MIME = application/wasm（本地服务器）", wasmCt === "application/wasm", wasmCt);

// 2. Demo
await page.click("#btn-demo");
await waitVisible(page, "screen-live");
await sleep(21000);
await shot(page, "02-demo-live.png");
await page.click("#btn-skip-demo");
await waitVisible(page, "screen-replay");
await page.waitForFunction(() => /演示记录已存入历史/.test(document.getElementById("save-status").textContent), { timeout: 8000 }).catch(() => {});
await sleep(600);
await shot(page, "03-demo-replay.png");
const demoSave = await page.$eval("#save-status", (e) => e.textContent);
check("演示结束后自动存入历史", /演示记录已存入历史/.test(demoSave), demoSave);
const diagCounts = await page.$$eval(".diag-count .n", (ns) => ns.map((n) => n.textContent));
check("演示诊断四项计数", diagCounts.length === 4, diagCounts.join(","));
check("回放时间线有标记", (await page.$$(".mark-pin")).length > 3);

// 3. Real camera path with Chrome fake device (synthetic test pattern, no person)
await go(page, "#/try");
await waitVisible(page, "screen-permission");
await shot(page, "04-permission.png");
await page.click("#btn-allow-media");
await waitVisible(page, "screen-coach", 15000);
await sleep(1500);
await shot(page, "05-coach-loading.png");
await page.waitForFunction(() => /已就绪|没能加载|太慢/.test(document.getElementById("mp-label").textContent), { timeout: 90000 }).catch(() => {});
const mpLabel = await page.$eval("#mp-label", (e) => e.textContent);
check("模型加载进度与结果提示", /已就绪/.test(mpLabel), mpLabel);
await sleep(1500);
await shot(page, "06-coach-ready.png");
const visionState = await page.evaluate(() => document.getElementById("mic-state").textContent);
check("麦克风状态提示", visionState.length > 0, visionState);
await page.click("#btn-start-countdown");
await waitVisible(page, "screen-live");
await sleep(19000);
await shot(page, "07-camera-live.png");
const stopEnabled = await page.$eval("#btn-stop", (b) => !b.disabled);
check("15 秒后可以结束试讲", stopEnabled);
// tab hidden → pause veil
await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
await sleep(400);
check("切到后台自动暂停", await visible(page, "pause-veil"));
await shot(page, "08-camera-paused.png");
await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
await page.click("#btn-resume");
await sleep(1500);
check("继续试讲后暂停层消失", !(await visible(page, "pause-veil")));
await page.click("#btn-stop");
await waitVisible(page, "screen-replay", 10000);
await page.waitForFunction(() => /已保存到本机历史/.test(document.getElementById("save-status").textContent), { timeout: 8000 }).catch(() => {});
await sleep(800);
await shot(page, "09-camera-replay.png");
const camSave = await page.$eval("#save-status", (e) => e.textContent);
check("真实试讲结束后存入历史", /已保存到本机历史/.test(camSave), camSave);
check("试讲回放有录像", await page.$eval("#replay-video", (v) => !v.hidden && !!v.src));
check("回放后网址变为 #/session/…", (await page.evaluate(() => location.hash)).startsWith("#/session/"));

// 4. Import synthetic history (tests JSON import) so compare/trend have data
const now = Date.now();
const mk = (i, f, g, p, b, dur) => ({ id: `sqa${i}x0001`, v: 1, appVersion: "1.0.0", kind: "camera", startedAt: now - (5 - i) * 86400000 - 3600000, savedAt: now, duration: dur, aspect: 0.5625, mirror: true,
  diagnosis: { duration: dur, counts: { posture: p, sway: 0, gaze: g, filler: f, board: b }, classRatio: 0.4 + i * 0.08, notesRatio: 0.2, good: `第 ${i} 次：开场看着学生。`, next: i % 2 ? "把「然后」换成半秒停顿。" : "写完板书先回头看学生。" },
  metrics: { duration: dur, posture: p, gaze: g, filler: f, board: b, perMin: { posture: +(p / (dur / 60)).toFixed(2), gaze: +(g / (dur / 60)).toFixed(2), filler: +(f / (dur / 60)).toFixed(2), board: +(b / (dur / 60)).toFixed(2) }, classRatio: 0.4 + i * 0.08, notesRatio: 0.2 },
  events: [{ t: 10, type: "filler", kind: "filler", label: "然后", word: "然后" }], captions: [], frames: [], thumb: "", hasVideo: false, videoSize: 0, speechAvailable: true, visionAvailable: true, stats: null });
const payload = { format: "titaojing-history", sessions: [mk(1, 9, 5, 4, 2, 120), mk(2, 7, 4, 3, 2, 130), mk(3, 4, 3, 2, 1, 125)] };
const importFile = "/tmp/titaojing-qa-import.json";
fs.writeFileSync(importFile, JSON.stringify(payload));
await go(page, "#/history");
await waitVisible(page, "screen-history");
const input = await page.$("#input-import-json");
await input.uploadFile(importFile);
await sleep(1500);
await shot(page, "10-history.png");
const histCount = await page.$$eval(".hist-item", (n) => n.length);
check("历史列表：演示 1 + 试讲 1 + 导入 3 = 5 条", histCount === 5, histCount);
const usageTxt = await page.$eval("#usage-card", (e) => e.textContent.replace(/\s+/g, " "));
check("历史页显示存储用量与试用额度", /条记录/.test(usageTxt) && /试用版/.test(usageTxt), usageTxt);

// 5. Compare
await go(page, "#/compare");
await sleep(600);
await shot(page, "11-compare.png");
check("进步对比表格", (await page.$$(".cmp-table tbody tr")).length === 6);
check("趋势图有四条折线", (await page.$$("#trend-host polyline")).length === 4);
await page.screenshot({ path: path.join(OUT, "12-compare-full.png"), fullPage: false, clip: undefined });
await page.evaluate(() => document.getElementById("screen-compare").scrollTo(0, 9999));
await sleep(300);
await shot(page, "12-compare-trend.png");

// 6. Settings
await go(page, "#/settings");
await sleep(400);
await shot(page, "13-settings.png");
await page.select('#settings-form select[name="boardSide"]', "left");
await page.select('#settings-form select[name="targetMin"]', "3");
await page.$eval('#settings-form textarea[name="fillers"]', (t) => { t.value = "然后 就是 对吧 那个 我们来看"; });
await page.click('#sens-grid input[name="sens-filler"][value="high"]');
await page.click('#settings-form button[type="submit"]');
await sleep(400);
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("titaojing.settings.v1")));
check("设置保存（板书区左侧 / 3 分钟 / 自定义口头禅 / 灵敏度）", saved.boardSide === "left" && saved.targetMin === 3 && saved.fillers.includes("我们来看") && saved.sens.filler === "high", JSON.stringify(saved).slice(0, 160));

// 7. Feedback
await go(page, "#/feedback");
await sleep(300);
await page.type('#feedback-form textarea[name="description"]', "QA：倒计时后骨骼线正常，测试反馈生成。");
await page.click('#feedback-form button[type="submit"]');
await sleep(1200);
const fbText = await page.$eval("#feedback-text", (t) => t.value);
check("反馈文本含版本、设备、能力信息，且不含视频", /v\d+\.\d+\.\d+/.test(fbText) && /设备：/.test(fbText) && /能力：/.test(fbText) && !/data:image|blob:/.test(fbText), fbText.split("\n").slice(0, 3).join(" | "));
await page.evaluate(() => document.getElementById("screen-feedback").scrollTo(0, 0));
await shot(page, "14-feedback.png");
await page.evaluate(() => document.getElementById("feedback-out").scrollIntoView());
await sleep(200);
await shot(page, "15-feedback-output.png");

// 8. About + activation stub
await go(page, "#/about");
await sleep(300);
await shot(page, "16-about.png");
await page.type("#activate-code", "csb-test-pro");
await page.click("#btn-activate");
await sleep(300);
const lic = await page.$eval("#license-state", (e) => e.textContent);
check("测试激活码切换为正式版（本地桩）", /正式版/.test(lic), lic);
await page.click("#btn-deactivate");
await sleep(200);
check("恢复试用版", /试用版/.test(await page.$eval("#license-state", (e) => e.textContent)));
await page.type("#activate-code", "WRONG-CODE");
await page.click("#btn-activate");
await sleep(200);
check("错误激活码被拒绝", /无效|尚未开通/.test(await page.$eval("#activate-msg", (e) => e.textContent)));

// 9. Print report (PDF)
await go(page, `#/session/sqa3x0001`);
await waitVisible(page, "screen-replay");
await sleep(600);
await page.evaluate(() => { window.print = () => {}; });
await page.click("#btn-print");
await sleep(500);
await page.emulateMediaType("print");
await page.pdf({ path: path.join(OUT, "report-print.pdf"), format: "A4", printBackground: true });
await page.screenshot({ path: path.join(OUT, "17-print-report.png"), fullPage: true });
await page.emulateMediaType("screen");
const prText = await page.$eval("#print-report", (e) => e.textContent);
check("打印页包含诊断与时间线", /试讲小结/.test(prText) && /时间线标记/.test(prText) && /试用版/.test(prText));

// 10. Export history JSON (download behaviour)
await go(page, "#/history");
await sleep(400);
// capture the generated download in-page (headless contexts do not save files)
await page.evaluate(() => {
  window.__dl = null;
  const orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download && this.href.startsWith("blob:")) { const name = this.download; fetch(this.href).then((r) => r.text()).then((t) => { window.__dl = { name, text: t }; }); return; }
    return orig.call(this);
  };
});
await page.click("#btn-export-json");
await page.waitForFunction(() => window.__dl, { timeout: 5000 }).catch(() => {});
const dlr = await page.evaluate(() => window.__dl);
let expOk = false;
if (dlr) { const j = JSON.parse(dlr.text); expOk = j.format === "titaojing-history" && j.sessions.length === 5 && j.sessions.every((x) => !x.hasVideo); fs.writeFileSync(path.join(OUT, "export-sample.json"), JSON.stringify(j, null, 2)); }
check("导出 JSON（不含录像）", expOk, dlr && dlr.name);

// 11. Delete one
page.once("dialog", (d) => d.accept());
await page.click('.hist-item[data-id="sqa1x0001"] [data-act="del"]');
await sleep(300);
await page.click("#modal-actions .btn-mini.danger");
await sleep(600);
check("删除单条记录", (await page.$$eval(".hist-item", (n) => n.length)) === 4);

// 12. Offline reload (SW)
await page.setOfflineMode(true);
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
await sleep(1500);
const offlineOk = await page.$("#btn-demo").then((b) => !!b).catch(() => false);
check("断网后重新打开仍可进入（离线壳）", offlineOk);
await shot(page, "18-offline-cover.png");
await page.setOfflineMode(false);

// 13. Mobile portrait views
const m = await ctx.newPage();
watch(m, "mobile");
await m.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36" });
await m.goto(BASE, { waitUntil: "networkidle0" });
await sleep(700);
await m.screenshot({ path: path.join(OUT, "20-mobile-cover.png") });
await m.evaluate(() => { location.hash = "#/history"; });
await sleep(800);
await m.screenshot({ path: path.join(OUT, "21-mobile-history.png") });
await m.evaluate(() => { location.hash = "#/compare"; });
await sleep(800);
await m.screenshot({ path: path.join(OUT, "22-mobile-compare.png") });
const firstCam = await m.evaluate(async () => { const r = indexedDB.open("titaojing"); return await new Promise((res) => { r.onsuccess = () => { const t = r.result.transaction("sessions").objectStore("sessions").getAll(); t.onsuccess = () => res((t.result.find((s) => s.kind === "camera" && !s.id.startsWith("sqa")) || {}).id); }; }); });
await m.evaluate((id) => { location.hash = `#/session/${id}`; }, firstCam);
await sleep(1500);
await m.screenshot({ path: path.join(OUT, "23-mobile-replay.png") });
await m.evaluate(() => { location.hash = "#/demo"; });
await sleep(20000);
await m.screenshot({ path: path.join(OUT, "24-mobile-demo-live.png") });
await m.evaluate(() => { location.hash = "#/settings"; });
await sleep(600);
await m.screenshot({ path: path.join(OUT, "25-mobile-settings.png") });
await m.close();

// 14. Error screens (simulated)
async function errorPage(name, setup, ua) {
  const p = await ctx.newPage();
  watch(p, name);
  if (ua) await p.setUserAgent(ua);
  await p.evaluateOnNewDocument(setup);
  await p.goto(BASE + "?nosw#/try", { waitUntil: "networkidle0" });
  await sleep(600);
  if (await visible(p, "screen-permission")) { await p.click("#btn-allow-media"); await sleep(1200); }
  const title = await p.$eval("#err-title", (e) => e.textContent).catch(() => "");
  const shown = await visible(p, "screen-error");
  await p.screenshot({ path: path.join(OUT, `30-error-${name}.png`) });
  await p.close();
  return { shown, title };
}
let r = await errorPage("denied", () => { navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" })); });
check("权限被拒：友好错误页", r.shown && /没有获得镜头权限/.test(r.title), r.title);
r = await errorPage("nocamera", () => { navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error("none"), { name: "NotFoundError" })); });
check("没有摄像头：友好错误页", r.shown && /没有找到/.test(r.title), r.title);
r = await errorPage("busy", () => { navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error("busy"), { name: "NotReadableError" })); });
check("摄像头被占用：友好错误页", r.shown && /占用/.test(r.title), r.title);
r = await errorPage("insecure", () => { Object.defineProperty(window, "isSecureContext", { value: false }); });
check("非 https：友好错误页", r.shown && /https/.test(r.title), r.title);
r = await errorPage("wechat", () => { Object.defineProperty(navigator, "mediaDevices", { value: undefined }); }, "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.47");
check("微信内置浏览器：引导用浏览器打开", r.shown && /微信/.test(r.title), r.title);

// file:// warning
const f = await ctx.newPage();
watch(f, "file");
await f.goto("file:///workspace/titaojing/dist/index.html", { waitUntil: "load" }).catch(() => {});
await sleep(800);
check("file:// 打开时显示提示条", await f.$eval("#file-warning", (e) => !e.hidden).catch(() => false));
await f.screenshot({ path: path.join(OUT, "31-file-protocol.png") });
await f.evaluate(() => { location.hash = "#/try"; });
await sleep(600);
check("file:// 下点试讲 → 说明页", /网址打开/.test(await f.$eval("#err-title", (e) => e.textContent).catch(() => "")));
await f.close();

await browser.close();

// file:// pages legitimately fail some requests; only flag http failures
results.failed = results.failed.filter((x) => !x.includes("[file]"));
results.external = results.external.filter((x) => !x.startsWith("[file] file://"));
results.errors = results.errors.filter((x) => !x.startsWith("[file]"));
const failedChecks = results.checks.filter((c) => !c.ok);
results.summary = { total: results.checks.length, passed: results.checks.length - failedChecks.length, failed: failedChecks.length, consoleErrors: results.errors.length, externalRequests: results.external.length, failedRequests: results.failed.length };
fs.writeFileSync(path.join(OUT, "qa-results.json"), JSON.stringify(results, null, 2));
console.log("\nSUMMARY", JSON.stringify(results.summary));
if (results.errors.length) console.log("ERRORS:\n" + results.errors.join("\n"));
if (results.external.length) console.log("EXTERNAL:\n" + results.external.join("\n"));
if (results.failed.length) console.log("FAILED REQ:\n" + results.failed.join("\n"));
process.exit(failedChecks.length || results.errors.length || results.external.length ? 2 : 0);
