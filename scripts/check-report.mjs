import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import vm from "node:vm";
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
    stdin: { contents: `export * from './src/observe.js'; export * from './src/report.js'; export * from './src/observe-ui.js'; export * from './src/records.js'; export { diagnose } from './src/analyze.js'; export { bakeDemoSession } from './src/demo.js'; export { INDICATORS, trendSvg } from './src/chart.js';`, resolveDir: root },
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
  // Run the actual page functions with only DOM/storage dependencies stubbed.
  // Do not duplicate their arithmetic or rendering logic in the test.
  const pageSource = (await readFile(path.join(root, "src/pages.js"), "utf8"))
    .replace(/^import .*;\r?\n/gm, "")
    .replace(/^export \{[^\n]*\};?\r?\n/gm, "")
    .replace(/^export /gm, "");
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { ...host(), listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } });
    return elements.get(id);
  };
  let stored = [], chartCalls = 0;
  const legend = { checked: true, dataset: { k: "filler" }, addEventListener(type, fn) { this.change = fn; } };
  element("compare-body").querySelectorAll = () => [legend];
  const pages = vm.createContext({
    $: element, esc: value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]),
    fmtDate: api.fmtDate, fmtShortDate: api.fmtShortDate, fmtDur: api.fmtDur, fmtBytes: api.fmtBytes,
    INDICATORS: api.INDICATORS,
    trendSvg(points, options) {
      chartCalls++;
      assert.ok(points.every(p => api.INDICATORS.every(i => Number.isFinite(p.values[i.key]))), "chart must not receive missing data");
      return api.trendSvg(points, options);
    },
    listSessions: async () => stored,
    usage: async () => ({ videos: 0, sessionsBytes: 0, videoBytes: 0 }),
    getLicense: () => ({ label: "测试", features: { compare: true, maxHistory: Infinity } }),
  });
  vm.runInContext(pageSource, pages);
  const metricRecord = (id, startedAt, value) => ({
    id, kind: "camera", startedAt, duration: 60,
    metrics: { duration: 60, ...Object.fromEntries(api.INDICATORS.map(i => [i.key, value])), perMin: Object.fromEntries(api.INDICATORS.map(i => [i.key, value])), classRatio: value === null ? null : 0 },
    diagnosis: { next: "保留旧建议", counts: { filler: value } },
  });
  const oldMetric = metricRecord("old-1", 1700000000000, 2);
  const missingMetric = metricRecord("new-1", 1700000060000, null);
  stored = [missingMetric, oldMetric];
  const storedBefore = JSON.stringify(stored);
  await pages.renderHistory({});
  check("真实历史函数显示未统计，保留已知值且不改存储", () => {
    const html = element("history-list").innerHTML;
    assert.equal((html.match(/<b>未统计<\/b>/g) || []).length, 4);
    assert.ok(html.includes("<b>2</b>"));
    assert.equal(JSON.stringify(stored), storedBefore);
  });
  await pages.renderCompare({});
  check("真实对比函数不把缺失次数、频率或朝向判为改善", () => {
    const html = element("compare-body").innerHTML;
    assert.equal((html.match(/未统计，无法比较/g) || []).length, 5);
    assert.ok(!html.includes("少了 2.0"));
    assert.ok(!html.includes("null"));
    assert.ok(!html.includes("undefined"));
    assert.ok(html.includes("不绘制补零趋势"));
    assert.equal(chartCalls, 0);
    assert.equal(JSON.stringify(stored), storedBefore);
    legend.checked = false;
    legend.change();
    assert.ok(element("trend-host").innerHTML.includes("未统计"));
    assert.equal(chartCalls, 0, "legend redraw must also avoid the chart");
    legend.checked = true;
  });
  for (const [name, values] of [["较早缺失", [null, 2]], ["两次均缺失", [null, null]]]) {
    stored = [metricRecord("new-1", 1700000060000, values[1]), metricRecord("old-1", 1700000000000, values[0])];
    await pages.renderCompare({});
    check(`真实对比函数在${name}时也不判断改善或变差`, () => {
      const html = element("compare-body").innerHTML;
      assert.equal((html.match(/未统计，无法比较/g) || []).length, 5);
      assert.ok(!html.includes('class="delta better"'));
      assert.ok(!html.includes('class="delta worse"'));
      assert.equal(chartCalls, 0);
    });
  }
  stored = [missingMetric, metricRecord("zero-1", 1700000000000, 0)];
  await pages.renderCompare({});
  check("缺失趋势表同时保留未统计和真实零值", () => {
    const html = element("compare-body").innerHTML;
    assert.ok(html.includes("<td>未统计</td>"));
    assert.ok(html.includes("<td>0</td>"));
    assert.equal(chartCalls, 0);
  });
  const zeroMetric = metricRecord("zero-1", 1700000060000, 0);
  stored = [zeroMetric, oldMetric];
  await pages.renderHistory({});
  await pages.renderCompare({});
  check("真实数值零在列表、对比、朝向与完整趋势中仍保留", () => {
    assert.equal((element("history-list").innerHTML.match(/<b>0<\/b>/g) || []).length, 4);
    const html = element("compare-body").innerHTML;
    assert.ok(html.includes("0 次 <small>0/分</small>"));
    assert.ok(html.includes("少了 2.0 次/分"));
    assert.ok(html.includes("<td>0%</td>"));
    assert.ok(!html.includes("未统计，无法比较"));
    assert.equal(chartCalls, 1);
  });
  stored = [{ ...missingMetric, metrics: { duration: null } }, oldMetric];
  await pages.renderHistory({});
  await pages.renderCompare({});
  check("旧记录缺少数值字段也不会补零或使对比崩溃", () => {
    assert.ok(element("history-list").innerHTML.includes("未统计"));
    assert.equal((element("compare-body").innerHTML.match(/未统计，无法比较/g) || []).length, 5);
    assert.equal(chartCalls, 1);
  });
  check("真实 JSON 清洗函数保留缺失、零与无时间事件，不修改原记录", () => {
    const imported = JSON.parse(JSON.stringify({
      ...missingMetric, duration: null,
      metrics: { duration: null, posture: 0, gaze: null, filler: "", perMin: { posture: 0, gaze: null, filler: false }, classRatio: null, notesRatio: 0 },
      diagnosis: { good: "旧点评", next: "旧建议", counts: { posture: 0, gaze: null }, classRatio: null },
      events: [{ t: null, label: "无时间" }, { label: "未记录时间" }, { t: 0, label: "零秒" }],
    }));
    const before = JSON.stringify(imported);
    const clean = pages.sanitizeRecord(imported);
    for (const key of ["gaze", "filler", "board"]) {
      assert.equal(clean.metrics[key], null, key);
      assert.equal(clean.metrics.perMin[key], null, key);
      assert.equal(clean.diagnosis.counts[key], null, key);
    }
    assert.equal(clean.duration, null);
    assert.equal(clean.metrics.duration, null);
    assert.equal(clean.diagnosis.duration, null);
    assert.equal(clean.metrics.classRatio, null);
    assert.equal(clean.diagnosis.classRatio, null);
    assert.equal(clean.metrics.posture, 0);
    assert.equal(clean.metrics.perMin.posture, 0);
    assert.equal(clean.metrics.notesRatio, 0);
    assert.equal(clean.diagnosis.counts.posture, 0);
    assert.equal(clean.events[0].t, null);
    assert.equal(clean.events[1].t, null);
    assert.equal(clean.events[2].t, 0);
    assert.equal(clean.diagnosis.good, "旧点评");
    assert.equal(JSON.stringify(imported), before);
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
