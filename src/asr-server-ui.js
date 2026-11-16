/** Explicit post-recording upload, separate from local practice and event timelines. */
import { serverAsrStatus, probeServerAsr, createServerAsrSession, transcribeServerAudio } from "./asr-server.js";

export function mountServerAsr(root) {
  if (!root || root.dataset.mounted) return;
  root.dataset.mounted = "true";
  const state = serverAsrStatus();
  const title = document.getElementById("server-asr-title");
  if (title) title.textContent = state.configured ? "录后服务器转写 · 需检查连接" : "录后服务器转写 · 未接入";
  if (!state.configured) { root.textContent = state.detail; return; }
  root.innerHTML = `
    <p>独立录后工具，不改变本机练习报告。仅接收最长 60 秒、12 MiB 内的音频文件；不接收视频。接收方为本站自建服务，不用于训练；临时音频在处理结束、失败或取消后删除，断网时由服务端超时清理。结果无逐词时间戳，不生成口头禅时间线。关闭或离开页面不保存结果。</p>
    <label class="field"><span>本次音频</span><input type="file" accept="audio/*" data-audio></label>
    <label class="field"><span>听写访问码（不保存）</span><input type="password" maxlength="128" autocomplete="off" data-code></label>
    <label class="field-check"><input type="checkbox" data-consent><span>我有权使用所选音频，明确同意本次仅上传音频到本站服务器进行录后转写。</span></label>
    <div class="page-actions"><button type="button" class="btn-mini" data-start>检查连接并转写</button><button type="button" class="btn-mini" data-cancel disabled>取消并请求删除</button></div>
    <p role="status" aria-live="polite" data-status>尚未上传。拒绝上传不影响本机视觉练习。</p>
    <label class="field"><span>录后转写结果（无时间对齐）</span><textarea rows="5" readonly data-result></textarea></label>`;
  const q = s => root.querySelector(s);
  const start = q("[data-start]"), cancel = q("[data-cancel]"), status = q("[data-status]");
  let active = null;
  const abort = () => active?.abort();
  cancel.addEventListener("click", abort);
  // Hash navigation leaves settings without unmounting its DOM.
  const clearPrivateFields = () => {
    abort();
    q("[data-code]").value = "";
    q("[data-result]").value = "";
    q("[data-consent]").checked = false;
    q("[data-audio]").value = "";
    status.textContent = "尚未上传。拒绝上传不影响本机视觉练习。";
  };
  window.addEventListener("hashchange", () => { if (!location.hash.startsWith("#/settings")) clearPrivateFields(); });
  window.addEventListener("pagehide", clearPrivateFields);
  start.addEventListener("click", async () => {
    if (active) return;
    const file = q("[data-audio]").files[0];
    if (!q("[data-consent]").checked) { status.textContent = "未同意上传，没有发送音频。"; return; }
    if (!file || !/^audio\//i.test(file.type) || !file.size || file.size > 12 * 1024 * 1024) { status.textContent = "请选择 12 MiB 内的音频文件；不接收视频。"; return; }
    const code = q("[data-code]").value;
    if (!code) { status.textContent = "请输入访问码。"; return; }
    active = new AbortController();
    const controller = active;
    start.disabled = true; cancel.disabled = false; q("[data-result]").value = "";
    try {
      status.textContent = "检查同源服务连接；尚未上传音频。";
      const health = await probeServerAsr({ signal: controller.signal });
      if (controller.signal.aborted) throw new Error("已取消；未切换其他服务。");
      if (!health.available) throw new Error(health.detail);
      const session = await createServerAsrSession(code, { signal: controller.signal });
      q("[data-code]").value = "";
      const result = await transcribeServerAudio(file, { consent: true, sessionToken: session.token, signal: controller.signal,
        onStatus: s => { status.textContent = s.message; } });
      if (!controller.signal.aborted && location.hash.startsWith("#/settings")) q("[data-result]").value = result.text;
      status.textContent = "录后转写完成，已请求删除服务端作业。结果仅供核对，没有写入练习历史或统计。";
    } catch (error) { status.textContent = error.message || "转写失败，未切换其他厂商。"; }
    finally { active = null; start.disabled = false; cancel.disabled = true; q("[data-code]").value = ""; q("[data-consent]").checked = false; }
  });
}
