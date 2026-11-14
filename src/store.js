/** Local history in IndexedDB. Nothing here ever leaves the device. */
const DB_NAME = "titaojing";
const DB_VER = 2;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) { reject(new Error("no-indexeddb")); return; }
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("sessions")) {
        const s = db.createObjectStore("sessions", { keyPath: "id" });
        s.createIndex("startedAt", "startedAt");
      }
      if (!db.objectStoreNames.contains("videos")) db.createObjectStore("videos", { keyPath: "id" });
      if (!db.objectStoreNames.contains("profile")) db.createObjectStore("profile", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("indexeddb-blocked"));
  });
  dbp.catch(() => { dbp = null; });
  return dbp;
}

function tx(stores, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let out;
    Promise.resolve(fn(t)).then((v) => { out = v; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("aborted"));
  }));
}

const reqP = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

export function storeAvailable() {
  return open().then(() => true, () => false);
}

export async function putSession(rec, videoBlob) {
  return tx(["sessions", "videos"], "readwrite", (t) => {
    t.objectStore("sessions").put(rec);
    if (videoBlob) t.objectStore("videos").put({ id: rec.id, blob: videoBlob, type: videoBlob.type, size: videoBlob.size });
  });
}

export async function putVideo(id, blob) {
  return tx(["videos"], "readwrite", (t) => { t.objectStore("videos").put({ id, blob, type: blob.type, size: blob.size }); });
}

export async function getSession(id) {
  return tx(["sessions"], "readonly", (t) => reqP(t.objectStore("sessions").get(id)));
}

export async function getVideo(id) {
  const r = await tx(["videos"], "readonly", (t) => reqP(t.objectStore("videos").get(id)));
  return r ? r.blob : null;
}

/** Newest first. Strips heavy frame data unless full=true. */
export async function listSessions({ full = false } = {}) {
  const all = await tx(["sessions"], "readonly", (t) => reqP(t.objectStore("sessions").getAll()));
  all.sort((a, b) => b.startedAt - a.startedAt);
  if (full) return all;
  return all.map(({ frames, ...rest }) => rest);
}

export async function deleteSession(id) {
  return tx(["sessions", "videos"], "readwrite", (t) => {
    t.objectStore("sessions").delete(id);
    t.objectStore("videos").delete(id);
  });
}

export async function deleteVideo(id) {
  const s = await getSession(id);
  return tx(["sessions", "videos"], "readwrite", (t) => {
    t.objectStore("videos").delete(id);
    if (s) t.objectStore("sessions").put({ ...s, hasVideo: false, videoSize: 0 });
  });
}

export async function clearAll() {
  return tx(["sessions", "videos"], "readwrite", (t) => {
    t.objectStore("sessions").clear();
    t.objectStore("videos").clear();
  });
}

export async function usage() {
  let sessionsBytes = 0, videoBytes = 0, count = 0, videos = 0;
  try {
    const all = await tx(["sessions"], "readonly", (t) => reqP(t.objectStore("sessions").getAll()));
    count = all.length;
    for (const s of all) {
      sessionsBytes += JSON.stringify(s).length;
      if (s.hasVideo) { videos += 1; videoBytes += s.videoSize || 0; }
    }
  } catch (_) {}
  let quota = 0, used = 0, persisted = false;
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const e = await navigator.storage.estimate();
      quota = e.quota || 0;
      used = e.usage || 0;
    }
    if (navigator.storage && navigator.storage.persisted) persisted = await navigator.storage.persisted();
  } catch (_) {}
  return { count, videos, sessionsBytes, videoBytes, quota, used, persisted };
}

export async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch (_) {}
  return false;
}

const PROFILE_ID = "local";

export async function getProfile() {
  return tx(["profile"], "readonly", (t) => reqP(t.objectStore("profile").get(PROFILE_ID))).then((r) => r || null);
}

export async function saveProfile(patch) {
  const prev = (await getProfile()) || { id: PROFILE_ID, createdAt: Date.now() };
  const next = {
    id: PROFILE_ID,
    displayName: String(patch.displayName ?? prev.displayName ?? "").trim().slice(0, 40),
    school: String(patch.school ?? prev.school ?? "").trim().slice(0, 60),
    dept: String(patch.dept ?? prev.dept ?? "").trim().slice(0, 40),
    createdAt: prev.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  await tx(["profile"], "readwrite", (t) => t.objectStore("profile").put(next));
  return next;
}

export async function clearProfile() {
  return tx(["profile"], "readwrite", (t) => t.objectStore("profile").delete(PROFILE_ID));
}
