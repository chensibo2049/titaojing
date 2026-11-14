import { STAGE_W, STAGE_H, POSE as P } from "./constants.js";

const SKIN = "#e2c2a6";
const SKIN_SH = "#c9a184";
const HAIR = "#1a1410";
const JACKET = "#2c3848";
const JACKET_DK = "#222c38";
const SHIRT = "#efe7d6";
const TROUSER = "#2a2723";
const SHOE = "#171513";

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function ease(t) { return t * t * (3 - 2 * t); }

export function mixParams(a, b, t) {
  const o = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const av = a[k] ?? 0, bv = b[k] ?? 0;
    if (typeof av === "string" || typeof bv === "string") o[k] = t > 0.5 ? (b[k] ?? a[k]) : (a[k] ?? b[k]);
    else o[k] = lerp(av, bv, t);
  }
  return o;
}

export const REST = {
  swayX: 0,
  weight: 0,
  slouch: 0,
  stepX: 0,
  bodyYaw: 0,
  headYaw: 0,
  headPitch: 0,
  headRoll: 0,
  lArm: 0, // 0 rest, 1 notes (hold booklet), 2 gesture, 3 folded
  rArm: 0, // 0 rest, 1 notes, 2 gesture, 3 write, 4 folded
  blink: 0,
  breath: 0,
  chalk: 0,
  gazeX: 0,
  gazeY: 0,
  speak: 0,
};

/** Build a kinematic rig in normalized 0–1 coordinates (y down). */
export function buildRig(p, t = 0) {
  const breath = Math.sin((t || 0) * 2.1) * 0.004 * (0.6 + (p.breath ?? 1));
  const cx = 0.50 + p.swayX + p.stepX * 0.08;
  const yaw = clamp(p.bodyYaw, 0, 1);
  // Facing the right-hand board: body shifts slightly right, shoulders collapse in x.
  const hipY = 0.655 + p.slouch * 0.012;
  const weight = p.weight;
  const lHip = { x: cx - 0.055 + weight * 0.02, y: hipY + Math.max(0, -weight) * 0.04 };
  const rHip = { x: cx + 0.055 + weight * 0.02 + yaw * 0.01, y: hipY + Math.max(0, weight) * 0.04 };
  const midHip = { x: (lHip.x + rHip.x) / 2, y: (lHip.y + rHip.y) / 2 };

  const torso = 0.175 - p.slouch * 0.03 + breath;
  const midSh = {
    x: midHip.x + yaw * 0.045 - p.slouch * 0.01 + weight * 0.035,
    y: midHip.y - torso,
  };
  const shSpan = 0.088 * (1 - yaw * 0.45);
  const lSh = { x: midSh.x - shSpan - yaw * 0.01, y: midSh.y + 0.006 };
  const rSh = { x: midSh.x + shSpan + yaw * 0.03, y: midSh.y - yaw * 0.004 };

  // Legs. Weight-bearing leg slightly straight.
  const lKnee = { x: lHip.x - 0.01 - weight * 0.015, y: 0.775 };
  const rKnee = { x: rHip.x + 0.01 + weight * 0.015, y: 0.775 };
  const lAnkle = { x: lKnee.x - 0.005 + p.stepX * -0.02, y: 0.868 };
  const rAnkle = { x: rKnee.x + 0.005 + p.stepX * 0.03, y: 0.868 };
  const lFoot = { x: lAnkle.x + 0.012, y: 0.895 };
  const rFoot = { x: rAnkle.x + 0.016, y: 0.895 };
  const lHeel = { x: lAnkle.x - 0.012, y: 0.890 };
  const rHeel = { x: rAnkle.x - 0.012, y: 0.890 };

  const lArm = armPose("L", lSh, p.lArm, yaw, p);
  const rArm = armPose("R", rSh, p.rArm, yaw, p);

  const neck = { x: midSh.x + yaw * 0.02, y: midSh.y - 0.028 };
  const head = {
    x: neck.x + p.headYaw * 0.035 + yaw * 0.02,
    y: neck.y - 0.055 + p.headPitch * 0.04 + p.slouch * 0.01,
  };
  const nose = {
    x: head.x + (p.headYaw + yaw * 0.6) * 0.028,
    y: head.y - 0.004 + p.headPitch * 0.05,
  };
  const lEye = { x: head.x - 0.016 + p.headYaw * 0.02, y: head.y - 0.006 + p.headPitch * 0.01 };
  const rEye = { x: head.x + 0.016 + p.headYaw * 0.02, y: head.y - 0.006 + p.headPitch * 0.01 };
  const lEar = { x: head.x - 0.028 - yaw * 0.01, y: head.y };
  const rEar = { x: head.x + 0.028 + yaw * 0.02, y: head.y };
  const mouthL = { x: nose.x - 0.01, y: nose.y + 0.018 + (p.speak || 0) * 0.004 };
  const mouthR = { x: nose.x + 0.01, y: nose.y + 0.018 + (p.speak || 0) * 0.004 };

  return {
    p, yaw,
    lHip, rHip, midHip, lSh, rSh, midSh, neck, head, nose,
    lEye, rEye, lEar, rEar, mouthL, mouthR,
    lKnee, rKnee, lAnkle, rAnkle, lFoot, rFoot, lHeel, rHeel,
    ...lArm, ...rArm,
  };
}

function armPose(side, sh, mode, yaw, p) {
  const s = side === "L" ? -1 : 1;
  const prefix = side === "L" ? "l" : "r";
  let elbow, wrist, index;
  // mode is a float; we blend nearby presets.
  const m = mode || 0;
  // rest
  const restE = { x: sh.x + s * 0.035, y: sh.y + 0.12 };
  const restW = { x: sh.x + s * 0.03, y: sh.y + 0.22 };
  // notes: hold a booklet at mid-torso
  const notesE = { x: sh.x + s * 0.06, y: sh.y + 0.11 };
  const notesW = { x: 0.50 + s * 0.03 + p.swayX, y: sh.y + 0.16 };
  // open gesture
  const gestE = { x: sh.x + s * 0.10, y: sh.y + 0.08 };
  const gestW = { x: sh.x + s * 0.16, y: sh.y + 0.04 };
  // write (right arm mainly): reach to the board
  const writeE = { x: sh.x + 0.10 + yaw * 0.06, y: sh.y + 0.04 };
  const writeW = { x: 0.70 + yaw * 0.08, y: 0.30 + Math.sin((p.chalk || 0) * 18) * 0.01 };
  // folded
  const foldE = { x: sh.x + s * 0.05, y: sh.y + 0.10 };
  const foldW = { x: 0.50 - s * 0.04 + p.swayX, y: sh.y + 0.13 };

  const presets = [ [restE, restW], [notesE, notesW], [gestE, gestW], [writeE, writeW], [foldE, foldW] ];
  // lArm modes: 0 rest, 1 notes, 2 gesture, 3 folded  (folded maps to preset 4)
  // rArm modes: 0 rest, 1 notes, 2 gesture, 3 write, 4 folded
  let i0, i1, ft;
  if (side === "L") {
    const map = [0, 1, 2, 4];
    const mf = clamp(m, 0, 3);
    i0 = map[Math.floor(mf)];
    i1 = map[Math.min(3, Math.ceil(mf))];
    ft = mf - Math.floor(mf);
  } else {
    const mf = clamp(m, 0, 4);
    i0 = Math.floor(mf);
    i1 = Math.min(4, Math.ceil(mf));
    ft = mf - Math.floor(mf);
  }
  elbow = { x: lerp(presets[i0][0].x, presets[i1][0].x, ft), y: lerp(presets[i0][0].y, presets[i1][0].y, ft) };
  wrist = { x: lerp(presets[i0][1].x, presets[i1][1].x, ft), y: lerp(presets[i0][1].y, presets[i1][1].y, ft) };
  index = { x: wrist.x + s * 0.012, y: wrist.y + 0.012 };
  const pinky = { x: wrist.x - s * 0.01, y: wrist.y + 0.014 };
  const thumb = { x: wrist.x + s * 0.008, y: wrist.y + 0.002 };
  return {
    [prefix + "Elbow"]: elbow,
    [prefix + "Wrist"]: wrist,
    [prefix + "Index"]: index,
    [prefix + "Pinky"]: pinky,
    [prefix + "Thumb"]: thumb,
  };
}


/** 全身构图：把人物缩小并下移，让头和脚都留出空间；半身略微上移，更接近讲台近景。 */
export function applyShot(rig, shot = "half") {
  if (!rig) return rig;
  const map = shot === "full"
    ? (pt) => pt && { ...pt, x: 0.5 + (pt.x - 0.5) * 0.62, y: 0.14 + pt.y * 0.74 }
    : (pt) => pt && { ...pt, x: pt.x, y: (pt.y - 0.06) * 1.12 };
  const out = { ...rig, shot };
  for (const k of Object.keys(rig)) {
    const v = rig[k];
    if (v && typeof v === "object" && typeof v.x === "number" && typeof v.y === "number") out[k] = map(v);
  }
  return out;
}

export function landmarksFromRig(rig) {
  const pts = new Array(33);
  const put = (i, p, v = 0.99) => {
    pts[i] = { x: p.x, y: p.y, z: 0, visibility: v, v };
  };
  put(P.NOSE, rig.nose);
  put(P.L_EYE_IN, { x: rig.lEye.x + 0.006, y: rig.lEye.y });
  put(P.L_EYE, rig.lEye);
  put(P.L_EYE_OUT, { x: rig.lEye.x - 0.006, y: rig.lEye.y });
  put(P.R_EYE_IN, { x: rig.rEye.x - 0.006, y: rig.rEye.y });
  put(P.R_EYE, rig.rEye);
  put(P.R_EYE_OUT, { x: rig.rEye.x + 0.006, y: rig.rEye.y });
  put(P.L_EAR, rig.lEar, 0.9 - rig.yaw * 0.3);
  put(P.R_EAR, rig.rEar, 0.9 + rig.yaw * 0.1);
  put(P.MOUTH_L, rig.mouthL);
  put(P.MOUTH_R, rig.mouthR);
  put(P.L_SHOULDER, rig.lSh);
  put(P.R_SHOULDER, rig.rSh);
  put(P.L_ELBOW, rig.lElbow);
  put(P.R_ELBOW, rig.rElbow);
  put(P.L_WRIST, rig.lWrist);
  put(P.R_WRIST, rig.rWrist);
  put(P.L_PINKY, rig.lPinky);
  put(P.R_PINKY, rig.rPinky);
  put(P.L_INDEX, rig.lIndex);
  put(P.R_INDEX, rig.rIndex);
  put(P.L_THUMB, rig.lThumb);
  put(P.R_THUMB, rig.rThumb);
  put(P.L_HIP, rig.lHip);
  put(P.R_HIP, rig.rHip);
  put(P.L_KNEE, rig.lKnee);
  put(P.R_KNEE, rig.rKnee);
  put(P.L_ANKLE, rig.lAnkle);
  put(P.R_ANKLE, rig.rAnkle);
  put(P.L_HEEL, rig.lHeel);
  put(P.R_HEEL, rig.rHeel);
  put(P.L_FOOT, rig.lFoot);
  put(P.R_FOOT, rig.rFoot);
  return pts;
}

/** Minimal face-like landmarks for gaze extraction. */
export function faceFromRig(rig) {
  const face = new Array(478);
  const set = (i, x, y) => { face[i] = { x, y, z: 0 }; };
  const h = rig.head, n = rig.nose, yaw = (rig.p.headYaw || 0) + rig.yaw * 0.6;
  const pitch = rig.p.headPitch || 0;
  set(1, n.x, n.y);
  set(4, n.x, n.y - 0.004);
  set(10, h.x, h.y - 0.04);
  set(152, h.x, h.y + 0.038);
  set(33, rig.lEye.x - 0.01, rig.lEye.y);
  set(133, rig.lEye.x + 0.01, rig.lEye.y);
  set(263, rig.rEye.x + 0.01, rig.rEye.y);
  set(362, rig.rEye.x - 0.01, rig.rEye.y);
  // irises follow gaze
  set(468, rig.lEye.x + (rig.p.gazeX || 0) * 0.008 + yaw * 0.004, rig.lEye.y + (rig.p.gazeY || 0) * 0.006 + pitch * 0.006);
  set(473, rig.rEye.x + (rig.p.gazeX || 0) * 0.008 + yaw * 0.004, rig.rEye.y + (rig.p.gazeY || 0) * 0.006 + pitch * 0.006);
  return face;
}

export function drawClassroom(ctx, w, h, p = REST) {
  // Walls and warm window light.
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#3a3228");
  sky.addColorStop(0.45, "#2a241c");
  sky.addColorStop(1, "#1a1612");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // Window on the left
  const wx = w * 0.0, wy = h * 0.10, ww = w * 0.18, wh = h * 0.32;
  const win = ctx.createLinearGradient(wx, wy, wx + ww, wy + wh);
  win.addColorStop(0, "#f0d8a8");
  win.addColorStop(0.5, "#e8c888");
  win.addColorStop(1, "#c9a06a");
  ctx.fillStyle = win;
  ctx.fillRect(wx, wy, ww, wh);
  ctx.strokeStyle = "rgba(40,28,16,0.45)";
  ctx.lineWidth = 6;
  ctx.strokeRect(wx + 3, wy + 3, ww - 6, wh - 6);
  ctx.beginPath();
  ctx.moveTo(wx + ww / 2, wy);
  ctx.lineTo(wx + ww / 2, wy + wh);
  ctx.moveTo(wx, wy + wh / 2);
  ctx.lineTo(wx + ww, wy + wh / 2);
  ctx.lineWidth = 4;
  ctx.stroke();

  // Light wash from the window
  const light = ctx.createRadialGradient(w * 0.12, h * 0.28, 20, w * 0.4, h * 0.4, w * 0.7);
  light.addColorStop(0, "rgba(255, 220, 160, 0.16)");
  light.addColorStop(1, "rgba(255, 220, 160, 0)");
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, w, h);

  // Chalkboard
  const bx = w * 0.22, by = h * 0.08, bw = w * 0.72, bh = h * 0.44;
  ctx.fillStyle = "#3a2a1c";
  ctx.fillRect(bx - 10, by - 10, bw + 20, bh + 28);
  const board = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
  board.addColorStop(0, "#2a3a32");
  board.addColorStop(0.5, "#24332c");
  board.addColorStop(1, "#1d2a24");
  ctx.fillStyle = board;
  ctx.fillRect(bx, by, bw, bh);
  // faint old chalk
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = "#dfe8d8";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(bx + 30, by + 40);
  ctx.bezierCurveTo(bx + 80, by + 30, bx + 90, by + 70, bx + 140, by + 50);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Chalk writing, progressive
  const text = "疑是地上霜";
  const shown = Math.floor(clamp(p.chalk || 0, 0, 1) * text.length + 0.0001);
  if (shown > 0 || (p.chalk || 0) > 0.02) {
    ctx.save();
    ctx.font = `600 ${Math.round(w * 0.055)}px "Noto Serif CJK SC", "Songti SC", serif`;
    ctx.fillStyle = "rgba(236, 236, 220, 0.88)";
    ctx.shadowColor = "rgba(236,236,220,0.25)";
    ctx.shadowBlur = 2;
    const slice = text.slice(0, Math.max(1, shown));
    ctx.fillText(slice, bx + bw * 0.42, by + bh * 0.48);
    ctx.restore();
  }

  // Chalk tray
  ctx.fillStyle = "#4a3828";
  ctx.fillRect(bx - 6, by + bh, bw + 12, 14);
  ctx.fillStyle = "#d9d2c2";
  ctx.fillRect(bx + 24, by + bh + 4, 28, 6);
  ctx.fillStyle = "#c45c3a";
  ctx.fillRect(bx + 64, by + bh + 4, 18, 6);

  // Floor
  const floorY = h * 0.62;
  const floor = ctx.createLinearGradient(0, floorY, 0, h);
  floor.addColorStop(0, "#4a3c2c");
  floor.addColorStop(1, "#2a2218");
  ctx.fillStyle = floor;
  ctx.fillRect(0, floorY, w, h - floorY);
  ctx.strokeStyle = "rgba(20,14,8,0.25)";
  ctx.lineWidth = 1;
  for (let i = 1; i <= 6; i++) {
    const y = floorY + (h - floorY) * (i / 6) * (i / 6);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  // vanishing lines
  for (let i = 0; i <= 8; i++) {
    const x = (i / 8) * w;
    ctx.beginPath();
    ctx.moveTo(w * 0.5, floorY - 10);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  // Soft vignette
  const vig = ctx.createRadialGradient(w * 0.5, h * 0.45, h * 0.2, w * 0.5, h * 0.5, h * 0.75);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.28)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);
}

function limb(ctx, a, b, width, color, w, h) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(a.x * w, a.y * h);
  ctx.lineTo(b.x * w, b.y * h);
  ctx.stroke();
}

function disc(ctx, p, r, color, w, h) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(p.x * w, p.y * h, r, 0, Math.PI * 2);
  ctx.fill();
}

export function drawTeacher(ctx, w, h, rig) {
  const { p } = rig;
  // Shadow
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath();
  ctx.ellipse(rig.midHip.x * w, h * 0.90, w * 0.11, h * 0.018, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const yaw = rig.yaw;

  // Far arm first if turned
  const drawArm = (sh, el, wr, jacketW) => {
    limb(ctx, sh, el, jacketW, JACKET, w, h);
    limb(ctx, el, wr, jacketW * 0.72, JACKET, w, h);
    disc(ctx, wr, jacketW * 0.28, SKIN, w, h);
  };

  // Legs
  limb(ctx, rig.lHip, rig.lKnee, 26, TROUSER, w, h);
  limb(ctx, rig.rHip, rig.rKnee, 26, TROUSER, w, h);
  limb(ctx, rig.lKnee, rig.lAnkle, 22, TROUSER, w, h);
  limb(ctx, rig.rKnee, rig.rAnkle, 22, TROUSER, w, h);
  // shoes
  ctx.fillStyle = SHOE;
  ctx.beginPath();
  ctx.ellipse(rig.lFoot.x * w, rig.lFoot.y * h, 16, 7, 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(rig.rFoot.x * w, rig.rFoot.y * h, 16, 7, 0.1, 0, Math.PI * 2);
  ctx.fill();

  // Hip / trousers top
  ctx.fillStyle = TROUSER;
  ctx.beginPath();
  ctx.moveTo(rig.lHip.x * w - 16, rig.lHip.y * h - 8);
  ctx.lineTo(rig.rHip.x * w + 16, rig.rHip.y * h - 8);
  ctx.lineTo(rig.rHip.x * w + 10, rig.rHip.y * h + 18);
  ctx.lineTo(rig.lHip.x * w - 10, rig.lHip.y * h + 18);
  ctx.closePath();
  ctx.fill();

  // Far then near arm depending on yaw (turning right shows left arm more in front)
  if (yaw < 0.45) {
    drawArm(rig.lSh, rig.lElbow, rig.lWrist, 24);
  } else {
    drawArm(rig.rSh, rig.rElbow, rig.rWrist, 22);
  }

  // Torso / jacket
  ctx.fillStyle = JACKET;
  ctx.beginPath();
  ctx.moveTo(rig.lSh.x * w - 8, rig.lSh.y * h);
  ctx.lineTo(rig.rSh.x * w + 8, rig.rSh.y * h);
  ctx.lineTo(rig.rHip.x * w + 14, rig.rHip.y * h + 6);
  ctx.lineTo(rig.lHip.x * w - 14, rig.lHip.y * h + 6);
  ctx.closePath();
  ctx.fill();
  // shirt placket
  ctx.fillStyle = SHIRT;
  const plx = rig.midSh.x * w + yaw * 10;
  ctx.beginPath();
  ctx.moveTo(plx - 7, rig.midSh.y * h + 8);
  ctx.lineTo(plx + 7 - yaw * 8, rig.midSh.y * h + 8);
  ctx.lineTo(plx + 4 - yaw * 6, rig.midHip.y * h - 6);
  ctx.lineTo(plx - 4, rig.midHip.y * h - 6);
  ctx.closePath();
  ctx.fill();
  // collar
  ctx.beginPath();
  ctx.moveTo(plx - 12, rig.neck.y * h + 4);
  ctx.lineTo(plx, rig.midSh.y * h + 16);
  ctx.lineTo(plx + 12, rig.neck.y * h + 4);
  ctx.strokeStyle = SHIRT;
  ctx.lineWidth = 3;
  ctx.stroke();

  // Near arm
  if (yaw < 0.45) {
    drawArm(rig.rSh, rig.rElbow, rig.rWrist, 24);
  } else {
    drawArm(rig.lSh, rig.lElbow, rig.lWrist, 24);
  }

  // Booklet in hand if notes pose
  if ((p.lArm > 0.5 && p.lArm < 1.6) || (p.rArm > 0.5 && p.rArm < 1.6)) {
    const hx = (rig.lWrist.x + rig.rWrist.x) / 2 * w;
    const hy = (rig.lWrist.y + rig.rWrist.y) / 2 * h;
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(-0.2 + p.headPitch * 0.2);
    ctx.fillStyle = "#f4efe4";
    ctx.strokeStyle = "#8a7a62";
    ctx.lineWidth = 1;
    ctx.fillRect(-16, -10, 32, 22);
    ctx.strokeRect(-16, -10, 32, 22);
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(0, 12);
    ctx.stroke();
    ctx.restore();
  }

  // Chalk in right hand
  if (p.rArm > 2.3 && p.rArm < 3.7) {
    ctx.save();
    ctx.strokeStyle = "#f2eee3";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(rig.rIndex.x * w, rig.rIndex.y * h);
    ctx.lineTo(rig.rIndex.x * w + 10, rig.rIndex.y * h - 10);
    ctx.stroke();
    ctx.restore();
  }

  // Neck
  ctx.fillStyle = SKIN;
  ctx.fillRect(rig.neck.x * w - 8, rig.neck.y * h - 6, 16, 18);

  drawHead(ctx, w, h, rig);
}

function drawHead(ctx, w, h, rig) {
  const p = rig.p;
  const cx = rig.head.x * w, cy = rig.head.y * h;
  const yaw = (p.headYaw || 0) + rig.yaw * 0.7;
  const pitch = p.headPitch || 0;
  const rx = 26, ry = 31;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((p.headRoll || 0) * 0.2);
  // hair back
  ctx.fillStyle = HAIR;
  ctx.beginPath();
  ctx.ellipse(yaw * 4, -6, rx + 4, ry + 6, 0, 0, Math.PI * 2);
  ctx.fill();
  // bun
  ctx.beginPath();
  ctx.arc(-4 + yaw * 8, -ry - 4, 9, 0, Math.PI * 2);
  ctx.fill();

  // face
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.ellipse(yaw * 6, 2 + pitch * 4, rx - 1, ry - 1, 0, 0, Math.PI * 2);
  ctx.fill();
  // ear (visible one)
  ctx.fillStyle = SKIN_SH;
  if (yaw < 0.35) {
    ctx.beginPath();
    ctx.ellipse(-rx + 2, 4, 5, 8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (yaw > -0.15) {
    ctx.beginPath();
    ctx.ellipse(rx - 2 + yaw * 4, 4, 5, 8, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // features fade as we turn away
  const faceAlpha = clamp(1 - Math.abs(yaw) * 0.85, 0.15, 1);
  ctx.globalAlpha = faceAlpha;
  const eyeY = -4 + pitch * 6;
  const lEyeX = -8 + yaw * 10;
  const rEyeX = 8 + yaw * 10;
  const blink = p.blink || 0;
  const eyeH = lerp(3.2, 0.4, blink);
  // whites / lids
  ctx.fillStyle = "#f7f3ea";
  if (blink < 0.8) {
    ctx.beginPath();
    ctx.ellipse(lEyeX, eyeY, 5, eyeH, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(rEyeX, eyeY, 5, eyeH, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1b1712";
    const gx = (p.gazeX || 0) * 2.2, gy = (p.gazeY || 0) * 1.6;
    ctx.beginPath();
    ctx.arc(lEyeX + gx, eyeY + gy, 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(rEyeX + gx, eyeY + gy, 2.1, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.strokeStyle = "#1b1712";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(lEyeX - 5, eyeY);
    ctx.lineTo(lEyeX + 5, eyeY);
    ctx.moveTo(rEyeX - 5, eyeY);
    ctx.lineTo(rEyeX + 5, eyeY);
    ctx.stroke();
  }
  // brows
  ctx.strokeStyle = HAIR;
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(lEyeX - 6, eyeY - 8);
  ctx.lineTo(lEyeX + 5, eyeY - 7);
  ctx.moveTo(rEyeX - 5, eyeY - 7);
  ctx.lineTo(rEyeX + 6, eyeY - 8);
  ctx.stroke();
  // nose
  ctx.strokeStyle = SKIN_SH;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(yaw * 8, eyeY + 4);
  ctx.lineTo(yaw * 8 + 2, eyeY + 12 + pitch * 2);
  ctx.stroke();
  // mouth
  ctx.strokeStyle = "#b07a6a";
  ctx.lineWidth = 1.4;
  const speak = p.speak || 0;
  ctx.beginPath();
  ctx.ellipse(yaw * 7, 16 + pitch * 3, 6, 1.2 + speak * 3, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

export function renderScene(ctx, w, h, params, time) {
  const p = { ...REST, ...params };
  const shot = p.shot === "full" ? "full" : "half";
  let rig = buildRig(p, time);
  if (p.shot) rig = applyShot(rig, shot);
  drawClassroom(ctx, w, h, { ...p, shot });
  drawTeacher(ctx, w, h, rig);
  return rig;
}

export function coverPose() {
  return {
    ...REST,
    rArm: 2,
    lArm: 0.2,
    headYaw: -0.06,
    gazeX: 0.1,
    speak: 0.15,
    breath: 1,
    chalk: 0.4,
  };
}

export { lerp, clamp, ease, STAGE_W, STAGE_H };
