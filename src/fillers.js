/**
 * 口头禅统计与可执行的改进方法。
 * 词表仍由设置提供（默认见 constants.js FILLERS），这里只根据已经识别到的词给具体建议。
 */
import { EVENT_META } from "./constants.js";

/** 针对常见水词的具体改法（教学建议，不是评分）。更长的词优先匹配。 */
export const FILLER_METHODS = [
  {
    match: ["然后呢", "然后"],
    title: "把「然后」换成半拍停顿",
    body: "讲到要说「然后」的地方，先停半拍，再直接讲下一句。停顿听起来像从容，不必用这个词把句子接上。",
  },
  {
    match: ["就是说", "就是"],
    title: "「就是说」改成更明确的过渡，或直接进入要点",
    body: "可以用「也就是」「具体来说」把意思说清楚；如果已经到了要点上，就不必再加过渡，直接讲。",
  },
  {
    match: ["嗯嗯", "啊啊", "嗯", "啊", "呃", "额"],
    title: "用换气或点头代替「嗯、啊、呃」",
    body: "话和话之间的空隙，不必用声音填上。先换一口气，或对学生点一下头，再开口。",
  },
  {
    match: ["这个这个", "那个那个", "这个", "那个"],
    title: "少用「这个」「那个」占位子",
    body: "想词的时候先停住，想好了再讲，不要用「这个」「那个」把句子撑着。可以先把最常出现的那一个从稿子里划掉，再把同一段重讲一遍。",
  },
  {
    match: ["对吧", "是吧", "好吧", "对对对"],
    title: "疑问尾词改成一次明确的确认",
    body: "「对吧」「是吧」说多了，学生会分不清哪一句是真正在问他们。需要确认时，停下来问一句完整的，其余时候把尾音收住。",
  },
  {
    match: ["那么", "的话", "怎么说"],
    title: "过渡词说完就进入内容",
    body: "「那么」「的话」「怎么说」往往只是垫话。下一遍可以先在心里想好下一句的第一个词，开口就落到内容上。",
  },
];

function methodsFor(word) {
  const w = String(word || "").trim();
  if (!w) return null;
  return FILLER_METHODS.find((m) => m.match.includes(w)) || null;
}

/**
 * 根据一次试讲生成口头禅报告。
 * 听写失败时必须明确说明「无法统计」，不能让人以为口头禅是零。
 */
export function buildFillerReport(session) {
  const dur = Math.max(session?.duration || 0, 0.1);
  const events = (session?.events || []).filter((e) => e.type === "filler" || e.kind === "filler");
  const transcript = session?.transcript || [];
  const noEngine = session?.kind === "camera" && session.speechAvailable === false;
  const silent = session?.kind === "camera" && session.speechHeard === false && !events.length && !transcript.length;

  if (noEngine || silent) {
    const reason = noEngine
      ? "这一次没有可用的听写，口头禅无法统计。"
      : "这一次听写没有听到可统计的语音，口头禅无法统计。";
    return {
      ok: false,
      reason,
      total: 0,
      perMin: 0,
      words: [],
      top: null,
      methods: [],
    };
  }

  const counts = new Map();
  for (const e of events) {
    const word = String(e.word || e.label || "").trim();
    if (!word) continue;
    const cur = counts.get(word) || { word, count: 0, times: [] };
    cur.count += 1;
    if (Number.isFinite(e.t)) cur.times.push(e.t);
    counts.set(word, cur);
  }
  const words = [...counts.values()].sort((a, b) => b.count - a.count || a.word.length - b.word.length);
  const total = words.reduce((n, w) => n + w.count, 0);
  const perMin = Math.round((total / (dur / 60)) * 10) / 10;
  const top = words[0] || null;

  const methods = [];
  const seen = new Set();
  for (const w of words) {
    const m = methodsFor(w.word);
    const key = m ? m.title : "custom:" + w.word;
    if (seen.has(key)) continue;
    seen.add(key);
    if (m) methods.push({ ...m, word: w.word, count: w.count });
    else {
      methods.push({
        match: [w.word],
        word: w.word,
        count: w.count,
        title: `留意词表里的「${w.word}」`,
        body: `「${w.word}」出现了 ${w.count} 次。下一遍只盯这一个词，讲到它要出口时先停半拍，再把那一句重讲清楚。词表可在设置里自行增删。`,
      });
    }
    if (methods.length >= 4) break;
  }
  if (top && top.count >= 2) {
    const already = methods.some((m) => m.title.includes("只盯") || (m.word === top.word && /重讲/.test(m.body)));
    if (!already) {
      methods.push({
        match: [top.word],
        word: top.word,
        count: top.count,
        title: `先改掉最常出现的「${top.word}」`,
        body: `这一次「${top.word}」出现得最多（${top.count} 次）。请只盯这一个词，把出现最集中的那一段再讲一遍：讲到它要出口时停半拍，看它会不会少下来。`,
      });
    }
  }
  if (!total) {
    methods.push({
      match: [],
      word: "",
      count: 0,
      title: "这一次词表里的口头禅很少",
      body: "把这份从容留住。若你觉得还有别的垫话，可以在设置里把那个词加进词表，下一遍专门盯它。",
    });
  }

  return { ok: true, reason: "", total, perMin, words, top, methods };
}

export function fillerLabel() {
  return (EVENT_META.filler && EVENT_META.filler.label) || "口头禅";
}

/** 给诊断句用的一句「下一次」建议，与报告中的方法保持一致。 */
export function fillerNextAdvice(report) {
  if (!report) return "";
  if (!report.ok) return report.reason + "教态和视线仍可回看。可先点「试一下听写」确认浏览器能否出字，或改用 Microsoft Edge。";
  if (report.methods.length) return report.methods[0].body;
  return "";
}
