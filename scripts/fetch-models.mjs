// 准备 MediaPipe 资源：npm run fetch-models（npm install / npm run build 时会自动运行）
//  1) WASM：从 node_modules/@mediapipe/tasks-vision/wasm 复制到 assets/mediapipe/wasm/（来自 npm，国内可用 npmmirror 镜像）
//  2) 模型：仓库已自带 assets/mediapipe/models/*.task；缺失或校验失败时才下载。
//     默认从 Google 官方存储下载（国内可能无法访问），可用 MODEL_BASE_URL 指向自己的镜像目录，
//     例如 MODEL_BASE_URL=https://你的-cos-域名/mediapipe-models/  （目录下放同名 .task 文件）
//  所有文件都会做 sha256 校验，和 assets/mediapipe/manifest.json 不一致就报错。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const mf = JSON.parse(fs.readFileSync(path.join(root, "assets/mediapipe/manifest.json"), "utf8"));
const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const ok = (file, want) => fs.existsSync(file) && sha(file) === want;
let problems = 0;

// WASM
const wasmSrc = path.join(root, "node_modules/@mediapipe/tasks-vision/wasm");
const wasmDst = path.join(root, "assets/mediapipe/wasm");
fs.mkdirSync(wasmDst, { recursive: true });
let pkgVer = null;
try { pkgVer = JSON.parse(fs.readFileSync(path.join(root, "node_modules/@mediapipe/tasks-vision/package.json"), "utf8")).version; } catch (_) {}
if (pkgVer && pkgVer !== mf.tasksVisionVersion) console.warn(`! @mediapipe/tasks-vision 版本是 ${pkgVer}，清单要求 ${mf.tasksVisionVersion}`);
for (const [name, want] of Object.entries(mf.wasm)) {
  const dst = path.join(wasmDst, name);
  if (ok(dst, want)) continue;
  const src = path.join(wasmSrc, name);
  if (!fs.existsSync(src)) { console.error(`✗ 缺少 ${name}：请先运行 npm install（国内可先 npm config set registry https://registry.npmmirror.com）`); problems++; continue; }
  fs.copyFileSync(src, dst);
  if (!ok(dst, want)) { console.error(`✗ ${name} 校验不一致（npm 包版本不对？）`); problems++; }
  else console.log(`✓ 已复制 ${name}`);
}

// Models
const modelDst = path.join(root, "assets/mediapipe/models");
fs.mkdirSync(modelDst, { recursive: true });
const base = process.env.MODEL_BASE_URL ? process.env.MODEL_BASE_URL.replace(/\/?$/, "/") : null;
for (const [name, info] of Object.entries(mf.models)) {
  const dst = path.join(modelDst, name);
  if (ok(dst, info.sha256)) continue;
  const url = base ? base + name : info.url;
  console.log(`… 下载 ${name} ← ${url}`);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const got = crypto.createHash("sha256").update(buf).digest("hex");
    if (got !== info.sha256) throw new Error(`sha256 不一致：${got}`);
    fs.writeFileSync(dst, buf);
    console.log(`✓ ${name}（${(buf.length / 1048576).toFixed(1)} MB）`);
  } catch (e) {
    console.error(`✗ ${name} 下载失败：${e.message}\n  国内网络可设置 MODEL_BASE_URL 指向镜像，或从 Release 附件手动放到 assets/mediapipe/models/`);
    problems++;
  }
}

if (problems) { console.error(`\nMediaPipe 资源有 ${problems} 个问题，详见 README「模型与 WASM」。`); process.exit(1); }
console.log("MediaPipe 资源就绪（sha256 已校验）。");
