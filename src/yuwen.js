/**
 * 语文试讲观察表：从转写、时间戳和姿态里抽出可定位的证据；
 * 镜头看不出的项目用自查清单。不作评分。
 * 各条方法提示来自师范生备考笔记。
 */
import {
  linesOf,
  countHan,
  findPauses,
  speechRateSeries,
  findQuestions,
  gestureStats,
  gazeCoverage,
  boardAlignment,
  extractKeywords,
  STOPWORDS,
} from "./observe.js";
import { midHip, lm } from "./analyze.js";
import { POSE as P } from "./constants.js";

export const NOTES_CREDIT = "来自师范生备考笔记";

/** 23 条试讲备考提示，轻作归类，尽量保留原来的说法。 */
export const YUWEN_NOTES = [
  { id: "student-centered", group: "以生为本", title: "以生为本、课堂要民主", hint: "把对话还给学生，少唱独角戏，师生对话才显出民主。" },
  { id: "open-questions", group: "以生为本", title: "开放问题", hint: "多用「谁来说说」「你怎么看」「你觉得」，把思考权交给学生。" },
  { id: "roll-call", group: "以生为本", title: "点名", hint: "要点名，照顾到不同的学生，不要只问全班齐答。" },
  { id: "virtual-dialogue", group: "以生为本", title: "有生无生结合", hint: "虚拟师生互动也要像真的对话：提问不少于 3 个，有问有候有评。" },
  { id: "stem", group: "紧扣题干", title: "紧扣题干", hint: "试讲要求里写了什么就落实什么，题干里的 2–3 条，课上要对得上。" },
  { id: "reading-count", group: "朗读", title: "朗读不少于三次，且要变换形式", hint: "齐读、点读、范读、分角色，目标至少三次，每次换一种办法。" },
  { id: "model-reading", group: "朗读", title: "范读的语速与停顿", hint: "听老师读、我来读的那一段，语速要稳，停顿要留给诗句喘气。" },
  { id: "reading-guide", group: "朗读", title: "朗读要指导", hint: "要说出「读出」「重音」「停顿」「读慢一点」「入情」，不要读完就过。" },
  { id: "board-events", group: "板书", title: "板书要有过程", hint: "写板的时机要跟讲解中的关键词对上，让学生看见思考是怎么写上去的。" },
  { id: "board-main-sub", group: "板书", title: "主板书、副板书要分开", hint: "主板书承题干与结构，副板书随课堂生成，两块不要挤在一起。" },
  { id: "board-color", group: "板书", title: "用彩色粉笔突出重点", hint: "重点字词、诗眼用彩色粉笔标出来，让学生一眼看见。" },
  { id: "board-layout", group: "板书", title: "板书布局要清楚", hint: "先想好位置再写，不要写完才发现挤成一团。" },
  { id: "word-swap", group: "炼字", title: "炼字、换字比较", hint: "用「换成」「改成」「如果把 X 换成 Y」来比，让学生自己品出好在哪里。" },
  { id: "no-direct-swap", group: "炼字", title: "不要把换字的结论直接塞给学生", hint: "少说「为什么不用……用……」这种自问自答，把比较的过程留给学生。" },
  { id: "process-first", group: "重过程", title: "重过程，不直接给结论", hint: "别一上来就说「十分经典」「非常好」「表达了作者……的思想感情」，要先问再收。" },
  { id: "no-translate", group: "重过程", title: "不要说「翻译」", hint: "不要说「翻译」，改成「谁来说说这句话什么含义」。" },
  { id: "no-line-translate", group: "重过程", title: "不要句句翻译", hint: "不要把诗一句句译成白话就完事，要留下品读的空间。" },
  { id: "presence", group: "教态与肢体", title: "教态与肢体", hint: "手不要长时间不动，也不要一直比划；眼神、视线要照顾全场；姿态放松。" },
  { id: "pacing-pause", group: "教态与肢体", title: "节奏停顿", hint: "停顿是技术。问完、读完、写完，都要敢把时间留出来。" },
  { id: "flavour", group: "语文味", title: "语文味、情感", hint: "课里要有情感词，要能入情入境，让语文课像语文课。" },
  { id: "poetry-high", group: "语文味", title: "高中诗歌：意象、意境、想象、情感", hint: "要抓住意象、意境、想象、情感；并留下批判性思维：你同意吗，有没有不同看法。" },
  { id: "methods", group: "学法与结构", title: "学法五看与几对关系", hint: "学法五看：篇、段、句、词、意。还要言文结合，做减法，看共性也看个性，虚实、面点结合，抽象与具象互转。" },
  { id: "eval-consistency", group: "教-学-评", title: "教-学-评一致，做表现性评价；教资面试第一法则", hint: "学生读完、答完，要评在点上：读得好在哪、你抓住了……。教资面试第一法则，先看教态与口头表达。" },
];

export const OPEN_STUDENT_PHRASES = ["谁来说说", "你怎么看", "你觉得", "大家觉得", "谁来谈谈"];
export const ADDRESS_PHRASES = ["同学们", "同学", "大家", "谁来", "谁说", "请你", "请这位", "请同学", "有没有同学", "哪位"];
export const NAME_CUES = ["请你", "就你", "请这位", "请林秋", "请周南", "请陈禾", "请马言", "请许青", "请第一位", "请左边", "请右边"];

export const READ_FORMS = {
  chorus: { label: "齐读", cues: ["齐读", "全班一起读", "我们一起读"] },
  point: { label: "点读", cues: ["请你来读", "请这位同学读", "请同学来读", "请同学读"] },
  model: { label: "范读", cues: ["我来读", "听老师读", "跟着老师读"] },
  role: { label: "分角色", cues: ["分角色", "男生读", "女生读"] },
};

export const READ_GUIDE_PHRASES = ["读出", "重音", "停顿", "读慢一点", "入情"];
export const SWAP_RE = /换成|改成|如果把.{1,12}换成/;
export const DIRECT_SWAP_RE = /为什么不用.{1,16}用/;
export const JUMP_PHRASES = ["十分经典", "非常好", "表达了作者"];
export const THOUGHT_FEELING = "思想感情";
export const EVAL_PHRASES = ["读得好在哪", "你抓住了", "好在哪里", "你注意到了"];
export const POETRY_WORDS = ["意象", "意境", "想象", "情感"];
export const CRITICAL_PHRASES = ["你同意吗", "有没有不同看法", "还有别的理解吗"];
export const FLAVOUR_PHRASES = ["入情入境", "入情", "情感", "感动", "诗意", "韵味", "意境"];

const PUNCT = /[，。！？、；：,.!?;:\s"'“”‘’「」『』（）()【】\[\]—…·《》]/g;
const WEAK_STEM = new Set(["教学", "引导", "学生", "体会", "通过", "感受", "进行", "要求", "本节", "本课", "课文", "学习", "一起"]);

function hitsInLines(lines, phrases) {
  const out = [];
  for (const ln of lines) {
    for (const p of phrases) {
      if (p && ln.text.includes(p)) out.push({ t: ln.t, phrase: p, text: ln.text });
    }
  }
  return out;
}

function firstHit(text, cues) {
  for (const c of cues) {
    if (c && text.includes(c)) return c;
  }
  return null;
}

function isAddressed(text) {
  if (ADDRESS_PHRASES.some((p) => text.includes(p))) return true;
  if (OPEN_STUDENT_PHRASES.some((p) => text.includes(p))) return true;
  if (NAME_CUES.some((p) => text.includes(p))) return true;
  if (/请[\u4e00-\u9fff]{1,4}(来|说|读|讲|谈)/.test(text)) return true;
  return false;
}

export function teacherStudentTalk(lines) {
  let teacherChars = 0, addressedChars = 0, addressedLines = 0;
  const addressed = [];
  for (const ln of lines) {
    const n = countHan(ln.text) || ln.text.length;
    teacherChars += n;
    if (isAddressed(ln.text)) {
      addressedChars += n;
      addressedLines += 1;
      addressed.push({ t: ln.t, text: ln.text });
    }
  }
  return {
    lineCount: lines.length,
    addressedLines,
    teacherChars,
    addressedChars,
    addressedRatio: teacherChars ? addressedChars / teacherChars : 0,
    items: addressed,
  };
}

const STEM_ANCHORS = ["朗读", "范读", "齐读", "点读", "炼字", "换字", "情感", "意象", "意境", "想象", "诗歌", "诗眼", "品味", "赏析", "背诵", "默写", "题干", "主旨", "中心", "思想感情", "言文结合", "以生为本"];

export function stemKeywords(stem) {
  const text = String(stem || "").trim();
  if (!text) return [];
  const words = [];
  const add = (w) => {
    const s = String(w || "").trim();
    if (!s) return;
    if (STOPWORDS.has(s) || WEAK_STEM.has(s)) return;
    if (s.length < 2) return;
    if (!words.includes(s)) words.push(s);
  };
  let m;
  const reTitle = /《([^》]+)》/g;
  while ((m = reTitle.exec(text))) add(m[1]);
  const reQuote = /[「『“"]([^」』”"]+)[」』”"]/g;
  while ((m = reQuote.exec(text))) add(m[1]);
  for (const a of STEM_ANCHORS) {
    if (text.includes(a)) add(a);
  }
  // leftover short tokens, no sliding windows (those invent fragments)
  const rest = text.replace(/《[^》]+》/g, " ").replace(/[「『“"][^」』”"]+[」』”"]/g, " ");
  const cleaned = rest.replace(PUNCT, " ").replace(/[和与或及]/g, " ").replace(/通过|引导学生|引导|进行/g, " ");
  for (const tok of cleaned.split(/\s+/).filter(Boolean)) {
    if (/^[A-Za-z0-9]{2,}$/.test(tok)) add(tok);
    else if (/^[\u4e00-\u9fff]{2,6}$/.test(tok)) add(tok);
  }
  return words;
}

export function stemCoverage(lines, stem) {
  const keywords = stemKeywords(stem);
  if (!keywords.length) return { available: false, reason: "empty", keywords: [], covered: [], missing: [] };
  const blob = lines.map((l) => l.text).join("");
  const covered = [];
  const missing = [];
  for (const k of keywords) {
    const hits = lines.filter((l) => l.text.includes(k)).map((l) => ({ t: l.t, text: l.text, word: k }));
    if (hits.length || blob.includes(k)) covered.push({ word: k, times: hits.map((h) => h.t), items: hits });
    else missing.push(k);
  }
  return {
    available: true,
    keywords,
    covered,
    missing,
    coverage: keywords.length ? covered.length / keywords.length : 0,
  };
}

export function readingSegments(lines) {
  const items = [];
  const forms = new Set();
  for (const ln of lines) {
    for (const [key, form] of Object.entries(READ_FORMS)) {
      const cue = firstHit(ln.text, form.cues);
      if (cue) {
        items.push({ t: ln.t, form: key, label: form.label, cue, text: ln.text });
        forms.add(key);
      }
    }
  }
  return {
    count: items.length,
    forms: [...forms].map((k) => READ_FORMS[k].label),
    formKeys: [...forms],
    varied: forms.size >= 2,
    meetsTarget: items.length >= 3 && forms.size >= 2,
    items,
  };
}

export function modelReadingProsody(lines, duration) {
  const modelCues = READ_FORMS.model.cues;
  const spans = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (!firstHit(ln.text, modelCues)) continue;
    const start = ln.t;
    const nextCue = lines.slice(i + 1).find((x) => {
      return Object.values(READ_FORMS).some((f) => firstHit(x.text, f.cues)) || x.t > start + 20;
    });
    const end = nextCue ? Math.min(nextCue.t, start + 20) : Math.min((duration || start + 16), start + 20);
    const slice = lines.filter((x) => x.t >= start && x.t < end);
    const text = slice.map((x) => x.text).join("");
    const han = countHan(text);
    const dur = Math.max(0.5, end - start);
    const pauses = findPauses(slice, end);
    spans.push({
      t: start,
      end,
      cue: firstHit(ln.text, modelCues),
      cpm: (han / dur) * 60,
      pauseCount: pauses.count,
      text,
    });
  }
  return { count: spans.length, items: spans };
}

export function wordSwaps(lines) {
  const compares = [];
  const directs = [];
  for (const ln of lines) {
    if (SWAP_RE.test(ln.text)) compares.push({ t: ln.t, text: ln.text, kind: "compare" });
    if (DIRECT_SWAP_RE.test(ln.text)) directs.push({ t: ln.t, text: ln.text, kind: "direct" });
  }
  return { compares, directs };
}

function recentQuestion(lines, t, windowSec = 15) {
  return lines.some((l) => l.t < t && t - l.t <= windowSec && /[？?]|为什么|怎么看|你觉得|谁来|好在哪里|什么含义/.test(l.text));
}

export function processFlags(lines) {
  const jumps = [];
  const translations = [];
  for (const ln of lines) {
    for (const p of JUMP_PHRASES) {
      if (ln.text.includes(p) || (p === "表达了作者" && ln.text.includes(THOUGHT_FEELING) && ln.text.includes("表达"))) {
        if (ln.text.includes(p) || (p === "表达了作者" && ln.text.includes("表达了作者"))) {
          const preceded = recentQuestion(lines, ln.t, 18);
          if (!preceded) jumps.push({ t: ln.t, phrase: p, text: ln.text });
        }
      }
    }
    if (ln.text.includes("表达了作者") && ln.text.includes(THOUGHT_FEELING) && !recentQuestion(lines, ln.t, 18)) {
      if (!jumps.some((j) => j.t === ln.t && j.phrase === "表达了作者")) {
        jumps.push({ t: ln.t, phrase: "表达了作者……的思想感情", text: ln.text });
      }
    }
    if (ln.text.includes("翻译")) translations.push({ t: ln.t, phrase: "翻译", text: ln.text });
  }
  // 句句翻译：短时间内多次出现「翻译」或连续多句「意思是／也就是说」
  const meaning = lines.filter((l) => /意思是|也就是说|翻译成/.test(l.text));
  const lineByLine = translations.length >= 2 || meaning.length >= 3;
  return { jumps, translations, meaning, lineByLine };
}

export function handActivity(session) {
  const frames = (session && session.frames) || [];
  const dur = Number(session && session.duration) || (frames.length ? frames[frames.length - 1].t : 0);
  if (frames.length < 8) return { available: false, stillSpans: [], movingRatio: 0, longStill: false, alwaysMoving: false };
  let known = 0, moving = 0;
  let stillStart = null;
  const stillSpans = [];
  let lastPos = null;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const dt = Math.max(0, (frames[i + 1] ? frames[i + 1].t : dur) - f.t);
    const pts = [];
    if (f.pose) {
      for (const idx of [P.L_WRIST, P.R_WRIST]) {
        const p = lm(f.pose, idx);
        if (p && (p.v ?? p.visibility ?? 1) > 0.3) pts.push(p);
      }
    }
    if (!pts.length) {
      lastPos = null;
      continue;
    }
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    known += dt;
    if (lastPos) {
      const amp = Math.hypot(cx - lastPos.x, cy - lastPos.y);
      const isMoving = amp > 0.02;
      if (isMoving) {
        moving += dt;
        if (stillStart != null && f.t - stillStart >= 6) {
          stillSpans.push({ t: stillStart, duration: f.t - stillStart });
        }
        stillStart = null;
      } else if (stillStart == null) {
        stillStart = f.t;
      }
    }
    lastPos = { x: cx, y: cy };
  }
  if (stillStart != null && dur - stillStart >= 6) stillSpans.push({ t: stillStart, duration: dur - stillStart });
  const movingRatio = known ? moving / known : 0;
  return {
    available: known >= 4,
    known,
    movingRatio,
    stillSpans,
    longStill: stillSpans.some((s) => s.duration >= 8),
    alwaysMoving: movingRatio >= 0.72 && stillSpans.every((s) => s.duration < 4),
  };
}

function checklist(ids, status = "unchecked") {
  return ids.map((id) => {
    const note = YUWEN_NOTES.find((n) => n.id === id);
    return { id, title: note ? note.title : id, hint: note ? note.hint : "", status };
  });
}

/**
 * 根据一次试讲生成语文观察表。session.stemRequirement 为开讲页选填的题干。
 * 不作评分。
 */
export function buildYuwenReport(session) {
  const lines = linesOf(session);
  const dur = Math.max(Number(session && session.duration) || 0, lines.reduce((a, l) => Math.max(a, l.t), 0));
  const hasSpeech = lines.length > 0;
  const speechWhy = hasSpeech ? "" : ((session && session.speechWhy) || "没有转写，无法从原话里定位。");
  const stem = (session && (session.stemRequirement || (session.settingsSnapshot && session.settingsSnapshot.stemRequirement))) || "";

  const talk = hasSpeech ? teacherStudentTalk(lines) : null;
  const openHits = hasSpeech ? hitsInLines(lines, OPEN_STUDENT_PHRASES) : [];
  const nameHits = hasSpeech ? hitsInLines(lines, NAME_CUES) : [];
  const questions = hasSpeech ? findQuestions(lines, dur) : null;
  const reading = hasSpeech ? readingSegments(lines) : null;
  const modelRead = hasSpeech ? modelReadingProsody(lines, dur) : null;
  const guides = hasSpeech ? hitsInLines(lines, READ_GUIDE_PHRASES) : [];
  const swaps = hasSpeech ? wordSwaps(lines) : null;
  const process = hasSpeech ? processFlags(lines) : null;
  const flavour = hasSpeech ? hitsInLines(lines, FLAVOUR_PHRASES) : [];
  const poetry = hasSpeech ? hitsInLines(lines, POETRY_WORDS) : [];
  const critical = hasSpeech ? hitsInLines(lines, CRITICAL_PHRASES) : [];
  const evals = hasSpeech ? hitsInLines(lines, EVAL_PHRASES) : [];
  const cover = hasSpeech ? stemCoverage(lines, stem) : { available: false, reason: "no-speech", keywords: [], covered: [], missing: [] };
  if (!stem) cover.reason = hasSpeech ? "no-stem" : cover.reason;
  const board = boardAlignment(session);
  const pauses = hasSpeech ? findPauses(lines, dur) : null;
  const rate = hasSpeech ? speechRateSeries(lines, dur) : null;
  const gestures = gestureStats(session);
  const gaze = gazeCoverage(session);
  const hands = handActivity(session);
  const motionKnown = (session && session.frames && session.frames.filter((f) => f.pose).length >= 8);

  const law = {
    title: "教资面试第一法则：教态 + 口头表达",
    hint: YUWEN_NOTES.find((n) => n.id === "eval-consistency").hint,
    presence: {
      gestures: gestures.available ? { count: gestures.count, meanAmp: gestures.meanAmp } : null,
      gaze: gaze.available ? { classRatio: gaze.classRatio, leftRatio: gaze.leftRatio, midRatio: gaze.midRatio, rightRatio: gaze.rightRatio } : null,
      hands: hands.available ? { movingRatio: hands.movingRatio, longStill: hands.longStill, alwaysMoving: hands.alwaysMoving, stillSpans: hands.stillSpans } : null,
    },
    speech: {
      rate: rate ? { cpm: rate.cpm } : null,
      pauses: pauses ? { count: pauses.count, mean: pauses.mean, openingWait: pauses.openingWait } : null,
      questions: questions ? { count: questions.count, open: questions.open, closed: questions.closed, meanWait: questions.meanWait } : null,
    },
  };

  return {
    credit: NOTES_CREDIT,
    notes: YUWEN_NOTES,
    duration: dur,
    hasSpeech,
    speechWhy,
    stem,
    talk,
    openHits,
    nameHits,
    questions,
    virtualDialogue: questions ? { questionCount: questions.count, meets: questions.count >= 3 } : null,
    stemCoverage: cover,
    reading,
    modelRead,
    guides,
    board,
    boardChecklists: checklist(["board-main-sub", "board-color", "board-layout"]),
    swaps,
    process,
    hands,
    gaze: gaze.available ? gaze : null,
    pauses,
    flavour,
    poetry,
    critical,
    methodChecklists: checklist(["methods"]),
    methodDetails: [
      { id: "wukan", title: "学法五看（篇、段、句、词、意）", hint: "从篇到段到句到词再到意，一层层看下去，不要只停留在字面。" },
      { id: "yanwen", title: "言文结合", hint: "既要文言的字句，也要文章的理路，两边都要点到。" },
      { id: "subtract", title: "做减法", hint: "一课只抓住最值得教的那几处，不要面面俱到。" },
      { id: "common", title: "共性与个性", hint: "先看见这一类课文的共性，再抓住这一篇的个性。" },
      { id: "xushi", title: "虚实、面点结合", hint: "有面的铺开，也有点的深入；虚的意境要落到实的字句上。" },
      { id: "abstract", title: "抽象与具象互转", hint: "抽象的情感要落到具象的意象上，具象的景物也要能升到抽象的理解。" },
    ],
    evals,
    law,
    motionKnown,
  };
}

/** 给测试用的一份《春晓》试讲转写（虚构课堂，不是课文原文逐字课）。 */
export function sampleChunxiaoTranscript() {
  return [
    { t: 1.0, text: "同学们好，今天我们一起学习孟浩然的《春晓》。这首诗十分经典，表达了作者热爱春天的思想感情。" },
    { t: 12.0, text: "请大家齐读题目：春晓。" },
    { t: 20.0, text: "听老师读：春眠不觉晓，处处闻啼鸟。夜来风雨声，花落知多少。" },
    { t: 32.0, text: "读慢一点，读出春朝的安静，注意停顿和重音，要入情。" },
    { t: 44.0, text: "请你来读，把处处闻啼鸟读出来。" },
    { t: 56.0, text: "男生读前两句，女生读后两句。" },
    { t: 68.0, text: "谁来说说，你觉得「处处闻啼鸟」里，「处处」这两个字好在哪里？" },
    { t: 80.0, text: "如果把处处换成四面，味道一样吗？" },
    { t: 90.0, text: "你怎么看「春眠不觉晓」的「晓」。" },
    { t: 100.0, text: "请林秋来说说。" },
    { t: 110.0, text: "你抓住了鸟鸣把春天叫醒这一点。" },
    { t: 120.0, text: "读得好在哪？你把「啼」字的声音读出来了。" },
    { t: 132.0, text: "不要急着翻译这一句。谁来说说这句话什么含义。" },
    { t: 146.0, text: "这首诗的意象是啼鸟和落花，意境是清晓，可以展开想象，情感是惜春。" },
    { t: 160.0, text: "你同意吗？有没有不同看法？" },
    { t: 172.0, text: "为什么不用到处，用处处？" },
    { t: 184.0, text: "我们再把处处闻啼鸟读一遍，体会诗歌的情感。" },
  ];
}

export function sampleChunxiaoStem() {
  return "教学《春晓》，引导学生体会「处处闻啼鸟」，通过朗读和炼字感受诗歌情感。";
}
