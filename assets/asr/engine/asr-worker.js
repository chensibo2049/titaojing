/* 沉思波 · 体态镜 —— 本机听写 Worker（sherpa-onnx WebAssembly）
 *
 * 在独立线程里运行：Silero VAD 切出一句话 → 中文离线识别 → 把文字发回页面。
 * 声音只在这个浏览器标签页里处理，不发往任何服务器。
 *
 * 消息：
 *   页面 → worker
 *     {type:"init", kind:"paraformer"|"zipformerCtc"|"senseVoice", files:{"model.onnx":ArrayBuffer,"tokens.txt":ArrayBuffer}}
 *     {type:"audio", samples:Float32Array}   // 16 kHz 单声道
 *     {type:"flush"}                          // 把还没说完的一句也识别出来
 *     {type:"reset"}
 *   worker → 页面
 *     {type:"ready", initMs}
 *     {type:"speaking", on:boolean}
 *     {type:"text", text, startSec, durSec, agoSec, decodeMs}
 *     {type:"flushed"}
 *     {type:"error", message}
 */
"use strict";
var SR = 16000;
var vad = null, buf = null, rec = null, fed = 0, speaking = false, readyAt = 0;
var pendingInit = null;

function post(m, t) { try { self.postMessage(m, t || []); } catch (_) {} }

self.Module = {
  locateFile: function (p) { return new URL(p, self.location.href).href; },
  print: function () {},
  printErr: function () {},
  onRuntimeInitialized: function () { readyAt = 1; if (pendingInit) { var m = pendingInit; pendingInit = null; init(m); } },
};

try {
  importScripts("sherpa-onnx-asr.js", "sherpa-onnx-vad.js", "sherpa-onnx-wasm-main-vad-asr.js");
} catch (e) {
  post({ type: "error", message: "本机听写组件没能加载：" + (e && e.message || e) });
}

function writeFile(name, ab) {
  try { self.Module.FS_unlink("/" + name); } catch (_) {}
  self.Module.FS_createDataFile("/", name, new Uint8Array(ab), true, false, false);
}

var vadBytes = null;
function init(msg) {
  if (msg.cacheName && msg.keys && !msg.files) {
    // 直接在 worker 里从浏览器缓存读模型，不占页面主线程
    var names = Object.keys(msg.keys);
    caches.open(msg.cacheName).then(function (c) {
      return Promise.all(names.map(function (n) {
        return c.match(msg.keys[n]).then(function (r) { if (!r) throw new Error("缓存里没有 " + n); return r.arrayBuffer(); });
      }));
    }).then(function (bufs) {
      var files = {};
      names.forEach(function (n, i) { files[n] = bufs[i]; });
      init({ kind: msg.kind, files: files });
    }).catch(function (e) { post({ type: "error", message: "本机听写模型读取失败：" + (e && e.message || e) }); });
    return;
  }
  if (!vadBytes) {
    // Silero VAD 模型（约 630 KB）随引擎一起放在本目录
    fetch(new URL("silero_vad.onnx", self.location.href).href)
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.arrayBuffer(); })
      .then(function (ab) { vadBytes = ab; init(msg); })
      .catch(function (e) { post({ type: "error", message: "本机听写的语音检测模型没能加载：" + (e && e.message || e) }); });
    return;
  }
  var t0 = Date.now();
  try {
    var files = msg.files || {};
    writeFile("silero_vad.onnx", vadBytes);
    for (var k in files) writeFile(k, files[k]);
    var mc = { debug: 0, tokens: "./tokens.txt", numThreads: 1, provider: "cpu" };
    if (msg.kind === "zipformerCtc") mc.zipformerCtc = { model: "./model.onnx" };
    else if (msg.kind === "senseVoice") mc.senseVoice = { model: "./model.onnx", useInverseTextNormalization: 0 };
    else mc.paraformer = { model: "./model.onnx" };
    rec = new OfflineRecognizer({ modelConfig: mc }, self.Module);
    if (!rec.handle) throw new Error("识别器创建失败（模型文件可能不完整）");
    vad = createVad(self.Module, {
      sileroVad: { model: "./silero_vad.onnx", threshold: 0.45, minSilenceDuration: 0.35, minSpeechDuration: 0.2, maxSpeechDuration: 12, windowSize: 512 },
      tenVad: { model: "", threshold: 0.5, minSilenceDuration: 0.5, minSpeechDuration: 0.25, maxSpeechDuration: 20, windowSize: 256 },
      sampleRate: SR, numThreads: 1, provider: "cpu", debug: 0, bufferSizeInSeconds: 30,
    });
    if (!vad.handle) throw new Error("语音检测器创建失败");
    buf = new CircularBuffer(30 * SR, self.Module);
    fed = 0;
    post({ type: "ready", initMs: Date.now() - t0 });
  } catch (e) {
    post({ type: "error", message: "本机听写初始化失败：" + (e && e.message || e) });
  }
}

function drain() {
  while (!vad.isEmpty()) {
    var seg = vad.front();
    vad.pop();
    var t0 = Date.now();
    var s = rec.createStream();
    s.acceptWaveform(SR, seg.samples);
    rec.decode(s);
    var r = rec.getResult(s);
    s.free();
    var text = String((r && r.text) || "").trim();
    segs++;
    if (text) {
      post({
        type: "text",
        text: text,
        startSec: seg.start / SR,
        durSec: seg.samples.length / SR,
        agoSec: Math.max(0, (fed - seg.start) / SR),
        postedAt: Date.now(),
        decodeMs: Date.now() - t0,
      });
    }
  }
}

var early = [], earlyN = 0;
function feed(x) {
  if (!vad) {
    // 模型还在载入：先存最多 20 秒，载入后补识别
    if (earlyN < 20 * SR) { early.push(x); earlyN += x.length; }
    return;
  }
  if (early.length) { var q = early; early = []; earlyN = 0; for (var i = 0; i < q.length; i++) feedNow(q[i]); }
  feedNow(x);
}
var segs = 0, lastStat = 0, peak = 0;
function feedNow(x) {
  for (var j = 0; j < x.length; j += 8) { var a = x[j] < 0 ? -x[j] : x[j]; if (a > peak) peak = a; }
  var now = Date.now();
  if (now - lastStat > 2000) { lastStat = now; post({ type: "stats", fedSec: fed / SR, speaking: speaking, segments: segs, peak: Math.round(peak * 1000) / 1000 }); peak = 0; }
  buf.push(x);
  var w = vad.config.sileroVad.windowSize;
  while (buf.size() > w) {
    var s = buf.get(buf.head(), w);
    vad.acceptWaveform(s);
    buf.pop(w);
    fed += w;
    var d = vad.isDetected();
    if (d !== speaking) { speaking = d; post({ type: "speaking", on: d }); }
    drain();
  }
}

self.onmessage = function (ev) {
  var m = ev.data || {};
  try {
    if (m.type === "port") {
      m.port.onmessage = function (e) { var d = e.data || {}; if (d.type === "audio") { try { feed(d.samples); } catch (err) { post({ type: "error", message: "本机听写出错：" + (err && err.message || err) }); } } };
    } else if (m.type === "init") {
      if (!readyAt) pendingInit = m; else init(m);
    } else if (m.type === "audio") {
      feed(m.samples);
    } else if (m.type === "flush") {
      if (vad) { if (early.length) feed(new Float32Array(0)); vad.flush(); drain(); }
      post({ type: "flushed" });
    } else if (m.type === "reset") {
      if (vad) vad.reset();
      if (buf) buf.reset();
      fed = 0; speaking = false;
    }
  } catch (e) {
    post({ type: "error", message: "本机听写出错：" + (e && e.message || e) });
  }
};
