/** Tiny dependency-free SVG trend chart. */
export const INDICATORS = [
  { key: "posture", label: "教态", color: "#c4a36a" },
  { key: "gaze", label: "视线落下", color: "#2f8f86" },
  { key: "filler", label: "口头禅", color: "#c4513b" },
  { key: "board", label: "写板未回视", color: "#6d6a8f" },
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/**
 * @param {Array<{label:string, values:Record<string,number>}>} points chronological
 * @param {object} opt { width, height, visible: Set<string>, unit }
 */
export function trendSvg(points, opt = {}) {
  const W = opt.width || 720, H = opt.height || 280;
  const pad = { l: 40, r: 16, t: 16, b: 40 };
  const visible = opt.visible || new Set(INDICATORS.map((i) => i.key));
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  let max = 0;
  for (const p of points) for (const ind of INDICATORS) if (visible.has(ind.key)) max = Math.max(max, p.values[ind.key] || 0);
  const step = niceStep(max / 4);
  const ticks = Math.max(1, Math.ceil((max || step) / step));
  max = step * ticks;
  const n = points.length;
  const x = (i) => pad.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v) => pad.t + ih - (v / max) * ih;
  const parts = [];
  parts.push(`<svg viewBox="0 0 ${W} ${H}" class="trend-svg" role="img" aria-label="${esc(opt.aria || "四项指标趋势")}">`);
  // grid
  for (let i = 0; i <= ticks; i++) {
    const v = (max / ticks) * i;
    const yy = y(v);
    parts.push(`<line x1="${pad.l}" x2="${W - pad.r}" y1="${yy}" y2="${yy}" class="grid"/>`);
    parts.push(`<text x="${pad.l - 8}" y="${yy + 4}" text-anchor="end" class="tick">${fmtNum(v)}</text>`);
  }
  // x labels (thin out)
  const every = Math.max(1, Math.ceil(n / 8));
  points.forEach((p, i) => {
    if (i % every !== 0 && i !== n - 1) return;
    parts.push(`<text x="${x(i)}" y="${H - pad.b + 20}" text-anchor="middle" class="tick">${esc(p.label)}</text>`);
  });
  for (const ind of INDICATORS) {
    if (!visible.has(ind.key)) continue;
    const pts = points.map((p, i) => `${x(i).toFixed(1)},${y(p.values[ind.key] || 0).toFixed(1)}`);
    if (n > 1) parts.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="${ind.color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`);
    points.forEach((p, i) => {
      parts.push(`<circle cx="${x(i).toFixed(1)}" cy="${y(p.values[ind.key] || 0).toFixed(1)}" r="3.6" fill="${ind.color}"><title>${esc(p.label)} ${ind.label}：${fmtNum(p.values[ind.key] || 0)}${opt.unit || ""}</title></circle>`);
    });
  }
  parts.push(`</svg>`);
  return parts.join("");
}

function niceStep(raw) {
  if (raw <= 0) return 0.25;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const m = raw / pow;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * pow;
}

function niceMax(v) {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const m = v / pow;
  const nice = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return nice * pow;
}

function fmtNum(v) {
  return Number.isInteger(v) ? String(v) : v.toFixed(v < 1 ? 2 : 1).replace(/\.?0+$/, "");
}
