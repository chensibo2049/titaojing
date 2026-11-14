import { loadBank, createSim } from "./classroom-sim.js";

const PALETTES = {
  s1: { skin: "#f3d7b8", hair: "#3a2a1c", shirt: "#5d6d57", ink: "#2c241c" },
  s2: { skin: "#e8c4a0", hair: "#1c1713", shirt: "#7a4a3b", ink: "#2c241c" },
  s3: { skin: "#f0d0ae", hair: "#6a4a2a", shirt: "#3d5a66", ink: "#2c241c" },
  s4: { skin: "#e9cbb0", hair: "#2b2118", shirt: "#8a6a3c", ink: "#2c241c" },
  s5: { skin: "#f5ddc4", hair: "#4a3020", shirt: "#5a4e6a", ink: "#2c241c" },
  g1: { skin: "#e8c9a8", hair: "#2a2218", shirt: "#3c3a36", ink: "#2c241c" },
  g2: { skin: "#f1d4b4", hair: "#5c4030", shirt: "#4a5c4e", ink: "#2c241c" },
  g3: { skin: "#ebc8a4", hair: "#1a1510", shirt: "#6b3e3a", ink: "#2c241c" },
};

function pal(id, i) {
  if (PALETTES[id]) return PALETTES[id];
  const keys = Object.keys(PALETTES);
  return PALETTES[keys[i % keys.length]];
}

function avatarSvg(p, i) {
  const c = pal(p.id, i);
  const hand = p.state === "hand";
  const speak = p.state === "speaking" || p.state === "asking";
  const reading = p.state === "reading";
  const standRead = p.state === "stand_read";
  const conf = p.state === "confused";
  const dist = p.state === "distracted";
  const tilt = conf ? -8 : dist ? 10 : reading ? 4 : 0;
  const mouth = (speak || reading || standRead) ? `M 42 58 Q 50 64 58 58` : `M 43 58 Q 50 61 57 58`;
  const eyeL = dist ? `<circle cx="42" cy="46" r="1.6" fill="${c.ink}"/>` : `<ellipse cx="42" cy="46" rx="1.8" ry="2.1" fill="${c.ink}"/>`;
  const eyeR = dist ? `<circle cx="58" cy="46" r="1.6" fill="${c.ink}"/>` : `<ellipse cx="58" cy="46" rx="1.8" ry="2.1" fill="${c.ink}"/>`;
  const brow = conf
    ? `<path d="M38 40 Q42 37 46 40" fill="none" stroke="${c.ink}" stroke-width="1.4" stroke-linecap="round"/>
       <path d="M54 39 Q58 36 62 40" fill="none" stroke="${c.ink}" stroke-width="1.4" stroke-linecap="round"/>`
    : `<path d="M38 40 H46" fill="none" stroke="${c.ink}" stroke-width="1.2" stroke-linecap="round"/>
       <path d="M54 40 H62" fill="none" stroke="${c.ink}" stroke-width="1.2" stroke-linecap="round"/>`;
  // 简单平涂：头、发、衣领，课堂工具插图味道，不用渐变。
  const hair = p.role === "评委" || p.role === "嘉宾"
    ? `<path d="M28 42 C28 22 42 16 50 16 C58 16 72 22 72 42 L70 36 C64 22 36 22 30 36 Z" fill="${c.hair}"/>`
    : i % 2 === 0
      ? `<path d="M27 44 C27 20 40 14 50 14 C62 14 73 22 73 44 L71 32 C64 18 36 18 29 32 Z" fill="${c.hair}"/>`
      : `<path d="M26 46 C28 20 40 13 50 13 C61 13 73 20 74 46 V38 C68 18 32 18 26 38 Z" fill="${c.hair}"/>`;
  const armUp = hand
    ? `<g>
        <path d="M26 86 C20 70 22 52 28 40" fill="none" stroke="${c.shirt}" stroke-width="7" stroke-linecap="round"/>
        <circle cx="29" cy="36" r="5" fill="${c.skin}" stroke="${c.ink}" stroke-width="1"/>
      </g>`
    : (reading || standRead)
      ? `<g>
          <path d="M34 90 C38 86 42 82 46 78" fill="none" stroke="${c.shirt}" stroke-width="6" stroke-linecap="round"/>
          <rect x="44" y="70" width="12" height="16" rx="1" fill="#f4efe4" stroke="${c.ink}" stroke-width="1"/>
        </g>`
      : `<path d="M28 90 C22 96 20 108 24 118" fill="none" stroke="${c.shirt}" stroke-width="7" stroke-linecap="round"/>`;
  const mark = conf
    ? `<text x="76" y="28" font-size="14" font-family="Noto Serif CJK SC, Songti SC, serif" fill="${c.ink}">？</text>`
    : dist
      ? `<text x="74" y="26" font-size="11" font-family="Noto Sans CJK SC, sans-serif" fill="#8a7a68">…</text>`
      : "";
  const lift = standRead ? -14 : 0;
  return `<svg class="sim-avatar-svg" viewBox="0 0 100 128" width="72" height="92" aria-hidden="true">
    <g transform="translate(0 ${lift}) rotate(${tilt} 50 70)">
      <ellipse cx="50" cy="118" rx="28" ry="6" fill="#e6d8c4" opacity="0.7"/>
      ${armUp}
      <path d="M24 86 C24 118 76 118 76 86 L70 78 C64 92 36 92 30 78 Z" fill="${c.shirt}" stroke="${c.ink}" stroke-width="1.2"/>
      <circle cx="50" cy="48" r="22" fill="${c.skin}" stroke="${c.ink}" stroke-width="1.3"/>
      ${hair}
      ${brow}
      ${eyeL}${eyeR}
      <path d="${mouth}" fill="none" stroke="${c.ink}" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M71 90 C78 96 80 110 74 120" fill="none" stroke="${c.shirt}" stroke-width="7" stroke-linecap="round"/>
      ${mark}
    </g>
  </svg>`;
}

export function seatsHtml(people, mode = "class") {
  return (people || []).map((p, i) => {
    const cls = `sim-seat is-${p.state}${p.bubble ? " has-bubble" : ""}`;
    const bubble = p.bubble ? `<div class="sim-bubble"><p>${esc(p.bubble)}</p></div>` : "";
    return `<div class="${cls}" aria-label="${esc(p.name)}，${stateLabel(p)}">
      ${avatarSvg(p, i)}
      <span class="sim-name">${esc(p.name)}</span>
      <span class="sim-meta">${esc(p.seat || p.role || "")} · ${stateLabel(p)}</span>
      ${bubble}
    </div>`;
  }).join("");
}

function stateLabel(p) {
  return ({
    idle: "在听",
    hand: "举手",
    speaking: "在回答",
    asking: "在提问",
    reading: "齐读",
    stand_read: "在朗读",
    listening: "在听读",
    confused: "有些困惑",
    distracted: "稍稍走神",
  })[p.state] || "在听";
}

export function maybeSpeak(text, lang = "zh-CN") {
  if (!text || typeof speechSynthesis === "undefined") return false;
  const voices = speechSynthesis.getVoices() || [];
  const zh = voices.find((v) => /zh|cmn|Chinese|中文/i.test((v.lang || "") + " " + (v.name || "")));
  if (!zh) return false;
  try { speechSynthesis.cancel(); } catch (_) {}
  const u = new SpeechSynthesisUtterance(text);
  u.lang = zh.lang || lang;
  u.voice = zh;
  u.rate = 0.95;
  speechSynthesis.speak(u);
  return true;
}

export function findZhVoice() {
  if (typeof speechSynthesis === "undefined") return null;
  const voices = speechSynthesis.getVoices() || [];
  return voices.find((v) => /zh|cmn|Chinese|中文/i.test((v.lang || "") + " " + (v.name || ""))) || null;
}

let sim = null;
let host = null;
let lastSpeak = "";
let onPick = null;
let nowSec = () => 0;

export function isSimActive() {
  return !!sim;
}

export function getSim() {
  return sim;
}

export async function startClassroomSim(mode, hooks = {}) {
  stopClassroomSim();
  const bank = await loadBank();
  sim = createSim(mode, bank, hooks);
  onPick = hooks.onPick || null;
  nowSec = hooks.now || (() => 0);
  host = document.getElementById("classroom-sim");
  if (host) {
    host.hidden = false;
    host.setAttribute("data-mode", sim.mode);
  }
  renderClassroomSim(0);
  return sim;
}

export function stopClassroomSim() {
  if (typeof speechSynthesis !== "undefined") {
    try { speechSynthesis.cancel(); } catch (_) {}
  }
  sim = null;
  lastSpeak = "";
  if (host) {
    host.hidden = true;
    host.innerHTML = "";
  }
}

export function feedClassroomSim(text, t, isFinal = true) {
  if (!sim) return null;
  const r = sim.feedTranscript(text, t, isFinal);
  if (r && (r.action === "call" || r.action === "ask")) maybeSpeakFrom(r);
  renderClassroomSim(t);
  return r;
}

export function tickClassroomSim(t, extras) {
  if (!sim) return [];
  const ev = sim.tick(t, extras) || [];
  for (const e of ev) {
    if (e && (e.action === "call" || e.action === "ask")) maybeSpeakFrom(e);
  }
  renderClassroomSim(t);
  return ev;
}

function maybeSpeakFrom(r) {
  const text = (r.answer && r.answer.text) || (r.pending && r.pending.question && r.pending.question.text) || "";
  if (text && text !== lastSpeak) {
    lastSpeak = text;
    maybeSpeak(text);
  }
}

export function renderClassroomSim(t = 0) {
  if (!sim || !host) return;
  const snap = sim.snapshot(t);
  const voice = findZhVoice();
  const timer = snap.timer;
  const cards = snap.people.map((p, i) => {
    const cls = `sim-seat is-${p.state}${p.bubble ? " has-bubble" : ""}`;
    const bubble = p.bubble
      ? `<div class="sim-bubble"><p>${esc(p.bubble)}</p></div>`
      : "";
    const click = snap.mode === "class" && p.state === "hand" ? ` data-pick="${esc(p.id)}"` : "";
    return `<button type="button" class="${cls}"${click} aria-label="${esc(p.name)}，${stateLabel(p)}">
      ${avatarSvg(p, i)}
      <span class="sim-name">${esc(p.name)}</span>
      <span class="sim-meta">${esc(p.seat || p.role || "")} · ${stateLabel(p)}</span>
      ${bubble}
    </button>`;
  }).join("");

  const timerHtml = timer
    ? `<div class="sim-timer" data-left="${timer.remain <= 5 ? "low" : "ok"}">
        <span>请在 ${Math.ceil(timer.remain)} 秒内回应</span>
        <i class="sim-timer-bar" style="width:${Math.max(0, 100 * timer.remain / timer.limit)}%"></i>
      </div>`
    : "";

  host.innerHTML = `
    <div class="sim-head">
      <p class="sim-kicker">练习用模拟</p>
      <h2>${esc(snap.label)}</h2>
      <p class="sim-note">这些是本机规则生成的虚拟${snap.mode === "roadshow" ? "嘉宾" : "同学"}，用来练点名、追问和应对提问，不是真实课堂。</p>
    </div>
    <div class="sim-row">${cards}</div>
    ${timerHtml}
    <p class="sim-hint">${hint(snap, voice)}</p>
  `;

  host.querySelectorAll("[data-pick]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!sim) return;
      const id = btn.getAttribute("data-pick");
      const r = sim.pick(id, nowSec());
      if (r) {
        maybeSpeakFrom({ answer: r.answer });
        if (onPick) onPick(r);
      }
      renderClassroomSim(nowSec());
    });
  });
}

function hint(snap, voice) {
  if (snap.mode === "roadshow") {
    if (snap.pending) return "嘉宾已提问。您开口后会记下这次回应用了多久。";
    return "讲完一段，或说「大家有什么问题」，会有嘉宾提问。" + (voice ? " 本机有中文语音，提问可读出来。" : " 本机没有中文语音，提问只显示文字。");
  }
  const hands = snap.people.filter((p) => p.state === "hand").length;
  if (hands) return "同学已举手。点一位，或者说「请你」，也可伸手指向左或右侧。";
  return "说「谁来回答」「有没有同学」「大家说说」，同学会举手。" + (voice ? " 本机有中文语音，回答可读出来。" : " 本机没有中文语音，回答只显示文字。");
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function summarizeClassroomSim() {
  return sim ? sim.summarize() : null;
}
