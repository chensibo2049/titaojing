/**
 * 本机听写模型：进入页面后可在后台自动下载、校验、缓存。
 *
 * - 引擎（sherpa-onnx WASM，约 12 MB）随网站一起发布，在 assets/asr/engine/。
 * - 中文识别模型（约 78 MB，连同引擎一共约 90 MB）不进 git：按顺序尝试
 *   ModelScope（魔搭）、hf-mirror.com、Hugging Face。大文件用 HTTP Range 并行分段
 *   （镜像不支持时退回单路），分段存进 IndexedDB，中断后可续；校验 sha256 后
 *   写入 Cache Storage，只需下载一次。
 * - 部署方可在 config.js 里填 asrModelBase（自己的对象存储目录，需允许跨域），会排在最前面。
 */
import { DEFAULT_CHUNK, DEFAULT_PARALLEL, fetchFile, sha256Hex, readBody } from "./asr-download.js";

const MANIFEST = "assets/asr/manifest.json";
const PARTS_DB = "titaojing-asr-parts";
const PARTS_STORE = "chunks";
const PARTS_VER = 1;

let manifestPromise = null;
let partsDbPromise = null;

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
  try { await clearParts(mf.model && mf.model.id); } catch (_) {}
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

function openPartsDb() {
  if (partsDbPromise) return partsDbPromise;
  if (typeof indexedDB === "undefined") {
    partsDbPromise = Promise.reject(new Error("no-indexeddb"));
    partsDbPromise.catch(() => { partsDbPromise = null; });
    return partsDbPromise;
  }
  partsDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(PARTS_DB, PARTS_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PARTS_STORE)) db.createObjectStore(PARTS_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  partsDbPromise.catch(() => { partsDbPromise = null; });
  return partsDbPromise;
}

function reqP(r) {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}

function chunkStoreFor(fileId) {
  return {
    async get(key) {
      try {
        const db = await openPartsDb();
        const val = await new Promise((resolve, reject) => {
          const t = db.transaction(PARTS_STORE, "readonly");
          const r = t.objectStore(PARTS_STORE).get(key);
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        return val ? val.blob || val : null;
      } catch (_) { return null; }
    },
    async put(key, blob) {
      try {
        const db = await openPartsDb();
        await new Promise((resolve, reject) => {
          const t = db.transaction(PARTS_STORE, "readwrite");
          t.objectStore(PARTS_STORE).put({ key, blob, fileId, at: Date.now() }, key);
          t.oncomplete = () => resolve();
          t.onerror = () => reject(t.error);
        });
      } catch (_) {}
    },
    async clear(prefix) {
      await clearParts(prefix);
    },
  };
}

async function clearParts(prefix) {
  try {
    const db = await openPartsDb();
    await new Promise((resolve, reject) => {
      const t = db.transaction(PARTS_STORE, "readwrite");
      const store = t.objectStore(PARTS_STORE);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return;
        const k = String(cur.key || "");
        if (!prefix || k.startsWith(prefix) || (cur.value && cur.value.fileId === prefix)) store.delete(cur.primaryKey);
        cur.continue();
      };
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  } catch (_) {}
}

/**
 * 下载并缓存模型。onProgress({ loaded, total, mirror, file, mode })。
 * 返回 { ok, mirror, bytes, ms, error, mode }。
 */

/** 把 Background Fetch 留下的文件核对后写入模型缓存。 */
export async function importBackgroundStash() {
  const mf = await loadAsrManifest();
  if (!mf || !mf.model || typeof caches === "undefined") return { imported: 0 };
  let stash;
  try { stash = await caches.open("titaojing-asr-bf"); } catch (_) { return { imported: 0 }; }
  const c = await caches.open(modelCacheName(mf));
  let imported = 0;
  const keys = await stash.keys();
  for (const f of mf.model.files) {
    if (await c.match(keyFor(mf, f))) continue;
    const hit = keys.find((req) => {
      try { return decodeURIComponent(new URL(req.url).pathname).endsWith("/" + f.name) || req.url.includes(f.name); } catch (_) { return req.url.includes(f.name); }
    });
    if (!hit) continue;
    const res = await stash.match(hit);
    if (!res || !res.ok) continue;
    const buf = await res.arrayBuffer();
    if (buf.byteLength !== f.bytes) continue;
    const sha = await sha256Hex(buf);
    if (f.sha256 && sha !== f.sha256) continue;
    await c.put(keyFor(mf, f), new Response(buf, { headers: { "Content-Type": "application/octet-stream", "X-Sha256": sha, "X-Source": "background-fetch" } }));
    imported += 1;
  }
  const remaining = [];
  for (const f of mf.model.files) {
    if (!(await c.match(keyFor(mf, f)))) remaining.push(f);
  }
  if (!remaining.length) {
    await c.put(doneKey(mf), new Response(JSON.stringify({ id: mf.model.id, at: new Date().toISOString(), from: ["后台下载"] }), { headers: { "Content-Type": "application/json" } }));
  }
  return { imported, done: !remaining.length };
}

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
  try { await importBackgroundStash(); } catch (_) {}
  let doneBytes = 0;
  const used = [];
  const skipped = [];
  const modes = [];
  // 先把本站的识别引擎取一遍（约 12 MB），让离线缓存里也有它。
  for (const f of engineFiles) {
    try {
      const res = await fetch(mf.engineFiles.dir + f.name, { signal });
      if (!res.ok) throw new Error("HTTP " + res.status);
      await readBody(res, (n) => { doneBytes += n; onProgress && onProgress({ loaded: doneBytes, total, file: f.name, mirror: "本站", mode: "single" }); }, signal);
    } catch (e) {
      if (signal && signal.aborted) return { ok: false, error: "已取消" };
      return { ok: false, error: `识别引擎 ${f.name} 没能下载（${(e && e.message) || e}）` };
    }
  }
  doneBytes = engineBytes;
  for (const f of mf.model.files) {
    const existing = await c.match(keyFor(mf, f));
    if (existing) { doneBytes += f.bytes; onProgress && onProgress({ loaded: doneBytes, total, file: f.name, mirror: "缓存", mode: "cache" }); continue; }
    let ok = false;
    const errors = [];
    const fileId = `${mf.model.id}/${f.name}`;
    const store = chunkStoreFor(fileId);
    for (const m of mirrorsOf(mf)) {
      let fileBytes = 0;
      const report = (n) => {
        fileBytes += n;
        onProgress && onProgress({ loaded: doneBytes + Math.max(0, fileBytes), total, file: f.name, mirror: m.name, mode: "download" });
      };
      try {
        const got = await fetchFile({
          url: m.base + f.name,
          bytes: f.bytes,
          sha256: f.sha256,
          chunkStore: store,
          onBytes: report,
          signal,
          parallel: DEFAULT_PARALLEL,
          chunk: DEFAULT_CHUNK,
          fileId,
        });
        if (got.blob.size !== f.bytes) throw new Error(`大小不符（${got.blob.size}）`);
        const buf = await got.blob.arrayBuffer();
        const sha = await sha256Hex(buf);
        if (f.sha256 && sha !== f.sha256) throw new Error("校验失败");
        await c.put(keyFor(mf, f), new Response(got.blob, { headers: { "Content-Type": "application/octet-stream", "X-Sha256": sha, "X-Source": encodeURIComponent(m.name), "X-Mode": got.mode } }));
        doneBytes += f.bytes;
        used.push(m.name);
        modes.push(got.mode);
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
  await c.put(doneKey(mf), new Response(JSON.stringify({ id: mf.model.id, at: new Date().toISOString(), from: used, skipped, modes }), { headers: { "Content-Type": "application/json" } }));
  return { ok: true, mirror: [...new Set(used)].join("、") || "缓存", bytes: total, ms: Math.round(performance.now() - t0), skipped, mode: modes.includes("parallel") ? "parallel" : (modes[0] || "cache") };
}

/** 尚未写入完成缓存的模型文件 URL，供 Background Fetch 在页面被关掉后继续。 */
export async function pendingModelRequests() {
  const mf = await loadAsrManifest();
  if (!mf || !mf.model) return { mf, files: [] };
  if (typeof caches === "undefined") return { mf, files: [] };
  const c = await caches.open(modelCacheName(mf));
  const files = [];
  for (const f of mf.model.files) {
    if (await c.match(keyFor(mf, f))) continue;
    const mirrors = mirrorsOf(mf);
    if (!mirrors.length) continue;
    files.push({ name: f.name, bytes: f.bytes, sha256: f.sha256, urls: mirrors.map((m) => m.base + f.name) });
  }
  return { mf, files };
}
