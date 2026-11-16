#!/usr/bin/env node
/** 只读静态验收：node scripts/检查无3D构建.mjs [dist目录]；不构建、不下载、不启动浏览器。 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (base, name) => fs.readFileSync(path.join(base, name), "utf8");
const slash = (name) => name.split(path.sep).join("/");
const hash = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const sceneCode = /character-scene|\bsim3d\b|\b(?:ensure|dispose)Presenter3d\b|\bpresenter3d\b|\b(?:mountPresenterScene|mountClassroomScene|canUse3D)\b/i;
const sceneUi = /\bsim3d\b|sim-stage3d|stage-3d|(?:cover|live|replay)-3d|is-3d-overlay/i;
const threeImport = /(?:from\s*|import\s*(?:\(\s*)?|require\s*\(\s*)["']three(?:[\/"'])/;
// 允许迁移代码删除历史字段，但不允许仍读取、默认启用或保存 sim3d。
const withoutLegacySettingDelete = (code) => code.replace(/\bdelete\s+\w+(?:\.sim3d|\[\s*["']sim3d["']\s*\])\s*;?/g, "");
const threeFile = (name) => /(?:^|\/)(?:characters|draco|three)(?:\/|$)|character-scene|\.(?:glb|gltf|fbx|obj|mtl|blend|dae|drc|ktx2?)$|(?:^|[\/_-])3d(?:[\/_.-]|$)/i.test(name);

// 此函数也供 check-v11 使用：不依赖 dist 是否已重建，不加载应用代码。
export async function checkNo3dSource(base, check) {
  const pkg = JSON.parse(read(base, "package.json"));
  const dependencyGroups = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
  const deps = dependencyGroups.flatMap((key) => Object.keys(pkg[key] || {}));
  const threeDeps = deps.filter((name) => /^(?:three|@types\/three|@react-three\/.*)$/.test(name));
  check("无 three 及其装饰性 3D 依赖声明", threeDeps.length === 0, threeDeps.join(", "));
  check("保留真实 MediaPipe Tasks Vision 依赖", deps.includes("@mediapipe/tasks-vision"));

  const main = read(base, "src/main.js");
  const runtimeNames = ["src/main.js", "src/classroom-sim-ui.js", "src/settings.js", "src/pages.js", "config.js"];
  // 去掉注释后检查运行代码；历史说明或「已移除 3D」文案不算运行依赖。
  const runtime = await Promise.all(runtimeNames.map(async (name) => ({ name, code: (await esbuild.transform(read(base, name), { loader: "js", legalComments: "none" })).code })));
  const dynamic = runtime.filter(({ code }) => sceneCode.test(withoutLegacySettingDelete(code)) || threeImport.test(code));
  check("运行路径无动态 character-scene、three 或 presenter3d", dynamic.length === 0, dynamic.map(({ name }) => name).join(", "));
  const uiNames = ["index.html", "assets/app.css", "src/settings.js", "config.js", "src/classroom-sim-ui.js"];
  const uiHits = uiNames.filter((name) => sceneUi.test(withoutLegacySettingDelete(read(base, name))));
  check("UI 与配置无 sim3d 开关、3D 容器和样式", uiHits.length === 0, uiHits.join(", "));
  const build = (await esbuild.transform(read(base, "scripts/build.mjs"), { loader: "js", legalComments: "none" })).code;
  check("构建不打包 character-scene、不复制 GLB 或 Draco", !/character-scene|assets\/characters|assets\/vendor\/draco|\.glb\b|\.gltf\b/i.test(build));
  check("main 保留 teacher.js 的 2D renderScene 导入与演示/回放调用", /import\s*\{[^}]*\brenderScene\b[^}]*\}\s*from\s*["']\.\/teacher\.js["']/.test(main) && (main.match(/renderScene\s*\(\s*scene\.getContext\(["']2d["']\)/g) || []).length >= 2);

  const vision = read(base, "src/vision.js");
  check("MediaPipe 保留姿态、面部、手部实例与 VIDEO 推理", ["Pose", "Face", "Hand"].every((kind) => new RegExp(`${kind}Landmarker\\.createFromOptions\\(`).test(vision)) && ["pose", "face", "hands"].every((kind) => new RegExp(`${kind}\\.detectForVideo\\(video,\\s*ts\\)`).test(vision)) && /FilesetResolver\.forVisionTasks\(/.test(vision));
  check("main 真实摄像头识别结果仍进入视线、教态与记录分析", /initVision\s*\(/.test(main) && /detectVideo\(video,\s*now,/.test(main) && /extractGaze\(det\.pose,\s*det\.face,\s*det\.matrix\)/.test(main) && /extractPosture\(det\.pose,\s*session\._hist,\s*det\.hands\)/.test(main) && /tickFrame\(session,\s*t,\s*det\.pose,\s*det\.face,\s*gaze,\s*posture,\s*det\.hands\)/.test(main));

  // 只在内存打包：检查真正可达的依赖图，不执行 main 或 MediaPipe。
  try {
    const bundled = await esbuild.build({ absWorkingDir: base, entryPoints: ["src/main.js"], bundle: true, write: false, metafile: true, format: "iife", logLevel: "silent" });
    const inputs = Object.keys(bundled.metafile.inputs).map(slash);
    const unwanted = inputs.filter((name) => /(?:^|\/)node_modules\/(?:three|@react-three)(?:\/|$)|character-scene/i.test(name));
    check("main 实际依赖图无 three/character-scene", unwanted.length === 0, unwanted.join(", "));
    check("main 实际依赖图保留 2D teacher 与真实 vision", ["src/teacher.js", "src/vision.js"].every((name) => inputs.includes(name)) && inputs.some((name) => name.includes("@mediapipe/tasks-vision/")));
  } catch (error) {
    check("main 可静态打包（不落盘、不启动应用）", false, error.message);
  }
}

// 只收集页面实际引用的站内媒体，不固定分享图文件名。
function referencedMedia(base, dist) {
  const allowed = new Set();
  const home = new URL(JSON.parse(read(base, "package.json")).homepage);
  for (const name of ["index.html", "landing/index.html", "assets/app.css", "landing/styles.css", "manifest.webmanifest"]) {
    const file = path.join(dist, name);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    const page = new URL(name, home);
    for (const match of text.matchAll(/(?:\b(?:src|href|poster|content)\s*=\s*["']|["'](?:image|src)["']\s*:\s*["']|url\(\s*["']?)([^"'()\s<>,]+\.(?:png|jpe?g|webp|gif|svg|avif|ico|mp4|webm)(?:[?#][^"'()\s<>,]*)?)(?=["')\s>])/gi)) {
      try {
        const url = new URL(match[1], page);
        if (url.origin === home.origin && url.pathname.startsWith(home.pathname)) allowed.add(decodeURIComponent(url.pathname.slice(home.pathname.length)));
      } catch (_) { /* 非 URL，不加入发布许可 */ }
    }
  }
  return allowed;
}

export function checkNo3dDist(base, dist, check) {
  let entries;
  try {
    if (!fs.lstatSync(dist).isDirectory() || fs.lstatSync(dist).isSymbolicLink()) throw new Error("dist 必须是普通目录");
    entries = [];
    const visit = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const name = slash(path.relative(dist, full));
        if (entry.isSymbolicLink()) { entries.push({ name, type: "symlink" }); continue; }
        if (entry.isDirectory()) { entries.push({ name, type: "directory" }); visit(full); }
        else entries.push({ name, type: entry.isFile() ? "file" : "special" });
      }
    };
    visit(dist);
  } catch (error) {
    check("dist 存在且可递归读取（请先由构建代理生成）", false, error.message);
    return;
  }
  const files = entries.filter(({ type }) => type === "file").map(({ name }) => name);
  const bad3d = entries.filter(({ name }) => threeFile(name));
  check("dist 递归无 3D 模型、character-scene、Draco 与 3D 宣传媒体", bad3d.length === 0, bad3d.map(({ name }) => name).join(", "));
  const links = entries.filter(({ type }) => type === "symlink" || type === "special");
  check("dist 无符号链接或特殊文件泄漏", links.length === 0, links.map(({ name }) => name).join(", "));

  const mp = JSON.parse(read(base, "assets/mediapipe/manifest.json"));
  const asr = JSON.parse(read(base, "assets/asr/manifest.json"));
  const allowed = new Set(["LICENSE", "NOTICE", "index.html", "404.html", "config.js", "sw.js", "manifest.webmanifest", "version.json", "vercel.json", "_headers", ".nojekyll", "assets/app.bundle.js", "assets/app.css", "assets/favicon.svg", "assets/classroom/banks.json", "assets/asr/manifest.json", "assets/asr/engine/asr-worker.js", "landing/index.html", "landing/styles.css", ...referencedMedia(base, dist)]);
  for (const name of Object.keys(mp.wasm)) allowed.add(`assets/mediapipe/wasm/${name}`);
  for (const name of Object.keys(mp.models)) allowed.add(`assets/mediapipe/models/${name}`);
  for (const { name } of asr.engineFiles.files) allowed.add(`${asr.engineFiles.dir}${name}`);
  for (const name of fs.readdirSync(path.join(base, "assets/icons"))) {
    if (/^(?:apple-touch-icon|icon-(?:maskable-)?(?:192|512))\.png$/.test(name)) allowed.add(`assets/icons/${name}`);
  }
  const privatePath = /(?:^|\/)(?:\.[^/]+|node_modules|src|scripts|training|apps|宣传素材|私人[^/]*|私有[^/]*|private[^/]*|录屏[^/]*|实拍[^/]*|回放-[^/]*|[^/]*(?:验收|截图)[^/]*)(?:\/|$)|\.(?:md|py|mjs|map|log|zip|tar|gz|mov|sqlite|db|pem|key|lock)$/i;
  const unexpected = files.filter((name) => !allowed.has(name) || (name !== ".nojekyll" && privatePath.test(name)));
  // 目录也检查，空的私人目录不能混进制品。
  const privateDirs = entries.filter(({ name, type }) => type === "directory" && privatePath.test(name)).map(({ name }) => name);
  check("dist 仅含公开运行文件与页面引用媒体，无私人文件/素材", unexpected.length === 0 && privateDirs.length === 0, [...unexpected, ...privateDirs].join(", "));
  const missing = ["index.html", "assets/app.bundle.js", "config.js", "landing/index.html"].filter((name) => !files.includes(name));
  check("dist 不是空目录，保留应用与介绍页入口", missing.length === 0, missing.join(", "));

  const verify = (name, expected) => files.includes(name) && hash(path.join(dist, name)) === expected;
  for (const [name, expected] of Object.entries(mp.wasm)) {
    check(`保留真实 MediaPipe WASM/glue 且 sha256 一致：${name}`, verify(`assets/mediapipe/wasm/${name}`, expected));
  }
  for (const [name, info] of Object.entries(mp.models)) {
    const rel = `assets/mediapipe/models/${name}`;
    // 手部仍可选；但源目录已有模型时不得被去 3D 构建误删。
    if (info.required !== false || fs.existsSync(path.join(base, rel)) || files.includes(rel)) check(`保留真实 MediaPipe task 且 sha256 一致：${name}`, verify(rel, info.sha256));
  }
  const badCode = files.filter((name) => /^(?:assets\/app\.bundle\.js|index\.html|config\.js|landing\/index\.html|assets\/app\.css)$/.test(name) && (sceneCode.test(withoutLegacySettingDelete(read(dist, name))) || sceneUi.test(withoutLegacySettingDelete(read(dist, name)))));
  check("dist 应用代码与 UI 无 character-scene/sim3d", badCode.length === 0, badCode.join(", "));
  const media = [...referencedMedia(base, dist)];
  const missingMedia = media.filter((name) => threeFile(name) || !files.includes(name));
  check("dist 分享图与页面媒体按实际引用存在且不是 3D 宣传素材", missingMedia.length === 0, missingMedia.join(", "));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let failed = 0;
  const check = (name, ok, detail = "") => {
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  };
  await checkNo3dSource(root, check);
  checkNo3dDist(root, path.resolve(process.argv[2] || path.join(root, "dist")), check);
  console.log(failed ? `\n${failed} 项失败` : "\n无 3D 构建静态检查全部通过");
  process.exitCode = failed ? 1 : 0;
}
