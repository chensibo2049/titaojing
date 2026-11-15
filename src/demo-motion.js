import { captionAt, paramsAt, DEMO_DURATION } from "./demo.js";

// The same 55-second script drives the animation, on-screen subtitle and replay.
// Clip phases are anchored at each beat, never advanced by a renderer clock.
const BEATS = [
  { t: 0, clip: "idle" },
  { t: 2, clip: "gesture" },
  { t: 6.5, clip: "talk" },
  { t: 8.5, clip: "idle" },
  { t: 9.2, clip: "talk" },
  { t: 14, clip: "idle" },
  { t: 14.8, clip: "talk" },
  { t: 17.8, clip: "gesture" },
  { t: 19, clip: "talk" },
  { t: 23.6, clip: "gesture" },
  { t: 26.5, clip: "talk" },
  { t: 29.5, clip: "board" },
  { t: 44.5, clip: "talk" },
  { t: 52, clip: "idle" },
];

export function demoMotionAt(time) {
  const t = Number.isFinite(time) ? Math.max(0, Math.min(DEMO_DURATION, time)) : 0;
  let beat = BEATS[0];
  for (const next of BEATS) { if (t >= next.t) beat = next; else break; }
  return { t, clip: beat.clip, clipTime: t - beat.t, params: paramsAt(t), caption: captionAt(t) };
}

// Three's projected NDC is in [-1, 1], with Y increasing upwards.
export function pointOnStage(ndc) {
  if (!ndc || ![ndc.x, ndc.y, ndc.z].every(Number.isFinite) || ndc.z < -1 || ndc.z > 1) return null;
  const x = (ndc.x + 1) / 2, y = (1 - ndc.y) / 2;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y, v: 1 };
}

export function projectedPose(points) {
  const pose = Array(33).fill(null);
  const names = { 0: "Bip01 MNose", 11: "Bip01 L UpperArm", 12: "Bip01 R UpperArm", 13: "Bip01 L Forearm", 14: "Bip01 R Forearm", 15: "Bip01 L Hand", 16: "Bip01 R Hand", 23: "Bip01 L Thigh", 24: "Bip01 R Thigh", 25: "Bip01 L Calf", 26: "Bip01 R Calf", 27: "Bip01 L Foot", 28: "Bip01 R Foot", 31: "Bip01 L Toe0", 32: "Bip01 R Toe0" };
  for (const [index, name] of Object.entries(names)) pose[index] = pointOnStage(points[name]);
  // Never draw a partial or independently generated skeleton over a 3D subject.
  return [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28].every((i) => pose[i]) ? pose : null;
}
