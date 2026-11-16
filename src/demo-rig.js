// Original procedural presenter choreography. Units are metres; +Z faces the class.
// Every channel is a pure function of the shared absolute demo time (no accumulated deltas).
const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const smooth = (a, b, t) => { const x = clamp((t - a) / (b - a)); return x * x * (3 - 2 * x); };
const windowAt = (a, b, c, d, t) => smooth(a, b, t) * (1 - smooth(c, d, t));
export const DEMO_PHASES = [
  { start: 0, end: 2, label: "准备开场", detail: "站定、呼吸，准备向学生问好" },
  { start: 2, end: 9, label: "开场问好", detail: "抬眼面向学生，用开放手势引入诗句" },
  { start: 9, end: 17, label: "低头找稿", detail: "视线随头部下落，双手靠近讲稿" },
  { start: 17, end: 26, label: "卡顿与犹豫", detail: "手势停住再起，重心轻微左右摆动" },
  { start: 26, end: 30, label: "重新组织", detail: "放松肩膀，回到面向学生的讲解" },
  { start: 30, end: 44, label: "转身板书", detail: "肩颈转向黑板、抬手书写，暂未回视学生" },
  { start: 44, end: 55, label: "回看学生", detail: "落手转回课堂，邀请学生再读一遍" },
];
export function presenterAt(time) {
  const t = clamp(Number.isFinite(time) ? time : 0, 0, 55);
  const read = windowAt(8.7, 10.3, 15.7, 17.4, t);
  const hesitate = windowAt(17, 18.2, 24.9, 26.5, t);
  const board = windowAt(30, 32.5, 43.8, 45.4, t);
  const write = windowAt(32, 33.3, 42.6, 43.8, t);
  // Deliberately separated gesture envelopes leave quiet holds between phrases.
  const gesture = windowAt(2, 3.2, 5.2, 6.8, t) + .65 * windowAt(6.8, 7.5, 8, 8.8, t)
    + .55 * windowAt(26.3, 27.3, 28, 29.5, t) + .7 * windowAt(46, 47, 49.2, 50.5, t);
  const hesitationHand = windowAt(18, 18.8, 19.5, 20.3, t) + .7 * windowAt(22, 22.8, 23.4, 24.3, t);
  const pulse = t % 4.7;
  const blink = windowAt(4.37, 4.47, 4.52, 4.65, pulse);
  const phase = DEMO_PHASES.find(p => t >= p.start && t < p.end) || DEMO_PHASES.at(-1);
  return { t, phase, read, board, write, gesture, hesitationHand, blink,
    yaw: board * 1.45,
    headYaw: .045 * Math.sin(t * .65) * (1 - read) * (1 - board) + board * .27,
    headPitch: read * .48 + hesitate * .09 + .012 * Math.sin(t * 1.8) * (1 - board),
    breath: .006 * Math.sin(t * 1.65),
    sway: hesitate * .027 * Math.sin((t - 17) * 1.7),
    lean: hesitate * .025 * Math.sin((t - 17) * 1.7),
    writingProgress: clamp((t - 33) / 9),
    writingStroke: write * Math.sin(t * 5.4),
  };
}

// Analytic two-bone IK; fixed lengths, elbow always on its authored pole side.
export function solveArm(shoulder, target, pole, upper = .38, lower = .36) {
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const add = (a, b) => a.map((v, i) => v + b[i]);
  const mul = (a, k) => a.map(v => v * k);
  const dot = (a, b) => a.reduce((n, v, i) => n + v * b[i], 0);
  const norm = a => Math.hypot(...a);
  const delta = sub(target, shoulder), rawDistance = norm(delta);
  const direction = rawDistance > 1e-8 ? mul(delta, 1 / rawDistance) : [0, -1, 0];
  const distance = clamp(rawDistance, Math.abs(upper - lower) + .03, upper + lower - .015);
  let bend = sub(sub(pole, shoulder), mul(direction, dot(sub(pole, shoulder), direction)));
  if (norm(bend) < 1e-6) {
    const axis = Math.abs(direction[2]) < .9 ? [0, 0, 1] : [1, 0, 0];
    bend = sub(axis, mul(direction, dot(axis, direction)));
  }
  bend = mul(bend, 1 / norm(bend));
  const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
  const height = Math.sqrt(Math.max(0, upper * upper - along * along));
  return { shoulder: [...shoulder], elbow: add(add(shoulder, mul(direction, along)), mul(bend, height)), wrist: add(shoulder, mul(direction, distance)), reachClamped: rawDistance > upper + lower - .015 };
}
