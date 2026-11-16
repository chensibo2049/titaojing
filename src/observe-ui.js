/** 把观察记录画成评课表式的纸面记录：只摆事实，不做好坏评分。 */
import { buildObserveReport } from "./observe.js";
import { buildYuwenReport, NOTES_CREDIT } from "./yuwen.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function fmt(t) {
  const n = Math.max(0, Number(t) || 0);
  const m = Math.floor(n / 60);
  const s = Math.floor(n % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function fmtMin(t) {
  const n = Math.max(0, Number(t) || 0);
  const m = Math.floor(n / 60) + (n % 60 >= 0.5 && n >= 60 ? 0 : 0);
  if (n < 60) return fmt(n);
  return `约第 ${Math.floor(n / 60) + 1} 分钟`;
}

function num(n, digits = 1) {
  if (!Number.isFinite(n)) return "—";
  return Number(n).toFixed(digits).replace(/\.0$/, "");
}

function barChart(bins, { width = 280, height = 72 } = {}) {
  const max = Math.max(1, ...bins.map((b) => b.count || b.value || 0));
  const gap = 6;
  const n = bins.length || 1;
  const bw = (width - gap * (n + 1)) / n;
  const bars = bins.map((b, i) => {
    const v = b.count || b.value || 0;
    const h = Math.round((v / max) * (height - 22));
    const x = gap + i * (bw + gap);
    const y = height - 16 - h;
    return `<rect class="ob-bar" x="${x.toFixed(1)}" y="${y}" width="${bw.toFixed(1)}" height="${h}"></rect>
      <text class="ob-bar-lab" x="${(x + bw / 2).toFixed(1)}" y="${height - 4}" text-anchor="middle">${esc(b.label)}</text>`;
  }).join("");
  return `<svg class="ob-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">${bars}</svg>`;
}

function lineChart(points, key, { width = 320, height = 72, color = "currentColor" } = {}) {
  if (!points.length) return "";
  const vals = points.map((p) => Number.isFinite(p[key]) ? p[key] : null);
  if (!vals.some(Number.isFinite)) return "";
  const max = Math.max(1, ...vals.filter(Number.isFinite));
  const xs = points.map((p, i) => (i / Math.max(1, points.length - 1)) * (width - 8) + 4);
  const d = vals.map((v, i) => v === null ? "" : `${i && vals[i - 1] !== null ? "L" : "M"}${xs[i].toFixed(1)},${(height - 14 - v / max * (height - 24)).toFixed(1)}`).join(" ");
  return `<svg class="ob-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">
    <path class="ob-line" d="${d}" fill="none" stroke="${color}" stroke-width="1.4"></path>
  </svg>`;
}

function heatGrid(grid, cols, rows, maxCell, { width = 200, height = 140 } = {}) {
  const cw = width / cols, ch = height / rows;
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = grid[r * cols + c] || 0;
      const a = maxCell ? v / maxCell : 0;
      cells.push(`<rect x="${(c * cw).toFixed(1)}" y="${(r * ch).toFixed(1)}" width="${cw.toFixed(1)}" height="${ch.toFixed(1)}" fill="rgba(47,111,106,${(0.06 + a * 0.72).toFixed(2)})"></rect>`);
    }
  }
  return `<svg class="ob-svg ob-heat" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="站位分布">${cells.join("")}</svg>`;
}

function stackBar(segs, duration, { width = 360, height = 28 } = {}) {
  const dur = Math.max(duration || 1, 0.1);
  const pal = { "导入": "#a33b28", "新授": "#2f6f6a", "小结": "#c4a36a", "互动": "#5a6b4e", "讲授": "#2f6f6a", "提问": "#7c5c3a" };
  const rects = segs.map((s) => {
    const x = (s.start / dur) * width;
    const w = Math.max(1.5, ((s.end - s.start) / dur) * width);
    const fill = pal[s.label] || pal[s.kind] || "#6f675c";
    return `<rect x="${x.toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${height}" fill="${fill}" opacity="0.85"><title>${esc(s.label)} ${fmt(s.start)}–${fmt(s.end)}</title></rect>`;
  }).join("");
  return `<svg class="ob-svg" viewBox="0 0 ${width} ${height}" width="100%" height="${height}" aria-hidden="true">${rects}</svg>`;
}

function row(title, hint, body, { missing = "" } = {}) {
  if (missing) {
    return `<article class="ob-row is-missing">
      <header><h4>${esc(title)}</h4><p class="ob-hint">自查角度（建议）：${esc(hint)}</p></header>
      <p class="ob-why">${esc(missing)}</p>
    </article>`;
  }
  return `<article class="ob-row">
    <header><h4>${esc(title)}</h4><p class="ob-hint">自查角度（建议）：${esc(hint)}</p></header>
    <div class="ob-body">${body}</div>
  </article>`;
}

function evidenceList(items) {
  return jumpList(items, e => `${esc(e.label || e.word || e.type || e.kind || "标记")} · ${esc(e.source || "来源未记录")} · 观测规则 ${esc(e.observationVersion || "未记录")}`);
}

function jumpList(items, textFn) {
  if (!items || !items.length) return `<p class="ob-empty">这一次没有记下可列出的条目。</p>`;
  return `<ul class="ob-jumps">${items.map((it) =>
    `<li>${Number.isFinite(it.t) ? `<button type="button" class="ob-jump" data-jump="${it.t}">${fmt(it.t)}</button>` : "时间未记录"} ${textFn(it)}</li>`
  ).join("")}</ul>`;
}

/**
 * 在 host 里渲染观察表。opts.onJump(t) 跳回收音时刻。
 */
function simSection(session) {
  const sim = session && session.simLog;
  const hint = "看练习时点了几次名、点到谁，以及路演提问后多久开始回应。这是练习用模拟，不是真实课堂。";
  if (!sim) {
    return `<section class="ob-section ob-sim">
      <h3 class="ob-sec-title">模拟互动</h3>
      <p class="ob-kicker-lead">练习用模拟</p>
      ${row("模拟互动", hint, "", { missing: "这次没有打开模拟课堂。若要练习点名或应对提问，可在开讲页打开「模拟学生」或「模拟路演」。" })}
    </section>`;
  }
  const dist = sim.callDistribution || {};
  const distLine = Object.keys(dist).length
    ? Object.entries(dist).map(([name, n]) => `${name} ${n} 次`).join("，")
    : "还没有点名记录。";
  const durs = sim.replyDurations || [];
  const durLine = durs.length
    ? `共记下 ${durs.length} 次回应，平均 ${Number(sim.meanReplySec).toFixed(1)} 秒；各次：${durs.map((d) => `${Number(d).toFixed(1)} 秒`).join("，")}。`
    : (sim.mode === "roadshow" ? "这次嘉宾提问后，还没有记下回应时长。" : "课堂模拟不统计路演回应时长。");
  const body = `<p class="ob-lead">互动 ${sim.interactions || 0} 次（举手 ${sim.raiseCount || 0}，点名 ${sim.callCount || 0}，嘉宾提问 ${sim.askCount || 0}）。</p>
    <p>点名分布：${distLine}</p>
    <p>回应时长：${durLine}</p>`;
  return `<section class="ob-section ob-sim">
    <h3 class="ob-sec-title">模拟互动</h3>
    <p class="ob-kicker-lead">练习用模拟。下列次数来自本机规则，不是真实课堂。</p>
    ${row("模拟互动", hint, body)}
  </section>`;
}


const YUWEN_LAW_HINT = "先看教态与口头表达。下面把已有的姿态、视线、手势、语速、停顿和提问汇在一起，仍然不作好坏打分。";

function checkList(items) {
  if (!items || !items.length) return "";
  return `<ul class="ob-checks">${items.map((it) =>
    `<li><label><input type="checkbox" class="ob-check"> <span class="ob-check-title">${esc(it.title)}</span></label>
       <p class="ob-hint">${esc(it.hint || "")}</p></li>`
  ).join("")}</ul>`;
}

function yuwenSection(session, report) {
  // Sanitize only the presentation input; never erase historical raw data.
  const safe = { ...session, transcript: report.hasSpeech ? session.transcript : [], speechWhy: report.speechWhy,
    frames: session.kind !== "demo" && session.visionAvailable === false ? [] : report.hasPose ? session.frames : (session.frames || []).map(f => ({ ...f, pose: null, hands: null })) };
  const y = buildYuwenReport(safe);
  const credit = `<p class="ob-kicker-lead">方法提示${esc(y.credit)}。能定位的列出原话和时刻，看不出的用自查清单。仍然不作评分。</p>`;

  const law = y.law;
  const pres = [];
  if (law.presence.gaze) {
    const g = law.presence.gaze;
    pres.push(`面向学生约 ${num(g.classRatio * 100, 0)}% 的可判时段；视线左 ${num(g.leftRatio * 100, 0)}%、中 ${num(g.midRatio * 100, 0)}%、右 ${num(g.rightRatio * 100, 0)}%。`);
  }
  if (law.presence.gestures) pres.push(`手势约 ${law.presence.gestures.count} 次。`);
  if (law.presence.hands) {
    const h = law.presence.hands;
    if (h.longStill) pres.push(`双手有超过约 8 秒几乎不动的时段（${h.stillSpans.filter((s) => s.duration >= 8).map((s) => fmt(s.t) + " 起，约 " + num(s.duration) + " 秒").join("；")}）。`);
    else if (h.alwaysMoving) pres.push(`可判时段里手部移动约占 ${num(h.movingRatio * 100, 0)}%，较少出现明显停住。`);
    else pres.push(`可判时段里手部移动约占 ${num(h.movingRatio * 100, 0)}%。`);
  }
  if (!pres.length) pres.push(y.motionKnown ? "姿态记录不足，教态这一侧无法从画面计算。" : "没有足够的姿态或视线记录，教态请对照录像自查。");
  const sp = [];
  if (law.speech.rate) sp.push(`整段约 ${num(law.speech.rate.cpm, 0)} 字/分。`);
  if (law.speech.pauses) sp.push(`停顿 ${law.speech.pauses.count} 处，平均 ${num(law.speech.pauses.mean)} 秒。`);
  if (law.speech.questions) sp.push(`问句 ${law.speech.questions.count} 处（开放 ${law.speech.questions.open}，封闭 ${law.speech.questions.closed}），问后平均等候 ${num(law.speech.questions.meanWait)} 秒。`);
  const lawBody = `<p class="ob-lead">${esc(pres.join(""))}</p><p>${y.hasSpeech ? esc(sp.join("")) : ""}</p>
    <p class="ob-hint">姿态是否放松，请对照录像自查。停顿是技术，问完、读完、写完，都要敢把时间留出来。</p>`;

  const talkBody = y.talk
    ? `<p class="ob-lead">面向学生的用语约占转写字数的 ${num(y.talk.addressedRatio * 100, 0)}%（${y.talk.addressedLines} / ${y.talk.lineCount} 句里出现了称呼、点名或请学生说）。</p>
       ${y.talk.items.length ? jumpList(y.talk.items.slice(0, 12), (it) => esc(it.text)) : "<p class='ob-empty'>没有记下面向学生的用语。</p>"}`
    : "";

  const openBody = y.hasSpeech
    ? (y.openHits.length
      ? `<p class="ob-lead">开放问题用语 ${y.openHits.length} 处。</p>${jumpList(y.openHits, (it) => `「${esc(it.phrase)}」${esc(it.text)}`)}`
      : `<p class="ob-empty">没有出现「谁来说说」「你怎么看」「你觉得」。</p>`)
    : "";

  const nameBody = y.hasSpeech
    ? (y.nameHits.length
      ? `<p class="ob-lead">点名用语 ${y.nameHits.length} 处。</p>${jumpList(y.nameHits, (it) => `「${esc(it.phrase)}」${esc(it.text)}`)}`
      : `<p class="ob-empty">没有出现「请你」「请这位」或按姓名点名的用语。</p>`)
    : "";

  const virtBody = y.virtualDialogue
    ? `<p class="ob-lead">问句 ${y.virtualDialogue.questionCount} 处。${y.virtualDialogue.meets ? "已满 3 次。" : "还不满 3 次。"}有生无生结合时，提问也不宜太少。</p>`
    : "";

  let stemBody = "";
  let stemMissing = "";
  if (!y.hasSpeech) stemMissing = y.speechWhy;
  else if (!y.stem) stemMissing = "开讲页没有粘贴题干要求，这一栏请对照考题自查。下次可在开讲页把题干 2–3 条贴进去。";
  else {
    const c = y.stemCoverage;
    stemBody = `<p class="ob-lead">题干原文：「${esc(y.stem)}」</p>
      <p>对上的词 ${c.covered.length} 个${c.missing.length ? `，尚未在转写里出现：${c.missing.map((w) => "「" + esc(w) + "」").join("、")}` : "，题干里抽出的词都在转写中出现过"}。</p>
      ${c.covered.length ? `<ul class="ob-pills">${c.covered.map((k) => `<li><button type="button" class="ob-jump" data-jump="${(k.times && k.times[0]) || 0}">${esc(k.word)}</button></li>`).join("")}</ul>` : ""}`;
  }

  const readBody = y.reading
    ? `<p class="ob-lead">朗读提示 ${y.reading.count} 处，用到的形式：${y.reading.forms.length ? y.reading.forms.join("、") : "尚未记下"}。${y.reading.meetsTarget ? "次数和形式变化都达到了「至少三次、换种办法」。" : "目标是至少三次，并且变换形式。"}</p>
       ${y.reading.items.length ? jumpList(y.reading.items, (it) => `${esc(it.label)} · 「${esc(it.cue)}」${esc(it.text)}`) : ""}`
    : "";

  const modelBody = y.modelRead
    ? (y.modelRead.items.length
      ? `<p class="ob-lead">范读段 ${y.modelRead.count} 处，并记下该段大约字/分和停顿次数（按转写粗算，不是评分）。</p>
         ${jumpList(y.modelRead.items, (it) => `「${esc(it.cue)}」约 ${num(it.cpm, 0)} 字/分，停顿 ${it.pauseCount} 处`)}`
      : `<p class="ob-empty">没有出现「我来读」「听老师读」「跟着老师读」。</p>`)
    : "";

  const guideBody = y.hasSpeech
    ? (y.guides.length
      ? `<p class="ob-lead">朗读指导用语 ${y.guides.length} 处。</p>${jumpList(y.guides, (it) => `「${esc(it.phrase)}」${esc(it.text)}`)}`
      : `<p class="ob-empty">没有出现「读出」「重音」「停顿」「读慢一点」「入情」。</p>`)
    : "";

  const boardAuto = y.board && y.board.available
    ? `<p class="ob-lead">写板 ${y.board.spans.length} 段。</p>
       ${y.board.spans.map((sp) =>
         `<div class="ob-board-span"><button type="button" class="ob-jump" data-jump="${sp.t}">${fmt(sp.t)}</button>
            约 ${num((sp.end || sp.t) - sp.t)} 秒
            ${sp.keywords.length ? " · " + sp.keywords.map((k) => esc(k.word)).join("、") : " · 附近转写里没有抽出重复的词。"}
            ${sp.quotes.length ? `<p class="ob-quote">「${esc(sp.quotes[0].text)}」</p>` : ""}</div>`
       ).join("")}`
    : (y.hasSpeech ? `<p class="ob-empty">这一次没有记下写板时段，请对照录像自查板书过程。</p>` : "");

  const swapBody = y.swaps
    ? `<p class="ob-lead">换字比较 ${y.swaps.compares.length} 处${y.swaps.directs.length ? `；「为什么不用……用……」这类直接给结论 ${y.swaps.directs.length} 处` : ""}。</p>
       ${y.swaps.compares.length ? jumpList(y.swaps.compares, (it) => esc(it.text)) : "<p class='ob-empty'>没有出现「换成」「改成」「如果把……换成」。</p>"}
       ${y.swaps.directs.length ? jumpList(y.swaps.directs, (it) => `直接给结论 · ${esc(it.text)}`) : ""}`
    : "";

  const procBody = y.process
    ? `<p class="ob-lead">${y.process.jumps.length ? `在问句之前出现了「十分经典 / 非常好 / 表达了作者……的思想感情」${y.process.jumps.length} 处。` : "没有在问句之前记下「十分经典」「非常好」或「表达了作者……的思想感情」。"}
       ${y.process.translations.length ? `出现了「翻译」${y.process.translations.length} 处，可改成「谁来说说这句话什么含义」。` : "没有出现「翻译」。"}
       ${y.process.lineByLine ? "短时间内多次出现「翻译」或「意思是」，请留意是不是句句翻译。" : ""}</p>
       ${y.process.jumps.length ? jumpList(y.process.jumps, (it) => `「${esc(it.phrase)}」${esc(it.text)}`) : ""}
       ${y.process.translations.length ? jumpList(y.process.translations, (it) => `「翻译」${esc(it.text)}`) : ""}`
    : "";

  const flavourBody = y.hasSpeech
    ? `<p class="ob-lead">情感 / 入情用语 ${y.flavour.length} 处；意象、意境、想象、情感 ${y.poetry.length} 处；批判性问题 ${y.critical.length} 处。</p>
       ${y.flavour.length ? jumpList(y.flavour, (it) => `「${esc(it.phrase)}」${esc(it.text)}`) : "<p class='ob-empty'>没有记下「入情入境」或情感类用语。</p>"}
       ${y.poetry.length ? jumpList(y.poetry, (it) => `「${esc(it.phrase)}」${esc(it.text)}`) : ""}
       ${y.critical.length ? jumpList(y.critical, (it) => `「${esc(it.phrase)}」${esc(it.text)}`) : "<p class='ob-empty'>没有出现「你同意吗」「有没有不同看法」。</p>"}`
    : "";

  const evalBody = y.hasSpeech
    ? (y.evals.length
      ? `<p class="ob-lead">表现性评价用语 ${y.evals.length} 处。</p>${jumpList(y.evals, (it) => `「${esc(it.phrase)}」${esc(it.text)}`)}`
      : `<p class="ob-empty">没有出现「读得好在哪」「你抓住了」一类评在点上的话。</p>`)
    : "";

  const pauseHint = y.pauses
    ? `<p class="ob-lead">停顿 ${y.pauses.count} 处，平均 ${num(y.pauses.mean)} 秒${y.pauses.longest ? `，最长 ${num(y.pauses.longest.duration)} 秒（${fmt(y.pauses.longest.t)}）` : ""}。</p>`
    : "";

  return `<section class="ob-section ob-yuwen" id="ob-yuwen">
    <h3 class="ob-sec-title">语文试讲观察表</h3>
    ${credit}
    <article class="ob-row ob-law">
      <header><h4>${esc(law.title)}</h4><p class="ob-hint">自查角度（建议）：${esc(YUWEN_LAW_HINT)}</p></header>
      <div class="ob-body">${lawBody}</div>
    </article>
    ${row("以生为本、师生对话", "把对话还给学生，少唱独角戏，师生对话才显出民主。", talkBody, { missing: y.speechWhy })}
    ${row("开放问题", "多用「谁来说说」「你怎么看」「你觉得」，把思考权交给学生。", openBody, { missing: y.speechWhy })}
    ${row("点名", "要点名，照顾到不同的学生，不要只问全班齐答。", nameBody, { missing: y.speechWhy })}
    ${row("有生无生结合", "虚拟师生互动也要像真的对话：提问不少于 3 个，有问有候有评。", virtBody, { missing: y.speechWhy })}
    ${row("紧扣题干", "试讲要求里写了什么就落实什么，题干里的 2–3 条，课上要对得上。", stemBody, { missing: stemMissing })}
    ${row("朗读次数与形式", "齐读、点读、范读、分角色，目标至少三次，每次换一种办法。", readBody, { missing: y.speechWhy })}
    ${row("范读的语速与停顿", "听老师读、我来读的那一段，语速要稳，停顿要留给诗句喘气。", modelBody, { missing: y.speechWhy })}
    ${row("朗读指导", "要说出「读出」「重音」「停顿」「读慢一点」「入情」，不要读完就过。", guideBody, { missing: y.speechWhy })}
    ${row("板书过程", "写板的时机要跟讲解中的关键词对上，让学生看见思考是怎么写上去的。", boardAuto, { missing: y.board.why || (y.hasSpeech ? "" : y.speechWhy) })}
    ${row("主板书、副板书、彩笔与布局", "主板书承题干与结构，副板书随课堂生成；重点字词用彩色粉笔标出；先想好位置再写。", `<p class="ob-lead">这几项要从板书画面里自查，软件无法代看。</p>${checkList(y.boardChecklists)}`)}
    ${row("炼字、换字比较", "用「换成」「改成」「如果把 X 换成 Y」来比；少说「为什么不用……用……」这种自问自答。", swapBody, { missing: y.speechWhy })}
    ${row("重过程，不直接给结论", "别一上来就说「十分经典」「非常好」「表达了作者……的思想感情」。不要说「翻译」，改成「谁来说说这句话什么含义」。不要句句翻译。", procBody, { missing: y.speechWhy })}
    ${row("节奏停顿", "停顿是技术。问完、读完、写完，都要敢把时间留出来。", pauseHint, { missing: y.speechWhy })}
    ${row("语文味与诗歌", "课里要有情感词，要能入情入境。高中诗歌要抓住意象、意境、想象、情感；并问：你同意吗，有没有不同看法。", flavourBody, { missing: y.speechWhy })}
    ${row("学法五看与几对关系", "学法五看：篇、段、句、词、意。还要言文结合，做减法，看共性也看个性，虚实、面点结合，抽象与具象互转。", `<p class="ob-lead">这些要从教学过程里自查。</p>${checkList(y.methodDetails)}`)}
    ${row("教-学-评一致与表现性评价", "学生读完、答完，要评在点上：读得好在哪、你抓住了……。", evalBody, { missing: y.speechWhy })}
    <p class="ob-credit">方法提示${esc(NOTES_CREDIT)}。完整条文也写在 docs/YUWEN_RUBRIC.md，可打印。</p>
  </section>`;
}

export function renderObserveSheet(host, session, opts = {}) {
  if (!host) return null;
  const report = buildObserveReport(session);
  const onJump = opts.onJump || (() => {});

  const particleBody = report.particles
    ? `<p class="ob-lead">共 ${report.particles.total} 次。按词分列，不合并计算。</p>
       <ul class="ob-pills">${(report.particles.words.length ? report.particles.words : [{ word: "（词表内未出现）", count: 0 }]).map((w) =>
         `<li><b>${esc(w.word)}</b> ${w.count} 次${(w.times || []).map(t => ` <button type="button" class="ob-jump" data-jump="${t}">${fmt(t)}</button>`).join("")}</li>`).join("")}</ul>`
    : "";

  const pauseBody = report.pauses
    ? `<p class="ob-lead">停顿 ${report.pauses.count} 处，平均 ${num(report.pauses.mean)} 秒${report.pauses.longest ? `，最长 ${num(report.pauses.longest.duration)} 秒（${fmt(report.pauses.longest.t)}）` : ""}。开场到第一句约 ${num(report.pauses.openingWait)} 秒。</p>
       ${barChart(report.pauses.bins)}`
    : "";

  const rateBody = report.rate
    ? `<p class="ob-lead">整段约 ${num(report.rate.cpm, 0)} 字/分。各时段的起伏见图，不作快慢评判。</p>
       ${lineChart(report.rate.points, "cpm")}`
    : "";

  const lenBody = report.lengths
    ? `<p class="ob-lead">共 ${report.lengths.count} 句，平均 ${num(report.lengths.mean)} 字。</p>${barChart(report.lengths.bins)}`
    : "";

  const repBody = report.repeats
    ? (report.repeats.length
      ? jumpList(report.repeats.map((r) => ({ t: r.times[0], text: r.text, count: r.count })), (it) => `「${esc(it.text)}」出现 ${it.count} 次`)
      : `<p class="ob-empty">转写里没有明显的重复短句。</p>`)
    : "";

  const motionBody = report.motion && report.motion.available
    ? `<p class="ob-lead">移动路程约 ${num(report.motion.distance, 2)} 个画面宽度（按髋部在画面中的位移累计，不是实际米数）。下图是站位落点的疏密。</p>
       ${heatGrid(report.motion.grid, report.motion.cols, report.motion.rows, report.motion.maxCell)}`
    : "";

  const gesBody = report.gestures && report.gestures.available
    ? `<p class="ob-lead">手势约 ${report.gestures.count} 次，平均幅度 ${num(report.gestures.meanAmp, 2)}（画面比例，仅供回看）。</p>
       ${report.gestures.times.length ? jumpList(report.gestures.times.slice(0, 8).map((t) => ({ t })), () => "一次手势") : ""}`
    : (report.poseWhy ? "" : `<p class="ob-empty">双手在画面里出现得很少，手势次数暂不统计。</p>`);

  const gaze = report.gaze && report.gaze.available ? report.gaze : null;
  const gazeBody = gaze
    ? `<p class="ob-lead">面向学生约 ${num(gaze.classRatio * 100, 0)}% 的可判时段。视线在画面中：左 ${num(gaze.leftRatio * 100, 0)}%，中 ${num(gaze.midRatio * 100, 0)}%，右 ${num(gaze.rightRatio * 100, 0)}%（按画面坐标，未换算成学生席）。背对写板约 ${num(gaze.backTime)} 秒，手在板书区约 ${num(gaze.boardTime)} 秒。</p>
       ${barChart([
         { label: "左", count: Math.round(gaze.leftRatio * 100) },
         { label: "中", count: Math.round(gaze.midRatio * 100) },
         { label: "右", count: Math.round(gaze.rightRatio * 100) },
       ])}`
    : "";

  const st = report.structure;
  const stBody = st && st.segments && st.segments.length
    ? `<p class="ob-lead">${st.source === "user" ? "按你划定的段落计时。" : "按时间比例和用词作出的估计，已标明「估计」，可作回看参考，不是教案审定。"}</p>
       ${stackBar(st.segments, st.duration)}
       <ul class="ob-segs">${st.segments.map((s) =>
         `<li><button type="button" class="ob-jump" data-jump="${s.start}">${fmt(s.start)}</button> ${st.source === "estimate" ? "估计 · " : ""}${esc(s.label)} ${fmt(s.start)}–${fmt(s.end)}（${num(s.end - s.start)} 秒）</li>`
       ).join("")}</ul>`
    : `<p class="ob-empty">时长或转写依据不足，未自动划分段落；可自行对照录像标注。</p>`;

  const qBody = report.questions
    ? `<p class="ob-lead">问句 ${report.questions.count} 处：封闭 ${report.questions.closed}，开放 ${report.questions.open}${report.questions.other ? `，其余 ${report.questions.other}` : ""}。问后平均等候 ${num(report.questions.meanWait)} 秒。</p>
       ${jumpList(report.questions.items, (it) => `${it.kind === "open" ? "开放" : it.kind === "closed" ? "封闭" : "问句"} · 候答 ${num(it.wait)} 秒 · ${esc(it.text)}`)}`
    : "";

  const L = report.lesson;
  const kpBody = !report.hasSpeech ? "" : `
    <p class="ob-kicker">${esc(L.label)}</p>
    ${L.keyPoints && L.keyPoints.length
      ? `<p class="ob-lead">提示语附近的句子，并记下重复较多的词。都来自你的原话。</p>
         ${jumpList(L.keyPoints, (it) => `「${esc(it.cue)}」${esc(it.text)}`)}
         ${L.keywords && L.keywords.length
           ? `<ul class="ob-pills">${L.keywords.map((k) => `<li><button type="button" class="ob-jump" data-jump="${k.times[0]}">${esc(k.word)}</button> ${k.count} 次</li>`).join("")}</ul>`
           : ""}`
      : `<p class="ob-empty">这一次没有出现「重点是」「大家注意」一类提示语。${L.keywords && L.keywords.length ? "下面是转写里重复较多的词：" : ""}</p>
         ${L.keywords && L.keywords.length ? `<ul class="ob-pills">${L.keywords.map((k) => `<li><button type="button" class="ob-jump" data-jump="${k.times[0]}">${esc(k.word)}</button> ${k.count} 次</li>`).join("")}</ul>` : ""}`}`;

  const rhythm = L.rhythm;
  const rhythmBody = rhythm && rhythm.minutes
    ? `<p class="ob-lead">按每分钟列出语速、估计间隙、移动和手势。「—」表示该项数据不足，不是零；没有转写的时段不能判定为静默。段落仅供自查。</p>
       ${st && st.segments ? stackBar(st.segments, st.duration) : ""}
       ${lineChart(rhythm.minutes, "cpm")}
       <table class="ob-table"><thead><tr><th>分钟</th><th>字/分</th><th>停顿秒</th><th>移动</th><th>手势</th></tr></thead>
       <tbody>${rhythm.minutes.map((m) =>
         `<tr><td><button type="button" class="ob-jump" data-jump="${m.t0}">${m.minute}</button></td><td>${num(m.cpm, 0)}</td><td>${num(m.pause)}</td><td>${num(m.move, 2)}</td><td>${num(m.gestures, 0)}</td></tr>`
       ).join("")}</tbody></table>`
    : "";

  const hiBody = L.highlights && L.highlights.length
    ? `<p class="ob-lead">同时出现提示语、手势、较长停顿或问句的片刻，点时刻可跳到回放。</p>
       ${jumpList(L.highlights, (it) => `${esc((it.kinds || []).map((k) => ({ cue: "提示语", question: "提问", pause: "停顿", gesture: "手势" }[k] || k)).join("、"))}${it.text ? " · " + esc(it.text) : ""}`)}`
    : (report.hasSpeech ? `<p class="ob-empty">这一次没有同时具备两项以上的片刻。</p>` : "");

  const trBody = L.transitions
    ? (L.transitions.length
      ? jumpList(L.transitions, (it) => `「${esc(it.phrase)}」${esc(it.text)}`)
      : `<p class="ob-empty">没有出现「接下来」「我们再看」「刚才说到」。`) + (L.transitions.length ? "" : `</p>`)
    : "";

  const echoBody = L.echo
    ? (L.echo.overlap.length
      ? `<p class="ob-lead">开头与结尾各约 15% 时段里，重复出现的词：</p><ul class="ob-pills">${L.echo.overlap.map((k) => `<li>${esc(k.word)}</li>`).join("")}</ul>`
      : `<p class="ob-empty">开头和结尾的用词重叠很少。</p>`)
    : "";

  const boardBody = L.board && L.board.available
    ? `<p class="ob-lead">写板时段前后，转写里出现的词。</p>
       ${L.board.spans.map((s) =>
         `<div class="ob-board-span"><button type="button" class="ob-jump" data-jump="${s.t}">${fmt(s.t)}</button>
            ${s.keywords.length ? s.keywords.map((k) => esc(k.word)).join("、") : "附近转写里没有抽出重复的词。"}
            ${s.quotes.length ? `<p class="ob-quote">「${esc(s.quotes[0].text)}」</p>` : ""}</div>`
       ).join("")}`
    : (report.hasSpeech ? `<p class="ob-empty">这一次没有记下写板时段。</p>` : "");

  const styleBody = L.styles
    ? `<ul class="ob-style">${L.styles.map((g) =>
        `<li><b>${esc(g.label)}</b> ${g.items.length} 次${g.items.length ? " · " + g.items.map((it) => `<button type="button" class="ob-jump" data-jump="${it.t}">${fmt(it.t)}</button>「${esc(it.phrase)}」`).join(" ") : ""}</li>`
      ).join("")}</ul>`
    : "";

  const cheerBody = L.cheers
    ? (L.cheers.length
      ? jumpList(L.cheers, (it) => `「${esc(it.phrase)}」${esc(it.text)}`)
      : `<p class="ob-empty">没有出现「很好」「不错」「谢谢」「大家想一想」。</p>`)
    : "";

  const o = report.observation;
  const advice = report.interpretation;
  const evidence = o.evidence;
  const summary = `<section class="ob-section"><h3 class="ob-sec-title">观测来源与证据</h3>
    <p>${esc(report.sourceLabel)} · ${esc(o.source)}</p><p>${esc(report.sourceNote)}</p>
    <p>观测规则：${esc(o.observationVersion)} · 细项规则：${esc(report.detailRuleVersion)} · 建议规则：${esc(advice.ruleVersion || "未记录")}</p>
    ${evidence.length ? evidenceList(evidence) : "<p>没有可定位标记；不代表没有发生，也不代表表现正常。</p>"}
    <p>语气词、问句等仅按词表与转写估计；时刻是句段起点，不是逐词精确定位。间隙按字数估时，不是声学静默检测。</p>
    </section>
    <section class="ob-section"><h3 class="ob-sec-title">练习建议（不是观测结论）</h3>
      <p>${esc(advice.good || "")}</p><p>${esc(advice.next || "")}</p><p>${esc(advice.basis || "建议依据未记录。")}</p>
      ${advice.evidence?.length ? jumpList(advice.evidence, e => esc(e.source || "来源未记录")) : "<p>没有关联证据，不能当作已检测到问题。</p>"}
      <p>下方每栏的「自查角度」和语文方法提示是可替换的练习建议，不是对这次教学质量的判定。</p>
    </section>
    <section class="ob-section"><h3 class="ob-sec-title">缺失与限制</h3>
      ${report.missing.length ? `<ul>${report.missing.map(text => `<li>${esc(text)}</li>`).join("")}</ul>` : "<p>已有数据仍受画面和转写误差限制，未标记不代表没有发生。</p>"}
    </section>`;

  host.classList.add("observe-sheet");
  host.hidden = false;
  host.innerHTML = `
    <header class="ob-sheet-head">
      <h3>这一次的观察记录</h3>
      <p>观测、练习建议与缺失分开列出，不做好坏评分。</p>
    </header>
    ${summary}
    <section class="ob-section">
      <h3 class="ob-sec-title">细项</h3>
      ${row("语气词", "看哪些垫话出现得多，以及出现在哪一段。", particleBody, { missing: report.speechWhy })}
      ${row("停顿与间隙", "看话和话之间空了多久，以及最长的那一次落在哪里。", pauseBody, { missing: report.speechWhy })}
      ${row("语速", "看整段大约每分钟说多少字，以及不同时段是否有起伏。", rateBody, { missing: report.speechWhy })}
      ${row("句长", "看句子是偏短还是偏长，方便对照自己的讲解习惯。", lenBody, { missing: report.speechWhy })}
      ${row("重复与回读", "看同一句话或同一个短语有没有再讲一遍。", repBody, { missing: report.speechWhy })}
      ${row("开场等待", "看开口之前留了多久。", report.pauses ? `<p class="ob-lead">从计时开始到第一句，约 ${num(report.pauses.openingWait)} 秒。</p>` : "", { missing: report.speechWhy })}
      ${row("站位分布与移动", "看人在画面里经常站在哪里，以及走动的路程。", motionBody || "", { missing: report.poseWhy })}
      ${row("手势", "看手是否抬起、大约几次、幅度多大。", (report.gestures && report.gestures.available) || !report.poseWhy ? gesBody : "", { missing: report.gestures && report.gestures.available ? "" : (report.poseWhy || "") })}
      ${row("面向学生与视线覆盖", "看抬眼对着镜头的时间，以及视线在画面左、中、右的分布。", gazeBody, { missing: gaze ? "" : (report.gaze && report.gaze.why) || "没有足够的视线记录。" })}
      ${row("背对写板", "看有没有较长时间背对学生写板，以及手在板书区停留多久。", gaze ? `<p class="ob-lead">背对写板约 ${num(gaze.backTime)} 秒；手在板书区约 ${num(gaze.boardTime)} 秒。</p>` : "", { missing: report.poseWhy || (gaze ? "" : (report.gaze && report.gaze.why) || "没有足够的画面记录。") })}
      ${row("结构时间线", "看导入、新授、小结大约各占多久，便于对照自己的教案节奏。", stBody)}
      ${row("提问与候答", "看问了几次、问法偏封闭还是开放，以及问完后留了多久。", qBody, { missing: report.speechWhy })}
    </section>
    <section class="ob-section ob-lesson">
      <h3 class="ob-sec-title">整节课</h3>
      <p class="ob-kicker-lead">依据你的原话定位。下列条目都从转写和时间戳里抽出，供回看，不是评分。</p>
      ${row("重点提取", "看你用提示语点出的句子，以及反复出现的词落在哪一分钟。", kpBody, { missing: report.speechWhy })}
      ${row("课堂节奏", "把语速、停顿、移动和手势叠在同一条时间线上，对照讲授、提问和小结。", rhythmBody, { missing: report.speechWhy && report.poseWhy ? `${report.speechWhy} ${report.poseWhy}` : "" })}
      ${row("亮点片段", "把提示语、手势、停顿和提问碰到一起的片刻标出来，便于直接跳回去看。", hiBody, { missing: report.speechWhy && !(L.highlights && L.highlights.length) ? report.speechWhy : "" })}
      ${row("提问与互动", "把封闭问（是不是、对不对、吗）和开放问（为什么、怎么看、你觉得）分开看，并记下问后的等待。", qBody, { missing: report.speechWhy })}
      ${row("衔接过渡", "看「接下来」「我们再看」「刚才说到」出现的位置。", trBody, { missing: report.speechWhy })}
      ${row("首尾呼应", "看开头和结尾大约各 15% 的时间里，有没有用到相同的词。", echoBody, { missing: report.speechWhy })}
      ${row("板书与讲解对应", "看写板前后你口头提到的词，是否和板书动作落在同一时段。", boardBody, { missing: L.board.why || report.speechWhy })}
      ${row("讲解方式", "看举例、类比、追问各用了几次、出现在何时。", styleBody, { missing: report.speechWhy })}
      ${row("激励与启发", "看「很好」「不错」「谢谢」「大家想一想」出现的位置。", cheerBody, { missing: report.speechWhy })}
    </section>
    ${yuwenSection(session, report)}
    ${simSection(session)}
  `;

  host.querySelectorAll("[data-jump]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const t = Number(btn.getAttribute("data-jump"));
      if (Number.isFinite(t)) onJump(t);
    });
  });
  return report;
}
