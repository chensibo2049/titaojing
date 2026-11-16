/** Optional post-recording ASR. No default endpoint, fallback, persistent token or video upload. */
const MAX_SECONDS = 60;
const MAX_BYTES = 1920044;
const ERROR_MESSAGES = {
  consent_required: "请先明确同意仅上传音频到自建听写服务（不用于训练）。",
  access_denied: "听写访问码不正确。", session_expired: "听写会话已过期，请重新输入访问码。",
  queue_full: "听写队列已满，请稍后重试。", rate_limit: "请求过于频繁，请稍后重试。",
  audio_too_large: "音频超过限制（最长 60 秒）。", wav_16khz_mono_pcm16_required: "音频格式不符合服务要求。",
  inference_timeout: "服务器听写超时；没有转交其他厂商。", inference_failed: "服务器听写失败；可继续纯视觉或自行选择本机听写。",
  origin_denied: "当前页面不在服务允许的来源内。", session_capacity: "服务会话已满，请稍后重试。",
  job_capacity: "本次会话作业已达上限，请稍后重试。", job_not_found: "听写作业已删除或过期。",
  timeout: "服务器听写等待超时，已请求取消。", cancelled: "服务器听写已取消。",
};

function failure(code, fallback) {
  const error = new Error(ERROR_MESSAGES[code] || fallback || "服务器听写暂不可用；未切换其他服务。");
  error.code = code;
  return error;
}

function endpoint() {
  const configured = globalThis.window?.TITAOJING_CONFIG?.asrServerEndpoint || "";
  if (!configured) return null;
  try {
    const url = new URL(configured, globalThis.location.href);
    if (url.origin !== globalThis.location.origin || url.protocol !== "https:" || url.search || url.hash || url.username || url.password) return null;
    return url.href.replace(/\/$/, "");
  } catch (_) { return null; }
}

let health = { base: null, checkedAt: 0, available: false };

/** Synchronous status never treats a configured URL as proof of service health. */
export function serverAsrStatus() {
  const url = endpoint();
  const available = !!url && health.base === url && health.available && Date.now() - health.checkedAt < 30000;
  return { available, configured: !!url, engine: "server", maxDurationSec: MAX_SECONDS,
    detail: !url ? "服务器听写未接入；教态与视线仍在本机分析。"
      : available ? "可选服务器录后听写：需访问码及本次明确同意，仅上传音频，不用于训练。"
        : "服务器听写已配置，但尚未通过健康检查；教态与视线仍在本机分析。" };
}

/** Explicit, bounded health probe; no audio, access code or token is sent. */
export async function probeServerAsr({ signal } = {}) {
  const base = endpoint();
  if (!base) return serverAsrStatus();
  const scope = withTimeout(signal, 3000);
  health = { base, checkedAt: Date.now(), available: false };
  try {
    const data = await request(base, "/health", { signal: scope.controller.signal });
    if (data.status !== "ok" || data.engine !== "server" || data.maxDurationSec !== MAX_SECONDS || data.maxBytes !== MAX_BYTES) throw failure("invalid_response");
    health = { base, checkedAt: Date.now(), available: true };
  } catch (_) {
    health = { base, checkedAt: Date.now(), available: false };
  } finally { scope.close(); }
  return serverAsrStatus();
}

async function request(base, path, options = {}) {
  let response;
  try { response = await fetch(base + path, { ...options, credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer" }); }
  catch (error) {
    if (options.signal?.aborted) throw error;
    throw failure("network", "无法连接服务器听写；未切换其他厂商。");
  }
  let data;
  try { data = await response.json(); } catch (_) { throw failure("invalid_response", "听写接口返回格式错误，尚未完成接入。"); }
  if (!response.ok) throw failure(data.error || "http_error");
  return data;
}

function withTimeout(signal, timeoutMs) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  return { controller, timedOut: () => timedOut, close() { clearTimeout(timer); signal?.removeEventListener("abort", abort); } };
}

/** Access code is supplied by the user, never embedded in config or persisted. */
export async function createServerAsrSession(accessCode, { signal } = {}) {
  const base = endpoint();
  if (!base) throw failure("unavailable", serverAsrStatus().detail);
  if (typeof accessCode !== "string" || !accessCode || accessCode.length > 128) throw failure("access_denied");
  const scope = withTimeout(signal, 10000);
  try {
    const session = await request(base, "/session", { method: "POST", signal: scope.controller.signal,
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessCode }) });
    if (!session.token || !Number.isFinite(session.expiresIn)) throw failure("invalid_response");
    return session;
  } catch (error) {
    if (scope.controller.signal.aborted) throw failure(scope.timedOut() ? "timeout" : "cancelled");
    throw error;
  } finally { scope.close(); }
}

/** Produce a bounded, audio-only PCM WAV from an audio Blob, without ever sending video. */
async function encodeAudio(blob, signal) {
  if (!(blob instanceof Blob) || !/^audio\//i.test(blob.type)) throw failure("audio_required", "请选择仅含音频的录后文件，不接受视频上传。");
  if (blob.size > 12 * 1024 * 1024 || !blob.size) throw failure("audio_too_large");
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) throw failure("audio_decode", "当前浏览器不能准备服务器听写音频。");
  if (signal.aborted) throw failure("cancelled");
  const context = new AC();
  let decoded;
  try { decoded = await context.decodeAudioData(await blob.arrayBuffer()); }
  catch (_) { throw failure("audio_decode", "无法解码此音频；未上传任何内容。"); }
  finally { await context.close().catch(() => {}); }
  if (signal.aborted) throw failure("cancelled");
  if (!Number.isFinite(decoded.duration) || decoded.duration > MAX_SECONDS || decoded.duration < 0.1) throw failure("audio_too_large");
  const count = Math.floor(decoded.duration * 16000);
  const buffer = new ArrayBuffer(44 + count * 2);
  const view = new DataView(buffer);
  const str = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  str(0, "RIFF"); view.setUint32(4, 36 + count * 2, true); str(8, "WAVE"); str(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  str(36, "data"); view.setUint32(40, count * 2, true);
  const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
  const ratio = decoded.sampleRate / 16000;
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * ratio), end = Math.max(start + 1, Math.min(decoded.length, Math.floor((i + 1) * ratio)));
    let value = 0;
    for (const channel of channels) for (let j = start; j < end; j++) value += channel[j];
    value = Math.max(-1, Math.min(1, value / channels.length / (end - start)));
    view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

const wait = (ms, signal) => new Promise((resolve, reject) => {
  if (signal.aborted) { reject(failure("cancelled")); return; }
  const abort = () => { clearTimeout(timer); reject(failure("cancelled")); };
  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
  signal.addEventListener("abort", abort, { once: true });
});

/** Returns final text only. Abort/timeout issues DELETE with a separate short-lived signal. */
export async function transcribeServerAudio(blob, { consent = false, sessionToken = "", signal, onStatus, timeoutMs = 120000 } = {}) {
  if (consent !== true) throw failure("consent_required");
  const base = endpoint();
  if (!base) throw failure("unavailable", serverAsrStatus().detail);
  if (!sessionToken) throw failure("session_expired");
  const scope = withTimeout(signal, Math.min(120000, Math.max(1000, Number(timeoutMs) || 120000)));
  const headers = { Authorization: `Bearer ${sessionToken}` };
  let id = null;
  try {
    const audio = await encodeAudio(blob, scope.controller.signal);
    if (audio.size > MAX_BYTES) throw failure("audio_too_large");
    onStatus?.({ engine: "server", state: "uploading", message: "仅上传本次音频，不上传视频，不用于训练。" });
    const job = await request(base, "/jobs", { method: "POST", signal: scope.controller.signal,
      headers: { ...headers, "Content-Type": "audio/wav", "X-ASR-Consent": "audio-only-v1" }, body: audio });
    if (typeof job.id !== "string" || !/^[\w-]{16,64}$/.test(job.id)) throw failure("invalid_response");
    id = job.id;
    while (true) {
      const status = await request(base, `/jobs/${id}`, { headers, signal: scope.controller.signal });
      onStatus?.({ engine: "server", state: status.state, message: status.state === "queued" ? "音频已进入有界队列。" : "服务器正在处理录后音频。" });
      if (status.state === "succeeded") {
        if (typeof status.result?.text !== "string") throw failure("invalid_response");
        return { ...status.result, engine: "server", final: true, queueSec: status.queueSec };
      }
      if (status.state === "failed") throw failure(status.error || "inference_failed");
      if (status.state === "cancelled") throw failure("cancelled");
      await wait(1000, scope.controller.signal);
    }
  } catch (error) {
    if (scope.controller.signal.aborted) throw failure(scope.timedOut() ? "timeout" : "cancelled");
    throw error;
  } finally {
    scope.close();
    if (id) {
      const cleanup = withTimeout(null, 3000);
      try { await request(base, `/jobs/${id}`, { method: "DELETE", headers, signal: cleanup.controller.signal }); }
      catch (_) { /* Server TTL and inference finally block still remove temporary audio. */ }
      finally { cleanup.close(); }
    }
  }
}
