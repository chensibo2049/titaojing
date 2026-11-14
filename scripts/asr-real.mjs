// 本机听写真机测试（较重，不在每次 CI 里跑）：node scripts/asr-real.mjs
//   需先 npm run build。用无头 Chrome 把一段中文 WAV 当作麦克风输入（--use-file-for-fake-audio-capture），
//   1) 在「设置」里点「下载本机听写」，真实地从镜像下载中文模型并校验；
//   2) 在站位页点「试一下听写」，看本机听写写出的字；
//   3) 用空格开始、结束一次试讲，检查回放里的转写包含预期的字。
// 环境变量：
//   ASR_WAV      输入音频（WAV）。不填则下载 k2-fsa 公开测试音频 test_wavs/0.wav（ModelScope）。
//   ASR_EXPECT   转写里必须出现的字，逗号分隔。默认与上面的测试音频对应：研究,感兴趣
//   ASR_LIVE_MS  试讲时长，默认 25000
//   CHROME_PATH  Chrome/Chromium 路径
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
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + String(detail).slice(0, 400) : ""}`); };

if (!fs.existsSync(path.join(root, "dist/index.html"))) { console.error("没有 dist/，请先 npm run build"); process.exit(2); }

// 输入音频：在末尾补 2 秒静音，让最后一句能被切出来
let wavPath = process.env.ASR_WAV;
if (!wavPath) {
  wavPath = path.join(OUT, "asr-test-0.wav");
  if (!fs.existsSync(wavPath)) {
    const url = "https://www.modelscope.cn/models/csukuangfj/sherpa-onnx-zipformer-ctc-small-zh-int8-2025-07-16/resolve/master/test_wavs/0.wav";
    const r = await fetch(url);
    if (!r.ok) { console.error("下载测试音频失败", r.status); process.exit(2); }
    fs.writeFileSync(wavPath, Buffer.from(await r.arrayBuffer()));
  }
}
const expect = (process.env.ASR_EXPECT || (process.env.ASR_WAV ? "" : "研究,感兴趣")).split(",").map((s) => s.trim()).filter(Boolean);
function padWav(src, dst, padSec = 2) {
  const w = fs.readFileSync(src);
  let o = 12, fmt = null;
  while (o + 8 <= w.length) {
    const id = w.toString("ascii", o, o + 4), sz = w.readUInt32LE(o + 4);
    if (id === "fmt ") fmt = { ch: w.readUInt16LE(o + 10), sr: w.readUInt32LE(o + 12), bits: w.readUInt16LE(o + 22) };
    if (id === "data") {
      const data = w.subarray(o + 8, o + 8 + sz);
      const pad = Buffer.alloc(Math.round(padSec * fmt.sr) * fmt.ch * (fmt.bits / 8));
      const body = Buffer.concat([pad.subarray(0, pad.length / 2), data, pad]);
      const h = Buffer.alloc(44);
      h.write("RIFF", 0); h.writeUInt32LE(36 + body.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
      h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(fmt.ch, 22); h.writeUInt32LE(fmt.sr, 24);
      h.writeUInt32LE(fmt.sr * fmt.ch * fmt.bits / 8, 28); h.writeUInt16LE(fmt.ch * fmt.bits / 8, 32); h.writeUInt16LE(fmt.bits, 34);
      h.write("data", 36); h.writeUInt32LE(body.length, 40);
      fs.writeFileSync(dst, Buffer.concat([h, body]));
      return { ...fmt, sec: data.length / (fmt.sr * fmt.ch * fmt.bits / 8) };
    }
    o += 8 + sz + (sz % 2);
  }
  throw new Error("不是 PCM WAV：" + src);
}
const fakeWav = path.join(OUT, "asr-fake-mic.wav");
const info = padWav(wavPath, fakeWav);
console.log(`输入音频 ${wavPath}（${info.sr} Hz，${info.sec.toFixed(1)} 秒，循环播放）；预期出现：${expect.join("、") || "（未指定）"}`);

const server = spawn(process.platform === "win32" ? "python" : "python3", [path.join(root, "scripts/serve.py"), path.join(root, "dist"), process.env.SMOKE_PORT || "8878"], { env: { ...process.env, QUIET: "1", PYTHONUNBUFFERED: "1" } });
const BASE = await new Promise((resolve, reject) => {
  let buf = "";
  const to = setTimeout(() => reject(new Error("server did not start: " + buf)), 15000);
  server.stdout.on("data", (d) => { buf += d; const m = buf.match(/(http:\/\/127\.0\.0\.1:\d+\/)/); if (m) { clearTimeout(to); resolve(m[1]); } });
  server.stderr.on("data", (d) => { buf += d; });
  server.on("exit", (c) => reject(new Error(`server exited ${c}: ${buf}`)));
});
const chrome = findChrome();
if (!chrome) { console.error("找不到 Chrome，请设置 CHROME_PATH"); server.kill(); process.exit(2); }
const browser = await puppeteer.launch({
  executablePath: chrome, headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${fakeWav}`, "--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader"],
  defaultViewport: { width: 1400, height: 900 },
});
const errors = [];
const report = {};
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  const failedReq = [];
  page.on("requestfailed", (r) => failedReq.push(`${r.failure() && r.failure().errorText} ${r.url().slice(0, 140)}`));
  page.on("console", (m) => { if (process.env.ASR_VERBOSE) console.log("  [page]", m.text()); });
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem("titaojing.consent.v1", JSON.stringify({ termsAccepted: true, experience: false, termsAcceptedAt: "2000-01-01T00:00:00.000Z" })); } catch (_) {}
  });
  const waitVisible = (id, timeout = 15000) => page.waitForFunction((i) => { const e = document.getElementById(i); return e && !e.hidden; }, { timeout }, id);

  // 1) 下载
  await page.goto(BASE + "?debug=1#/settings", { waitUntil: "networkidle0", timeout: 30000 });
  await waitVisible("screen-settings");
  await page.waitForSelector("#local-asr-box .la-get, #local-asr-box .la-del", { timeout: 15000 });
  const t0 = Date.now();
  if (await page.$("#local-asr-box .la-get")) {
    await page.click("#local-asr-box .la-get");
    let last = "";
    const dl = await page.waitForFunction(() => {
      const t = document.getElementById("local-asr-box").textContent;
      return /已下载并校验|下载没有完成|已就绪/.test(t) ? t : false;
    }, { timeout: Number(process.env.ASR_DL_MS || 900000), polling: 1000 }).then((h) => h.jsonValue()).catch(async () => (await page.$eval("#local-asr-box", (e) => e.textContent)));
    last = String(dl).replace(/\s+/g, " ").trim();
    report.download = { text: last, sec: Math.round((Date.now() - t0) / 1000) };
    report.download.from = await page.evaluate(async () => {
      for (const k of await caches.keys()) {
        if (!k.startsWith("titaojing-asr-model-")) continue;
        const c = await caches.open(k);
        for (const r of await c.keys()) if (r.url.endsWith("done.json")) return (await (await c.match(r)).json());
      }
      return null;
    }).catch(() => null);
    check("下载并校验本机听写模型", /已下载并校验|已就绪/.test(last), `${report.download.sec}s 来源=${JSON.stringify(report.download.from && report.download.from.from)} 跳过=${JSON.stringify(report.download.from && report.download.from.skipped)} ${last}`);
    if (failedReq.length) console.log(`下载期间失败的请求 ${failedReq.length} 个（分段重试/取消属正常）：\n  ` + [...new Set(failedReq)].slice(0, 6).join("\n  "));
  } else {
    report.download = { text: "已缓存", sec: 0 };
    check("本机听写模型已在缓存中", true);
  }

  // 2) 站位页「试一下听写」
  await page.goto(BASE + "?debug=1#/try", { waitUntil: "domcontentloaded" });
  await waitVisible("screen-permission");
  await page.click("#btn-allow-media");
  await waitVisible("screen-coach", 15000);
  await page.waitForFunction(() => /已就绪|没能加载|太慢/.test(document.getElementById("mp-label").textContent), { timeout: 90000 }).catch(() => {});
  const label = await page.$eval("#coach-asr-state", (e) => e.textContent);
  check("站位页显示本机听写", /本机听写/.test(label), label);
  const tp = Date.now();
  await page.click("#btn-speech-preflight");
  await page.waitForFunction(() => {
    const t = document.getElementById("speech-preflight-result").textContent;
    return /听到了|没有听到|失败|超时|没能/.test(t);
  }, { timeout: 120000, polling: 500 }).catch(() => {});
  const pre = await page.$eval("#speech-preflight-result", (e) => e.textContent);
  report.preflight = { text: pre, sec: Math.round((Date.now() - tp) / 1000) };
  check("试一下听写（本机）写出了字", /本机听写听到了/.test(pre), pre);

  // 3) 试讲
  await page.keyboard.press("Space");
  await waitVisible("screen-live");
  await sleep(Number(process.env.ASR_LIVE_MS || 25000));
  console.log("workers:", page.workers().map((w) => w.url().split("/").pop()).join(", ") || "无");
  const liveLabel = await page.$eval("#live-asr-state", (e) => e.textContent);
  const bannerText = await page.$eval("#speech-banner", (e) => (e.hidden ? "" : e.textContent)).catch(() => "");
  if (bannerText) console.log("试讲横幅：", bannerText);
  check("试讲中显示本机听写", /本机听写/.test(liveLabel), liveLabel);
  await page.waitForFunction(() => !document.getElementById("btn-stop").disabled, { timeout: 30000 }).catch(() => {});
  await page.keyboard.press("Space");
  await waitVisible("screen-replay", 20000);
  await sleep(1000);
  const tx = await page.$eval("#transcript-list", (e) => e.innerText).catch(() => "");
  report.transcript = tx;
  const flat = tx.replace(/\s+/g, "");
  check("回放转写非空", flat.length > 4, tx.slice(0, 400));
  for (const w of expect) check(`转写包含「${w}」`, flat.includes(w));
  const filler = await page.$eval("#filler-report", (e) => e.innerText).catch(() => "");
  report.filler = filler.slice(0, 300);
  console.log("口头禅卡片：", filler.replace(/\s+/g, " ").slice(0, 300));
  await page.screenshot({ path: path.join(OUT, "asr-real-replay.png") });
  check("页面无未捕获错误", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("本机听写测试运行", false, e.stack || e.message);
} finally {
  await browser.close();
  server.kill();
}
fs.writeFileSync(path.join(OUT, "asr-real.json"), JSON.stringify(report, null, 2));
console.log(failed ? `\n${failed} 项失败` : "\n本机听写真机测试全部通过");
process.exit(failed ? 1 : 0);
