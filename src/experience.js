/**
 * 体验计划：在用户明确同意后，把「本来会发送」的抽样数据排进本机队列。
 * 默认不发送。config.js 的 experienceEndpoint 为空时，flush 只记录「将要发往何处」，不会发到任何地方。
 *
 * 可能入队的内容（可在关于页查看、删除）：
 *   - fillers：本次用到的口头禅词表与命中统计
 *   - transcript：转写文本（含水词标记，不含音频）
 *   - summary：教态 / 视线 / 板书次数与诊断两句话（不含关键点序列）
 *   - screenshots：最多 3 张回放画面截图（jpeg，不含录像）
 * 录像、麦克风音频默认不入队，也不会上传。
 */
import { experienceOn } from "./consent.js";
import { APP_VERSION, BUILD_ID } from "./version.js";

const DB = "titaojing-experience";
const STORE = "queue";

function open() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) { reject(new Error("no-idb")); return; }
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: "id" }); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export function experienceConfig() {
  const c = window.TITAOJING_CONFIG || {};
  return {
    endpoint: String(c.experienceEndpoint || ""),
    maxScreenshots: Number(c.experienceMaxScreenshots || 3),
    sampleRate: Number(c.experienceSampleRate || 1), // 1 = 每次都入队（仍需同意）
  };
}

function newId() {
  return `xp${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** 试讲结束后：仅在已同意体验计划时入队。截图由调用方传入（已是 jpeg dataURL 数组）。 */
export async function maybeEnqueue(session, { screenshots = [] } = {}) {
  if (!experienceOn()) return { queued: false, reason: "no-consent" };
  const cfg = experienceConfig();
  if (cfg.sampleRate < 1 && Math.random() > cfg.sampleRate) return { queued: false, reason: "not-sampled" };
  const fillers = {};
  for (const e of session.speech || []) fillers[e.word] = (fillers[e.word] || 0) + 1;
  const item = {
    id: newId(),
    createdAt: new Date().toISOString(),
    status: "queued", // queued | sent | failed
    app: { version: APP_VERSION, buildId: BUILD_ID },
    kind: session.kind,
    duration: Math.round(session.duration || 0),
    frameMode: session.frameResolved || session.frameMode || null,
    sessionMode: session.sessionMode || null,
    fillers,
    transcript: (session.transcript || []).map((t) => ({ t: t.t, text: t.text })),
    summary: {
      counts: session.diagnosis?.counts || {},
      classRatio: session.diagnosis?.classRatio,
      notesRatio: session.diagnosis?.notesRatio,
      good: session.diagnosis?.good || "",
      next: session.diagnosis?.next || "",
    },
    screenshots: (screenshots || []).slice(0, cfg.maxScreenshots),
    hasVideo: false, // 明确：不附录像
    hasAudio: false,
  };
  try {
    const db = await open();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(item);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    return { queued: true, id: item.id, bytes: JSON.stringify(item).length };
  } catch (e) {
    return { queued: false, reason: e.message };
  }
}

export async function listQueue() {
  try {
    const db = await open();
    const rows = await reqP(db.transaction(STORE, "readonly").objectStore(STORE).getAll());
    return (rows || []).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  } catch (_) { return []; }
}

export async function deleteItem(id) {
  const db = await open();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearQueue() {
  const db = await open();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 尝试把队列发给 experienceEndpoint。
 * 端点为空或未经同意时：什么也不发，返回 { sent: 0, skipped: 'no-endpoint' | 'no-consent' }。
 */
export async function flushQueue() {
  if (!experienceOn()) return { sent: 0, skipped: "no-consent" };
  const { endpoint } = experienceConfig();
  if (!endpoint) return { sent: 0, skipped: "no-endpoint", note: "config.js 里的 experienceEndpoint 为空，当前版本不会向任何地址发送。" };
  const items = (await listQueue()).filter((x) => x.status !== "sent");
  let sent = 0, failed = 0;
  for (const it of items) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...it, screenshots: it.screenshots?.map((s) => s.slice(0, 80) + "…") && it.screenshots }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      it.status = "sent";
      it.sentAt = new Date().toISOString();
      const db = await open();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(it);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      sent++;
    } catch (e) {
      it.status = "failed";
      it.lastError = String(e.message || e).slice(0, 200);
      failed++;
      try {
        const db = await open();
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, "readwrite");
          tx.objectStore(STORE).put(it);
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
      } catch (_) {}
    }
  }
  return { sent, failed };
}

export function describeItem(it) {
  const nShot = (it.screenshots || []).length;
  const nTx = (it.transcript || []).length;
  const nFill = Object.keys(it.fillers || {}).length;
  return `${it.createdAt?.slice(0, 16).replace("T", " ")} · 转写 ${nTx} 句 · 水词 ${nFill} 种 · 截图 ${nShot} 张 · ${it.status === "sent" ? "已发送" : it.status === "failed" ? "发送失败" : "待发送"}`;
}
