import { POSE as P, EVENT_META, runtime, boardSign as sideSign, podiumBox, boardBox, HAND_TIPS } from "./constants.js";
import { buildFillerReport } from "./fillers.js";
import { observeSession } from "./observations.js";
import { interpretPractice } from "./scenario-practice.js";

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
  const observation = observeSession(session);
  const interpretation = interpretPractice(observation);
  const fillerReport = buildFillerReport(session);
  session.fillerReport = fillerReport;
  session.diagnosis = {
    ...observation, good: interpretation.good, next: interpretation.next,
    observation, interpretation, fillerReport,
    lookedBackSometime: observation.available.board && observation.counts.board === 0 && (session.frames || []).some(f => f.onBoard),
  };
  return session.diagnosis;
}
