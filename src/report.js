/** Print-friendly report (window.print → 打印 / 存为 PDF). */
import { esc, $ } from "./ui.js";
import { fmtDate, fmtDur } from "./records.js";
import { VERSION_LABEL } from "./version.js";
import { buildFillerReport } from "./fillers.js";
import { INDICATORS } from "./chart.js";
import { buildReviewContext } from "./observe.js";

const valueText = n => Number.isFinite(n) ? String(n) : "未统计";
const timeText = t => Number.isFinite(t) ? fmtDur(t) : "时间未记录";

export function buildPrintReport(session, { stillDataUrl = "", watermark = false, trend = [] } = {}) {
  const context = buildReviewContext(session);
  const { observation: o, interpretation: advice } = context;
  const duration = Number.isFinite(session.duration) ? session.duration : o.duration;
  const events = o.evidence.slice().sort((a, b) => (a.t ?? Infinity) - (b.t ?? Infinity));
  const counts = INDICATORS.map(ind => {
    const n = o.counts[ind.key];
    const per = Number.isFinite(n) && duration > 0 ? Math.round(n / (duration / 60) * 100) / 100 : null;
    return `<div class="pr-count"><b>${valueText(n)}</b><span>${ind.label}</span><small>${Number.isFinite(per) ? per + " 次/分钟" : "未统计"}</small></div>`;
  }).join("");
  const rows = events.length
    ? events.map(e => `<tr><td>${timeText(e.t)}</td><td>${esc(labelOf(e))}</td><td>${esc(e.source)}</td><td>${esc(e.observationVersion)}</td></tr>`).join("")
    : `<tr><td colspan="4">没有可定位标记；不代表没有发生，也不代表表现正常。</td></tr>`;
  // A table preserves missing values; the legacy trend renderer treats them as zero.
  const trendHtml = trend.length >= 2
    ? `<section class="pr-trend"><h3>最近 ${trend.length} 次的历史汇总（每分钟次数）</h3>
       <p>保留历史值供回看；旧记录的来源、覆盖与规则版本可能未记录，不作同口径优劣比较。未统计不是零。</p>
       <table><thead><tr><th>记录</th>${INDICATORS.map(i => `<th>${i.label}</th>`).join("")}</tr></thead>
       <tbody>${trend.map(p => `<tr><td>${esc(p.label)}</td>${INDICATORS.map(i => `<td>${valueText(p.values?.[i.key])}</td>`).join("")}</tr>`).join("")}</tbody></table></section>`
    : "";
  const ratio = Number.isFinite(o.classRatio) && o.available.gaze ? `${Math.round(o.classRatio * 100)}%（可判时段）` : "未统计";
  const missing = o.missing.length ? o.missing.map(text => `<li>${esc(text)}</li>`).join("") : "<li>已覆盖项目仍受单摄像头与转写误差限制；未标记不代表没有发生。</li>";
  const html = `
    <header class="pr-head">
      <div><p class="pr-brand">沉思波 · OpenPodium 开讲</p><h1>试讲小结</h1></div>
      ${watermark ? `<span class="pr-mark">试用版</span>` : ""}
    </header>
    <p class="pr-meta">${fmtDate(session.startedAt || Date.now())} · 时长 ${fmtDur(duration)} · ${esc(context.sourceLabel)}${session.profileName ? " · " + esc(session.profileName) : ""} · 朝向镜头约 ${ratio}</p>
    <p>${esc(context.sourceNote)}</p>
    <p>来源：${esc(o.source)} · 观测规则：${esc(o.observationVersion)} · 建议规则：${esc(advice.ruleVersion || "未记录")}</p>
    <div class="pr-top">
      ${stillDataUrl ? `<img class="pr-still" src="${esc(stillDataUrl)}" alt="本次回看静帧">` : ""}
      <div class="pr-side"><h3>观测记录${context.demo ? "（预设演示）" : ""}</h3><div class="pr-counts">${counts}</div></div>
    </div>
    <section class="pr-quote next"><h3>练习建议（不是观测结论）</h3>
      <p>${esc(advice.good || "")}</p><p>${esc(advice.next || "")}</p><p>${esc(advice.basis || "未记录建议依据；请先回看确认。")}</p>
      <p>建议依据时刻：${advice.evidence?.length ? advice.evidence.map(e => `${timeText(e.t)} · ${esc(e.source || "来源未记录")}`).join("；") : "无关联证据，不能当作已检测到问题。"}</p>
    </section>
    <section class="pr-missing"><h3>缺失与限制</h3><ul>${missing}</ul></section>
    ${trendHtml}
    ${fillerBlock(session, context)}
    ${boardBlock(session)}
    <section class="pr-events"><h3>观测证据时间线${context.legacy ? "（保留旧记录）" : ""}</h3><table><thead><tr><th>时间</th><th>标记</th><th>来源</th><th>观测规则版本</th></tr></thead><tbody>${rows}</tbody></table></section>
    <footer class="pr-foot">视频画面留在本机。转写是否发送音频取决于所选听写引擎，请核对其隐私说明。标记仅作训练自查，不是表现评分。　${esc(VERSION_LABEL)}</footer>`;
  const host = $("print-report");
  if (host) host.innerHTML = html;
  return html;
}

function fillerBlock(session, context) {
  if (!context.observation.available.filler) {
    return `<section class="pr-fillers"><h3>口头禅观测</h3><p>${context.imported ? "导入视频未听写声音，口头禅未统计。" : "没有可用听写，口头禅未统计；不能据此判断口头禅少。"}</p></section>`;
  }
  const rep = session.diagnosis?.fillerReport || buildFillerReport(session);
  if (!rep.ok) return `<section class="pr-fillers"><h3>口头禅观测</h3><p>${esc(rep.reason)}</p></section>`;
  const words = (rep.words || []).map(w => `<li>「${esc(w.word)}」 ${valueText(w.count)} 次${w.times?.length ? " · " + w.times.map(timeText).join("、") : " · 时刻未记录"}</li>`).join("") || "<li>可用转写中未命中词表；不代表没有口头禅。</li>";
  return `<section class="pr-fillers"><h3>口头禅观测${context.demo ? "（预设字幕）" : ""}</h3>
    <p>共 ${valueText(rep.total)} 次，约 ${valueText(rep.perMin)} 次/分钟。词表可在设置里改。</p><ul>${words}</ul></section>`;
}

function boardBlock(session) {
  const stills = session.boardStills || [];
  if (!stills.length) return "";
  const imgs = stills.map(s => `<figure><img src="${esc(s.dataUrl)}" alt="板书区静帧"><figcaption>${timeText(s.t)}</figcaption></figure>`).join("");
  return `<section class="pr-board"><h3>板书静帧</h3><p>板书区画面供自己回看，不代表已识别文字或判断板书质量。</p><div class="pr-stills">${imgs}</div></section>`;
}

function labelOf(e) {
  if (e.type === "filler" || e.kind === "filler") return `口头禅「${e.word || e.label || "未记录词语"}」`;
  return e.label || e.type || e.kind || "未命名标记";
}

export function printReport() {
  document.body.classList.add("printing");
  const done = () => { document.body.classList.remove("printing"); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  setTimeout(() => { window.print(); setTimeout(done, 1500); }, 60);
}
