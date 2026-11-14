import { FilesetResolver, PoseLandmarker, FaceLandmarker, HandLandmarker } from "@mediapipe/tasks-vision";

const WASM_PATH = "assets/mediapipe/wasm";
const POSE_MODEL = "assets/mediapipe/models/pose_landmarker_lite.task";
const FACE_MODEL = "assets/mediapipe/models/face_landmarker.task";
const HAND_MODEL = "assets/mediapipe/models/hand_landmarker.task";
const LOAD_TIMEOUT_MS = 90000;

let fileset = null;
let pose = null;
let face = null;
let hands = null;
let initPromise = null;
let initError = null;
let handsError = null;
let delegate = { pose: null, face: null, hands: null, reason: "" };
let bufs = { pose: null, face: null, hands: null };
let gl = null; // { renderer, software }
let loadMs = 0;
const timings = { downloadMs: null, filesetMs: null, poseMs: null, faceMs: null, handsMs: null, simd: null };
const progress = { loaded: 0, total: 0, phase: "idle", listeners: new Set() };

export function visionStatus() {
  return {
    ready: !!(pose && face),
    pose: !!pose,
    face: !!face,
    hands: !!hands,
    error: initError,
    handsError,
    delegate: { ...delegate },
    gl,
    loadMs,
    timings: { ...timings },
    phase: progress.phase,
  };
}

export function onVisionProgress(fn) {
  progress.listeners.add(fn);
  fn(snapshot());
  return () => progress.listeners.delete(fn);
}

function snapshot() {
  const pct = progress.total ? Math.min(100, Math.round((progress.loaded / progress.total) * 100)) : 0;
  return { phase: progress.phase, pct, loaded: progress.loaded, total: progress.total };
}

function emit(phase) {
  if (phase) progress.phase = phase;
  const s = snapshot();
  for (const fn of progress.listeners) { try { fn(s); } catch (_) {} }
}

/** fetch() with byte progress; resolves to Uint8Array. Falls back to arrayBuffer if no streams. */
async function fetchWithProgress(url, expected, onBytes) {
  const res = await fetch(url, { cache: "force-cache" });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  const len = Number(res.headers.get("content-length")) || expected;
  if (!res.body || !res.body.getReader) {
    const buf = new Uint8Array(await res.arrayBuffer());
    onBytes(buf.byteLength, len);
    return buf;
  }
  const reader = res.body.getReader();
  const parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.byteLength;
    onBytes(value.byteLength, len);
  }
  const out = new Uint8Array(got);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.byteLength; }
  return out;
}

/**
 * 浏览器是否在用软件渲染（SwiftShader / llvmpipe / Microsoft Basic Render Driver）。
 * 这种情况下 MediaPipe 的「GPU」其实跑在 CPU 上模拟，比直接用 CPU 慢很多，是卡顿的常见原因。
 */
export function detectGL() {
  if (gl) return gl;
  gl = { renderer: "", software: false };
  try {
    const c = document.createElement("canvas");
    const ctx = c.getContext("webgl2") || c.getContext("webgl");
    if (!ctx) { gl = { renderer: "无 WebGL", software: true }; return gl; }
    const ext = ctx.getExtension("WEBGL_debug_renderer_info");
    const r = String(ext ? ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ctx.getParameter(ctx.RENDERER) || "");
    gl = { renderer: r.slice(0, 120), software: /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i.test(r) };
    const lose = ctx.getExtension("WEBGL_lose_context");
    if (lose) lose.loseContext();
  } catch (_) {}
  return gl;
}

async function createPose(buffer, dlg) {
  return PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetBuffer: buffer, delegate: dlg },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.4,
    minPosePresenceConfidence: 0.4,
    minTrackingConfidence: 0.4,
  });
}

async function createFace(buffer, dlg) {
  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetBuffer: buffer, delegate: dlg },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: true,
  });
}

async function createHands(buffer, dlg) {
  return HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetBuffer: buffer, delegate: dlg },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.45,
    minHandPresenceConfidence: 0.45,
    minTrackingConfidence: 0.45,
  });
}

export function initVision() {
  if (initPromise) return initPromise;
  const t0 = performance.now();
  const work = (async () => {
    try {
      emit("download");
      let simd = true;
      try { simd = await FilesetResolver.isSimdSupported(); } catch (_) {}
      timings.simd = simd;
      const wasmUrl = `${WASM_PATH}/${simd ? "vision_wasm_internal.wasm" : "vision_wasm_nosimd_internal.wasm"}`;
      // Approximate sizes so the bar moves even without content-length.
      // Hands are optional and fetched after the core models so a missing file does not block pose+face.
      const sizes = [simd ? 11453626 : 10647962, 5777746, 3758596];
      progress.total = sizes.reduce((a, b) => a + b, 0);
      progress.loaded = 0;
      const onBytes = (n) => { progress.loaded += n; emit(); };
      const [, poseBuf, faceBuf] = await Promise.all([
        fetchWithProgress(wasmUrl, sizes[0], onBytes).catch(() => null),
        fetchWithProgress(POSE_MODEL, sizes[1], onBytes),
        fetchWithProgress(FACE_MODEL, sizes[2], onBytes),
      ]);
      timings.downloadMs = Math.round(performance.now() - t0);
      emit("init");
      let tA = performance.now();
      fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
      timings.filesetMs = Math.round(performance.now() - tA);
      tA = performance.now();
      bufs.pose = poseBuf; bufs.face = faceBuf;
      const g = detectGL();
      const first = g.software ? "CPU" : "GPU";
      delegate.reason = g.software ? `浏览器在用软件渲染（${g.renderer || "未知"}），直接用 CPU 更快` : "先试 GPU";
      try { pose = await createPose(poseBuf, first); delegate.pose = first; }
      catch (e) {
        try { pose = await createPose(poseBuf, "CPU"); delegate.pose = "CPU"; }
        catch (e2) { initError = "pose: " + (e2?.message || e2); }
      }
      timings.poseMs = Math.round(performance.now() - tA);
      tA = performance.now();
      try { face = await createFace(faceBuf, delegate.pose || first); delegate.face = delegate.pose || first; }
      catch (e) {
        try { face = await createFace(faceBuf, "CPU"); delegate.face = "CPU"; }
        catch (e2) { initError = (initError ? initError + "; " : "") + "face: " + (e2?.message || e2); }
      }
      timings.faceMs = Math.round(performance.now() - tA);
      if (pose || face) initError = pose && face ? null : initError;
      loadMs = Math.round(performance.now() - t0);
      emit(pose || face ? "ready" : "error");

      // Optional hands: never fail the whole init.
      try {
        const handExpected = 7819105;
        progress.total += handExpected;
        const handBuf = await fetchWithProgress(HAND_MODEL, handExpected, onBytes);
        bufs.hands = handBuf;
        tA = performance.now();
        try { hands = await createHands(handBuf, delegate.pose || "GPU"); delegate.hands = delegate.pose || "GPU"; }
        catch (e) {
          try { hands = await createHands(handBuf, "CPU"); delegate.hands = "CPU"; }
          catch (e2) { handsError = e2?.message || String(e2); hands = null; }
        }
        timings.handsMs = Math.round(performance.now() - tA);
      } catch (e) {
        hands = null;
        handsError = e && e.message ? e.message : "手部模型未加载";
        timings.handsMs = 0;
      }
      emit(pose || face ? "ready" : "error");
    } catch (err) {
      initError = err && err.message ? err.message : String(err);
      loadMs = Math.round(performance.now() - t0);
      emit("error");
    }
    loadMs = Math.round(performance.now() - t0);
    return visionStatus();
  })();
  const timeout = new Promise((resolve) => setTimeout(() => {
    if (!pose && !face) {
      initError = initError || "timeout";
      emit("timeout");
    }
    resolve(visionStatus());
  }, LOAD_TIMEOUT_MS));
  initPromise = Promise.race([work, timeout]);
  return initPromise;
}

/** 运行中切换 GPU / CPU（自动性能模式用）。返回切换后的 delegate。 */
export async function switchDelegate(dlg) {
  if (!fileset) return { ...delegate };
  const swap = async (cur, create, buf, key) => {
    if (!cur || !buf) return cur;
    try {
      const next = await create(buf, dlg);
      try { cur.close && cur.close(); } catch (_) {}
      delegate[key] = dlg;
      return next;
    } catch (_) { return cur; }
  };
  pose = await swap(pose, createPose, bufs.pose, "pose");
  face = await swap(face, createFace, bufs.face, "face");
  hands = await swap(hands, createHands, bufs.hands, "hands");
  lastTs += 1000; // 新实例也要求时间戳递增
  return { ...delegate };
}

/** Allow「重试加载」after an error/timeout. */
export function resetVision() {
  if (pose || face) return;
  initPromise = null;
  initError = null;
  handsError = null;
  progress.phase = "idle";
}

let frameNo = 0;
let lastFace = null;
let lastHands = null;
let lastTs = 0;

/**
 * @param {object} opts  mirror: flip x so landmarks match a mirrored preview;
 *                       faceEvery: run face model every N frames (low-power mode);
 *                       handEvery: run hand model every N frames.
 */
export function detectVideo(video, timestampMs, opts = {}) {
  const { mirror = false, faceEvery = 1, handEvery = 1 } = opts;
  const out = { pose: null, face: null, matrix: null, hands: null, ms: 0, msPose: 0, msFace: 0, msHands: 0, ranFace: false, ranHands: false };
  if (!video || video.readyState < 2 || !video.videoWidth) return out;
  // MediaPipe requires strictly increasing timestamps.
  const ts = Math.max(timestampMs, lastTs + 1);
  lastTs = ts;
  frameNo += 1;
  const t0 = performance.now();
  let tm = t0;
  try {
    if (pose) {
      const r = pose.detectForVideo(video, ts);
      if (r && r.landmarks && r.landmarks[0]) {
        out.pose = r.landmarks[0].map((p) => ({
          x: mirror ? 1 - p.x : p.x, y: p.y, z: p.z || 0,
          visibility: p.visibility ?? 0.9,
          v: p.visibility ?? 0.9,
        }));
      }
    }
  } catch (_) { /* frame skip */ }
  out.msPose = performance.now() - tm;
  tm = performance.now();
  try {
    if (face && faceEvery > 1 && frameNo % faceEvery !== 0) {
      out.face = lastFace;
    } else if (face) {
      out.ranFace = true;
      lastFace = null;
      const r = face.detectForVideo(video, ts);
      if (r && r.faceLandmarks && r.faceLandmarks[0]) {
        out.face = mirror ? r.faceLandmarks[0].map((p) => ({ x: 1 - p.x, y: p.y, z: p.z })) : r.faceLandmarks[0];
        lastFace = out.face;
        // The transformation matrix yaw sign flips under mirroring; drop it and use landmark geometry.
        const m = r.facialTransformationMatrixes && r.facialTransformationMatrixes[0];
        if (!mirror) {
          if (m && m.data) out.matrix = Array.from(m.data);
          else if (m && m.length) out.matrix = Array.from(m);
        }
      }
    }
  } catch (_) { /* frame skip */ }
  out.msFace = performance.now() - tm;
  tm = performance.now();
  try {
    if (hands && handEvery > 0 && handEvery < Infinity && !(handEvery <= 1 || (frameNo + 1) % handEvery === 0)) {
      // 这一帧不跑手部：沿用上一次的结果（画面上的手不会闪）
      out.hands = lastHands;
    } else if (hands && handEvery > 0 && handEvery < Infinity) {
      out.ranHands = true;
      lastHands = null;
      const r = hands.detectForVideo(video, ts);
      const lists = r && (r.landmarks || r.handLandmarks);
      if (lists && lists.length) {
        out.hands = lists.map((hand, i) => {
          const pts = hand.map((p) => ({
            x: mirror ? 1 - p.x : p.x,
            y: p.y,
            z: p.z || 0,
            v: p.visibility ?? 0.9,
            visibility: p.visibility ?? 0.9,
          }));
          const hd = r.handedness && (r.handedness[i] || r.handednesses?.[i]);
          const cat = Array.isArray(hd) ? hd[0] : hd;
          let label = cat && (cat.categoryName || cat.displayName) || "";
          if (mirror && label === "Left") label = "Right";
          else if (mirror && label === "Right") label = "Left";
          pts.handedness = label;
          return pts;
        });
        lastHands = out.hands;
      }
    }
  } catch (_) { /* frame skip */ }
  out.msHands = performance.now() - tm;
  out.ms = performance.now() - t0;
  return out;
}
