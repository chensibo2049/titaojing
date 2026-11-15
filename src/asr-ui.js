/** 本机听写下载：默认由用户点选；已开启自动下载的用户进入后后台开始（模块单例，换页不中断）。 */
import { downloadModel, deleteModel, loadAsrManifest, modelSizeLabel, modelCached, engineSupported, pendingModelRequests, importBackgroundStash } from "./asr-model.js";
import { inspectSherpa, sherpaAvailable } from "./asr-sherpa.js";
import { getSettings } from "./settings.js";

let running = null; // 同一时间只下载一份（含 abort）
const listeners = new Set();

export function onLocalAsrChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(state) {
  lastState = state;
  for (const fn of listeners) { try { fn(state); } catch (_) {} }
  renderChip(state);
}

let lastState = { phase: "idle" };

const mb = (b) => (b / 1048576).toFixed(1);

export async function localAsrButtonLabel() {
  const mf = await loadAsrManifest();
  return `下载本机听写（${modelSizeLabel(mf)}，一次即可）`;
}

export function startLocalDownload(onProgress) {
  if (onProgress) listeners.add(onProgress);
  if (!running) {
    const ctl = new AbortController();
    running = downloadModel({ signal: ctl.signal, onProgress: (p) => emit({ phase: "progress", ...p }) })
      .then(async (r) => {
        await inspectSherpa();
        emit({ phase: r.ok ? "done" : "error", ...r });
        return r;
      })
      .finally(() => { running = null; });
    running.abort = () => ctl.abort();
  }
  return running;
}

export function cancelLocalDownload() { if (running && running.abort) running.abort(); }
export function localDownloadRunning() { return !!running; }
export function localDownloadState() { return lastState; }

export async function removeLocalModel() {
  await deleteModel();
  await inspectSherpa();
  emit({ phase: "deleted" });
}

/** 未开启自动下载、省流量或测试参数时，不自动开始新下载。 */
export function autoDownloadBlockedReason() {
  try {
    const q = new URLSearchParams(location.search);
    if (q.has("noasrdl") || q.has("smoke")) return "test";
  } catch (_) {}
  if (typeof window !== "undefined" && window.__TITAOJING_NO_ASR_DL) return "test";
  const s = getSettings();
  if (s.asrAutoDownload === false) return "off";
  try {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (c && c.saveData) return "saveData";
  } catch (_) {}
  return "";
}

const BF_ID = "titaojing-asr-model";

async function getRegistration() {
  if (!("serviceWorker" in navigator)) return null;
  try { return await navigator.serviceWorker.ready; } catch (_) { return null; }
}

async function adoptBackgroundFetch() {
  const reg = await getRegistration();
  if (!reg || !reg.backgroundFetch) return null;
  try {
    const rec = await reg.backgroundFetch.get(BF_ID);
    return rec || null;
  } catch (_) { return null; }
}

async function startBackgroundFetch() {
  const reg = await getRegistration();
  if (!reg || !reg.backgroundFetch) return null;
  try {
    const existing = await reg.backgroundFetch.get(BF_ID);
    if (existing) return existing;
    const { files } = await pendingModelRequests();
    if (!files.length) return null;
    const urls = files.map((f) => f.urls[0]).filter(Boolean);
    if (!urls.length) return null;
    const total = files.reduce((a, f) => a + (f.bytes || 0), 0);
    return await reg.backgroundFetch.fetch(BF_ID, urls, {
      title: "体态镜听写包",
      downloadTotal: total,
      icons: [{ src: "assets/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    });
  } catch (_) {
    return null;
  }
}

function watchBackgroundFetch(rec) {
  if (!rec) return;
  const update = () => {
    try {
      const loaded = rec.downloaded || 0;
      const total = rec.downloadTotal || 0;
      emit({ phase: "progress", loaded, total, mirror: "后台继续", file: "", mode: "background" });
    } catch (_) {}
  };
  update();
  rec.addEventListener("progress", update);
  rec.addEventListener("onprogress", update);
}

/** 进入应用时调用：已缓存则静默；已有后台任务可继续，新下载须用户开启自动下载。 */
export async function maybeAutoDownload() {
  ensureChip();
  try { await importBackgroundStash(); } catch (_) {}
  if (!engineSupported()) {
    emit({ phase: "unsupported" });
    return { started: false, reason: "unsupported" };
  }
  const st = await modelCached();
  await inspectSherpa();
  if (st.cached) {
    emit({ phase: "ready" });
    hideChipSoon();
    return { started: false, reason: "cached" };
  }
  const bf = await adoptBackgroundFetch();
  if (bf) {
    watchBackgroundFetch(bf);
    // 已有后台任务可以继续；只有已开启自动下载时才并行启动页面下载。
    if (!running && !autoDownloadBlockedReason()) startLocalDownload();
    return { started: true, reason: "background-fetch" };
  }
  const why = autoDownloadBlockedReason();
  if (why) {
    emit({ phase: "idle", blocked: why });
    return { started: false, reason: why };
  }
  startLocalDownload();
  return { started: true, reason: "auto" };
}

function onPageHide() {
  if (!running) return;
  startBackgroundFetch();
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", onPageHide);
}

/**
 * 在 host 元素里渲染：状态文字、下载 / 删除按钮、进度条。
 * 设置页使用完整说明；不再在横幅里弹出大块下载框。
 */
export async function mountLocalAsr(host, opts = {}) {
  if (!host) return;
  const mf = await loadAsrManifest();
  const size = modelSizeLabel(mf);
  host.classList.add("local-asr");
  if (opts.compact) host.classList.add("compact");
  const render = () => {
    const st = sherpaAvailable();
    if (running) {
      paintProgress(host, lastState);
      return;
    }
    if (st.ok) {
      host.innerHTML = opts.compact
        ? `<span class="la-text">本机听写已就绪。</span>`
        : `<span class="la-text">本机听写已就绪（${escapeHtml(mf && mf.model ? mf.model.label : "中文模型")}，${size}）。声音只在这台设备上识别，可离线使用。</span>
           <button type="button" class="btn-mini la-del">删除模型</button>`;
      const del = host.querySelector(".la-del");
      if (del) del.addEventListener("click", async () => { del.disabled = true; await removeLocalModel(); render(); opts.onChange && opts.onChange(); });
      return;
    }
    if (st.supported === false) {
      host.innerHTML = `<span class="la-text">${escapeHtml(st.detail || "这个浏览器不能运行本机听写。")}</span>`;
      return;
    }
    const blocked = autoDownloadBlockedReason();
    const autoHint = blocked === "saveData"
      ? "当前开了省流量，不会自动下载；需要时可点按钮下载。"
      : blocked === "off"
        ? "默认不自动下载；需要时可点按钮下载，或在设置里开启自动下载。"
        : "已开启自动下载，进入页面后会在后台下载，不影响浏览。";
    host.innerHTML = `${opts.compact ? "" : `<span class="la-text">本机听写：需下载 ${size}（识别引擎和中文模型）。下载一次后存在这台设备的浏览器缓存里，之后不用联网，声音也不离开设备。依次尝试魔搭 ModelScope、hf-mirror.com、Hugging Face。${autoHint}</span>`}
      <button type="button" class="btn-mini la-get">${blocked === "saveData" || blocked === "off" ? `点此下载听写包（${size}）` : `下载本机听写（${size}，一次即可）`}</button>`;
    host.querySelector(".la-get").addEventListener("click", () => go());
  };
  const go = async () => {
    paintProgress(host, { phase: "progress", loaded: 0, total: 0, mirror: "" });
    const onP = (p) => { if (p.phase === "progress") paintProgress(host, p); };
    const r = await startLocalDownload(onP);
    listeners.delete(onP);
    if (r.ok) {
      host.innerHTML = `<span class="la-text">已下载并校验（来源：${escapeHtml(r.mirror)}）。${opts.compact ? "" : "下次试讲会自动使用本机听写。"}</span>`;
      opts.onReady && opts.onReady(r);
      setTimeout(render, opts.compact ? 4000 : 2500);
    } else {
      host.innerHTML = `<span class="la-text la-err">下载没有完成：${escapeHtml(r.error || "未知原因")}。可以稍后再试；已下完并校验通过的文件会保留，其余分段下次接着下。</span>
        <button type="button" class="btn-mini la-get">重试</button>`;
      host.querySelector(".la-get").addEventListener("click", () => go());
    }
  };
  const un = onLocalAsrChange((p) => {
    if (p.phase === "progress" && running) paintProgress(host, p);
    else if (p.phase === "done" || p.phase === "deleted" || p.phase === "ready") render();
  });
  if (running) paintProgress(host, lastState);
  else render();
  return { render, unbind: un };
}

function paintProgress(host, p) {
  if (!host) return;
  let bar = host.querySelector(".la-bar i");
  let msg = host.querySelector(".la-msg");
  let barWrap = host.querySelector(".la-bar");
  if (!bar) {
    host.innerHTML = `<span class="la-text la-msg">正在连接下载源…</span>
      <div class="la-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i style="width:0%"></i></div>
      <button type="button" class="btn-mini la-cancel">取消</button>`;
    bar = host.querySelector(".la-bar i");
    msg = host.querySelector(".la-msg");
    barWrap = host.querySelector(".la-bar");
    const cancel = host.querySelector(".la-cancel");
    if (cancel) cancel.addEventListener("click", () => cancelLocalDownload());
  }
  const pct = p.total ? Math.min(100, (p.loaded / p.total) * 100) : 0;
  bar.style.width = pct.toFixed(1) + "%";
  barWrap.setAttribute("aria-valuenow", pct.toFixed(0));
  const src = p.mirror ? `，来源：${p.mirror}` : "";
  msg.textContent = p.total
    ? `正在下载听写包：${mb(p.loaded)} / ${mb(p.total)} MB（${pct.toFixed(0)}%${src}）`
    : "正在连接下载源…";
}

function ensureChip() {
  if (typeof document === "undefined") return null;
  let el = document.getElementById("asr-dl-chip");
  if (el) return el;
  el = document.createElement("div");
  el.id = "asr-dl-chip";
  el.className = "asr-dl-chip";
  el.hidden = true;
  document.body.appendChild(el);
  return el;
}

let hideTimer = 0;
function hideChipSoon() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    const el = document.getElementById("asr-dl-chip");
    if (el && (lastState.phase === "ready" || lastState.phase === "done")) el.hidden = true;
  }, 3200);
}

function renderChip(state = lastState) {
  const el = ensureChip();
  if (!el) return;
  const st = sherpaAvailable();
  clearTimeout(hideTimer);
  if (state.phase === "unsupported") { el.hidden = true; return; }
  if (state.phase === "ready" || (st.ok && state.phase !== "progress" && state.phase !== "error")) {
    el.hidden = false;
    el.innerHTML = `<button type="button" class="asr-dl-chip-btn" id="asr-dl-chip-btn">听写已就绪</button>`;
    hideChipSoon();
    return;
  }
  if (state.phase === "progress") {
    const pct = state.total ? Math.min(100, Math.round((state.loaded / state.total) * 100)) : 0;
    el.hidden = false;
    el.innerHTML = `<button type="button" class="asr-dl-chip-btn" id="asr-dl-chip-btn" aria-live="polite">
      <span class="asr-dl-chip-label">听写包 ${pct}%</span>
      <span class="asr-dl-chip-bar" aria-hidden="true"><i style="width:${pct}%"></i></span>
    </button>`;
    return;
  }
  if (state.phase === "error") {
    el.hidden = false;
    el.innerHTML = `<button type="button" class="asr-dl-chip-btn" id="asr-dl-chip-btn">听写包未完成，点此重试</button>`;
    el.querySelector("button").addEventListener("click", () => startLocalDownload());
    return;
  }
  const blocked = state.blocked || autoDownloadBlockedReason();
  if (blocked === "test") { el.hidden = true; return; }
  if (blocked === "saveData" || blocked === "off") {
    el.hidden = false;
    const label = blocked === "saveData" ? "省流量已开，点此下载听写包" : "点此下载听写包";
    el.innerHTML = `<button type="button" class="asr-dl-chip-btn" id="asr-dl-chip-btn">${label}</button>`;
    el.querySelector("button").addEventListener("click", () => startLocalDownload());
    return;
  }
  el.hidden = true;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

if (typeof navigator !== "undefined" && navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener("message", (ev) => {
    if (ev.data && ev.data.type === "ASR_BF_DONE") {
      importBackgroundStash().then(async (r) => {
        if (r && r.done) { await inspectSherpa(); emit({ phase: "done", ok: true, mirror: "后台下载" }); }
      }).catch(() => {});
    }
  });
}
