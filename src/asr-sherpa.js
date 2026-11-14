/**
 * 本机中文听写（sherpa-onnx WebAssembly，Silero VAD + Paraformer 中文小模型）。
 *
 * - 识别在 Web Worker 里跑，声音由 AudioWorklet 降到 16 kHz 后直接送进 worker，不走主线程。
 * - 声音不离开这台设备：不经过沉思波，也不经过浏览器厂商。
 * - 模型第一次需要下载（见 asr-model.js），之后从浏览器缓存读取，可离线使用。
 * - 结果走与浏览器听写相同的 onTranscript / onFiller 接口。
 *
 * 详见 docs/ASR.md。
 */
import { FILLER_RE as DEFAULT_RE, buildFillerRe, SINGLE_CHAR_FILLERS } from "./constants.js";
import { modelCached, modelCacheRefs, engineSupported, loadAsrManifest, modelSizeLabel } from "./asr-model.js";

const WORKER_URL = "assets/asr/engine/asr-worker.js";

/**
 * 预热：进入站位页时先把引擎和模型在 worker 里载入（不占主线程），
 * 开讲时直接接上麦克风，不用再等几秒。
 */
let warm = null; // { worker, ready: Promise<{ok,initMs}>, queue: [] }

function spawnEngine() {
  return modelCacheRefs().then((refs) => {
    const worker = new Worker(WORKER_URL);
    const queue = [];
    const ready = new Promise((resolve) => {
      worker.onmessage = (ev) => {
        const m = ev.data || {};
        if (m.type === "ready") resolve({ ok: true, initMs: m.initMs });
        else if (m.type === "error") resolve({ ok: false, message: m.message });
        else queue.push(m);
      };
      worker.onerror = (e) => resolve({ ok: false, message: "本机听写组件出错：" + ((e && e.message) || "未知错误") });
    });
    worker.postMessage({ type: "init", kind: refs.kind, cacheName: refs.cacheName, keys: refs.keys });
    return { worker, ready, queue };
  });
}

export function prewarmSherpa(stream = null) {
  if (warm || !cached.ok) return;
  warm = spawnEngine().then(async (eng) => {
    // 同时把麦克风音频管线建好（暂停状态，不送声音），开讲时只需打开闸门
    if (stream && stream.getAudioTracks && stream.getAudioTracks().length) {
      try {
        const own = new MediaStream(stream.getAudioTracks().map((t) => t.clone()));
        const audio = await openAudio(own);
        audio.pause(true);
        audio.connect(eng.worker);
        eng.audio = audio;
        eng.ownStream = own;
        eng.srcStream = stream;
      } catch (_) { /* 开讲时再试 */ }
    }
    return eng;
  }).catch(() => null);
  warm.then((w) => { if (!w) warm = null; });
}

export function dropWarmSherpa() {
  if (!warm) return;
  const w = warm;
  warm = null;
  w.then((x) => {
    if (!x) return;
    try { x.audio && x.audio.close(); } catch (_) {}
    try { x.ownStream && x.ownStream.getTracks().forEach((t) => t.stop()); } catch (_) {}
    try { x.worker.terminate(); } catch (_) {}
  });
}

let cached = { ok: false, detail: "未检测", filesOk: false, supported: engineSupported(), sizeLabel: "约 80 MB" };

export function sherpaAvailable() {
  return cached;
}

/** 异步检查：引擎能否运行、模型是否已缓存。启动时和下载完成后调用。 */
export async function inspectSherpa() {
  const supported = engineSupported();
  const mf = await loadAsrManifest();
  const sizeLabel = modelSizeLabel(mf);
  if (!supported) {
    cached = { ok: false, filesOk: false, supported, sizeLabel, detail: "这个浏览器不支持本机听写（需要较新的 Chrome / Edge / Safari / Firefox，并通过 https 打开）" };
    return cached;
  }
  const st = await modelCached();
  cached = st.cached
    ? { ok: true, filesOk: true, supported, sizeLabel, detail: "本机听写已就绪：声音只在这台设备上识别。", model: mf.model.id }
    : { ok: false, filesOk: false, supported, sizeLabel, detail: `本机听写需要先下载中文模型（${sizeLabel}，一次即可）。${st.reason && st.reason !== "尚未下载" ? st.reason : ""}`.trim() };
  return cached;
}

const WORKLET_SRC = `
class TjDown extends AudioWorkletProcessor {
  constructor() {
    super();
    this.out = null; this.paused = false;
    this.ratio = sampleRate / 16000; this.pos = 0;
    this.acc = new Float32Array(1600); this.n = 0;
    this.port.onmessage = (e) => {
      const d = e.data || {};
      if (d.type === "port") this.out = d.port;
      if (d.type === "pause") { this.paused = !!d.on; this.n = 0; }
    };
  }
  push(v) { this.acc[this.n++] = v; if (this.n === this.acc.length) { if (this.out) this.out.postMessage({ type: "audio", samples: this.acc }, [this.acc.buffer]); this.acc = new Float32Array(1600); this.n = 0; } }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch || this.paused) return true;
    if (this.ratio === 1) { for (let i = 0; i < ch.length; i++) this.push(ch[i]); return true; }
    // 简单平均降采样（输入一般是 44.1/48 kHz）
    while (this.pos < ch.length) {
      const a = Math.floor(this.pos), b = Math.min(ch.length, Math.floor(this.pos + this.ratio));
      let s = 0, k = 0; for (let i = a; i < Math.max(b, a + 1); i++) { s += ch[i]; k++; }
      this.push(s / k);
      this.pos += this.ratio;
    }
    this.pos -= ch.length;
    return true;
  }
}
registerProcessor("tj-down", TjDown);
`;

async function openAudio(stream) {
  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx;
  try { ctx = new AC({ sampleRate: 16000, latencyHint: "interactive" }); } catch (_) { ctx = new AC(); }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const src = ctx.createMediaStreamSource(stream);
  if (ctx.audioWorklet && typeof AudioWorkletNode === "function") {
    const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "text/javascript" }));
    try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
    const node = new AudioWorkletNode(ctx, "tj-down", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: "explicit" });
    const sink = ctx.createGain();
    sink.gain.value = 0;
    src.connect(node); node.connect(sink); sink.connect(ctx.destination);
    return {
      ctx, kind: "worklet",
      connect(worker) {
        const ch = new MessageChannel();
        worker.postMessage({ type: "port", port: ch.port1 }, [ch.port1]);
        node.port.postMessage({ type: "port", port: ch.port2 }, [ch.port2]);
      },
      pause(on) { node.port.postMessage({ type: "pause", on }); },
      close() { try { src.disconnect(); node.disconnect(); sink.disconnect(); } catch (_) {} try { ctx.close(); } catch (_) {} },
    };
  }
  // 旧浏览器：ScriptProcessor（在主线程，但很轻）
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const ratio = ctx.sampleRate / 16000;
  let worker = null, paused = false;
  proc.onaudioprocess = (e) => {
    if (!worker || paused) return;
    const x = e.inputBuffer.getChannelData(0);
    const n = Math.floor(x.length / ratio);
    const y = new Float32Array(n);
    for (let i = 0; i < n; i++) y[i] = x[Math.floor(i * ratio)];
    worker.postMessage({ type: "audio", samples: y }, [y.buffer]);
  };
  src.connect(proc); proc.connect(ctx.destination);
  return {
    ctx, kind: "script",
    connect(w) { worker = w; },
    pause(on) { paused = on; },
    close() { try { src.disconnect(); proc.disconnect(); } catch (_) {} try { ctx.close(); } catch (_) {} },
  };
}

/**
 * 开始本机听写。opts 与 startSpeech 相同，另可传 stream（已有的含音轨的 MediaStream）。
 * 返回 { stop(), pause(), resume(), supported, engine:"sherpa", ready:Promise }。
 */
export function startSherpa(opts = {}) {
  const { onFiller, onStatus, onHeard, onDebug, onTranscript, onReady, fillers = null, sensitivity = "mid" } = opts;
  let list = fillers && fillers.length ? fillers : null;
  if (list && sensitivity === "low") list = list.filter((w) => !SINGLE_CHAR_FILLERS.includes(w));
  const FILLER_RE = list ? buildFillerRe(list) : DEFAULT_RE;
  const verbose = typeof location !== "undefined" && /[?&]debug=1/.test(location.search);
  const dbg = (k, d, x) => {
    if (verbose && k !== "stats") console.log("[本机听写] " + k + " " + d);
    if (onDebug) { try { onDebug(k, d, x); } catch (_) {} }
  };

  let worker = null, audio = null, ownStream = null, stopped = false, paused = false;
  let readyResolve;
  const ready = new Promise((r) => { readyResolve = r; });
  const fail = (message) => {
    if (stopped) return;
    onStatus && onStatus({ ok: false, engine: "sherpa", message, sticky: true });
    dbg("error", message);
    readyResolve({ ok: false, message });
    cleanup();
  };
  const cleanup = () => {
    try { audio && audio.close(); } catch (_) {}
    try { worker && worker.terminate(); } catch (_) {}
    try { ownStream && ownStream.getTracks().forEach((t) => t.stop()); } catch (_) {}
    audio = null; worker = null; ownStream = null;
  };

  const boot = async () => {
    const t0 = performance.now();
    let eng = null;
    if (warm) { const w = warm; warm = null; eng = await w; }
    if (!eng) {
      try { eng = await spawnEngine(); } catch (e) {
        return fail("本机听写还没有下载中文模型，请在「设置」或横幅里下载（一次即可）。");
      }
    }
    worker = eng.worker;
    if (eng.audio && (!opts.stream || eng.srcStream !== opts.stream)) {
      // 预热时接的不是这条音轨：丢掉重建
      try { eng.audio.close(); } catch (_) {}
      try { eng.ownStream.getTracks().forEach((t) => t.stop()); } catch (_) {}
      eng.audio = null;
    }
    if (eng.audio) { audio = eng.audio; ownStream = eng.ownStream; }
    if (stopped) return cleanup();
    let stream = audio ? ownStream : opts.stream && opts.stream.getAudioTracks && opts.stream.getAudioTracks().length ? opts.stream : null;
    if (!stream) {
      try {
        stream = ownStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      } catch (e) {
        return fail("麦克风未被允许，本机听写听不到声音。教态和视线仍可分析。");
      }
    } else if (!audio) {
      // 共用摄像头那条音轨，但单独克隆一份，停止时不影响录像
      stream = new MediaStream(stream.getAudioTracks().map((t) => t.clone()));
      ownStream = stream;
    }
    if (stopped) return cleanup();
    dbg("mic", `音轨 ${stream.getAudioTracks().map((t) => t.readyState).join(",")}`);
    const handle = (m) => {
      if (m.type === "ready") {
        dbg("ready", `模型载入 ${m.initMs} ms，总计 ${Math.round(performance.now() - t0)} ms`);
        onStatus && onStatus({ ok: true, engine: "sherpa", message: "" });
        readyResolve({ ok: true, initMs: m.initMs, totalMs: Math.round(performance.now() - t0) });
        onReady && onReady();
      } else if (m.type === "error") {
        fail(m.message);
      } else if (m.type === "speaking") {
        if (m.on && onHeard) onHeard();
        dbg("vad", m.on ? "开始说话" : "停顿");
      } else if (m.type === "text") {
        const text = m.text;
        // 页面主线程忙时消息会晚到：把排队的时间也算进去，时间戳仍对准说话的那一刻
        if (m.postedAt) m.agoSec += Math.max(0, (Date.now() - m.postedAt) / 1000);
        dbg("transcript", text, { final: true, decodeMs: m.decodeMs, dur: m.durSec });
        onHeard && onHeard();
        onTranscript && onTranscript({ text, final: true, agoSec: m.agoSec, durSec: m.durSec, engine: "sherpa" });
        if (FILLER_RE && onFiller) {
          FILLER_RE.lastIndex = 0;
          let x;
          while ((x = FILLER_RE.exec(text))) {
            const frac = text.length ? x.index / text.length : 0;
            onFiller(x[1], { agoSec: Math.max(0, m.agoSec - frac * m.durSec), engine: "sherpa" });
          }
        }
      } else if (m.type === "stats") {
        dbg("stats", `已送入 ${m.fedSec.toFixed(1)} 秒，峰值 ${m.peak}，已识别 ${m.segments} 句`, m);
        if (verbose) console.debug("[本机听写]", JSON.stringify(m));
      } else if (m.type === "flushed") {
        if (flushWait) { flushWait(); flushWait = null; }
      }
    };
    worker.onmessage = (ev) => handle(ev.data || {});
    worker.onerror = (e) => fail("本机听写组件出错：" + ((e && e.message) || "未知错误"));
    for (const m of eng.queue.splice(0)) handle(m);
    try {
      if (audio) {
        worker.postMessage({ type: "reset" });
        if (audio.ctx.state === "suspended") audio.ctx.resume().catch(() => {});
        audio.pause(paused);
        dbg("audio", `预热的 ${audio.kind} ${audio.ctx.sampleRate} Hz → 16 kHz`);
      } else {
        audio = await openAudio(stream);
        audio.connect(worker);
        if (paused) audio.pause(true);
        dbg("audio", `${audio.kind} ${audio.ctx.sampleRate} Hz → 16 kHz`);
      }
    } catch (e) {
      return fail("没能打开麦克风音频（" + ((e && e.message) || e) + "）。");
    }
    // 引擎可能已在预热时载入完毕
    const r = await eng.ready;
    if (r.ok) handle({ type: "ready", initMs: r.initMs });
    else fail(r.message);
  };

  let flushWait = null;
  dbg("start", opts.stream ? "共用摄像头音轨" : "单独打开麦克风");
  onStatus && onStatus({ ok: true, engine: "sherpa", message: "", loading: true });
  boot().catch((e) => fail("本机听写启动失败：" + ((e && e.message) || e)));

  return {
    supported: true,
    engine: "sherpa",
    ready,
    pause() {
      paused = true;
      if (audio) audio.pause(true);
      if (worker) worker.postMessage({ type: "flush" });
    },
    resume() {
      paused = false;
      if (audio) audio.pause(false);
    },
    /** 停止。会先把最后一句识别完（最多等 timeoutMs）。返回 Promise。 */
    stop(timeoutMs = 2500) {
      if (stopped) return Promise.resolve();
      if (audio) audio.pause(true);
      const w = worker;
      const finish = () => { stopped = true; cleanup(); };
      if (!w) { finish(); return Promise.resolve(); }
      return new Promise((resolve) => {
        const t = setTimeout(() => { flushWait = null; finish(); resolve(); }, timeoutMs);
        flushWait = () => { clearTimeout(t); finish(); resolve(); };
        w.postMessage({ type: "flush" });
      });
    },
  };
}

/** 试一下本机听写：载入模型后听 seconds 秒，返回 { ok, text, reason, error, initMs }。 */
export async function preflightSherpa({ seconds = 5, onStatus } = {}) {
  let text = "";
  const h = startSherpa({
    onTranscript: (seg) => { text += seg.text; },
    onStatus: (st) => { if (st && st.ok === false) onStatus && onStatus({ ok: false, reason: st.message }); },
  });
  onStatus && onStatus({ ok: true, loading: true, reason: "正在载入本机听写…" });
  const r = await Promise.race([h.ready, new Promise((res) => setTimeout(() => res({ ok: false, message: "本机听写载入超时（60 秒）。" }), 60000))]);
  if (!r.ok) { await h.stop(); return { ok: false, text: "", reason: r.message, error: "load" }; }
  onStatus && onStatus({ ok: true, listening: true, reason: `本机听写已载入（${r.totalMs} ms），请说一句话…` });
  await new Promise((res) => setTimeout(res, seconds * 1000));
  await h.stop(4000);
  text = text.trim();
  if (text) return { ok: true, text, reason: "本机听写听到了：「" + text + "」", error: "", initMs: r.totalMs };
  return { ok: false, text: "", reason: "本机听写已载入，但这几秒没有听到可写出的字。请靠近麦克风说一句话再试。", error: "empty", initMs: r.totalMs };
}
