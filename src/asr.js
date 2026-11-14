/**
 * 转写入口：本机听写（sherpa-onnx WASM，声音不离开设备）优先；
 * 模型没下载时用浏览器听写，浏览器听写报「网络」失败时立刻切到本机（若模型已缓存），
 * 否则在状态里带上 offerLocal，让页面提示下载。详见 docs/ASR.md。
 */
import { startSpeech, speechSupported } from "./speech.js";
import { sherpaAvailable, startSherpa } from "./asr-sherpa.js";
import { FILLERS, SINGLE_CHAR_FILLERS, buildFillerRe } from "./constants.js";

export function asrStatus() {
  const sherpa = sherpaAvailable();
  const webspeech = speechSupported();
  return {
    sherpa: sherpa.ok,
    sherpaDetail: sherpa.detail,
    sherpaSupported: sherpa.supported !== false,
    sherpaSize: sherpa.sizeLabel || "约 80 MB",
    webspeech,
    preferred: sherpa.ok ? "sherpa" : webspeech ? "webspeech" : "none",
    local: sherpa.ok,
    sherpaFiles: !!sherpa.filesOk,
  };
}

export function describeAsrEngine(engine, status = asrStatus()) {
  if (engine === "sherpa") {
    if (status.sherpa) return { key: "sherpa", label: "本机听写", detail: "声音只在这台设备上识别，不经过沉思波，也不经过浏览器厂商。" };
    return { key: "unavailable", label: "本机听写未下载", detail: status.sherpaDetail || "需要先下载中文模型（一次即可）。" };
  }
  if (engine === "webspeech" || (engine !== "none" && status.webspeech)) {
    return { key: "webspeech", label: "浏览器听写", detail: "Chrome / Edge 会把声音送到厂商的语音服务，不经过沉思波。在中国大陆即使网页能打开，听写也经常连不上；可改用本机听写。" };
  }
  if (status.sherpaSupported) return { key: "unavailable", label: "听写未就绪", detail: `下载本机听写（${status.sherpaSize}，一次即可）后，不用联网也能转写。` };
  return { key: "unavailable", label: "听写不可用", detail: status.sherpaDetail || "当前浏览器没有网页听写，也不能运行本机听写。" };
}

/** 开始转写。engine: auto | sherpa | webspeech。返回控制句柄（stop/pause/resume，engine 字段随切换更新）。 */
export function startAsr(opts = {}) {
  const want = opts.engine || "auto";
  const st = asrStatus();
  if (want === "sherpa" || (want === "auto" && st.sherpa)) {
    if (st.sherpa) {
      const h = startSherpa(opts);
      h.engine = "sherpa";
      return h;
    }
    if (want === "sherpa") {
      opts.onStatus && opts.onStatus({
        ok: false,
        engine: "sherpa",
        sticky: true,
        offerLocal: true,
        message: `已选择「仅本机听写」，但中文模型还没下载（${st.sherpaSize}，一次即可）。这次不统计口头禅；教态和视线仍在分析。`,
      });
      return { stop() {}, pause() {}, resume() {}, supported: false, engine: "none" };
    }
  }
  // 浏览器听写；auto 模式下遇到网络失败，就地切到本机听写
  let inner = null;
  let switched = false;
  const proxy = {
    supported: true,
    engine: "webspeech",
    pause() { inner && inner.pause(); },
    resume() { inner && inner.resume(); },
    stop(...a) { return inner && inner.stop(...a); },
    switchToLocal() {
      if (switched) return false;
      switched = true;
      try { inner && inner.stop(); } catch (_) {}
      inner = startSherpa(opts);
      proxy.engine = "sherpa";
      proxy.ready = inner.ready;
      return true;
    },
  };
  const onStatus = (s) => {
    if (switched) return;
    if (s && s.ok === false && s.engine === "webspeech" && (s.networkFails || /网络|连不上/.test(s.message || ""))) {
      if (want === "auto" && asrStatus().sherpa) {
        opts.onStatus && opts.onStatus({ ok: true, engine: "sherpa", message: "浏览器听写连不上，已改用本机听写（声音只在这台设备上识别）。", switched: true });
        proxy.switchToLocal();
        return;
      }
      if (asrStatus().sherpaSupported) s = { ...s, offerLocal: true };
    }
    if (s && s.ok === false && s.engine === "none" && asrStatus().sherpaSupported && !asrStatus().sherpa) s = { ...s, offerLocal: true };
    opts.onStatus && opts.onStatus(s);
  };
  inner = startSpeech({ ...opts, onStatus });
  proxy.supported = inner.supported;
  proxy.engine = inner.supported ? "webspeech" : "none";
  return proxy;
}

export function fillerList(fillers, sensitivity = "mid") {
  let list = fillers && fillers.length ? fillers.slice() : FILLERS.slice();
  if (sensitivity === "low") list = list.filter((w) => !SINGLE_CHAR_FILLERS.includes(w));
  return list;
}

/** 在纯文本里找出水词出现的区间（按词长优先）。 */
export function findFillerSpans(text, fillers, sensitivity = "mid") {
  const list = fillerList(fillers, sensitivity).slice().sort((a, b) => b.length - a.length);
  const re = buildFillerRe(list);
  if (!re || !text) return [];
  const spans = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text))) {
    spans.push({ start: m.index, end: m.index + m[0].length, word: m[1] || m[0] });
  }
  return spans;
}

/** 把一段转写转成带 <mark> 的安全 HTML。 */
export function highlightFillerHtml(text, fillers, sensitivity = "mid") {
  const raw = String(text || "");
  const spans = findFillerSpans(raw, fillers, sensitivity);
  if (!spans.length) return escapeHtml(raw);
  let html = "", i = 0;
  for (const s of spans) {
    if (s.start < i) continue;
    html += escapeHtml(raw.slice(i, s.start));
    html += `<mark class="shuici">${escapeHtml(raw.slice(s.start, s.end))}</mark>`;
    i = s.end;
  }
  return html + escapeHtml(raw.slice(i));
}

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
