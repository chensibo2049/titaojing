import { FILLERS } from "./constants.js";

const KEY = "titaojing.settings.v1";

/** 练习：短试讲，适合日常对着镜头练；课堂：把电脑放在讲台上讲 10–20 分钟。 */
export const SESSION_MODES = {
  practice: { label: "练习", hint: "短试讲，适合日常对着镜头练", mins: [1, 2, 3, 5], defaultMin: 2, minStop: 15, extra: 120, cap: 8 * 60 },
  classroom: { label: "课堂", hint: "把电脑放在讲台或课桌上，讲 10–20 分钟再回看", mins: [10, 15, 20], defaultMin: 15, minStop: 60, extra: 120, cap: 22 * 60 },
};

export const FRAME_MODES = {
  auto: { label: "自动", hint: "开讲后根据画面判断：能看见膝盖、脚踝则为全身，否则为半身" },
  half: { label: "半身", hint: "腰部以上入画，电脑放在讲台上近拍" },
  full: { label: "全身", hint: "从头到脚入画，镜头再远一些，或放在教室侧前方" },
};

export const DEFAULT_SETTINGS = {
  sessionMode: "practice",
  targetMin: 2,
  frameMode: "auto",         // auto | half | full
  asrEngine: "auto",         // auto | webspeech | sherpa
  asrAutoDownload: true,     // 进入页面后在后台下载听写包
  perfMode: "auto",          // auto | smooth（流畅优先）| detail（精细优先）
  sens: { posture: "mid", gaze: "mid", filler: "mid", board: "mid" },
  fillers: FILLERS.slice(),
  boardSide: "right",
  mirror: true,
  speechLang: "zh-CN",
  facing: "user",
  deviceId: "",
  saveVideo: false,
  showMap: true,
  classroomSim: "off",  // off | class | roadshow（练习用模拟，默认关）
  sim3d: "auto",        // auto | on | off（3D 人物；auto 在 WebGL 弱时退回插画）
  stemRequirement: "",  // 开讲页选填的题干要求，供语文观察表对照
};

let cache = null;

export function getSettings() {
  if (cache) return cache;
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (_) {}
  cache = normalize(raw);
  return cache;
}

export function normalize(raw) {
  const s = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  s.sens = { ...DEFAULT_SETTINGS.sens, ...((raw && raw.sens) || {}) };
  for (const k of Object.keys(s.sens)) if (!["low", "mid", "high"].includes(s.sens[k])) s.sens[k] = "mid";
  s.sessionMode = s.sessionMode === "classroom" ? "classroom" : "practice";
  s.frameMode = ["auto", "half", "full"].includes(s.frameMode) ? s.frameMode : "auto";
  s.asrEngine = ["auto", "webspeech", "sherpa"].includes(s.asrEngine) ? s.asrEngine : "auto";
  s.asrAutoDownload = raw && raw.asrAutoDownload === false ? false : true;
  s.perfMode = ["auto", "smooth", "detail"].includes(s.perfMode) ? s.perfMode : "auto";
  const mode = SESSION_MODES[s.sessionMode];
  s.targetMin = Number(s.targetMin) || mode.defaultMin;
  if (!mode.mins.includes(s.targetMin)) s.targetMin = mode.defaultMin;
  if (!Array.isArray(s.fillers)) s.fillers = DEFAULT_SETTINGS.fillers.slice();
  s.fillers = [...new Set(s.fillers.map((w) => String(w).trim()).filter((w) => w && w.length <= 8))].slice(0, 60);
  s.boardSide = s.boardSide === "left" ? "left" : "right";
  s.mirror = !!s.mirror;
  s.saveVideo = !!s.saveVideo;
  s.facing = s.facing === "environment" ? "environment" : "user";
  if (!["zh-CN", "zh-TW", "zh-HK", "en-US"].includes(s.speechLang)) s.speechLang = "zh-CN";
  s.classroomSim = ["class", "roadshow"].includes(s.classroomSim) ? s.classroomSim : "off";
  s.sim3d = ["auto", "on", "off"].includes(s.sim3d) ? s.sim3d : "auto";
  s.stemRequirement = String(s.stemRequirement || "").slice(0, 800);
  return s;
}

export function saveSettings(patch) {
  const merged = { ...getSettings(), ...patch, sens: { ...getSettings().sens, ...(patch.sens || {}) } };
  // 切换练习 / 课堂且时长不在新模式列表里时，改用该模式默认时长
  if (patch.sessionMode && patch.targetMin == null) {
    const mode = SESSION_MODES[merged.sessionMode] || SESSION_MODES.practice;
    if (!mode.mins.includes(merged.targetMin)) merged.targetMin = mode.defaultMin;
  }
  const next = normalize(merged);
  cache = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (_) {}
  return next;
}

export function resetSettings() {
  cache = normalize(null);
  try { localStorage.removeItem(KEY); } catch (_) {}
  return cache;
}

export function timing(s = getSettings()) {
  const mode = SESSION_MODES[s.sessionMode] || SESSION_MODES.practice;
  const suggested = Math.round(s.targetMin * 60);
  return {
    mode: s.sessionMode || "practice",
    suggested,
    minStop: mode.minStop,
    max: Math.min(mode.cap, Math.max(suggested, suggested + mode.extra)),
  };
}
