import { POSE_EDGES, POSE as P, COLORS, boardBox, podiumBox, runtime, HAND_EDGES, HAND_TIPS } from "./constants.js";
import { midHip, midShoulder, lm } from "./analyze.js";

function pt(ctx, p, w, h) {
  if (!p) return null;
  return { x: p.x * w, y: p.y * h };
}

function drawLine(ctx, a, b, color, width) {
  if (!a || !b) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function pill(ctx, x, y, text, bg, fg, align = "left") {
  ctx.font = "600 13px 'Noto Sans CJK SC', 'PingFang SC', 'Microsoft YaHei', sans-serif";
  const padX = 8, padY = 5;
  const tw = ctx.measureText(text).width;
  const w = tw + padX * 2, h = 22;
  const left = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
  const top = y - h / 2;
  ctx.fillStyle = bg;
  roundRect(ctx, left, top, w, h, 11);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textBaseline = "middle";
  ctx.fillText(text, left + padX, y + 0.5);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function clearOverlay(canvas) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

export function drawPodiumAndBoard(ctx, w, h, opts = {}) {
  const { showPodium = true, showBoard = true, boardActive = false, coach = false } = opts;

  if (showPodium) {
    const pod = podiumBox();
    const x = pod.x0 * w, y = pod.y0 * h;
    const pw = (pod.x1 - pod.x0) * w, ph = (pod.y1 - pod.y0) * h;
    ctx.save();
    ctx.strokeStyle = coach ? "rgba(230,201,138,0.7)" : "rgba(230,201,138,0.28)";
    ctx.setLineDash(coach ? [8, 8] : [6, 8]);
    ctx.lineWidth = coach ? 3 : 2;
    ctx.strokeRect(x, y, pw, ph);
    ctx.setLineDash([]);
    if (coach) {
      ctx.fillStyle = "rgba(230,201,138,0.9)";
      ctx.font = "600 13px 'Noto Sans CJK SC', 'PingFang SC', sans-serif";
      ctx.fillText(runtime.frameResolved === "full" ? "讲台站位（全身）" : "讲台站位（半身）", x + 8, y + ph - 10);
    }
    ctx.restore();
  }

  if (showBoard) {
    const BOARD_BOX = boardBox();
    const x = BOARD_BOX.x0 * w, y = BOARD_BOX.y0 * h;
    const bw = (BOARD_BOX.x1 - BOARD_BOX.x0) * w, bh = (BOARD_BOX.y1 - BOARD_BOX.y0) * h;
    ctx.save();
    ctx.strokeStyle = boardActive ? "rgba(232,214,168,0.95)" : "rgba(232,214,168,0.35)";
    ctx.setLineDash([5, 6]);
    ctx.lineWidth = boardActive ? 3 : 1.5;
    ctx.strokeRect(x, y, bw, bh);
    ctx.setLineDash([]);
    ctx.fillStyle = boardActive ? "rgba(232,214,168,0.95)" : "rgba(232,214,168,0.7)";
    ctx.font = "600 12px 'Noto Sans CJK SC', 'PingFang SC', sans-serif";
    ctx.fillText("板书区", x + 8, y + 18);
    ctx.restore();
  }
}

export function drawCoachSilhouette(ctx, w, h) {
  // Waist-up guide, slightly translucent, centered in the podium.
  const cx = w * 0.5;
  const headY = h * 0.28;
  const headR = h * 0.055;
  ctx.save();
  ctx.strokeStyle = "rgba(243,238,228,0.72)";
  ctx.fillStyle = "rgba(243,238,228,0.08)";
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(cx, headY, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // shoulders to waist
  ctx.beginPath();
  ctx.moveTo(cx - headR * 0.4, headY + headR * 1.1);
  ctx.lineTo(cx - w * 0.16, headY + headR * 2.1);
  ctx.lineTo(cx - w * 0.18, h * 0.72);
  ctx.lineTo(cx + w * 0.18, h * 0.72);
  ctx.lineTo(cx + w * 0.16, headY + headR * 2.1);
  ctx.lineTo(cx + headR * 0.4, headY + headR * 1.1);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  drawPodiumAndBoard(ctx, w, h, { coach: true, showPodium: true, showBoard: true });
}

export function drawSkeleton(ctx, pose, w, h, flags = {}) {
  if (!pose) return;
  const warn = flags.sway || flags.slouch || flags.hip || flags.folded || flags.out || flags.back || flags.pace;
  const color = warn ? COLORS.skeletonWarn : COLORS.skeleton;
  ctx.save();
  ctx.shadowColor = warn ? "rgba(211,83,60,0.35)" : "rgba(230,201,138,0.28)";
  ctx.shadowBlur = 6;
  for (const [a, b] of POSE_EDGES) {
    const pa = pt(ctx, pose[a], w, h);
    const pb = pt(ctx, pose[b], w, h);
    if (!pa || !pb) continue;
    const va = pose[a].v ?? pose[a].visibility ?? 1;
    const vb = pose[b].v ?? pose[b].visibility ?? 1;
    if (va < 0.35 || vb < 0.35) continue;
    drawLine(ctx, pa, pb, color, 2.4);
  }
  const joints = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
  for (const i of joints) {
    const p = pt(ctx, pose[i], w, h);
    if (!p) continue;
    const v = pose[i].v ?? pose[i].visibility ?? 1;
    if (v < 0.35) continue;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, i === 0 ? 4.5 : 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Local labels on the body.
  const mh = midHip(pose);
  const ms = midShoulder(pose);
  const nose = lm(pose, P.NOSE);
  if (flags.hip && mh) pill(ctx, mh.x * w + 14, mh.y * h, "重心偏了", COLORS.labelBg, "#ffd8cf");
  if (flags.sway && ms) pill(ctx, ms.x * w, ms.y * h - 22, "左右晃了", COLORS.labelBg, COLORS.gold, "center");
  if (flags.slouch && ms) pill(ctx, ms.x * w + 16, ms.y * h + 8, "含胸了", COLORS.labelBg, "#ffd8cf");
  if (flags.folded && ms) pill(ctx, ms.x * w, (ms.y + 0.08) * h, "抱臂", COLORS.labelBg, "#ffd8cf", "center");
  if (flags.out && mh) pill(ctx, mh.x * w, podiumBox().y0 * h + 16, "走出讲台", COLORS.labelBg, "#ffd8cf", "center");
  if (flags.back && ms) pill(ctx, ms.x * w, (ms.y - 0.08) * h, "背对学生写板", COLORS.labelBg, "#ffd8cf", "center");
  if (flags.pace && mh) pill(ctx, mh.x * w, mh.y * h + 18, "来回走动", COLORS.labelBg, "#ffd8cf", "center");
  if (flags.notes && nose) pill(ctx, nose.x * w + 18, nose.y * h + 10, "视线在讲稿上", COLORS.labelBg, COLORS.teal);
  if (flags.boardHold && nose) pill(ctx, nose.x * w - 10, nose.y * h - 18, "写完请回看", COLORS.labelBg, COLORS.board, "right");
}


export function drawHands(ctx, hands, w, h, flags = {}) {
  if (!hands || !hands.length) return;
  ctx.save();
  for (const hand of hands) {
    if (!hand || !hand.length) continue;
    const color = flags.folded ? COLORS.skeletonWarn : "rgba(143, 208, 201, 0.92)";
    ctx.shadowColor = "rgba(143, 208, 201, 0.28)";
    ctx.shadowBlur = 5;
    for (const [a, b] of HAND_EDGES) {
      const pa = hand[a] && Number.isFinite(hand[a].x) ? { x: hand[a].x * w, y: hand[a].y * h } : null;
      const pb = hand[b] && Number.isFinite(hand[b].x) ? { x: hand[b].x * w, y: hand[b].y * h } : null;
      const va = hand[a]?.v ?? hand[a]?.visibility ?? 1;
      const vb = hand[b]?.v ?? hand[b]?.visibility ?? 1;
      if (!pa || !pb || va < 0.3 || vb < 0.3) continue;
      drawLine(ctx, pa, pb, color, 2);
    }
    for (let i = 0; i < hand.length; i++) {
      const q = hand[i];
      if (!q || (q.v ?? q.visibility ?? 1) < 0.3) continue;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(q.x * w, q.y * h, HAND_TIPS.includes(i) ? 3.4 : 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

export function drawGazeReticle(ctx, pose, gaze, w, h) {
  if (!gaze || !pose) return;
  const nose = lm(pose, P.NOSE);
  if (!nose) return;
  const x = nose.x * w, y = nose.y * h;
  const len = 48;
  const gx = x + gaze.yaw * 70;
  const gy = y + gaze.pitch * 70;
  ctx.save();
  ctx.strokeStyle = gaze.towardClass ? "rgba(95,191,182,0.9)" : "rgba(230,201,138,0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(gx, gy);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(gx, gy, 5, 0, Math.PI * 2);
  ctx.stroke();
  // small ring at the eyes
  ctx.beginPath();
  ctx.arc(x, y - 8, 10, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(243,238,228,0.35)";
  ctx.stroke();
  ctx.restore();
}

export function drawClassroomMap(ctx, x, y, size, gaze) {
  // A compact “front of class” diagram: lens at the bottom, desks in a shallow arc.
  const w = size, h = size * 0.92;
  ctx.save();
  ctx.translate(x, y);
  roundRect(ctx, 0, 0, w, h, 10);
  ctx.fillStyle = "rgba(14, 12, 10, 0.62)";
  ctx.fill();
  ctx.strokeStyle = "rgba(230,201,138,0.35)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "rgba(243,238,228,0.72)";
  ctx.font = "600 10px 'Noto Sans CJK SC', 'PingFang SC', sans-serif";
  ctx.fillText("学生席", 8, 16);

  const desks = [
    [0.22, 0.34], [0.50, 0.28], [0.78, 0.34],
    [0.28, 0.55], [0.50, 0.50], [0.72, 0.55],
  ];
  for (const [dx, dy] of desks) {
    ctx.fillStyle = "rgba(243,238,228,0.22)";
    ctx.beginPath();
    ctx.arc(dx * w, dy * h, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Teacher / lens at the bottom (the camera).
  ctx.fillStyle = "rgba(230,201,138,0.9)";
  ctx.beginPath();
  ctx.arc(w * 0.5, h * 0.82, 5, 0, Math.PI * 2);
  ctx.fill();

  // Gaze heat
  let hx = w * 0.5, hy = h * 0.40, label = "看向学生";
  const g = gaze?.label;
  if (g === "notes") { hx = w * 0.5; hy = h * 0.72; label = "看讲稿"; }
  else if (g === "ceiling") { hx = w * 0.5; hy = h * 0.18; label = "看上方"; }
  else if (g === "board") { hx = runtime.boardSide === "left" ? w * 0.16 : w * 0.84; hy = h * 0.28; label = "看黑板"; }
  else if (g === "away") { hx = runtime.boardSide === "left" ? w * 0.84 : w * 0.16; hy = h * 0.34; label = "看向一侧"; }
  else if (g === "class") { hx = w * 0.5; hy = h * 0.40; label = "看向学生"; }
  else { label = "未识别到人"; hx = -100; }

  const heat = ctx.createRadialGradient(hx, hy, 0, hx, hy, 16);
  heat.addColorStop(0, g === "class" ? "rgba(95,191,182,0.85)" : "rgba(230,201,138,0.85)");
  heat.addColorStop(1, "rgba(95,191,182,0)");
  ctx.fillStyle = heat;
  ctx.beginPath();
  ctx.arc(hx, hy, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f6efe3";
  ctx.font = "600 10px 'Noto Sans CJK SC', 'PingFang SC', sans-serif";
  ctx.fillText(label, 8, h - 8);
  ctx.restore();
}

export function drawLiveOverlays(ctx, frame, w, h, opts = {}) {
  const { coach = false, showMap = true, clear = true } = opts;
  if (clear) ctx.clearRect(0, 0, w, h);
  const pose = frame?.pose;
  const gaze = frame?.gaze;
  const flags = { ...(frame?.flags || {}) };
  if (gaze?.label === "notes") flags.notes = true;
  if (frame?.onBoard && !gaze?.towardClass) flags.boardHold = true;

  drawPodiumAndBoard(ctx, w, h, {
    showPodium: true,
    showBoard: true,
    boardActive: !!frame?.onBoard,
    coach,
  });
  if (pose) {
    drawSkeleton(ctx, pose, w, h, flags);
    drawGazeReticle(ctx, pose, gaze, w, h);
  }
  if (frame?.hands && frame.hands.length) {
    drawHands(ctx, frame.hands, w, h, flags);
  }
  if (showMap) {
    const mapSize = Math.min(118, w * 0.22);
    drawClassroomMap(ctx, 10, 10, mapSize, gaze);
  }
  const shot = runtime.frameResolved === "full" ? "全身" : "半身";
  ctx.save();
  ctx.font = "600 12px 'Noto Sans CJK SC', 'PingFang SC', 'Microsoft YaHei', sans-serif";
  ctx.fillStyle = "rgba(232,214,168,0.85)";
  ctx.textAlign = "right";
  ctx.fillText(shot + "构图", w - 12, 22);
  ctx.restore();
}

export function resizeCanvasTo(canvas, cssWidth, cssHeight, dpr = Math.min(2, window.devicePixelRatio || 1)) {
  const w = Math.max(1, Math.round(cssWidth * dpr));
  const h = Math.max(1, Math.round(cssHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { w, h, dpr };
}
