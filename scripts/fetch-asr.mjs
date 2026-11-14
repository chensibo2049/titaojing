#!/usr/bin/env node
/**
 * 下载本机中文识别资源到 assets/asr/（默认不执行；体积大，CI 也不跑）。
 *
 * 计划文件（以 sherpa-onnx 官方发布为准，接入时再锁定文件名和 sha256）：
 *   - sherpa-onnx WASM glue
 *   - SenseVoice 或 zipformer 流式中文量化模型
 *
 * 用法：
 *   npm run fetch-asr
 *   ASR_MIRROR=https://你的-cos-域名/asr/ npm run fetch-asr
 *
 * 当前版本：只把意图和校验方式写清楚，并生成一份「尚未接入」的清单，避免误报可用。
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const dest = path.join(root, "assets/asr");
fs.mkdirSync(dest, { recursive: true });

const planned = {
  engine: "sherpa-onnx",
  status: "scaffold",
  note: "v1.0.1 尚未开始下载或接入模型。确认文件名、许可证和 sha256 后再实现下载。国内请把文件放到对象存储并用 ASR_MIRROR 指向该目录。详见 docs/ASR.md。",
  mirror: process.env.ASR_MIRROR || "",
  files: [],
};
fs.writeFileSync(path.join(dest, "manifest.json"), JSON.stringify(planned, null, 2) + "\n");
console.log("已写入 assets/asr/manifest.json（status=scaffold，不会被 asr.js 当成可用引擎）。");
console.log("真正下载将在锁定模型版本后实现。请不要把未校验的大文件提交进仓库。");
