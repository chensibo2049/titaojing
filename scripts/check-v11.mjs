#!/usr/bin/env node
/** 静态检查（v1.2.0）与口头禅报告单元测试（不启动浏览器）。 */
import fs from "node:fs";
import path from "node:path";
import * as esbuild from "esbuild";
import { pathToFileURL } from "node:url";
import os from "node:os";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + String(detail).slice(0, 200) : ""}`);
};

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
check("package.json 版本为 1.2.0", pkg.version === "1.2.0", pkg.version);

const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
check("CHANGELOG 含 v1.2.0 与 v1.1.0", /## v1\.2\.0/.test(changelog) && /## v1\.1\.0/.test(changelog));
const notesSrc = fs.readFileSync(path.join(root, "src/changelog.js"), "utf8");
check("应用内更新说明含 1.2.0", /version: "1\.2\.0"/.test(notesSrc));

const config = fs.readFileSync(path.join(root, "config.js"), "utf8");
check("保留测试激活码 CSB-TEST-PRO", /CSB-TEST-PRO/.test(config));
check("authEndpoint 默认为空", /authEndpoint:\s*""/.test(config));

const banned = ["赋能", "大模型", "智能诊断"];
const scanDirs = ["src", "docs", "landing", "index.html", "README.md", "CHANGELOG.md", "config.js"];
const hits = [];
const skip = new Set(["TRAINING.md"]);
const walk = (p) => {
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    for (const e of fs.readdirSync(p)) {
      if (e === "app.bundle.js" || e.startsWith(".")) continue;
      if (skip.has(e)) continue;
      walk(path.join(p, e));
    }
    return;
  }
  if (!/\.(js|md|html|css)$/.test(p)) return;
  const text = fs.readFileSync(p, "utf8");
  for (const w of banned) if (text.includes(w)) hits.push(`${path.relative(root, p)}:${w}`);
};
for (const d of scanDirs) walk(path.join(root, d));
check("用户可见文案不含禁止用语", hits.length === 0, hits.join(", "));

const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
check("页面含「试一下听写」", index.includes("试一下听写"));
check("页面含我的档案", index.includes("我的档案") && index.includes("screen-profile"));
check("页面含口头禅与改法", index.includes("口头禅与改法"));
check("知情同意写明时长上限", /最长 22 分钟/.test(index) && /练习 1–5 分钟/.test(index));

const privacy = fs.readFileSync(path.join(root, "docs/PRIVACY.md"), "utf8");
check("隐私说明含时长上限", /22 分钟/.test(privacy));

const asr = fs.readFileSync(path.join(root, "docs/ASR.md"), "utf8");
check("ASR 文档写明本机听写的模型、镜像与限制", /Paraformer/.test(asr) && /modelscope\.cn/.test(asr) && /限制/.test(asr) && /只识别普通话/.test(asr));

// 本机听写：引擎文件与清单一致；模型不进 git；只有缓存里真有模型才算可用
const crypto = await import("node:crypto");
const mf = JSON.parse(fs.readFileSync(path.join(root, "assets/asr/manifest.json"), "utf8"));
check("ASR 清单为 ready 且列出模型 sha256", mf.status === "ready" && mf.model && mf.model.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256) && f.bytes > 0));
check("ASR 模型镜像首选国内可达且允许跨域的 ModelScope", /modelscope\.cn/.test(mf.model.mirrors[0].base));
const engMismatch = mf.engineFiles.files.filter((f) => {
  const p = path.join(root, mf.engineFiles.dir, f.name);
  if (!fs.existsSync(p)) return true;
  const b = fs.readFileSync(p);
  return b.length !== f.bytes || crypto.createHash("sha256").update(b).digest("hex") !== f.sha256;
});
check("ASR 引擎文件与清单一致（大小与 sha256）", engMismatch.length === 0, engMismatch.map((f) => f.name).join(", "));
const glue = fs.readFileSync(path.join(root, "assets/asr/engine/sherpa-onnx-wasm-main-vad-asr.js"), "utf8");
check("引擎 glue 不会自动下载预载数据包", !/REMOTE_PACKAGE_BASE/.test(glue));
check("worker 存在并加载 Silero VAD", /silero_vad\.onnx/.test(fs.readFileSync(path.join(root, "assets/asr/engine/asr-worker.js"), "utf8")));
const bigTracked = mf.model.files.filter((f) => fs.existsSync(path.join(root, "assets/asr", f.name)) || fs.existsSync(path.join(root, "assets/asr/engine", f.name)));
check("中文模型没有放进仓库目录", bigTracked.length === 0, bigTracked.map((f) => f.name).join(", "));
const sherpa = fs.readFileSync(path.join(root, "src/asr-sherpa.js"), "utf8");
check("本机听写只在模型已缓存时标为可用", /st\.cached\s*\?\s*\{ ok: true/.test(sherpa) && /modelCacheRefs/.test(sherpa));
const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
check("Service Worker 升级时不删除已下载的听写模型", /titaojing-asr-model-/.test(sw));
const settingsSrc = fs.readFileSync(path.join(root, "src/settings.js"), "utf8");
check("设置含流畅度（自动 / 流畅优先 / 精细优先）", /perfMode/.test(settingsSrc) && index.includes("流畅优先") && index.includes("精细优先"));

const speech = fs.readFileSync(path.join(root, "src/speech.js"), "utf8");
check("network 错误说明不是电脑没网", /不是你没联网/.test(speech) && !/语音识别需要联网（浏览器自带服务）\.当前听不到口头禅/.test(speech));

// Unit-test filler report via a temporary ESM bundle
const tmp = path.join(os.tmpdir(), "titaojing-fillers-test.mjs");
await esbuild.build({
  entryPoints: [path.join(root, "src/fillers.js")],
  bundle: true,
  format: "esm",
  outfile: tmp,
  logLevel: "silent",
});
const { buildFillerReport, fillerNextAdvice } = await import(pathToFileURL(tmp).href);

const failedSpeech = buildFillerReport({
  kind: "camera",
  duration: 120,
  events: [],
  transcript: [],
  speechAvailable: false,
  speechHeard: false,
});
check("听写失败时口头禅报告为无法统计", failedSpeech.ok === false && /没有可用的听写/.test(failedSpeech.reason), failedSpeech.reason);

const withWords = buildFillerReport({
  kind: "camera",
  duration: 60,
  speechAvailable: true,
  speechHeard: true,
  events: [
    { type: "filler", word: "然后", t: 3 },
    { type: "filler", word: "然后", t: 10 },
    { type: "filler", word: "然后", t: 20 },
    { type: "filler", word: "就是说", t: 15 },
  ],
  transcript: [{ t: 3, text: "然后我们来看" }],
});
check("能统计词频和每分钟次数", withWords.ok && withWords.total === 4 && withWords.top.word === "然后" && withWords.perMin === 4, JSON.stringify({ total: withWords.total, perMin: withWords.perMin, top: withWords.top }));
check("「然后」给出停顿改法", withWords.methods.some((m) => /停顿/.test(m.title + m.body) && /然后/.test(m.title + m.body)));
check("「就是说」给出过渡改法", withWords.methods.some((m) => /也就是|具体来说/.test(m.body)));
const next = fillerNextAdvice(withWords);
check("诊断用建议与报告一致", /停顿|然后/.test(next), next);

try { fs.unlinkSync(tmp); } catch (_) {}

console.log(failed ? `\n${failed} 项失败` : "\n检查全部通过");
process.exit(failed ? 1 : 0);
