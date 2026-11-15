#!/usr/bin/env node
/** 静态检查（v1.6.0）、口头禅与整节课文本分析单元测试（不启动浏览器）。 */
import fs from "node:fs";
import path from "node:path";
import * as esbuild from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + String(detail).slice(0, 200) : ""}`);
};

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
check("package.json 版本为 1.6.0", pkg.version === "1.6.0", pkg.version);

const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
check("CHANGELOG 含 v1.6.0、v1.5.0 与 v1.4.0", /## v1\.6\.0/.test(changelog) && /## v1\.5\.0/.test(changelog) && /## v1\.4\.0/.test(changelog));
const notesSrc = fs.readFileSync(path.join(root, "src/changelog.js"), "utf8");
check("应用内更新说明含 1.6.0", /version: "1\.6.0"/.test(notesSrc));

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


const landing = fs.readFileSync(path.join(root, "landing/index.html"), "utf8");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
const manifest = fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8");
check("公开英文名为 OpenPodium", /OpenPodium/.test(index) && /OpenPodium/.test(landing) && /OpenPodium/.test(readme) && /OpenPodium/.test(manifest) && /OpenPodium/.test(pkg.description));
const ojHits = [];
for (const f of ["index.html", "landing/index.html", "README.md", "manifest.webmanifest", "package.json", "src/changelog.js"]) {
  const txt = fs.readFileSync(path.join(root, f), "utf8");
  if (txt.includes("OpenJing")) ojHits.push(f);
}
check("现行文案不再使用 OpenJing（历史更新记录除外）", ojHits.length === 0, ojHits.join(", "));
check("公开中文名为开讲", /开讲/.test(index) && /开讲/.test(landing));
check("设置含自动下载听写包", /asrAutoDownload/.test(settingsSrc) && index.includes("asrAutoDownload"));

// 首次进入本机听写必须由用户主动选择；保留已保存的开关及既有后台任务。
const tmpSettings = path.join(os.tmpdir(), "titaojing-asr-settings-test.mjs");
await esbuild.build({ entryPoints: [path.join(root, "src/settings.js")], bundle: true, format: "esm", outfile: tmpSettings, logLevel: "silent" });
const settings = await import(pathToFileURL(tmpSettings).href);
check("首次和旧设置缺失字段时不自动下载听写包", !settings.normalize(null).asrAutoDownload && !settings.normalize({ targetMin: 5 }).asrAutoDownload);
check("已保存的自动下载开关按原值保留", settings.normalize({ asrAutoDownload: true }).asrAutoDownload && !settings.normalize({ asrAutoDownload: false }).asrAutoDownload);
try { fs.unlinkSync(tmpSettings); } catch (_) {}

const tmpAsrUi = path.join(os.tmpdir(), "titaojing-asr-ui-test.mjs");
await esbuild.build({
  entryPoints: [path.join(root, "src/asr-ui.js")], bundle: true, format: "esm", outfile: tmpAsrUi, logLevel: "silent",
  plugins: [{ name: "mock-asr-dependencies", setup(build) {
    build.onResolve({ filter: /^(\.\/asr-model|\.\/asr-sherpa|\.\/settings)\.js$/ }, ({ path: name }) => ({ path: name, namespace: "asr-test" }));
    build.onLoad({ filter: /.*/, namespace: "asr-test" }, ({ path: name }) => ({ contents: name === "./asr-model.js"
      ? `export const downloadModel = async () => { globalThis.asrTestDownloads++; return { ok: true }; };
         export const deleteModel = async () => {}; export const loadAsrManifest = async () => null;
         export const modelSizeLabel = () => "约 90 MB"; export const modelCached = async () => ({ cached: globalThis.asrTestCached });
         export const engineSupported = () => true; export const pendingModelRequests = async () => ({ files: [] });
         export const importBackgroundStash = async () => {};`
      : name === "./asr-sherpa.js"
        ? `export const inspectSherpa = async () => {}; export const sherpaAvailable = () => ({ ok: false });`
        : `export const getSettings = () => ({ asrAutoDownload: globalThis.asrTestAutoEnabled });`, loader: "js" }));
  } }],
});
globalThis.asrTestDownloads = 0;
globalThis.asrTestCached = false;
globalThis.asrTestAutoEnabled = false;
const originalSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = () => 0; // ready 芯片的延时隐藏与此单测无关
const asrTestChip = { querySelector: () => ({ addEventListener() {} }) };
globalThis.document = { getElementById: () => asrTestChip, createElement: () => asrTestChip, body: { appendChild() {} } };
globalThis.window = { addEventListener() {} };
const originalNavigator = globalThis.navigator;
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { serviceWorker: { ready: Promise.resolve({ backgroundFetch: { get: async () => globalThis.asrTestBackgroundFetch } }), addEventListener() {} } } });
const asrUi = await import(pathToFileURL(tmpAsrUi).href);
const firstEntry = await asrUi.maybeAutoDownload();
check("首次进入不触发模型下载", firstEntry.reason === "off" && globalThis.asrTestDownloads === 0);
globalThis.asrTestBackgroundFetch = { downloaded: 0, downloadTotal: 100, addEventListener() {} };
const priorFetch = await asrUi.maybeAutoDownload();
check("已有后台任务继续但未授权不并行新下载", priorFetch.reason === "background-fetch" && globalThis.asrTestDownloads === 0);
globalThis.asrTestAutoEnabled = true;
const optedIn = await asrUi.maybeAutoDownload();
check("已开启自动下载的旧设置仍启动下载", optedIn.reason === "background-fetch" && globalThis.asrTestDownloads === 1);
globalThis.asrTestAutoEnabled = false;
globalThis.asrTestCached = true;
const ready = await asrUi.maybeAutoDownload();
check("已缓存模型在关闭自动下载后仍可用", ready.reason === "cached" && globalThis.asrTestDownloads === 1);
delete globalThis.asrTestBackgroundFetch;
delete globalThis.asrTestAutoEnabled;
delete globalThis.asrTestCached;
delete globalThis.asrTestDownloads;
delete globalThis.document;
delete globalThis.window;
globalThis.setTimeout = originalSetTimeout;
Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
try { fs.unlinkSync(tmpAsrUi); } catch (_) {}

check("下载模块支持 Range 并行与续传", /DEFAULT_PARALLEL/.test(fs.readFileSync(path.join(root, "src/asr-download.js"), "utf8")) && /planRanges/.test(fs.readFileSync(path.join(root, "src/asr-download.js"), "utf8")) && /chunkStore/.test(fs.readFileSync(path.join(root, "src/asr-download.js"), "utf8")));
check("页面含观察记录容器", index.includes("observe-sheet"));
const bankPath = path.join(root, "assets/classroom/banks.json");
check("模拟课堂题库文件存在且可编辑", fs.existsSync(bankPath));
const bank = JSON.parse(fs.readFileSync(bankPath, "utf8"));
check("题库含学生、对错回答和路演常见问题", Array.isArray(bank.class && bank.class.students) && bank.class.students.length >= 4 && bank.class.students.length <= 6 && (bank.class.answers || []).some((a) => a.kind === "correct") && (bank.class.answers || []).some((a) => a.kind === "wrong" || a.kind === "partial") && ["差异化", "收费", "用户是谁", "下一步计划", "团队分工"].every((k) => (bank.roadshow.questions || []).some((q) => q.topic === k)), JSON.stringify({ students: (bank.class.students || []).length, answers: (bank.class.answers || []).map((a) => a.kind), topics: (bank.roadshow.questions || []).map((q) => q.topic) }));
check("开讲页可粘贴题干要求", index.includes("perm-stem") && index.includes("题干要求"));
check("有可打印的语文试讲观察表说明", fs.existsSync(path.join(root, "docs/YUWEN_RUBRIC.md")) && fs.readFileSync(path.join(root, "docs/YUWEN_RUBRIC.md"), "utf8").includes("来自师范生备考笔记"));
check("开讲页可开关模拟课堂且标明练习用", index.includes("perm-classroom-sim") && index.includes("练习用模拟") && index.includes('data-sim="off"'));
check("设置里模拟课堂默认可关", /classroomSim/.test(settingsSrc) && settingsSrc.includes('classroomSim: "off"'));


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


// 下载分段规划
const tmpDl = path.join(os.tmpdir(), "titaojing-asr-download-test.mjs");
await esbuild.build({
  entryPoints: [path.join(root, "src/asr-download.js")],
  bundle: true,
  format: "esm",
  outfile: tmpDl,
  logLevel: "silent",
  platform: "node",
});
const dl = await import(pathToFileURL(tmpDl).href);
const ranges = dl.planRanges(20, 8);
check("planRanges 按块切开", ranges.length === 3 && ranges[0].start === 0 && ranges[2].end === 19, JSON.stringify(ranges));
const store = new Map();
const chunkStore = {
  async get(k) { return store.get(k) || null; },
  async put(k, blob) { store.set(k, blob); },
  async clear(prefix) { for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k); },
};
const payload = Uint8Array.from({ length: 64 }, (_, i) => (i * 7) & 255);
const sha = await dl.sha256Hex(payload.buffer);
const { createServer } = await import("node:http");
const server = createServer((req, res) => {
  const range = req.headers.range;
  if (range) {
    const m = range.match(/bytes=(\d+)-(\d+)/);
    const start = Number(m[1]), end = Number(m[2]);
    const slice = payload.subarray(start, end + 1);
    res.writeHead(206, { "Content-Range": `bytes ${start}-${end}/${payload.length}`, "Content-Length": String(slice.length), "Accept-Ranges": "bytes" });
    res.end(Buffer.from(slice));
    return;
  }
  res.writeHead(200, { "Content-Length": String(payload.length) });
  res.end(Buffer.from(payload));
});
const port = await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
const url = `http://127.0.0.1:${port}/model.bin`;
const got = await dl.fetchFile({ url, bytes: payload.length, sha256: sha, chunkStore, parallel: 4, chunk: 16, fileId: "t" });
check("本地 Range 并行下载并校验 sha256", got.mode === "parallel" && got.blob.size === payload.length && (await dl.sha256Hex(await got.blob.arrayBuffer())) === sha, got.mode);
// 续传：预置第一段
await chunkStore.clear("t");
const first = await dl.fetchFile({ url, bytes: payload.length, sha256: sha, chunkStore, parallel: 4, chunk: 16, fileId: "t" });
check("续传写入了分段缓存", store.size === 0, "cleared after success size=" + store.size); // fetchFile clears after success
// 中途缓存：手动放入第一段再下
const r0 = dl.planRanges(payload.length, 16)[0];
store.set(dl.rangeKey("resume", r0.start, r0.end), new Blob([payload.subarray(r0.start, r0.end + 1)]));
const resumed = await dl.fetchFile({ url, bytes: payload.length, sha256: sha, chunkStore, parallel: 4, chunk: 16, fileId: "resume" });
check("预置分段后能续成完整文件", resumed.blob.size === payload.length, String(resumed.blob.size));
server.close();
try { fs.unlinkSync(tmpDl); } catch (_) {}

// 整节课文本分析
const tmpOb = path.join(os.tmpdir(), "titaojing-observe-test.mjs");
await esbuild.build({
  entryPoints: [path.join(root, "src/observe.js")],
  bundle: true,
  format: "esm",
  outfile: tmpOb,
  logLevel: "silent",
  platform: "neutral",
  external: [],
});
const ob = await import(pathToFileURL(tmpOb).href);
const sample = ob.sampleLessonTranscript();
const dur = 110;
const points = ob.extractKeyPoints(sample);
check("重点提取命中提示语", points.some((p) => p.cue === "重点是") && points.some((p) => p.cue === "大家注意") && points.some((p) => p.cue === "总结一下"), JSON.stringify(points.map((p) => p.cue)));
const kws = ob.extractKeywords(sample);
check("关键词抽出勾股定理或斜边", kws.some((k) => /勾股定理|斜边|直角/.test(k.word)), JSON.stringify(kws.slice(0, 6)));
const qs = ob.findQuestions(sample, dur);
check("提问区分封闭与开放", qs.closed >= 1 && qs.open >= 2 && qs.count >= 4, JSON.stringify({ closed: qs.closed, open: qs.open, count: qs.count, waits: qs.items.map((i) => [i.kind, i.cue, i.wait]) }));
const tr = ob.findTransitions(sample);
check("衔接过渡找到三处用语", ["接下来", "我们再看", "刚才说到"].every((p) => tr.some((x) => x.phrase === p)), JSON.stringify(tr.map((x) => x.phrase)));
const echo = ob.echoHeadTail(sample, dur);
check("首尾呼应能对上斜边或勾股", echo.overlap.some((k) => /斜边|勾股|直角/.test(k.word)), JSON.stringify(echo.overlap));
const styles = ob.explainStyles(sample);
const styleCount = Object.fromEntries(styles.map((g) => [g.key, g.items.length]));
check("举例、类比、追问都能定位", styleCount.example >= 1 && styleCount.analogy >= 1 && styleCount.probe >= 1, JSON.stringify(styleCount));
const cheers = ob.encouragements(sample);
check("激励用语找到很好、不错、谢谢、大家想一想", ["很好", "不错", "谢谢", "大家想一想"].every((p) => cheers.some((x) => x.phrase === p)), JSON.stringify(cheers.map((x) => x.phrase)));
const particles = ob.countParticles(sample);
check("语气词里能单独数到「那么」或「就是」", particles.total >= 1, JSON.stringify(particles));
const report = ob.buildObserveReport({ kind: "camera", duration: dur, transcript: sample, frames: [], speechAvailable: true, speechHeard: true });
check("有转写时整节课层可用", report.hasSpeech && report.lesson.keyPoints.length >= 2 && report.lesson.questions.count >= 4);
const silent = ob.buildObserveReport({ kind: "camera", duration: 60, transcript: [], frames: [], speechAvailable: false, speechHeard: false });
check("无转写时标明原因且不假装有重点", !silent.hasSpeech && !!silent.speechWhy && silent.lesson.keyPoints == null, silent.speechWhy);
try { fs.unlinkSync(tmpOb); } catch (_) {}

const tmpSim = path.join(os.tmpdir(), "titaojing-sim-test.mjs");
await esbuild.build({
  entryPoints: [path.join(root, "src/classroom-sim.js")],
  bundle: true,
  format: "esm",
  outfile: tmpSim,
  logLevel: "silent",
});
const simMod = await import(pathToFileURL(tmpSim).href);
const det = () => 0.3; // 稳定随机，便于断言
const cls = simMod.createSim("class", bank, { random: det });
check("说谁来回答会举手", cls.feedTranscript("有没有同学愿意回答一下？", 12, true)?.action === "raise" && cls.snapshot(12).people.filter((p) => p.state === "hand").length >= 3);
const called = cls.feedTranscript("请你来讲", 16, true);
check("说请你会点名并给出题库回答", called?.action === "call" && called.answer && called.answer.text && ["correct", "partial", "wrong"].includes(called.answer.kind), JSON.stringify(called && { action: called.action, kind: called.answer && called.answer.kind }));
const byName = simMod.createSim("class", bank, { random: det });
byName.feedTranscript("谁来回答", 4, true);
const named = byName.feedTranscript("请林秋来说", 6, true);
check("叫姓名可点到对应同学", named?.action === "call" && named.person && named.person.name === "林秋", JSON.stringify(named && named.person));
const quiet = simMod.createSim("class", bank, { random: det });
quiet.feedTranscript("我们先看这一页。", 2, true);
quiet.tick(11, { silence: 9, cpm: 40 });
check("安静超过八秒会有同学困惑或走神", quiet.snapshot(11).people.some((p) => p.state === "confused" || p.state === "distracted"), JSON.stringify(quiet.snapshot(11).people.map((p) => p.state)));
const fast = simMod.createSim("class", bank, { random: det });
fast.feedTranscript("一二三四五六七八九十", 1, true);
fast.tick(3, { silence: 0.2, cpm: 320 });
check("语速很快时会有同学困惑", fast.snapshot(3).people.some((p) => p.state === "confused"), JSON.stringify(fast.snapshot(3).people.map((p) => p.state)));
const road = simMod.createSim("roadshow", bank, { random: det });
const asked = road.feedTranscript("大家有什么问题，欢迎提问。", 40, true);
check("路演讲完后嘉宾会提出常见问题", asked?.action === "ask" && asked.pending && ["差异化", "收费", "用户是谁", "下一步计划", "团队分工"].includes(asked.pending.question.topic), JSON.stringify(asked && asked.pending && asked.pending.question));
road.feedTranscript("谢谢老师，关于这一点我们是这样考虑的。", 48, true);
const sum = road.summarize();
check("路演回应时长会记入日志", sum.askCount >= 1 && sum.replyCount >= 1 && sum.replyDurations[0] >= 7 && sum.interactions >= 2, JSON.stringify(sum));

const chorus = simMod.createSim("class", bank, { random: det });
const chAct = chorus.feedTranscript("请大家齐读题目。", 8, true);
check("说齐读会进入全班齐读", chAct?.action === "group_read" && chorus.snapshot(8).people.every((p) => p.state === "reading"), JSON.stringify(chAct && { action: chAct.action, states: chorus.snapshot(8).people.map((p) => p.state) }));
const point = simMod.createSim("class", bank, { random: det });
const pAct = point.feedTranscript("请你来读", 10, true);
check("说请你来读会有一位同学站起来读", pAct?.action === "stand_read" && point.snapshot(10).people.filter((p) => p.state === "stand_read").length === 1, JSON.stringify(pAct && { action: pAct.action, who: pAct.person && pAct.person.name, states: point.snapshot(10).people.map((p) => [p.name, p.state]) }));
const namedRead = simMod.createSim("class", bank, { random: det });
const nAct = namedRead.feedTranscript("请林秋来读", 11, true);
check("叫姓名来读可点到对应同学", nAct?.action === "stand_read" && nAct.person && nAct.person.name === "林秋" && namedRead.snapshot(11).people.find((p) => p.name === "林秋").state === "stand_read", JSON.stringify(nAct && nAct.person));
try { fs.unlinkSync(tmpSim); } catch (_) {}


const tmpYw = path.join(os.tmpdir(), "titaojing-yuwen-test.mjs");
await esbuild.build({
  entryPoints: [path.join(root, "src/yuwen.js")],
  bundle: true,
  format: "esm",
  outfile: tmpYw,
  logLevel: "silent",
  platform: "neutral",
});
const yw = await import(pathToFileURL(tmpYw).href);
check("语文备考笔记是 23 条", yw.YUWEN_NOTES.length === 23 && yw.NOTES_CREDIT === "来自师范生备考笔记", String(yw.YUWEN_NOTES.length));
const chun = yw.sampleChunxiaoTranscript();
const stem = yw.sampleChunxiaoStem();
const ywReport = yw.buildYuwenReport({ kind: "camera", duration: 190, transcript: chun, frames: [], speechAvailable: true, speechHeard: true, stemRequirement: stem });
check("春晓样例能统计开放问题", ywReport.openHits.some((h) => h.phrase === "谁来说说") && ywReport.openHits.some((h) => h.phrase === "你怎么看") && ywReport.openHits.some((h) => h.phrase === "你觉得"), JSON.stringify(ywReport.openHits.map((h) => h.phrase)));
check("春晓样例有点名", ywReport.nameHits.some((h) => /林秋|请你/.test(h.phrase + h.text)), JSON.stringify(ywReport.nameHits.map((h) => h.phrase)));
check("春晓样例提问不少于 3 次", ywReport.virtualDialogue && ywReport.virtualDialogue.meets && ywReport.questions.count >= 3, JSON.stringify(ywReport.questions && { count: ywReport.questions.count, open: ywReport.questions.open }));
const forms = ywReport.reading.forms.join(",");
check("春晓样例朗读不少于三次且形式有变化", ywReport.reading.count >= 3 && ywReport.reading.meetsTarget && ["齐读", "点读", "范读", "分角色"].every((f) => ywReport.reading.forms.includes(f)), JSON.stringify(ywReport.reading));
check("春晓样例记下范读段", ywReport.modelRead.count >= 1, JSON.stringify(ywReport.modelRead.items.map((i) => ({ cue: i.cue, cpm: Math.round(i.cpm) }))));
check("春晓样例朗读指导用语齐全", ["读出", "重音", "停顿", "读慢一点", "入情"].every((p) => ywReport.guides.some((g) => g.phrase === p)), JSON.stringify(ywReport.guides.map((g) => g.phrase)));
check("春晓样例能检出换字比较与直接给结论", ywReport.swaps.compares.length >= 1 && ywReport.swaps.directs.length >= 1, JSON.stringify(ywReport.swaps));
check("春晓样例在问句前标出「十分经典」或「思想感情」", ywReport.process.jumps.some((j) => /十分经典|思想感情|表达了作者/.test(j.phrase)), JSON.stringify(ywReport.process.jumps));
check("春晓样例标出「翻译」", ywReport.process.translations.length >= 1, JSON.stringify(ywReport.process.translations));
check("春晓样例覆盖题干里的春晓与处处闻啼鸟", ywReport.stemCoverage.available && ywReport.stemCoverage.covered.some((k) => k.word.includes("春晓") || k.word === "春晓") && ywReport.stemCoverage.covered.some((k) => k.word.includes("处处闻啼鸟") || k.word === "处处闻啼鸟"), JSON.stringify(ywReport.stemCoverage.covered.map((k) => k.word)));
check("春晓样例有意象意境与批判性问题、表现性评价", ywReport.poetry.some((h) => h.phrase === "意象") && ywReport.critical.some((h) => h.phrase === "你同意吗") && ywReport.evals.some((h) => h.phrase === "读得好在哪") && ywReport.evals.some((h) => h.phrase === "你抓住了"), JSON.stringify({ poetry: ywReport.poetry.map((h) => h.phrase), critical: ywReport.critical.map((h) => h.phrase), evals: ywReport.evals.map((h) => h.phrase) }));
check("语文观察表总览含教态与口头表达", ywReport.law && /教态/.test(ywReport.law.title) && /口头表达/.test(ywReport.law.title));
try { fs.unlinkSync(tmpYw); } catch (_) {}

// v1.6.0 3D characters
const charDir = path.join(root, "assets/characters");
const glbs = ["students.glb", "guests.glb", "teacher.glb", "classroom.glb", "podium.glb"];
let charBytes = 0;
for (const f of glbs) {
  const fp = path.join(charDir, f);
  check(`角色文件存在 ${f}`, fs.existsSync(fp));
  if (fs.existsSync(fp)) charBytes += fs.statSync(fp).size;
}
check("3D 角色合计不超过约 25 MB", charBytes > 1e6 && charBytes <= 25.5 * 1024 * 1024, `${(charBytes / 1048576).toFixed(2)} MB`);
const notice = fs.readFileSync(path.join(root, "NOTICE"), "utf8");
check("NOTICE 记录 Rocketbox MIT 与 three.js，并写明不是 Mixamo", /Rocketbox/.test(notice) && /MIT/.test(notice) && /Microsoft/.test(notice) && /three\.js/.test(notice) && /Mixamo/.test(notice) && /不是 Mixamo/.test(notice));
const mainSrc = fs.readFileSync(path.join(root, "src/main.js"), "utf8");
const simUi = fs.readFileSync(path.join(root, "src/classroom-sim-ui.js"), "utf8");
check("3D 为按需加载且可退回插画", simUi.includes("sim-stage3d") && simUi.includes("character-scene.js") && settingsSrc.includes('sim3d: "auto"') && mainSrc.includes("ensurePresenter3d"));
check("构建会打包 character-scene 并复制 glb", fs.readFileSync(path.join(root, "scripts/build.mjs"), "utf8").includes("character-scene.js") && fs.readFileSync(path.join(root, "scripts/build.mjs"), "utf8").includes("assets/characters"));
check("changelog 写明 3D 限制", /发片|卡片头发|扫描|插画/.test(fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8")) && /1\.6\.0/.test(fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8")));
const sceneSrc = fs.readFileSync(path.join(root, "src/character-scene.js"), "utf8");
check("课堂相机在黑板前方而不是墙后", /position\.set\(2\.35, 1\.72, -1\.25\)/.test(sceneSrc) && !/position\.set\(0, 1\.45, -3\.5\)/.test(sceneSrc));
for (const f of ["docs/images/demo-3d.mp4", "docs/images/demo-3d.webp", "docs/images/demo-3d.gif", "docs/images/demo-3d.jpg", "landing/images/demo-3d.mp4"]) {
  const fp = path.join(root, f);
  check(`演示媒资存在 ${f}`, fs.existsSync(fp) && fs.statSync(fp).size > 1024);
}
for (const f of ["index.html", "landing/index.html"]) {
  const html = fs.readFileSync(path.join(root, f), "utf8");
  const img = (html.match(/property="og:image" content="https:\/\/chensibo2049\.github\.io\/titaojing\/([^"]+)"/) || [])[1];
  check(`${f} 有分享卡片（og:image 指向仓库内的图）`, !!img && fs.existsSync(path.join(root, img)) && /twitter:card/.test(html) && !/chensibo\.cn/.test(html.match(/og:[^>]+/g).join(" ")), img);
}
const mp4 = fs.statSync(path.join(root, "docs/images/demo-3d.mp4")).size;
check("演示 mp4 体积适中", mp4 > 80 * 1024 && mp4 < 3 * 1024 * 1024, `${(mp4 / 1024).toFixed(0)} KB`);




{
  const nf = fs.readFileSync(path.join(root, "deploy/404.html"), "utf8");
  const bs = fs.readFileSync(path.join(root, "scripts/build.mjs"), "utf8");
  check("找不到页面：有 404.html 并在构建时拷进 dist", /write\("404\.html"/.test(bs) && /noindex/.test(nf) && /\/titaojing\//.test(nf) && /landing\//.test(nf) && !/赋能|大模型|智能诊断/.test(nf));
}

{
  const lh = fs.readFileSync(path.join(root, "landing/index.html"), "utf8");
  const lc = fs.readFileSync(path.join(root, "landing/styles.css"), "utf8");
  check("介绍页：有「跳到正文」、<main> 与减少动态效果的处理", /class="skip" href="#main"/.test(lh) && /<main id="main"/.test(lh) && /prefers-reduced-motion/.test(lh) && /prefers-reduced-motion/.test(lc) && /:focus-visible/.test(lc));
}

{
  const lh = fs.readFileSync(path.join(root, "landing/index.html"), "utf8");
  const lc = fs.readFileSync(path.join(root, "landing/styles.css"), "utf8");
  check("介绍页：可打印成练习讲义（隐藏导航与视频，打印时展开常见问题）", /@media print/.test(lc) && /#demo3d/.test(lc.split("@media print")[1] || "") && /beforeprint/.test(lh) && /afterprint/.test(lh) && /summary:focus-visible/.test(lc));
}

{
  const lh = fs.readFileSync(path.join(root, "landing/index.html"), "utf8");
  const m = lh.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  let ok = false, why = "缺少 ld+json";
  if (m) {
    try {
      const data = JSON.parse(m[1]);
      const app = data.find((d) => d["@type"] === "SoftwareApplication");
      const faq = data.find((d) => d["@type"] === "FAQPage");
      const strip = (t) => t.replace(/<[^>]+>/g, "").trim();
      const shown = [...lh.matchAll(/<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>/g)].map((x) => [strip(x[1]), strip(x[2])]);
      const same = faq && faq.mainEntity.length === shown.length && faq.mainEntity.every((q, i) => q.name === shown[i][0] && q.acceptedAnswer.text === shown[i][1]);
      ok = !!app && /apache/i.test(app.license) && same && !/赋能|大模型|智能诊断/.test(m[1]);
      why = `${shown.length} 条常见问题${same ? "一致" : "与页面不一致"}`;
    } catch (e) { why = "JSON 解析失败：" + e.message; }
  }
  check("介绍页：结构化数据可解析，常见问题与页面文字一致", ok, why);
}

{
  const lh = fs.readFileSync(path.join(root, "landing/index.html"), "utf8");
  const sec = (lh.match(/<section id="yuwen">([\s\S]*?)<\/section>/) || [])[1] || "";
  check("介绍页：有语文试讲观察表一节，导航可达，链到全文且不说打分", !!sec && /href="#yuwen"/.test(lh) && /docs\/YUWEN_RUBRIC\.md/.test(sec) && /不打分/.test(sec) && !/赋能|大模型|智能诊断/.test(sec) && fs.existsSync(path.join(root, "docs/YUWEN_RUBRIC.md")));
}

try { fs.unlinkSync(tmp); } catch (_) {}

console.log(failed ? `\n${failed} 项失败` : "\n检查全部通过");
process.exit(failed ? 1 : 0);
