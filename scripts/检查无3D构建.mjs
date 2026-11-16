#!/usr/bin/env node
/** 只读静态验收：非演示依赖图零 Three，演示独立懒加载，无旧重资产；不落盘、不下载、不启动浏览器。 */
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
const threeFile = (name) => /(?:^|\/)(?:characters|draco|three)(?:\/|$)|character-scene|rocketbox|\.(?:glb|gltf|fbx|obj|mtl|blend|dae|drc|ktx2?)$|(?:^|[\/_-])3d(?:[\/_.-]|$)/i.test(name);
const threeInput = (name) => /(?:^|\/)node_modules\/(?:three|@react-three)(?:\/|$)/.test(name);
const legacyAsset = /character-scene|rocketbox|(?:assets\/characters|vendor\/draco)|(?:GLTF|FBX|OBJ|DRACO|KTX2)Loader/i;
// 历史更新说明可以提及 Rocketbox/Draco；禁止的是模块、加载器和资产 URL，不是历史文字。
const legacyReference = /character-scene\.js|assets\/(?:characters|vendor\/draco)\/|(?:GLTF|FBX|OBJ|DRACO|KTX2)Loader|(?:https?:\/\/|\.\.?\/)[^\s"'`]*rocketbox|["'`][^"'`\s]*\.(?:glb|gltf|fbx|obj|mtl|blend|dae|drc|ktx2?)(?:[?#][^"'`\s]*)?["'`]/i;

// 此函数也供 check-v11 使用：不依赖 dist 是否已重建，不加载应用代码。
export async function checkNo3dSource(base, check) {
  const pkg = JSON.parse(read(base, "package.json"));
  const dependencyGroups = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
  const deps = dependencyGroups.flatMap((key) => Object.keys(pkg[key] || {}));
  const threeDeps = deps.filter((name) => /^(?:three|@types\/three|@react-three\/.*)$/.test(name));
  check("仅允许演示使用 Three，不声明 React Three/旧重资产依赖", threeDeps.includes("three") && threeDeps.every((name) => name === "three") && !deps.some((name) => /rocketbox|draco|gltf|fbx/i.test(name)), threeDeps.join(", "));
  check("保留真实 MediaPipe Tasks Vision 依赖", deps.includes("@mediapipe/tasks-vision"));

  const main = read(base, "src/main.js");
  const runtimeNames = ["src/main.js", "src/demo-view.js", "src/classroom-sim-ui.js", "src/settings.js", "src/pages.js", "config.js"];
  // 去掉注释后检查运行代码；历史说明或「已移除 3D」文案不算运行依赖。
  const runtime = await Promise.all(runtimeNames.map(async (name) => ({ name, code: (await esbuild.transform(read(base, name), { loader: "js", legalComments: "none" })).code })));
  const dynamic = runtime.filter(({ code }) => sceneCode.test(withoutLegacySettingDelete(code)) || threeImport.test(code));
  check("非演示运行路径无旧 character-scene/presenter3d 或 Three 直接导入", dynamic.length === 0, dynamic.map(({ name }) => name).join(", "));
  const view = runtime.find(({ name }) => name === "src/demo-view.js").code;
  check("demo controller 以带 BUILD_ID 的独立 URL 动态 import 演示制品", /import\(\s*new URL\(/.test(view) && /assets\/demo-presenter\.js\?v=\$\{BUILD_ID\}/.test(view) && /document\.baseURI/.test(view));
  const shell = read(base, "sw.js").match(/const SHELL\s*=\s*\[([\s\S]*?)\];/)?.[1];
  check("页面与 Service Worker 首屏不预加载演示 Three 制品", shell != null && !/demo-presenter/.test(shell) && ["index.html", "landing/index.html"].every((name) => !/demo-presenter/.test(read(base, name))));
  const uiNames = ["index.html", "assets/app.css", "src/settings.js", "config.js", "src/classroom-sim-ui.js"];
  const uiHits = uiNames.filter((name) => sceneUi.test(withoutLegacySettingDelete(read(base, name))));
  check("UI 与配置无 sim3d 开关、3D 容器和样式", uiHits.length === 0, uiHits.join(", "));
  const build = (await esbuild.transform(read(base, "scripts/build.mjs"), { loader: "js", legalComments: "none" })).code;
  check("构建不打包 character-scene/Rocketbox、不复制 GLB 或 Draco", !legacyAsset.test(build) && !legacyReference.test(build) && !/\.(?:glb|gltf)\b/i.test(build));
  check("构建保留独立 demo-presenter ESM 入口及 dist 制品", /entryPoints:\s*\[path\.join\(root,\s*["']src\/demo-presenter\.js["']/.test(build) && /format:\s*["']esm["']/.test(build) && /write\(["']assets\/demo-presenter\.js["']/.test(build));
  check("main 保留 teacher.js 的 2D renderScene 导入与演示/回放调用", /import\s*\{[^}]*\brenderScene\b[^}]*\}\s*from\s*["']\.\/teacher\.js["']/.test(main) && (main.match(/renderScene\s*\(\s*scene\.getContext\(["']2d["']\)/g) || []).length >= 2);

  const vision = read(base, "src/vision.js");
  check("MediaPipe 保留姿态、面部、手部实例与 VIDEO 推理", ["Pose", "Face", "Hand"].every((kind) => new RegExp(`${kind}Landmarker\\.createFromOptions\\(`).test(vision)) && ["pose", "face", "hands"].every((kind) => new RegExp(`${kind}\\.detectForVideo\\(video,\\s*ts\\)`).test(vision)) && /FilesetResolver\.forVisionTasks\(/.test(vision));
  check("main 真实摄像头识别结果仍进入视线、教态与记录分析", /initVision\s*\(/.test(main) && /detectVideo\(video,\s*now,/.test(main) && /extractGaze\(det\.pose,\s*det\.face,\s*det\.matrix\)/.test(main) && /extractPosture\(det\.pose,\s*session\._hist,\s*det\.hands\)/.test(main) && /tickFrame\(session,\s*t,\s*det\.pose,\s*det\.face,\s*gaze,\s*posture,\s*det\.hands\)/.test(main));

  // 只在内存打包：检查真正可达的依赖图，不执行 main 或 MediaPipe。
  try {
    const bundled = await esbuild.build({ absWorkingDir: base, entryPoints: ["src/main.js"], bundle: true, write: false, metafile: true, format: "iife", logLevel: "silent" });
    const inputs = Object.keys(bundled.metafile.inputs).map(slash);
    const unwanted = inputs.filter((name) => threeInput(name) || legacyAsset.test(name) || name === "src/demo-presenter.js");
    check("非演示 main 实际依赖图零 Three、无演示 renderer 与旧重资产", unwanted.length === 0, unwanted.join(", "));
    check("main 实际依赖图保留 2D teacher 与真实 vision", ["src/teacher.js", "src/vision.js"].every((name) => inputs.includes(name)) && inputs.some((name) => name.includes("@mediapipe/tasks-vision/")));
    check("main 实际依赖图仅保留轻量 demo controller", inputs.includes("src/demo-view.js") && !threeImport.test(bundled.outputFiles[0].text));
    const legacy = inputs.filter((name) => /\.[cm]?js$/.test(name) && !name.includes("node_modules/") && legacyReference.test(read(base, name)));
    check("main 可达源码无 Rocketbox/Draco/旧模型引用", legacy.length === 0, legacy.join(", "));
  } catch (error) {
    check("main 可静态打包（不落盘、不启动应用）", false, error.message);
  }
  try {
    const demo = await esbuild.build({ absWorkingDir: base, entryPoints: ["src/demo-presenter.js"], bundle: true, write: false, metafile: true, format: "esm", logLevel: "silent" });
    const inputs = Object.keys(demo.metafile.inputs).map(slash);
    check("独立 demo 依赖图包含 Three 与纯时间轴 rig", inputs.some(threeInput) && inputs.includes("src/demo-rig.js"));
    const unwanted = inputs.filter((name) => legacyAsset.test(name) || /(?:^|\/)(?:main|vision)\.js$|@mediapipe/.test(name) || (!name.includes("node_modules/") && legacyReference.test(read(base, name))));
    check("独立 demo 无 Rocketbox/Draco/旧重资产或真实识别依赖", unwanted.length === 0, unwanted.join(", "));
    const external = Object.values(demo.metafile.outputs).flatMap(({ imports }) => imports);
    check("独立 demo 制品自包含，不留外部模型或 Three 请求", external.length === 0 && !legacyReference.test(demo.outputFiles[0].text), external.map(({ path: name }) => name).join(", "));
  } catch (error) {
    check("demo 可独立静态打包为 ESM（不落盘、不启动应用）", false, error.message);
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
  const allowed = new Set(["LICENSE", "NOTICE", "index.html", "404.html", "config.js", "sw.js", "manifest.webmanifest", "version.json", "vercel.json", "_headers", ".nojekyll", "assets/app.bundle.js", "assets/demo-presenter.js", "assets/app.css", "assets/favicon.svg", "assets/classroom/banks.json", "assets/asr/manifest.json", "assets/asr/engine/asr-worker.js", "landing/index.html", "landing/styles.css", ...referencedMedia(base, dist)]);
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
  const missing = ["index.html", "assets/app.bundle.js", "assets/demo-presenter.js", "config.js", "landing/index.html"].filter((name) => !files.includes(name));
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
  const oldAssets = files.filter((name) => /^(?:assets\/(?:app\.bundle|demo-presenter)\.js|index\.html|config\.js|landing\/index\.html|assets\/app\.css)$/.test(name) && legacyReference.test(read(dist, name)));
  check("dist 主包与独立 demo 无 Rocketbox/Draco/旧重资产引用", oldAssets.length === 0, oldAssets.join(", "));
  if (files.includes("assets/demo-presenter.js")) {
    const demo = read(dist, "assets/demo-presenter.js");
    check("dist 独立 demo 保留 ESM mountDemoPresenter 导出", /export\s*\{[^}]*\bmountDemoPresenter\b/.test(demo));
  }
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
  console.log(failed ? `\n${failed} 项失败` : "\n演示隔离与公开制品静态检查全部通过");
  process.exitCode = failed ? 1 : 0;
}
