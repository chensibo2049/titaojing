/**
 * 本机听写大文件下载：探测 Range、并行分段、断点续传、校验 sha256。
 * 不依赖 DOM，浏览器和 Node 测试都可以引用。
 */
export const DEFAULT_CHUNK = 4 * 1024 * 1024;
export const DEFAULT_PARALLEL = 5;

export function planRanges(bytes, chunk = DEFAULT_CHUNK) {
  const size = Math.max(0, Number(bytes) || 0);
  const step = Math.max(1, Number(chunk) || DEFAULT_CHUNK);
  const ranges = [];
  for (let start = 0; start < size; start += step) {
    ranges.push({ start, end: Math.min(size, start + step) - 1 });
  }
  return ranges;
}

export function rangeKey(fileId, start, end) {
  return `${fileId}:${start}-${end}`;
}

export async function sha256Hex(buf, subtle) {
  const impl = subtle || (typeof crypto !== "undefined" && crypto.subtle);
  if (!impl) throw new Error("这个环境没有 SHA-256");
  const input = buf instanceof ArrayBuffer ? buf : (ArrayBuffer.isView(buf) ? buf.buffer : await new Response(buf).arrayBuffer());
  const d = await impl.digest("SHA-256", input);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function mapPool(items, limit, fn) {
  const ret = new Array(items.length);
  let i = 0;
  const n = Math.max(1, Math.min(limit || 1, items.length || 1));
  await Promise.all(Array.from({ length: items.length ? n : 0 }, async () => {
    while (i < items.length) {
      const k = i++;
      ret[k] = await fn(items[k], k);
    }
  }));
  return ret;
}

function aborted(signal) {
  return !!(signal && signal.aborted);
}

function abortError() {
  try { return new DOMException("aborted", "AbortError"); } catch (_) {
    const e = new Error("aborted");
    e.name = "AbortError";
    return e;
  }
}

export async function readBody(res, onBytes, signal) {
  if (!res.body || !res.body.getReader) {
    const ab = await res.arrayBuffer();
    if (onBytes) onBytes(ab.byteLength);
    return [new Uint8Array(ab)];
  }
  const reader = res.body.getReader();
  const parts = [];
  for (;;) {
    if (aborted(signal)) {
      try { reader.cancel(); } catch (_) {}
      throw abortError();
    }
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    if (onBytes) onBytes(value.byteLength);
  }
  return parts;
}

const FETCH_OPTS = { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" };

export async function probeRange(url, fetchImpl, signal) {
  const fetchFn = fetchImpl || fetch;
  const res = await fetchFn(url, { ...FETCH_OPTS, method: "GET", headers: { Range: "bytes=0-0" }, signal });
  try { await res.arrayBuffer(); } catch (_) {}
  const cr = res.headers.get("Content-Range") || res.headers.get("content-range") || "";
  const m = cr.match(/\/(\d+)\s*$/);
  return {
    supported: res.status === 206,
    status: res.status,
    finalUrl: res.url || url,
    size: m ? Number(m[1]) : 0,
  };
}

export async function fetchRangeBytes(url, start, end, fetchImpl, onBytes, signal) {
  const fetchFn = fetchImpl || fetch;
  const want = end - start + 1;
  const res = await fetchFn(url, { ...FETCH_OPTS, headers: { Range: `bytes=${start}-${end}` }, signal });
  if (res.status !== 200 && res.status !== 206) throw new Error("HTTP " + res.status);
  const parts = await readBody(res, onBytes, signal);
  const length = parts.reduce((a, p) => a + p.byteLength, 0);
  if (res.status === 200) return { ignoredRange: true, parts, length, finalUrl: res.url || url };
  if (length !== want) throw new Error("分段长度不符");
  return { ignoredRange: false, parts, length, finalUrl: res.url || url };
}

function concatParts(partsList) {
  const arrays = [];
  for (const p of partsList) {
    if (!p) continue;
    if (p instanceof Uint8Array) arrays.push(p);
    else if (Array.isArray(p)) arrays.push(...p);
    else if (p instanceof Blob) arrays.push(p);
    else arrays.push(p);
  }
  return new Blob(arrays, { type: "application/octet-stream" });
}

async function fetchWhole(url, fetchImpl, onBytes, signal) {
  const fetchFn = fetchImpl || fetch;
  const res = await fetchFn(url, { ...FETCH_OPTS, signal });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return new Blob(await readBody(res, onBytes, signal), { type: "application/octet-stream" });
}

/**
 * 下载一个文件。chunkStore 可选：{ get(key) => Blob|ArrayBuffer|null, put(key, blob), clear(prefix) }。
 * 返回 { blob, mode: "parallel"|"single", url, ranges }.
 */
export async function fetchFile({
  url, bytes, sha256, fetchImpl, chunkStore, onBytes, signal,
  parallel = DEFAULT_PARALLEL, chunk = DEFAULT_CHUNK, fileId = "file",
} = {}) {
  if (aborted(signal)) throw abortError();
  const size = Number(bytes) || 0;
  if (!size || size <= chunk) {
    const blob = await fetchWhole(url, fetchImpl, onBytes, signal);
    if (size && blob.size !== size) throw new Error(`大小不符（${blob.size}）`);
    if (sha256) {
      const hex = await sha256Hex(await blob.arrayBuffer());
      if (hex !== sha256) throw new Error("校验失败");
    }
    return { blob, mode: "single", url, ranges: 1 };
  }

  let workUrl = url;
  let rangeOk = true;
  try {
    const probe = await probeRange(url, fetchImpl, signal);
    rangeOk = probe.supported;
    if (probe.finalUrl) workUrl = probe.finalUrl;
  } catch (_) {
    rangeOk = false;
  }

  if (!rangeOk) {
    const blob = await fetchWhole(url, fetchImpl, onBytes, signal);
    if (blob.size !== size) throw new Error(`大小不符（${blob.size}）`);
    if (sha256) {
      const hex = await sha256Hex(await blob.arrayBuffer());
      if (hex !== sha256) throw new Error("校验失败");
    }
    return { blob, mode: "single", url, ranges: 1 };
  }

  const ranges = planRanges(size, chunk);
  const parts = new Array(ranges.length);
  const pending = [];
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    const key = rangeKey(fileId, r.start, r.end);
    let hit = null;
    if (chunkStore && chunkStore.get) {
      try { hit = await chunkStore.get(key); } catch (_) { hit = null; }
    }
    if (hit) {
      const blob = hit instanceof Blob ? hit : new Blob([hit]);
      if (blob.size === r.end - r.start + 1) {
        parts[i] = blob;
        if (onBytes) onBytes(blob.size);
        continue;
      }
    }
    pending.push({ ...r, i, key });
  }

  await mapPool(pending, parallel, async (r) => {
    let tries = 0;
    for (;;) {
      if (aborted(signal)) throw abortError();
      let got = 0;
      const report = (n) => { got += n; if (onBytes) onBytes(n); };
      try {
        const result = await fetchRangeBytes(workUrl, r.start, r.end, fetchImpl, report, signal);
        if (result.ignoredRange) throw new Error("镜像忽略了分段请求");
        const blob = concatParts(result.parts);
        if (chunkStore && chunkStore.put) await chunkStore.put(r.key, blob);
        parts[r.i] = blob;
        return;
      } catch (e) {
        if (onBytes && got) onBytes(-got);
        if (aborted(signal) || (e && e.name === "AbortError")) throw e;
        if (++tries > 4) throw e;
        await new Promise((ok) => setTimeout(ok, 800 * tries));
      }
    }
  });

  const blob = concatParts(parts);
  if (blob.size !== size) throw new Error(`大小不符（${blob.size}）`);
  if (sha256) {
    const hex = await sha256Hex(await blob.arrayBuffer());
    if (hex !== sha256) throw new Error("校验失败");
  }
  if (chunkStore && chunkStore.clear) {
    try { await chunkStore.clear(fileId); } catch (_) {}
  }
  return { blob, mode: "parallel", url: workUrl, ranges: ranges.length };
}
