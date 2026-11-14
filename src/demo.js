import { REST, mixParams, buildRig, landmarksFromRig, faceFromRig, lerp, ease, clamp } from "./teacher.js";
import { createSession, tickFrame, addFiller, addCaption, addTranscript, extractGaze, extractPosture, diagnose } from "./analyze.js";
import { applyShot } from "./teacher.js";

/**
 * Scripted ~55s mock 试讲.
 * Beats:
 *  0–3   countdown is handled outside; scene is still
 *  0–9   faces the class, greeting, good posture
 *  9–17  looks down at notes
 *  17–26 cluster of 然后 / 就是 / 对吧, slight sway, weight on one hip
 *  26–30 recovers, looks at class
 *  30–44 turns to the board, writes, forgets to look back
 *  44–52 turns back, closes
 */

const KEYS = [
  { t: 0,  p: { ...REST, rArm: 0.3, speak: 0, headPitch: -0.06, gazeY: -0.1 } },
  { t: 2.2, p: { ...REST, rArm: 2.0, headYaw: -0.05, gazeX: 0.05, headPitch: -0.06, gazeY: -0.1, speak: 0.4 } },
  { t: 6.5, p: { ...REST, rArm: 1.6, lArm: 0.2, headPitch: -0.05, gazeY: -0.08, speak: 0.35 } },
  { t: 8.3, p: { ...REST, rArm: 1.3, lArm: 0.2, headPitch: -0.04, gazeY: -0.06, speak: 0.3 } },
  { t: 9.2, p: { ...REST, lArm: 1.0, rArm: 1.0, headPitch: 0.48, gazeY: 0.8, speak: 0.25 } },
  { t: 13, p: { ...REST, lArm: 1.0, rArm: 1.05, headPitch: 0.62, gazeY: 0.9, speak: 0.3 } },
  { t: 16.5, p: { ...REST, lArm: 0.9, rArm: 1.5, headPitch: 0.36, gazeY: 0.55, swayX: 0.01, speak: 0.5 } },
  { t: 18.2, p: { ...REST, lArm: 0.7, rArm: 1.8, headPitch: 0.22, gazeY: 0.3, swayX: -0.03, weight: 0.75, speak: 0.55 } },
  { t: 20.0, p: { ...REST, lArm: 0.8, rArm: 0.9, headPitch: 0.08, gazeY: 0.05, swayX: 0.034, weight: 0.85, speak: 0.5 } },
  { t: 22.0, p: { ...REST, lArm: 0.6, rArm: 2.0, headPitch: 0.12, gazeY: 0.1, swayX: -0.034, weight: 0.8, speak: 0.45 } },
  { t: 24.2, p: { ...REST, lArm: 0.4, rArm: 1.7, headPitch: 0.18, gazeY: 0.15, swayX: 0.03, weight: 0.7, speak: 0.4 } },
  { t: 26.5, p: { ...REST, rArm: 2.0, swayX: 0, weight: 0, headPitch: -0.06, gazeY: -0.1, speak: 0.4 } },
  { t: 29.5, p: { ...REST, rArm: 1.4, bodyYaw: 0.15, headYaw: 0.15, headPitch: -0.04, gazeY: -0.05, speak: 0.3 } },
  { t: 31.2, p: { ...REST, bodyYaw: 0.72, headYaw: 0.45, rArm: 3.0, lArm: 0.2, chalk: 0.05, speak: 0.2 } },
  { t: 34.5, p: { ...REST, bodyYaw: 0.85, headYaw: 0.55, rArm: 3.0, chalk: 0.4, weight: 0.25, speak: 0.15 } },
  { t: 38.5, p: { ...REST, bodyYaw: 0.88, headYaw: 0.6, rArm: 3.05, chalk: 0.75, weight: 0.3, speak: 0.1 } },
  { t: 42.5, p: { ...REST, bodyYaw: 0.86, headYaw: 0.5, rArm: 3.0, chalk: 1, weight: 0.2, speak: 0.15 } },
  { t: 45.0, p: { ...REST, bodyYaw: 0.2, headYaw: 0.05, headPitch: -0.06, gazeY: -0.1, rArm: 1.8, chalk: 1, speak: 0.4 } },
  { t: 48.5, p: { ...REST, rArm: 2.0, chalk: 1, headPitch: -0.05, gazeY: -0.08, speak: 0.35 } },
  { t: 52.5, p: { ...REST, rArm: 0.4, chalk: 1, headPitch: -0.04, speak: 0 } },
  { t: 55.0, p: { ...REST, chalk: 1, speak: 0 } },
];

export const DEMO_DURATION = 55;

const CAPTIONS = [
  { t: 2.0,  dur: 5.2, text: "同学们好，今天我们一起来读这一句诗。" },
  { t: 8.6,  dur: 5.0, text: "请大家先看题目，再看下面这一句。" },
  { t: 14.8, dur: 3.6, text: "然后……然后我们看「疑是地上霜」。" },
  { t: 19.2, dur: 4.2, text: "就是……作者刚刚醒来，看见地上的光。" },
  { t: 24.0, dur: 4.0, text: "对吧，大家先感受这一层凉意。" },
  { t: 29.5, dur: 5.0, text: "我把这四个字写在黑板上。" },
  { t: 36.0, dur: 5.5, text: "疑　是　地　上　霜。" },
  { t: 45.0, dur: 5.0, text: "好，我们再一起把这一句读一遍。" },
];

const FILLER_CUES = [
  { t: 15.1, word: "然后" },
  { t: 16.4, word: "然后" },
  { t: 19.4, word: "就是" },
  { t: 24.15, word: "对吧" },
];

export function paramsAt(t) {
  if (t <= KEYS[0].t) return { ...KEYS[0].p };
  if (t >= KEYS[KEYS.length - 1].t) return { ...KEYS[KEYS.length - 1].p };
  let i = 0;
  while (i < KEYS.length - 1 && KEYS[i + 1].t < t) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const u = ease(clamp((t - a.t) / Math.max(0.001, b.t - a.t), 0, 1));
  const mixed = mixParams(a.p, b.p, u);
  // Add a living sway only in the “nervous” window so analysis can catch oscillation.
  if (t >= 17 && t <= 26) {
    mixed.swayX = (mixed.swayX || 0) + Math.sin((t - 17) * 2.2) * 0.03;
  }
  // blink
  const blinkCycle = ((t * 0.7) % 3.6);
  mixed.blink = blinkCycle > 3.42 ? (blinkCycle - 3.42) / 0.18 : 0;
  mixed.breath = 1;
  return mixed;
}

export function captionAt(t) {
  let cur = null;
  for (const c of CAPTIONS) {
    if (t >= c.t && t < c.t + c.dur) cur = c;
  }
  return cur;
}

export function fillersUntil(t, already) {
  return FILLER_CUES.filter((f) => f.t <= t && !already.has(f.t));
}

export function sampleDemo(t, shot = "half") {
  const p = { ...paramsAt(t), shot };
  let rig = buildRig(p, t);
  if (shot) rig = applyShot(rig, shot);
  const pose = landmarksFromRig(rig);
  const face = faceFromRig(rig);
  const gaze = extractGaze(pose, face, null);
  return { p, rig, pose, face, gaze };
}

/** Pre-bake a complete demo session so replay/diagnosis share the live engine. */
export function bakeDemoSession() {
  const session = createSession("demo");
  session.visionAvailable = true;
  session.speechAvailable = true;
  session.speechHeard = true;
  const dt = 1 / 20;
  let histBuf = session;
  for (let t = 0; t <= DEMO_DURATION + 0.001; t += dt) {
    const { pose, face, gaze, p } = sampleDemo(t);
    const posture = extractPosture(pose, session._hist);
    tickFrame(session, t, pose, face, gaze, posture);
  }
  for (const c of CAPTIONS) {
    addCaption(session, c.t, c.text, c.dur);
    addTranscript(session, c.t, c.text, true);
  }
  for (const f of FILLER_CUES) addFiller(session, f.t, f.word);
  session.duration = DEMO_DURATION;
  session.frameResolved = "half";
  session.asrEngine = "demo";
  diagnose(session);
  return session;
}

export { CAPTIONS, FILLER_CUES, lerp };
