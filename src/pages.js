/** Secondary pages: 历史记录、进步对比、设置、反馈问题、关于与隐私. */
import { mountLocalAsr } from "./asr-ui.js";
import { $, esc, toast, confirmBox, downloadBlob, copyText, modal } from "./ui.js";
import { listSessions, deleteSession, deleteVideo, clearAll, usage, putSession, getSession, requestPersist } from "./store.js";
import { fmtDate, fmtShortDate, fmtBytes, fmtDur } from "./records.js";
import { getSettings, saveSettings, resetSettings, SESSION_MODES, FRAME_MODES, DEFAULT_SETTINGS } from "./settings.js";
import { getLicense, activate, deactivate } from "./license.js";
import { collectDiagnostics, diagnosticsToText } from "./diagnostics.js";
import { pwaState, promptInstall, precacheModels } from "./pwa.js";
import { trendSvg, INDICATORS } from "./chart.js";
import { APP_VERSION, BUILD_DATE, BUILD_ID } from "./version.js";
import { asrStatus, describeAsrEngine } from "./asr.js";
import { getConsent, setExperience, experienceOn } from "./consent.js";
import { listQueue, clearQueue, flushQueue, describeItem, deleteItem, experienceConfig } from "./experience.js";
import { currentNotes, notesHtml } from "./changelog.js";
import { renderProfile, wireProfile } from "./profile.js";

const KIND_LABEL = { camera: "真实试讲", demo: "一键演示" };

/* ——— 历史记录 ——— */

export async function renderHistory(ctx) {
  const listHost = $("history-list");
  const usageHost = $("usage-card");
  const lic = getLicense();
  let list = [];
  try {
    list = await listSessions();
  } catch (e) {
    listHost.innerHTML = `<div class="empty">这个浏览器不允许本地存储（可能是无痕模式），历史记录不可用。</div>`;
    usageHost.innerHTML = "";
    return;
  }
  const u = await usage();
  const cams = list.filter((x) => x.kind === "camera").length;
  const limit = Number.isFinite(lic.features.maxHistory) ? `${lic.label}：最多保留 ${lic.features.maxHistory} 次真实试讲（当前 ${cams}/${lic.features.maxHistory}）` : `${lic.label}：不限次数`;
  usageHost.innerHTML = `
    <div class="usage-row"><b>${list.length}</b> 条记录 · 录像 <b>${u.videos}</b> 段 · 约占 <b>${fmtBytes(u.sessionsBytes + u.videoBytes)}</b></div>
    <div class="usage-row sub">${esc(limit)}${u.quota ? ` · 浏览器可用空间约 ${fmtBytes(u.quota)}` : ""}${u.persisted ? " · 已申请持久保存" : ""}</div>`;

  if (!list.length) {
    listHost.innerHTML = `<div class="empty"><p>还没有记录。</p><p>先做一次「一键演示」或真实试讲，结束后会自动保存在这里。</p><p><a href="#/demo">看一键演示</a>　<a href="#/try">对着镜头试讲</a></p></div>`;
    return;
  }
  listHost.innerHTML = list.map((s) => {
    const m = s.metrics || {};
    return `<article class="hist-item" data-id="${esc(s.id)}">
      <a class="hist-thumb" href="#/session/${esc(s.id)}">${s.thumb ? `<img src="${esc(s.thumb)}" alt="" loading="lazy">` : `<span>无缩略图</span>`}</a>
      <div class="hist-main">
        <div class="hist-top"><span class="tag ${s.kind === "demo" ? "demo" : "camera"}">${KIND_LABEL[s.kind] || "记录"}</span><span class="hist-date">${esc(fmtDate(s.startedAt))}</span><span class="hist-dur">${fmtDur(m.duration)}</span>${s.hasVideo ? `<span class="tag video">录像 ${fmtBytes(s.videoSize)}</span>` : ""}</div>
        <div class="hist-counts">
          ${INDICATORS.map((i) => `<span><i style="background:${i.color}"></i>${i.label} <b>${m[i.key] ?? 0}</b></span>`).join("")}
        </div>
        <p class="hist-next">${esc((s.diagnosis && s.diagnosis.next) || "")}</p>
        <div class="hist-actions">
          <a class="btn-mini primary" href="#/session/${esc(s.id)}">回放</a>
          ${s.kind === "camera" ? `<a class="btn-mini" href="#/compare/${esc(s.id)}">对比</a>` : ""}
          ${s.hasVideo ? `<button type="button" class="btn-mini" data-act="del-video">删除录像</button>` : ""}
          <button type="button" class="btn-mini danger" data-act="del">删除</button>
        </div>
      </div>
    </article>`;
  }).join("");

  listHost.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", async () => {
    const id = b.closest(".hist-item").dataset.id;
    if (b.dataset.act === "del") {
      if (!(await confirmBox("删除这条记录？删除后无法恢复。", "删除", true))) return;
      await deleteSession(id);
      toast("已删除");
    } else {
      if (!(await confirmBox("只删除录像，保留统计和诊断？", "删除录像", true))) return;
      await deleteVideo(id);
      toast("录像已删除");
    }
    renderHistory(ctx);
    ctx.refreshCover && ctx.refreshCover();
  }));
}

export function wireHistoryActions() {
  $("btn-clear-all").addEventListener("click", async () => {
    if (!(await confirmBox("删除本机全部历史记录和录像？此操作无法恢复。建议先「导出全部」备份。", "全部删除", true))) return;
    await clearAll();
    toast("已全部删除");
    renderHistory({});
  });
  $("btn-export-json").addEventListener("click", async () => {
    const all = await listSessions({ full: true });
    if (!all.length) { toast("还没有可导出的记录"); return; }
    const payload = {
      format: "titaojing-history",
      formatVersion: 1,
      app: "OpenPodium · 开讲",
      appVersion: APP_VERSION,
      exportedAt: new Date().toISOString(),
      note: "不含录像。可在另一台设备的「历史记录 → 导入 JSON」中恢复。",
      sessions: all.map((s) => ({ ...s, hasVideo: false, videoSize: 0 })),
    };
    const d = new Date();
    downloadBlob(new Blob([JSON.stringify(payload)], { type: "application/json" }), `开讲-历史-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}.json`);
    toast(`已导出 ${all.length} 条记录（不含录像）`);
  });
  $("input-import-json").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const arr = Array.isArray(data) ? data : data.sessions;
      if (!Array.isArray(arr)) throw new Error("文件格式不对");
      let n = 0, skipped = 0;
      for (const s of arr) {
        if (!s || typeof s.id !== "string" || !/^[\w-]{4,40}$/.test(s.id) || !Number.isFinite(s.startedAt) || !s.metrics || !s.diagnosis) { skipped += 1; continue; }
        const clean = sanitizeRecord(s);
        await putSession(clean, null);
        n += 1;
      }
      toast(`已导入 ${n} 条${skipped ? `，跳过 ${skipped} 条无效记录` : ""}`);
      renderHistory({});
    } catch (err) {
      toast("导入失败：" + (err.message || err));
    }
  });
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const str = (v, n = 400) => String(v ?? "").slice(0, n);

/** Imported files are untrusted: coerce every field we render. */
function sanitizeRecord(s) {
  const m = s.metrics || {};
  const pm = m.perMin || {};
  const d = s.diagnosis || {};
  const c = d.counts || {};
  return {
    ...s,
    id: str(s.id, 40).replace(/[^\w-]/g, ""),
    kind: s.kind === "demo" ? "demo" : "camera",
    startedAt: num(s.startedAt),
    duration: num(s.duration),
    aspect: num(s.aspect) || 9 / 16,
    thumb: typeof s.thumb === "string" && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s.thumb) ? s.thumb : "",
    metrics: {
      duration: num(m.duration), posture: num(m.posture), gaze: num(m.gaze), filler: num(m.filler), board: num(m.board),
      perMin: { posture: num(pm.posture), gaze: num(pm.gaze), filler: num(pm.filler), board: num(pm.board) },
      classRatio: num(m.classRatio), notesRatio: num(m.notesRatio),
    },
    diagnosis: { ...d, good: str(d.good), next: str(d.next), counts: { posture: num(c.posture), sway: num(c.sway), gaze: num(c.gaze), filler: num(c.filler), board: num(c.board) }, duration: num(d.duration), classRatio: num(d.classRatio) },
    events: Array.isArray(s.events) ? s.events.slice(0, 2000).map((e) => ({ t: num(e.t), type: str(e.type, 20), kind: str(e.kind, 20).replace(/[^a-z]/g, ""), label: str(e.label, 30), word: e.word ? str(e.word, 20) : undefined })) : [],
    frames: Array.isArray(s.frames) ? s.frames : [],
    hasVideo: false,
    videoSize: 0,
    importedAt: Date.now(),
  };
}

/* ——— 进步对比 ——— */

export function trendPoints(listNewestFirst) {
  return listNewestFirst.slice().reverse().map((s) => ({ label: fmtShortDate(s.startedAt).split(" ")[0], values: s.metrics.perMin, id: s.id }));
}

export async function renderCompare(ctx, focusId) {
  const host = $("compare-body");
  const lic = getLicense();
  if (!lic.features.compare) {
    host.innerHTML = `<div class="empty">进步对比是正式版功能。可在「关于与隐私」中激活。</div>`;
    return;
  }
  let list = [];
  try { list = await listSessions(); } catch (_) {}
  const cams = list.filter((x) => x.kind === "camera");
  const pool = cams.length >= 2 ? cams : list;
  if (pool.length < 2) {
    host.innerHTML = `<div class="empty"><p>至少需要两次记录才能对比。</p><p>现在有 ${cams.length} 次真实试讲${list.length - cams.length ? `、${list.length - cams.length} 次演示` : ""}。再试讲一次，就能看到变化。</p><p><a href="#/try">对着镜头试讲</a></p></div>`;
    return;
  }
  let b = pool.find((x) => x.id === focusId) || pool[0];
  let a = pool.find((x) => x.startedAt < b.startedAt) || pool.find((x) => x.id !== b.id);
  const opt = (sel) => pool.map((s) => `<option value="${esc(s.id)}" ${s.id === sel.id ? "selected" : ""}>${esc(fmtDate(s.startedAt))} · ${KIND_LABEL[s.kind]} · ${fmtDur(s.metrics.duration)}</option>`).join("");
  const visible = new Set(INDICATORS.map((i) => i.key));

  const draw = () => {
    const [older, newer] = a.startedAt <= b.startedAt ? [a, b] : [b, a];
    const rows = [
      ["时长", fmtDur(older.metrics.duration), fmtDur(newer.metrics.duration), ""],
      ...INDICATORS.map((ind) => {
        const x = older.metrics, y = newer.metrics;
        const dx = x.perMin[ind.key], dy = y.perMin[ind.key];
        const cls = dy < dx - 0.05 ? "better" : dy > dx + 0.05 ? "worse" : "same";
        const txt = cls === "better" ? `少了 ${(dx - dy).toFixed(1)} 次/分` : cls === "worse" ? `多了 ${(dy - dx).toFixed(1)} 次/分` : "差不多";
        return [ind.label, `${x[ind.key]} 次 <small>${dx}/分</small>`, `${y[ind.key]} 次 <small>${dy}/分</small>`, `<span class="delta ${cls}">${txt}</span>`];
      }),
      ["面向学生", `${Math.round(older.metrics.classRatio * 100)}%`, `${Math.round(newer.metrics.classRatio * 100)}%`,
        (() => { const d = Math.round((newer.metrics.classRatio - older.metrics.classRatio) * 100); return `<span class="delta ${d > 2 ? "better" : d < -2 ? "worse" : "same"}">${d > 0 ? "+" : ""}${d}%</span>`; })()],
    ];
    const trendList = cams.slice(0, 20);
    host.innerHTML = `
      <div class="cmp-pick">
        <label>较早<select id="cmp-a">${opt(older)}</select></label>
        <label>较新<select id="cmp-b">${opt(newer)}</select></label>
      </div>
      <div class="cmp-cards">
        ${[older, newer].map((s, i) => `<a class="cmp-card" href="#/session/${esc(s.id)}">
          ${s.thumb ? `<img src="${esc(s.thumb)}" alt="">` : ""}
          <div><p class="cmp-when">${i ? "较新" : "较早"} · ${esc(fmtShortDate(s.startedAt))}</p><p class="cmp-next">${esc(s.diagnosis?.next || "")}</p></div></a>`).join("")}
      </div>
      <table class="cmp-table">
        <thead><tr><th></th><th>较早</th><th>较新</th><th>变化</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><th>${r[0]}</th><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td></tr>`).join("")}</tbody>
      </table>
      <p class="page-note">两次时长不同，所以「变化」按每分钟次数比较。次数越少越好；「面向学生」越高越好。</p>
      <section class="trend-card">
        <h3>四项指标趋势 <small>每分钟次数 · 最近 ${trendList.length} 次真实试讲</small></h3>
        <div class="trend-legend">${INDICATORS.map((i) => `<label><input type="checkbox" data-k="${i.key}" ${visible.has(i.key) ? "checked" : ""}><i style="background:${i.color}"></i>${i.label}</label>`).join("")}</div>
        <div id="trend-host">${trendList.length >= 2 ? trendSvg(trendPoints(trendList), { visible, unit: " 次/分" }) : `<p class="page-note">真实试讲达到两次后显示趋势。</p>`}</div>
      </section>`;
    $("cmp-a").addEventListener("change", (e) => { a = pool.find((x) => x.id === e.target.value) || a; draw(); });
    $("cmp-b").addEventListener("change", (e) => { b = pool.find((x) => x.id === e.target.value) || b; draw(); });
    host.querySelectorAll(".trend-legend input").forEach((cb) => cb.addEventListener("change", () => {
      if (cb.checked) visible.add(cb.dataset.k); else visible.delete(cb.dataset.k);
      if (trendList.length >= 2) $("trend-host").innerHTML = trendSvg(trendPoints(trendList), { visible, unit: " 次/分" });
    }));
  };
  draw();
}

/* ——— 设置 ——— */

const SENS_ROWS = [
  ["posture", "教态（晃动、重心、含胸、抱臂）"],
  ["gaze", "视线落下（低头看稿）"],
  ["filler", "口头禅（低：不统计嗯、啊等单字）"],
  ["board", "写板未回视（多久没回头算一次）"],
];

function syncDurationOptions(modeKey, selected) {
  const mode = SESSION_MODES[modeKey] || SESSION_MODES.practice;
  const sel = $("settings-target-min") || document.querySelector("select[name=targetMin]");
  if (!sel) return;
  const cur = selected ?? mode.defaultMin;
  sel.innerHTML = mode.mins.map((m) => `<option value="${m}" ${m === cur ? "selected" : ""}>${m} 分钟</option>`).join("");
  const hint = $("settings-duration-hint");
  if (hint) hint.textContent = modeKey === "classroom"
    ? "到时会提示，可继续讲；最长为建议时长再加 2 分钟（不超过 22 分钟）。课堂模式至少讲 1 分钟后才能结束。"
    : "到时会提示，可继续讲；最长为建议时长再加 2 分钟。练习模式大约 15 秒后即可结束。";
}

export function renderSettings() {
  const s = getSettings();
  const f = $("settings-form");
  f.sessionMode.value = s.sessionMode;
  syncDurationOptions(s.sessionMode, s.targetMin);
  f.frameMode.value = s.frameMode;
  f.asrEngine.value = s.asrEngine || "auto";
  if (f.perfMode) f.perfMode.value = s.perfMode || "auto";
  const asr = asrStatus();
  const ah = $("asr-engine-hint");
  if (ah) {
    if (asr.sherpa) ah.textContent = "本机听写已下载：「自动」会用本机听写，声音留在这台设备上。";
    else if (!asr.sherpaSupported) ah.textContent = "这个浏览器不能运行本机听写，只能用浏览器听写（Chrome / Edge 会把声音送到厂商的服务；在中国大陆经常连不上）。";
    else ah.textContent = `本机听写还没下载（${asr.sherpaSize}，一次即可）。下载前「自动」会用浏览器听写；进入页面后会在后台下载听写包，角落里可以看到进度。`;
  }
  if (f.asrAutoDownload) f.asrAutoDownload.checked = s.asrAutoDownload !== false;
  if (f.classroomSim) f.classroomSim.value = s.classroomSim || "off";
  if (f.sim3d) f.sim3d.value = s.sim3d || "auto";
  mountLocalAsr($("local-asr-box"), { onChange: () => renderSettings(), onReady: () => renderSettings() });
  f.boardSide.value = s.boardSide;
  f.facing.value = s.facing;
  f.mirror.checked = s.mirror;
  f.saveVideo.checked = s.saveVideo;
  f.saveVideo.disabled = !getLicense().features.saveVideo;
  f.fillers.value = s.fillers.join(" ");
  f.speechLang.value = s.speechLang;
  $("sens-grid").innerHTML = SENS_ROWS.map(([k, lab]) => `
    <div class="sens-row"><span>${lab}</span>
      <div class="seg small" role="radiogroup" aria-label="${lab}">
        ${[["low", "低"], ["mid", "中"], ["high", "高"]].map(([v, t]) => `<label class="seg-btn ${s.sens[k] === v ? "on" : ""}"><input type="radio" name="sens-${k}" value="${v}" ${s.sens[k] === v ? "checked" : ""}>${t}</label>`).join("")}
      </div></div>`).join("");
  $("sens-grid").querySelectorAll("input[type=radio]").forEach((r) => r.addEventListener("change", () => {
    r.closest(".seg").querySelectorAll(".seg-btn").forEach((l) => l.classList.toggle("on", l.querySelector("input").checked));
  }));
  $("settings-hint").textContent = "";
  const st = pwaState();
  $("offline-state").textContent = st.sw.controlled
    ? "离线已启用：页面已缓存。体态模型约 21 MB，第一次真实试讲时下载并缓存，也可以现在下载。"
    : "首次打开后，页面本身可离线使用（需 https 或 localhost）。体态模型约 21 MB，第一次真实试讲时下载并缓存。";
}

export function wireSettings() {
  const f = $("settings-form");
  f.sessionMode.addEventListener("change", () => {
    const mode = f.sessionMode.value;
    const def = (SESSION_MODES[mode] || SESSION_MODES.practice).defaultMin;
    syncDurationOptions(mode, def);
  });
  f.addEventListener("submit", (e) => {
    e.preventDefault();
    const sens = {};
    for (const [k] of SENS_ROWS) {
      const r = f.querySelector(`input[name="sens-${k}"]:checked`);
      sens[k] = r ? r.value : "mid";
    }
    const fillers = f.fillers.value.split(/[\s,，、;；]+/).map((w) => w.trim()).filter(Boolean);
    const next = saveSettings({
      sessionMode: f.sessionMode.value,
      targetMin: Number(f.targetMin.value),
      frameMode: f.frameMode.value,
      asrEngine: f.asrEngine.value,
      asrAutoDownload: f.asrAutoDownload ? f.asrAutoDownload.checked : true,
      classroomSim: f.classroomSim ? f.classroomSim.value : "off",
      sim3d: f.sim3d ? f.sim3d.value : "auto",
      perfMode: f.perfMode ? f.perfMode.value : "auto",
      boardSide: f.boardSide.value,
      facing: f.facing.value,
      deviceId: "",
      mirror: f.mirror.checked,
      saveVideo: f.saveVideo.checked,
      fillers: fillers.length ? fillers : DEFAULT_SETTINGS.fillers,
      speechLang: f.speechLang.value,
      sens,
    });
    if (next.saveVideo) requestPersist();
    $("settings-hint").textContent = "已保存，下一次试讲生效。";
    toast("设置已保存");
    renderSettings();
    $("settings-hint").textContent = "已保存，下一次试讲生效。";
  });
  $("btn-reset-settings").addEventListener("click", async () => {
    if (!(await confirmBox("把所有设置恢复为默认？历史记录不受影响。", "恢复默认"))) return;
    resetSettings();
    renderSettings();
    toast("已恢复默认设置");
  });
  $("btn-precache").addEventListener("click", async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    try {
      await precacheModels((d, n) => { b.textContent = `正在下载 ${d}/${n}…`; });
      b.textContent = "模型已下载，可离线试讲";
      toast("模型已缓存");
    } catch (err) {
      b.textContent = "下载失败，点此重试";
      b.disabled = false;
    }
  });
}

/* ——— 反馈 ——— */

let lastFeedback = null;
export function renderFeedback() {
  const cfg = window.TITAOJING_CONFIG || {};
  $("feedback-hint").textContent = cfg.feedbackHint || "";
}

export function wireFeedback() {
  const f = $("feedback-form");
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = {
      category: f.category.value,
      where: f.where.value,
      description: f.description.value.trim(),
      steps: f.steps.value.trim(),
      contact: f.contact.value.trim(),
    };
    const diag = await collectDiagnostics();
    lastFeedback = { feedback: form, diagnostics: diag };
    $("feedback-text").value = diagnosticsToText(diag, form);
    $("feedback-out").hidden = false;
    $("feedback-copied").textContent = "";
    $("feedback-out").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("btn-copy-feedback").addEventListener("click", async () => {
    const ok = await copyText($("feedback-text").value, $("feedback-text"));
    $("feedback-copied").textContent = ok ? "已复制，可以粘贴到微信或邮件" : "复制失败，请长按文本框全选复制";
  });
  $("btn-download-feedback").addEventListener("click", () => {
    if (!lastFeedback) return;
    const d = new Date();
    const name = `开讲反馈-v${APP_VERSION}-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}.json`;
    downloadBlob(new Blob([JSON.stringify(lastFeedback, null, 2)], { type: "application/json" }), name);
    $("feedback-copied").textContent = "已下载 .json 文件";
  });
}

/* ——— 关于 ——— */

async function renderExperience() {
  const on = experienceOn();
  const box = $("opt-experience");
  if (box) box.checked = on;
  const cfg = experienceConfig();
  const items = await listQueue();
  const st = $("experience-state");
  if (st) {
    st.textContent = !getConsent().termsAccepted
      ? "请先阅读封面弹出的使用说明。"
      : on
        ? (cfg.endpoint ? `已参加。上传地址已配置，队列中有 ${items.length} 条。` : `已参加。当前未配置上传地址（config.js 的 experienceEndpoint 为空），队列中有 ${items.length} 条，不会发到任何服务器。`)
        : `未参加。队列中现有 ${items.length} 条（关闭后也不会自动发送）。`;
  }
  const ul = $("experience-queue");
  if (ul) {
    ul.innerHTML = items.length
      ? items.map((it) => `<li data-id="${esc(it.id)}">${esc(describeItem(it))} <button type="button" class="btn-mini" data-xp-del="${esc(it.id)}">删除</button></li>`).join("")
      : "<li>队列是空的。</li>";
    ul.querySelectorAll("[data-xp-del]").forEach((b) => b.addEventListener("click", async () => {
      await deleteItem(b.getAttribute("data-xp-del"));
      renderExperience();
      toast("已从队列删除");
    }));
  }
}

export function renderAbout() {
  const lic = getLicense();
  $("about-version").innerHTML = `
    <dt>版本</dt><dd>v${esc(APP_VERSION)}</dd>
    <dt>构建日期</dt><dd>${esc(BUILD_DATE)}</dd>
    <dt>构建号</dt><dd>${esc(BUILD_ID)}</dd>
    <dt>版本类型</dt><dd>${esc(lic.label)}</dd>`;
  const f = lic.features;
  $("license-state").textContent = lic.edition === "pro"
    ? `当前为正式版${lic.source === "test-code" ? "（内部测试码激活，仅本机有效）" : ""}：历史记录不限次数，小结无「试用版」字样。`
    : `当前为试用版：最多保留 ${f.maxHistory} 次真实试讲，小结图片与打印页带「试用版」字样。其余功能完整可用。`;
  $("btn-deactivate").hidden = !(lic.edition === "pro" && lic.source !== "config");
  $("activate-msg").textContent = "";
  const st = pwaState();
  $("btn-install-about").hidden = !st.canPrompt;
  $("pwa-state").textContent = st.standalone
    ? "已作为应用安装并运行。"
    : st.iosHint
      ? "iPhone / iPad：在 Safari 中点「分享」→「添加到主屏幕」，即可像应用一样打开，首次加载后可离线使用。"
      : st.canPrompt
        ? "可以把开讲安装到桌面，打开更快，首次加载后可离线使用。"
        : `首次加载后可离线使用${st.sw.controlled ? "（离线缓存已启用）" : ""}。Chrome / Edge 可在地址栏右侧的安装图标或菜单「安装应用」中安装。`;
  renderExperience();
  const notes = currentNotes();
  const ch = $("about-changelog-body");
  if (ch) ch.innerHTML = notes ? notesHtml(notes, { heading: "本版更新" }) : "";
  const cap = $("about-capabilities-list");
  if (cap) {
    cap.innerHTML = [
      "晃动、含胸、重心偏了、抱臂、走出讲台；全身构图下还会看是否来回走动、写板时是否整个人背对学生。",
      "视线落下（低头看稿），以及写完板书是否回视学生。",
      "口头禅：按设置里的词表统计（默认识别「然后」「就是说」「嗯、啊、呃」等），回放里给出次数和具体改法。",
      "本机听写：下载一次中文模型（约 90 MB）后，在浏览器里离线转写普通话，声音不离开这台设备。单字语气词（嗯、啊）多数能写出，但很短、很轻的一声可能漏掉。",
      "能看见双手（每只手 21 个点），用来辅助判断写板和抱臂。手部模型加载失败时，体态和视线仍可运行。",
      "目前不能认出黑板上的字。能看到手是否伸向板书区、是否在写、写完是否回视学生；写板时会留下板书区静帧，供你自己看字迹。",
      "模拟课堂（练习用，默认关）：可在开讲页打开虚拟同学或路演嘉宾，按你的话举手、回答或提问。全部在本机按规则演算，不联网，不是真实课堂。",
    ].map((s) => `<li>${s}</li>`).join("");
  }
  const asrLine = $("about-asr-state");
  if (asrLine) {
    const d = describeAsrEngine(asrStatus().preferred);
    asrLine.innerHTML = `<b>当前听写：</b>${esc(d.label)}。${esc(d.detail)}`;
  }
}

export { renderProfile };

export function wireAbout() {
  $("opt-experience")?.addEventListener("change", async (e) => {
    setExperience(e.target.checked);
    await renderExperience();
    toast(e.target.checked ? "已参加体验计划（当前不会向外发送）" : "已退出体验计划");
  });
  $("btn-xp-clear")?.addEventListener("click", async () => {
    if (!(await confirmBox("清空体验计划队列？这些抽样不会被发送。", "清空队列"))) return;
    await clearQueue();
    await renderExperience();
    toast("队列已清空");
  });
  $("btn-xp-flush")?.addEventListener("click", async () => {
    const r = await flushQueue();
    await renderExperience();
    if (r.skipped === "no-consent") toast("尚未参加体验计划，不会发送");
    else if (r.skipped === "no-endpoint") toast("未配置上传地址，没有发送任何内容");
    else toast(`已发送 ${r.sent} 条` + (r.failed ? `，失败 ${r.failed} 条` : ""));
  });
  $("btn-activate").addEventListener("click", async () => {
    const r = await activate($("activate-code").value);
    renderAbout();
    $("activate-msg").textContent = r.message;
    if (r.ok) $("activate-code").value = "";
  });
  $("btn-deactivate").addEventListener("click", () => { deactivate(); renderAbout(); $("activate-msg").textContent = "已恢复为试用版。"; });
  $("btn-install-about").addEventListener("click", async () => { await promptInstall(); renderAbout(); });
}

export function wirePages() {
  wireHistoryActions();
  wireSettings();
  wireFeedback();
  wireAbout();
  wireProfile();
}
