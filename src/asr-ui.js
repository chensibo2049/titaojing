/** 本机听写下载的界面小部件：按钮 + 进度条，在设置页、听写失败横幅和讲前「试一下听写」处共用。 */
import { downloadModel, deleteModel, loadAsrManifest, modelSizeLabel } from "./asr-model.js";
import { inspectSherpa, sherpaAvailable } from "./asr-sherpa.js";

let running = null; // 同一时间只下载一份
const listeners = new Set();

export function onLocalAsrChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(state) { for (const fn of listeners) { try { fn(state); } catch (_) {} } }

const mb = (b) => (b / 1048576).toFixed(1);

export async function localAsrButtonLabel() {
  const mf = await loadAsrManifest();
  return `下载本机听写（${modelSizeLabel(mf)}，一次即可）`;
}

/** 开始下载（若已在下载则复用）。onProgress({loaded,total,mirror})。返回下载结果。 */
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

export async function removeLocalModel() {
  await deleteModel();
  await inspectSherpa();
  emit({ phase: "deleted" });
}

/**
 * 在 host 元素里渲染：状态文字、下载 / 删除按钮、进度条。
 * opts.onReady(result)：下载完成后回调。opts.compact：横幅里用的紧凑样式。
 */
export async function mountLocalAsr(host, opts = {}) {
  if (!host) return;
  const mf = await loadAsrManifest();
  const size = modelSizeLabel(mf);
  host.classList.add("local-asr");
  if (opts.compact) host.classList.add("compact");
  const render = () => {
    const st = sherpaAvailable();
    if (running) return;
    if (st.ok) {
      host.innerHTML = opts.compact
        ? `<span class="la-text">本机听写已下载。</span>`
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
    host.innerHTML = `${opts.compact ? "" : `<span class="la-text">本机听写：需下载 ${size}（识别引擎和中文模型），下载一次后存在这台设备的浏览器缓存里，之后不用联网，声音也不离开设备。依次尝试魔搭 ModelScope、hf-mirror.com、Hugging Face。</span>`}
      <button type="button" class="btn-mini la-get">下载本机听写（${size}，一次即可）</button>`;
    host.querySelector(".la-get").addEventListener("click", () => go());
  };
  const go = async () => {
    host.innerHTML = `<span class="la-text la-msg">正在连接下载源…</span>
      <div class="la-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i style="width:0%"></i></div>
      <button type="button" class="btn-mini la-cancel">取消</button>`;
    const bar = host.querySelector(".la-bar i"), msg = host.querySelector(".la-msg"), barWrap = host.querySelector(".la-bar");
    host.querySelector(".la-cancel").addEventListener("click", () => cancelLocalDownload());
    const onP = (p) => {
      if (p.phase !== "progress") return;
      const pct = p.total ? Math.min(100, (p.loaded / p.total) * 100) : 0;
      bar.style.width = pct.toFixed(1) + "%";
      barWrap.setAttribute("aria-valuenow", pct.toFixed(0));
      msg.textContent = `正在下载本机听写：${mb(p.loaded)} / ${mb(p.total)} MB（${pct.toFixed(0)}%，来源：${p.mirror || "…"}）`;
    };
    const r = await startLocalDownload(onP);
    listeners.delete(onP);
    if (r.ok) {
      host.innerHTML = `<span class="la-text">已下载并校验（来源：${escapeHtml(r.mirror)}）。${opts.compact ? "" : "下次试讲会自动使用本机听写。"}</span>`;
      opts.onReady && opts.onReady(r);
      setTimeout(render, opts.compact ? 4000 : 2500);
    } else {
      host.innerHTML = `<span class="la-text la-err">下载没有完成：${escapeHtml(r.error || "未知原因")}。可以稍后再试；已下载的部分不会作数，模型校验通过才会启用。</span>
        <button type="button" class="btn-mini la-get">重试</button>`;
      host.querySelector(".la-get").addEventListener("click", () => go());
    }
  };
  if (running) {
    go();
  } else render();
  return { render };
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
