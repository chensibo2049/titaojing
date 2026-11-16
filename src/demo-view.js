// Small lifecycle controller in the entry bundle. The Three module is never eagerly imported.
import { BUILD_ID } from "./version.js";
export function preferDemo2D(env = globalThis) {
  const nav = env.navigator || {};
  return (nav.deviceMemory > 0 && nav.deviceMemory <= 2) || (nav.hardwareConcurrency > 0 && nav.hardwareConcurrency <= 2)
    || new URLSearchParams(env.location?.search || "").get("demoRenderer") === "2d";
}
export function createDemoView({ load = () => import(new URL(`assets/demo-presenter.js?v=${BUILD_ID}`, document.baseURI).href), lowPower = preferDemo2D, onReady = () => {} } = {}) {
  let epoch = 0, instance = null, host = null, state = "off", time = 0, error = "", failedHandler = null;
  function dispose() {
    epoch++; instance?.dispose(); instance = null;
    if (host) { host.removeEventListener("presenterfailed", failedHandler); host.remove(); }
    host = null; state = "off"; error = "";
  }
  function fail(reason) {
    instance?.dispose(); instance = null; state = "fallback"; error = String(reason?.message || reason || "WebGL 不可用");
    host?.remove(); onReady();
  }
  async function mount(stage) {
    dispose(); const own = epoch;
    if (lowPower()) { state = "fallback"; error = "低性能设备或已选择简洁模式"; onReady(); return; }
    state = "loading"; host = document.createElement("div"); host.className = "demo-presenter-host"; stage.append(host);
    failedHandler = () => fail("WebGL 上下文已丢失"); host.addEventListener("presenterfailed", failedHandler);
    try {
      const mod = await load(); if (own !== epoch) return;
      const next = mod.mountDemoPresenter(host);
      if (own !== epoch) { next.dispose(); return; }
      instance = next; state = "ready"; instance.setTime(time); onReady();
    } catch (e) { if (own === epoch) fail(e); }
  }
  return { mount, dispose, setTime(t) { time = t; instance?.setTime(t); },
    status: () => ({ ...(instance?.diagnostics() || {}), state, error }) };
}
