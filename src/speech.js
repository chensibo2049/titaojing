import { FILLER_RE as DEFAULT_RE, buildFillerRe, SINGLE_CHAR_FILLERS } from "./constants.js";

const SpeechRec = typeof window !== "undefined" &&
  (window.SpeechRecognition || window.webkitSpeechRecognition);

export function speechSupported() {
  return !!SpeechRec;
}

export function startSpeech({ onFiller, onStatus, onHeard, onDebug, onTranscript, lang = "zh-CN", fillers = null, sensitivity = "mid" }) {
  let list = fillers && fillers.length ? fillers : null;
  // 低灵敏度：不统计单字语气词（嗯、啊、呃、额），只看「然后」「就是」等。
  if (list && sensitivity === "low") list = list.filter((w) => !SINGLE_CHAR_FILLERS.includes(w));
  const FILLER_RE = list ? buildFillerRe(list) : DEFAULT_RE;
  if (!SpeechRec) {
    onStatus && onStatus({
      ok: false,
      message: "口头禅听写需要 Chrome 或 Edge，并允许使用麦克风。教态和视线仍会画在画面上。",
    });
    if (onDebug) onDebug("unsupported", "此浏览器没有 SpeechRecognition");
    return { stop() {}, pause() {}, resume() {}, supported: false };
  }

  let rec = null;
  let stopped = false;
  let seen = "";
  let restarts = 0;
  const dbg = (kind, detail, extra) => { if (onDebug) { try { onDebug(kind, detail, extra); } catch (_) {} } };

  const start = () => {
    if (stopped) return;
    seen = "";
    rec = new SpeechRec();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (ev) => {
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
        onStatus && onStatus({
          ok: false,
          message: "麦克风或语音识别未被允许，口头禅这一层暂时听不到。教态和视线仍可分析。",
        });
      } else if (e.error === "network") {
        onStatus && onStatus({ ok: false, message: "语音识别需要联网（浏览器自带服务）。当前听不到口头禅，教态和视线仍在分析。" });
      } else if (e.error === "language-not-supported") {
        stopped = true;
        onStatus && onStatus({ ok: false, message: "这个浏览器不支持所选的识别语言。可在设置里改回「普通话（zh-CN）」。" });
      }
    };
    rec.onstart = () => dbg("listening", `restarts=${restarts}`);
    rec.onend = () => {
      dbg("ended", stopped ? "已停止" : "将自动重启");
      if (!stopped) {
        restarts += 1;
        if (restarts > 40) return; // 避免在不稳定环境里无限重启
        setTimeout(() => { try { start(); } catch (_) { /* give up */ } }, 250);
      }
    };
    try {
      rec.start();
      dbg("starting", lang);
      onStatus && onStatus({ ok: true, message: "" });
    } catch (err) {
      onStatus && onStatus({
        ok: false,
        message: "口头禅听写未能启动。请改用 Chrome 或 Edge。教态和视线仍可分析。",
      });
    }
  };

  start();
  return {
    supported: true,
    pause() {
      stopped = true;
      try { rec && rec.stop(); } catch (_) {}
    },
    resume() {
      if (!stopped) return;
      stopped = false;
      seen = "";
      restarts = 0;
      try { start(); } catch (_) {}
    },
    stop() {
      stopped = true;
      try { rec && rec.stop(); } catch (_) {}
    },
  };
}
