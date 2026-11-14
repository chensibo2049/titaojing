/** Print-friendly one-page report (window.print → 打印 / 存为 PDF). */
import { esc, $ } from "./ui.js";
import { fmtDate, fmtDur, metricsOf } from "./records.js";
import { VERSION_LABEL } from "./version.js";
import { trendSvg, INDICATORS } from "./chart.js";

export function buildPrintReport(session, { stillDataUrl = "", watermark = false, trend = [] } = {}) {
  const d = session.diagnosis || {};
  const m = metricsOf(session);
  const events = (session.events || []).slice().sort((a, b) => a.t - b.t);
  const counts = INDICATORS.map((ind) => `
    <div class="pr-count"><b>${m[ind.key]}</b><span>${ind.label}</span><small>${m.perMin[ind.key]} 次/分钟</small></div>`).join("");
  const rows = events.length
    ? events.map((e) => `<tr><td>${fmtDur(e.t)}</td><td>${esc(labelOf(e))}</td></tr>`).join("")
    : `<tr><td colspan="2">这一次没有标记到需要提醒的时刻。</td></tr>`;
  const trendHtml = trend.length >= 2
    ? `<section class="pr-trend"><h3>最近 ${trend.length} 次的变化（每分钟次数）</h3>${trendSvg(trend, { width: 680, height: 220, unit: " 次/分" })}
       <p class="pr-legend">${INDICATORS.map((i) => `<i style="background:${i.color}"></i>${i.label}`).join("　")}</p></section>`
    : "";
  $("print-report").innerHTML = `
    <header class="pr-head">
      <div><p class="pr-brand">沉思波 · 体态镜</p><h1>试讲小结</h1></div>
      ${watermark ? `<span class="pr-mark">试用版</span>` : ""}
    </header>
    <p class="pr-meta">${fmtDate(session.startedAt || Date.now())} · 时长 ${fmtDur(m.duration)} · ${session.kind === "demo" ? "一键演示样本" : "本机试讲记录"} · 面向学生约 ${Math.round((m.classRatio || 0) * 100)}%</p>
    <div class="pr-top">
      ${stillDataUrl ? `<img class="pr-still" src="${stillDataUrl}" alt="">` : ""}
      <div class="pr-side">
        <div class="pr-counts">${counts}</div>
        <section class="pr-quote good"><h3>这一次最提神的一点</h3><p>${esc(d.good || "")}</p></section>
        <section class="pr-quote next"><h3>下一次可以试的一招</h3><p>${esc(d.next || "")}</p></section>
      </div>
    </div>
    ${trendHtml}
    <section class="pr-events"><h3>时间线标记</h3><table><thead><tr><th>时间</th><th>提醒</th></tr></thead><tbody>${rows}</tbody></table></section>
    <footer class="pr-foot">视频留在本机，不上传。体态与视线为单摄像头估计，仅作训练提示，不是心理或医学测评。　${esc(VERSION_LABEL)}</footer>`;
}

function labelOf(e) {
  if (e.type === "filler") return `口头禅「${e.word || e.label}」`;
  return e.label || e.type;
}

export function printReport() {
  document.body.classList.add("printing");
  const done = () => { document.body.classList.remove("printing"); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  setTimeout(() => { window.print(); setTimeout(done, 1500); }, 60);
}
