/**
 * 本机中文识别（sherpa-onnx WASM）脚手架。
 *
 * 当前版本不会自动下载模型（SenseVoice / zipformer 量化后通常几十 MB）。
 * 准备好资源后（见 docs/ASR.md 与 scripts/fetch-asr.mjs），把文件放到
 *   assets/asr/sherpa-onnx-wasm.js
 *   assets/asr/encoder.onnx（或清单里写明的文件名）
 * 本模块即可在启动时被 asr.js 选中，声音不再经过浏览器厂商的在线服务。
 *
 * 没有资源时 sherpaAvailable() 返回 { ok: false }，asr.js 会回退到 Web Speech。
 */
const MANIFEST = "assets/asr/manifest.json";

let cached = null; // { ok, detail, manifest }

export function sherpaAvailable() {
  if (cached) return cached;
  return { ok: false, detail: "未检测（请先调用 inspectSherpa）" };
}

/** 异步检查本地资源。应用启动时调用一次即可。 */
export async function inspectSherpa() {
  try {
    const res = await fetch(MANIFEST, { cache: "no-cache" });
    if (!res.ok) {
      cached = { ok: false, detail: "尚未安装本机识别模型（assets/asr/ 不存在）" };
      return cached;
    }
    const mf = await res.json();
    if (mf.status === "scaffold" || !Array.isArray(mf.files) || !mf.files.length) {
      cached = { ok: false, detail: "本机识别仍是脚手架（尚未接入模型）", manifest: mf };
      return cached;
    }
    const missing = [];
    for (const f of mf.files || []) {
      const r = await fetch(f, { method: "HEAD", cache: "no-cache" }).catch(() => null);
      if (!r || !r.ok) missing.push(f);
    }
    cached = missing.length
      ? { ok: false, detail: "本机识别模型不完整：" + missing.join(", "), manifest: mf }
      : { ok: true, detail: mf.label || "sherpa-onnx", manifest: mf };
  } catch (e) {
    cached = { ok: false, detail: "无法检查本机识别资源" };
  }
  return cached;
}

/**
 * 占位实现：资源齐全时仍给出明确提示，避免假装已经能转写。
 * 接入 WASM 后，在这里创建识别会话，把结果通过 onTranscript / onFiller 送出，
 * 接口与 startSpeech 保持一致。
 */
export function startSherpa(opts = {}) {
  const { onStatus } = opts;
  const st = sherpaAvailable();
  onStatus && onStatus({
    ok: false,
    message: st.ok
      ? "本机识别模块已检测到模型，但当前版本的接入还在脚手架阶段，已回退到浏览器听写。详见 docs/ASR.md。"
      : (st.detail || "本机识别不可用"),
  });
  return { stop() {}, pause() {}, resume() {}, supported: false, engine: "sherpa-pending" };
}
