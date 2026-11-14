#!/usr/bin/env node
/**
 * 把本机听写的中文模型下载到 assets/asr/model/ 并校验 sha256（不进 git）。
 * 用途：自建镜像（上传到自己的对象存储后，在 config.js 填 asrModelBase），或离线部署。
 * 浏览器里的用户不需要运行它：页面会自己从镜像下载并缓存。
 *
 *   npm run fetch-asr
 *   ASR_MIRROR=https://你的镜像/目录/ npm run fetch-asr   # 优先从这里下载
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const mf = JSON.parse(fs.readFileSync(path.join(root, "assets/asr/manifest.json"), "utf8"));
const dest = path.join(root, "assets/asr/model");
fs.mkdirSync(dest, { recursive: true });
const mirrors = [];
if (process.env.ASR_MIRROR) mirrors.push({ name: "ASR_MIRROR", base: process.env.ASR_MIRROR.replace(/\/?$/, "/") });
mirrors.push(...mf.model.mirrors);

let failed = 0;
for (const f of mf.model.files) {
  const out = path.join(dest, f.name);
  if (fs.existsSync(out) && crypto.createHash("sha256").update(fs.readFileSync(out)).digest("hex") === f.sha256) {
    console.log(`✓ ${f.name} 已存在且校验通过`);
    continue;
  }
  let ok = false;
  for (const m of mirrors) {
    try {
      console.log(`… ${f.name} ← ${m.name}`);
      const res = await fetch(m.base + f.name, { signal: AbortSignal.timeout(600000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const sha = crypto.createHash("sha256").update(buf).digest("hex");
      if (sha !== f.sha256) throw new Error(`sha256 不符：${sha}`);
      fs.writeFileSync(out, buf);
      console.log(`✓ ${f.name}（${(buf.length / 1048576).toFixed(1)} MB）来自 ${m.name}`);
      ok = true;
      break;
    } catch (e) {
      console.warn(`  ✗ ${m.name}：${e.message}`);
    }
  }
  if (!ok) failed++;
}
console.log(failed ? `\n${failed} 个文件没能下载` : `\n模型在 ${path.relative(root, dest)}/，可上传到自己的镜像目录。`);
process.exit(failed ? 1 : 0);
