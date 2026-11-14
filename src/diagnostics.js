/** Anonymous diagnostics for tester feedback. Never includes video, audio, or images. */
import { APP_VERSION, BUILD_DATE, BUILD_ID } from "./version.js";
import { envInfo, wakeLockSupported } from "./camera.js";
import { speechSupported } from "./speech.js";
import { visionStatus } from "./vision.js";
import { getSettings } from "./settings.js";
import { getLicense } from "./license.js";
import { usage, listSessions } from "./store.js";

const errors = [];
const events = [];
let lastSessionStats = null;

export function logEvent(type, detail = "") {
  events.push({ at: new Date().toISOString(), type, detail: String(detail).slice(0, 300) });
  if (events.length > 60) events.shift();
}

export function setLastSessionStats(s) {
  lastSessionStats = s;
}

function pushError(kind, msg, src) {
  errors.push({ at: new Date().toISOString(), kind, msg: String(msg || "").slice(0, 400), src: String(src || "").slice(0, 200) });
  if (errors.length > 30) errors.shift();
}

export function installErrorCapture() {
  window.addEventListener("error", (e) => pushError("error", e.message, `${e.filename || ""}:${e.lineno || ""}`));
  window.addEventListener("unhandledrejection", (e) => pushError("promise", e.reason && (e.reason.message || e.reason)));
}

export function capturedErrors() {
  return errors.slice();
}

function pickMime() {
  const types = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
  if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return "";
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || "";
}

function webgl() {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    if (!gl) return "none";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const r = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return `${gl instanceof (window.WebGL2RenderingContext || Object) ? "webgl2" : "webgl"} · ${String(r).slice(0, 80)}`;
  } catch (_) {
    return "error";
  }
}

export async function collectDiagnostics() {
  const e = envInfo();
  let swState = "unsupported";
  if ("serviceWorker" in navigator) {
    swState = navigator.serviceWorker.controller ? "controlled" : "not-controlling";
  }
  let store = null, recent = [];
  try {
    store = await usage();
    const list = await listSessions();
    recent = list.slice(0, 5).map((s) => ({
      kind: s.kind,
      startedAt: new Date(s.startedAt).toISOString(),
      duration: s.metrics?.duration,
      counts: { posture: s.metrics?.posture, gaze: s.metrics?.gaze, filler: s.metrics?.filler, board: s.metrics?.board },
      speech: s.speechAvailable,
      vision: s.visionAvailable,
      hasVideo: s.hasVideo,
      stats: s.stats,
      appVersion: s.appVersion,
    }));
  } catch (_) {}
  const s = getSettings();
  const lic = getLicense();
  return {
    app: { name: "沉思波 · 体态镜", version: APP_VERSION, build: BUILD_ID, buildDate: BUILD_DATE, edition: lic.edition },
    time: new Date().toISOString(),
    timezoneOffsetMin: new Date().getTimezoneOffset(),
    device: {
      userAgent: e.ua,
      platform: navigator.platform || "",
      language: navigator.language,
      screen: `${screen.width}x${screen.height}@${window.devicePixelRatio || 1}`,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      orientation: (screen.orientation && screen.orientation.type) || (window.innerWidth > window.innerHeight ? "landscape" : "portrait"),
      cores: navigator.hardwareConcurrency || 0,
      memoryGB: navigator.deviceMemory || 0,
      touch: navigator.maxTouchPoints || 0,
      inApp: e.wechat ? "wechat" : e.qq ? "qq" : "",
      standalone: window.matchMedia && window.matchMedia("(display-mode: standalone)").matches,
    },
    capabilities: {
      secureContext: e.secure,
      protocol: location.protocol,
      getUserMedia: e.hasMedia,
      mediaRecorder: e.hasRecorder,
      recorderMime: pickMime(),
      speechRecognition: speechSupported(),
      wakeLock: wakeLockSupported(),
      indexedDB: "indexedDB" in window,
      serviceWorker: swState,
      webgl: webgl(),
    },
    vision: visionStatus(),
    settings: { targetMin: s.targetMin, sens: s.sens, boardSide: s.boardSide, mirror: s.mirror, speechLang: s.speechLang, facing: s.facing, saveVideo: s.saveVideo, fillerCount: s.fillers.length },
    storage: store,
    lastSession: lastSessionStats,
    recentSessions: recent,
    errors: capturedErrors(),
    events: events.slice(-30),
  };
}

export function diagnosticsToText(d, form) {
  const lines = [];
  lines.push("【体态镜 测试反馈】");
  lines.push(`类型：${form.category || "-"}`);
  if (form.where) lines.push(`发生在：${form.where}`);
  lines.push(`描述：${form.description || "（未填写）"}`);
  if (form.steps) lines.push(`复现步骤：${form.steps}`);
  if (form.contact) lines.push(`联系方式：${form.contact}`);
  lines.push("");
  lines.push("—— 自动附带（匿名，不含视频 / 声音 / 图片）——");
  lines.push(`版本：v${d.app.version}（${d.app.buildDate} · ${d.app.build}）${d.app.edition === "pro" ? "正式版" : "试用版"}`);
  lines.push(`时间：${d.time}`);
  lines.push(`设备：${d.device.userAgent}`);
  lines.push(`屏幕：${d.device.screen}，视口 ${d.device.viewport}，${d.device.orientation}${d.device.inApp ? `，App 内置浏览器：${d.device.inApp}` : ""}`);
  const c = d.capabilities;
  lines.push(`能力：https=${c.secureContext} 摄像头=${c.getUserMedia} 录像=${c.mediaRecorder}(${c.recorderMime || "无"}) 语音识别=${c.speechRecognition} 防息屏=${c.wakeLock} SW=${c.serviceWorker}`);
  lines.push(`WebGL：${c.webgl}`);
  lines.push(`模型：pose=${d.vision.pose}(${d.vision.delegate.pose || "-"}) face=${d.vision.face}(${d.vision.delegate.face || "-"}) 加载=${d.vision.loadMs}ms ${d.vision.error ? "错误=" + d.vision.error : ""}`);
  if (d.lastSession) lines.push(`最近一次：${JSON.stringify(d.lastSession)}`);
  if (d.storage) lines.push(`本机历史：${d.storage.count} 条，录像 ${d.storage.videos} 段`);
  if (d.errors.length) {
    lines.push("错误记录：");
    for (const e of d.errors.slice(-8)) lines.push(`  ${e.at} ${e.kind} ${e.msg} ${e.src}`);
  }
  return lines.join("\n");
}
