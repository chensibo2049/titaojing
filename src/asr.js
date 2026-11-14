/**
 * 转写入口：优先本机识别（sherpa-onnx，需先 npm run fetch-asr），否则用浏览器听写。
 * 回放页展示完整转写，并用水词词表标亮。详见 docs/ASR.md。
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
  };
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
