/**
 * 本机听写模型：按需下载、校验、缓存。
 *
 * - 引擎（sherpa-onnx WASM，约 12 MB）随网站一起发布，在 assets/asr/engine/。
 * - 中文识别模型（约 78 MB，连同引擎一共约 90 MB）不进 git：第一次点「下载本机听写」时，
 *   依次尝试 ModelScope（魔搭）、hf-mirror.com、Hugging Face，分段下载（断了可续），
 *   校验 sha256 后存进浏览器的 Cache Storage，只需下载一次。
 * - 部署方可在 config.js 里填 asrModelBase（自己的对象存储目录，需允许跨域），会排在最前面。
 */
const MANIFEST = "assets/asr/manifest.json";
const CHUNK = 4 * 1024 * 1024;

let manifestPromise = null;

export function loadAsrManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(MANIFEST, { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((mf) => {
        if (!mf) manifestPromise = null;
        return mf;
      });
  }
  return manifestPromise;
}

export function modelCacheName(mf) {
  return "titaojing-asr-model-" + ((mf && mf.model && mf.model.id) || "none");
}

function keyFor(mf, file) {
  return new URL(`asr-model/${mf.model.id}/${file.as || file.name}`, location.href).href;
}
function doneKey(mf) {
  return new URL(`asr-model/${mf.model.id}/done.json`, location.href).href;
}

export function modelBytes(mf) {
  return ((mf && mf.model && mf.model.files) || []).reduce((a, f) => a + (f.bytes || 0), 0);
}

export function modelSizeLabel(mf) {
  const b = modelBytes(mf) + (((mf && mf.engineFiles && mf.engineFiles.files) || []).reduce((a, f) => a + (f.bytes || 0), 0));
  return b ? `约 ${Math.round(b / 1048576)} MB` : "约 80 MB";
}

export function engineSupported() {
  return typeof window !== "undefined" &&
    typeof WebAssembly === "object" &&
    typeof Worker === "function" &&
    typeof caches !== "undefined" &&
    !!(window.AudioContext || window.webkitAudioContext) &&
    !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

/** 模型是否已完整缓存。返回 { cached, mf, reason }。 */
export async function modelCached() {
  const mf = await loadAsrManifest();
  if (!mf || mf.status !== "ready" || !mf.model) return { cached: false, mf, reason: "本机听写清单缺失" };
  if (typeof caches === "undefined") return { cached: false, mf, reason: "这个浏览器不能缓存模型（需要 https 或 localhost）" };
  try {
    const c = await caches.open(modelCacheName(mf));
    const done = await c.match(doneKey(mf));
    if (!done) return { cached: false, mf, reason: "尚未下载" };
    for (const f of mf.model.files) {
      if (!(await c.match(keyFor(mf, f)))) return { cached: false, mf, reason: "缓存不完整" };
    }
    return { cached: true, mf, reason: "" };
  } catch (e) {
    return { cached: false, mf, reason: "无法读取浏览器缓存" };
  }
}

export async function deleteModel() {
  const mf = await loadAsrManifest();
  if (!mf) return false;
  try { return await caches.delete(modelCacheName(mf)); } catch (_) { return false; }
}

/** 给 worker 用的缓存位置：{ cacheName, keys:{ "model.onnx": url, ... }, kind }。 */
export async function modelCacheRefs() {
  const { cached, mf, reason } = await modelCached();
  if (!cached) throw new Error(reason || "尚未下载");
  const keys = {};
  for (const f of mf.model.files) keys[f.as || f.name] = keyFor(mf, f);
  return { cacheName: modelCacheName(mf), keys, kind: mf.model.kind, mf };
}

/** 读出已缓存的模型文件：{ "model.onnx": ArrayBuffer, "tokens.txt": ArrayBuffer }。 */
export async function readModelFiles() {
  const { cached, mf, reason } = await modelCached();
  if (!cached) throw new Error(reason || "尚未下载");
  const c = await caches.open(modelCacheName(mf));
  const out = {};
  for (const f of mf.model.files) {
    const r = await c.match(keyFor(mf, f));
    out[f.as || f.name] = await r.arrayBuffer();
  }
  return { mf, files: out };
}

function mirrorsOf(mf) {
  const cfg = (typeof window !== "undefined" && window.TITAOJING_CONFIG) || {};
  const list = [];
  if (cfg.asrModelBase) list.push({ name: "部署方镜像", base: String(cfg.asrModelBase).replace(/\/?$/, "/") });
  for (const m of mf.model.mirrors || []) list.push(m);
  return list;
}

async function sha256Hex(buf) {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function readBody(res, onBytes, signal) {
  if (!res.body || !res.body.getReader) {
    const ab = await res.arrayBuffer();
    onBytes(ab.byteLength);
    return [new Uint8Array(ab)];
  }
  const reader = res.body.getReader();
  const parts = [];
  for (;;) {
    if (signal && signal.aborted) { try { reader.cancel(); } catch (_) {} throw new DOMException("aborted", "AbortError"); }
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    onBytes(value.byteLength);
  }
  return parts;
}

async function fetchFileFrom(base, file, onBytes, signal) {
  const url = base + file.name;
  const opts = { signal, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" };
  if (file.bytes <= CHUNK) {
    // 小文件：整份取（有的镜像对 Range 请求回 200 却只给一段，小文件不分段更稳）
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error("HTTP " + res.status);
    return new Blob(await readBody(res, onBytes, signal));
  }
  const parts = [];
  let got = 0;
  let tries = 0;
  while (got < file.bytes) {
    const end = Math.min(file.bytes, got + CHUNK) - 1;
    const want = end - got + 1;
    let res;
    try {
      res = await fetch(url, { ...opts, headers: { Range: `bytes=${got}-${end}` } });
    } catch (e) {
      if (signal && signal.aborted) throw e;
      if (++tries > 4) throw new Error("网络中断");
      await new Promise((r) => setTimeout(r, 800 * tries));
      continue;
    }
    if (res.status !== 200 && res.status !== 206) throw new Error("HTTP " + res.status);
    let chunkGot = 0;
    try {
      const ps = await readBody(res, (n) => { chunkGot += n; onBytes(n); }, signal);
      const len = ps.reduce((a, p) => a + p.byteLength, 0);
      if (res.status === 200 && got === 0 && len === file.bytes) return new Blob(ps); // 服务器忽略了 Range，给了整份
      if (len !== want) throw new Error("分段长度不符");
      parts.push(...ps);
      got += len;
      tries = 0;
    } catch (e) {
      onBytes(-chunkGot);
      if (signal && signal.aborted) throw e;
      if (++tries > 4) throw e;
      await new Promise((r) => setTimeout(r, 800 * tries));
    }
  }
  return new Blob(parts);
}

/**
 * 下载并缓存模型。onProgress({ loaded, total, mirror, file })。
 * 返回 { ok, mirror, bytes, ms, error }。
 */
export async function downloadModel({ onProgress, signal } = {}) {
  const t0 = performance.now();
  const mf = await loadAsrManifest();
  if (!mf || !mf.model) return { ok: false, error: "本机听写清单缺失" };
  if (typeof caches === "undefined") return { ok: false, error: "这个浏览器不能缓存模型（需要 https 或 localhost）" };
  const engineFiles = (mf.engineFiles && mf.engineFiles.files) || [];
  const engineBytes = engineFiles.reduce((a, f) => a + (f.bytes || 0), 0);
  const total = modelBytes(mf) + engineBytes;
  const c = await caches.open(modelCacheName(mf));
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (_) {}
  let doneBytes = 0;
  const used = [];
  const skipped = [];
  // 先把本站的识别引擎取一遍（约 12 MB），让离线缓存里也有它。
  for (const f of engineFiles) {
    try {
      const res = await fetch(mf.engineFiles.dir + f.name, { signal });
      if (!res.ok) throw new Error("HTTP " + res.status);
      await readBody(res, (n) => { doneBytes += n; onProgress && onProgress({ loaded: doneBytes, total, file: f.name, mirror: "本站" }); }, signal);
    } catch (e) {
      if (signal && signal.aborted) return { ok: false, error: "已取消" };
      return { ok: false, error: `识别引擎 ${f.name} 没能下载（${(e && e.message) || e}）` };
    }
  }
  doneBytes = engineBytes;
  for (const f of mf.model.files) {
    const existing = await c.match(keyFor(mf, f));
    if (existing) { doneBytes += f.bytes; onProgress && onProgress({ loaded: doneBytes, total, file: f.name, mirror: "缓存" }); continue; }
    let ok = false;
    const errors = [];
    for (const m of mirrorsOf(mf)) {
      let fileBytes = 0;
      const report = (n) => {
        fileBytes += n;
        onProgress && onProgress({ loaded: doneBytes + Math.max(0, fileBytes), total, file: f.name, mirror: m.name });
      };
      try {
        const blob = await fetchFileFrom(m.base, f, report, signal);
        if (blob.size !== f.bytes) throw new Error(`大小不符（${blob.size}）`);
        const buf = await blob.arrayBuffer();
        const sha = await sha256Hex(buf);
        if (f.sha256 && sha !== f.sha256) throw new Error("校验失败");
        await c.put(keyFor(mf, f), new Response(blob, { headers: { "Content-Type": "application/octet-stream", "X-Sha256": sha, "X-Source": encodeURIComponent(m.name) } }));
        doneBytes += f.bytes;
        used.push(m.name);
        ok = true;
        break;
      } catch (e) {
        if (signal && signal.aborted) return { ok: false, error: "已取消" };
        errors.push(`${m.name}：${(e && e.message) || e}`);
      }
    }
    skipped.push(...errors.map((x) => `${f.name} ${x}`));
    if (!ok) return { ok: false, error: `${f.name} 没能下载（${errors.join("；")}）` };
  }
  await c.put(doneKey(mf), new Response(JSON.stringify({ id: mf.model.id, at: new Date().toISOString(), from: used, skipped }), { headers: { "Content-Type": "application/json" } }));
  return { ok: true, mirror: [...new Set(used)].join("、") || "缓存", bytes: total, ms: Math.round(performance.now() - t0), skipped };
}
