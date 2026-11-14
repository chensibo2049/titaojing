#!/usr/bin/env node
/**
 * 下载本机中文识别资源到 assets/asr/（默认不在 npm install / CI 中执行；体积大）。
 *
 * 计划文件（以 sherpa-onnx 官方发布为准，真正接入时再锁定文件名和 sha256）：
 *   - sherpa-onnx WASM glue / wasm
 *   - SenseVoice 或 zipformer 流式中文量化模型
 *
 * 用法：
 *   npm run fetch-asr
 *   ASR_MIRROR=https://你的-cos-域名/asr/ npm run fetch-asr
 *
 * 当前版本：不下载大文件，只写入一份「尚未接入」的清单，避免产品把本机听写显示成可用。
 * 若设置了 ASR_URLS（逗号分隔的文件名）并且 ASR_MIRROR 指向已托管的目录，则尝试下载并校验，
 * 但仍不会把 status 写成 ready——接入完成前，asr-sherpa.js 不会开始转写。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const dest = path.join(root, "assets/asr");
fs.mkdirSync(dest, { recursive: true });

const mirror = (process.env.ASR_MIRROR || "").replace(/\/?$/, "/");
const plannedNames = (process.env.ASR_URLS || "").split(",").map((s) => s.trim()).filter(Boolean);

const downloaded = [];
if (mirror && plannedNames.length) {
  for (const name of plannedNames) {
    const url = mirror + name;
    const out = path.join(dest, path.basename(name));
    try {
      console.log(`… 下载 ${name} ← ${url}`);
      const res = await fetch(url, { signal: AbortSignal.timeout(180000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(out, buf);
      const sha = crypto.createHash("sha256").update(buf).digest("hex");
      downloaded.push({ file: "assets/asr/" + path.basename(name), bytes: buf.length, sha256: sha });
      console.log(`✓ ${name}（${(buf.length / 1048576).toFixed(1)} MB）sha256=${sha}`);
    } catch (e) {
      console.warn(`✗ ${name}：${e.message}（本机听写仍不会被标成可用）`);
    }
  }
}

const planned = {
  engine: "sherpa-onnx",
  status: "scaffold",
  note: "v1.1.0 尚未完成 WASM 接入，不会把本机听写标成可用。确认文件名、许可证和 sha256 并完成 startSherpa 之后，再把 status 改为 ready。不要把未校验的大文件提交进仓库。国内请把文件放到对象存储并用 ASR_MIRROR 指向该目录。详见 docs/ASR.md。",
  mirror: process.env.ASR_MIRROR || "",
  files: downloaded.map((d) => d.file),
  downloaded,
};
fs.writeFileSync(path.join(dest, "manifest.json"), JSON.stringify(planned, null, 2) + "\n");
console.log("已写入 assets/asr/manifest.json（status=scaffold，不会被 asr.js 当成可用引擎）。");
if (!downloaded.length) console.log("未下载模型文件。设置 ASR_MIRROR 与 ASR_URLS 后可按需拉取；CI 默认不跑此脚本。");
