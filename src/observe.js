/**
 * 回放观察记录与「整节课」层：只根据本机已有的转写、时间戳和姿态计算，不作好坏评分。
 */
import { midHip, lm } from "./analyze.js";
import { POSE as P } from "./constants.js";
import { observeSession, OBSERVATION_VERSION } from "./observations.js";
import { interpretPractice } from "./scenario-practice.js";

export const OBSERVE_RULE_VERSION = "review-details/1.0.0";

/** Shared, read-only presentation contract. Never re-diagnose or migrate a stored record. */
export function buildReviewContext(session = {}) {
  const d = session.diagnosis || {};
  const saved = d.observation;
  const demo = session.kind === "demo";
  const imported = !!session.localImport || session.stats?.source === "local-video" || saved?.source === "local-video-mediapipe";
  const legacy = !!session.diagnosis && !saved;
  const derived = saved || observeSession({ ...session, localImport: imported });
  const available = { ...derived.available };
  if (!demo && session.visionAvailable === false) {
    for (const key of ["posture", "sway", "back", "pace", "gaze", "board"]) available[key] = false;
  }
  if (!demo && (session.speechAvailable === false || session.speechHeard === false)) available.filler = false;
  const counts = {};
  for (const key of Object.keys(available)) {
    const value = (saved?.counts || d.counts || derived.counts)[key];
    counts[key] = available[key] && Number.isFinite(value) ? value : null;
  }
  const source = demo ? "preset-animation-rig" : imported ? "local-video-mediapipe" : saved?.source || (session.kind === "camera" ? "local-camera-mediapipe" : "unknown");
  const observationVersion = saved?.observationVersion || (legacy ? "旧版未记录" : saved ? "未记录" : OBSERVATION_VERSION);
  const rawEvidence = saved?.evidence?.length ? saved.evidence : session.events || [];
  const evidence = rawEvidence.map(e => {
    const speech = e.kind === "filler" || e.type === "filler";
    const eventSource = demo ? (speech ? "preset-transcript" : source)
      : e.source || (legacy ? "旧记录，具体来源未记录" : speech ? session.asrEngine || "browser-speech" : source);
    return { ...e, source: eventSource, observationVersion: e.observationVersion || observationVersion };
  });
  const missing = [...new Set([
    ...(derived.missing || []),
    !available.posture && "体态画面不足，未统计不代表没有发生。",
    !available.gaze && "头部朝向不可判；不是精确眼动。",
    !available.filler && (imported ? "导入视频未听写声音，口头禅未统计。" : session.speechError || "没有可用听写，口头禅未统计。"),
    legacy && "旧记录未保存观测与建议规则版本；保留原标记，不追溯认定为新版识别结果。",
    ...(session.captureWarnings || []),
  ].filter(Boolean))];
  const observation = { ...derived, source, demo, available, counts, evidence, observationVersion, missing };
  const interpretation = d.interpretation || (legacy ? {
    ruleVersion: "旧版未记录", good: d.good || "旧记录仅供回看，不是表现评分。",
    next: d.next || "请先回看原标记，再自行选择一处复练。",
    basis: "保留旧版建议；没有版本与证据关联，不能当作新版规则结论。", evidence: [],
  } : interpretPractice(observation));
  return {
    observation, interpretation, legacy, demo, imported, source,
    sourceLabel: demo ? "预设演示" : imported ? "本机视频导入（仅本次）" : session.kind === "camera" ? "真实试讲（本机摄像头）" : "来源未记录",
    sourceNote: demo ? "骨架来自动画 rig 投影，非实际视觉识别；字幕、语音与标记均为预设，不代表真实试讲表现。" : "体态为单摄像头规则估计；头部朝向不是精确眼动。标记供自查，不是教学质量、心理或医学测评。",
  };
}

export const PARTICLE_WORDS = ["那么", "然后", "就是", "嗯", "啊", "呃", "哦", "呢", "吧", "嘛"];

export const FOCUS_CUES = ["总结一下", "大家注意", "重点是", "一定要", "记住", "关键"];
export const TRANSITION_PHRASES = ["刚才说到", "我们再看", "接下来"];
export const EXPLAIN_CUES = {
  example: { label: "举例", phrases: ["例如", "比如"] },
  analogy: { label: "类比", phrases: ["好比", "就像"] },
  probe: { label: "追问", phrases: ["那么为什么"] },
};
export const ENCOURAGE_PHRASES = ["大家想一想", "很好", "不错", "谢谢"];
export const CLOSED_Q = ["是不是", "对不对", "吗"];
export const OPEN_Q = ["怎么看", "你觉得", "为什么"];

export const STOPWORDS = new Set([
  "的", "地", "得", "了", "着", "过", "是", "有", "在", "再", "也", "都", "就", "还", "很", "太", "更", "最",
  "会", "能", "要", "把", "被", "让", "给", "和", "与", "及", "或", "而", "但", "为", "对", "从", "到", "向", "用", "以",
  "这", "那", "它", "他", "她", "我", "你", "我们", "你们", "大家", "同学", "同学们", "老师",
  "这个", "那个", "一个", "一些", "这样", "那样", "这里", "那里", "今天", "现在", "下面", "以上", "以及", "等等",
  "可以", "所以", "因为", "如果", "但是", "然后", "那么", "的话", "来说", "进行", "开始",
  "啊", "嗯", "呃", "哦", "呢", "吧", "嘛", "呀", "哈", "哪", "谁",
]);

const PUNCT = /[，。！？、；：,.!?;:\s"'“”‘’（）()【】\[\]—…·]/g;

export function linesOf(sessionOrTranscript) {
  const list = Array.isArray(sessionOrTranscript)
    ? sessionOrTranscript
    : (sessionOrTranscript && sessionOrTranscript.transcript) || [];
  return list
    .map((ln) => ({ t: Number(ln.t) || 0, text: String(ln.text || "").trim() }))
    .filter((ln) => ln.text);
}

export function countHan(text) {
  const m = String(text || "").match(/[\u4e00-\u9fffA-Za-z0-9]/g);
  return m ? m.length : 0;
}

export function findPhrases(text, phrases) {
  const src = String(text || "");
  const hits = [];
  const sorted = [...phrases].sort((a, b) => b.length - a.length);
  let i = 0;
  while (i < src.length) {
    let found = null;
    for (const p of sorted) {
      if (src.startsWith(p, i)) { found = p; break; }
    }
    if (found) {
      hits.push({ phrase: found, index: i });
      i += found.length;
    } else i += 1;
  }
  return hits;
}

export function countParticles(transcript) {
  const lines = linesOf(transcript);
  const counts = Object.fromEntries(PARTICLE_WORDS.map((w) => [w, { word: w, count: 0, times: [] }]));
  for (const ln of lines) {
    for (const hit of findPhrases(ln.text, PARTICLE_WORDS)) {
      counts[hit.phrase].count += 1;
      counts[hit.phrase].times.push(ln.t);
    }
  }
  const list = PARTICLE_WORDS.map((w) => counts[w]).filter((x) => x.count > 0);
  const total = list.reduce((a, x) => a + x.count, 0);
  return { total, words: list };
}

function estDuration(text) {
  // 普通话大约每秒 4–5 个字；只作停顿估计，不是语速评分。
  return Math.max(0.35, countHan(text) / 4.5);
}

export function findPauses(transcript, duration) {
  const lines = linesOf(transcript);
  const gaps = [];
  for (let i = 0; i < lines.length; i++) {
    const start = lines[i].t + estDuration(lines[i].text);
    const end = i + 1 < lines.length ? lines[i + 1].t : (Number(duration) || start);
    const dur = end - start;
    if (dur >= 0.45) gaps.push({ t: start, duration: dur, after: lines[i].t });
  }
  const opening = lines.length ? Math.max(0, lines[0].t) : (Number(duration) || 0);
  const count = gaps.length;
  const mean = count ? gaps.reduce((a, g) => a + g.duration, 0) / count : 0;
  const longest = count ? gaps.reduce((a, g) => (g.duration > a.duration ? g : a), gaps[0]) : null;
  const bins = [
    { label: "0.5–1 秒", min: 0.45, max: 1, count: 0 },
    { label: "1–2 秒", min: 1, max: 2, count: 0 },
    { label: "2–3 秒", min: 2, max: 3, count: 0 },
    { label: "3–5 秒", min: 3, max: 5, count: 0 },
    { label: "5 秒以上", min: 5, max: Infinity, count: 0 },
  ];
  for (const g of gaps) {
    const b = bins.find((x) => g.duration >= x.min && g.duration < x.max);
    if (b) b.count += 1;
  }
  return { count, mean, longest, gaps, bins, openingWait: opening };
}

export function speechRateSeries(transcript, duration, window = 20) {
  const lines = linesOf(transcript);
  const dur = Math.max(Number(duration) || 0, lines.reduce((a, l) => Math.max(a, l.t), 0));
  if (!lines.length || dur <= 0) return { cpm: 0, points: [], variation: 0 };
  const totalChars = lines.reduce((a, l) => a + countHan(l.text), 0);
  const cpm = totalChars / (dur / 60);
  const points = [];
  const step = window;
  for (let t0 = 0; t0 < dur; t0 += step) {
    const t1 = Math.min(dur, t0 + step);
    const chars = lines.filter((l) => l.t >= t0 && l.t < t1).reduce((a, l) => a + countHan(l.text), 0);
    points.push({ t: t0, t1, cpm: chars / Math.max((t1 - t0) / 60, 1 / 60) });
  }
  const vals = points.map((p) => p.cpm);
  const mean = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
  const variation = vals.length > 1
    ? Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length)
    : 0;
  return { cpm, points, variation, totalChars };
}

export function sentenceLengths(transcript) {
  const lines = linesOf(transcript);
  const pieces = [];
  for (const ln of lines) {
    const parts = ln.text.split(/[。！？!?；;]/).map((s) => s.trim()).filter(Boolean);
    const src = parts.length ? parts : [ln.text];
    for (const p of src) pieces.push({ t: ln.t, chars: countHan(p), text: p });
  }
  const bins = [
    { label: "1–8 字", min: 1, max: 9, count: 0 },
    { label: "9–16 字", min: 9, max: 17, count: 0 },
    { label: "17–24 字", min: 17, max: 25, count: 0 },
    { label: "25 字以上", min: 25, max: Infinity, count: 0 },
  ];
  for (const p of pieces) {
    const b = bins.find((x) => p.chars >= x.min && p.chars < x.max);
    if (b) b.count += 1;
  }
  const mean = pieces.length ? pieces.reduce((a, p) => a + p.chars, 0) / pieces.length : 0;
  return { pieces, bins, mean, count: pieces.length };
}

export function findRepeats(transcript) {
  const lines = linesOf(transcript);
  const seen = new Map();
  for (const ln of lines) {
    const run = ln.text.replace(PUNCT, "");
    for (let n = 8; n >= 4; n--) {
      for (let i = 0; i <= run.length - n; i++) {
        const g = run.slice(i, i + n);
        if ([...g].every((ch) => STOPWORDS.has(ch))) continue;
        const cur = seen.get(g) || { text: g, count: 0, times: [] };
        if (!cur.times.length || ln.t - cur.times[cur.times.length - 1] > 0.2) {
          cur.count += 1;
          cur.times.push(ln.t);
        }
        seen.set(g, cur);
      }
    }
  }
  // 去掉已被更长片段覆盖的短重复
  const list = [...seen.values()].filter((x) => x.count >= 2).sort((a, b) => b.text.length - a.text.length || b.count - a.count);
  const kept = [];
  for (const item of list) {
    if (kept.some((k) => k.text.includes(item.text) && k.text !== item.text)) continue;
    kept.push(item);
    if (kept.length >= 8) break;
  }
  return kept;
}

function isQuestionText(text) {
  const s = String(text || "");
  if (/[？?]/.test(s)) return true;
  if (/是不是|对不对|好不好|能不能|会不会/.test(s)) return true;
  if (/为什么|怎么看|你觉得|什么|怎么|哪里|哪一个|谁来|谁能/.test(s)) return true;
  if (/[吗么]$/.test(s.replace(PUNCT, "").slice(-2) + (s.endsWith("吗") || s.endsWith("么") ? "" : "")) || /吗[。！？!?.]?$/.test(s) || /呢[。！？!?.]?$/.test(s)) return true;
  return /吗|怎么|什么|为什么/.test(s);
}

export function classifyQuestion(text) {
  const s = String(text || "");
  const openHit = OPEN_Q.find((p) => s.includes(p));
  if (openHit) return { kind: "open", cue: openHit };
  if (/是不是|对不对/.test(s) || /吗[。！？!?.]?$/.test(s) || (s.includes("吗") && !openHit)) return { kind: "closed", cue: s.includes("是不是") ? "是不是" : s.includes("对不对") ? "对不对" : "吗" };
  if (isQuestionText(s)) return { kind: "other", cue: "" };
  return null;
}

export function findQuestions(transcript, duration) {
  const lines = linesOf(transcript);
  const items = [];
  for (let i = 0; i < lines.length; i++) {
    const cls = classifyQuestion(lines[i].text);
    if (!cls) continue;
    const next = lines[i + 1];
    const start = lines[i].t + estDuration(lines[i].text);
    const wait = next ? Math.max(0, next.t - start) : Math.max(0, (Number(duration) || start) - start);
    items.push({ t: lines[i].t, text: lines[i].text, kind: cls.kind, cue: cls.cue, wait });
  }
  const closed = items.filter((x) => x.kind === "closed");
  const open = items.filter((x) => x.kind === "open");
  const waits = items.map((x) => x.wait).filter((w) => w >= 0);
  const meanWait = waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : 0;
  return { items, count: items.length, closed: closed.length, open: open.length, other: items.length - closed.length - open.length, meanWait };
}

export function extractKeywords(transcript, { minCount = 2, topN = 12 } = {}) {
  const lines = linesOf(transcript);
  const freq = new Map();
  for (const ln of lines) {
    const run = ln.text.replace(PUNCT, "");
    const seenInLine = new Set();
    for (let n = 4; n >= 2; n--) {
      for (let i = 0; i <= run.length - n; i++) {
        const g = run.slice(i, i + n);
        if (STOPWORDS.has(g)) continue;
        if ([...g].every((ch) => STOPWORDS.has(ch))) continue;
        if (seenInLine.has(g)) continue;
        seenInLine.add(g);
        const cur = freq.get(g) || { word: g, count: 0, times: [] };
        cur.count += 1;
        cur.times.push(ln.t);
        freq.set(g, cur);
      }
    }
  }
  const raw = [...freq.values()].filter((x) => x.count >= minCount).sort((a, b) => b.count - a.count || b.word.length - a.word.length);
  const kept = [];
  for (const item of raw) {
    if (kept.some((k) => (k.word.includes(item.word) || item.word.includes(k.word)) && k.word !== item.word && k.count >= item.count)) continue;
    kept.push(item);
    if (kept.length >= topN) break;
  }
  return kept;
}

export function extractKeyPoints(transcript) {
  const lines = linesOf(transcript);
  const points = [];
  for (const ln of lines) {
    const hits = findPhrases(ln.text, FOCUS_CUES);
    if (!hits.length) continue;
    for (const hit of hits) {
      const after = ln.text.slice(hit.index + hit.phrase.length).replace(/^[，,：:\s]+/, "");
      const clause = after.split(/[。！？!?；;]/)[0].trim() || ln.text;
      points.push({ t: ln.t, cue: hit.phrase, text: clause.slice(0, 42), source: ln.text });
    }
  }
  return points;
}

export function findTransitions(transcript) {
  const lines = linesOf(transcript);
  const items = [];
  for (const ln of lines) {
    for (const hit of findPhrases(ln.text, TRANSITION_PHRASES)) {
      items.push({ t: ln.t, phrase: hit.phrase, text: ln.text });
    }
  }
  return items;
}

export function explainStyles(transcript) {
  const lines = linesOf(transcript);
  const groups = {};
  for (const [key, def] of Object.entries(EXPLAIN_CUES)) {
    groups[key] = { key, label: def.label, phrases: def.phrases, items: [] };
  }
  for (const ln of lines) {
    for (const [key, def] of Object.entries(EXPLAIN_CUES)) {
      for (const hit of findPhrases(ln.text, def.phrases)) {
        groups[key].items.push({ t: ln.t, phrase: hit.phrase, text: ln.text });
      }
    }
  }
  return Object.values(groups);
}

export function encouragements(transcript) {
  const lines = linesOf(transcript);
  const items = [];
  for (const ln of lines) {
    for (const hit of findPhrases(ln.text, ENCOURAGE_PHRASES)) {
      items.push({ t: ln.t, phrase: hit.phrase, text: ln.text });
    }
  }
  return items;
}

export function echoHeadTail(transcript, duration) {
  const lines = linesOf(transcript);
  const dur = Math.max(Number(duration) || 0, lines.reduce((a, l) => Math.max(a, l.t), 0));
  if (!lines.length || dur <= 0) return { overlap: [], head: [], tail: [], window: 0 };
  const window = dur * 0.15;
  const headLines = lines.filter((l) => l.t <= window);
  const tailLines = lines.filter((l) => l.t >= dur - window);
  const head = extractKeywords(headLines, { minCount: 1, topN: 16 });
  const tail = extractKeywords(tailLines, { minCount: 1, topN: 16 });
  const raw = [];
  for (const h of head) {
    const tw = tail.find((x) => x.word === h.word || x.word.includes(h.word) || h.word.includes(x.word));
    if (tw) raw.push({ word: h.word.length >= tw.word.length ? h.word : tw.word, count: Math.min(h.count, tw.count), times: h.times.concat(tw.times) });
  }
  const uniq = [];
  for (const o of raw.sort((a, b) => b.word.length - a.word.length)) {
    if (uniq.some((u) => u.word.includes(o.word) || o.word.includes(u.word))) continue;
    uniq.push(o);
  }
  return { overlap: uniq, head, tail, window };
}

function poseOf(frame) {
  return frame && frame.pose ? midHip(frame.pose) : null;
}

function wristPoints(frame) {
  const pts = [];
  if (frame && frame.hands && frame.hands.length) {
    for (const hand of frame.hands) {
      const w = hand && hand[0];
      if (w && (w.v ?? 1) > 0.3) pts.push(w);
    }
  }
  if (frame && frame.pose) {
    for (const idx of [P.L_WRIST, P.R_WRIST]) {
      const p = lm(frame.pose, idx);
      if (p && (p.v ?? p.visibility ?? 1) > 0.3) pts.push(p);
    }
  }
  return pts;
}

export function stanceAndMotion(session) {
  const frames = session?.kind !== "demo" && session?.visionAvailable === false ? [] : (session && session.frames) || [];
  const dur = Number(session && session.duration) || (frames.length ? frames[frames.length - 1].t : 0);
  const points = [];
  let dist = 0;
  let last = null;
  let poseTime = 0, known = 0;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const dt = (frames[i + 1] ? frames[i + 1].t : dur) - f.t;
    const mh = poseOf(f);
    if (mh && (mh.v ?? 1) > 0.25) {
      points.push({ t: f.t, x: mh.x, y: mh.y });
      if (last) dist += Math.hypot(mh.x - last.x, mh.y - last.y);
      last = mh;
      poseTime += Math.max(0, dt);
    }
    known += Math.max(0, dt);
  }
  const cols = 10, rows = 8;
  const grid = Array.from({ length: rows * cols }, () => 0);
  let maxCell = 0;
  for (const p of points) {
    const c = Math.min(cols - 1, Math.max(0, Math.floor(p.x * cols)));
    const r = Math.min(rows - 1, Math.max(0, Math.floor(p.y * rows)));
    const i = r * cols + c;
    grid[i] += 1;
    if (grid[i] > maxCell) maxCell = grid[i];
  }
  return {
    available: points.length >= 8,
    distance: dist,
    samples: points.length,
    poseRatio: known > 0 ? poseTime / known : 0,
    grid, cols, rows, maxCell, points,
  };
}

export function gestureStats(session) {
  const frames = session?.kind !== "demo" && session?.visionAvailable === false ? [] : (session && session.frames) || [];
  const dur = Number(session && session.duration) || (frames.length ? frames[frames.length - 1].t : 0);
  if (!frames.length) return { available: false, count: 0, meanAmp: 0, times: [] };
  let count = 0;
  const times = [];
  const amps = [];
  let moving = false, start = 0, origin = null, maxAmp = 0, lastT = -10;
  let seenHands = 0;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const wr = wristPoints(f);
    if (!wr.length) {
      if (moving && f.t - start > 0.25 && maxAmp > 0.06 && f.t - lastT > 0.7) {
        count += 1; times.push(start); amps.push(maxAmp); lastT = f.t;
      }
      moving = false; origin = null; maxAmp = 0;
      continue;
    }
    seenHands += 1;
    const cx = wr.reduce((a, p) => a + p.x, 0) / wr.length;
    const cy = wr.reduce((a, p) => a + p.y, 0) / wr.length;
    if (!origin) { origin = { x: cx, y: cy }; start = f.t; maxAmp = 0; moving = false; continue; }
    const amp = Math.hypot(cx - origin.x, cy - origin.y);
    if (amp > 0.045) {
      moving = true;
      if (amp > maxAmp) maxAmp = amp;
    } else if (moving && maxAmp > 0.06 && f.t - start > 0.25 && f.t - lastT > 0.7) {
      count += 1; times.push(start); amps.push(maxAmp); lastT = f.t;
      moving = false; origin = { x: cx, y: cy }; start = f.t; maxAmp = 0;
    } else if (!moving) {
      origin = { x: origin.x * 0.8 + cx * 0.2, y: origin.y * 0.8 + cy * 0.2 };
    }
  }
  const meanAmp = amps.length ? amps.reduce((a, b) => a + b, 0) / amps.length : 0;
  return { available: seenHands >= 6, count, meanAmp, times };
}

export function gazeCoverage(session) {
  const frames = session?.kind !== "demo" && session?.visionAvailable === false ? [] : (session && session.frames) || [];
  const dur = Number(session && session.duration) || (frames.length ? frames[frames.length - 1].t : 0);
  let left = 0, mid = 0, right = 0, faceClass = 0, notes = 0, known = 0, back = 0, board = 0;
  let gazeKnown = false;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const dt = Math.max(0, (frames[i + 1] ? frames[i + 1].t : dur) - f.t);
    const g = f.gaze;
    if (g && g.label && g.label !== "unknown") {
      gazeKnown = true;
      known += dt;
      if (g.label === "class") faceClass += dt;
      if (g.label === "notes") notes += dt;
      const yaw = Number(g.yaw);
      if (Number.isFinite(yaw)) {
        if (yaw < -0.18) left += dt;
        else if (yaw > 0.18) right += dt;
        else mid += dt;
      } else mid += dt;
    }
    if (f.flags && f.flags.back) back += dt;
    if (f.onBoard) board += dt;
  }
  return {
    available: gazeKnown && known > 0.5,
    classRatio: known ? faceClass / known : 0,
    notesRatio: known ? notes / known : 0,
    left, mid, right, known,
    leftRatio: known ? left / known : 0,
    midRatio: known ? mid / known : 0,
    rightRatio: known ? right / known : 0,
    backTime: back,
    boardTime: board,
  };
}

export function estimateStructure(session) {
  const lines = linesOf(session);
  const dur = Math.max(Number(session && session.duration) || 0, lines.reduce((a, l) => Math.max(a, l.t), 0));
  if (dur <= 0) return { source: "none", segments: [], duration: 0 };
  if (session && session.observeMarks && session.observeMarks.source === "user" && Array.isArray(session.observeMarks.segments)) {
    return { source: "user", segments: session.observeMarks.segments, duration: dur };
  }
  if (missingSpeech(session)) return { source: "none", segments: [], duration: dur };
  const openEnd = Math.min(dur, Math.max(dur * 0.1, Math.min(60, dur * 0.18)));
  const closeStart = Math.max(openEnd, dur * 0.82);
  let open = openEnd, close = closeStart;
  for (const ln of lines) {
    if (/同学[们好]|大家好|今天我们|导入|上课了/.test(ln.text) && ln.t < dur * 0.3) open = Math.max(open, ln.t + estDuration(ln.text));
    if (/小结|总结|最后|这节课|作业|下节课|回顾/.test(ln.text) && ln.t > dur * 0.5) close = Math.min(close, ln.t);
  }
  const qs = findQuestions(lines, dur).items;
  // 互动：提问较密的中段；讲授为中间其余部分
  const segs = [
    { key: "open", label: "导入", start: 0, end: Math.max(0.1, Math.min(open, close)), kind: "讲授" },
    { key: "teach", label: "新授", start: Math.max(0.1, Math.min(open, close)), end: close, kind: "讲授" },
    { key: "close", label: "小结", start: close, end: dur, kind: "小结" },
  ];
  // 若中段有提问，把提问前后短窗标为互动（展示用，不替代三段骨架）
  const interacts = qs.map((q) => ({ key: "ask", label: "互动", start: q.t, end: Math.min(dur, q.t + Math.max(3, q.wait + 2)), kind: "提问" }));
  return { source: "estimate", segments: segs, interacts, duration: dur };
}

export function lessonRhythm(session) {
  const lines = linesOf(session);
  const dur = Math.max(Number(session && session.duration) || 0, lines.reduce((a, l) => Math.max(a, l.t), 0));
  const motion = stanceAndMotion(session);
  const ges = gestureStats(session);
  const pauses = findPauses(lines, dur);
  const speechAvailable = !missingSpeech(session);
  const poseAvailable = !missingPose(session);
  const minutes = [];
  const n = Math.max(1, Math.ceil(dur / 60));
  for (let m = 0; m < n; m++) {
    const t0 = m * 60, t1 = Math.min(dur, (m + 1) * 60);
    const chars = lines.filter((l) => l.t >= t0 && l.t < t1).reduce((a, l) => a + countHan(l.text), 0);
    const pause = pauses.gaps.filter((g) => g.t >= t0 && g.t < t1).reduce((a, g) => a + g.duration, 0);
    const pts = motion.points.filter((p) => p.t >= t0 && p.t < t1);
    let move = 0;
    for (let i = 1; i < pts.length; i++) move += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const gestures = ges.times.filter((t) => t >= t0 && t < t1).length;
    const speechOK = speechAvailable && lines.some(l => l.t >= t0 && l.t < t1);
    const motionOK = poseAvailable && motion.available && pts.length >= 2;
    const handsOK = poseAvailable && ges.available && (session.frames || []).some(f => f.t >= t0 && f.t < t1 && wristPoints(f).length);
    minutes.push({ minute: m + 1, t0, t1, cpm: speechOK ? chars / Math.max((t1 - t0) / 60, 1 / 60) : null, pause: speechOK ? pause : null, move: motionOK ? move : null, gestures: handsOK ? gestures : null });
  }
  const structure = estimateStructure(session);
  return { minutes, structure, duration: dur };
}

export function boardAlignment(session) {
  const lines = linesOf(session);
  const frames = session?.kind !== "demo" && session?.visionAvailable === false ? [] : (session && session.frames) || [];
  const visualOK = session?.kind === "demo" || session?.visionAvailable !== false;
  const events = visualOK ? (session && session.events) || [] : [];
  const starts = [];
  let on = false, start = 0;
  const dur = Number(session && session.duration) || 0;
  if (frames.length) {
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      if (f.onBoard && !on) { on = true; start = f.t; }
      if (!f.onBoard && on) { starts.push({ t: start, end: f.t }); on = false; }
    }
    if (on) starts.push({ t: start, end: dur || frames[frames.length - 1].t });
  }
  for (const e of events) {
    if (e.type === "board" || e.kind === "board") starts.push({ t: e.t, end: e.t + 4 });
  }
  const spans = [];
  const seen = [];
  for (const s of starts.sort((a, b) => a.t - b.t)) {
    if (seen.some((x) => Math.abs(x - s.t) < 2)) continue;
    seen.push(s.t);
    const nearby = lines.filter((l) => l.t >= s.t - 4 && l.t <= (s.end || s.t) + 8);
    const kws = extractKeywords(nearby, { minCount: 1, topN: 6 });
    spans.push({ t: s.t, end: s.end || s.t, keywords: kws, quotes: nearby.slice(0, 3) });
  }
  const why = !visualOK || missingPose(session) ? "没有足够的体态画面，写板时段未统计。" : missingSpeech(session);
  return { available: !why && starts.length > 0, spans, why };
}

export function findHighlights(session) {
  const lines = missingSpeech(session) ? [] : linesOf(session);
  const dur = Number(session && session.duration) || 0;
  const cues = extractKeyPoints(lines);
  const qs = findQuestions(lines, dur).items;
  const pauses = findPauses(lines, dur).gaps.filter((g) => g.duration >= 0.8);
  const ges = gestureStats(session);
  const marks = [];
  const add = (t, kind) => { marks.push({ t, kind }); };
  for (const c of cues) add(c.t, "cue");
  for (const q of qs) add(q.t, "question");
  for (const p of pauses) add(p.t, "pause");
  for (const t of ges.times || []) add(t, "gesture");
  const windows = [];
  const used = new Set();
  const sorted = marks.sort((a, b) => a.t - b.t);
  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue;
    const group = [sorted[i]];
    used.add(i);
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[j].t - sorted[i].t <= 5) { group.push(sorted[j]); used.add(j); }
    }
    const kinds = [...new Set(group.map((g) => g.kind))];
    if (kinds.length >= 2) {
      const nearby = lines.find((l) => Math.abs(l.t - group[0].t) <= 5);
      windows.push({ t: group[0].t, kinds, text: nearby ? nearby.text : "", score: kinds.length });
    }
  }
  windows.sort((a, b) => b.score - a.score || a.t - b.t);
  return windows.slice(0, 8);
}

function missingSpeech(session) {
  const lines = linesOf(session);
  if (session?.kind !== "demo" && (session?.speechAvailable === false || session?.speechHeard === false)) {
    return session?.localImport || session?.stats?.source === "local-video" ? "导入视频未听写声音，无法从原话里定位。" : session?.speechError || "这一次没有可用的听写，无法从原话里定位。";
  }
  if (lines.length) return "";
  return "没有转写，无法从原话里定位。";
}

function missingPose(session) {
  const frames = session?.kind !== "demo" && session?.visionAvailable === false ? [] : (session && session.frames) || [];
  const withPose = frames.filter((f) => f.pose).length;
  if (withPose >= 8 && withPose / frames.length >= 0.3) return "";
  if (session && session.kind === "demo" && !frames.length) return "演示回放没有留下姿态轨迹，站位和移动无法计算。";
  if (session && session.kind === "camera" && session.visionAvailable === false) return "这一次没有体态分析，站位和移动无法计算。";
  return frames.length ? "识别到人的画面太少，站位和移动不够完整。" : "没有姿态记录，站位和移动无法计算。";
}

/**
 * 根据一次试讲生成观察记录（细项 + 整节课）。不作评分。
 */
export function buildObserveReport(session) {
  const context = buildReviewContext(session);
  const lines = linesOf(session);
  const dur = Math.max(Number(session && session.duration) || 0, lines.reduce((a, l) => Math.max(a, l.t), 0));
  const speechWhy = missingSpeech(session);
  const poseWhy = missingPose(session);
  const particles = speechWhy ? null : countParticles(lines);
  const pauses = speechWhy ? null : findPauses(lines, dur);
  const rate = speechWhy ? null : speechRateSeries(lines, dur);
  const lengths = speechWhy ? null : sentenceLengths(lines);
  const repeats = speechWhy ? null : findRepeats(lines);
  const questions = speechWhy ? null : findQuestions(lines, dur);
  const motion = poseWhy ? null : stanceAndMotion(session);
  const gestures = poseWhy ? null : gestureStats(session);
  const gaze = gazeCoverage(session);
  const structure = estimateStructure(session);

  const keyPoints = speechWhy ? null : extractKeyPoints(lines);
  const keywords = speechWhy ? null : extractKeywords(lines);
  const rhythm = lessonRhythm(session);
  const highlights = findHighlights(session);
  const transitions = speechWhy ? null : findTransitions(lines);
  const echo = speechWhy ? null : echoHeadTail(lines, dur);
  const board = boardAlignment(session);
  const styles = speechWhy ? null : explainStyles(lines);
  const cheers = speechWhy ? null : encouragements(lines);

  return {
    ...context,
    detailRuleVersion: OBSERVE_RULE_VERSION,
    missing: [...new Set([...context.observation.missing, speechWhy, poseWhy, !gaze.available && "头部朝向记录不足，未统计覆盖。"].filter(Boolean))],
    duration: dur,
    hasSpeech: !speechWhy,
    speechWhy,
    hasPose: !poseWhy,
    poseWhy,
    particles,
    pauses,
    openingWait: pauses ? pauses.openingWait : null,
    rate,
    lengths,
    repeats,
    questions,
    motion,
    gestures,
    gaze: gaze.available ? { ...gaze, backTime: poseWhy ? null : gaze.backTime, boardTime: poseWhy ? null : gaze.boardTime } : { available: false, why: "没有足够的头部朝向记录，面向和左右覆盖无法计算。" },
    structure,
    lesson: {
      label: "依据你的原话定位",
      keyPoints,
      keywords,
      rhythm,
      highlights: speechWhy && !(session && session.frames && session.frames.length) ? [] : highlights,
      questions,
      transitions,
      echo,
      board,
      styles,
      cheers,
    },
  };
}

/** 给测试用的一份短试讲转写（虚构课堂，不是某一课的原文）。 */
export function sampleLessonTranscript() {
  return [
    { t: 0.8, text: "同学们好，今天我们来讲一下勾股定理。" },
    { t: 8.0, text: "这个定理很关键，大家注意，直角三角形两条直角边的平方和等于斜边的平方。" },
    { t: 18.5, text: "重点是，斜边一定要看清楚。" },
    { t: 24.0, text: "比如一个三角形，直角边是三和四，斜边就是五。" },
    { t: 32.0, text: "就像我们熟悉的直角那样。" },
    { t: 38.0, text: "那么为什么是平方和呢？大家想一想。" },
    { t: 46.0, text: "是不是这样？" },
    { t: 52.5, text: "很好，刚才说到斜边，我们再看另一个例子。" },
    { t: 61.0, text: "接下来请同学说一说，你觉得生活中哪里能用到勾股定理？" },
    { t: 72.0, text: "怎么看这个图形？" },
    { t: 78.0, text: "为什么直角这么重要？" },
    { t: 86.0, text: "不错，谢谢。" },
    { t: 92.0, text: "总结一下，记住：直角边的平方和等于斜边的平方。一定要把斜边找对。" },
    { t: 104.0, text: "这节课我们就把勾股定理讲到这里，斜边还是那一句。" },
  ];
}
