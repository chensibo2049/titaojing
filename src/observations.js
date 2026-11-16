/** Neutral, versioned observations. No teaching-quality or psychological judgments. */
export const OBSERVATION_VERSION = "visual-events/1.0.0";
export function observeSession(session) {
  const frames = session.frames || [];
  const duration = Math.max(0.1, session.duration || 0);
  const demo = session.kind === "demo";
  const source = demo ? "preset-animation-rig" : session.localImport ? "local-video-mediapipe" : "local-camera-mediapipe";
  const poseRatio = frames.length ? frames.filter(f => f.pose).length / frames.length : 0;
  const poseOK = demo || (session.visionAvailable !== false && poseRatio >= 0.3);
  let known = 0, classTime = 0, notesTime = 0;
  for (let i = 0; i < frames.length; i++) {
    const dt = Math.max(0, Math.min(duration, frames[i + 1]?.t ?? duration) - frames[i].t);
    const label = frames[i].gaze?.label;
    if (!label || label === "unknown") continue;
    known += dt;
    if (label === "class") classTime += dt;
    if (label === "notes") notesTime += dt;
  }
  const gazeOK = demo || known > 0.5;
  const speechOK = demo || (session.speechAvailable === true && session.speechHeard === true);
  const available = { posture: poseOK, sway: poseOK, back: poseOK, pace: poseOK, gaze: gazeOK, filler: speechOK, board: poseOK && gazeOK };
  const evidence = (session.events || []).map(e => ({ ...e, source: e.kind === "filler" || e.type === "filler" ? (demo ? "preset-transcript" : session.asrEngine || "browser-speech") : source, observationVersion: OBSERVATION_VERSION }));
  const count = (kind, byType = false) => evidence.filter(e => (byType ? e.type : e.kind) === kind).length;
  const counts = { posture: count("sway") + count("posture"), sway: count("sway", true), gaze: count("gaze"), filler: count("filler"), board: count("board"), back: count("back", true), pace: count("pace", true) };
  for (const key of Object.keys(counts)) if (!available[key]) counts[key] = null;
  const fillers = evidence.filter(e => e.type === "filler");
  const cluster = speechOK ? fillers.reduce((max, e) => Math.max(max, fillers.filter(f => Math.abs(f.t - e.t) <= 8).length), 0) : null;
  return {
    schemaVersion: 1, observationVersion: OBSERVATION_VERSION, source, demo, duration,
    counts, available, evidence, poseRatio, gazeKnownSeconds: known,
    classRatio: gazeOK && known ? classTime / known : null,
    notesRatio: gazeOK && known ? notesTime / known : null,
    cluster, lowVisibility: !poseOK,
    missing: [!poseOK && "体态画面不足，不能把未标记当作没有发生。", !gazeOK && "头部朝向不可判；不是精确眼动。", !speechOK && (session.speechError || "没有可用转写，口头禅未统计。"), ...(session.captureWarnings || [])].filter(Boolean),
  };
}
