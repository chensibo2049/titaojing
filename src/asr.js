/**
 * 转写入口：若本机识别真正可用则优先使用，否则用浏览器听写。
 * 当前版本本机识别尚未接入，startSherpa 会如实回退。详见 docs/ASR.md。
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
    webspeech,
    preferred: sherpa.ok ? "sherpa" : webspeech ? "webspeech" : "none",
    local: sherpa.ok,
    sherpaFiles: !!sherpa.filesOk,
  };
}

export function describeAsrEngine(engine, status = asrStatus()) {
  if (engine === "sherpa" && status.sherpa) return { key: "sherpa", label: "本机听写", detail: "声音留在这台设备，不经过沉思波，也不经过浏览器厂商。" };
  if (engine === "webspeech" || (engine !== "none" && status.webspeech)) {
    return { key: "webspeech", label: "浏览器听写", detail: "Chrome / Edge 会把声音送到厂商的语音服务，不经过沉思波。在中国大陆即使网页能打开，听写也经常连不上。" };
  }
  if (status.sherpaFiles) return { key: "unavailable", label: "本机听写尚未接入", detail: "已找到模型文件，但当前版本还不能用它转写。" };
  return { key: "unavailable", label: "听写不可用", detail: status.sherpaDetail || "当前浏览器没有网页听写，本机听写也尚未接入。" };
}


/** 开始转写。engine: auto | sherpa | webspeech。返回与 startSpeech 相同的控制句柄，外加 engine 字段。 */
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
        message: "本机识别还没有准备好（模型未下载）。已改用浏览器听写。说明见「关于与隐私」和 docs/ASR.md。",
      });
    }
  }
  const h = startSpeech(opts);
  h.engine = h.supported ? "webspeech" : "none";
  return h;
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
