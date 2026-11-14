#!/usr/bin/env node
/** v1.1.0 静态检查与口头禅报告单元测试（不启动浏览器）。 */
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
check("package.json 版本为 1.1.0", pkg.version === "1.1.0", pkg.version);

const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
check("CHANGELOG 含 v1.1.0", /## v1\.1\.0/.test(changelog));

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
check("ASR 文档写明本机识别尚未接入", /尚未.*接入|仍未真正接入/.test(asr));

const sherpa = fs.readFileSync(path.join(root, "src/asr-sherpa.js"), "utf8");
check("startSherpa 不会在检测到文件时假装可用", /不会开始本机转写|尚未完成接入|还没有真正跑起来/.test(sherpa));

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
