export const $ = (id) => document.getElementById(id);

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let toastTimer = 0;
export function toast(msg, ms = 2800) {
  const el = $("toast");
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

/** Keep keyboard focus in a visible dialog and restore the invoking control. */
export function focusDialog(container, initial) {
  const previous = document.activeElement;
  const app = $("app");
  const wasInert = app.inert;
  app.inert = true;
  const items = () => [...container.querySelectorAll('a[href], button, input, select, textarea, [tabindex="0"]')].filter(e => !e.disabled && e.getClientRects().length);
  const onKey = e => {
    if (e.key !== "Tab") return;
    const list = items();
    const first = list[0], last = list.at(-1);
    if (e.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !container.contains(document.activeElement))) { e.preventDefault(); first?.focus(); }
  };
  container.addEventListener("keydown", onKey);
  (initial || items()[0])?.focus({ preventScroll: true });
  return () => {
    container.removeEventListener("keydown", onKey);
    app.inert = wasInert;
    if (previous?.isConnected && previous !== document.body && previous.getClientRects().length) previous.focus({ preventScroll: true });
    else $("btn-camera")?.focus({ preventScroll: true });
  };
}

export function closeModal() { $("modal").closeDialog?.(); }

/** Simple modal. actions: [{label, primary, onClick}] ; returns close(). */
export function modal(html, actions = [{ label: "关闭" }]) {
  const m = $("modal");
  $("modal-body").innerHTML = html;
  const host = $("modal-actions");
  host.innerHTML = "";
  let restoreFocus;
  const close = () => { m.hidden = true; $("modal-body").innerHTML = ""; restoreFocus?.(); m.closeDialog = null; };
  m.closeDialog = close;
  for (const a of actions) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = a.primary ? "btn-mini primary" : a.danger ? "btn-mini danger" : "btn-mini";
    b.textContent = a.label;
    b.addEventListener("click", async () => {
      const keep = a.onClick ? await a.onClick() : false;
      if (!keep) close();
    });
    host.appendChild(b);
  }
  m.hidden = false;
  restoreFocus = focusDialog(m);
  return close;
}

export function confirmBox(text, okLabel = "确定", danger = false) {
  return new Promise((resolve) => {
    modal(`<p>${esc(text)}</p>`, [
      { label: "取消", onClick: () => resolve(false) },
      { label: okLabel, primary: !danger, danger, onClick: () => resolve(true) },
    ]);
  });
}

export function downloadBlob(blob, name) {
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function copyText(text, fallbackEl) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) {}
  try {
    const ta = fallbackEl || document.createElement("textarea");
    if (!fallbackEl) { ta.value = text; document.body.appendChild(ta); }
    ta.removeAttribute("readonly");
    ta.select();
    const ok = document.execCommand("copy");
    if (fallbackEl) ta.setAttribute("readonly", "");
    else ta.remove();
    return ok;
  } catch (_) {
    return false;
  }
}

/** Size a stage element to fit its wrapper at a given aspect ratio (w/h), so overlays align with video. */
export function fitStage(stage, aspect) {
  if (!stage) return;
  const wrap = stage.parentElement;
  if (!wrap) return;
  const cs = getComputedStyle(wrap);
  const aw = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const ah = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  if (aw <= 0 || ah <= 0) return;
  let w = aw, h = aw / aspect;
  if (h > ah) { h = ah; w = ah * aspect; }
  const W = `${Math.floor(w)}px`, H = `${Math.floor(h)}px`;
  if (stage.style.width !== W || stage.style.height !== H) {
    stage.style.width = W;
    stage.style.height = H;
    stage.style.aspectRatio = "auto";
    stage.style.maxWidth = "none";
  }
}
