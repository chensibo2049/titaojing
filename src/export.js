import { BRAND, PRODUCT } from "./constants.js";
import { metricsOf } from "./records.js";
import { VERSION_LABEL } from "./version.js";

function fmt(sec) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export async function exportSummary(session, stillCanvas, opts = {}) {
  const { watermark = false, download = true } = opts;
  const W = 1080, H = 1920;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");

  ctx.fillStyle = "#f3eee4";
  ctx.fillRect(0, 0, W, H);
  // grain-like stripes
  ctx.fillStyle = "rgba(27,23,18,0.03)";
  for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);

  ctx.fillStyle = "#1b1712";
  ctx.font = "500 28px 'Noto Serif CJK SC', 'Songti SC', serif";
  ctx.fillText(BRAND, 72, 110);
  ctx.font = "600 72px 'Noto Serif CJK SC', 'Songti SC', serif";
  ctx.fillText(PRODUCT, 72, 200);

  const d = session.diagnosis || {};
  const when = new Date(session.startedAt || Date.now());
  const dateStr = `${when.getFullYear()}年${when.getMonth() + 1}月${when.getDate()}日  ${fmt(d.duration || session.duration || 0)}`;
  ctx.font = "400 28px 'Noto Sans CJK SC', 'PingFang SC', sans-serif";
  ctx.fillStyle = "#6f675c";
  ctx.fillText(dateStr, 72, 255);
  ctx.fillText(session.kind === "demo" ? "预设动画／字幕样本，非识别结果" : "本机试讲记录 · 单摄像头估计", 72, 298);

  if (stillCanvas) {
    const sw = 936, sh = Math.round(sw * (stillCanvas.height / stillCanvas.width || 16 / 9));
    const sx = 72, sy = 340;
    ctx.save();
    ctx.beginPath();
    rounded(ctx, sx, sy, sw, Math.min(sh, 700), 18);
    ctx.clip();
    ctx.fillStyle = "#161410";
    ctx.fillRect(sx, sy, sw, Math.min(sh, 700));
    ctx.drawImage(stillCanvas, sx, sy, sw, Math.min(sh, 700));
    ctx.restore();
    ctx.strokeStyle = "rgba(27,23,18,0.18)";
    ctx.lineWidth = 2;
    rounded(ctx, sx, sy, sw, Math.min(sh, 700), 18);
    ctx.stroke();
  }

  const metrics = metricsOf(session);
  const counts = [
    ["教态", metrics.posture ?? "未统计"],
    ["视线落下", metrics.gaze ?? "未统计"],
    ["口头禅", metrics.filler ?? "未统计"],
    ["写板未回视", metrics.board ?? "未统计"],
  ];
  const boxY = 1080;
  counts.forEach((item, i) => {
    const x = 72 + (i % 2) * 468;
    const y = boxY + Math.floor(i / 2) * 160;
    ctx.fillStyle = "#faf7f0";
    ctx.strokeStyle = "rgba(27,23,18,0.12)";
    rounded(ctx, x, y, 440, 140, 16);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#a33b28";
    ctx.font = "600 64px 'Noto Serif CJK SC', serif";
    ctx.fillText(String(item[1]), x + 28, y + 80);
    ctx.fillStyle = "#6f675c";
    ctx.font = "400 26px 'Noto Sans CJK SC', 'PingFang SC', sans-serif";
    ctx.fillText(item[0], x + 28, y + 118);
  });

  ctx.fillStyle = "#2f6f6a";
  ctx.font = "500 22px 'Noto Sans CJK SC', 'PingFang SC', sans-serif";
  ctx.fillText("本次观测与来源", 72, 1440);
  ctx.fillStyle = "#1b1712";
  ctx.font = "400 30px 'Noto Serif CJK SC', 'Songti SC', serif";
  wrapText(ctx, d.good || "", 72, 1490, 936, 48);

  ctx.fillStyle = "#c4a36a";
  ctx.font = "500 22px 'Noto Sans CJK SC', 'PingFang SC', sans-serif";
  ctx.fillText("下一次可以试的一招", 72, 1680);
  ctx.fillStyle = "#1b1712";
  ctx.font = "400 30px 'Noto Serif CJK SC', 'Songti SC', serif";
  wrapText(ctx, d.next || "", 72, 1730, 936, 48);

  ctx.fillStyle = "#6f675c";
  ctx.font = "400 20px 'Noto Sans CJK SC', sans-serif";
  ctx.fillText("视频留在本机，不上传。这不是心理或医学测评。", 72, 1860);
  ctx.fillText(`OpenPodium · 开讲  ${VERSION_LABEL}`, 72, 1892);

  if (watermark) {
    ctx.save();
    ctx.fillStyle = "rgba(163,59,40,0.9)";
    ctx.font = "600 26px 'Noto Sans CJK SC', 'PingFang SC', sans-serif";
    ctx.textAlign = "right";
    ctx.fillText("试用版", W - 72, 110);
    ctx.restore();
  }

  return new Promise((resolve) => {
    c.toBlob((blob) => {
      if (!download || !blob) { resolve(blob); return; }
      const a = document.createElement("a");
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.download = `开讲小结-${when.getMonth() + 1}月${when.getDate()}日.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      resolve(blob);
    }, "image/png");
  });
}

function rounded(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx, text, x, y, maxW, lineH) {
  const chars = [...(text || "")];
  let line = "", yy = y;
  for (const ch of chars) {
    const trial = line + ch;
    if (ctx.measureText(trial).width > maxW && line) {
      ctx.fillText(line, x, yy);
      line = ch;
      yy += lineH;
    } else line = trial;
  }
  if (line) ctx.fillText(line, x, yy);
}
