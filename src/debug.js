/**
 * 调试模式：在网址后加 ?debug=1 打开（例：http://127.0.0.1:8765/?debug=1#/try）。
 *   ?debug=1&trace=1  每次试讲开始时自动记录轨迹，结束后可下载。
 *
 * 面板显示：帧率 / 推理耗时 / 关键点置信度 / 视线与教态判断 / 已触发事件 /
 *          语音识别状态与原始听写 / 模型加载各阶段耗时 / 运行环境。
 * 轨迹 JSON（titaojing-trace v1，格式见 docs/TRACE_FORMAT.md）只含关键点坐标、判断与事件，
 * 不含视频、音频或图片；原始听写文字默认不写入，需在面板里勾选。
 */
import { POSE as P } from "./constants.js";
import { APP_VERSION, BUILD_ID } from "./version.js";

const params = (() => { try { return new URLSearchParams(location.search); } catch (_) { return new URLSearchParams(); } })();
const ON = ["1", "true", "on"].includes((params.get("debug") || "").toLowerCase());
const AUTO_TRACE = ON && ["1", "true", "on"].includes((params.get("trace") || "").toLowerCase());

export const debugEnabled = () => ON;

const KEY_POINTS = [
  ["鼻", P.NOSE], ["左肩", P.L_SHOULDER], ["右肩", P.R_SHOULDER], ["左肘", P.L_ELBOW], ["右肘", P.R_ELBOW],
  ["左腕", P.L_WRIST], ["右腕", P.R_WRIST], ["左髋", P.L_HIP], ["右髋", P.R_HIP],
];
const FACE_IDX = [1, 4, 10, 33, 133, 152, 263, 362, 468, 473];
const r4 = (n) => (Number.isFinite(n) ? Math.round(n * 1e4) / 1e4 : null);
const r2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);

const st = {
  source: "-", t: 0, frameTimes: [], inferMs: [], lastDet: null, gaze: null, flags: {}, onBoard: false,
  faceEvery: 1, events: [], speech: { state: "未启动", detail: "" }, transcripts: [], vision: null,
  rec: null, lastTrace: null, includeText: false, collapsed: true,
};

let panel = null;
let paintTimer = 0;

function el(tag, attrs = {}, html = "") {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (html) e.innerHTML = html;
  return e;
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function initDebug({ getVisionStatus, getEnv, getSettings } = {}) {
  if (!ON || panel) return;
  st.getVisionStatus = getVisionStatus;
  st.getEnv = getEnv;
  st.getSettings = getSettings;
  const css = el("style", {}, `
#tj-debug{position:fixed;top:8px;left:8px;z-index:9999;width:min(340px,calc(100vw - 16px));max-height:calc(100vh - 16px);overflow:auto;
 background:rgba(12,14,18,.86);color:#e8f0e8;font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,"PingFang SC","Microsoft YaHei",monospace;
 border:1px solid rgba(120,255,170,.35);border-radius:8px;padding:8px 10px;box-shadow:0 4px 18px rgba(0,0,0,.4);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}
#tj-debug.min .tjd-body{display:none}
#tj-debug.min{top:auto;bottom:8px;width:auto;max-width:calc(100vw - 16px)}
body:has(.consent-veil:not([hidden])) #tj-debug,body:has(.modal:not([hidden])) #tj-debug{visibility:hidden}
/* 入口页不叠调试条：它固定在底部，会盖住开始练习按钮 */
body:has(#screen-cover:not([hidden])) #tj-debug.min{display:none}
#tj-debug h4{margin:6px 0 2px;font-size:11px;color:#7dffb0;font-weight:600}
#tj-debug .tjd-top{display:flex;gap:6px;align-items:center;justify-content:space-between}
#tj-debug .tjd-top b{color:#7dffb0}
#tj-debug button{font:inherit;background:#22303a;color:#e8f0e8;border:1px solid #3c5566;border-radius:5px;padding:2px 7px;cursor:pointer}
#tj-debug button:disabled{opacity:.45;cursor:default}
#tj-debug button.rec{background:#5a1f22;border-color:#c0444b}
#tj-debug .bar{display:inline-block;height:6px;background:#7dffb0;border-radius:3px;vertical-align:middle}
#tj-debug .bar.lo{background:#ffb35c}#tj-debug .bar.vlo{background:#ff6161}
#tj-debug table{border-collapse:collapse;width:100%}#tj-debug td{padding:0 4px 0 0;white-space:nowrap}
#tj-debug .muted{color:#9fb0a8}#tj-debug .warn{color:#ffb35c}#tj-debug .bad{color:#ff7a7a}
#tj-debug .tx{max-height:84px;overflow:auto;border-left:2px solid #3c5566;padding-left:6px}
#tj-debug label{display:inline-flex;gap:4px;align-items:center}
@media print{#tj-debug{display:none}}`);
  document.head.appendChild(css);
  panel = el("div", { id: "tj-debug", role: "region", "aria-label": "调试面板" });
  panel.classList.add("min");
  panel.innerHTML = `
<div class="tjd-top"><span><b>调试模式</b> <span class="muted">v${esc(APP_VERSION)}</span></span>
 <span><button data-a="rec">● 记录轨迹</button> <button data-a="dl" disabled>下载 JSON</button> <button data-a="min" title="展开或收起诊断">展开 / 收起</button></span></div>
<div class="tjd-body">
 <div data-k="perf"></div>
 <h4>关键点置信度（姿态）</h4><div data-k="conf"></div>
 <h4>判断</h4><div data-k="judge"></div>
 <h4>已触发事件</h4><div data-k="events"></div>
 <h4>语音识别</h4><div data-k="speech"></div>
 <h4>模型加载</h4><div data-k="vision"></div>
 <h4>环境</h4><div data-k="env"></div>
 <div style="margin-top:6px"><label><input type="checkbox" data-a="text"> 轨迹里包含原始听写文字</label></div>
 <div class="muted" data-k="recinfo">轨迹只含关键点坐标与事件，不含视频 / 音频 / 图片。</div>
</div>`;
  document.body.appendChild(panel);
  panel.addEventListener("click", (e) => {
    const a = e.target?.dataset?.a;
    if (a === "min") { st.collapsed = !st.collapsed; panel.classList.toggle("min", st.collapsed); }
    if (a === "rec") { if (st.rec) stopTrace(); else startTrace("manual"); }
    if (a === "dl") downloadTrace();
  });
  panel.addEventListener("change", (e) => { if (e.target?.dataset?.a === "text") st.includeText = e.target.checked; });
  window.__titaojingDebug = { state: st, startTrace, stopTrace, getTrace: () => st.lastTrace || (st.rec && buildTrace(st.rec)) };
  paintTimer = setInterval(paint, 250);
  paint();
}

/* ——— hooks called by the app ——— */

export function debugFrame({ source, t, det, pose, face, gaze, flags, onBoard, faceEvery, events, perf }) {
  if (!ON) return;
  if (perf) st.perf = perf;
  const now = performance.now();
  st.source = source;
  st.t = t;
  st.frameTimes.push(now);
  while (st.frameTimes.length && now - st.frameTimes[0] > 2000) st.frameTimes.shift();
  if (det && Number.isFinite(det.ms)) { st.inferMs.push(det.ms); if (st.inferMs.length > 60) st.inferMs.shift(); }
  const p = pose ?? det?.pose ?? null;
  const f = face ?? det?.face ?? null;
  st.lastDet = { pose: p, face: f, hasMatrix: !!det?.matrix };
  st.gaze = gaze || null;
  st.flags = flags || {};
  st.onBoard = !!onBoard;
  st.faceEvery = faceEvery || 1;
  if (events) st.events = events;
  if (st.rec) {
    st.rec.frames.push({
      t: r4(t),
      ms: det ? r2(det.ms) : null,
      pose: p ? Array.from({ length: 33 }, (_, i) => (p[i] ? [r4(p[i].x), r4(p[i].y), r4(p[i].z || 0), r4(p[i].visibility ?? p[i].v ?? 0)] : null)) : null,
      face: f && f.length ? FACE_IDX.map((i) => { const q = f.find ? (f.length > 20 ? f[i] : f.find((z) => z.i === i)) : null; return q ? [i, r4(q.x), r4(q.y), r4(q.z || 0)] : null; }).filter(Boolean) : null,
      gaze: gaze ? { label: gaze.label, yaw: r4(gaze.yaw), pitch: r4(gaze.pitch) } : null,
      flags: Object.keys(flags || {}).filter((k) => flags[k]),
      onBoard: !!onBoard,
    });
    if (st.rec.frames.length > 60 * 60 * 30) stopTrace(); // 最长约 1 小时 @30fps，防止内存失控
  }
}

export function debugSpeech(kind, detail = "", extra = {}) {
  if (!ON) return;
  const t = st.rec ? r4((performance.now() - st.rec.t0) / 1000) : null;
  if (kind === "transcript") {
    st.transcripts.push({ at: new Date().toLocaleTimeString(), text: detail, final: !!extra.final });
    if (st.transcripts.length > 40) st.transcripts.shift();
    if (st.rec) st.rec.transcripts.push({ t, text: detail, final: !!extra.final });
    return;
  }
  if (kind === "filler") { if (st.rec) st.rec.fillers.push({ t: extra.t ?? t, word: detail }); return; }
  st.speech = { state: kind, detail: String(detail || "") };
  if (st.rec) st.rec.speechLog.push({ t, state: kind, detail: String(detail || "").slice(0, 200) });
}

/** 试讲开始 / 结束时调用。 */
export function debugSessionStart(meta = {}) {
  if (!ON) return;
  st.transcripts = [];
  st.events = [];
  if (AUTO_TRACE) startTrace("auto", meta);
  else if (st.rec) st.rec.meta = { ...st.rec.meta, ...meta };
}
export function debugSessionEnd(session) {
  if (!ON) return;
  if (st.rec) {
    st.rec.sessionEvents = (session?.events || []).map((e) => ({ t: r4(e.t), type: e.type, label: e.label }));
    st.rec.diagnosis = session?.diagnosis ? { counts: session.diagnosis.counts } : null;
    st.rec.stats = session?.stats || null;
    if (st.rec.mode === "auto") stopTrace();
  }
}

/* ——— trace ——— */

export function startTrace(mode = "manual", meta = {}) {
  if (!ON) return;
  st.rec = { mode, t0: performance.now(), startedAt: new Date().toISOString(), frames: [], fillers: [], transcripts: [], speechLog: [], meta, sessionEvents: null };
  st.lastTrace = null;
  syncButtons();
}

export function stopTrace() {
  if (!st.rec) return null;
  st.lastTrace = buildTrace(st.rec);
  st.rec = null;
  syncButtons();
  return st.lastTrace;
}

function buildTrace(rec) {
  const env = st.getEnv ? st.getEnv() : {};
  const v = st.getVisionStatus ? st.getVisionStatus() : null;
  const s = st.getSettings ? st.getSettings() : {};
  return {
    format: "titaojing-trace",
    formatVersion: 1,
    id: (crypto.randomUUID ? crypto.randomUUID() : `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`),
    app: { name: "沉思波 · 体态镜", version: APP_VERSION, buildId: BUILD_ID },
    createdAt: new Date().toISOString(),
    startedAt: rec.startedAt,
    source: st.source,
    synthetic: st.source === "demo",
    device: {
      ua: env.ua || navigator.userAgent, ios: !!env.ios, android: !!env.android, wechat: !!env.wechat,
      screen: [screen.width, screen.height, window.devicePixelRatio || 1],
    },
    vision: v ? { delegate: v.delegate, loadMs: v.loadMs, timings: v.timings || null, error: v.error || null } : null,
    settings: { boardSide: s.boardSide, sens: s.sens, mirror: s.mirror, speechLang: s.speechLang },
    meta: rec.meta || {},
    poseLandmarkOrder: "MediaPipe Pose 33（BlazePose），坐标为画面归一化 [x,y,z,visibility]，已按镜像处理",
    faceSubset: FACE_IDX,
    frames: rec.frames,
    fillers: rec.fillers,
    transcripts: st.includeText ? rec.transcripts : [],
    transcriptsIncluded: !!st.includeText,
    speechLog: rec.speechLog,
    events: rec.sessionEvents || (st.events || []).map((e) => ({ t: r4(e.t), type: e.type, label: e.label })),
    diagnosis: rec.diagnosis || null,
    stats: rec.stats || null,
  };
}

function downloadTrace() {
  const tr = st.lastTrace;
  if (!tr) return;
  const blob = new Blob([JSON.stringify(tr)], { type: "application/json" });
  const a = document.createElement("a");
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  a.href = URL.createObjectURL(blob);
  a.download = `titaojing-trace-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function syncButtons() {
  if (!panel) return;
  const rec = panel.querySelector('[data-a="rec"]');
  rec.textContent = st.rec ? "■ 停止记录" : "● 记录轨迹";
  rec.classList.toggle("rec", !!st.rec);
  panel.querySelector('[data-a="dl"]').disabled = !st.lastTrace;
}

/* ——— painting ——— */

function bar(v) {
  const w = Math.max(2, Math.round((v || 0) * 70));
  const cls = v < 0.5 ? "vlo" : v < 0.8 ? "lo" : "";
  return `<span class="bar ${cls}" style="width:${w}px"></span>`;
}

function paint() {
  if (!panel || st.collapsed) return;
  const set = (k, html) => { const n = panel.querySelector(`[data-k="${k}"]`); if (n && n.innerHTML !== html) n.innerHTML = html; };
  const now = performance.now();
  const ft = st.frameTimes.filter((x) => now - x < 2000);
  const fps = ft.length > 1 ? (ft.length - 1) / ((ft[ft.length - 1] - ft[0]) / 1000) : 0;
  const stale = !ft.length || now - ft[ft.length - 1] > 1000;
  const avgMs = st.inferMs.length ? st.inferMs.reduce((a, b) => a + b, 0) / st.inferMs.length : 0;
  set("perf", `<table><tr><td>来源</td><td><b>${esc(st.source === "demo" ? "demo（合成）" : st.source)}</b>${stale ? ' <span class="muted">（无新帧）</span>' : ""}</td><td>t</td><td>${st.t.toFixed(1)}s</td></tr>
<tr><td>帧率</td><td class="${fps && fps < 12 ? "warn" : ""}">${stale ? "-" : fps.toFixed(1)} fps</td><td>推理</td><td>${avgMs ? avgMs.toFixed(1) + " ms" : "-"}</td></tr>
${st.perf ? `<tr><td>档位</td><td>${esc(st.perf.level)}（${esc(st.perf.mode)}）</td><td>目标</td><td>${st.perf.targetFps} fps</td></tr>
<tr><td>姿态</td><td>${st.perf.msPose.toFixed(1)} ms · ${esc(st.perf.delegate?.pose || "-")}</td><td>面部</td><td>${st.perf.msFace.toFixed(1)} ms · ${esc(st.perf.delegate?.face || "-")}</td></tr>
<tr><td>手部</td><td>${st.perf.msHands.toFixed(1)} ms · 每 ${st.perf.handEvery} 帧</td><td>GPU</td><td class="${st.perf.delegate?.pose === "CPU" ? "warn" : ""}">${st.perf.delegate?.pose === "CPU" ? "已改用 CPU" : "GPU"}</td></tr>` : ""}
<tr><td>面部频率</td><td>每 ${st.faceEvery} 帧</td><td>记录</td><td>${st.rec ? `<span class="bad">● ${st.rec.frames.length} 帧</span>` : st.lastTrace ? `${st.lastTrace.frames.length} 帧待下载` : "-"}</td></tr></table>`);

  const pose = st.lastDet?.pose;
  if (pose) {
    const vs = KEY_POINTS.map(([, i]) => (pose[i] ? (pose[i].visibility ?? pose[i].v ?? 0) : 0));
    const mean = vs.reduce((a, b) => a + b, 0) / vs.length;
    set("conf", `<table>${KEY_POINTS.map(([n], k) => `<tr><td>${n}</td><td>${bar(vs[k])}</td><td>${vs[k].toFixed(2)}</td></tr>`).join("")}
<tr><td class="muted">平均</td><td>${bar(mean)}</td><td>${mean.toFixed(2)}</td></tr></table>
<div class="muted">面部点：${st.lastDet.face ? st.lastDet.face.length : 0}${st.lastDet.hasMatrix ? " · 有头部矩阵" : ""}</div>`);
  } else set("conf", `<span class="warn">本帧未检测到人</span> <span class="muted">（面部点：${st.lastDet?.face ? st.lastDet.face.length : 0}）</span>`);

  const g = st.gaze;
  const flags = Object.keys(st.flags || {}).filter((k) => st.flags[k]);
  set("judge", `视线 <b>${esc(g?.label || "-")}</b> <span class="muted">yaw ${g ? g.yaw.toFixed(2) : "-"} · pitch ${g ? g.pitch.toFixed(2) : "-"}</span><br>
教态标记 ${flags.length ? flags.map((f) => `<span class="warn">${esc(f)}</span>`).join(" ") : '<span class="muted">无</span>'} · 板书 ${st.onBoard ? "<b>是</b>" : "否"}`);

  const ev = (st.events || []).slice(-8).reverse();
  set("events", ev.length ? ev.map((e) => `<div>${e.t.toFixed(1)}s · <b>${esc(e.label)}</b> <span class="muted">${esc(e.type)}</span></div>`).join("") : '<span class="muted">暂无</span>');

  const sp = st.speech;
  const spCls = /error|不支持|失败|not-allowed|network/.test(sp.state + sp.detail) ? "bad" : sp.state === "listening" ? "" : "muted";
  const tx = st.transcripts.slice(-8).reverse();
  set("speech", `状态 <span class="${spCls}">${esc(sp.state)}</span> ${sp.detail ? `<span class="muted">${esc(sp.detail)}</span>` : ""}
<div class="tx">${tx.length ? tx.map((x) => `<div${x.final ? "" : ' class="muted"'}>${esc(x.at)} ${x.final ? "■" : "□"} ${esc(x.text)}</div>`).join("") : '<span class="muted">（还没有听写结果；■ 定稿 □ 临时）</span>'}</div>`);

  const v = st.getVisionStatus ? st.getVisionStatus() : null;
  if (v) {
    const tm = v.timings || {};
    set("vision", `阶段 <b>${esc(v.phase)}</b> · 姿态 ${v.pose ? "✓" : "✗"}${v.delegate?.pose ? " " + v.delegate.pose : ""} · 面部 ${v.face ? "✓" : "✗"}${v.delegate?.face ? " " + v.delegate.face : ""}<br>
下载 ${tm.downloadMs ?? "-"} ms · 姿态模型（含 WASM 初始化）${tm.poseMs ?? "-"} ms · 面部模型 ${tm.faceMs ?? "-"} ms · 合计 ${v.loadMs || "-"} ms${tm.simd === false ? " · 无 SIMD" : ""}
${v.error ? `<div class="bad">${esc(v.error)}</div>` : ""}`);
  }
  if (st.getEnv) {
    const e = st.getEnv();
    set("env", `构建 ${esc(BUILD_ID)}<br>${e.secure ? "安全上下文 ✓" : '<span class="bad">非安全上下文</span>'} · 摄像头 API ${e.hasMedia ? "✓" : "✗"} · 录制 ${e.hasRecorder ? "✓" : "✗"} · 语音 ${("webkitSpeechRecognition" in window || "SpeechRecognition" in window) ? "✓" : "✗"}${e.wechat ? ' · <span class="warn">微信内置浏览器</span>' : ""}<br><span class="muted">${esc((e.ua || "").slice(0, 140))}</span>`);
  }
  set("recinfo", st.rec ? `正在记录：${st.rec.frames.length} 帧（不含视频 / 音频 / 图片）` : st.lastTrace ? `已记录 ${st.lastTrace.frames.length} 帧，点「下载 JSON」附在反馈里。` : "轨迹只含关键点坐标与事件，不含视频 / 音频 / 图片。");
}
