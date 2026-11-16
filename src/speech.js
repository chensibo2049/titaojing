import { FILLER_RE as DEFAULT_RE, buildFillerRe, SINGLE_CHAR_FILLERS } from "./constants.js";

const SpeechRec = typeof window !== "undefined" &&
  (window.SpeechRecognition || window.webkitSpeechRecognition);

export const NETWORK_SPEECH_MSG = "浏览器听写没能连上厂商的语音服务。即便这个页面已经打开、电脑也有网，Chrome 的听写通常要把声音送到国外的服务，在中国大陆经常连不上。这不是你没联网。教态和视线仍可分析。可以改用 Microsoft Edge 再试，检查是否允许了麦克风，或等本机听写可用后再统计口头禅。";

export const MIC_DENIED_MSG = "麦克风或语音识别未被允许，口头禅这一层暂时听不到。教态和视线仍可分析。";

export function speechSupported() {
  return !!SpeechRec;
}

export function speechSupportReason() {
  if (SpeechRec) return { ok: true, message: "可以使用浏览器听写（Chrome / Edge 会把声音送到厂商的语音服务，不经过沉思波）。" };
  return { ok: false, message: "口头禅听写需要 Chrome 或 Edge，并允许使用麦克风。当前浏览器没有网页听写。教态和视线仍会画在画面上。" };
}

/** 在启动听写之前明确申请一次麦克风权限。 */
export async function requestMicAccess() {
  if (typeof navigator === "undefined" || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return { ok: false, message: "这个浏览器没有麦克风接口。" };
  }
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return { ok: true, stream };
  } catch (e) {
    const name = e && e.name;
    const denied = name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError";
    return { ok: false, message: denied ? MIC_DENIED_MSG : "没能打开麦克风，口头禅这一层暂时听不到。教态和视线仍可分析。" };
  }
}

function stopProbe(stream) {
  try { (stream && stream.getTracks ? stream.getTracks() : []).forEach((t) => t.stop()); } catch (_) {}
}

/**
 * 试听 3–5 秒，看浏览器听写是否能出字。
 * 返回 { ok, text, reason, error }。
 */
export function preflightSpeech({ lang = "zh-CN", seconds = 4, onStatus } = {}) {
  return new Promise(async (resolve) => {
    const done = (result) => {
      try { rec && rec.abort && rec.abort(); } catch (_) {}
      try { rec && rec.stop && rec.stop(); } catch (_) {}
      resolve(result);
    };
    if (!SpeechRec) {
      const r = { ok: false, text: "", reason: speechSupportReason().message, error: "unsupported" };
      onStatus && onStatus(r);
      return done(r);
    }
    const mic = await requestMicAccess();
    if (!mic.ok) {
      const r = { ok: false, text: "", reason: mic.message, error: "not-allowed" };
      onStatus && onStatus(r);
      return done(r);
    }
    stopProbe(mic.stream);

    let rec = null;
    let text = "";
    let settled = false;
    let errorKind = "";
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      onStatus && onStatus(result);
      done(result);
    };
    const timer = setTimeout(() => {
      if (text.trim()) finish({ ok: true, text: text.trim(), reason: "听到了：「" + text.trim() + "」", error: "" });
      else finish({
        ok: false,
        text: "",
        reason: "试了几秒，没有听到可写出的字。请对着麦克风说一句话再试；若反复出现网络方面的失败，见关于页对浏览器听写的说明。",
        error: "empty",
      });
    }, Math.round((seconds || 4) * 1000));

    try {
      rec = new SpeechRec();
      rec.lang = lang;
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.onresult = (ev) => {
        let piece = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) piece += ev.results[i][0].transcript || "";
        if (piece.trim()) text = (text + piece).trim();
        if (text && ev.results[ev.results.length - 1]?.isFinal) {
          finish({ ok: true, text, reason: "听到了：「" + text + "」", error: "" });
        }
      };
      rec.onerror = (e) => {
        errorKind = e.error || "error";
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          finish({ ok: false, text: "", reason: MIC_DENIED_MSG, error: e.error });
        } else if (e.error === "network") {
          finish({ ok: false, text: "", reason: NETWORK_SPEECH_MSG, error: "network" });
        } else if (e.error === "language-not-supported") {
          finish({ ok: false, text: "", reason: "这个浏览器不支持所选的识别语言。可在设置里改回「普通话（zh-CN）」。", error: e.error });
        }
        // no-speech / aborted: wait for the timer
      };
      rec.start();
    } catch (err) {
      finish({ ok: false, text: "", reason: "口头禅听写未能启动。请改用 Chrome 或 Edge。教态和视线仍可分析。", error: "start-failed" });
    }
  });
}

export function startSpeech({ onFiller, onStatus, onHeard, onDebug, onTranscript, lang = "zh-CN", fillers = null, sensitivity = "mid" } = {}) {
  let list = fillers && fillers.length ? fillers : null;
  // 低灵敏度：不统计单字语气词（嗯、啊、呃、额），只看「然后」「就是」等。
  if (list && sensitivity === "low") list = list.filter((w) => !SINGLE_CHAR_FILLERS.includes(w));
  const FILLER_RE = list ? buildFillerRe(list) : DEFAULT_RE;
  if (!SpeechRec) {
    onStatus && onStatus({
      ok: false,
      engine: "none",
      message: speechSupportReason().message,
    });
    if (onDebug) onDebug("unsupported", "此浏览器没有 SpeechRecognition");
    return { stop() {}, pause() {}, resume() {}, supported: false, engine: "none" };
  }

  let rec = null;
  let stopped = false;
  let seen = "";
  let restarts = 0;
  let networkFails = 0;
  const ended = new WeakSet();
  let finishStop = null;
  let stopPromise = null;
  let closed = false;
  const MAX_NETWORK = 4;
  const dbg = (kind, detail, extra) => { if (onDebug) { try { onDebug(kind, detail, extra); } catch (_) {} } };

  const start = () => {
    if (stopped) return;
    seen = "";
    rec = new SpeechRec();
    const recognition = rec;
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (ev) => {
      if (closed || rec !== recognition) return;
      networkFails = 0;
      let text = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        text += ev.results[i][0].transcript || "";
      }
      const full = text;
      if (onTranscript || onDebug) {
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const piece = ev.results[i][0].transcript || "";
          const fin = !!ev.results[i].isFinal;
          if (onDebug) dbg("transcript", piece, { final: fin });
          if (onTranscript && piece.trim()) onTranscript({ text: piece.trim(), final: fin });
        }
      }
      if (text.trim() && onHeard) onHeard();
      // Only scan the newly appeared tail.
      let added = full;
      if (full.startsWith(seen)) added = full.slice(seen.length);
      seen = full.slice(-80);
      if (!FILLER_RE) return;
      FILLER_RE.lastIndex = 0;
      let m;
      const found = [];
      while ((m = FILLER_RE.exec(added))) found.push(m[1]);
      for (const word of found) onFiller && onFiller(word);
    };
    rec.onerror = (e) => {
      dbg("error", e.error + (e.message ? ": " + e.message : ""));
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        stopped = true;
        onStatus && onStatus({ ok: false, engine: "webspeech", message: MIC_DENIED_MSG, sticky: true });
      } else if (e.error === "network") {
        networkFails += 1;
        const giveUp = networkFails >= MAX_NETWORK;
        if (giveUp) stopped = true;
        onStatus && onStatus({
          ok: false,
          engine: "webspeech",
          message: NETWORK_SPEECH_MSG + (giveUp ? "已停止反复重试，以免一直转圈。教态和视线不受影响。" : ""),
          sticky: true,
          networkFails,
        });
      } else if (e.error === "language-not-supported") {
        stopped = true;
        onStatus && onStatus({ ok: false, engine: "webspeech", message: "这个浏览器不支持所选的识别语言。可在设置里改回「普通话（zh-CN）」。", sticky: true });
      }
    };
    rec.onstart = () => dbg("listening", `restarts=${restarts} networkFails=${networkFails}`);
    rec.onend = () => {
      ended.add(recognition);
      if (rec !== recognition) return;
      if (finishStop) finishStop();
      dbg("ended", stopped ? "已停止" : "将自动重启");
      if (!stopped) {
        restarts += 1;
        if (restarts > 40 || networkFails >= MAX_NETWORK) return;
        setTimeout(() => { try { start(); } catch (_) { /* give up */ } }, 250);
      }
    };
    try {
      rec.start();
      dbg("starting", lang);
      onStatus && onStatus({ ok: true, engine: "webspeech", message: "" });
    } catch (err) {
      onStatus && onStatus({
        ok: false,
        engine: "none",
        message: "口头禅听写未能启动。请改用 Chrome 或 Edge。教态和视线仍可分析。",
        sticky: true,
      });
    }
  };

  const boot = async () => {
    if (stopped) return;
    const mic = await requestMicAccess();
    if (!mic.ok) {
      stopped = true;
      onStatus && onStatus({ ok: false, engine: "none", message: mic.message, sticky: true });
      if (onDebug) dbg("mic", mic.message);
      return;
    }
    stopProbe(mic.stream);
    if (stopped) return;
    start();
  };
  boot();

  return {
    supported: true,
    engine: "webspeech",
    pause() {
      stopped = true;
      try { rec && rec.stop(); } catch (_) {}
    },
    resume() {
      if (!stopped || stopPromise) return;
      stopped = false;
      seen = "";
      restarts = 0;
      networkFails = 0;
      boot();
    },
    stop(timeoutMs = 2500) {
      if (stopPromise) return stopPromise;
      stopped = true;
      if (!rec || ended.has(rec)) { closed = true; return Promise.resolve(); }
      stopPromise = new Promise((resolve, reject) => {
        const done = (error) => {
          if (!finishStop) return;
          clearTimeout(timer);
          finishStop = null;
          closed = true;
          if (error) reject(error); else resolve();
        };
        const timer = setTimeout(() => {
          done(new Error("浏览器听写收尾超时，转写可能不完整。"));
          try { rec.abort(); } catch (_) {}
        }, timeoutMs);
        finishStop = done;
        try { rec.stop(); } catch (error) { done(error); }
      });
      return stopPromise;
    },
  };
}
