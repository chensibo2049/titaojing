import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = await mkdtemp(path.join(os.tmpdir(), "openpodium-report-"));
let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
const host = () => ({ innerHTML: "", hidden: true, classList: { add() {} }, querySelectorAll() { return []; } });
const print = host();
globalThis.document = { getElementById: () => print };
try {
  const result = await esbuild.build({
    stdin: { contents: `export * from './src/observe.js'; export * from './src/report.js'; export * from './src/observe-ui.js'; export * from './src/records.js'; export { diagnose } from './src/analyze.js'; export { bakeDemoSession } from './src/demo.js';`, resolveDir: root },
    outfile: path.join(tmp, "test.mjs"), bundle: true, platform: "node", format: "esm", metafile: true, logLevel: "silent",
  });
  const api = await import(pathToFileURL(path.join(tmp, "test.mjs")).href);
  const pose = Array.from({ length: 33 }, (_, i) => ({ x: 0.3 + (i % 2) * 0.1, y: 0.3 + i * 0.01, visibility: 1, v: 1 }));
  const frames = Array.from({ length: 120 }, (_, i) => ({ t: i / 2, pose, gaze: { label: "class", yaw: 0 }, flags: {}, onBoard: false }));
  const real = { kind: "camera", startedAt: 1700000000000, duration: 60, frames, events: [{ t: 12, kind: "filler", type: "filler", word: "嗯" }], transcript: [{ t: 12, text: "嗯，重点是为什么呢？" }], speechAvailable: true, speechHeard: true, visionAvailable: true, asrEngine: "local-asr" };
  api.diagnose(real);
  check("真实报告显示来源、分层、证据时刻和规则版本", () => {
    const html = api.buildPrintReport(real);
    for (const text of ["真实试讲", "local-camera-mediapipe", "visual-events/1.0.0", "practice-self-review/1.0.0", "00:12", "local-asr", "缺失与限制", "不是观测结论"]) assert.ok(html.includes(text), text);
    assert.equal(print.innerHTML, html);
    const sheet = host();
    const r = api.renderObserveSheet(sheet, real);
    assert.ok(sheet.innerHTML.includes("review-details/1.0.0"));
    assert.equal(r.observation.source, "local-camera-mediapipe");
  });
  check("导入只分析画面，不给听写零分或正常结论", () => {
    const imported = { ...real, diagnosis: undefined, localImport: true, speechAvailable: false, speechHeard: false, transcript: [], events: [] };
    api.diagnose(imported);
    const r = api.buildObserveReport(imported);
    assert.equal(r.particles, null);
    assert.equal(r.questions, null);
    assert.ok(r.lesson.rhythm.minutes.every(m => m.cpm === null && m.pause === null));
    assert.equal(r.structure.source, "none");
    const html = api.buildPrintReport(imported);
    assert.ok(html.includes("本机视频导入"));
    assert.ok(html.includes("导入视频未听写声音"));
    assert.ok(html.includes("<b>未统计</b><span>口头禅"));
    assert.ok(!html.includes("口头禅很少"));
  });
  check("无视觉时即便残留帧，也不展示正常体态或零移动", () => {
    const noVision = { ...real, diagnosis: undefined, visionAvailable: false };
    const r = api.buildObserveReport(noVision);
    assert.equal(r.motion, null);
    assert.equal(r.gestures, null);
    assert.equal(r.gaze.available, false);
    assert.ok(r.lesson.rhythm.minutes.every(m => m.move === null && m.gestures === null));
    const html = api.buildPrintReport(noVision);
    assert.ok(html.includes("<b>未统计</b><span>体态标记"));
    assert.ok(html.includes("朝向镜头约 未统计"));
    const sheet = host(); api.renderObserveSheet(sheet, noVision);
    assert.ok(!sheet.innerHTML.includes("面向学生约"));
  });
  check("无听写时残留转写不变成当前可用结果", () => {
    const silent = { ...real, diagnosis: undefined, speechAvailable: false, speechHeard: false };
    const sheet = host(); const r = api.renderObserveSheet(sheet, silent);
    assert.equal(r.hasSpeech, false);
    assert.equal(r.rate, null);
    assert.ok(r.lesson.rhythm.minutes.every(m => m.cpm === null));
    assert.ok(!sheet.innerHTML.includes("整段约"));
  });
  check("全部缺失不生成零统计或正常结论", () => {
    const empty = { kind: "camera", duration: 60, frames: [], events: [], transcript: [], visionAvailable: false, speechAvailable: false, speechHeard: false };
    const html = api.buildPrintReport(empty);
    assert.equal((html.match(/<b>未统计<\/b>/g) || []).length, 4);
    assert.ok(!html.includes("朝向镜头约 0%"));
    assert.ok(!html.includes("<b>0</b>"));
    const sheet = host(); const r = api.renderObserveSheet(sheet, empty);
    assert.ok(r.missing.length >= 3);
    assert.ok(!sheet.innerHTML.includes("<path class=\"ob-line\""));
  });
  check("演示明确为动画 rig 投影和预设字幕", () => {
    const demo = api.bakeDemoSession();
    const html = api.buildPrintReport(demo);
    for (const text of ["预设演示", "动画 rig 投影", "非实际视觉识别", "preset-animation-rig", "preset-transcript"]) assert.ok(html.includes(text), text);
    const sheet = host(); api.renderObserveSheet(sheet, demo);
    assert.ok(sheet.innerHTML.includes("非实际视觉识别"));
    const restored = api.fromRecord(api.toRecord(demo));
    const r = api.buildObserveReport(restored);
    assert.equal(r.demo, true);
    assert.equal(r.hasPose, false); // compact demo history has no raw trajectory
    assert.ok(api.buildPrintReport(restored).includes("预设演示"));
  });
  check("旧历史标记、点评和无时间标记完整保留，不假装新版识别", () => {
    const legacy = { ...real, fromHistory: true, events: [...real.events, { type: "custom", label: "旧自定义标记" }], diagnosis: { counts: { posture: 2, gaze: 1, filler: 1, board: 0 }, good: "旧版原点评", next: "旧版原建议" } };
    const before = JSON.stringify(legacy);
    const html = api.buildPrintReport(legacy);
    const sheet = host(); api.renderObserveSheet(sheet, legacy);
    for (const text of ["旧版原点评", "旧版原建议", "旧版未记录", "旧自定义标记", "时间未记录"]) assert.ok(html.includes(text), text);
    assert.ok(!html.includes("观测规则：visual-events/1.0.0"));
    assert.equal(JSON.stringify(legacy), before);
    assert.ok(sheet.innerHTML.includes("旧自定义标记"));
  });
  check("历史趋势缺失项保留未统计，不被图形补成零", () => {
    const html = api.buildPrintReport(real, { trend: [{ label: "旧", values: { posture: null } }, { label: "新", values: { posture: 1 } }] });
    assert.ok(html.includes("<td>未统计</td>"));
    assert.ok(!html.includes("trend-svg"));
  });
  check("仅面部可判时，缺体态的背对写板不显示零秒", () => {
    const faceOnly = { ...real, diagnosis: undefined, frames: frames.map(f => ({ ...f, pose: null })) };
    const r = api.buildObserveReport(faceOnly);
    assert.ok(r.gaze.available);
    assert.equal(r.gaze.backTime, null);
    assert.equal(r.gaze.boardTime, null);
  });
  check("低画面覆盖与无转写分钟分别保持缺失", () => {
    const sparse = { ...real, duration: 120, diagnosis: undefined, frames: frames.map((f, i) => ({ ...f, pose: i < 8 ? pose : null })) };
    const r = api.buildObserveReport(sparse);
    assert.equal(r.hasPose, false);
    assert.ok(r.lesson.rhythm.minutes.every(m => m.move === null && m.gestures === null));
    assert.equal(r.lesson.rhythm.minutes[1].cpm, null);
    assert.equal(r.lesson.rhythm.minutes[1].pause, null);
    const marked = api.buildObserveReport({ ...sparse, speechAvailable: false, observeMarks: { source: "user", segments: [{ start: 0, end: 120, label: "自划段落" }] } });
    assert.equal(marked.structure.source, "user");
  });
  check("真实历史往返后保留观测版本、证据和来源", () => {
    const restored = api.fromRecord(api.toRecord(real));
    const before = JSON.stringify(restored);
    const r = api.buildObserveReport(restored);
    assert.equal(r.observation.observationVersion, real.diagnosis.observation.observationVersion);
    assert.equal(r.observation.evidence[0].t, 12);
    assert.equal(r.source, "local-camera-mediapipe");
    api.buildPrintReport(restored);
    assert.equal(JSON.stringify(restored), before);
  });
  check("来源与自定义文字进行 HTML 转义", () => {
    const unsafe = { ...real, profileName: '<img src=x onerror="x">', diagnosis: undefined, events: [{ t: 4, label: '<script>x</script>', kind: "gaze", type: "gaze" }] };
    const html = api.buildPrintReport(unsafe);
    assert.ok(!html.includes("<script>"));
    assert.ok(html.includes("&lt;script&gt;"));
  });
  check("模块依赖图没有循环", () => {
    const graph = result.metafile.inputs;
    const done = new Set(), active = new Set();
    function visit(key) {
      assert.ok(!active.has(key), `circular dependency: ${key}`);
      if (done.has(key) || !graph[key]) return;
      active.add(key);
      for (const dep of graph[key].imports) if (!dep.external) visit(dep.path);
      active.delete(key); done.add(key);
    }
    for (const key of Object.keys(graph)) visit(key);
  });
  console.log(`\n${passed} targeted report checks passed.`);
} finally {
  delete globalThis.document;
  await rm(tmp, { recursive: true, force: true });
}
