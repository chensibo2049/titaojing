import { EVENT_META, STAGE_W, STAGE_H, setRuntime } from "./constants.js";
import { renderScene, coverPose, landmarksFromRig, faceFromRig, applyShot, buildRig } from "./teacher.js";
import { captionAt, fillersUntil, DEMO_DURATION, bakeDemoSession, sampleDemo } from "./demo.js";
import { createSession, tickFrame, addFiller, addTranscript, extractGaze, extractPosture, diagnose, frameAt, maybeCaptureBoardStill } from "./analyze.js";
import { drawLiveOverlays, drawCoachSilhouette, resizeCanvasTo } from "./overlays.js";
import { initVision, detectVideo, visionStatus, onVisionProgress, resetVision, switchDelegate } from "./vision.js";
import { speechSupported, preflightSpeech } from "./speech.js";
import { startAsr, highlightFillerHtml, asrStatus, describeAsrEngine } from "./asr.js";
import { inspectSherpa, preflightSherpa, prewarmSherpa, dropWarmSherpa } from "./asr-sherpa.js";
import { mountLocalAsr, localDownloadRunning, maybeAutoDownload, autoDownloadBlockedReason } from "./asr-ui.js";
import { exportSummary } from "./export.js";
import { getSettings, saveSettings, timing, SESSION_MODES, FRAME_MODES } from "./settings.js";
import { getLicense } from "./license.js";
import { preflight, openCamera, listCameras, stopStream as stopTracks, streamFacing, keepAwake, errorCopy, envInfo } from "./camera.js";
import { putSession, putVideo, listSessions, getSession, getVideo, deleteSession, requestPersist } from "./store.js";
import { toRecord, fromRecord, metricsOf, fmtDate, fmtShortDate, fmtDur } from "./records.js";
import { currentProfileName } from "./profile.js";
import { hasUnseenNotes, currentNotes, notesHtml, markVersionSeen } from "./changelog.js";
import { buildFillerReport } from "./fillers.js";
import { installErrorCapture, logEvent, setLastSessionStats } from "./diagnostics.js";
import { initPwa, pwaState, onPwaChange, promptInstall } from "./pwa.js";
import { buildPrintReport, printReport } from "./report.js";
import { $, esc, toast, modal, fitStage, copyText } from "./ui.js";
import { renderHistory, renderCompare, renderSettings, renderFeedback, renderAbout, renderProfile, trendPoints, wirePages } from "./pages.js";
import { VERSION_LABEL, APP_VERSION } from "./version.js";
import { initDebug, debugEnabled, debugFrame, debugSpeech, debugSessionStart, debugSessionEnd } from "./debug.js";
import { renderObserveSheet } from "./observe-ui.js";
import { recentCharsPerMin } from "./classroom-sim.js";
import { startClassroomSim, stopClassroomSim, feedClassroomSim, tickClassroomSim, isSimActive, summarizeClassroomSim } from "./classroom-sim-ui.js";
import { hasAcceptedTerms, acceptTerms, experienceOn } from "./consent.js";
import { maybeEnqueue } from "./experience.js";

installErrorCapture();

const SCREEN_IDS = ["cover", "permission", "error", "coach", "live", "replay", "history", "compare", "settings", "feedback", "about", "profile"];
const screens = Object.fromEntries(SCREEN_IDS.map((k) => [k, $(`screen-${k}`)]));
const PAGES = ["history", "compare", "settings", "feedback", "about", "profile"];


let presenter3d = null;
let presenter3dHost = "";

function characterSceneHref() {
  return new URL("assets/character-scene.js", document.baseURI).href;
}

function disposePresenter3d() {
  if (presenter3d && presenter3d.dispose) {
    try { presenter3d.dispose(); } catch (_) {}
  }
  presenter3d = null;
  presenter3dHost = "";
  const a = $("cover-3d"); if (a) { a.hidden = true; a.innerHTML = ""; }
  const b = $("live-3d"); if (b) { b.hidden = true; b.innerHTML = ""; }
  const canvas = $("cover-canvas");
  if (canvas) canvas.classList.remove("is-3d-overlay");
}

async function ensurePresenter3d(hostId, clip) {
  const s = getSettings();
  if (s.sim3d === "off" || s.perfMode === "smooth") return null;
  if (presenter3d && presenter3dHost === hostId) {
    if (clip && presenter3d.setClip) presenter3d.setClip(clip);
    return presenter3d;
  }
  disposePresenter3d();
  const host = $(hostId);
  if (!host) return null;
  try {
    const { canUse3D, mountPresenterScene } = await import(characterSceneHref());
    if (!canUse3D({ force: s.sim3d })) return null;
    host.hidden = false;
    presenter3d = await mountPresenterScene(host, { clip: clip || "talk" });
    presenter3dHost = hostId;
    return presenter3d;
  } catch (err) {
    console.warn("presenter 3d unavailable", err);
    disposePresenter3d();
    return null;
  }
}


let mode = "cover"; // cover | demo | coach | camera | replay | page
let session = null;
let raf = 0;
let liveStart = 0;
let mediaStream = null;
let micOn = false;
let recorder = null;
let chunks = [];
let speechHandle = null;
let demoBaked = null;
let fillerSeen = new Set();
let playing = false;
let replayRaf = 0;
let replayCursor = 0;
let paused = false;
let pausedAt = 0;
let pauseCount = 0;
let streamEnded = false;
let camLabel = "";
let liveTiming = timing();
let saveVideoThisTime = false;

function showScreen(name) {
  for (const [k, el] of Object.entries(screens)) if (el) el.hidden = k !== name;
  const light = ["cover", "permission", "error", ...PAGES].includes(name);
  document.documentElement.style.background = light ? "#f3eee4" : "#0e0c0a";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = light ? "#f3eee4" : "#0e0c0a";
}

function navigate(hash) {
  if (location.hash === hash || (hash === "#/" && !location.hash)) route();
  else location.hash = hash;
}

function setHashSilently(hash) {
  try { history.replaceState(null, "", hash); } catch (_) {}
}

/* ——— lifecycle ——— */

function stopEverything({ keepPreview = false } = {}) {
  cancelAnimationFrame(raf);
  cancelAnimationFrame(replayRaf);
  cancelAnimationFrame(coverRaf);
  raf = 0;
  replayRaf = 0;
  playing = false;
  paused = false;
  $("pause-veil").hidden = true;
  if (speechHandle) { speechHandle.stop(); speechHandle = null; }
  stopClassroomSim();
  disposePresenter3d();
  const wrap = $("live-wrap");
  if (wrap) wrap.classList.remove("has-sim");
  if (recorder && recorder.state !== "inactive") { try { recorder.stop(); } catch (_) {} }
  recorder = null;
  keepAwake(false);
  if (!keepPreview) releaseStream();
  const rv = $("replay-video");
  if (rv) { rv.pause(); rv.removeAttribute("src"); rv.load(); }
}

function releaseStream() {
  dropWarmSherpa();
  stopTracks(mediaStream);
  mediaStream = null;
  for (const id of ["coach-video", "live-video"]) { const v = $(id); if (v) v.srcObject = null; }
}

function goCover() {
  stopEverything();
  mode = "cover";
  showScreen("cover");
  renderCover();
  startCoverLoop();
}

/* ——— Router ——— */

function route() {
  const h = location.hash.replace(/^#\/?/, "");
  const [page, arg] = h.split("/");
  if (PAGES.includes(page)) {
    stopEverything();
    mode = "page";
    showScreen(page);
    const ctx = { openStored: (id) => navigate(`#/session/${id}`), refreshCover: renderCover };
    if (page === "history") renderHistory(ctx);
    if (page === "compare") renderCompare(ctx, arg);
    if (page === "settings") renderSettings(ctx);
    if (page === "feedback") renderFeedback(ctx);
    if (page === "about") renderAbout(ctx);
    if (page === "profile") renderProfile(ctx);
    screens[page].scrollTop = 0;
    return;
  }
  if (page === "session" && arg) {
    if (session && session.id === arg && mode === "replay") return;
    stopEverything();
    openStored(arg);
    return;
  }
  if (page === "demo") { startDemo(); return; }
  if (page === "try") {
    if (mode === "coach" || mode === "camera") return;
    stopEverything();
    openPermission();
    return;
  }
  if (page === "replay" && session && mode === "replay") return;
  goCover();
}

/* ——— Cover ——— */

let coverRaf = 0;
let runtimeShot = "";
function startCoverLoop() {
  runtimeShot = "";
  cancelAnimationFrame(coverRaf);
  const canvas = $("cover-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  setRuntime({});
  ensurePresenter3d("cover-3d", "talk").then((p3) => {
    if (p3 && canvas) canvas.classList.add("is-3d-overlay");
  });
  const tick = (ts) => {
    if (mode !== "cover") return;
    const cycle = (ts / 1000) % 16;
    const shot = cycle < 8 ? "half" : "full";
    if (runtimeShot !== shot) { runtimeShot = shot; setRuntime({ frameMode: shot, frameResolved: shot }); }
    const t = cycle % 8;
    const p = { ...coverPose(), shot, rArm: 1.6 + Math.sin(t * 0.8) * 0.4, headYaw: -0.05 + Math.sin(t * 0.5) * 0.04, speak: 0.15 + Math.abs(Math.sin(t * 2.4)) * 0.2, chalk: 0.55, bodyYaw: shot === "full" && t > 4 ? 0.7 : 0 };
    if (presenter3d && presenter3dHost === "cover-3d") {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const rig = buildRig(p);
      const pose = landmarksFromRig(rig, canvas.width, canvas.height);
      const gaze = extractGaze(pose, faceFromRig(rig), null);
      drawLiveOverlays(ctx, { pose, gaze, flags: {}, onBoard: false }, canvas.width, canvas.height, { showMap: true, clear: false });
      if (presenter3d.setClip) presenter3d.setClip(shot === "full" && t > 4 ? "board" : "talk");
    } else {
    const rig = renderScene(ctx, canvas.width, canvas.height, p, ts / 1000);
    const pose = landmarksFromRig(rig);
    const gaze = extractGaze(pose, faceFromRig(rig), null);
    drawLiveOverlays(ctx, { pose, gaze, flags: {}, onBoard: false }, canvas.width, canvas.height, { showMap: true, clear: false });
    }
    const label = $("cover-shot-label");
    if (label) label.textContent = shot === "full" ? "全身 · 教室侧前方" : "半身 · 讲台近景";
    coverRaf = requestAnimationFrame(tick);
  };
  coverRaf = requestAnimationFrame(tick);
}

function renderWhatsNew() {
  const box = $("whats-new");
  const body = $("whats-new-body");
  if (!box || !body) return;
  if (!hasUnseenNotes()) { box.hidden = true; return; }
  const notes = currentNotes();
  if (!notes) { box.hidden = true; return; }
  body.innerHTML = notesHtml(notes, { heading: "本版更新" });
  box.hidden = false;
}

async function renderCover() {
  const lic = getLicense();
  $("cover-version").textContent = `${VERSION_LABEL} · ${lic.label}`;
  renderWhatsNew();
  const s = getSettings();
  const modeLab = s.sessionMode === "classroom" ? "课堂" : "练习";
  $("cover-note").textContent = `演示约一分钟，不必等候模型加载。当前是${modeLab}模式，建议时长 ${s.targetMin} 分钟。半身请站到腰部以上入画；全身请再退远一些，让脚也进入画面。`;
  const st = pwaState();
  $("btn-install").hidden = !st.canPrompt;
  try {
    const list = await listSessions();
    const last = list.find((x) => x.kind === "camera");
    const host = $("cover-recent");
    if (last) {
      const m = last.metrics || {};
      host.innerHTML = `<span>上次试讲 ${esc(fmtShortDate(last.startedAt))} · ${fmtDur(m.duration)} · 口头禅 ${m.filler} · 视线落下 ${m.gaze}</span> <a href="#/session/${esc(last.id)}">看回放</a> <a href="#/compare">看进步</a>`;
      host.hidden = false;
    } else host.hidden = true;
  } catch (_) {}
}

/* ——— Demo path ——— */

function startDemo() {
  stopEverything();
  cancelAnimationFrame(coverRaf);
  mode = "demo";
  setRuntime({ frameMode: "half", frameResolved: "half" });
  if (!demoBaked) demoBaked = bakeDemoSession();
  session = { ...demoBaked, id: null, stored: false, startedAt: Date.now(), aspect: STAGE_W / STAGE_H };
  debugSessionStart({ kind: "demo" });
  fillerSeen = new Set();
  showScreen("live");
  fitStage($("live-stage"), STAGE_W / STAGE_H);
  $("btn-skip-demo").hidden = false;
  const liveHint = $("live-kbd-hint");
  if (liveHint) liveHint.hidden = true;
  $("live-video").hidden = true;
  $("live-scene").hidden = false;
  ensurePresenter3d("live-3d", "talk").then((p3) => {
    if (mode !== "demo") return;
    if (p3) {
      $("live-scene").hidden = true;
      if (presenter3d.setClip) presenter3d.setClip("talk");
    }
  });
  $("hud-caption").hidden = false;
  $("speech-banner").hidden = true;
  if ($("live-asr-state")) $("live-asr-state").hidden = true;
  $("timer-hint").textContent = "演示约 00:55";
  $("btn-stop").disabled = true;
  $("dock-note").textContent = "演示进行中，也可随时跳过到回放";
  liveStart = 0;
  paintDemoFrame(0);
  logEvent("demo", "start");
  runCountdown(2).then(() => {
    if (mode !== "demo") return;
    liveStart = performance.now();
    $("btn-stop").disabled = false;
    loopDemo();
  });
}

function paintDemoFrame(t) {
  const scene = $("live-scene");
  const overlay = $("live-overlay");
  resizeCanvasTo(scene, scene.clientWidth || 360, scene.clientHeight || 640);
  resizeCanvasTo(overlay, overlay.clientWidth || 360, overlay.clientHeight || 640);
  const { p, pose, gaze } = sampleDemo(t);
  if (presenter3d && presenter3dHost === "live-3d") {
    scene.hidden = true;
    const ctx = scene.getContext("2d");
    ctx.clearRect(0, 0, scene.width, scene.height);
    if (presenter3d.setClip) presenter3d.setClip(t % 20 < 12 ? "talk" : (t % 20 < 16 ? "gesture" : "board"));
  } else {
    scene.hidden = false;
    renderScene(scene.getContext("2d"), scene.width, scene.height, p, t);
  }
  const frame = (session && frameAt(session, t)) || { pose, gaze, flags: {}, onBoard: gaze.label === "board" };
  drawLiveOverlays(overlay.getContext("2d"), { ...frame, pose, gaze }, overlay.width, overlay.height, { showMap: true });
  updateFlagsHUD(frame.flags, gaze, frame.onBoard);
}

function runCountdown(seconds) {
  return new Promise((resolve) => {
    const cap = $("hud-caption");
    cap.hidden = false;
    let n = seconds;
    cap.textContent = String(n);
    const id = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        cap.textContent = "开始";
        clearInterval(id);
        setTimeout(() => { if (mode === "camera") cap.hidden = true; resolve(); }, 280);
      } else cap.textContent = String(n);
    }, 700);
  });
}

function loopDemo() {
  cancelAnimationFrame(raf);
  const scene = $("live-scene");
  const overlay = $("live-overlay");
  const step = () => {
    if (mode !== "demo") return;
    const t = Math.min(DEMO_DURATION, (performance.now() - liveStart) / 1000);
    fitStage($("live-stage"), STAGE_W / STAGE_H);
    const { w, h } = resizeCanvasTo(scene, scene.clientWidth, scene.clientHeight);
    resizeCanvasTo(overlay, overlay.clientWidth, overlay.clientHeight);
    const { p, pose, gaze } = sampleDemo(t);
    if (presenter3d && presenter3dHost === "live-3d") {
      scene.hidden = true;
      if (presenter3d.setClip) presenter3d.setClip(t % 20 < 12 ? "talk" : (t % 20 < 16 ? "gesture" : "board"));
    } else {
      scene.hidden = false;
      renderScene(scene.getContext("2d"), w, h, p, t);
    }
    const frame = frameAt(session, t) || { pose, gaze, flags: {}, onBoard: gaze.label === "board" };
    drawLiveOverlays(overlay.getContext("2d"), { ...frame, pose, gaze }, overlay.width, overlay.height, { showMap: true });
    updateFlagsHUD(frame.flags, gaze, frame.onBoard);
    if (debugEnabled()) debugFrame({ source: "demo", t, pose, face: frame.face, gaze, flags: frame.flags, onBoard: frame.onBoard, events: session.events.filter((e) => e.t <= t) });
    const cap = captionAt(t);
    $("hud-caption").hidden = !cap;
    if (cap) $("hud-caption").textContent = cap.text;
    for (const f of fillersUntil(t, fillerSeen)) { fillerSeen.add(f.t); flashFiller(f.word); }
    setClock(t, DEMO_DURATION);
    if (t >= DEMO_DURATION) { finishDemo(); return; }
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}

function finishDemo() {
  if (mode !== "demo") return;
  cancelAnimationFrame(raf);
  disposePresenter3d();
  debugSessionEnd(session);
  openReplay(session);
  setHashSilently("#/replay");
  saveToHistory(session).then((st) => { renderSaveStatus(st); enqueueIfConsented(session); });
}

function updateFlagsHUD(flags = {}, gaze, onBoard, hands) {
  const chips = [];
  if (hands && hands.length) chips.push(["看见双手", "ok"]);
  if (gaze?.label === "class") chips.push(["面向学生", "ok"]);
  if (gaze?.label === "notes") chips.push(["视线在讲稿上", "warn"]);
  if (gaze?.label === "ceiling") chips.push(["视线向上", "warn"]);
  if (gaze?.label === "away") chips.push(["视线偏向一侧", "warn"]);
  if (onBoard) chips.push(["正在写板书", ""]);
  if (flags.sway) chips.push(["左右晃了", "warn"]);
  if (flags.hip) chips.push(["重心偏了", "warn"]);
  if (flags.slouch) chips.push(["含胸了", "warn"]);
  if (flags.folded) chips.push(["抱臂", "warn"]);
  if (flags.out) chips.push(["走出讲台", "warn"]);
  if (flags.back) chips.push(["背对学生写板", "warn"]);
  if (flags.pace) chips.push(["来回走动", "warn"]);
  const html = chips.slice(0, 4).map(([t, k]) => `<span class="flag-chip ${k}">${t}</span>`).join("");
  const host = $("hud-flags");
  if (host.innerHTML !== html) host.innerHTML = html;
}

function flashFiller(word) {
  const host = $("hud-fillers");
  const el = document.createElement("div");
  el.className = "filler-flash";
  el.textContent = word;
  host.appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

function setClock(t, cap) {
  $("live-clock").textContent = fmt(t);
  if (cap) $("timer-hint").textContent = mode === "demo" ? `共 ${fmt(cap)}` : `建议 ${fmt(cap)}`;
}

const fmt = fmtDur;

/* ——— Camera path ——— */

function openPermission() {
  const pre = preflight();
  if (pre) { showError(pre); return; }
  mode = "permission";
  showScreen("permission");
  const s = getSettings();
  const lic = getLicense();
  $("perm-target").textContent = `${s.targetMin} 分钟（${s.sessionMode === "classroom" ? "课堂" : "练习"}）`;
  $("perm-board").textContent = s.boardSide === "left" ? "左侧" : "右侧";
  document.querySelectorAll("#perm-session-mode .seg-btn").forEach((b) => {
    const on = b.dataset.session === s.sessionMode;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", on ? "true" : "false");
  });
  document.querySelectorAll("#perm-frame-mode .seg-btn").forEach((b) => {
    const on = b.dataset.frame === s.frameMode;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", on ? "true" : "false");
  });
  const tip = $("perm-frame-hint");
  if (tip) tip.textContent = (FRAME_MODES[s.frameMode] || FRAME_MODES.auto).hint;
  document.querySelectorAll("#screen-permission .seg-btn[data-facing]").forEach((b) => {
    const on = b.dataset.facing === s.facing;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", on ? "true" : "false");
  });
  const cb = $("perm-save-video");
  cb.checked = s.saveVideo && lic.features.saveVideo;
  cb.disabled = !lic.features.saveVideo || !envInfo().hasRecorder;
  document.querySelectorAll("#perm-classroom-sim .seg-btn").forEach((b) => {
    const on = (b.dataset.sim || "off") === (s.classroomSim || "off");
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", on ? "true" : "false");
  });
  const stemEl = $("perm-stem");
  if (stemEl) stemEl.value = s.stemRequirement || "";
  $("media-error").hidden = true;
}

function showError(code, err) {
  stopEverything();
  mode = "error";
  showScreen("error");
  const c = errorCopy(code);
  $("err-title").textContent = c.title;
  $("err-why").textContent = c.why;
  $("err-steps").innerHTML = c.steps.map((x) => `<li>${esc(x)}</li>`).join("");
  $("btn-err-retry").hidden = !c.canRetry;
  $("err-url-wrap").hidden = !c.copyUrl;
  if (c.copyUrl) $("err-url").value = c.copyUrl;
  logEvent("camera-error", `${code} ${err && (err.name + ": " + err.message) || ""}`);
}

async function requestMedia() {
  const s = getSettings();
  const btn = $("btn-allow-media");
  btn.disabled = true;
  try {
    const r = await openCamera({ facing: s.facing, deviceId: s.deviceId });
    mediaStream = r.stream;
    micOn = r.audio;
    const f = streamFacing(mediaStream);
    camLabel = `${f.width}x${f.height} ${f.facingMode || ""}`.trim();
    logEvent("camera", camLabel + (micOn ? " +mic" : " no-mic"));
    mediaStream.getVideoTracks()[0]?.addEventListener("ended", onTrackEnded);
    return true;
  } catch (e) {
    // A stale deviceId (camera unplugged) — forget it and retry once.
    if (s.deviceId && e && e.code === "nocamera") {
      saveSettings({ deviceId: "" });
      btn.disabled = false;
      return requestMedia();
    }
    showError(e && e.code ? e.code : "unknown", e && e.err);
    return false;
  } finally {
    btn.disabled = false;
  }
}

function onTrackEnded() {
  if (mode === "camera") {
    streamEnded = true;
    pauseLive("摄像头断开了（可能被拔出或被其他程序占用）。可以结束并查看已录下的部分。");
  } else if (mode === "coach") {
    showError("busy");
  }
}

function attachVideo(el, stream) {
  el.srcObject = stream;
  el.muted = true;
  el.playsInline = true;
  el.setAttribute("playsinline", "");
  return el.play().catch(() => {});
}

function applyMirror(on) {
  for (const id of ["coach-video", "live-video"]) $(id).classList.toggle("mirrored", !!on);
}

function videoAspectOf(v) {
  if (v && v.videoWidth && v.videoHeight) return v.videoWidth / v.videoHeight;
  return window.innerWidth < window.innerHeight ? 9 / 16 : 16 / 9;
}

async function startCoach() {
  mode = "coach";
  showScreen("coach");
  const s = getSettings();
  const video = $("coach-video");
  applyMirror(s.mirror);
  $("coach-mirror").checked = s.mirror;
  attachVideo(video, mediaStream);
  $("mic-state").textContent = micOn ? "麦克风已开启，将留下转写并标出水词" : "麦克风未开启：这一次没有转写，也统计不了口头禅。建议返回并允许麦克风。";
  setAsrStatusLabel($("coach-asr-state"));
  // 本机听写已下载：在站位时就把引擎在后台线程里载入，开讲时不用再等。
  if (micOn && s.asrEngine !== "webspeech" && asrStatus().sherpa) prewarmSherpa(mediaStream);
  // 还没下载本机听写：在站位页就给出下载入口（浏览器听写在中国大陆经常连不上）
  {
    let box = $("coach-local-asr");
    const out = $("speech-preflight-result");
    if (!box && out) { box = document.createElement("div"); box.id = "coach-local-asr"; out.insertAdjacentElement("afterend", box); }
    if (box) {
      const st = asrStatus();
      box.hidden = !(micOn && s.asrEngine !== "webspeech" && !st.sherpa && st.sherpaSupported);
      if (!box.hidden) mountLocalAsr(box, { compact: true, onReady: () => { setAsrStatusLabel($("coach-asr-state")); prewarmSherpa(mediaStream); } });
    }
  }
  const sub = $("coach-sub");
  if (sub) sub.textContent = `半透框是「板书区」（画面${s.boardSide === "left" ? "左" : "右"}侧），可对准教室里的黑板。没有黑板也可以忽略。目前不能认出黑板上的字；能看到手是否伸向板书区、是否在写、写完是否回视学生。`;
  const canvas = $("coach-canvas");
  setRuntime({ boardSide: s.boardSide, sens: s.sens, frameMode: s.frameMode });
  const loop = () => {
    if (mode !== "coach") return;
    fitStage($("coach-stage"), videoAspectOf(video));
    resizeCanvasTo(canvas, canvas.clientWidth, canvas.clientHeight);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawCoachSilhouette(ctx, canvas.width, canvas.height);
    raf = requestAnimationFrame(loop);
  };
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(loop);
  // cameras list (labels available after permission)
  const cams = await listCameras();
  $("btn-switch-cam").hidden = cams.length < 2;
  const sel = $("coach-device");
  if (cams.length > 1) {
    const cur = streamFacing(mediaStream).deviceId;
    sel.innerHTML = cams.map((c) => `<option value="${esc(c.deviceId)}" ${c.deviceId === cur ? "selected" : ""}>${esc(c.label)}</option>`).join("");
    sel.hidden = false;
  } else sel.hidden = true;
  watchModels();
  initVision().then(watchModels);
}

let unsubProgress = null;
function watchModels() {
  if (unsubProgress) unsubProgress();
  const wrap = $("model-progress");
  unsubProgress = onVisionProgress((p) => {
    const st = visionStatus();
    if (st.pose || st.face) {
      wrap.classList.add("done");
      $("mp-label").textContent = st.ready ? "教态模型已就绪" : "部分模型已就绪（视线或体态可能不完整）";
      $("mp-fill").style.width = "100%";
      $("btn-model-retry").hidden = true;
      setTimeout(() => { if (visionStatus().pose || visionStatus().face) wrap.hidden = true; }, 1200);
      return;
    }
    wrap.hidden = false;
    wrap.classList.remove("done");
    if (p.phase === "error" || p.phase === "timeout") {
      $("mp-label").textContent = p.phase === "timeout" ? "模型加载太慢。仍可录制和听口头禅，只是不画骨骼线。" : "模型没能加载。仍可录制和听口头禅，只是不画骨骼线。";
      $("btn-model-retry").hidden = false;
    } else if (p.phase === "init") {
      $("mp-label").textContent = "正在启动教态模型…";
      $("mp-fill").style.width = "96%";
    } else {
      $("mp-label").textContent = `正在下载教态模型 ${p.pct}%（体态约 21 MB，手部另约 8 MB，只需一次）`;
      $("mp-fill").style.width = `${Math.max(3, p.pct * 0.95)}%`;
    }
  });
}

async function switchCamera(deviceId) {
  const s = getSettings();
  releaseStream();
  if (deviceId) saveSettings({ deviceId });
  else saveSettings({ facing: s.facing === "user" ? "environment" : "user", deviceId: "" });
  const ns = getSettings();
  // Back camera is normally not mirrored; front camera is.
  if (!deviceId) saveSettings({ mirror: ns.facing === "user" });
  const ok = await requestMedia();
  if (ok) startCoach();
}

async function startCameraLive() {
  if (mode === "camera" || mode === "finishing") return;
  cancelAnimationFrame(raf);
  mode = "camera";
  const s = getSettings();
  liveTiming = timing(s);
  setRuntime({ boardSide: s.boardSide, sens: s.sens, frameMode: s.frameMode });
  session = createSession("camera");
  session.mirror = s.mirror;
  session.frameMode = s.frameMode;
  session.sessionMode = s.sessionMode;
  session.asrEngine = s.asrEngine;
  const stem = (($("perm-stem") && $("perm-stem").value) || "").trim().slice(0, 800);
  session.stemRequirement = stem;
  if (stem !== (s.stemRequirement || "")) saveSettings({ stemRequirement: stem });
  session.settingsSnapshot = { boardSide: s.boardSide, sens: { ...s.sens }, mirror: s.mirror, targetMin: s.targetMin, speechLang: s.speechLang, facing: s.facing, frameMode: s.frameMode, sessionMode: s.sessionMode, fillers: s.fillers.slice(), asrEngine: s.asrEngine, classroomSim: s.classroomSim || "off", stemRequirement: stem };
  session.thumb = "";
  fillerSeen = new Set();
  paused = false;
  pauseCount = 0;
  streamEnded = false;
  saveVideoThisTime = $("perm-save-video").checked && getLicense().features.saveVideo;
  showScreen("live");
  applyMirror(s.mirror);
  $("btn-skip-demo").hidden = true;
  const liveHint = $("live-kbd-hint");
  if (liveHint) liveHint.hidden = false;
  $("live-video").hidden = false;
  $("live-scene").hidden = true;
  $("hud-caption").hidden = true;
  $("speech-banner").hidden = true;
  $("timer-hint").textContent = `建议 ${fmt(liveTiming.suggested)}`;
  $("btn-stop").disabled = true;
  $("dock-note").textContent = `大约 ${liveTiming.minStop} 秒后可以结束，最长 ${fmt(liveTiming.max)}`;
  const wrap = $("live-wrap");
  stopClassroomSim();
  if (s.classroomSim === "class" || s.classroomSim === "roadshow") {
    if (wrap) wrap.classList.add("has-sim");
    startClassroomSim(s.classroomSim, { now: () => (liveStart ? (performance.now() - liveStart) / 1000 : 0) }).catch(() => {});
  } else if (wrap) {
    wrap.classList.remove("has-sim");
  }

  const video = $("live-video");
  await attachVideo(video, mediaStream);
  fitStage($("live-stage"), videoAspectOf(video));

  const status = visionStatus().pose || visionStatus().face ? visionStatus() : await Promise.race([initVision(), new Promise((r) => setTimeout(() => r(visionStatus()), 4000))]);
  session.visionAvailable = !!(status.pose || status.face);
  if (!session.visionAvailable) banner("教态模型还没就绪：这次会录制并统计口头禅，但不画骨骼线、不统计教态和视线。", 9000);

  await runCountdown(3);
  if (mode !== "camera") return;
  liveStart = performance.now();
  session.aspect = videoAspectOf(video);
  keepAwake(true);
  startRecording();
  session.speechAvailable = speechSupported() && micOn;
  session.speechError = "";
  currentProfileName().then((n) => { if (n && session) session.profileName = n; }).catch(() => {});
  debugSessionStart({ kind: "camera", camera: camLabel, mic: micOn, aspect: session.aspect });
  const asrLive = $("live-asr-state");
  if (micOn) {
    const speechOpen = () => (mode === "camera" || mode === "finishing") && liveStart && !paused;
    const speechT = (meta) => Math.max(0, (performance.now() - liveStart) / 1000 - ((meta && meta.agoSec) || 0));
    speechHandle = startAsr({
      engine: s.asrEngine,
      lang: s.speechLang,
      fillers: s.fillers,
      sensitivity: s.sens.filler,
      stream: mediaStream,
      onFiller: (word, meta) => {
        if (!speechOpen()) return;
        const t = speechT(meta);
        addFiller(session, t, word);
        if (mode === "camera") flashFiller(word);
        debugSpeech("filler", word, { t });
      },
      onTranscript: (seg) => {
        if (!speechOpen()) return;
        addTranscript(session, speechT(seg), seg.text, !!seg.final);
        if (isSimActive()) feedClassroomSim(seg.text, speechT(seg), !!seg.final);
      },
      onDebug: debugEnabled() ? debugSpeech : null,
      onHeard: () => { session.speechHeard = true; },
      onStatus: (st) => {
        if (!st) return;
        if (st.engine) session.asrEngine = st.engine;
        if (st.engine === "sherpa" && st.ok) session.speechAvailable = true;
        setAsrStatusLabel(asrLive, st.engine, st.ok === false ? "当前不可用" : st.loading ? "载入中" : "");
        if (st.switched) {
          session.speechError = "";
          banner(st.message, 6000);
          logEvent("speech", st.message);
          return;
        }
        if (!st.ok) {
          session.speechError = st.message || "";
          banner(st.message, st.sticky ? 0 : 8000, st.offerLocal ? { localOffer: true } : null);
          if (st.sticky || st.engine === "none") session.speechAvailable = false;
          logEvent("speech", st.message);
        }
      },
    });
    setAsrStatusLabel(asrLive, speechHandle && speechHandle.engine);
    // 浏览器听写 20 秒都没写出字（有的环境不报错，只是没有结果）：提示可改用本机听写
    setTimeout(() => {
      if (mode !== "camera" || !session || session.speechHeard || session.asrEngine === "sherpa") return;
      const st = asrStatus();
      if (st.sherpa || !st.sherpaSupported) return;
      banner("浏览器听写 20 秒都没有写出字。在中国大陆它经常连不上厂商服务。可以改用本机听写：声音只在这台设备上识别。", 0, { localOffer: true });
    }, 20000);
  } else {
    session.speechAvailable = false;
    setAsrStatusLabel(asrLive, "none", "未开麦克风");
    banner("麦克风未开启，这次不统计口头禅。教态和视线仍在分析。", 6000);
  }
  loopCamera();
}

function setAsrStatusLabel(el, engine, extra = "") {
  if (!el) return;
  const pref = getSettings().asrEngine;
  const d = describeAsrEngine(engine || (pref === "webspeech" ? "webspeech" : pref === "sherpa" ? "sherpa" : asrStatus().preferred));
  el.textContent = extra ? `听写：${d.label}（${extra}）` : `听写：${d.label}`;
  el.title = d.detail;
  el.hidden = false;
}

let bannerTimer = 0;
function banner(msg, ms = 6000, extra = null) {
  const el = $("speech-banner");
  // 横幅里正在下载本机听写：别让其他提示把进度条盖掉
  if (localDownloadRunning() && !el.hidden && el.querySelector(".local-asr")) return;
  el.textContent = "";
  const txt = document.createElement("span");
  txt.textContent = msg;
  el.appendChild(txt);
  if (extra && extra.localOffer && !asrStatus().sherpa) {
    const note = document.createElement("span");
    note.className = "banner-local-note";
    if (localDownloadRunning()) note.textContent = "听写包正在角落里下载，好了会自动换上本机听写。";
    else if (autoDownloadBlockedReason() === "saveData") note.textContent = "可点右下角「听写包」下载本机听写，声音只留在这台设备上。";
    else note.textContent = "可点右下角的听写包，在这台设备上下载并改用本机听写。";
    el.appendChild(note);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "btn-mini banner-close";
    close.textContent = "收起";
    close.addEventListener("click", () => { el.hidden = true; });
    el.appendChild(close);
  }
  el.hidden = false;
  clearTimeout(bannerTimer);
  if (ms && ms > 0) bannerTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function pickMime() {
  const types = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4;codecs=avc1,mp4a", "video/mp4"];
  for (const t of types) if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) return t;
  return "";
}

function startRecording() {
  chunks = [];
  if (!mediaStream || !window.MediaRecorder) return;
  try {
    const mime = pickMime();
    const opts = { videoBitsPerSecond: 1_200_000 };
    if (mime) opts.mimeType = mime;
    recorder = new MediaRecorder(mediaStream, opts);
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.start(1000);
  } catch (e) {
    recorder = null;
    logEvent("recorder", e && e.message);
  }
}

function makeThumb(drawBase, frame, aspect) {
  try {
    const W = 270, H = Math.round(W / (aspect || 9 / 16));
    const c = document.createElement("canvas");
    c.width = W; c.height = Math.min(H, 600);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#161410";
    ctx.fillRect(0, 0, c.width, c.height);
    drawBase(ctx, c.width, c.height);
    if (frame) drawLiveOverlays(ctx, frame, c.width, c.height, { showMap: false, clear: false });
    return c.toDataURL("image/jpeg", 0.72);
  } catch (_) {
    return "";
  }
}

function drawVideoInto(video, mirror) {
  return (ctx, w, h) => {
    ctx.save();
    if (mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
    try { ctx.drawImage(video, 0, 0, w, h); } catch (_) {}
    ctx.restore();
  };
}

/**
 * 性能档位。「流畅优先」少算面部和手部、限制分析帧率；「精细优先」每帧都算姿态和面部。
 * 「自动」先按精细跑 3 秒，量出每帧耗时后决定，必要时再一级级降。
 */
const PERF_LEVELS = [
  { name: "精细", targetFps: 24, faceEvery: 1, handEvery: 2 },
  { name: "均衡", targetFps: 20, faceEvery: 2, handEvery: 3 },
  { name: "流畅", targetFps: 15, faceEvery: 3, handEvery: 4 },
  { name: "省力", targetFps: 12, faceEvery: 4, handEvery: 6 },
  { name: "最省", targetFps: 10, faceEvery: 5, handEvery: 8, lowRes: true },
];

function loopCamera() {
  const video = $("live-video");
  const overlay = $("live-overlay");
  const s = getSettings();
  const perfMode = s.perfMode || "auto";
  let level = perfMode === "detail" ? 0 : perfMode === "smooth" ? 2 : 1;
  const floor = perfMode === "detail" ? 1 : PERF_LEVELS.length - 1; // 精细优先最多降到「均衡」
  let lvl = PERF_LEVELS[level];
  let frameTimes = [];
  let slowSince = 0;
  let noPoseSince = 0;
  let fpsSum = 0, fpsN = 0, minFps = 99, poseFrames = 0, totalFrames = 0;
  let lastVideoTime = -1, lastDetectAt = 0, lastUiAt = 0, lastSizeAt = 0;
  const msWin = []; // 最近的每帧总耗时
  const perModel = { pose: [], face: [], hands: [] };
  let triedCpu = false, gpuMs = 0;
  let decided = perfMode !== "auto";
  session.stats = { camera: camLabel, mic: micOn, vision: session.visionAvailable, delegate: visionStatus().delegate, perfMode };
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const push = (a, v, n = 30) => { a.push(v); if (a.length > n) a.shift(); };
  const setLevel = (n, why) => {
    n = Math.max(0, Math.min(floor, n));
    if (n === level) return;
    const down = n > level;
    level = n; lvl = PERF_LEVELS[level];
    if (lvl.lowRes) lowerCameraResolution();
    logEvent("perf", `${lvl.name} ${why}`);
    if (down && level >= 2) banner(level === 2 ? "这台电脑有点吃力，已切到「流畅优先」：少算面部和手部，画面更顺。" : "设备较慢，已进一步降低分析频率。可关闭其他标签页，或在设置里选「流畅优先」。", 5000);
  };

  const step = () => {
    if (mode !== "camera") return;
    raf = requestAnimationFrame(step);
    if (paused) return;
    const now = performance.now();
    const t = (now - liveStart) / 1000;
    // 计时与按钮：每秒 4 次就够，不必每帧改 DOM
    if (now - lastUiAt > 250) {
      lastUiAt = now;
      setClock(t, liveTiming.suggested);
      if (isSimActive()) {
        const last = session.transcript && session.transcript[session.transcript.length - 1];
        const silence = last ? t - last.t : 0;
        const cpm = recentCharsPerMin(session.transcript, t);
        const fr = session.frames[session.frames.length - 1];
        tickClassroomSim(t, { silence, cpm, pose: fr && fr.pose });
      }
      $("btn-stop").disabled = t < liveTiming.minStop;
      $("dock-note").textContent = t < liveTiming.minStop
        ? `再讲 ${Math.ceil(liveTiming.minStop - t)} 秒就可以结束`
        : t >= liveTiming.suggested
          ? `已经到建议时长，可以结束（最长 ${fmt(liveTiming.max)}）`
          : `可以结束，也可以继续讲到 ${fmt(liveTiming.suggested)}`;
      if (t >= liveTiming.max) { cancelAnimationFrame(raf); finishCamera(); return; }
    }
    // 摄像头没出新画面、或离上次分析太近：这一帧什么也不算
    const vt = video.currentTime;
    if (vt === lastVideoTime || now - lastDetectAt < 1000 / lvl.targetFps - 4) return;
    lastVideoTime = vt;
    lastDetectAt = now;
    if (now - lastSizeAt > 500) {
      lastSizeAt = now;
      fitStage($("live-stage"), videoAspectOf(video));
      resizeCanvasTo(overlay, overlay.clientWidth, overlay.clientHeight);
    }
    const det = detectVideo(video, now, { mirror: session.mirror, faceEvery: lvl.faceEvery, handEvery: lvl.handEvery });
    push(msWin, det.ms);
    push(perModel.pose, det.msPose);
    if (det.ranFace) push(perModel.face, det.msFace);
    if (det.ranHands) push(perModel.hands, det.msHands);
    const gaze = extractGaze(det.pose, det.face, det.matrix);
    const posture = extractPosture(det.pose, session._hist, det.hands);
    tickFrame(session, t, det.pose, det.face, gaze, posture, det.hands);
    const last = session.frames[session.frames.length - 1];
    const frame = { pose: det.pose, gaze, flags: posture.flags, onBoard: last ? last.onBoard : false, hands: det.hands };
    if (session._writing) maybeCaptureBoardStill(session, video, t, { mirror: session.mirror });
    drawLiveOverlays(overlay.getContext("2d"), frame, overlay.width, overlay.height, { showMap: s.showMap });
    if (totalFrames % 3 === 0) updateFlagsHUD(frame.flags, gaze, frame.onBoard, det.hands);
    const perf = { mode: perfMode, level: lvl.name, targetFps: lvl.targetFps, faceEvery: lvl.faceEvery, handEvery: lvl.handEvery,
      msPose: avg(perModel.pose), msFace: avg(perModel.face), msHands: avg(perModel.hands), msFrame: avg(msWin), delegate: visionStatus().delegate };
    if (debugEnabled()) debugFrame({ source: "camera", t, det, gaze, flags: frame.flags, onBoard: frame.onBoard, faceEvery: lvl.faceEvery, events: session.events, hands: det.hands ? det.hands.length : 0, perf });

    // performance watch
    totalFrames += 1;
    if (det.pose) poseFrames += 1;
    frameTimes.push(now);
    while (frameTimes.length && now - frameTimes[0] > 2000) frameTimes.shift();
    if (t > 2.5 && frameTimes.length > 3 && session.visionAvailable) {
      const fps = (frameTimes.length - 1) / ((now - frameTimes[0]) / 1000);
      fpsSum += fps; fpsN += 1; minFps = Math.min(minFps, fps);
      const msPerFrame = avg(msWin);
      // 自动：头 3 秒量一次，决定起步档位；GPU 明显慢时试一次 CPU
      if (!decided && t > 3 && msWin.length >= 8) {
        decided = true;
        const d = visionStatus().delegate;
        if (d.pose === "GPU" && avg(perModel.pose) > 35 && !triedCpu) {
          triedCpu = true;
          gpuMs = avg(perModel.pose);
          logEvent("perf", `GPU 姿态 ${gpuMs.toFixed(0)} ms/帧，试 CPU`);
          switchDelegate("CPU").then(() => { perModel.pose.length = 0; perModel.face.length = 0; perModel.hands.length = 0; msWin.length = 0; });
        }
        const budget = 1000 / 20; // 每帧分析耗时超过 50 ms 就从「均衡」往下
        if (msPerFrame > budget * 1.6) setLevel(3, `每帧 ${msPerFrame.toFixed(0)} ms`);
        else if (msPerFrame > budget) setLevel(2, `每帧 ${msPerFrame.toFixed(0)} ms`);
        else if (msPerFrame < 22) setLevel(0, `每帧 ${msPerFrame.toFixed(0)} ms`);
      }
      // 试过 CPU：若反而更慢，换回 GPU
      if (triedCpu && gpuMs && perModel.pose.length >= 10 && visionStatus().delegate.pose === "CPU") {
        const cpuMs = avg(perModel.pose);
        if (cpuMs > gpuMs * 1.15) { logEvent("perf", `CPU ${cpuMs.toFixed(0)} ms 比 GPU 慢，换回`); switchDelegate("GPU"); }
        gpuMs = 0;
      }
      if (fps < lvl.targetFps * 0.6 && fps < 12) {
        if (!slowSince) slowSince = now;
        if (now - slowSince > 3000 && level < floor) { setLevel(level + 1, `${fps.toFixed(1)} fps`); slowSince = 0; }
      } else slowSince = 0;
    }
    if (session.visionAvailable && !det.pose && t > 2) {
      if (!noPoseSince) noPoseSince = now;
      if (now - noPoseSince > 4000) { banner("暂时没看到人：请退后一点，让腰部以上进入画面，并保证光线充足。", 3000); noPoseSince = now; }
    } else noPoseSince = 0;

    if (!session.thumb && t > 5 && det.pose) session.thumb = makeThumb(drawVideoInto(video, session.mirror), frame, session.aspect);

    session.stats.avgFps = fpsN ? Math.round((fpsSum / fpsN) * 10) / 10 : 0;
    session.stats.minFps = minFps === 99 ? 0 : Math.round(minFps * 10) / 10;
    session.stats.faceEvery = lvl.faceEvery;
    session.stats.handEvery = lvl.handEvery;
    session.stats.perfLevel = lvl.name;
    session.stats.msPerFrame = Math.round(avg(msWin));
    session.stats.delegate = visionStatus().delegate;
    session.stats.poseSeen = totalFrames ? Math.round((poseFrames / totalFrames) * 100) / 100 : 0;
  };
  raf = requestAnimationFrame(step);
}

/** 最省档：把摄像头降到 640 宽（录像也随之变小），分析和编码都更轻。 */
function lowerCameraResolution() {
  try {
    const tr = mediaStream && mediaStream.getVideoTracks()[0];
    const st = tr && tr.getSettings ? tr.getSettings() : {};
    if (tr && st.width && st.width > 700) tr.applyConstraints({ width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24, max: 30 } }).catch(() => {});
  } catch (_) {}
}

function pauseLive(why) {
  if (mode !== "camera" || paused) {
    if (paused && why) $("pause-why").textContent = why;
    return;
  }
  paused = true;
  pausedAt = performance.now();
  pauseCount += 1;
  try { if (recorder && recorder.state === "recording") recorder.pause(); } catch (_) {}
  if (speechHandle) speechHandle.pause();
  $("pause-why").textContent = why || "页面切到了后台，录制与分析已暂停。";
  $("btn-resume").hidden = streamEnded;
  $("pause-veil").hidden = false;
  logEvent("pause", why || "hidden");
}

function resumeLive() {
  if (!paused || streamEnded) return;
  const gap = performance.now() - pausedAt;
  liveStart += gap;
  paused = false;
  try { if (recorder && recorder.state === "paused") recorder.resume(); } catch (_) {}
  if (speechHandle) speechHandle.resume();
  keepAwake(true);
  $("pause-veil").hidden = true;
  const v = $("live-video");
  if (v.paused) v.play().catch(() => {});
}

async function finishCamera() {
  if (mode !== "camera") return;
  cancelAnimationFrame(raf);
  mode = "finishing";
  if (paused) {
    // Do not count paused time.
    paused = false;
  }
  const sh = speechHandle;
  speechHandle = null;
  // 本机听写会先把最后一句识别完再停（最多约 2.5 秒），与停止录像并行。
  const speechDone = sh ? Promise.resolve(sh.stop()).catch(() => {}) : Promise.resolve();
  keepAwake(false);
  const rec = recorder;
  recorder = null;
  if (rec && rec.state !== "inactive") {
    await new Promise((resolve) => {
      rec.onstop = resolve;
      try { rec.stop(); } catch (_) { resolve(); }
      setTimeout(resolve, 1500);
    });
  }
  if (chunks.length) {
    const type = (chunks[0].type || pickMime() || "video/webm").split(";")[0];
    session.videoBlob = new Blob(chunks, { type });
    session.videoUrl = URL.createObjectURL(session.videoBlob);
  }
  chunks = [];
  await Promise.race([speechDone, new Promise((r) => setTimeout(r, 3000))]);
  if (!session.thumb) {
    const v = $("live-video");
    const last = session.frames[session.frames.length - 1];
    session.thumb = makeThumb(drawVideoInto(v, session.mirror), last, session.aspect);
  }
  session.speechHeard = !!session.speechHeard;
  if (isSimActive()) session.simLog = summarizeClassroomSim();
  stopClassroomSim();
  const liveWrap = $("live-wrap");
  if (liveWrap) liveWrap.classList.remove("has-sim");
  session.stats = { ...(session.stats || {}), speechHeard: session.speechHeard, pauses: pauseCount, durationSec: Math.round(session.duration), speech: session.speechAvailable, recorded: !!session.videoBlob, recordedMB: session.videoBlob ? Math.round(session.videoBlob.size / 1e5) / 10 : 0 };
  diagnose(session);
  setLastSessionStats({ ...session.stats, counts: session.diagnosis.counts });
  debugSessionEnd(session);
  releaseStream();
  mode = "camera-done";
  openReplay(session);
  setHashSilently("#/replay");
  const st = await saveToHistory(session, { withVideo: saveVideoThisTime });
  renderSaveStatus(st);
  enqueueIfConsented(session);
  if (st.id) setHashSilently(`#/session/${st.id}`);
}

async function enqueueIfConsented(sess) {
  if (!experienceOn() || !sess) return;
  const shots = [];
  try {
    const c = stillCanvas();
    if (c && c.width) shots.push(c.toDataURL("image/jpeg", 0.62));
  } catch (_) {}
  try { await maybeEnqueue(sess, { screenshots: shots }); } catch (_) {}
}

/* ——— History save ——— */

let lastSaveStatus = null;
async function saveToHistory(sess, { withVideo = false } = {}) {
  const lic = getLicense();
  const out = { ok: false, text: "", id: null, replaced: 0, video: false };
  try {
    const list = await listSessions();
    if (sess.kind === "demo") {
      for (const old of list.filter((x) => x.kind === "demo")) await deleteSession(old.id);
      if (!sess.thumb) {
        sess.thumb = makeThumb((ctx, w, h) => { renderScene(ctx, w, h, sampleDemo(36).p, 36); }, (() => { const f = frameAt(sess, 36); return f; })(), STAGE_W / STAGE_H);
      }
    } else {
      const cams = list.filter((x) => x.kind === "camera");
      const max = lic.features.maxHistory;
      if (Number.isFinite(max) && cams.length >= max) {
        const excess = cams.slice(max - 1); // newest first; keep max-1
        for (const old of excess) { await deleteSession(old.id); out.replaced += 1; }
      }
    }
    const rec = toRecord(sess, { profileName: sess.profileName || "" });
    let blob = null;
    if (withVideo && sess.videoBlob && lic.features.saveVideo) {
      blob = sess.videoBlob;
      rec.hasVideo = true;
      rec.videoSize = blob.size;
      rec.videoType = blob.type;
    }
    try {
      await putSession(rec, blob);
      out.video = !!blob;
    } catch (e) {
      if (blob) {
        rec.hasVideo = false; rec.videoSize = 0;
        await putSession(rec, null);
        out.videoFailed = true;
      } else throw e;
    }
    if (blob) requestPersist();
    sess.id = rec.id;
    sess.stored = true;
    sess.hasVideo = rec.hasVideo;
    out.ok = true;
    out.id = rec.id;
    if (sess.kind === "demo") out.text = "演示记录已存入历史（只保留最近一次演示，不占试用名额）。";
    else {
      out.text = out.video ? "已保存到本机历史（含录像）。" : "已保存到本机历史（不含录像）。";
      if (out.videoFailed) out.text = "已保存到本机历史，但录像太大或空间不足，没能一起保存。";
      if (out.replaced) out.text += `${lic.label}最多保留 ${lic.features.maxHistory} 次试讲，已自动替换最早的 ${out.replaced} 次。`;
    }
    logEvent("saved", `${sess.kind} video=${out.video}`);
  } catch (e) {
    out.text = "没能保存到本机历史（浏览器可能处于无痕模式或禁止了存储）。本次回放仍可查看，可以导出小结图片。";
    logEvent("save-error", e && e.message);
  }
  lastSaveStatus = out;
  return out;
}

function renderSaveStatus(st = lastSaveStatus) {
  if (!st || mode !== "replay") return;
  $("save-status").innerHTML = `${esc(st.text)}${st.ok ? ' <a href="#/history">查看历史</a>' : ""}`;
  updateSaveVideoBtn();
  renderDiagCompare(session);
}

function updateSaveVideoBtn() {
  const b = $("btn-save-video");
  b.hidden = !(session && session.kind === "camera" && session.videoBlob && session.stored && !session.hasVideo && getLicense().features.saveVideo);
}

/* ——— Replay ——— */

function sizeReplayWrap(sess) {
  const wrap = $("replay-wrap");
  if (window.innerWidth <= 900) {
    const h = Math.min(window.innerHeight * 0.6, (window.innerWidth - 20) / replayAspect(sess));
    wrap.style.height = `${Math.max(240, Math.round(h))}px`;
  } else wrap.style.height = "";
}

function replayAspect(sess) {
  return sess.kind === "demo" ? STAGE_W / STAGE_H : (sess.aspect || 9 / 16);
}

function openReplay(sess) {
  cancelAnimationFrame(raf);
  session = sess;
  mode = "replay";
  showScreen("replay");
  if (sess.kind === "demo") setRuntime({});
  else {
    const snap = sess.settingsSnapshot || {};
    setRuntime({ boardSide: snap.boardSide || "right", sens: snap.sens || {}, frameMode: sess.frameResolved || snap.frameMode || "half", frameResolved: sess.frameResolved || "half" });
  }
  sizeReplayWrap(sess);
  fitStage($("replay-stage"), replayAspect(sess));
  $("btn-skip-demo").hidden = true;
  renderDiagnosis(sess);
  renderTimeline(sess);
  const video = $("replay-video");
  const scene = $("replay-scene");
  stopReplayPlay();
  replayCursor = 0;
  video.classList.toggle("mirrored", !!sess.mirror);
  $("replay-note").hidden = true;
  if (sess.kind === "camera" && sess.videoUrl) {
    video.hidden = false;
    scene.hidden = true;
    video.src = sess.videoUrl;
    video.onloadedmetadata = () => {
      // MediaRecorder webm often reports Infinity duration until seeked.
      if (!Number.isFinite(video.duration)) {
        video.currentTime = 1e6;
        video.ontimeupdate = () => { video.ontimeupdate = null; video.currentTime = 0; paintReplay(0); };
      } else { video.currentTime = 0; paintReplay(0); }
    };
  } else {
    video.hidden = true;
    video.removeAttribute("src");
    scene.hidden = sess.kind !== "demo";
    if (sess.kind === "camera") {
      $("replay-note").hidden = false;
      $("replay-note").textContent = sess.fromHistory ? "这次没有保存录像，只回放骨骼、视线与标记。" : "这个浏览器无法录像，只回放骨骼、视线与标记。";
    }
  }
  paintReplay(0);
  $("replay-clock").textContent = `00:00 / ${fmt(sess.duration)}`;
  $("save-status").textContent = sess.stored ? (sess.fromHistory ? `已在本机历史中${sess.hasVideo ? "（含录像）" : ""}。` : "") : "正在保存到本机历史…";
  updateSaveVideoBtn();
  $("btn-print").hidden = !getLicense().features.printReport;
  renderDiagCompare(sess);
}

function renderDiagnosis(sess) {
  const d = sess.diagnosis || diagnose(sess);
  const items = [["posture", d.counts.posture, "教态提示"], ["gaze", d.counts.gaze, "视线落下"], ["filler", d.counts.filler, "口头禅"], ["board", d.counts.board, "写板未回视"]];
  $("diag-counts").innerHTML = items.map(([k, n, lab]) =>
    `<div class="diag-count" data-kind="${k === "posture" ? "sway" : k}"><div class="n">${n}</div><div class="k">${lab}</div></div>`).join("");
  $("diag-good").textContent = d.good;
  $("diag-next").textContent = d.next;
  const bits = [fmtDate(sess.startedAt || Date.now()), `时长 ${fmt(sess.duration)}`, sess.kind === "demo" ? "一键演示样本" : "真实试讲"];
  if (sess.profileName) bits.push(sess.profileName);
  if (sess.kind === "camera" && sess.speechAvailable === false) bits.push("本次未听写口头禅");
  else if (sess.kind === "camera" && sess.speechHeard === false) bits.push("没听到语音，口头禅无法可靠统计");
  if (sess.kind === "camera" && sess.visionAvailable === false) bits.push("本次未分析体态");
  else if (sess.kind === "camera" && Number.isFinite(d.poseRatio)) bits.push(`识别到人 ${Math.round(d.poseRatio * 100)}%`);
  if (sess.frameResolved) bits.push(sess.frameResolved === "full" ? "全身构图" : "半身构图");
  if (sess.sessionMode === "classroom") bits.push("课堂模式");
  $("diag-meta").textContent = bits.join(" · ");
  renderTranscript(sess);
  renderFillerReport(sess);
  renderBoardStills(sess);
  const sheet = $("observe-sheet");
  if (sheet) {
    renderObserveSheet(sheet, sess, {
      onJump: (t) => { stopReplayPlay(); seekReplay(t); },
    });
  }
}


function renderFillerReport(sess) {
  const host = $("filler-report");
  if (!host) return;
  const rep = (sess.diagnosis && sess.diagnosis.fillerReport) || buildFillerReport(sess);
  if (!rep.ok) {
    host.innerHTML = `<p class="filler-reason">${esc(rep.reason)}</p>`;
    return;
  }
  const words = (rep.words || []).map((w) => {
    const t0 = w.times && w.times[0];
    const jump = Number.isFinite(t0) ? `<button type="button" data-jump="${t0}">${fmt(t0)} 起</button>` : "";
    return `<li><span>「${esc(w.word)}」 <b>${w.count}</b> 次</span>${jump}</li>`;
  }).join("") || "<li>词表里的口头禅很少。</li>";
  const methods = (rep.methods || []).map((m) => `<div class="filler-method"><b>${esc(m.title)}</b>${esc(m.body)}</div>`).join("");
  const top = rep.top ? `出现最多的是「${esc(rep.top.word)}」。` : "";
  host.innerHTML = `<div class="filler-stats"><span>共 <b>${rep.total}</b> 次</span><span>约 <b>${rep.perMin}</b> 次/分钟</span><span>${top}</span></div>
    <ul class="filler-words">${words}</ul>
    ${methods}
    <p class="page-note">词表可在设置里增删。上面的改法针对这一次实际出现的词。</p>`;
  host.querySelectorAll("[data-jump]").forEach((b) => b.addEventListener("click", () => {
    const t = Number(b.getAttribute("data-jump"));
    if (Number.isFinite(t)) { stopReplayPlay(); seekReplay(t); }
  }));
}

function renderBoardStills(sess) {
  const host = $("board-stills");
  const note = $("board-stills-note");
  if (!host) return;
  const stills = sess.boardStills || [];
  if (!stills.length) {
    host.hidden = true;
    host.innerHTML = "";
    if (note) note.textContent = "目前不能认出黑板上的字。这一次没有采集到写板时的静帧。若有写板，会在手伸向板书区时留下板书区截图，供你自己看字迹；也能看到写完是否回视学生。";
    return;
  }
  if (note) note.textContent = "目前不能认出黑板上的字。下面是写板时截取的板书区画面，点一张可跳到该时刻，请自己判断字迹。";
  host.hidden = false;
  host.innerHTML = stills.map((s) => `<figure data-t="${s.t}"><img src="${s.dataUrl}" alt="板书区静帧"><figcaption>${fmt(s.t)}</figcaption></figure>`).join("");
  host.querySelectorAll("figure").forEach((fig) => fig.addEventListener("click", () => {
    const t = Number(fig.getAttribute("data-t"));
    if (Number.isFinite(t)) { stopReplayPlay(); seekReplay(t); }
  }));
}

function renderTranscript(sess) {
  const list = $("transcript-list");
  const empty = $("transcript-empty");
  if (!list) return;
  const lines = (sess.transcript || []).filter((x) => x.text);
  const fillers = (sess.settingsSnapshot && sess.settingsSnapshot.fillers) || getSettings().fillers;
  const sens = (sess.settingsSnapshot && sess.settingsSnapshot.sens && sess.settingsSnapshot.sens.filler) || "mid";
  if (!lines.length) {
    list.hidden = true;
    if (empty) {
      empty.hidden = false;
      empty.textContent = sess.kind === "demo"
        ? "演示样本的转写按讲稿生成，水词已标出。"
        : (sess.speechAvailable ? "这一次听写没有留下句子。可先点「试一下听写」；浏览器听写连不上时，可改用本机听写。" : "这一次没有可用的听写，口头禅无法统计。Chrome / Edge 的听写在中国大陆经常连不上厂商服务，即便网页已经打开。可在「设置」里下载本机听写（一次即可），之后不用联网也能转写。");
    }
    return;
  }
  if (empty) empty.hidden = true;
  list.hidden = false;
  list.innerHTML = lines.map((ln, i) =>
    `<li data-t="${ln.t}" data-i="${i}"><span class="tx-t">${fmt(ln.t)}</span><span class="tx-text">${highlightFillerHtml(ln.text, fillers, sens)}</span></li>`
  ).join("");
  list.querySelectorAll("li").forEach((li) => li.addEventListener("click", () => {
    const t = Number(li.dataset.t);
    if (Number.isFinite(t)) { stopReplayPlay(); seekReplay(t); }
    list.querySelectorAll("li").forEach((x) => x.classList.toggle("on", x === li));
  }));
}

async function renderDiagCompare(sess) {
  const host = $("diag-compare");
  host.hidden = true;
  if (!sess || sess.kind !== "camera") return;
  try {
    const list = (await listSessions()).filter((x) => x.kind === "camera" && x.id !== sess.id && x.startedAt < (sess.startedAt || Date.now()));
    const prev = list[0];
    if (!prev) return;
    const a = prev.metrics, b = metricsOf(sess);
    const keys = [["posture", "教态"], ["gaze", "视线落下"], ["filler", "口头禅"], ["board", "写板未回视"]];
    const cells = keys.map(([k, lab]) => {
      const da = a.perMin[k], db = b.perMin[k];
      const cls = db < da - 0.05 ? "better" : db > da + 0.05 ? "worse" : "same";
      const arrow = cls === "better" ? "↓" : cls === "worse" ? "↑" : "＝";
      return `<span class="dc ${cls}">${lab} ${a[k]}→${b[k]} ${arrow}</span>`;
    }).join("");
    host.innerHTML = `<p class="dc-title">和上一次（${esc(fmtShortDate(prev.startedAt))}）比 <a href="#/compare">详细对比</a></p><div class="dc-row">${cells}</div><p class="dc-note">箭头按每分钟次数比较，↓ 表示变少。</p>`;
    host.hidden = false;
  } catch (_) {}
}

function renderTimeline(sess) {
  const marks = $("timeline-marks");
  marks.innerHTML = "";
  const dur = Math.max(sess.duration, 0.1);
  for (const ev of sess.events) {
    const pin = document.createElement("span");
    pin.className = `mark-pin ${ev.kind}`;
    pin.style.left = `${(ev.t / dur) * 100}%`;
    pin.title = `${fmt(ev.t)} ${ev.label}`;
    marks.appendChild(pin);
  }
  const kinds = [["sway", "晃动"], ["posture", "教态"], ["gaze", "视线落下"], ["filler", "口头禅"], ["board", "写板未回视"]];
  const used = new Set(sess.events.map((e) => e.kind));
  $("timeline-legend").innerHTML = kinds
    .filter(([k]) => used.has(k) || k === "gaze" || k === "filler" || k === "board")
    .map(([k, lab]) => `<li><i class="${k}"></i>${lab}</li>`).join("");
}

function setPlayhead(t) {
  const dur = Math.max(session?.duration || 1, 0.1);
  const p = Math.max(0, Math.min(1, t / dur));
  $("timeline-fill").style.width = `${p * 100}%`;
  $("timeline-head").style.left = `${p * 100}%`;
  $("replay-clock").textContent = `${fmt(t)} / ${fmt(dur)}`;
  $("timeline").setAttribute("aria-valuenow", String(Math.round(t)));
}

/** Interpolate stored (5 fps) frames so replay skeletons move smoothly. */
function frameLerp(sess, t) {
  const fr = sess.frames;
  if (!fr.length) return null;
  let lo = 0, hi = fr.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (fr[m].t < t) lo = m + 1; else hi = m; }
  const b = fr[lo], a = fr[Math.max(0, lo - 1)];
  if (!sess.fromHistory || a === b || !a.pose || !b.pose || b.t - a.t > 1) return frameAt(sess, t);
  const u = Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t)));
  const pose = a.pose.map((p, i) => ({ x: p.x + (b.pose[i].x - p.x) * u, y: p.y + (b.pose[i].y - p.y) * u, v: Math.min(p.v, b.pose[i].v), visibility: Math.min(p.v, b.pose[i].v) }));
  const near = u < 0.5 ? a : b;
  return { ...near, pose };
}

function paintReplay(t) {
  if (!session) return;
  fitStage($("replay-stage"), replayAspect(session));
  const scene = $("replay-scene");
  const overlay = $("replay-overlay");
  const cap = $("replay-caption");
  if (session.kind === "demo") {
    resizeCanvasTo(scene, scene.clientWidth, scene.clientHeight);
    const { p } = sampleDemo(t);
    renderScene(scene.getContext("2d"), scene.width, scene.height, p, t);
    const c = captionAt(t);
    cap.hidden = !c;
    if (c) cap.textContent = c.text;
  } else cap.hidden = true;
  resizeCanvasTo(overlay, overlay.clientWidth, overlay.clientHeight);
  const fr = session.kind === "demo" ? frameAt(session, t) : frameLerp(session, t);
  const pose = fr?.pose || (session.kind === "demo" ? sampleDemo(t).pose : null);
  const gaze = fr?.gaze || (pose ? extractGaze(pose, null, null) : null);
  drawLiveOverlays(overlay.getContext("2d"), { pose, gaze, flags: fr?.flags || {}, onBoard: fr?.onBoard, hands: fr?.hands || null }, overlay.width, overlay.height, { showMap: true });
  setPlayhead(t);
}

function hasReplayVideo() {
  return session?.kind === "camera" && !!session.videoUrl;
}

function playReplay() {
  if (!session) return;
  playing = true;
  $("btn-play").classList.add("is-playing");
  $("btn-play-dock").textContent = "暂停";
  const video = $("replay-video");
  if (hasReplayVideo()) {
    if (replayCursor >= session.duration - 0.1) { try { video.currentTime = 0; } catch (_) {} }
    video.play().catch(() => {});
    const tick = () => {
      if (!playing) return;
      paintReplay(video.currentTime);
      if (video.ended || video.currentTime >= session.duration - 0.05) { stopReplayPlay(); paintReplay(session.duration); return; }
      replayRaf = requestAnimationFrame(tick);
    };
    replayRaf = requestAnimationFrame(tick);
  } else {
    if (replayCursor >= session.duration - 0.1) replayCursor = 0;
    const startWall = performance.now();
    const startT = replayCursor;
    const tick = () => {
      if (!playing) return;
      const t = Math.min(session.duration, startT + (performance.now() - startWall) / 1000);
      paintReplay(t);
      replayCursor = t;
      if (t >= session.duration) { stopReplayPlay(); return; }
      replayRaf = requestAnimationFrame(tick);
    };
    replayRaf = requestAnimationFrame(tick);
  }
}

function currentReplayTime() {
  const video = $("replay-video");
  if (hasReplayVideo() && video && !video.hidden) return video.currentTime || 0;
  return replayCursor;
}

function stopReplayPlay() {
  playing = false;
  cancelAnimationFrame(replayRaf);
  const video = $("replay-video");
  if (video && !video.paused) video.pause();
  $("btn-play").classList.remove("is-playing");
  $("btn-play").textContent = "播放";
  $("btn-play-dock").textContent = "播放";
}

function seekReplay(t) {
  if (!session) return;
  const tt = Math.max(0, Math.min(session.duration, t));
  replayCursor = tt;
  const video = $("replay-video");
  if (hasReplayVideo() && video.src) { try { video.currentTime = tt; } catch (_) {} }
  paintReplay(tt);
}

function timeFromPointer(ev) {
  const rect = $("timeline-track").getBoundingClientRect();
  const raw = ev.clientX ?? ev.touches?.[0]?.clientX;
  if (!Number.isFinite(raw) || !rect.width) return currentReplayTime();
  const t = Math.max(0, Math.min(1, (raw - rect.left) / rect.width)) * (session?.duration || 0);
  return Number.isFinite(t) ? t : currentReplayTime();
}

async function openStored(id) {
  try {
    const rec = await getSession(id);
    if (!rec) { toast("没有找到这条记录，可能已被删除。"); navigate("#/history"); return; }
    let sess;
    if (rec.kind === "demo") {
      if (!demoBaked) demoBaked = bakeDemoSession();
      sess = { ...demoBaked, id: rec.id, startedAt: rec.startedAt, stored: true, fromHistory: true, thumb: rec.thumb };
    } else {
      sess = fromRecord(rec);
      if (rec.hasVideo) {
        const blob = await getVideo(id).catch(() => null);
        if (blob) { sess.videoBlob = blob; sess.videoUrl = URL.createObjectURL(blob); }
      }
    }
    openReplay(sess);
  } catch (e) {
    toast("读取历史失败：" + (e && e.message || e));
    goCover();
  }
}

/* ——— Export / print ——— */

function stillCanvas() {
  const still = document.createElement("canvas");
  const ov = $("replay-overlay");
  still.width = ov.width || 720;
  still.height = ov.height || 1280;
  const ctx = still.getContext("2d");
  ctx.fillStyle = "#161410";
  ctx.fillRect(0, 0, still.width, still.height);
  if (!$("replay-scene").hidden) ctx.drawImage($("replay-scene"), 0, 0, still.width, still.height);
  else if (!$("replay-video").hidden) drawVideoInto($("replay-video"), session?.mirror)(ctx, still.width, still.height);
  ctx.drawImage(ov, 0, 0, still.width, still.height);
  return still;
}

async function doExport() {
  if (!session) return;
  const lic = getLicense();
  try {
    const blob = await exportSummary(session, stillCanvas(), { watermark: lic.features.reportWatermark });
    if (blob) {
      const url = URL.createObjectURL(blob);
      const touch = navigator.maxTouchPoints > 0;
      modal(`<p class="modal-title">小结图片已生成</p><p class="modal-sub">${touch ? "如果没有自动下载，请长按图片保存到相册。" : "已开始下载；也可以右键图片另存为。"}</p><img class="modal-img" src="${url}" alt="试讲小结">`,
        [{ label: "关闭", onClick: () => { setTimeout(() => URL.revokeObjectURL(url), 1000); } }]);
    }
  } catch (e) {
    console.warn(e);
    toast("小结图片生成失败");
  }
}

async function doPrint() {
  if (!session) return;
  const lic = getLicense();
  let trend = [];
  try {
    const list = (await listSessions()).filter((x) => x.kind === "camera" && x.startedAt <= (session.startedAt || Date.now()));
    if (session.kind === "camera") trend = trendPoints(list.slice(0, 10));
  } catch (_) {}
  let still = "";
  try { still = stillCanvas().toDataURL("image/jpeg", 0.85); } catch (_) { still = session.thumb || ""; }
  buildPrintReport(session, { stillDataUrl: still, watermark: lic.features.reportWatermark, trend });
  printReport();
}

/* ——— wiring ——— */

function showConsentIfNeeded() {
  if (hasAcceptedTerms()) return;
  const veil = $("consent-veil");
  if (!veil) return;
  veil.hidden = false;
  const box = $("consent-experience");
  if (box) box.checked = false;
  $("btn-consent-ok").addEventListener("click", () => {
    acceptTerms({ experience: !!(box && box.checked) });
    veil.hidden = true;
  }, { once: true });
}


function isTextEntry(el) {
  if (!el || el === document.body || el === document.documentElement) return false;
  const tag = (el.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (el.isContentEditable) return true;
  return false;
}

function onDocumentKey(e) {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  if (isTextEntry(e.target)) return;
  const modal = $("modal");
  if (modal && !modal.hidden) {
    if (e.key === "Escape") modal.hidden = true;
    return;
  }
  const veil = $("consent-veil");
  if (veil && !veil.hidden) return;

  const space = e.key === " " || e.key === "Spacebar";
  const enter = e.key === "Enter";

  // 电脑放在讲台上时，按空格即可开始 / 结束，不必走回去点按钮。
  if (mode === "coach" && (space || enter)) {
    const btn = $("btn-start-countdown");
    if (btn && !btn.disabled && !btn.hidden) {
      e.preventDefault();
      startCameraLive();
    }
    return;
  }

  if (mode === "camera" && space) {
    const pauseVeil = $("pause-veil");
    if (pauseVeil && !pauseVeil.hidden) return;
    e.preventDefault();
    const btn = $("btn-stop");
    if (btn && !btn.disabled) finishCamera();
  }
}

function onReady() {
  if (location.protocol === "file:") $("file-warning").hidden = false;
  showConsentIfNeeded();
  inspectSherpa().then(() => { setAsrStatusLabel($("coach-asr-state")); }).catch(() => {});
  maybeAutoDownload().catch(() => {});
  initDebug({ getVisionStatus: visionStatus, getEnv: envInfo, getSettings });
  window.__titaojingClassroom = {
    start: startClassroomSim,
    stop: stopClassroomSim,
    feed: feedClassroomSim,
    tick: tickClassroomSim,
    active: isSimActive,
    summarize: summarizeClassroomSim,
  };


  $("btn-dismiss-whats-new")?.addEventListener("click", () => {
    markVersionSeen();
    const box = $("whats-new");
    if (box) box.hidden = true;
  });
  $("btn-speech-preflight")?.addEventListener("click", async () => {
    const out = $("speech-preflight-result");
    const btn = $("btn-speech-preflight");
    if (btn) btn.disabled = true;
    const want = getSettings().asrEngine;
    const st = asrStatus();
    const useLocal = want !== "webspeech" && st.sherpa;
    let offer = $("speech-preflight-local");
    if (offer) offer.hidden = true;
    if (out) { out.hidden = false; out.textContent = useLocal ? "正在载入本机听写…" : "正在试听，请对着麦克风说一两句话…"; }
    let r = null;
    try {
      r = useLocal
        ? await preflightSherpa({ seconds: 5, onStatus: (x) => { if (out && x && x.reason) out.textContent = x.reason; } })
        : await preflightSpeech({ lang: getSettings().speechLang, seconds: 4 });
      if (out) out.textContent = r.reason;
    } catch (e) {
      if (out) out.textContent = "试听没能完成，请允许麦克风后再试。";
    }
    if (!useLocal && r && !r.ok && r.error !== "not-allowed" && st.sherpaSupported) {
      if (!offer) {
        offer = document.createElement("div");
        offer.id = "speech-preflight-local";
        out.insertAdjacentElement("afterend", offer);
      }
      offer.hidden = false;
      if (out) out.textContent = r.reason + " 可以改用本机听写：声音只在这台设备上识别，不需要连外网。";
      mountLocalAsr(offer, { compact: true, onReady: () => { setAsrStatusLabel($("coach-asr-state")); if (out) out.textContent = "本机听写已下载。再点一次「试一下听写」试试。"; } });
    }
    setAsrStatusLabel($("coach-asr-state"));
    if (mode === "coach" && micOn && getSettings().asrEngine !== "webspeech" && asrStatus().sherpa) prewarmSherpa(mediaStream);
    if (btn) btn.disabled = false;
  });
  $("btn-demo").addEventListener("click", () => navigate("#/demo"));
  $("btn-camera").addEventListener("click", () => navigate("#/try"));
  document.querySelectorAll("[data-go=cover]").forEach((b) => b.addEventListener("click", () => navigate("#/")));
  document.querySelectorAll("#screen-permission .seg-btn[data-facing]").forEach((b) => b.addEventListener("click", () => {
    const facing = b.dataset.facing;
    saveSettings({ facing, deviceId: "", mirror: facing === "user" });
    openPermission();
  }));
  document.querySelectorAll("#perm-session-mode .seg-btn").forEach((b) => b.addEventListener("click", () => {
    saveSettings({ sessionMode: b.dataset.session });
    openPermission();
  }));
  document.querySelectorAll("#perm-frame-mode .seg-btn").forEach((b) => b.addEventListener("click", () => {
    saveSettings({ frameMode: b.dataset.frame });
    openPermission();
  }));
  $("perm-save-video").addEventListener("change", (e) => saveSettings({ saveVideo: e.target.checked }));
  document.querySelectorAll("#perm-classroom-sim .seg-btn").forEach((b) => b.addEventListener("click", () => {
    saveSettings({ classroomSim: b.dataset.sim || "off" });
    openPermission();
  }));
  $("btn-allow-media").addEventListener("click", async () => {
    const ok = await requestMedia();
    if (ok) startCoach();
  });
  $("btn-err-retry").addEventListener("click", () => { stopEverything(); openPermission(); });
  $("btn-err-demo").addEventListener("click", () => navigate("#/demo"));
  $("btn-copy-url").addEventListener("click", async () => {
    const ok = await copyText($("err-url").value, $("err-url"));
    toast(ok ? "网址已复制，请到浏览器里粘贴打开" : "复制失败，请手动长按选择网址");
  });
  $("btn-coach-back").addEventListener("click", () => { releaseStream(); cancelAnimationFrame(raf); openPermission(); });
  $("btn-switch-cam").addEventListener("click", () => switchCamera(""));
  $("coach-device").addEventListener("change", (e) => switchCamera(e.target.value));
  $("coach-mirror").addEventListener("change", (e) => { saveSettings({ mirror: e.target.checked }); applyMirror(e.target.checked); });
  $("btn-model-retry").addEventListener("click", () => { resetVision(); watchModels(); initVision().then(watchModels); });
  $("btn-start-countdown").addEventListener("click", startCameraLive);
  $("btn-stop").addEventListener("click", () => {
    if (mode === "demo") finishDemo();
    else if (mode === "camera") finishCamera();
  });
  $("btn-skip-demo").addEventListener("click", finishDemo);
  $("btn-resume").addEventListener("click", resumeLive);
  $("btn-pause-finish").addEventListener("click", () => { paused = false; $("pause-veil").hidden = true; finishCamera(); });
  $("btn-replay-home").addEventListener("click", () => navigate("#/"));
  $("btn-rewatch").addEventListener("click", () => { seekReplay(0); playReplay(); });
  $("btn-retry").addEventListener("click", () => {
    if (session?.kind === "camera") navigate("#/try");
    else { setHashSilently("#/demo"); startDemo(); }
  });
  $("btn-export").addEventListener("click", doExport);
  $("btn-print").addEventListener("click", doPrint);
  $("btn-save-video").addEventListener("click", async () => {
    if (!session?.videoBlob || !session.id) return;
    try {
      await putVideo(session.id, session.videoBlob);
      const rec = await getSession(session.id);
      if (rec) await putSession({ ...rec, hasVideo: true, videoSize: session.videoBlob.size, videoType: session.videoBlob.type });
      session.hasVideo = true;
      requestPersist();
      toast("录像已存入本机历史");
      $("save-status").innerHTML = `已保存到本机历史（含录像）。 <a href="#/history">查看历史</a>`;
    } catch (e) {
      toast("空间不足，录像没能保存");
    }
    updateSaveVideoBtn();
  });
  const togglePlay = () => { if (playing) stopReplayPlay(); else playReplay(); };
  $("btn-play").addEventListener("click", togglePlay);
  $("btn-play-dock").addEventListener("click", togglePlay);

  const tl = $("timeline");
  let dragging = false;
  tl.addEventListener("pointerdown", (e) => { try { tl.setPointerCapture(e.pointerId); } catch (_) {} dragging = true; stopReplayPlay(); seekReplay(timeFromPointer(e)); });
  tl.addEventListener("pointermove", (e) => { if (dragging) seekReplay(timeFromPointer(e)); });
  tl.addEventListener("pointerup", () => { dragging = false; });
  tl.addEventListener("pointercancel", () => { dragging = false; });
  tl.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") seekReplay(currentReplayTime() - 1);
    if (e.key === "ArrowRight") seekReplay(currentReplayTime() + 1);
    if (e.key === " ") { e.preventDefault(); togglePlay(); }
  });

  $("btn-install").addEventListener("click", promptInstall);
  wirePages();
  $("modal").addEventListener("click", (e) => { if (e.target === $("modal")) $("modal").hidden = true; });
  document.addEventListener("keydown", onDocumentKey);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && mode === "camera") pauseLive();
    if (document.visibilityState === "hidden" && mode === "demo") { /* demo keeps its wall clock; fine */ }
  });
  window.addEventListener("pagehide", () => { if (mode === "camera") pauseLive(); });

  window.addEventListener("resize", () => {
    if (mode === "replay") { sizeReplayWrap(session); paintReplay(currentReplayTime()); }
  });

  initPwa({
    onUpdateReady: (apply) => {
      $("update-bar").hidden = false;
      $("btn-update").onclick = () => { if (mode === "camera") { toast("请先结束这次试讲再更新"); return; } apply(); };
    },
  });
  onPwaChange(() => { if (mode === "cover") renderCover(); });

  try { demoBaked = bakeDemoSession(); } catch (e) { console.warn("demo bake failed", e); }

  window.addEventListener("hashchange", route);
  logEvent("boot", `v${APP_VERSION}`);
  route();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", onReady);
else onReady();
