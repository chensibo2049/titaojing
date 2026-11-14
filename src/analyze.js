import { POSE as P, EVENT_META, runtime, boardSign as sideSign, podiumBox, boardBox, HAND_TIPS } from "./constants.js";
import { buildFillerReport, fillerNextAdvice } from "./fillers.js";

const mid = (a, b) =>
  a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, v: Math.min(vis(a), vis(b)) } : null;

const vis = (p) => (p && (p.visibility ?? p.presence ?? 1)) || 0;

const dist = (a, b) => {
  if (!a || !b) return Infinity;
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.hypot(dx, dy);
};

export function lm(pose, i) {
  if (!pose) return null;
  const p = pose[i];
  if (!p) return null;
  return p;
}

export function midShoulder(pose) {
  return mid(lm(pose, P.L_SHOULDER), lm(pose, P.R_SHOULDER));
}

export function midHip(pose) {
  return mid(lm(pose, P.L_HIP), lm(pose, P.R_HIP));
}

export function extractGaze(pose, face, matrix) {
  // Prefer face landmark geometry; fall back to pose nose/ears.
  let yaw = 0, pitch = 0, ok = false;

  if (matrix && matrix.length >= 16) {
    // Column-major 4x4. Forward is -Z in MediaPipe face space roughly.
    const r00 = matrix[0], r10 = matrix[1], r20 = matrix[2];
    const r21 = matrix[6], r22 = matrix[10];
    yaw = Math.atan2(r20, r00);
    pitch = Math.atan2(-r21, r22);
    ok = true;
  }

  if (face && face.length >= 468) {
    const nose = face[1] || face[4];
    const le = face[33], re = face[263];
    if (nose && le && re) {
      const eyeMid = { x: (le.x + re.x) / 2, y: (le.y + re.y) / 2 };
      const eyeW = Math.max(0.001, Math.abs(re.x - le.x));
      const faceH = Math.max(0.001, dist(face[10] || face[151], face[152] || face[175]) || eyeW * 1.4);
      yaw = (nose.x - eyeMid.x) / eyeW;
      pitch = (nose.y - eyeMid.y) / faceH;
      ok = true;
      if (face.length >= 478 && face[468] && face[473]) {
        const irisL = face[468], irisR = face[473];
        const lIn = face[133], lOut = face[33];
        const rIn = face[362], rOut = face[263];
        if (lIn && lOut && rIn && rOut) {
          const lx = (irisL.x - (lIn.x + lOut.x) / 2) / Math.max(0.001, Math.abs(lOut.x - lIn.x));
          const rx = (irisR.x - (rIn.x + rOut.x) / 2) / Math.max(0.001, Math.abs(rOut.x - rIn.x));
          const ly = (irisL.y - (lIn.y + lOut.y) / 2) / Math.max(0.001, Math.abs(lOut.x - lIn.x));
          const ry = (irisR.y - (rIn.y + rOut.y) / 2) / Math.max(0.001, Math.abs(rOut.x - rIn.x));
          yaw += (lx + rx) * 0.6;
          pitch += (ly + ry) * 0.6;
        }
      }
    }
  } else if (pose) {
    const nose = lm(pose, P.NOSE);
    const le = lm(pose, P.L_EYE);
    const re = lm(pose, P.R_EYE);
    const ls = lm(pose, P.L_SHOULDER);
    const rs = lm(pose, P.R_SHOULDER);
    const lear = lm(pose, P.L_EAR);
    const rear = lm(pose, P.R_EAR);
    if (nose && le && re) {
      const eyeMid = mid(le, re);
      const eyeW = Math.max(0.001, dist(le, re));
      yaw = (nose.x - eyeMid.x) / eyeW;
      const ms = mid(ls, rs);
      if (ms) {
        const nd = ms.y - nose.y;
        // Looking down shortens nose-to-shoulder vertically.
        pitch = nd < 0.10 ? (0.10 - nd) * 4 : -(nd - 0.12) * 1.2;
      }
      if (lear && rear) {
        const earBias = (vis(rear) - vis(lear)) + (rear.x - lear.x - eyeW * 1.4) * 0.5;
        yaw += earBias * 0.15;
      }
      ok = true;
    }
  }

  if (!ok) return { label: "unknown", yaw: 0, pitch: 0, towardClass: false };

  let label = "class";
  const boardSign = sideSign();
  const g = runtime.sens.gaze;
  if (yaw * boardSign > 0.38 && Math.abs(yaw) > Math.abs(pitch) * 0.65 + 0.08) label = "board";
  else if (pitch > 0.20 * (0.5 + 0.5 * g)) label = "notes";
  else if (pitch < -0.26) label = "ceiling";
  else if (Math.abs(yaw) > 0.42) label = "away";

  return { label, yaw, pitch, towardClass: label === "class" };
}

export function extractPosture(pose, history, hands) {
  const flags = { sway: false, slouch: false, hip: false, folded: false, out: false, back: false, pace: false };
  const metrics = { swayAmp: 0, torsoRatio: 0, hipTilt: 0, fold: 0 };
  if (!pose) return { flags, metrics, midHip: null, midShoulder: null };

  const ls = lm(pose, P.L_SHOULDER);
  const rs = lm(pose, P.R_SHOULDER);
  const lh = lm(pose, P.L_HIP);
  const rh = lm(pose, P.R_HIP);
  const lw = lm(pose, P.L_WRIST);
  const rw = lm(pose, P.R_WRIST);
  const le = lm(pose, P.L_ELBOW);
  const re = lm(pose, P.R_ELBOW);
  const ms = mid(ls, rs);
  const mh = mid(lh, rh);
  if (!ms || !mh) return { flags, metrics, midHip: mh, midShoulder: ms };

  const shoulderW = Math.max(0.001, dist(ls, rs));
  const torsoLen = dist(ms, mh);
  const torsoRatio = torsoLen / shoulderW;
  metrics.torsoRatio = torsoRatio;
  const nose = lm(pose, P.NOSE);
  const headDrop = nose ? (nose.y - ms.y) / shoulderW : 0;
  metrics.headDrop = headDrop;

  const hipTilt = Math.abs((lh?.y || 0) - (rh?.y || 0));
  const hipOffset = mh && ms ? Math.abs(ms.x - mh.x) : 0;
  metrics.hipTilt = hipTilt;
  const ps = runtime.sens.posture;
  if (hipTilt > 0.016 * ps && hipOffset > 0.018 * ps) flags.hip = true;

  if (lw && rw && le && re && ms && mh) {
    const crossed =
      dist(lw, re) < 0.13 && dist(rw, le) < 0.13;
    const wristsIn =
      lw.y > ms.y && rw.y > ms.y && lw.y < mh.y + 0.04 && rw.y < mh.y + 0.04 &&
      Math.abs(lw.x - rw.x) < shoulderW * 0.7;
    flags.folded = crossed || (wristsIn && dist(lw, rw) < shoulderW * 0.55 && dist(lw, re) < 0.18);
    metrics.fold = dist(lw, re) + dist(rw, le);
  }
  if (hands && hands.length >= 2 && ms && mh) {
    const wa = hands[0][0], wb = hands[1][0];
    if (wa && wb) {
      const bothFront = wa.y > ms.y && wb.y > ms.y && wa.y < mh.y + 0.06 && wb.y < mh.y + 0.06;
      const close = dist(wa, wb) < shoulderW * 0.6;
      const crossedH = (wa.x - ms.x) * (wb.x - ms.x) < 0 && Math.abs(wa.x - wb.x) < shoulderW * 0.9;
      if (bothFront && close && crossedH) flags.folded = true;
    }
  }

  const pod = podiumBox();
  if (mh.x < pod.x0 - 0.02 || mh.x > pod.x1 + 0.02) flags.out = true;

  // 背对学生：肩宽在画面上几乎叠成侧面，且鼻子偏向板书一侧（全身构图下更有意义）
  const shoulderTwist = (rs?.x || 0) - (ls?.x || 0);
  metrics.shoulderTwist = shoulderTwist;
  if (shoulderTwist < 0.085 * ps) flags.back = true;


  if (history && history.length >= 8) {
    const xs = history.map((h) => h.mhx).filter((n) => Number.isFinite(n));
    if (xs.length >= 8) {
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
      const std = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
      metrics.swayAmp = maxX - minX;
      // Oscillation, not a single purposeful step.
      let crossings = 0;
      for (let i = 1; i < xs.length; i++) {
        if ((xs[i - 1] - mean) * (xs[i] - mean) < 0) crossings++;
      }
      if (metrics.swayAmp > 0.035 * ps && std > 0.008 * ps && crossings >= 2) flags.sway = true;
    }
  }

  return { flags, metrics, midHip: mh, midShoulder: ms };
}


export function pointInBoard(p, pad = 0.03) {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
  const box = boardBox();
  return p.x >= box.x0 - pad && p.x <= box.x1 + pad && p.y >= box.y0 - pad && p.y <= box.y1 + pad;
}

/** 手（或姿态里的手腕 / 食指）是否伸向板书区。不是在认黑板上的字。 */
export function handInBoardRegion(hands, pose) {
  if (hands && hands.length) {
    for (const hand of hands) {
      if (!hand) continue;
      if (pointInBoard(hand[0])) return true;
      for (const i of HAND_TIPS) if (pointInBoard(hand[i])) return true;
    }
  }
  if (pose) {
    for (const i of [P.L_WRIST, P.R_WRIST, P.L_INDEX, P.R_INDEX, P.L_THUMB, P.R_THUMB]) {
      if (pointInBoard(lm(pose, i))) return true;
    }
  }
  return false;
}

/**
 * 写板过程中截取板书区静帧（不是整段录像上传）。
 * 仅在判定正在写板时采集；没有写板就不会生成。
 */
export function maybeCaptureBoardStill(session, video, t, { mirror = false } = {}) {
  if (!session || !session._writing) return null;
  session.boardStills = session.boardStills || [];
  if (session.boardStills.length >= 8) return null;
  const last = session._lastBoardStillAt ?? -99;
  if (session.boardStills.length && t - last < 4.5) return null;
  if (!video || !video.videoWidth) return null;
  const box = boardBox();
  const vw = video.videoWidth, vh = video.videoHeight;
  let x0 = box.x0, x1 = box.x1;
  if (mirror) { x0 = 1 - box.x1; x1 = 1 - box.x0; }
  const sx = Math.max(0, Math.floor(x0 * vw));
  const sy = Math.max(0, Math.floor(box.y0 * vh));
  const sw = Math.min(vw - sx, Math.ceil((x1 - x0) * vw));
  const sh = Math.min(vh - sy, Math.ceil((box.y1 - box.y0) * vh));
  if (sw < 8 || sh < 8) return null;
  const c = document.createElement("canvas");
  const scale = Math.min(1, 360 / sw);
  c.width = Math.max(1, Math.round(sw * scale));
  c.height = Math.max(1, Math.round(sh * scale));
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  if (mirror) { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
  try { ctx.drawImage(video, sx, sy, sw, sh, 0, 0, c.width, c.height); }
  catch (_) { return null; }
  let dataUrl = "";
  try { dataUrl = c.toDataURL("image/jpeg", 0.62); } catch (_) { return null; }
  if (!dataUrl || dataUrl.length < 32) return null;
  session._lastBoardStillAt = t;
  session.boardStills.push({ t: Math.round(t * 100) / 100, dataUrl });
  return dataUrl;
}

export function isFacingBoard(gaze, pose) {
  if (gaze && gaze.label === "board") return true;
  if (!pose) return false;
  const ls = lm(pose, P.L_SHOULDER);
  const rs = lm(pose, P.R_SHOULDER);
  const nose = lm(pose, P.NOSE);
  if (!ls || !rs || !nose) return false;
  const midX = (ls.x + rs.x) / 2;
  const boardSign = sideSign();
  // Shoulders almost in profile + nose toward the board.
  const shoulderTwist = (rs.x - ls.x);
  return boardSign * (nose.x - midX) > 0.04 && shoulderTwist < 0.12;
}

/** 根据脚踝 / 膝盖可见度和髋部位置判断半身还是全身。 */
export function inferFrameMode(pose) {
  if (!pose) return null;
  const visOk = (i, th = 0.5) => vis(lm(pose, i)) >= th;
  const mh = midHip(pose);
  const ankles = visOk(P.L_ANKLE, 0.45) && visOk(P.R_ANKLE, 0.45);
  const knees = visOk(P.L_KNEE, 0.5) && visOk(P.R_KNEE, 0.5);
  if (ankles && mh && mh.y < 0.78) return "full";
  if (knees && mh && mh.y < 0.70) return "full";
  if (mh && mh.y > 0.72) return "half";
  if (!ankles && !knees) return "half";
  return null;
}

export function createSession(kind) {
  return {
    kind, // "demo" | "camera"
    startedAt: Date.now(),
    duration: 0,
    frames: [],
    speech: [],
    transcript: [], // { t, text, final }
    events: [],
    captions: [],
    videoBlob: null,
    videoUrl: null,
    aspect: 9 / 16,
    diagnosis: null,
    _hist: [],
    _gazeDownSince: null,
    _boardOnSince: null,
    _boardOffSince: null,
    _writing: false,
    _writeStart: null,
    _writeLookedBack: false,
    _writeEmitted: false,
    _flagSince: { sway: null, slouch: null, hip: null, folded: null, out: null, back: null, pace: null },
    _flagHold: {},
    _flagCool: {},
    _torsoSamples: [],
    _torsoBase: 0,
    _torsoLocked: false,
    _lastFillerAt: -99,
    _sawHands: false,
    _lastBoardStillAt: -99,
    boardStills: [],
    speechAvailable: false,
    visionAvailable: false,
  };
}


function historyHasPace(hist) {
  if (!hist || hist.length < 12) return false;
  const xs = hist.map((h) => h.mhx).filter((n) => Number.isFinite(n));
  if (xs.length < 12) return false;
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  if (maxX - minX < 0.11) return false;
  let turns = 0;
  for (let i = 2; i < xs.length; i++) {
    const d1 = xs[i - 1] - xs[i - 2], d2 = xs[i] - xs[i - 1];
    if (d1 * d2 < 0 && Math.abs(d2) > 0.008) turns++;
  }
  return turns >= 3;
}

function emit(session, t, type, extra = {}) {
  const meta = EVENT_META[type];
  if (!meta) return;
  const last = [...session.events].reverse().find((e) => e.type === type);
  if (last && t - last.t < (type === "filler" ? 0.45 : 2.4)) return;
  session.events.push({ t, type, kind: meta.kind, label: extra.label || meta.label, ...extra });
}

export function tickFrame(session, t, pose, face, gaze, posture, hands) {
  const mh = posture?.midHip;
  session._hist.push({
    t,
    mhx: mh?.x ?? NaN,
    gaze: gaze?.label,
    board: isFacingBoard(gaze, pose),
    torsoRatio: posture?.metrics?.torsoRatio || 0,
    handSeen: !!(hands && hands.length),
    handBoard: handInBoardRegion(hands, pose),
  });
  const cutoff = t - 2.4;
  session._hist = session._hist.filter((h) => h.t >= cutoff);

  // Recompute sway / slouch with the just-updated window.
  if (posture) {
    const again = extractPosture(pose, session._hist, hands);
    posture.flags.sway = again.flags.sway;
    posture.metrics.swayAmp = again.metrics.swayAmp;
    const ratio = posture.metrics.torsoRatio || again.metrics.torsoRatio;
    if (!session._torsoLocked) {
      session._torsoSamples = session._torsoSamples || [];
      if (ratio > 0.3) session._torsoSamples.push(ratio);
      if (t >= 2 && session._torsoSamples.length >= 15) {
        const srt = [...session._torsoSamples].sort((a, b) => a - b);
        session._torsoBase = srt[Math.floor(srt.length * 0.6)];
        session._torsoLocked = true;
      }
    }
    if (session._torsoBase && ratio < session._torsoBase * 0.86 && (again.metrics.headDrop || 0) > 0.32) {
      posture.flags.slouch = true;
    } else {
      posture.flags.slouch = false;
    }
  }

  session._flagHold = session._flagHold || {};
  const flags = { ...(posture?.flags || {}) };
  // 构图：用户指定或根据前几秒自动锁定
  if (runtime.frameMode === "auto" && pose && !session._frameLocked) {
    session._frameVotes = session._frameVotes || [];
    const guess = inferFrameMode(pose);
    if (guess) session._frameVotes.push(guess);
    if (t >= 2.2 && session._frameVotes.length >= 12) {
      const fulls = session._frameVotes.filter((v) => v === "full").length;
      runtime.frameResolved = fulls / session._frameVotes.length >= 0.6 ? "full" : "half";
      session.frameResolved = runtime.frameResolved;
      session._frameLocked = true;
    }
  } else if (runtime.frameMode !== "auto") {
    session.frameResolved = runtime.frameResolved;
    session._frameLocked = true;
  }

  const full = runtime.frameResolved === "full";
  // 半身构图下，「背对学生」「来回走动」参考价值低，不作为事件
  if (!full) {
    flags.back = false;
    flags.pace = false;
  } else if (historyHasPace(session._hist)) {
    flags.pace = true;
  }
  // 写板时完全背对才提醒；侧身写板不算
  if (full && flags.back && !(isFacingBoard(gaze, pose) || gaze?.label === "board")) {
    flags.back = false;
  }

  for (const key of ["sway", "slouch", "hip", "folded", "out", "back", "pace"]) {
    if (flags[key]) session._flagHold[key] = t + 0.45;
    if (session._flagHold[key] && t < session._flagHold[key]) flags[key] = true;
  }
  if (posture) posture.flags = flags;

  session._flagCool = session._flagCool || {};
  const holdNeed = { sway: 0.85, slouch: 0.9, hip: 0.9, folded: 0.9, out: 0.9, back: 2.4, pace: 2.0 };
  const coolNeed = { sway: 6, slouch: 6, hip: 6, folded: 6, out: 6, back: 10, pace: 12 };
  for (const key of ["sway", "slouch", "hip", "folded", "out", "back", "pace"]) {
    if (session._flagCool[key] && t < session._flagCool[key]) continue;
    if (flags[key]) {
      if (session._flagSince[key] == null) session._flagSince[key] = t;
      else if (t - session._flagSince[key] >= (holdNeed[key] || 0.9) * runtime.sens.posture) {
        emit(session, session._flagSince[key], key);
        session._flagCool[key] = t + (coolNeed[key] || 6);
        session._flagSince[key] = null;
      }
    } else {
      session._flagSince[key] = null;
    }
  }

  if (gaze?.label === "notes") {
    if (session._gazeDownSince == null) session._gazeDownSince = t;
    else if (t - session._gazeDownSince >= 1.15 * runtime.sens.gaze) {
      emit(session, session._gazeDownSince, "gaze");
      session._gazeDownSince = t + 8;
    }
  } else {
    session._gazeDownSince = null;
  }

  if (hands && hands.length) session._sawHands = true;
  const gazeBoard = isFacingBoard(gaze, pose) || gaze?.label === "board";
  const handBoard = handInBoardRegion(hands, pose);
  // 若本场已经看到过手：写板需「手在板书区」；否则仍用原来的朝向判断（手部模型未加载或距离太远）。
  const onBoard = session._sawHands ? !!(handBoard && (gazeBoard || session._writing || handBoard)) : gazeBoard;
  if (onBoard) {
    session._boardOffSince = null;
    if (session._boardOnSince == null) session._boardOnSince = t;
    if (!session._writing && t - session._boardOnSince >= 1.0) {
      session._writing = true;
      session._writeStart = session._boardOnSince;
      session._writeLookedBack = false;
      session._writeEmitted = false;
    }
    if (session._writing && gaze?.towardClass) session._writeLookedBack = true;
    if (session._writing && !session._writeLookedBack && !session._writeEmitted && t - session._writeStart >= 5.0 * runtime.sens.board) {
      emit(session, t, "board");
      session._writeEmitted = true;
    }
  } else {
    session._boardOnSince = null;
    if (session._writing && (gaze?.towardClass || gaze?.label === "class")) {
      session._writeLookedBack = true;
    }
    if (session._writing) {
      if (session._boardOffSince == null) session._boardOffSince = t;
      if (t - session._boardOffSince >= 0.55) {
        if (!session._writeLookedBack && !session._writeEmitted) {
          emit(session, t, "board");
        }
        session._writing = false;
        session._writeEmitted = true;
        session._boardOffSince = null;
      }
    }
  }

  const sampleEvery = 1 / 15;
  const last = session.frames[session.frames.length - 1];
  if (!last || t - last.t >= sampleEvery) {
    session.frames.push({
      t,
      pose: pose ? pose.map((p) => ({ x: p.x, y: p.y, z: p.z || 0, v: vis(p) })) : null,
      face: face && face.length ? compactFace(face) : null,
      hands: hands && hands.length ? compactHands(hands) : null,
      gaze,
      flags: { ...(flags || {}) },
      onBoard,
    });
  }

  session.duration = t;
}

function compactHands(hands) {
  return hands.map((hand) => (hand || []).map((p) => ({ x: p.x, y: p.y, z: p.z || 0, v: vis(p) })));
}

function compactFace(face) {
  // Keep a short subset used for gaze replay, not all 478 points.
  const idx = [1, 4, 10, 33, 133, 263, 362, 152, 468, 473];
  const out = [];
  for (const i of idx) {
    const p = face[i];
    if (p) out.push({ i, x: p.x, y: p.y, z: p.z || 0 });
  }
  return out;
}

export function addFiller(session, t, word) {
  session.speech.push({ t, word, type: "filler" });
  emit(session, t, "filler", { label: word, word });
}

export function addTranscript(session, t, text, final = true) {
  if (!session.transcript) session.transcript = [];
  const line = String(text || "").trim();
  if (!line) return;
  if (!final) {
    session._interim = { t, text: line, final: false };
    return;
  }
  session._interim = null;
  const last = session.transcript[session.transcript.length - 1];
  if (last && last.text === line && Math.abs(last.t - t) < 0.4) return;
  session.transcript.push({ t, text: line, final: true });
}

export function addCaption(session, t, text, dur = 3.2) {
  session.captions.push({ t, text, dur });
}

export function frameAt(session, t) {
  const frames = session.frames;
  if (!frames.length) return null;
  let lo = 0, hi = frames.length - 1;
  while (lo < hi) {
    const midI = (lo + hi) >> 1;
    if (frames[midI].t < t) lo = midI + 1;
    else hi = midI;
  }
  const b = frames[lo];
  const a = frames[Math.max(0, lo - 1)];
  return Math.abs(a.t - t) < Math.abs(b.t - t) ? a : b;
}

export function diagnose(session) {
  const dur = Math.max(session.duration, 0.1);
  const events = session.events;
  const count = (kindOrType, byType = false) =>
    events.filter((e) => (byType ? e.type : e.kind) === kindOrType).length;

  const nSway = count("sway") + count("posture");
  const nSwayOnly = count("sway", true);
  const nHip = count("hip", true);
  const nFold = count("folded", true);
  const nOut = count("out", true);
  const nBack = count("back", true);
  const nPace = count("pace", true);
  const nGaze = count("gaze");
  const nFill = count("filler");
  const nBoard = count("board");

  const fillers = events.filter((e) => e.type === "filler");
  let cluster = 0;
  for (let i = 0; i < fillers.length; i++) {
    const n = fillers.filter((f) => Math.abs(f.t - fillers[i].t) <= 8).length;
    if (n > cluster) cluster = n;
  }

  let classTime = 0, notesTime = 0, known = 0;
  const fr = session.frames;
  for (let i = 0; i < fr.length; i++) {
    const dt = (fr[i + 1]?.t ?? dur) - fr[i].t;
    const g = fr[i].gaze?.label;
    if (!g || g === "unknown") continue;
    known += dt;
    if (g === "class") classTime += dt;
    if (g === "notes") notesTime += dt;
  }
  const classRatio = known > 0.5 ? classTime / known : 0;
  const notesRatio = known > 0.5 ? notesTime / known : 0;

  const opening = fr.filter((f) => f.t <= 8);
  const openingClass =
    opening.length &&
    opening.filter((f) => f.gaze?.label === "class").length / opening.length >= 0.55;

  const lookedBackSometime = fr.some((f) => f.onBoard) && nBoard === 0 && fr.some((f) => f.onBoard);

  const fillerRep = buildFillerReport(session);
  session.fillerReport = fillerRep;

  // 「最提神的一点」— find something true and specific.
  let good;
  const poseRatio = fr.length ? fr.filter((f) => f.pose).length / fr.length : 0;
  if (session.kind === "camera" && poseRatio < 0.3) {
    session.diagnosis = {
      duration: dur,
      counts: { posture: nSway, sway: nSwayOnly, gaze: nGaze, filler: nFill, board: nBoard, back: nBack, pace: nPace },
      classRatio, notesRatio, cluster, poseRatio, lowVisibility: true,
      good: nFill <= 2 && dur > 15 && session.speechAvailable && session.speechHeard
        ? "口头禅很少，话和话之间留得住空隙。不过这一次画面里大部分时间没有识别到人，教态和视线的统计并不完整。"
        : "你把这一段完整地讲下来了。不过这一次画面里大部分时间没有识别到人，教态和视线的统计并不完整。",
      next: "下一次请退后一点，让腰部以上完整进入画面，光线从正面照过来，再试一次。识别稳定后，诊断才有参考价值。",
      lookedBackSometime: false,
      fillerReport: buildFillerReport(session),
    };
    return session.diagnosis;
  }
  if (openingClass) {
    good = "开场那几秒，你是看着“学生”的。问候落在镜头上，台下会觉得这句话是说给他们听的。";
  } else if (classRatio >= 0.55) {
    good = `这一次里，大约有 ${Math.round(classRatio * 100)}% 的时间，视线是朝着镜头里的学生的。这已经是在对“人”讲，而不只是对讲稿讲。`;
  } else if (nBoard === 0 && fr.some((f) => f.onBoard)) {
    good = "板书写完之后，你有回到学生这边来。回视这一下，四个字才算写完。";
  } else if (nSwayOnly === 0 && nHip === 0 && dur > 20) {
    good = "站姿大体稳住了，没有长时间左右晃，也没有把重心一直撂在一边。学生会先看见这份安定。";
  } else if (nFill <= 2 && dur > 15 && (session.kind === "demo" || (session.speechHeard && session.speechAvailable !== false))) {
    good = "口头禅很少。话和话之间留得住空隙，听起来会更从容。";
  } else if (classRatio > 0.3) {
    good = "中间有一段，你是抬眼看向学生的。把这样的抬眼再多留半拍，整堂都会更稳。";
  } else {
    good = "你把这一段完整地讲下来了。先肯定这件事——能对着镜头把话讲完，本身就是在练站台。";
  }

  // 「下一次可以试的一招」— the single most useful fix.
  let next;
  if (nBack > 0) {
    next = "写板书时侧过身，不要整个人背对学生。侧身写，一边写一边还能看见课堂。";
  } else if (nPace > 0) {
    next = "走到需要走到的地方再停住。来回踱步会把学生的注意力从内容上带走。";
  } else if (nBoard > 0) {
    next = "字写完的那一刻，先转身看学生，再开口。板书是写给学生看的，回视一下，才算写完。";
  } else if (fillerRep.ok && (cluster >= 3 || nFill >= 5)) {
    next = fillerNextAdvice(fillerRep) || "把最常冒出来的那一个词换成半拍停顿，再把那一段重讲一遍。";
  } else if (notesRatio >= 0.28 || nGaze >= 2) {
    next = "把讲稿要点缩成三行，抬眼的时间会自然变多。可以先试：每讲完一句，主动看向镜头里的“学生”停半拍。";
  } else if (nSwayOnly >= 1) {
    next = "双脚与肩同宽，把重心放回两脚之间。可以在心里数「一、二」，再换支撑脚，晃就会小下去。";
  } else if (nHip >= 1) {
    next = "把重心从一侧髋上收回来，膝盖不要锁死。站定时先感觉两只脚都在用力。";
  } else if (nFold >= 1) {
    next = "双手松开，做一次打开的手势，再自然垂在身侧。抱臂会把声音也挡在胸口。";
  } else if (nOut >= 1) {
    next = "先在讲台框里站定。走动要有目的，走到了再停，不要在边上看似随意地晃出去。";
  } else if (!fillerRep.ok && session.kind === "camera") {
    next = fillerRep.reason + "教态和视线仍可回看。下次开讲前可以先点「试一下听写」，确认浏览器能否出字。";
  } else if (classRatio < 0.5) {
    next = "把镜头当成第一排的学生。讲关键句时看它一眼，再低头看稿，节奏会清楚很多。";
  } else {
    next = "下一遍可以故意在板书结束、口头禅要出口、低头看稿这三处各停半秒。停下来的那半秒，往往就是教态最干净的时候。";
  }

  session.diagnosis = {
    duration: dur,
    counts: {
      posture: nSway,
      sway: nSwayOnly,
      gaze: nGaze,
      filler: nFill,
      board: nBoard,
    },
    classRatio,
    notesRatio,
    cluster,
    poseRatio,
    good,
    next,
    lookedBackSometime,
    fillerReport: fillerRep,
  };
  return session.diagnosis;
}
