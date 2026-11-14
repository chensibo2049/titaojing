/* 沉思波 · 体态镜 Service Worker
 * BUILD_ID is replaced at build time; a new build = a new shell cache (cache busting).
 * Models/WASM live in a separate cache keyed by the MediaPipe version, so app updates
 * do not force testers to re-download ~21 MB.
 */
const BUILD_ID = "__BUILD_ID__";
const SHELL_CACHE = `titaojing-shell-${BUILD_ID}`;
const MODEL_CACHE = "titaojing-models-mp0.10.32";
const SHELL = [
  "./",
  "index.html",
  `assets/app.bundle.js?v=${BUILD_ID}`,
  `assets/app.css?v=${BUILD_ID}`,
  `config.js?v=${BUILD_ID}`,
  "manifest.webmanifest",
  "assets/favicon.svg",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/icon-maskable-512.png",
  "assets/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))),
  );
  // Do not skipWaiting automatically: the page shows「刷新使用新版」so a live 试讲 is never interrupted.
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith("titaojing-") && k !== SHELL_CACHE && k !== MODEL_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

const isModel = (url) => url.pathname.includes("/assets/mediapipe/");

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.headers.has("range")) return;

  // Navigations: network first, fall back to cached shell (offline).
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const c = await caches.open(SHELL_CACHE);
        c.put("index.html", res.clone());
        return res;
      } catch (_) {
        const c = await caches.open(SHELL_CACHE);
        return (await c.match("index.html")) || (await c.match("./")) || Response.error();
      }
    })());
    return;
  }

  // Models / WASM: cache first (large, immutable per MediaPipe version).
  if (isModel(url)) {
    event.respondWith((async () => {
      const c = await caches.open(MODEL_CACHE);
      const hit = await c.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    })());
    return;
  }

  // config.js: network first so deploy-time edits apply; cached copy offline.
  if (url.pathname.endsWith("/config.js")) {
    event.respondWith((async () => {
      const c = await caches.open(SHELL_CACHE);
      try {
        const res = await fetch(req, { cache: "no-store" });
        if (res.ok) c.put(req, res.clone());
        return res;
      } catch (_) {
        return (await c.match(req, { ignoreSearch: true })) || Response.error();
      }
    })());
    return;
  }

  // Everything else (shell assets): cache first, then network and store.
  event.respondWith((async () => {
    const c = await caches.open(SHELL_CACHE);
    const hit = await c.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && res.type === "basic") c.put(req, res.clone());
    return res;
  })());
});
