/** Convert a live/analysed session into a compact, storable record and back. */
import { APP_VERSION } from "./version.js";

const r3 = (n) => Math.round((n || 0) * 1000) / 1000;
const r2 = (n) => Math.round((n || 0) * 100) / 100;

export function newId() {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function metricsOf(session) {
  const d = session.diagnosis || {};
  const c = d.counts || {};
  const dur = Math.max(1, d.duration || session.duration || 1);
  const min = dur / 60;
  const per = (n) => r2((n || 0) / min);
  return {
    duration: Math.round(dur),
    posture: c.posture || 0,
    gaze: c.gaze || 0,
    filler: c.filler || 0,
    board: c.board || 0,
    perMin: { posture: per(c.posture), gaze: per(c.gaze), filler: per(c.filler), board: per(c.board) },
    classRatio: r2(d.classRatio || 0),
    notesRatio: r2(d.notesRatio || 0),
  };
}

/** Downsample frames to ~5 fps and compact landmarks to [x,y,v] triplets. */
function packFrames(frames, fps = 5) {
  const out = [];
  let last = -1;
  for (const f of frames || []) {
    if (last >= 0 && f.t - last < 1 / fps - 0.001) continue;
    last = f.t;
    out.push({
      t: r2(f.t),
      p: f.pose ? f.pose.flatMap((q) => [r3(q.x), r3(q.y), r2(q.v ?? q.visibility ?? 1)]) : null,
      g: f.gaze ? [f.gaze.label, r2(f.gaze.yaw), r2(f.gaze.pitch)] : null,
      f: Object.keys(f.flags || {}).filter((k) => f.flags[k]),
      b: f.onBoard ? 1 : 0,
      h: f.hands && f.hands.length
        ? f.hands.map((hand) => (hand || []).flatMap((q) => [r3(q.x), r3(q.y), r2(q.v ?? q.visibility ?? 1)]))
        : null,
    });
  }
  return out;
}

function unpackHands(h) {
  if (!h || !h.length) return null;
  return h.map((flat) => {
    if (!flat) return [];
    if (Array.isArray(flat) && flat.length && typeof flat[0] === "object") return flat;
    const hand = [];
    for (let i = 0; i < flat.length; i += 3) hand.push({ x: flat[i], y: flat[i + 1], z: 0, v: flat[i + 2], visibility: flat[i + 2] });
    return hand;
  });
}

export function unpackFrames(packed) {
  return (packed || []).map((f) => {
    let pose = null;
    if (f.p) {
      pose = [];
      for (let i = 0; i < f.p.length; i += 3) pose.push({ x: f.p[i], y: f.p[i + 1], z: 0, v: f.p[i + 2], visibility: f.p[i + 2] });
    }
    const flags = {};
    for (const k of f.f || []) flags[k] = true;
    return {
      t: f.t,
      pose,
      gaze: f.g ? { label: f.g[0], yaw: f.g[1], pitch: f.g[2], towardClass: f.g[0] === "class" } : null,
      flags,
      onBoard: !!f.b,
      hands: unpackHands(f.h),
    };
  });
}

export function toRecord(session, extra = {}) {
  const id = session.id || newId();
  session.id = id;
  return {
    id,
    v: 1,
    appVersion: APP_VERSION,
    kind: session.kind,
    title: extra.title || "",
    startedAt: session.startedAt,
    savedAt: Date.now(),
    duration: Math.round((session.duration || 0) * 100) / 100,
    aspect: session.aspect || 9 / 16,
    mirror: !!session.mirror,
    settings: session.settingsSnapshot || null,
    diagnosis: session.diagnosis,
    metrics: metricsOf(session),
    events: (session.events || []).map((e) => ({ t: r2(e.t), type: e.type, kind: e.kind, label: e.label, word: e.word })),
    captions: session.captions || [],
    frames: session.kind === "demo" ? [] : packFrames(session.frames),
    thumb: session.thumb || "",
    hasVideo: false,
    videoSize: 0,
    videoType: "",
    speechAvailable: !!session.speechAvailable,
    speechHeard: session.speechHeard !== false,
    visionAvailable: !!session.visionAvailable,
    stats: session.stats || null,
    transcript: session.transcript || [],
    frameMode: session.frameMode || null,
    frameResolved: session.frameResolved || null,
    sessionMode: session.sessionMode || null,
    asrEngine: session.asrEngine || null,
    boardStills: (session.boardStills || []).map((s) => ({ t: r2(s.t), dataUrl: s.dataUrl })),
    profileName: extra.profileName || session.profileName || "",
    speechError: session.speechError || "",
    simLog: session.simLog || null,
  };
}

/** Rebuild a replayable session object from a stored record. */
export function fromRecord(rec) {
  return {
    id: rec.id,
    kind: rec.kind,
    startedAt: rec.startedAt,
    duration: rec.duration,
    frames: unpackFrames(rec.frames),
    speech: [],
    events: rec.events || [],
    captions: rec.captions || [],
    videoBlob: null,
    videoUrl: null,
    aspect: rec.aspect || 9 / 16,
    mirror: !!rec.mirror,
    settingsSnapshot: rec.settings,
    diagnosis: rec.diagnosis,
    thumb: rec.thumb,
    stats: rec.stats,
    speechAvailable: rec.speechAvailable,
    speechHeard: rec.speechHeard,
    visionAvailable: rec.visionAvailable,
    fromHistory: true,
    stored: true,
    hasVideo: rec.hasVideo,
    transcript: rec.transcript || [],
    frameMode: rec.frameMode || null,
    frameResolved: rec.frameResolved || null,
    sessionMode: rec.sessionMode || null,
    asrEngine: rec.asrEngine || null,
    boardStills: rec.boardStills || [],
    profileName: rec.profileName || "",
    speechError: rec.speechError || "",
    fillerReport: rec.diagnosis && rec.diagnosis.fillerReport ? rec.diagnosis.fillerReport : null,
    simLog: rec.simLog || null,
  };
}

export function fmtDate(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtShortDate(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtBytes(n) {
  if (!n) return "0 KB";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function fmtDur(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
