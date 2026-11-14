import { APP_VERSION } from "./version.js";

const SEEN_KEY = "titaojing.seenVersion";

/** 应用内展示用的更新说明（用户语言，不写内部文件名）。 */
export const RELEASE_NOTES = [
  {
    version: "1.3.0",
    date: "2026-11-14",
    title: "听写包自动下载，回放里可以看观察记录",
    items: [
      "进入页面后，听写包会在后台自动下载（约 90 MB，一次即可），换页不会中断。大文件按 HTTP 分段并行拉取，中断后可续，下完后校验。角落里只显示一枚安静的进度，例如「听写包 42%」。开了浏览器省流量时不会自动开始，需点一下；也可在设置里关掉自动下载。",
      "回放页增加「观察记录」：按评课表的样子列出语气词、停顿、语速、句长、站位、手势、视线、提问等，只摆事实，不做好坏评分。每一栏附一句「可以从这个角度看什么」。没有转写或姿态时，该栏会标明原因。",
      "另有「整节课」一层，依据你的原话定位：重点提示语、课堂节奏、亮点片段（可跳到回放）、提问与候答、衔接过渡、首尾呼应、板书与讲解对应、举例／类比／追问、激励用语。",
      "新增「模拟课堂」（练习用，默认关）：开讲前可打开模拟学生或模拟路演。虚拟同学会按「谁来回答」等话举手，点名或说「请你」后给出题库里的回答（有对的，也有不完整或有误的）；路演嘉宾会在一段之后或听到「大家有什么问题」时提问，并记下回应时长。全部在本机按规则演算，不联网。本机若有中文语音，回答可读出来，否则只显示文字。题库是一份普通 JSON，老师可直接改。",
      "公开英文名改为 OpenPodium（开放讲台），中文名仍为体态镜。仓库地址不变。",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-11-14",
    title: "本机听写可以用了，画面也更流畅",
    items: [
      "新增本机听写：第一次下载约 90 MB（识别引擎来自本站，中文模型来自魔搭 ModelScope 等公开镜像，下载后校验），之后存在这台设备的浏览器里，不用联网。声音只在这台设备上识别，不经过沉思波，也不经过浏览器厂商。在中国大陆浏览器听写连不上时，可以直接改用它。",
      "「设置」里可下载或删除本机听写；浏览器听写报「网络」失败时，横幅上会出现「下载本机听写」按钮，下载完立刻接着转写。已下载时，「自动」会优先用本机听写，「试一下听写」也会测本机听写。",
      "本机听写目前只识别普通话。嗯、啊等语气词多数能写出来，但很短、很轻的一声可能漏掉；句子在你停顿后约半秒出现，不是逐字出现。",
      "画面更流畅：只在摄像头有新画面时才分析；面部和手部按电脑快慢隔几帧算一次；计时和提示每秒更新 4 次。若浏览器在用软件渲染（显卡被禁用、虚拟机或远程桌面），会自动改用 CPU 分析，这是此前卡顿的常见原因。",
      "「设置 → 流畅度」可选「自动」「流畅优先」「精细优先」。自动模式开讲后先量 3 秒，慢就少算一些，并在横幅里说明。",
      "录像仍只存在你这台设备的浏览器里，并且只有勾选「把录像存进本机历史」才保存；沉思波的服务器不会收到录像或声音。",
    ],
  },
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
