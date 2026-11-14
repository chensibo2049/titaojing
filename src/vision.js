import { FilesetResolver, PoseLandmarker, FaceLandmarker } from "@mediapipe/tasks-vision";

const WASM_PATH = "assets/mediapipe/wasm";
const POSE_MODEL = "assets/mediapipe/models/pose_landmarker_lite.task";
const FACE_MODEL = "assets/mediapipe/models/face_landmarker.task";
const LOAD_TIMEOUT_MS = 90000;

let fileset = null;
let pose = null;
let face = null;
let initPromise = null;
let initError = null;
let delegate = { pose: null, face: null };
let loadMs = 0;
const timings = { downloadMs: null, filesetMs: null, poseMs: null, faceMs: null, simd: null };
const progress = { loaded: 0, total: 0, phase: "idle", listeners: new Set() };

export function visionStatus() {
  return {
    ready: !!(pose && face),
    pose: !!pose,
    face: !!face,
    error: initError,
    delegate: { ...delegate },
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
      const sizes = [simd ? 11453626 : 10647962, 5777746, 3758596];
      progress.total = sizes.reduce((a, b) => a + b, 0);
      progress.loaded = 0;
      const onBytes = (n) => { progress.loaded += n; emit(); };
      // Warm the wasm into HTTP / Service Worker cache; FilesetResolver then loads it from cache.
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
      try { pose = await createPose(poseBuf, "GPU"); delegate.pose = "GPU"; }
      catch (e) {
        try { pose = await createPose(poseBuf, "CPU"); delegate.pose = "CPU"; }
        catch (e2) { initError = "pose: " + (e2?.message || e2); }
      }
      timings.poseMs = Math.round(performance.now() - tA);
      tA = performance.now();
      try { face = await createFace(faceBuf, "GPU"); delegate.face = "GPU"; }
      catch (e) {
        try { face = await createFace(faceBuf, "CPU"); delegate.face = "CPU"; }
        catch (e2) { initError = (initError ? initError + "; " : "") + "face: " + (e2?.message || e2); }
      }
      timings.faceMs = Math.round(performance.now() - tA);
      if (pose || face) initError = pose && face ? null : initError;
    } catch (err) {
      initError = err && err.message ? err.message : String(err);
    }
    loadMs = Math.round(performance.now() - t0);
    emit(pose || face ? "ready" : "error");
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

/** Allow「重试加载」after an error/timeout. */
export function resetVision() {
  if (pose || face) return;
  initPromise = null;
  initError = null;
  progress.phase = "idle";
}

let frameNo = 0;
let lastFace = null;
let lastTs = 0;

/**
 * @param {object} opts  mirror: flip x so landmarks match a mirrored preview;
 *                       faceEvery: run face model every N frames (low-power mode).
 */
export function detectVideo(video, timestampMs, opts = {}) {
  const { mirror = false, faceEvery = 1 } = opts;
  const out = { pose: null, face: null, matrix: null, ms: 0 };
  if (!video || video.readyState < 2 || !video.videoWidth) return out;
  // MediaPipe requires strictly increasing timestamps.
  const ts = Math.max(timestampMs, lastTs + 1);
  lastTs = ts;
  frameNo += 1;
  const t0 = performance.now();
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
  try {
    if (face && faceEvery > 1 && frameNo % faceEvery !== 0) {
      out.face = lastFace;
    } else if (face) {
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
  out.ms = performance.now() - t0;
  return out;
}
