// 构建：node scripts/build.mjs
//  - assets/app.bundle.js  ：源码目录调试用（BUILD_ID=dev，不注册 Service Worker）
//  - dist/                 ：可部署到任意 https 静态主机的成品
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = pkg.version;
const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const buildDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

const devOnly = process.argv.includes("--dev-only");

// Separate ESM entry: its URL is referenced only by the demo lifecycle loader.
const presenter = await esbuild.build({
  entryPoints: [path.join(root, "src/demo-presenter.js")], bundle: true, format: "esm", minify: true,
  legalComments: "none", write: false, logLevel: "warning",
});
const presenterBundle = presenter.outputFiles[0].text;
// A production build must not modify tracked source artifacts.
if (devOnly) {
fs.writeFileSync(path.join(root, "assets/demo-presenter.js"), presenterBundle);
// 1) dev bundle for the source folder
await esbuild.build({
  entryPoints: [path.join(root, "src/main.js")],
  bundle: true, format: "iife", minify: true, legalComments: "none",
  outfile: path.join(root, "assets/app.bundle.js"),
  define: { __APP_VERSION__: JSON.stringify(version), __BUILD_DATE__: JSON.stringify(buildDate), __BUILD_ID__: JSON.stringify("dev") },
  logLevel: "warning",
});
console.log("dev bundle ok"); process.exit(0);
}

// 2) production bundle
const tmp = await esbuild.build({
  entryPoints: [path.join(root, "src/main.js")],
  bundle: true, format: "iife", minify: true, legalComments: "none", write: false,
  define: { __APP_VERSION__: JSON.stringify(version), __BUILD_DATE__: JSON.stringify(buildDate), __BUILD_ID__: JSON.stringify("__BUILD_ID_SLOT__") },
  logLevel: "warning",
});
let bundle = tmp.outputFiles[0].text;
const css = fs.readFileSync(path.join(root, "assets/app.css"), "utf8");
const tokens = fs.readFileSync(path.join(root, "assets/tokens.css"), "utf8");
const hash = crypto.createHash("sha1").update(bundle).update(css)
  .update(tokens).update(fs.readFileSync(path.join(root, "config.js"))).update(presenterBundle).update(fs.readFileSync(path.join(root, "index.html"))).update(fs.readFileSync(path.join(root, "sw.js")))
  .update(fs.readFileSync(path.join(root, "landing/index.html"))).update(fs.readFileSync(path.join(root, "landing/styles.css")))
  .digest("hex").slice(0, 8);
const buildId = `${version}-${hash}`;
bundle = bundle.replaceAll("__BUILD_ID_SLOT__", buildId);

const dist = path.join(root, "dist");
fs.rmSync(dist, { recursive: true, force: true });
const mk = (p) => fs.mkdirSync(path.join(dist, p), { recursive: true });
const cp = (from, to = from) => { mk(path.dirname(to)); fs.copyFileSync(path.join(root, from), path.join(dist, to)); };
const write = (to, text) => { mk(path.dirname(to)); fs.writeFileSync(path.join(dist, to), text); };

write("assets/app.bundle.js", bundle);
write("assets/demo-presenter.js", presenterBundle);
write("assets/app.css", css);
write("assets/tokens.css", tokens);
write("index.html", fs.readFileSync(path.join(root, "index.html"), "utf8").replaceAll("__BUILD_ID__", buildId));
write("sw.js", fs.readFileSync(path.join(root, "sw.js"), "utf8").replaceAll("__BUILD_ID__", buildId));
cp("config.js");
cp("LICENSE");
cp("NOTICE");
cp("manifest.webmanifest");
cp("assets/favicon.svg");
for (const f of fs.readdirSync(path.join(root, "assets/icons"))) cp(`assets/icons/${f}`);
for (const f of ["vision_wasm_internal.js", "vision_wasm_internal.wasm", "vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm"]) cp(`assets/mediapipe/wasm/${f}`);
for (const f of ["pose_landmarker_lite.task", "face_landmarker.task"]) cp(`assets/mediapipe/models/${f}`);
const handModel = "assets/mediapipe/models/hand_landmarker.task";
if (fs.existsSync(path.join(root, handModel))) cp(handModel);
const asrManifest = "assets/asr/manifest.json";
if (fs.existsSync(path.join(root, asrManifest))) cp(asrManifest);
// 本机听写引擎（sherpa-onnx WASM + Silero VAD）；中文模型不随网站发布，由浏览器按需下载。
for (const f of fs.readdirSync(path.join(root, "assets/asr/engine"))) cp(`assets/asr/engine/${f}`);
const classroomDir = path.join(root, "assets/classroom");
if (fs.existsSync(classroomDir)) {
  for (const f of fs.readdirSync(classroomDir)) cp(`assets/classroom/${f}`);
}
// Host configs (harmless on hosts that ignore them)
write("_headers", fs.readFileSync(path.join(root, "deploy/_headers"), "utf8"));
write("vercel.json", fs.readFileSync(path.join(root, "deploy/vercel.json"), "utf8"));
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const sourceDirty = !!execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root, encoding: "utf8" }).trim();
write("version.json", JSON.stringify({ name: "OpenPodium · 开讲", version, buildId, buildDate, sourceCommit, sourceDirty }, null, 2) + "\n");
write(".nojekyll", "");
// GitHub Pages / Netlify 等会把它当作找不到页面时的兜底页
write("404.html", fs.readFileSync(path.join(root, "deploy/404.html"), "utf8"));

// landing page (static, Chinese)
// Explicit public allowlist: do not recursively publish personal or unreferenced media.
for (const f of ["index.html", "styles.css", "images/cover.jpg", "images/replay.jpg"]) {
  cp(`landing/${f}`);
}

// size report
let total = 0, biggest = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { const s = fs.statSync(p).size; total += s; biggest.push([path.relative(dist, p), s]); } } };
walk(dist);
biggest.sort((a, b) => b[1] - a[1]);
console.log(`dist/ built  version=${version} buildId=${buildId} date=${buildDate}`);
console.log(`total ${(total / 1048576).toFixed(1)} MB in ${biggest.length} files; largest:`);
for (const [f, s] of biggest.slice(0, 6)) console.log(`  ${(s / 1048576).toFixed(2).padStart(6)} MB  ${f}`);

// Integrity metadata excludes itself; sha256sum-compatible manifest includes every other public file.
const files = [];
const collect = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
  const p = path.join(d, e.name); if (e.isDirectory()) collect(p);
  else files.push({ path: path.relative(dist, p).split(path.sep).join("/"), bytes: fs.statSync(p).size, sha256: crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex") });
} };
collect(dist); files.sort((a,b) => a.path.localeCompare(b.path));
write("build-manifest.json", JSON.stringify({ schemaVersion: 1, version, buildId, sourceCommit, sourceDirty, files }, null, 2) + "\n");
console.log(`source=${sourceCommit} dirty=${sourceDirty}; manifest=${files.length} files`);
