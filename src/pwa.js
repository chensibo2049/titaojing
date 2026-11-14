/** Service worker registration, update notice, and install prompt. */
import { BUILD_ID } from "./version.js";
import { logEvent } from "./diagnostics.js";

let deferredPrompt = null;
const listeners = new Set();
let swReg = null;
let swInfo = { supported: "serviceWorker" in navigator, registered: false, error: "" };

export function pwaState() {
  const standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return {
    canPrompt: !!deferredPrompt,
    standalone,
    iosHint: ios && !standalone,
    sw: { ...swInfo, controlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller) },
  };
}

export function onPwaChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const notify = () => listeners.forEach((fn) => { try { fn(pwaState()); } catch (_) {} });

export async function promptInstall() {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  const choice = await deferredPrompt.userChoice.catch(() => null);
  deferredPrompt = null;
  notify();
  return choice && choice.outcome === "accepted";
}

export function initPwa({ onUpdateReady } = {}) {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    logEvent("pwa", "installed");
    notify();
  });

  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") return;
  if (/[?&]nosw\b/.test(location.search)) return;
  if (BUILD_ID === "dev") return; // 源码目录调试时不注册，避免缓存干扰；dist/ 构建才启用离线

  const register = () => {
    navigator.serviceWorker.register(`sw.js?v=${encodeURIComponent(BUILD_ID)}`).then((reg) => {
      swReg = reg;
      swInfo.registered = true;
      notify();
      const watch = (w) => {
        if (!w) return;
        w.addEventListener("statechange", () => {
          if (w.state === "installed" && navigator.serviceWorker.controller) onUpdateReady && onUpdateReady(applyUpdate);
        });
      };
      if (reg.waiting && navigator.serviceWorker.controller) onUpdateReady && onUpdateReady(applyUpdate);
      watch(reg.installing);
      reg.addEventListener("updatefound", () => watch(reg.installing));
    }).catch((err) => {
      swInfo.error = String(err && err.message || err);
      logEvent("sw-error", swInfo.error);
      notify();
    });
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register);

  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading || !window.__titaojingApplyingUpdate) return;
    reloading = true;
    location.reload();
  });
}

function applyUpdate() {
  window.__titaojingApplyingUpdate = true;
  if (swReg && swReg.waiting) swReg.waiting.postMessage({ type: "SKIP_WAITING" });
  else location.reload();
}

/** Ask the SW to download models now, for offline use later. */
export async function precacheModels(onProgress) {
  const urls = [
    "assets/mediapipe/models/pose_landmarker_lite.task",
    "assets/mediapipe/models/face_landmarker.task",
    "assets/mediapipe/wasm/vision_wasm_internal.wasm",
    "assets/mediapipe/wasm/vision_wasm_internal.js",
  ];
  let done = 0;
  for (const u of urls) {
    const res = await fetch(u, { cache: "force-cache" });
    if (!res.ok) throw new Error(`${u} ${res.status}`);
    await res.arrayBuffer();
    done += 1;
    onProgress && onProgress(done, urls.length);
  }
  return true;
}
