/** Camera / microphone access with friendly, fixable error states. */

export function envInfo() {
  const ua = navigator.userAgent || "";
  return {
    ua,
    wechat: /MicroMessenger/i.test(ua),
    qq: /\bQQ\//i.test(ua) && !/MQQBrowser/i.test(ua),
    ios: /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
    android: /Android/i.test(ua),
    safari: /Safari/i.test(ua) && !/Chrome|CriOS|Edg|FxiOS|EdgiOS/i.test(ua),
    chromeLike: /Chrome|CriOS|Edg/i.test(ua),
    file: location.protocol === "file:",
    secure: !!window.isSecureContext,
    hasMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
    hasRecorder: typeof window.MediaRecorder !== "undefined",
  };
}

/** Pre-flight: returns null if OK, or an error code for the error screen. */
export function preflight() {
  const e = envInfo();
  if (e.file) return "file";
  if (!e.secure) return "insecure";
  if (!e.hasMedia) return e.wechat || e.qq ? "inapp" : "unsupported";
  return null;
}

export function classifyError(err) {
  const name = err && err.name;
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") return "nocamera";
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return "busy";
  return "unknown";
}

function videoConstraints({ facing, deviceId }) {
  const portrait = window.innerHeight > window.innerWidth;
  const v = {
    width: { ideal: portrait ? 720 : 1280 },
    height: { ideal: portrait ? 1280 : 720 },
    frameRate: { ideal: 30, max: 30 },
  };
  if (deviceId) v.deviceId = { exact: deviceId };
  else v.facingMode = { ideal: facing || "user" };
  return v;
}

/**
 * Try video+audio, then relaxed constraints, then video-only.
 * Resolves { stream, audio: bool, note } or throws { code, err }.
 */
export async function openCamera({ facing = "user", deviceId = "" } = {}) {
  const pre = preflight();
  if (pre) throw { code: pre };
  const attempts = [
    { video: videoConstraints({ facing, deviceId }), audio: { echoCancellation: true, noiseSuppression: true } },
    { video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: facing }, audio: true },
    { video: true, audio: true },
    { video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: facing }, audio: false },
    { video: true, audio: false },
  ];
  let lastErr = null;
  for (const c of attempts) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(c);
      return { stream, audio: stream.getAudioTracks().length > 0 };
    } catch (err) {
      lastErr = err;
      // A hard denial will not change with looser constraints, except microphone-only denial:
      // keep going so we can fall back to video-only.
      if (classifyError(err) === "busy" && c.audio === false) break;
    }
  }
  throw { code: classifyError(lastErr), err: lastErr };
}

export async function listCameras() {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === "videoinput").map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label || `摄像头 ${i + 1}`,
    }));
  } catch (_) {
    return [];
  }
}

export function stopStream(stream) {
  if (!stream) return;
  for (const t of stream.getTracks()) { try { t.stop(); } catch (_) {} }
}

export function streamFacing(stream) {
  const t = stream && stream.getVideoTracks()[0];
  const s = t && t.getSettings ? t.getSettings() : {};
  return { facingMode: s.facingMode || "", width: s.width || 0, height: s.height || 0, deviceId: s.deviceId || "", label: t?.label || "" };
}

/* ——— Screen Wake Lock ——— */
let wakeLock = null;
let wantWake = false;

export async function keepAwake(on) {
  wantWake = on;
  if (!("wakeLock" in navigator)) return false;
  try {
    if (on && !wakeLock) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
    return true;
  } catch (_) {
    return false;
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && wantWake && !wakeLock) keepAwake(true);
});

export function wakeLockSupported() {
  return "wakeLock" in navigator;
}

/** Copy for each error screen: title, why, steps. */
export function errorCopy(code) {
  const e = envInfo();
  const url = location.href.split("#")[0];
  const inapp = e.wechat ? "微信" : e.qq ? "QQ" : "当前 App";
  switch (code) {
    case "file":
      return {
        title: "请用网址打开，而不是直接双击文件",
        why: "浏览器在 file:// 下不允许网页使用镜头和麦克风。",
        steps: [
          "在本程序文件夹里运行 ./start.sh（Windows 可运行 python -m http.server 8765）",
          "用 Chrome 或 Edge 打开 http://127.0.0.1:8765/",
          "或直接使用部署好的 https 网址",
        ],
        canRetry: false,
      };
    case "insecure":
      return {
        title: "需要 https 安全连接",
        why: `当前地址（${location.protocol}//${location.host}）不是安全连接，浏览器会拒绝摄像头。只有 https:// 或本机 localhost 才可以。`,
        steps: [
          "请使用部署在 https 下的正式网址",
          "本机测试请用 http://localhost:8765 或 http://127.0.0.1:8765",
          "手机测试不要用电脑的局域网 IP（如 http://192.168…），请改用 https 网址",
        ],
        canRetry: false,
      };
    case "inapp":
      return {
        title: `${inapp}内置浏览器暂时打不开镜头`,
        why: `${inapp}内置浏览器对摄像头、录像和语音识别支持有限。`,
        steps: [
          "点右上角「…」，选择「在浏览器中打开」",
          "iPhone 请用 Safari，安卓请用 Chrome、Edge 或系统浏览器",
          "「一键演示」在这里仍然可以看",
        ],
        canRetry: true,
        copyUrl: url,
      };
    case "unsupported":
      return {
        title: "这个浏览器不支持摄像头",
        why: "当前浏览器没有提供网页摄像头接口（getUserMedia）。",
        steps: ["请换用最新版 Chrome、Edge（电脑 / 安卓）或 Safari（iPhone、iPad）", "「一键演示」不需要摄像头，仍然可以看"],
        canRetry: false,
        copyUrl: url,
      };
    case "denied":
      return {
        title: "没有获得镜头权限",
        why: "你或浏览器拒绝了摄像头 / 麦克风。画面只在本机分析，不会上传。",
        steps: e.ios
          ? ["iPhone：打开「设置 → Safari → 摄像头 / 麦克风」，改为「询问」或「允许」", "或点地址栏左侧「大小」图标 → 网站设置 → 允许摄像头", "回到这里点「重试」"]
          : e.android
            ? ["点地址栏左侧的锁形图标 → 权限 → 允许摄像头和麦克风", "若仍不行：系统设置 → 应用 → 浏览器 → 权限 → 打开相机和麦克风", "回到这里点「重试」"]
            : ["点地址栏左侧的锁形 / 摄像头图标，把摄像头和麦克风改为「允许」", "Mac 还需在「系统设置 → 隐私与安全性 → 摄像头」中勾选浏览器", "然后点「重试」或刷新页面"],
        canRetry: true,
      };
    case "nocamera":
      return {
        title: "没有找到可用的摄像头",
        why: "这台设备似乎没有摄像头，或摄像头已被系统停用。",
        steps: ["台式机请接上 USB 摄像头后点「重试」", "在设置里把镜头切回「前置」再试", "也可以先看「一键演示」"],
        canRetry: true,
      };
    case "busy":
      return {
        title: "摄像头正被其他程序占用",
        why: "腾讯会议、微信视频、Zoom 或另一个浏览器标签可能正在使用摄像头。",
        steps: ["关闭正在使用摄像头的程序或标签页", "然后点「重试」", "仍不行时重启浏览器"],
        canRetry: true,
      };
    default:
      return {
        title: "没能打开镜头",
        why: "浏览器没有给出明确原因。",
        steps: ["刷新页面后重试", "换用最新版 Chrome / Edge / Safari", "仍有问题请在「反馈问题」里提交，会自动附上设备信息"],
        canRetry: true,
      };
  }
}
