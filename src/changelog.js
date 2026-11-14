import { APP_VERSION } from "./version.js";

const SEEN_KEY = "titaojing.seenVersion";

/** 应用内展示用的更新说明（用户语言，不写内部文件名）。 */
export const RELEASE_NOTES = [
  {
    version: "1.1.0",
    date: "2026-11-14",
    title: "手部可见、听写说明、口头禅方法和本机档案",
    items: [
      "画面上能画出双手的关键点（共 21 个点）。用双手辅助判断写板和抱臂；目前不能认出黑板上的字，但能看到手是否伸向板书区、是否在写、写完是否回视学生。写板时会留下板书区的静帧，供你自己回看字迹。",
      "听写前会先申请麦克风。若浏览器听写报「网络」错误，不再误说成电脑没网：Chrome / Edge 会把声音送到厂商的语音服务，在中国大陆即使网页能打开也经常连不上。可先点「试一下听写」确认，也可改用 Edge。本机听写仍在准备中，尚未用来转写。",
      "回放和打印小结会列出口头禅的词、次数、每分钟频率，并可跳到出现的时刻。针对「然后」「就是说」「嗯、啊、呃」等给出具体改法，例如用半拍停顿代替「然后」。听写失败时会写明无法统计，而不是让人以为口头禅是零。词表仍可在设置里改。",
      "使用说明、关于页和开讲前会写清：录像默认不保存；若保存，只留在这台设备的浏览器里。练习 1–5 分钟，课堂 10 / 15 / 20 分钟，最长 22 分钟。分析在录制期间于本机进行，结束后不会继续分析，除非你回放已保存的记录。",
      "新增「我的档案」：可在本机建立练习档案（称呼、可选院系），记录仍留在这台设备。云端注册登录尚未开通，不练习也可以不建档案。",
    ],
  },
];

export function notesFor(version = APP_VERSION) {
  return RELEASE_NOTES.find((n) => n.version === version) || null;
}

export function currentNotes() {
  const exact = notesFor(APP_VERSION);
  if (exact) return exact;
  return RELEASE_NOTES[0] || null;
}

export function seenVersion() {
  try { return localStorage.getItem(SEEN_KEY) || ""; } catch (_) { return ""; }
}

export function hasUnseenNotes() {
  const v = APP_VERSION;
  if (!v || String(v).includes("dev")) return seenVersion() !== v && !!currentNotes();
  return seenVersion() !== v && !!notesFor(v);
}

export function markVersionSeen(version = APP_VERSION) {
  try { localStorage.setItem(SEEN_KEY, version); } catch (_) {}
}

export function notesHtml(notes, { heading = "本版更新" } = {}) {
  if (!notes) return "";
  const items = (notes.items || []).map((t) => `<li>${escapeNotes(t)}</li>`).join("");
  return `<section class="changelog-block" data-version="${escapeNotes(notes.version)}">
    <h3>${escapeNotes(heading)}</h3>
    <p class="changelog-meta">v${escapeNotes(notes.version)} · ${escapeNotes(notes.date)} · ${escapeNotes(notes.title || "")}</p>
    <ul class="plain-list">${items}</ul>
  </section>`;
}

function escapeNotes(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
