/**
 * 本机中文识别（sherpa-onnx WASM）入口。
 *
 * 当前版本不会假装已经能转写：即使检测到清单和模型文件，
 * startSherpa() 也会如实说明接入尚未完成，并让 asr.js 回退到浏览器听写。
 *
 * 模型体积大，不要提交进 git。请用 `npm run fetch-asr` 下载（或从对象存储用 ASR_MIRROR），
 * 文件放到 assets/asr/，并由浏览器缓存。CI 不下载模型，没有模型时本模块返回不可用。
 *
 * 详见 docs/ASR.md。
 */
const MANIFEST = "assets/asr/manifest.json";

let cached = null; // { ok, detail, manifest, filesOk }

export function sherpaAvailable() {
  if (cached) return cached;
  return { ok: false, detail: "未检测（请先调用 inspectSherpa）", filesOk: false };
}

/** 异步检查本地资源。应用启动时调用一次即可。 */
export async function inspectSherpa() {
  try {
    const res = await fetch(MANIFEST, { cache: "no-cache" });
    if (!res.ok) {
      cached = { ok: false, filesOk: false, detail: "尚未安装本机识别模型（assets/asr/ 不存在）" };
      return cached;
    }
    const mf = await res.json();
    if (mf.status === "scaffold" || !Array.isArray(mf.files) || !mf.files.length) {
      cached = { ok: false, filesOk: false, detail: "本机识别仍在准备中（尚未接入可用模型）", manifest: mf };
      return cached;
    }
    const missing = [];
    for (const f of mf.files || []) {
      const r = await fetch(f, { method: "HEAD", cache: "no-cache" }).catch(() => null);
      if (!r || !r.ok) missing.push(f);
    }
    if (missing.length) {
      cached = { ok: false, filesOk: false, detail: "本机识别模型不完整：" + missing.join(", "), manifest: mf };
      return cached;
    }
    // 文件齐全也不等于已经能转写：接入尚未完成。
    cached = {
      ok: false,
      filesOk: true,
      detail: "已找到本机识别文件，但当前版本还没有真正跑起来，仍会使用浏览器听写。详见「关于与隐私」。",
      manifest: mf,
    };
  } catch (e) {
    cached = { ok: false, filesOk: false, detail: "无法检查本机识别资源" };
  }
  return cached;
}

/**
 * 诚实实现：即便模型文件已下载，当前版本也不会开始本机转写。
 * 真正接入 WASM 后，再在这里创建识别会话，把结果通过 onTranscript / onFiller 送出。
 */
export function startSherpa(opts = {}) {
  const { onStatus } = opts;
  const st = sherpaAvailable();
  onStatus && onStatus({
    ok: false,
    engine: "sherpa-pending",
    message: st.filesOk
      ? "已检测到本机识别文件，但当前版本尚未完成接入，已改用浏览器听写。声音可能经过浏览器厂商的服务。详见「关于与隐私」。"
      : ("本机听写还不能用：" + (st.detail || "尚未安装模型") + "。已改用浏览器听写（若浏览器支持）。"),
  });
  return { stop() {}, pause() {}, resume() {}, supported: false, engine: "sherpa-pending" };
}
