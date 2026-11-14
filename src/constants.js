export const PRODUCT = "试讲体态镜";
export const BRAND = "沉思波 · 体态镜";

export const SUGGESTED_SEC = 120;
export const MIN_STOP_SEC = 15;
export const MAX_SEC = 22 * 60; // 课堂模式上限（建议时长 + 2 分钟，最长 22 分钟）

export const BOARD_SIDE = "right"; // 默认：画面右侧为板书区（可在设置里改）

export const FILLERS = [
  "这个这个",
  "那个那个",
  "就是说",
  "对对对",
  "然后呢",
  "那么",
  "那个",
  "这个",
  "然后",
  "就是",
  "对吧",
  "好吧",
  "是吧",
  "的话",
  "怎么说",
  "那个",
  "嗯嗯",
  "啊啊",
  "呃",
  "额",
  "嗯",
  "啊",
];

export const SINGLE_CHAR_FILLERS = ["呃", "额", "嗯", "啊"];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Longer tokens first so 「就是说」 wins over 「就是」. */
export function buildFillerRe(list) {
  const words = [...new Set((list || []).map((w) => String(w).trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length)
    .map(escapeRe);
  if (!words.length) return null;
  return new RegExp(`(${words.join("|")})`, "g");
}

export const FILLER_RE = buildFillerRe(FILLERS);

/**
 * Analysis runtime: switched per mode. 一键演示 always runs with defaults
 * (right-hand board, medium sensitivity); real sessions use the user's settings.
 * Sensitivity factor: <1 = more sensitive (fires sooner), >1 = more lenient.
 */
export const SENS_FACTOR = { low: 1.4, mid: 1, high: 0.72 };
export const runtime = {
  boardSide: "right",
  sens: { posture: 1, gaze: 1, filler: 1, board: 1 },
  frameMode: "auto",      // auto | half | full（用户选择）
  frameResolved: "half",  // 实际采用的构图
};
export function setRuntime({ boardSide = "right", sens = {}, frameMode, frameResolved } = {}) {
  runtime.boardSide = boardSide === "left" ? "left" : "right";
  for (const k of ["posture", "gaze", "filler", "board"]) {
    runtime.sens[k] = SENS_FACTOR[sens[k]] ?? (typeof sens[k] === "number" ? sens[k] : 1);
  }
  if (frameMode) runtime.frameMode = ["auto", "half", "full"].includes(frameMode) ? frameMode : "auto";
  if (frameResolved) runtime.frameResolved = frameResolved === "full" ? "full" : "half";
  if (frameMode && frameMode !== "auto") runtime.frameResolved = frameMode;
}
export function boardSign() {
  return runtime.boardSide === "left" ? -1 : 1;
}

export const EVENT_META = {
  sway: { label: "晃动", kind: "sway" },
  slouch: { label: "含胸", kind: "posture" },
  hip: { label: "重心偏了", kind: "posture" },
  folded: { label: "抱臂", kind: "posture" },
  out: { label: "走出讲台", kind: "posture" },
  back: { label: "背对学生写板", kind: "posture" },
  pace: { label: "来回走动", kind: "sway" },
  gaze: { label: "视线落下", kind: "gaze" },
  filler: { label: "口头禅", kind: "filler" },
  board: { label: "写板未回视", kind: "board" },
};

export const COLORS = {
  gold: "#e6c98a",
  goldSoft: "rgba(230, 201, 138, 0.85)",
  ink: "#1b1712",
  paper: "#f3eee4",
  cinnabar: "#d3533c",
  teal: "#5fbfb6",
  board: "#e8d6a8",
  skeleton: "rgba(230, 201, 138, 0.92)",
  skeletonWarn: "rgba(211, 83, 60, 0.95)",
  labelBg: "rgba(16, 13, 10, 0.72)",
};

export const POSE = {
  NOSE: 0,
  L_EYE_IN: 1, L_EYE: 2, L_EYE_OUT: 3,
  R_EYE_IN: 4, R_EYE: 5, R_EYE_OUT: 6,
  L_EAR: 7, R_EAR: 8,
  MOUTH_L: 9, MOUTH_R: 10,
  L_SHOULDER: 11, R_SHOULDER: 12,
  L_ELBOW: 13, R_ELBOW: 14,
  L_WRIST: 15, R_WRIST: 16,
  L_PINKY: 17, R_PINKY: 18,
  L_INDEX: 19, R_INDEX: 20,
  L_THUMB: 21, R_THUMB: 22,
  L_HIP: 23, R_HIP: 24,
  L_KNEE: 25, R_KNEE: 26,
  L_ANKLE: 27, R_ANKLE: 28,
  L_HEEL: 29, R_HEEL: 30,
  L_FOOT: 31, R_FOOT: 32,
};

export const POSE_EDGES = [
  [11, 12],
  [11, 13], [13, 15],
  [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 31],
  [24, 26], [26, 28], [28, 32],
  [15, 19], [16, 20],
];

export const STAGE_W = 720;
export const STAGE_H = 1280;

export const PODIUM = { x0: 0.28, x1: 0.72, y0: 0.78, y1: 0.96 };
export const PODIUM_FULL = { x0: 0.32, x1: 0.68, y0: 0.70, y1: 0.96 };
export const BOARD_BOX = { x0: 0.62, y0: 0.16, x1: 0.92, y1: 0.48 };
export const BOARD_BOX_FULL = { x0: 0.58, y0: 0.10, x1: 0.88, y1: 0.38 };
export function podiumBox() {
  return runtime.frameResolved === "full" ? PODIUM_FULL : PODIUM;
}
export function boardBox() {
  if (runtime.frameResolved === "full") {
    const b = BOARD_BOX_FULL;
    if (runtime.boardSide === "left") return { x0: 1 - b.x1, y0: b.y0, x1: 1 - b.x0, y1: b.y1 };
    return b;
  }
  if (runtime.boardSide === "left") return { x0: 1 - BOARD_BOX.x1, y0: BOARD_BOX.y0, x1: 1 - BOARD_BOX.x0, y1: BOARD_BOX.y1 };
  return BOARD_BOX;
}
